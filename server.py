#!/usr/bin/env python3
"""Local server for the Career Mission Control dashboard.

Serves dashboard.html with a small shim injected after <body> so the page
finds window.claude and goes Live against data/db.json. Python stdlib only.

  python3 server.py [--port 4777] [--db PATH] [--page PATH]

Routes:
  GET    /                              dashboard with the shim injected
  GET    /_cmc/claude-local.js          the shim (files under static/ only)
  GET    /_cmc/health                   {"ok":true,"port","rev","docs","db"}
  GET    /api/collections/<col path>    {"docs":[{id,version,data}],"rev"}
  GET    /api/docs/<doc path>           {"id","exists","version","data","rev"}
  PUT    /api/docs/<doc path>           set (create or replace)
  PATCH  /api/docs/<doc path>           recursive merge into an existing doc
  DELETE /api/docs/<doc path>           idempotent delete
  GET    /api/events                    text/event-stream of change events
  GET    /_blob/<id>                    a file stored with the live page, from the GitHub mirror

Binds 127.0.0.1 only. Logs one line per write and per error to stderr.
"""

import argparse
import json
import os
import queue
import re
import signal
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cmcdb import DbError, Store  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(HERE, "dashboard.html")  # overridable with --page
STATIC_DIR = os.path.join(HERE, "static")
DATA_DIR = os.path.join(HERE, "data")
PID_FILE = os.path.join(DATA_DIR, "server.pid")  # default port; other ports use server-<port>.pid
SHIM_TAG = b'<script src="/_cmc/claude-local.js"></script>'
MAX_BODY_BYTES = 1024 * 1024  # request cap; the store enforces the 256 KiB document limit

STATIC_TYPES = {
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".html": "text/html; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
}
BLOB_PATH = re.compile(r"^/_blob/[0-9a-f]{32}$")
BLOB_TYPES = {
    ".pdf": "application/pdf",
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def log(msg):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    sys.stderr.write("[%s] %s\n" % (ts, msg))
    sys.stderr.flush()


class Broadcaster(object):
    """Fan-out of change events to every open SSE connection."""

    def __init__(self):
        self.lock = threading.Lock()
        self.clients = set()

    def subscribe(self):
        q = queue.Queue()
        with self.lock:
            self.clients.add(q)
        return q

    def unsubscribe(self, q):
        with self.lock:
            self.clients.discard(q)

    def publish(self, rev):
        with self.lock:
            targets = list(self.clients)
        for q in targets:
            q.put(rev)

    def publish_reload(self):
        """The page source or the shim changed on disk: every open view reloads."""
        with self.lock:
            targets = list(self.clients)
        for q in targets:
            q.put("reload")

    def count(self):
        with self.lock:
            return len(self.clients)


class App(object):
    def __init__(self, port, db_path):
        self.port = port
        self.store = Store(db_path)
        self.events = Broadcaster()
        self.last_rev = self.store.rev
        self.stop = threading.Event()

    def notify(self, rev):
        self.last_rev = rev
        self.events.publish(rev)

    def page_stamp(self):
        """mtime+size of dashboard.html and everything in static/ (live reload)."""
        stamp = []
        try:
            st = os.stat(PAGE)
            stamp.append((PAGE, st.st_mtime_ns, st.st_size))
            for name in sorted(os.listdir(STATIC_DIR)):
                full = os.path.join(STATIC_DIR, name)
                if os.path.isfile(full):
                    st = os.stat(full)
                    stamp.append((name, st.st_mtime_ns, st.st_size))
        except OSError:
            pass
        return tuple(stamp)

    def watch_file(self):
        """Poll db.json every second; push a change event if it moved on disk.
        Also watch the page source and the shim: when either changes, tell
        every open view to reload (so edits show up live in the browser)."""
        page_seen = self.page_stamp()
        while not self.stop.is_set():
            try:
                if self.store.file_changed():
                    rev = self.store.refresh()
                    self.last_rev = rev
                    self.events.publish(rev)
                now = self.page_stamp()
                if now != page_seen:
                    page_seen = now
                    log("page source changed on disk; asking %d open view(s) to reload" % self.events.count())
                    self.events.publish_reload()
            except Exception as e:  # keep the watcher alive no matter what
                log("watch error: %s" % e)
            self.stop.wait(1.0)


def load_page():
    with open(PAGE, "rb") as f:
        html = f.read()
    idx = html.find(b"<body")
    if idx < 0:
        return html
    end = html.find(b">", idx)
    if end < 0:
        return html
    return html[:end + 1] + SHIM_TAG + html[end + 1:]


class Handler(BaseHTTPRequestHandler):
    server_version = "CMCLocal/1.0"
    protocol_version = "HTTP/1.1"
    app = None  # set by main()

    # ----- plumbing -------------------------------------------------------
    def log_message(self, fmt, *args):
        pass  # do not log every GET

    def log_error(self, fmt, *args):
        log("http error: " + (fmt % args))

    def send_json(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_error_json(self, status, code, message):
        if status >= 500 or code != "invalid_argument":
            log("error %s %s -> %d %s: %s" % (self.command, self.path, status, code, message))
        self.send_json(status, {"error": {"code": code, "message": message}})

    def send_db_error(self, e):
        # a bad call is 400; anything else (say, db.json unreadable) is 503
        self.send_error_json(400 if e.code == "invalid_argument" else 503, e.code, e.message)

    def drop_unread_body(self):
        # a request whose body we never read must not stay on a keep-alive
        # connection, or the body bytes get parsed as the next request
        if self.headers.get("Content-Length") or self.headers.get("Transfer-Encoding"):
            self.close_connection = True

    def send_bytes(self, status, ctype, body):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def read_json_body(self):
        length = self.headers.get("Content-Length")
        try:
            n = int(length or 0)
        except ValueError:
            n = 0
        if n > MAX_BODY_BYTES:
            # do not read it; drop the connection so the unread body cannot
            # be parsed as the next request
            self.close_connection = True
            raise DbError("invalid_argument", "request body is over 1 MiB; a document is limited to 256 KiB")
        raw = self.rfile.read(n) if n > 0 else b""
        if not raw.strip():
            raise DbError("invalid_argument", "request body must be a JSON object")
        try:
            obj = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as e:
            raise DbError("invalid_argument", "request body is not valid JSON: %s" % e)
        if not isinstance(obj, dict):
            raise DbError("invalid_argument", "request body must be a JSON object")
        return obj

    def route(self):
        parts = urlsplit(self.path)
        return unquote(parts.path)

    # ----- methods --------------------------------------------------------
    def do_GET(self):
        path = self.route()
        try:
            if path == "/" or path == "/index.html" or path == "/dashboard.html":
                self.send_bytes(200, "text/html; charset=utf-8", load_page())
            elif path == "/_cmc/health":
                st = self.app.store
                self.send_json(200, {"ok": True, "port": self.app.port, "rev": st.rev,
                                     "docs": st.count(), "db": st.path})
            elif path.startswith("/_cmc/"):
                self.serve_static(path[len("/_cmc/"):])
            elif path == "/api/events":
                self.serve_events()
            elif path.startswith("/api/collections/"):
                col = path[len("/api/collections/"):]
                docs = self.app.store.list_collection(col)
                self.send_json(200, {"docs": docs, "rev": self.app.store.rev})
            elif path.startswith("/api/docs/"):
                doc = path[len("/api/docs/"):]
                res = self.app.store.get(doc)
                res["rev"] = self.app.store.rev
                self.send_json(200, res)
            elif path == "/favicon.ico":
                self.serve_static("favicon.png")
            elif BLOB_PATH.match(path):
                self.serve_blob(path[len("/_blob/"):])
            else:
                self.send_error_json(404, "not_found", "no route for %s" % path)
        except DbError as e:
            self.send_db_error(e)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            self.send_error_json(500, "unavailable", "%s: %s" % (type(e).__name__, e))

    def serve_blob(self, blob_id):
        """A file stored with the live page (/_blob/<id>). The desktop copy
        keeps the same files in the GitHub mirror; data/blobs/index.json maps
        each id to its file there (sync/mirror.py writes it)."""
        index = {}
        try:
            with open(os.path.join(DATA_DIR, "blobs", "index.json"), encoding="utf-8") as f:
                index = json.load(f)
        except (OSError, ValueError):
            pass
        target = index.get(blob_id) if isinstance(index, dict) else None
        if not isinstance(target, str) or not os.path.isfile(target):
            self.send_error_json(404, "not_found", "this file is not on this computer yet; the next sync brings it")
            return
        ctype = BLOB_TYPES.get(os.path.splitext(target)[1].lower(), "application/octet-stream")
        with open(target, "rb") as f:
            self.send_bytes(200, ctype, f.read())

    def do_HEAD(self):
        self.do_GET()

    def do_PUT(self):
        self.write_op("set")

    def do_PATCH(self):
        self.write_op("update")

    def do_DELETE(self):
        self.write_op("delete")

    def do_POST(self):
        self.drop_unread_body()
        self.send_error_json(405, "invalid_argument", "POST is not supported; use PUT, PATCH or DELETE on /api/docs/<path>")

    def write_op(self, op):
        path = self.route()
        if not path.startswith("/api/docs/"):
            self.drop_unread_body()
            self.send_error_json(404, "not_found", "no route for %s %s" % (self.command, path))
            return
        doc = path[len("/api/docs/"):]
        try:
            if op == "set":
                body = self.read_json_body()
                rev, version = self.app.store.set(doc, body)
            elif op == "update":
                body = self.read_json_body()
                rev, version = self.app.store.update(doc, body)
            else:
                rev, existed = self.app.store.delete(doc)
                version = 0
            log("%s %s -> rev %d" % (op, doc, rev))
            self.app.notify(rev)
            self.send_json(200, {"ok": True, "id": doc.split("/")[-1], "version": version, "rev": rev})
        except DbError as e:
            self.send_db_error(e)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            self.send_error_json(500, "unavailable", "%s: %s" % (type(e).__name__, e))

    # ----- static files ---------------------------------------------------
    def serve_static(self, rel):
        # strict guard: only plain files that resolve inside static/
        if not rel or rel.startswith("/") or "\\" in rel or "\x00" in rel:
            self.send_error_json(404, "not_found", "not found")
            return
        segs = rel.split("/")
        if any(s in ("", ".", "..") for s in segs):
            self.send_error_json(403, "forbidden", "path not allowed")
            return
        root = os.path.realpath(STATIC_DIR)
        full = os.path.realpath(os.path.join(root, *segs))
        if full != root and not full.startswith(root + os.sep):
            self.send_error_json(403, "forbidden", "path not allowed")
            return
        if not os.path.isfile(full):
            self.send_error_json(404, "not_found", "not found")
            return
        ext = os.path.splitext(full)[1].lower()
        ctype = STATIC_TYPES.get(ext, "application/octet-stream")
        with open(full, "rb") as f:
            self.send_bytes(200, ctype, f.read())

    # ----- server-sent events --------------------------------------------
    def serve_events(self):
        q = self.app.events.subscribe()
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            if self.command == "HEAD":
                self.close_connection = True
                return
            self.wfile.write(b"retry: 2000\n\n")
            self.wfile.write(("event: hello\ndata: %s\n\n" % json.dumps({"rev": self.app.store.rev})).encode("utf-8"))
            self.wfile.flush()
            while not self.app.stop.is_set():
                try:
                    item = q.get(timeout=15.0)
                    # coalesce a burst into one change event (plus one reload if any)
                    reload = item == "reload"
                    rev = None if reload else item
                    while True:
                        try:
                            item = q.get_nowait()
                        except queue.Empty:
                            break
                        if item == "reload":
                            reload = True
                        else:
                            rev = item
                    msg = ""
                    if rev is not None:
                        msg += "event: change\ndata: %s\n\n" % json.dumps({"rev": rev})
                    if reload:
                        msg += "event: reload\ndata: {}\n\n"
                except queue.Empty:
                    msg = ": ping\n\n"
                self.wfile.write(msg.encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, socket.timeout, OSError):
            pass
        finally:
            self.app.events.unsubscribe(q)
            self.close_connection = True


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def pid_file_for(port):
    if port == 4777:
        return PID_FILE
    return os.path.join(DATA_DIR, "server-%d.pid" % port)


def write_pid(port):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(pid_file_for(port), "w") as f:
        f.write(str(os.getpid()))


def remove_pid(port):
    path = pid_file_for(port)
    try:
        with open(path) as f:
            if f.read().strip() == str(os.getpid()):
                os.unlink(path)
    except OSError:
        pass


def main():
    ap = argparse.ArgumentParser(description="Career Mission Control local server")
    ap.add_argument("--port", type=int, default=4777)
    ap.add_argument("--db", default=None, help="path to db.json (default data/db.json, or $CMC_DB_PATH)")
    ap.add_argument("--page", default=None, help="path to the page to serve (default dashboard.html next to this file)")
    args = ap.parse_args()
    global PAGE
    if args.page:
        PAGE = os.path.abspath(args.page)

    if not os.path.isfile(PAGE):
        log("dashboard.html not found at %s" % PAGE)
        sys.exit(1)

    app = App(args.port, args.db)
    Handler.app = app
    try:
        httpd = Server(("127.0.0.1", args.port), Handler)
    except OSError as e:
        print("Career Mission Control server: port %d is already in use (%s). Nothing to do." % (args.port, e.strerror or e))
        sys.exit(0)

    write_pid(args.port)
    watcher = threading.Thread(target=app.watch_file, name="db-watch", daemon=True)
    watcher.start()

    def shutdown(signum, frame):
        log("signal %d, shutting down" % signum)
        app.stop.set()
        threading.Thread(target=httpd.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    log("serving http://127.0.0.1:%d/  db=%s  docs=%d rev=%d" % (args.port, app.store.path, app.store.count(), app.store.rev))
    try:
        httpd.serve_forever(poll_interval=0.5)
    finally:
        app.stop.set()
        httpd.server_close()
        remove_pid(args.port)
        log("stopped")


if __name__ == "__main__":
    main()
