#!/usr/bin/env python3
"""Shared JSON-file document store for Career Mission Control.

Used by server.py (the local web server) and cmc.py (the CLI). Both edit
the same file, data/db.json, so every read-modify-write runs under a
cross-process file lock (fcntl.flock on data/db.json.lock) and every write is
atomic (temp file in the same directory, then os.replace).

File layout:
  {"rev": N, "docs": {"<collection>/<id>": {"version": V, "data": {...}}}}

Paths follow the db contract grammar: slash-separated segments made of
[A-Za-z0-9_-.~:@+], never "." or "..", at most 200 bytes per segment,
1000 bytes and 16 segments per path. A document path has an even number
of segments, a collection path an odd number.
"""

import copy
import fcntl
import json
import os
import re
import tempfile
import threading

SEGMENT_RE = re.compile(r"^[A-Za-z0-9_\-.~:@+]+$")
MAX_SEGMENT_BYTES = 200
MAX_PATH_BYTES = 1000
MAX_SEGMENTS = 16


class DbError(Exception):
    """An error with a contract-style code (invalid_argument, ...)."""

    def __init__(self, code, message):
        Exception.__init__(self, message)
        self.code = code
        self.message = message

    def to_json(self):
        return {"error": {"code": self.code, "message": self.message}}


def default_db_path():
    env = os.environ.get("CMC_DB_PATH")
    if env:
        return os.path.abspath(env)
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(here, "data", "db.json")


def split_path(path):
    """Validate a path and return its segments. Raises DbError."""
    if not isinstance(path, str) or path == "":
        raise DbError("invalid_argument", "path must be a non-empty string")
    if len(path.encode("utf-8")) > MAX_PATH_BYTES:
        raise DbError("invalid_argument", "path is longer than 1000 bytes")
    segs = path.split("/")
    if len(segs) > MAX_SEGMENTS:
        raise DbError("invalid_argument", "path has more than 16 segments")
    for s in segs:
        if s == "" or s == "." or s == "..":
            raise DbError("invalid_argument", "path segment %r is not allowed" % s)
        if not SEGMENT_RE.match(s):
            raise DbError("invalid_argument", "path segment %r has characters outside [A-Za-z0-9_-.~:@+]" % s)
        if len(s.encode("utf-8")) > MAX_SEGMENT_BYTES:
            raise DbError("invalid_argument", "path segment is longer than 200 bytes")
    return segs


def doc_segments(path):
    segs = split_path(path)
    if len(segs) % 2 != 0:
        raise DbError("invalid_argument", "a document path needs an even number of segments, got %d" % len(segs))
    return segs


def collection_segments(path):
    segs = split_path(path)
    if len(segs) % 2 != 1:
        raise DbError("invalid_argument", "a collection path needs an odd number of segments, got %d" % len(segs))
    return segs


MAX_DOC_BYTES = 256 * 1024
MAX_DOC_DEPTH = 32


def _depth(v, d=1):
    if isinstance(v, dict):
        return max([_depth(x, d + 1) for x in v.values()] or [d])
    if isinstance(v, list):
        return max([_depth(x, d + 1) for x in v] or [d])
    return d


def check_body(data):
    """Enforce the contract's document limits: a plain object, at most
    256 KiB serialized and 32 levels deep. Raises DbError."""
    if not isinstance(data, dict):
        raise DbError("invalid_argument", "document body must be a JSON object")
    try:
        size = len(json.dumps(data, ensure_ascii=False).encode("utf-8"))
    except (TypeError, ValueError) as e:
        raise DbError("invalid_argument", "document body is not JSON-serializable: %s" % e)
    if size > MAX_DOC_BYTES:
        raise DbError("invalid_argument", "document body is %d bytes; the limit is 256 KiB" % size)
    if _depth(data) > MAX_DOC_DEPTH:
        raise DbError("invalid_argument", "document body is nested deeper than 32 levels")


def deep_merge(base, patch):
    """Recursive merge: nested plain objects merge, everything else replaces."""
    out = dict(base)
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


class Store(object):
    """The JSON-file store. Thread-safe in-process, flock-guarded across processes."""

    def __init__(self, path=None):
        self.path = os.path.abspath(path or default_db_path())
        self.dir = os.path.dirname(self.path)
        self.lock_path = self.path + ".lock"
        self._lock = threading.RLock()
        self._state = {"rev": 0, "docs": {}}
        self._stamp = None  # (mtime_ns, size, ino) of the file we last loaded

    # ----- file helpers -------------------------------------------------
    def _stat_stamp(self):
        try:
            st = os.stat(self.path)
            return (st.st_mtime_ns, st.st_size, st.st_ino)
        except FileNotFoundError:
            return None

    def file_changed(self):
        """True when the file on disk differs from what we last loaded."""
        with self._lock:
            return self._stat_stamp() != self._stamp

    def _load_locked(self):
        stamp = self._stat_stamp()
        if stamp == self._stamp:
            return
        if stamp is None:
            self._state = {"rev": 0, "docs": {}}
            self._stamp = None
            return
        with open(self.path, "r", encoding="utf-8") as f:
            raw = f.read()
        try:
            data = json.loads(raw) if raw.strip() else {}
        except ValueError as e:
            raise DbError("unavailable", "db.json is not valid JSON: %s" % e)
        if not isinstance(data, dict):
            raise DbError("unavailable", "db.json root is not an object")
        docs = data.get("docs")
        if not isinstance(docs, dict):
            docs = {}
        rev = data.get("rev")
        if not isinstance(rev, int):
            rev = 0
        self._state = {"rev": rev, "docs": docs}
        self._stamp = stamp

    def _write_locked(self):
        os.makedirs(self.dir, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".db.", suffix=".tmp", dir=self.dir)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(self._state, f, indent=1, sort_keys=True, ensure_ascii=False)
                f.write("\n")
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self.path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        self._stamp = self._stat_stamp()

    class _FileLock(object):
        def __init__(self, store):
            self.store = store
            self.fh = None

        def __enter__(self):
            os.makedirs(self.store.dir, exist_ok=True)
            self.fh = open(self.store.lock_path, "a+")
            fcntl.flock(self.fh.fileno(), fcntl.LOCK_EX)
            return self

        def __exit__(self, *a):
            try:
                fcntl.flock(self.fh.fileno(), fcntl.LOCK_UN)
            finally:
                self.fh.close()
            return False

    def _file_lock(self):
        return Store._FileLock(self)

    # ----- reads ----------------------------------------------------------
    def refresh(self):
        """Reload from disk if it changed. Returns the current rev."""
        with self._lock:
            with self._file_lock():
                self._load_locked()
            return self._state["rev"]

    @property
    def rev(self):
        with self._lock:
            self._load_locked()
            return self._state["rev"]

    def count(self):
        with self._lock:
            self._load_locked()
            return len(self._state["docs"])

    def get(self, path):
        """Return {"id", "exists", "version", "data"} for a document path."""
        segs = doc_segments(path)
        with self._lock:
            self._load_locked()
            entry = self._state["docs"].get(path)
            if entry is None:
                return {"id": segs[-1], "exists": False, "version": 0, "data": None}
            return {
                "id": segs[-1],
                "exists": True,
                "version": entry.get("version", 1),
                "data": copy.deepcopy(entry.get("data", {})),
            }

    def list_collection(self, path):
        """Direct children of a collection, sorted by id ascending."""
        collection_segments(path)
        prefix = path + "/"
        out = []
        with self._lock:
            self._load_locked()
            for p, entry in self._state["docs"].items():
                if not p.startswith(prefix):
                    continue
                rest = p[len(prefix):]
                if "/" in rest or rest == "":
                    continue
                out.append({
                    "id": rest,
                    "version": entry.get("version", 1),
                    "data": copy.deepcopy(entry.get("data", {})),
                })
        out.sort(key=lambda d: d["id"])
        return out

    def all_docs(self):
        with self._lock:
            self._load_locked()
            return copy.deepcopy(self._state["docs"])

    # ----- writes ---------------------------------------------------------
    def _mutate(self, fn):
        """Run fn(docs) under both locks, bump rev, write. Returns (rev, result)."""
        with self._lock:
            with self._file_lock():
                self._load_locked()
                docs = self._state["docs"]
                result = fn(docs)
                self._state["rev"] = int(self._state.get("rev", 0)) + 1
                self._write_locked()
                return self._state["rev"], result

    def set(self, path, data):
        doc_segments(path)
        check_body(data)

        def fn(docs):
            old = docs.get(path)
            version = (old.get("version", 0) + 1) if old else 1
            docs[path] = {"version": version, "data": copy.deepcopy(data)}
            return version

        return self._mutate(fn)

    def update(self, path, patch):
        doc_segments(path)
        if not isinstance(patch, dict):
            raise DbError("invalid_argument", "update body must be a JSON object")

        def fn(docs):
            old = docs.get(path)
            if old is None:
                raise DbError("invalid_argument", "update: document %r does not exist" % path)
            merged = deep_merge(old.get("data", {}), patch)
            check_body(merged)
            version = old.get("version", 0) + 1
            docs[path] = {"version": version, "data": merged}
            return version

        return self._mutate(fn)

    def delete(self, path):
        doc_segments(path)

        def fn(docs):
            return docs.pop(path, None) is not None

        return self._mutate(fn)

    def batch(self, fn):
        """Apply several changes under one rev bump. fn(store_ops) where
        store_ops has set/update/delete that act on the in-memory dict."""

        class Ops(object):
            def __init__(self, docs):
                self.docs = docs
                self.changed = 0

            def set(self, path, data):
                doc_segments(path)
                check_body(data)
                old = self.docs.get(path)
                version = (old.get("version", 0) + 1) if old else 1
                self.docs[path] = {"version": version, "data": copy.deepcopy(data)}
                self.changed += 1
                return version

            def update(self, path, patch):
                doc_segments(path)
                old = self.docs.get(path)
                if old is None:
                    raise DbError("invalid_argument", "update: document %r does not exist" % path)
                if not isinstance(patch, dict):
                    raise DbError("invalid_argument", "update body must be a JSON object")
                merged = deep_merge(old.get("data", {}), patch)
                check_body(merged)
                self.docs[path] = {"version": old.get("version", 0) + 1, "data": merged}
                self.changed += 1

            def delete(self, path):
                doc_segments(path)
                if self.docs.pop(path, None) is not None:
                    self.changed += 1

            def get(self, path):
                e = self.docs.get(path)
                return copy.deepcopy(e["data"]) if e else None

            def children(self, col):
                prefix = col + "/"
                out = []
                for p, e in self.docs.items():
                    if p.startswith(prefix) and "/" not in p[len(prefix):]:
                        out.append((p[len(prefix):], copy.deepcopy(e.get("data", {}))))
                out.sort(key=lambda t: t[0])
                return out

        def wrapped(docs):
            ops = Ops(docs)
            res = fn(ops)
            return res

        return self._mutate(wrapped)
