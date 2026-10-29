#!/usr/bin/env python3
"""cmc.py: command line for the Career Mission Control database.

Edits data/db.json directly (no server needed). Every write is atomic and
bumps the file's rev, so a running server.py notices within a second and
pushes the change to every open dashboard window.

  python3 cmc.py help
  python3 cmc.py --db /path/to/db.json list applications

Environment: CMC_DB_PATH overrides the default data/db.json path.
"""

import argparse
import datetime
import json
import os
import random
import re
import string
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cmcdb import DbError, Store, collection_segments, doc_segments  # noqa: E402

STATUSES = ["Evaluated", "Applied", "Responded", "Interview", "Offer", "Rejected", "Discarded", "Hired", "queued"]
QUEUE_STATES = ["requested", "prepping", "ready", "approved", "submitted"]
ACTIVITY_KINDS = ["system", "scan", "found", "applied", "queue", "interview", "offer", "win"]
# The ten collections the page subscribes to, in the same order as COLLECTIONS
# in pieces/foundation.js. wipe-sample sweeps every one of them. The two single
# documents (profile/main, meta/state) are never sample data and are left alone.
COLLECTIONS = ["applications", "queue", "platforms", "activity", "goals", "targeting",
               "interview", "tasks", "interviews", "inbox"]
# goals are the six weekly counters: a wipe keeps the rows and zeroes "done"
# instead of deleting them, so The target panel never goes empty.
KEEP_ON_WIPE = ["goals"]

HELP = """cmc.py: Career Mission Control database CLI

Usage: python3 cmc.py [--db PATH] <command> [args]

Data commands
  import <snapshot dir>              seed or merge from <collection>/<id>.json files
  export <dir>                       write every document as <collection>/<id>.json
  list <collection> [--json]         list a collection (table, or JSON with --json)
  get <doc path>                     print one document as JSON
  set <doc path> (--json '{}' | --file f.json)      create or replace a document
  update <doc path> (--json '{}' | --file f.json)   merge into an existing document
  delete <doc path>                  delete a document (no error if missing)

Board commands
  log "<text>" [--kind KIND]         add a Mission Log row (kinds: %(kinds)s)
  app add --company X --role Y --url U [options]   add a job to the board (options below)
  app status <id> <Status>           one of: %(statuses)s
                                     (also retires the app's live Apply queue doc, see below)
  queue add <app id> [--note "..."]  request an application prep (mirrors the Apply button)
  queue set <queue id> <state> [--note "..."]   state: %(qstates)s
  goal set <id> <done>               set a goal's done count
  goal reset                         set every goal's done count to 0
  meta sync-now                      stamp meta/state.lastSync with the current time
  wipe-sample                        clear sample data from all %(ncols)d collections (details below)
  help                               this text

Options for app add
  --score 4.5  --pay "..."  --location "..."  --platform "..."  --notes "..."
  --status Evaluated  --id custom-id  --replace (overwrite an existing id)

What app status does to the Apply queue
  The page's status move and this command agree: an application that leaves
  the queue takes its prep request with it. Applied marks the live queue doc
  (requested, prepping, ready or approved) submitted; any other status
  deletes it; queued leaves it alone. The JSON reply carries a "queue" block:
  "retired" lists each doc touched ({id, from, to}) and "note" is the phrase
  to append to a Mission Log line ("Pulled it from the Apply queue." when a
  doc was deleted, "" otherwise). The log line itself is the caller's:
    python3 cmc.py log "Acme Co moved to Rejected. Pulled it from the Apply queue."

What wipe-sample does
  Sweeps %(cols)s.
  Every row marked sample:true is deleted, except goals: goal rows stay, their
  done count goes to 0 and their sample flag is cleared. Then meta/state.sampleMode
  is set to false. profile/main and meta/state are never deleted.

Examples
  python3 cmc.py import "source/livedb-snapshot-2026-10-10"
  python3 cmc.py list applications
  python3 cmc.py app add --company "Jobber" --role "Onboarding Specialist" --url https://example.com/job --score 4.2
  python3 cmc.py queue set q-jobber-onboarding-specialist ready --note "Draft is ready for review"
  python3 cmc.py log "Scanned 34 boards, 2 new matches." --kind scan
  python3 cmc.py --db /path/to/copy.json wipe-sample
""" % {"kinds": "|".join(ACTIVITY_KINDS), "statuses": ", ".join(STATUSES), "qstates": "|".join(QUEUE_STATES),
       "ncols": len(COLLECTIONS), "cols": ", ".join(COLLECTIONS)}


def now_iso():
    t = datetime.datetime.now(datetime.timezone.utc)
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (t.microsecond // 1000)


def out(obj):
    print(json.dumps(obj, indent=2, ensure_ascii=False, sort_keys=True))


def fail(msg, code=1):
    sys.stderr.write("cmc: %s\n" % msg)
    sys.exit(code)


def slugify(text, max_len=40):
    s = re.sub(r"[^a-z0-9]+", "-", str(text).lower())
    s = re.sub(r"-+", "-", s).strip("-")
    if len(s) > max_len:
        s = s[:max_len].rstrip("-")
    return s or "item"


def rand36(n):
    alphabet = string.digits + string.ascii_lowercase
    return "".join(random.choice(alphabet) for _ in range(n))


def next_activity_id(ops):
    best = 0
    for aid, _ in ops.children("activity"):
        m = re.match(r"^a(\d+)", aid)
        if m:
            best = max(best, int(m.group(1)))
    return "a%05d-%s" % (best + 1, rand36(4))


def read_body(args):
    if getattr(args, "json", None) is not None:
        raw = args.json
    elif getattr(args, "file", None):
        try:
            with open(args.file, "r", encoding="utf-8") as f:
                raw = f.read()
        except OSError as e:
            fail("cannot read %s: %s" % (args.file, e.strerror or e))
    else:
        fail("give the body with --json '{...}' or --file path.json")
    try:
        obj = json.loads(raw)
    except ValueError as e:
        fail("body is not valid JSON: %s" % e)
    if not isinstance(obj, dict):
        fail("body must be a JSON object")
    # `get` prints the document id inside the body for convenience; do not
    # store it back when someone pipes that output into set/update
    doc_id = getattr(args, "path", "").split("/")[-1]
    if obj.get("id") == doc_id:
        obj = dict(obj)
        del obj["id"]
    return obj


# ----- commands ----------------------------------------------------------------
def cmd_import(store, args):
    root = os.path.abspath(args.dir)
    if not os.path.isdir(root):
        fail("not a directory: %s" % root)
    files = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for fn in sorted(filenames):
            if fn.endswith(".json"):
                files.append(os.path.join(dirpath, fn))
    if not files:
        fail("no .json files under %s" % root)
    loaded = []
    for full in files:
        rel = os.path.relpath(full, root)
        path = rel[:-5].replace(os.sep, "/")
        try:
            doc_segments(path)
        except DbError as e:
            fail("%s: %s" % (rel, e.message))
        with open(full, "r", encoding="utf-8") as f:
            try:
                body = json.load(f)
            except ValueError as e:
                fail("%s: invalid JSON: %s" % (rel, e))
        if not isinstance(body, dict):
            fail("%s: document body must be a JSON object" % rel)
        loaded.append((path, body))

    def fn(ops):
        created = updated = 0
        for path, body in loaded:
            existed = ops.get(path) is not None
            ops.set(path, body)
            if existed:
                updated += 1
            else:
                created += 1
        return {"created": created, "updated": updated}

    rev, res = store.batch(fn)
    res.update({"rev": rev, "docs": store.count(), "db": store.path})
    out(res)


def cmd_export(store, args):
    root = os.path.abspath(args.dir)
    docs = store.all_docs()
    n = 0
    for path, entry in sorted(docs.items()):
        full = os.path.join(root, *path.split("/")) + ".json"
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as f:
            json.dump(entry.get("data", {}), f, indent=2, ensure_ascii=False, sort_keys=True)
            f.write("\n")
        n += 1
    out({"exported": n, "dir": root})


def cmd_list(store, args):
    try:
        collection_segments(args.collection)
    except DbError as e:
        fail(e.message)
    docs = store.list_collection(args.collection)
    if args.json:
        out([dict(d["data"], id=d["id"]) for d in docs])
        return
    if not docs:
        print("(no documents in %s)" % args.collection)
        return
    col = args.collection.split("/")[0]
    cols = {
        "applications": ["id", "company", "role", "score", "status"],
        "queue": ["id", "appId", "state", "updatedAt"],
        "platforms": ["id", "name", "group", "health", "enabled"],
        "activity": ["id", "ts", "kind", "text"],
        "goals": ["id", "goal", "done", "target", "period"],
        "targeting": ["id", "name", "isDefault", "updatedAt", "sample"],
        "interview": ["id", "order", "group", "status", "question"],
        "tasks": ["id", "kind", "state", "priority", "title"],
        "interviews": ["id", "company", "round", "format", "date", "time"],
        "inbox": ["id", "company", "role", "lane", "state", "source"],
    }.get(col)
    if not cols:
        keys = []
        for d in docs:
            for k in d["data"]:
                if k not in keys:
                    keys.append(k)
        cols = ["id"] + keys[:5]
    rows = []
    for d in docs:
        row = []
        for c in cols:
            v = d["id"] if c == "id" else d["data"].get(c, "")
            v = "" if v is None else str(v)
            if len(v) > 60:
                v = v[:57] + "..."
            row.append(v)
        rows.append(row)
    widths = [max(len(c), max(len(r[i]) for r in rows)) for i, c in enumerate(cols)]
    print("  ".join(c.ljust(widths[i]) for i, c in enumerate(cols)))
    print("  ".join("-" * widths[i] for i in range(len(cols))))
    for r in rows:
        print("  ".join(r[i].ljust(widths[i]) for i in range(len(cols))))
    print("(%d documents)" % len(docs))


def cmd_get(store, args):
    try:
        res = store.get(args.path)
    except DbError as e:
        fail(e.message)
    if not res["exists"]:
        out({"id": res["id"], "exists": False})
        sys.exit(2)
    out(dict(res["data"], id=res["id"]))


def cmd_set(store, args):
    body = read_body(args)
    try:
        rev, version = store.set(args.path, body)
    except DbError as e:
        fail(e.message)
    out({"ok": True, "path": args.path, "version": version, "rev": rev})


def cmd_update(store, args):
    body = read_body(args)
    try:
        rev, version = store.update(args.path, body)
    except DbError as e:
        fail(e.message)
    out({"ok": True, "path": args.path, "version": version, "rev": rev})


def cmd_delete(store, args):
    try:
        rev, existed = store.delete(args.path)
    except DbError as e:
        fail(e.message)
    out({"ok": True, "path": args.path, "existed": existed, "rev": rev})


def cmd_log(store, args):
    kind = args.kind or "system"
    if kind not in ACTIVITY_KINDS:
        fail("kind must be one of: %s" % ", ".join(ACTIVITY_KINDS))
    text = str(args.text).strip()
    if not text:
        fail("log text is empty")

    def fn(ops):
        aid = next_activity_id(ops)
        row = {"ts": now_iso(), "kind": kind, "text": text, "sample": False}
        ops.set("activity/" + aid, row)
        return dict(row, id=aid)

    rev, row = store.batch(fn)
    row["rev"] = rev
    out(row)


def cmd_app_add(store, args):
    status = args.status or "Evaluated"
    if status not in STATUSES:
        fail("status must be one of: %s" % ", ".join(STATUSES))
    app_id = args.id or slugify("%s %s" % (args.company, args.role))
    try:
        doc_segments("applications/" + app_id)
    except DbError as e:
        fail(e.message)
    score = None
    if args.score is not None:
        try:
            score = float(args.score)
        except ValueError:
            fail("score must be a number")
    body = {
        "company": args.company,
        "role": args.role,
        "url": args.url,
        "platform": args.platform or "",
        "score": score,
        "status": status,
        "dateFound": now_iso(),
        "pay": args.pay or "",
        "location": args.location or "",
        "notes": args.notes or "",
        "sample": False,
    }
    if status == "Applied":
        body["dateApplied"] = body["dateFound"]
    existing = store.get("applications/" + app_id)
    if existing["exists"] and not args.replace:
        fail("applications/%s already exists (use --replace to overwrite, or --id for a different id)" % app_id)
    rev, version = store.set("applications/" + app_id, body)
    out(dict(body, id=app_id, version=version, rev=rev))


QUEUE_PULLED_NOTE = "Pulled it from the Apply queue."


def live_queue_docs(ops, app_id):
    """Every queue doc still in flight for this application: queue/q-<id>
    plus any doc whose appId matches, skipping submitted ones (finished).
    Same test the page's CMC.queueFor uses, except that the CLI returns all
    matches so a stray duplicate cannot linger as a stale card."""
    found = []
    for qid, data in ops.children("queue"):
        if not isinstance(data, dict):
            continue
        if (qid == "q-" + app_id or data.get("appId") == app_id) and data.get("state") != "submitted":
            found.append((qid, data))
    return found


def retire_queue(ops, app_id, status, ts):
    """Mirror the page's CMC.act.retireQueue inside a batch. Applied means
    the prep request is done: the doc is marked submitted. queued leaves the
    doc alone (that is the state that owns it). Any other status deletes the
    doc so the Apply queue never shows Claude prepping a job Chris already
    passed on or moved along. Returns {"retired": [...], "note": str}."""
    result = {"retired": [], "note": ""}
    if status == "queued":
        return result
    for qid, data in live_queue_docs(ops, app_id):
        was = data.get("state")
        if status == "Applied":
            ops.update("queue/" + qid, {"state": "submitted", "updatedAt": ts})
            result["retired"].append({"id": qid, "from": was, "to": "submitted"})
        else:
            ops.delete("queue/" + qid)
            result["retired"].append({"id": qid, "from": was, "to": "deleted"})
            result["note"] = QUEUE_PULLED_NOTE
    return result


def cmd_app_status(store, args):
    if args.status not in STATUSES:
        fail("status must be one of: %s" % ", ".join(STATUSES))
    path = "applications/" + args.id
    patch = {"status": args.status, "statusChangedAt": now_iso()}

    def fn(ops):
        cur = ops.get(path)
        if cur is None:
            raise DbError("invalid_argument", "no application with id %r" % args.id)
        if args.status == "Applied" and not cur.get("dateApplied"):
            patch["dateApplied"] = patch["statusChangedAt"]
        ops.update(path, patch)
        # the same batch retires the queue doc, so an open dashboard sees the
        # tracker row and the Apply queue card change in one repaint
        queue = retire_queue(ops, args.id, args.status, patch["statusChangedAt"])
        return ops.get(path), queue

    try:
        rev, (doc, queue) = store.batch(fn)
    except DbError as e:
        fail(e.message)
    out(dict(doc, id=args.id, rev=rev, queue=queue))


def cmd_queue_add(store, args):
    app_path = "applications/" + args.app_id
    q_id = "q-" + args.app_id

    def fn(ops):
        app = ops.get(app_path)
        if app is None:
            raise DbError("invalid_argument", "no application with id %r" % args.app_id)
        ts = now_iso()
        q = {
            "appId": args.app_id,
            "company": app.get("company", ""),
            "role": app.get("role", ""),
            "state": "requested",
            "requestedAt": ts,
            "updatedAt": ts,
            "note": args.note or "",
            "sample": bool(app.get("sample", False)),
        }
        # a live doc (requested through approved) keeps Chris's progress; a
        # missing or finished (submitted) one gets a fresh request, as the
        # page's Apply button does, so the app never sits at queued with no
        # live card in the Apply queue
        existing = ops.get("queue/" + q_id)
        if existing is None or existing.get("state") == "submitted":
            ops.set("queue/" + q_id, q)
        ops.update(app_path, {"status": "queued"})
        return dict(ops.get("queue/" + q_id), id=q_id)

    try:
        rev, q = store.batch(fn)
    except DbError as e:
        fail(e.message)
    q["rev"] = rev
    out(q)


def cmd_queue_set(store, args):
    if args.state not in QUEUE_STATES:
        fail("state must be one of: %s" % ", ".join(QUEUE_STATES))
    path = "queue/" + args.queue_id
    patch = {"state": args.state, "updatedAt": now_iso()}
    if args.note is not None:
        patch["note"] = args.note
    try:
        rev, version = store.update(path, patch)
    except DbError as e:
        fail(e.message)
    doc = store.get(path)
    out(dict(doc["data"], id=args.queue_id, rev=rev))


def cmd_goal_set(store, args):
    try:
        done = int(args.done)
    except ValueError:
        fail("done must be a whole number")
    if done < 0:
        fail("done cannot be negative")
    try:
        rev, version = store.update("goals/" + args.id, {"done": done})
    except DbError as e:
        fail(e.message)
    out({"ok": True, "id": args.id, "done": done, "rev": rev})


def cmd_goal_reset(store, args):
    def fn(ops):
        n = 0
        for gid, _ in ops.children("goals"):
            ops.update("goals/" + gid, {"done": 0})
            n += 1
        return n

    rev, n = store.batch(fn)
    out({"ok": True, "reset": n, "rev": rev})


def cmd_meta_sync_now(store, args):
    ts = now_iso()

    def fn(ops):
        if ops.get("meta/state") is None:
            ops.set("meta/state", {"buildVersion": "v1", "lastSync": ts, "sampleMode": False})
        else:
            ops.update("meta/state", {"lastSync": ts})
        return ops.get("meta/state")

    rev, doc = store.batch(fn)
    out(dict(doc, rev=rev))


def cmd_wipe_sample(store, args):
    """Mirror the page's "Clear sample data" button across all ten collections.

    Rows marked sample:true are deleted. Goal rows are the exception: they are
    the six weekly counters, so they stay, "done" goes back to 0 and the sample
    flag is cleared. Finally meta/state.sampleMode is set to false. One batch,
    one rev bump, so an open dashboard repaints once.
    """
    def fn(ops):
        doomed = []
        kept = []
        for col in COLLECTIONS:
            for did, data in ops.children(col):
                if not isinstance(data, dict):
                    continue
                path = col + "/" + did
                if col in KEEP_ON_WIPE:
                    patch = {}
                    if data.get("done") != 0:
                        patch["done"] = 0
                    if data.get("sample") is True:
                        patch["sample"] = False
                    if patch:
                        ops.update(path, patch)
                        kept.append(path)
                elif data.get("sample") is True:
                    doomed.append(path)
        for p in doomed:
            ops.delete(p)
        if ops.get("meta/state") is None:
            ops.set("meta/state", {"buildVersion": "v1", "sampleMode": False})
        else:
            ops.update("meta/state", {"sampleMode": False})
        return doomed, kept

    rev, (doomed, kept) = store.batch(fn)
    out({"ok": True, "collections": COLLECTIONS, "deleted": len(doomed), "paths": doomed,
         "goalsReset": len(kept), "goalPaths": kept, "sampleMode": False, "rev": rev,
         "docs": store.count()})


# ----- argument parsing --------------------------------------------------------
def build_parser():
    p = argparse.ArgumentParser(prog="cmc.py", add_help=False)
    p.add_argument("--db", default=None)
    sub = p.add_subparsers(dest="cmd")

    s = sub.add_parser("import"); s.add_argument("dir")
    s = sub.add_parser("export"); s.add_argument("dir")
    s = sub.add_parser("list"); s.add_argument("collection"); s.add_argument("--json", action="store_true")
    s = sub.add_parser("get"); s.add_argument("path")
    for name in ("set", "update"):
        s = sub.add_parser(name); s.add_argument("path")
        s.add_argument("--json", dest="json", default=None); s.add_argument("--file", default=None)
    s = sub.add_parser("delete"); s.add_argument("path")
    s = sub.add_parser("log"); s.add_argument("text"); s.add_argument("--kind", default="system")

    app = sub.add_parser("app"); appsub = app.add_subparsers(dest="sub")
    s = appsub.add_parser("add")
    s.add_argument("--company", required=True); s.add_argument("--role", required=True); s.add_argument("--url", required=True)
    s.add_argument("--score", default=None); s.add_argument("--pay", default=None); s.add_argument("--location", default=None)
    s.add_argument("--platform", default=None); s.add_argument("--notes", default=None); s.add_argument("--status", default=None)
    s.add_argument("--id", default=None); s.add_argument("--replace", action="store_true")
    s = appsub.add_parser("status"); s.add_argument("id"); s.add_argument("status")

    q = sub.add_parser("queue"); qsub = q.add_subparsers(dest="sub")
    s = qsub.add_parser("add"); s.add_argument("app_id"); s.add_argument("--note", default=None)
    s = qsub.add_parser("set"); s.add_argument("queue_id"); s.add_argument("state"); s.add_argument("--note", default=None)

    g = sub.add_parser("goal"); gsub = g.add_subparsers(dest="sub")
    s = gsub.add_parser("set"); s.add_argument("id"); s.add_argument("done")
    gsub.add_parser("reset")

    m = sub.add_parser("meta"); msub = m.add_subparsers(dest="sub")
    msub.add_parser("sync-now")

    sub.add_parser("wipe-sample")
    sub.add_parser("help")
    return p


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("help", "-h", "--help") or "--help" in argv or "-h" in argv:
        print(HELP)
        return 0
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit:
        return 2
    if not args.cmd:
        print(HELP)
        return 0
    store = Store(args.db)
    table = {
        "import": cmd_import, "export": cmd_export, "list": cmd_list, "get": cmd_get,
        "set": cmd_set, "update": cmd_update, "delete": cmd_delete, "log": cmd_log,
        "wipe-sample": cmd_wipe_sample,
        ("app", "add"): cmd_app_add, ("app", "status"): cmd_app_status,
        ("queue", "add"): cmd_queue_add, ("queue", "set"): cmd_queue_set,
        ("goal", "set"): cmd_goal_set, ("goal", "reset"): cmd_goal_reset,
        ("meta", "sync-now"): cmd_meta_sync_now,
    }
    key = args.cmd if args.cmd in table else (args.cmd, getattr(args, "sub", None))
    fn = table.get(key)
    if fn is None:
        sys.stderr.write("cmc: '%s' needs a subcommand\n\n" % args.cmd)
        print(HELP)
        return 2
    try:
        fn(store, args)
    except DbError as e:
        fail("%s: %s" % (e.code, e.message))
    return 0


if __name__ == "__main__":
    sys.exit(main())
