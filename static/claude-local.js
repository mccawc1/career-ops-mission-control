/* Career Mission Control: local window.claude shim.
 *
 * Injected by server.py right after <body> so the dashboard finds
 * window.claude.use('db') and goes Live against the local JSON store
 * (data/db.json) through the /api routes. Implements the db contract the
 * page was written against: doc/collection refs, get/set/update/delete,
 * where/orderBy/limit queries, onSnapshot with docChanges(), add(), and
 * client-minted ids. Live updates ride one EventSource on /api/events.
 */
(function () {
  'use strict';
  if (window.claude && typeof window.claude.use === 'function') return;

  var API = '/api';
  var SEG_RE = /^[A-Za-z0-9_\-.~:@+]+$/;
  var META = { fromCache: false, hasPendingWrites: false };

  /* ---------------- helpers ---------------------------------------------- */
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function byteLen(s) { try { return new TextEncoder().encode(s).length; } catch (e) { return s.length; } }
  function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function dbError(code, message) { return { code: code, message: String(message || code) }; }
  function mintId() {
    var s = '';
    while (s.length < 20) s += Math.random().toString(36).slice(2);
    return s.slice(0, 20);
  }

  function splitPath(path) {
    if (typeof path !== 'string' || path === '') throw new TypeError('db path must be a non-empty string');
    if (byteLen(path) > 1000) throw new TypeError('db path is longer than 1000 bytes');
    var segs = path.split('/');
    if (segs.length > 16) throw new TypeError('db path has more than 16 segments');
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s === '' || s === '.' || s === '..') throw new TypeError('db path segment "' + s + '" is not allowed');
      if (!SEG_RE.test(s)) throw new TypeError('db path segment "' + s + '" has characters outside [A-Za-z0-9_-.~:@+]');
      if (byteLen(s) > 200) throw new TypeError('db path segment is longer than 200 bytes');
    }
    return segs;
  }
  function docPath(path) {
    var segs = splitPath(path);
    if (segs.length % 2 !== 0) throw new TypeError('a document path needs an even number of segments, got ' + segs.length + ' ("' + path + '")');
    return segs;
  }
  function colPath(path) {
    var segs = splitPath(path);
    if (segs.length % 2 !== 1) throw new TypeError('a collection path needs an odd number of segments, got ' + segs.length + ' ("' + path + '")');
    return segs;
  }
  function encodePath(path) { return path.split('/').map(encodeURIComponent).join('/'); }

  /* ---------------- transport -------------------------------------------- */
  function request(method, url, body) {
    var opts = { method: method, headers: {}, cache: 'no-store' };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (res) {
      return res.text().then(function (text) {
        var obj = null;
        try { obj = text ? JSON.parse(text) : null; } catch (e) { obj = null; }
        if (res.ok) return obj;
        if (obj && obj.error && obj.error.code) throw dbError(obj.error.code, obj.error.message);
        throw dbError(res.status >= 500 ? 'unavailable' : 'invalid_argument', 'HTTP ' + res.status);
      });
    }, function (e) {
      throw dbError('unavailable', 'network: ' + (e && e.message ? e.message : e));
    });
  }
  function fetchDoc(path) { return request('GET', API + '/docs/' + encodePath(path)); }
  function fetchCollection(path) { return request('GET', API + '/collections/' + encodePath(path)); }

  /* ---------------- snapshots -------------------------------------------- */
  function docSnapshot(id, exists, data) {
    var body = exists ? data : undefined;
    return {
      id: id,
      exists: !!exists,
      data: function () { return exists ? clone(body) : undefined; },
      metadata: { fromCache: false, hasPendingWrites: false },
      _raw: exists ? JSON.stringify(body) : null
    };
  }
  function querySnapshot(docs, changes) {
    return {
      docs: docs,
      size: docs.length,
      empty: docs.length === 0,
      docChanges: function () { return changes.slice(); },
      metadata: { fromCache: false, hasPendingWrites: false }
    };
  }
  function sameDocs(prev, next) {
    if (!prev || prev.length !== next.length) return false;
    for (var i = 0; i < next.length; i++) {
      if (prev[i].id !== next[i].id || prev[i].exists !== next[i].exists || prev[i]._raw !== next[i]._raw) return false;
    }
    return true;
  }
  function diffDocs(prev, next) {
    var changes = [];
    var prevIdx = {}, nextIdx = {};
    var i;
    if (!prev) {
      for (i = 0; i < next.length; i++) changes.push({ type: 'added', doc: next[i], oldIndex: -1, newIndex: i });
      return changes;
    }
    for (i = 0; i < prev.length; i++) prevIdx[prev[i].id] = i;
    for (i = 0; i < next.length; i++) nextIdx[next[i].id] = i;
    for (i = 0; i < prev.length; i++) {
      if (!(prev[i].id in nextIdx)) changes.push({ type: 'removed', doc: prev[i], oldIndex: i, newIndex: -1 });
    }
    for (i = 0; i < next.length; i++) {
      var id = next[i].id;
      if (!(id in prevIdx)) {
        changes.push({ type: 'added', doc: next[i], oldIndex: -1, newIndex: i });
      } else {
        var oi = prevIdx[id];
        /* only a body change is a modification; a document that merely
           shifted position because a neighbor was added or removed is not
           reported, matching the Firestore-style contract */
        if (prev[oi]._raw !== next[i]._raw) {
          changes.push({ type: 'modified', doc: next[i], oldIndex: oi, newIndex: i });
        }
      }
    }
    return changes;
  }

  /* ---------------- subscriptions + live feed ---------------------------- */
  var subs = {};
  var subSeq = 0;
  var source = null;
  var refreshTimer = null;

  /* Headless Chrome (used for automated checks) pauses its virtual clock
     while a network request is pending, and an EventSource is pending
     forever, so there we poll the rev instead. Real browsers get one
     EventSource. */
  var HEADLESS = /HeadlessChrome/.test(navigator.userAgent || '');
  var pollTimer = null;
  var lastRev = null;
  function pollOnce() {
    fetch('/_cmc/health', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (h) {
      if (h && typeof h.rev === 'number' && h.rev !== lastRev) {
        var first = lastRev === null;
        lastRev = h.rev;
        if (!first) scheduleRefreshAll();
      }
    }).catch(function () { /* transient */ });
  }
  function openFeed() {
    if (source) return;
    if (HEADLESS || typeof EventSource !== 'function') {
      if (!pollTimer) { pollOnce(); pollTimer = setInterval(pollOnce, 1500); }
      source = { polling: true };
      return;
    }
    try {
      source = new EventSource(API + '/events');
    } catch (e) { source = null; return; }
    source.addEventListener('change', function () { scheduleRefreshAll(); });
    /* the page source or this shim changed on disk (a rebuild): reload so
       the edit shows up live; the theme pick survives in localStorage */
    source.addEventListener('reload', function () { try { location.reload(); } catch (e) {} });
    source.addEventListener('hello', function () { scheduleRefreshAll(); });
    source.onerror = function () { /* EventSource reconnects on its own; not terminal */ };
  }
  function scheduleRefreshAll() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(function () {
      refreshTimer = null;
      for (var k in subs) if (Object.prototype.hasOwnProperty.call(subs, k)) subs[k].refresh();
    }, 20);
  }
  function subscribe(load, next, error) {
    var id = ++subSeq;
    var alive = true;
    var running = false;
    var again = false;
    var prev = null;
    var entry = {
      refresh: function () {
        if (!alive) return;
        if (running) { again = true; return; }
        running = true;
        Promise.resolve().then(load).then(function (result) {
          running = false;
          if (!alive) return;
          /* deliver the first snapshot always, later ones only when
             something changed (a poll or a reconnect must not cause a
             no-op delivery and a needless re-render) */
          var changed = !sameDocs(prev, result.docs);
          var snap = result.build(prev);
          prev = result.docs;
          if (changed) {
            try { next(snap); } catch (e) { console.error('CMC db: snapshot callback threw', e); }
          }
          if (again) { again = false; entry.refresh(); }
        }, function (e) {
          running = false;
          if (!alive) return;
          if (e && e.code === 'invalid_argument') {
            alive = false;
            delete subs[id];
            if (typeof error === 'function') error(e);
            return;
          }
          /* transient: keep the listener, the next change event retries */
          if (again) { again = false; entry.refresh(); }
        });
      }
    };
    subs[id] = entry;
    openFeed();
    Promise.resolve().then(entry.refresh);
    return function unsubscribe() {
      alive = false;
      delete subs[id];
    };
  }
  function afterWrite(p) {
    return p.then(function (r) { scheduleRefreshAll(); return r; });
  }

  /* ---------------- query evaluation ------------------------------------- */
  var OPS = { '==': 1, '!=': 1, '<': 1, '<=': 1, '>': 1, '>=': 1, 'in': 1, 'not-in': 1, 'array-contains': 1 };
  function typeRank(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'boolean') return 1;
    if (typeof v === 'number') return 2;
    if (typeof v === 'string') return 3;
    if (Array.isArray(v)) return 4;
    return 5;
  }
  function cmp(a, b) {
    var ra = typeRank(a), rb = typeRank(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    if (ra === 2 || ra === 1) return a < b ? -1 : (a > b ? 1 : 0);
    if (ra === 3) return a < b ? -1 : (a > b ? 1 : 0);
    var sa = JSON.stringify(a), sb = JSON.stringify(b);
    return sa < sb ? -1 : (sa > sb ? 1 : 0);
  }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function matches(data, f) {
    var has = Object.prototype.hasOwnProperty.call(data, f.field);
    var v = has ? data[f.field] : undefined;
    switch (f.op) {
      case '==': return has && same(v, f.value);
      case '!=': return has && !same(v, f.value);
      case '<': return has && typeRank(v) === typeRank(f.value) && typeRank(v) > 0 && cmp(v, f.value) < 0;
      case '<=': return has && typeRank(v) === typeRank(f.value) && typeRank(v) > 0 && cmp(v, f.value) <= 0;
      case '>': return has && typeRank(v) === typeRank(f.value) && typeRank(v) > 0 && cmp(v, f.value) > 0;
      case '>=': return has && typeRank(v) === typeRank(f.value) && typeRank(v) > 0 && cmp(v, f.value) >= 0;
      case 'in': return has && Array.isArray(f.value) && f.value.some(function (x) { return same(x, v); });
      case 'not-in': return has && Array.isArray(f.value) && !f.value.some(function (x) { return same(x, v); });
      case 'array-contains': return has && Array.isArray(v) && v.some(function (x) { return same(x, f.value); });
    }
    return false;
  }
  function evaluate(rows, q) {
    var docs = [];
    for (var i = 0; i < rows.length; i++) {
      var data = rows[i].data || {};
      var ok = true;
      for (var j = 0; j < q.filters.length; j++) if (!matches(data, q.filters[j])) { ok = false; break; }
      if (ok) docs.push({ id: rows[i].id, data: data });
    }
    if (q.order) {
      var field = q.order.field, dir = q.order.dir === 'desc' ? -1 : 1;
      docs.sort(function (a, b) {
        var ha = Object.prototype.hasOwnProperty.call(a.data, field) && a.data[field] !== undefined;
        var hb = Object.prototype.hasOwnProperty.call(b.data, field) && b.data[field] !== undefined;
        if (ha !== hb) return ha ? -1 : 1;  /* missing fields last, either direction */
        var c = ha ? cmp(a.data[field], b.data[field]) * dir : 0;
        if (c !== 0) return c;
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
      });
    } else {
      docs.sort(function (a, b) { return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); });
    }
    if (q.lim !== null) docs = docs.slice(0, q.lim);
    return docs.map(function (d) { return docSnapshot(d.id, true, d.data); });
  }
  function validateQuery(q) {
    if (q.filters.length > 10) return dbError('invalid_argument', 'a query takes at most 10 where() filters');
    for (var i = 0; i < q.filters.length; i++) {
      var f = q.filters[i];
      if (typeof f.field !== 'string' || !f.field) return dbError('invalid_argument', 'where() field must be a non-empty string');
      if (!OPS[f.op]) return dbError('invalid_argument', 'where() operator "' + f.op + '" is not supported');
      if ((f.op === 'in' || f.op === 'not-in') && (!Array.isArray(f.value) || f.value.length > 30)) {
        return dbError('invalid_argument', f.op + ' takes an array of at most 30 values');
      }
    }
    if (q.lim !== null && (typeof q.lim !== 'number' || q.lim < 1 || q.lim > 1000 || q.lim !== Math.floor(q.lim))) {
      return dbError('invalid_argument', 'limit() must be an integer from 1 to 1000');
    }
    return null;
  }
  function runQuery(q) {
    var bad = validateQuery(q);
    if (bad) return Promise.reject(bad);
    return fetchCollection(q.path).then(function (res) {
      var docs = evaluate(res && res.docs ? res.docs : [], q);
      return {
        docs: docs,
        build: function (prev) { return querySnapshot(docs, diffDocs(prev, docs)); }
      };
    });
  }

  function makeQuery(path, filters, order, lim) {
    var q = { path: path, filters: filters, order: order, lim: lim };
    var api = {
      where: function (field, op, value) {
        return makeQuery(path, filters.concat([{ field: field, op: op, value: clone(value === undefined ? null : value) }]), order, lim);
      },
      orderBy: function (field, dir) {
        if (typeof field !== 'string' || !field) throw new TypeError('orderBy() field must be a non-empty string');
        return makeQuery(path, filters, { field: field, dir: dir === 'desc' ? 'desc' : 'asc' }, lim);
      },
      limit: function (n) { return makeQuery(path, filters, order, n); },
      get: function () { return runQuery(q).then(function (r) { return r.build(null); }); },
      onSnapshot: function (next, error) {
        if (typeof next !== 'function') throw new TypeError('onSnapshot() needs a next callback');
        return subscribe(function () { return runQuery(q); }, next, error);
      }
    };
    return api;
  }

  /* ---------------- refs ------------------------------------------------- */
  function validateBody(data, what) {
    if (!isPlainObject(data)) return dbError('invalid_argument', what + ' body must be a plain JSON object');
    var text;
    try { text = JSON.stringify(data); } catch (e) { return dbError('invalid_argument', what + ' body is not JSON-serializable'); }
    if (text === undefined || byteLen(text) > 256 * 1024) return dbError('invalid_argument', what + ' body is over 256 KiB');
    return null;
  }

  function makeDocRef(path) {
    var segs = docPath(path);
    var ref = {
      id: segs[segs.length - 1],
      path: path,
      get: function () {
        return fetchDoc(path).then(function (r) { return docSnapshot(ref.id, !!(r && r.exists), r ? r.data : undefined); });
      },
      set: function (data) {
        var bad = validateBody(data, 'set()');
        if (bad) return Promise.reject(bad);
        return afterWrite(request('PUT', API + '/docs/' + encodePath(path), data)).then(function () { return undefined; });
      },
      update: function (data) {
        var bad = validateBody(data, 'update()');
        if (bad) return Promise.reject(bad);
        return afterWrite(request('PATCH', API + '/docs/' + encodePath(path), data)).then(function () { return undefined; });
      },
      'delete': function () {
        return afterWrite(request('DELETE', API + '/docs/' + encodePath(path))).then(function () { return undefined; });
      },
      acquire: function (options) {
        /* cooperative lease kept in the document body under _lease */
        var holder = options && options.holder;
        if (typeof holder !== 'string' || !holder) return Promise.reject(dbError('invalid_argument', 'acquire() needs a holder string'));
        var ttl = options && typeof options.ttlMs === 'number' && options.ttlMs > 0 ? options.ttlMs : 30000;
        ttl = Math.max(1000, Math.min(600000, ttl));
        return fetchDoc(path).then(function (r) {
          var body = (r && r.exists && isPlainObject(r.data)) ? r.data : {};
          var lease = isPlainObject(body._lease) ? body._lease : null;
          var now = Date.now();
          if (lease && lease.holder !== holder && lease.expiresAt && Date.parse(lease.expiresAt) > now) {
            return { acquired: false, expiresAt: lease.expiresAt };
          }
          var expiresAt = new Date(now + ttl).toISOString();
          var merged = clone(body);
          if (options && isPlainObject(options.data)) {
            for (var k in options.data) if (Object.prototype.hasOwnProperty.call(options.data, k)) merged[k] = clone(options.data[k]);
          }
          merged._lease = { holder: holder, expiresAt: expiresAt };
          return afterWrite(request('PUT', API + '/docs/' + encodePath(path), merged)).then(function (res) {
            return { acquired: true, version: res && res.version, expiresAt: expiresAt, holder: holder };
          });
        });
      },
      onSnapshot: function (next, error) {
        if (typeof next !== 'function') throw new TypeError('onSnapshot() needs a next callback');
        return subscribe(function () {
          return fetchDoc(path).then(function (r) {
            var snap = docSnapshot(ref.id, !!(r && r.exists), r ? r.data : undefined);
            return { docs: [snap], build: function () { return snap; } };
          });
        }, next, error);
      },
      collection: function (sub) {
        if (typeof sub !== 'string') throw new TypeError('collection() needs a path string');
        return makeCollectionRef(path + '/' + sub);
      }
    };
    return ref;
  }

  function makeCollectionRef(path) {
    colPath(path);
    var q = makeQuery(path, [], null, null);
    q.path = path;
    q.doc = function (id) {
      if (id === undefined || id === null || id === '') id = mintId();
      if (typeof id !== 'string') throw new TypeError('doc() id must be a string');
      return makeDocRef(path + '/' + id);
    };
    q.add = function (data) {
      var ref;
      try { ref = q.doc(); } catch (e) { return Promise.reject(e); }
      return ref.set(data).then(function () { return ref; });
    };
    return q;
  }

  var db = Object.freeze({
    doc: function (path) { return makeDocRef(path); },
    collection: function (path) { return makeCollectionRef(path); }
  });

  /* ---------------- window.claude ---------------------------------------- */
  var dbPromise = null;
  window.claude = {
    use: function (name) {
      if (name === 'db') {
        if (!dbPromise) dbPromise = Promise.resolve().then(function () { openFeed(); return db; });
        return dbPromise;
      }
      return Promise.resolve().then(function () { return null; });
    }
  };
  window.__cmcLocal = { version: 1, headless: HEADLESS, subscriptions: function () { return Object.keys(subs).length; } };
})();
