/* Career Mission Control - foundation: CMC namespace, theme engine, data
   layer, chrome wiring, boot. Pieces read CMC.state and call CMC.act.*. */
(function () {
  'use strict';

  var THEME_KEY = 'cmc-theme';
  var THEMES = ['t-dark-ops', 't-light-pro', 't-bold', 't-green'];
  var PANEL_ORDER = ['targeting', 'kpis', 'needs-you', 'jobs-queue', 'know-you', 'mail', 'pipeline', 'tracker', 'inbox', 'calendar', 'platforms', 'activity', 'career-path', 'drawer'];
  var COLLECTIONS = ['applications', 'queue', 'platforms', 'activity', 'goals', 'targeting', 'interview', 'tasks', 'interviews', 'inbox', 'mail'];

  /* ---------------- element builder (XSS-safe: strings become text) ------ */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'dataset') { for (var dk in v) el.dataset[dk] = v[dk]; }
        else if (k === 'style' && typeof v === 'object') { for (var sk in v) el.style.setProperty(sk, v[sk]); }
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, String(v));
      }
    }
    for (var i = 2; i < arguments.length; i++) appendKid(el, arguments[i]);
    return el;
  }
  function appendKid(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { for (var i = 0; i < kid.length; i++) appendKid(el, kid[i]); return; }
    if (kid instanceof Node) { el.appendChild(kid); return; }
    el.appendChild(document.createTextNode(String(kid)));
  }

  /* ---------------- formatters ------------------------------------------- */
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function toDate(iso) { var t = new Date(iso); return isNaN(t.getTime()) ? null : t; }
  var fmt = {
    date: function (iso) {
      var t = toDate(iso); if (!t) return '';
      var s = MONTHS[t.getMonth()] + ' ' + t.getDate();
      if (t.getFullYear() !== new Date().getFullYear()) s += ', ' + t.getFullYear();
      return s;
    },
    time: function (iso) {
      var t = toDate(iso); if (!t) return '';
      var hr = t.getHours() % 12 || 12;
      var mn = t.getMinutes();
      return hr + ':' + (mn < 10 ? '0' : '') + mn + (t.getHours() < 12 ? 'a' : 'p');
    },
    money: function (n) {
      if (typeof n !== 'number' || isNaN(n)) return n ? String(n) : '';
      if (n >= 1000) return '$' + Math.round(n / 1000) + 'K';
      return '$' + Math.round(n);
    },
    ago: function (iso) {
      var t = toDate(iso); if (!t) return '';
      var s = Math.round((Date.now() - t.getTime()) / 1000);
      if (s < 60) return 'just now';
      var m = Math.round(s / 60); if (m < 60) return m + 'm ago';
      var hr = Math.round(m / 60); if (hr < 24) return hr + 'h ago';
      var d = Math.round(hr / 24); if (d < 7) return d + 'd ago';
      var w = Math.round(d / 7); if (w < 5) return w + 'w ago';
      return fmt.date(iso);
    },
    scan: function (iso) {
      var t = toDate(iso); if (!t) return '';
      var now = new Date();
      var day = function (x) { return x.getFullYear() + '-' + x.getMonth() + '-' + x.getDate(); };
      var yd = new Date(now.getTime() - 864e5);
      if (day(t) === day(now)) return 'today ' + fmt.time(iso);
      if (day(t) === day(yd)) return 'yesterday ' + fmt.time(iso);
      return fmt.date(iso);
    },
  };

  /* Hardening: db-stored strings only become links when they are real
     web addresses. A doc written by another tool could carry anything
     (javascript: included); anything that is not http(s) renders as
     plain text instead of an <a href>. The one exception is a file stored
     with this page itself (an artifact asset): its address comes back as
     /_blob/ plus 32 hex characters, and only that exact shape is allowed. */
  function safeUrl(u) {
    var s = String(u || '').trim();
    if (/^https?:\/\//i.test(s)) return s;
    return /^\/_blob\/[0-9a-f]{32}$/.test(s) ? s : '';
  }

  /* status grammar: one mapping used by every panel.
     Returns good | info | warn | ivl | bad | idle for any known status,
     queue state, or platform health string. */
  function statusKind(s) {
    switch (String(s)) {
      case 'Applied': case 'Offer': case 'Hired': return 'good';
      case 'Evaluated': case 'found': case 'queued': return 'info';
      case 'Responded': return 'warn';
      case 'Interview': return 'ivl';
      case 'Rejected': return 'bad';
      case 'Discarded': return 'idle';
      case 'requested': return 'idle';
      case 'prepping': return 'info';
      case 'ready': return 'warn';
      case 'approved': case 'submitted': return 'good';
      case 'reachable': return 'good';
      case 'empty': return 'idle';
      case 'network': case 'auth': case 'unknown': return 'warn';
      default: return 'idle';
    }
  }

  /* ---------------- namespace ------------------------------------------- */
  var CMC = window.CMC = {
    state: { applications: [], queue: [], platforms: [], activity: [], goals: [], targeting: [], interview: [], tasks: [], interviews: [], inbox: [], mail: [], profile: null, meta: null, live: false, degraded: false },
    ui: {},
    panels: {},
    register: register,
    rerender: rerender,
    setTheme: setTheme,
    act: {},
    h: h,
    fmt: fmt,
    statusKind: statusKind,
    safeUrl: safeUrl,
    /* phase 2: shared helpers for every panel */
    openDrawer: function (appId) { CMC.ui.drawerOpen = appId || null; rerender('drawer'); },
    closeDrawer: function () { CMC.ui.drawerOpen = null; rerender('drawer'); },
    newId: function (prefix) { return (prefix || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },
    activeTargeting: activeTargeting,
    search: runSearch,
    toast: function (msg) { showSaveNotice(msg); },
    /* the live Apply queue doc for an application (null when there is none
       or the request is already submitted) */
    queueFor: queueFor,
    /* one definition of what waits on Chris, shared by every panel */
    needsChris: needsChris,
    /* true while a sheet, drawer or popover sits on top of the page */
    modalOpen: modalOpen,
    /* one pay reader for every panel: CMC.pay.read(text) -> { low, high,
       hourly, lowRate, highRate } in yearly dollars or null;
       CMC.pay.short(text) -> "$125K to $163K" */
    pay: { read: readPay, short: payShort },
  };
  var state = CMC.state;

  /* the targeting profile in force: meta/state.activeTargeting, else the
     profile flagged isDefault, else the first one, else null */
  function activeTargeting() {
    var slug = state.meta && state.meta.activeTargeting;
    var t = null;
    if (slug) t = findBy(state.targeting || [], slug);
    if (!t) (state.targeting || []).forEach(function (x) { if (!t && x.isDefault) t = x; });
    return t || (state.targeting && state.targeting[0]) || null;
  }

  /* command-bar search: scroll to the first visible card whose text holds
     the query and flash it. Plain text match, no markup. */
  function runSearch(q) {
    q = String(q || '').trim().toLowerCase();
    var main = document.getElementById('cmcMain');
    if (!q || !main) return false;
    var walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, null);
    var node, hit = null;
    while ((node = walker.nextNode())) {
      if (String(node.nodeValue).toLowerCase().indexOf(q) < 0) continue;
      var el = node.parentElement;
      if (!el || !el.offsetParent) continue;
      hit = el; break;
    }
    if (!hit) return false;
    var card = hit.closest('article, li, tr, .panel') || hit;
    try { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { card.scrollIntoView(); }
    card.classList.add('is-hit');
    setTimeout(function () { card.classList.remove('is-hit'); }, 2200);
    return true;
  }

  /* ---------------- theme engine ----------------------------------------- */
  function effectiveTheme() {
    var root = document.documentElement;
    var pick = root.getAttribute('data-cctheme');
    if (pick && THEMES.indexOf(pick) >= 0) return pick;
    var host = root.getAttribute('data-theme');
    if (host === 'dark') return 't-dark-ops';
    if (host === 'light') return 't-light-pro';
    try {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 't-dark-ops';
    } catch (e) {}
    return 't-light-pro';
  }
  function setTheme(name) {
    var root = document.documentElement;
    if (name && THEMES.indexOf(name) >= 0) root.setAttribute('data-cctheme', name);
    else root.removeAttribute('data-cctheme');
    try { localStorage.setItem(THEME_KEY, name || ''); } catch (e) {}
    updateSwatches();
    if (proofActive) renderProof();
  }
  window.__setTheme = setTheme;
  function applySavedTheme() {
    var saved = '';
    try { saved = localStorage.getItem(THEME_KEY) || ''; } catch (e) {}
    /* ?cctheme=t-bold previews one theme for screenshots and tests without
       touching the saved pick */
    try {
      var q = new URLSearchParams(location.search).get('cctheme');
      if (q && THEMES.indexOf(q) >= 0) saved = q;
    } catch (e2) {}
    if (saved && THEMES.indexOf(saved) >= 0) document.documentElement.setAttribute('data-cctheme', saved);
    updateSwatches();
  }
  function updateSwatches() {
    var eff = effectiveTheme();
    var btns = document.querySelectorAll('.t-swatch[data-pick]');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-pick') === eff;
      btns[i].classList.toggle('is-active', on);
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  /* ---------------- rendering -------------------------------------------- */
  var booted = false;
  function slotFor(name) {
    return document.querySelector('.panel-slot[data-panel="' + name + '"]');
  }
  function register(name, def) {
    CMC.panels[name] = def;
    if (booted) renderPanel(name);
  }
  function renderPanel(name) {
    var def = CMC.panels[name];
    var el = slotFor(name);
    if (!def || !el || typeof def.render !== 'function') return;
    el.classList.remove('is-ghost');
    try { def.render(el, state, CMC.ui); }
    catch (e) { console.error('CMC panel "' + name + '" render failed:', e); }
  }
  function rerender(name) {
    if (name) { renderPanel(name); return; }
    for (var i = 0; i < PANEL_ORDER.length; i++) renderPanel(PANEL_ORDER[i]);
    renderChrome();
  }
  var renderQueued = false;
  function scheduleRerender() {
    if (renderQueued) return;
    renderQueued = true;
    Promise.resolve().then(function () { renderQueued = false; rerender(); });
  }

  /* ---------------- db sync ---------------------------------------------- */
  var db = null;
  var subscribed = false;
  var clearing = false;
  function rowsOf(snap) {
    var out = [];
    snap.docs.forEach(function (d) {
      var body = d.data() || {};
      var row = { id: d.id };
      for (var k in body) row[k] = body[k];
      out.push(row);
    });
    if (clearing) out = out.filter(function (r) { return !r.sample; });
    return out;
  }
  function connect() {
    var c = window.claude;
    if (!c || typeof c.use !== 'function') return; // no runtime: stay in preview
    try {
      Promise.resolve(c.use('db')).then(function (d) {
        if (!d || typeof d.collection !== 'function') return;
        db = d;
        state.live = true;
        subscribeAll();
        renderChrome();
      }).catch(function () { /* stay in preview */ });
    } catch (e) { /* stay in preview */ }
  }
  /* Terminal subscription error (revoked grant, dead bridge, budget).
     The db contract requires an error callback on every onSnapshot;
     without one the listener dies AND the page reports a page error.
     We log the code, keep the last-known data on screen, and flip the
     header pill to Offline so Chris knows updates stopped. */
  function feedDown(what) {
    return function (e) {
      console.warn('CMC live feed stopped (' + what + '):', e && e.code ? e.code : e);
      state.degraded = true;
      state.live = false;
      renderChrome();
    };
  }
  function subscribeAll() {
    if (subscribed || !db) return;
    subscribed = true;
    COLLECTIONS.forEach(function (col) {
      db.collection(col).onSnapshot(function (snap) {
        state[col] = rowsOf(snap);
        scheduleRerender();
      }, feedDown(col));
    });
    db.doc('profile/main').onSnapshot(function (s) {
      state.profile = s && s.exists ? s.data() : null;
      scheduleRerender();
    }, feedDown('profile'));
    db.doc('meta/state').onSnapshot(function (s) {
      state.meta = s && s.exists ? s.data() : null;
      scheduleRerender();
    }, feedDown('meta'));
  }

  /* writes: optimistic + serialized awaited db writes (one at a time).
     Per the db contract: retry a 'unavailable' verb once after a short
     randomized delay; every other failure (quota_exceeded included) is
     surfaced to Chris through the save notice, never swallowed. */
  var writeChain = Promise.resolve();
  function errCode(e) { return e && e.code ? String(e.code) : ''; }
  function reportWriteFailure(e) {
    console.warn('CMC db write failed:', e && e.message ? e.message : e);
    var msg = 'That change did not save. Check your connection, then try again.';
    if (errCode(e) === 'quota_exceeded') {
      msg = 'That change did not save. The board\'s storage is full. Clear sample data or old records to make room.';
    }
    showSaveNotice(msg);
  }
  function withRetry(run) {
    return Promise.resolve(run()).catch(function (e) {
      if (errCode(e) !== 'unavailable') throw e;
      return new Promise(function (res) { setTimeout(res, 300 + Math.random() * 600); })
        .then(run);
    });
  }
  function dbWrite(fn) {
    writeChain = writeChain.then(function () {
      if (!state.live || !db) return null;
      return withRetry(function () { return fn(db); }).catch(reportWriteFailure);
    });
    return writeChain;
  }
  function nowIso() { return new Date().toISOString(); }
  function findBy(arr, id) {
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }
  function stripId(row) {
    var body = {};
    for (var k in row) if (k !== 'id') body[k] = row[k];
    return body;
  }
  /* Activity ids stay 'a<n>' so they sort with the seeded rows, but the
     number is padded to 5 digits (sortable far past a999) and carries a
     short random suffix so two devices acting in the same second mint
     different doc ids instead of overwriting each other. The feed orders
     by timestamp first; the id is only a tiebreaker. */
  function nextActivityId() {
    var max = 0;
    state.activity.forEach(function (a) {
      var m = /^a(\d+)/.exec(a.id);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    var n = String(max + 1);
    while (n.length < 5) n = '0' + n;
    return 'a' + n + '-' + Math.random().toString(36).slice(2, 6);
  }
  function inSampleMode() { return !!(state.meta && state.meta.sampleMode); }

  /* ---------------- shared readers --------------------------------------- */
  /* Pay as people write it: "$125,000 - $163,000 plus bonus", "$80k - $160k",
     "$95K to $110K", "$58/hr", "40 to 45 an hour", "95 to 110" (thousands),
     "Not posted". Returns null when no amount can be read, else
     { low, high, hourly, lowRate, highRate } in yearly dollars (hourly rates
     times 2080, with the rates kept as lowRate/highRate). A second amount
     counts as the top of a range only when a dash, "to" or "and" joins the
     two, so "up to $198,000 in top metros" and "30% bonus" never stretch it.
     Percentages are skipped. */
  var PAY_AMOUNT = /(\$\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(k\b)?(\s*%)?/gi;
  var PAY_JOIN = /^\s*(?:-|\u2013|\u2014|to|and)\s*$/i;
  var PAY_HOURLY = /\/\s*(?:hr|hour)\b|per hour|hourly|an hour|\d\s*hrs?\b/i;
  function readPay(text) {
    var t = String(text || '');
    if (!t) return null;
    var hourly = PAY_HOURLY.test(t);
    var found = [], m;
    PAY_AMOUNT.lastIndex = 0;
    while ((m = PAY_AMOUNT.exec(t)) !== null && found.length < 6) {
      if (m[4]) continue;
      var n = parseFloat(m[2].replace(/,/g, ''));
      if (!n || isNaN(n)) continue;
      found.push({ n: n, k: !!m[3], dollar: !!m[1], start: m.index, end: m.index + m[0].length });
    }
    if (!found.length) return null;
    var a = found[0], b = null;
    if (found[1] && PAY_JOIN.test(t.slice(a.end, found[1].start))) b = found[1];
    /* "$80k - $160k" and "80 - 160k": a k on either end applies to both */
    var k = a.k || (b && b.k);
    function yearly(x) {
      var n = x.n;
      if (x.k || (k && n < 1000)) return { y: n * 1000, rate: null };
      if (hourly && n < 1000) return { y: Math.round(n * 2080), rate: n };
      if (n < 1000) return { y: n * 1000, rate: null };
      return { y: n, rate: null };
    }
    var lo = yearly(a), hi = b ? yearly(b) : lo;
    if (hi.y < lo.y) { var sw = lo; lo = hi; hi = sw; }
    return { low: lo.y, high: hi.y, hourly: lo.rate !== null, lowRate: lo.rate, highRate: hi.rate };
  }
  /* the short form for tiles and lines: "$125K to $163K", "$90K", "$58/hr",
     "$40 to $45/hr"; '' when nothing can be read */
  function payShort(text) {
    var p = typeof text === 'object' && text ? text : readPay(text);
    if (!p) return '';
    /* whole thousands round ("$130,100" is "$130K"); under $100K a half
       step shows ("$62,500" is "$62.5K") so the short form never overstates */
    function kd(n) {
      var t = n / 1000;
      if (t < 100 && Math.abs(t - Math.round(t)) >= 0.05) return '$' + (Math.round(t * 10) / 10) + 'K';
      return '$' + Math.round(t) + 'K';
    }
    function rd(n) { return '$' + (n % 1 ? n.toFixed(2) : String(n)); }
    if (p.hourly) {
      return p.highRate && p.highRate !== p.lowRate ? rd(p.lowRate) + ' to ' + rd(p.highRate) + '/hr' : rd(p.lowRate) + '/hr';
    }
    return p.high > p.low && kd(p.high) !== kd(p.low) ? kd(p.low) + ' to ' + kd(p.high) : kd(p.low);
  }
  function queueFor(appId) {
    if (!appId) return null;
    var rows = state.queue || [];
    for (var i = 0; i < rows.length; i++) {
      var q = rows[i];
      if ((q.appId === appId || q.id === 'q-' + appId) && q.state !== 'submitted') return q;
    }
    return null;
  }
  /* What waits on Chris: queue items that are ready for his review plus
     open tasks he alone can do (decide, approve). Open tasks of other kinds
     (sign up, study, answer) are listed separately as "open tasks" so the
     tab title, the KPI deck, Needs you and the Apply queue all show one
     number for the same idea. */
  var NEEDS_CHRIS_KINDS = { decide: 1, approve: 1 };
  function needsChris() {
    var ready = 0, decisions = 0, openTasks = 0;
    (state.queue || []).forEach(function (q) { if (q.state === 'ready') ready++; });
    (state.tasks || []).forEach(function (t) {
      if (t.state && t.state !== 'open') return;
      openTasks++;
      if (NEEDS_CHRIS_KINDS[t.kind]) decisions++;
    });
    return { ready: ready, decisions: decisions, total: ready + decisions, openTasks: openTasks };
  }
  function modalOpen() {
    var u = CMC.ui || {};
    if (u.tgWizard || u.drawerOpen || u.calOpen || u.jvSheet || u.sheetOpen) return true;
    var els = document.querySelectorAll('[aria-modal="true"]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.hidden) continue;
      var r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return true;
    }
    return false;
  }

  /* ---------------- data actions ----------------------------------------- */
  /* Resolves true when the request is safely down (db writes landed, or
     preview mode where there is no db), false when the live writes failed.
     Callers use that to hold back "Claude is prepping" log lines for
     requests that never saved. */
  CMC.act.applyTo = function (appId) {
    var app = findBy(state.applications, appId);
    if (!app) return Promise.resolve(false);
    app.status = 'queued';
    var q = {
      id: 'q-' + appId,
      appId: appId,
      company: app.company || '',
      role: app.role || '',
      state: 'requested',
      requestedAt: nowIso(),
      updatedAt: nowIso(),
      note: '',
      sample: !!app.sample,
    };
    if (!findBy(state.queue, q.id)) state.queue.push(q);
    rerender();
    var wrote = true;
    return dbWrite(function (d) {
      /* Two independent writes, still one at a time: if the application
         update fails (say the doc was deleted on another device), the
         queue doc is still created so Chris's request is not lost. The
         first failure is rethrown so dbWrite can retry or notify. */
      var firstErr = null;
      wrote = true;
      function keep(e) { if (!firstErr) firstErr = e; }
      return d.doc('applications/' + appId).update({ status: 'queued' }).catch(keep)
        .then(function () { return d.doc('queue/' + q.id).set(stripId(q)).catch(keep); })
        .then(function () { if (firstErr) { wrote = false; throw firstErr; } });
    }).then(function () { return wrote; });
  };

  CMC.act.setQueueState = function (queueId, st) {
    var q = findBy(state.queue, queueId);
    if (!q) return Promise.resolve();
    q.state = st;
    q.updatedAt = nowIso();
    rerender();
    /* set() with the full cached body, not update(): if this doc only ever
       existed optimistically (its create failed earlier), the set recreates
       it instead of failing a second time */
    var body = stripId(q);
    return dbWrite(function (d) {
      return d.doc('queue/' + queueId).set(body);
    });
  };

  /* An application that leaves the queue takes its prep request with it,
     so the Apply queue never shows Claude prepping a job Chris already
     passed on or moved along. Applied means the request is done: the doc is
     marked submitted. Any other status retires the doc. Idempotent: with no
     live queue doc it returns { write: null, note: '' }. The note is the
     phrase callers append to their log line. */
  CMC.act.retireQueue = function (appId, toStatus) {
    var q = queueFor(appId);
    if (!q) return { write: null, note: '' };
    if (toStatus === 'Applied' || toStatus === 'queued') {
      if (toStatus === 'queued') return { write: null, note: '' };
      return { write: CMC.act.setQueueState(q.id, 'submitted'), note: '' };
    }
    return { write: CMC.act.deleteDoc('queue', q.id), note: ' Pulled it from the Apply queue.' };
  };

  /* opts.keepQueue: true leaves the queue doc alone (the caller handles it) */
  CMC.act.setAppStatus = function (appId, status, opts) {
    var app = findBy(state.applications, appId);
    if (!app) return Promise.resolve();
    var retired = (opts && opts.keepQueue) ? { write: null, note: '' } : CMC.act.retireQueue(appId, status);
    app.status = status;
    /* stamp when the status changed so the pipeline's 30-day closed filter
       measures from the rejection/pass, not from an old applied date */
    app.statusChangedAt = nowIso();
    if (status === 'Applied' && !app.dateApplied) app.dateApplied = nowIso();
    rerender();
    /* set() with the full cached body, not update(): a doc whose create
       failed earlier (added link, etc.) self-heals instead of failing twice */
    var body = stripId(app);
    var p = dbWrite(function (d) { return d.doc('applications/' + appId).set(body); });
    if (!retired.write) return p;
    return Promise.all([p, retired.write]).then(function (r) { return r[0]; });
  };

  CMC.act.addActivity = function (text, kind) {
    var row = { id: nextActivityId(), ts: nowIso(), kind: kind || 'system', text: String(text || ''), sample: inSampleMode() };
    state.activity.push(row);
    rerender();
    return dbWrite(function (d) { return d.doc('activity/' + row.id).set(stripId(row)); });
  };

  /* NOTE on the two goal writers below: they write an absolute `done`
     computed from locally cached state, which is the read-modify-update
     counter pattern the db contract warns about (last writer wins, so
     two devices tapping in the same instant can lose one increment).
     This board has exactly one daily user (Chris), onSnapshot resyncs
     the cache within seconds, and a goal tick is cheap to redo, so the
     simple absolute write is the deliberate choice here. If this ever
     grows a second concurrent writer, move the math server-side. */
  CMC.act.toggleGoalDone = function (goalId) {
    var g = findBy(state.goals, goalId);
    if (!g) return Promise.resolve();
    var target = typeof g.target === 'number' ? g.target : 1;
    g.done = (g.done >= target) ? 0 : target;
    rerender();
    return dbWrite(function (d) { return d.doc('goals/' + goalId).update({ done: g.done }); });
  };

  CMC.act.bumpGoal = function (goalId, n) {
    var g = findBy(state.goals, goalId);
    if (!g) return Promise.resolve();
    g.done = Math.max(0, (typeof g.done === 'number' ? g.done : 0) + (typeof n === 'number' ? n : 1));
    rerender();
    return dbWrite(function (d) { return d.doc('goals/' + goalId).update({ done: g.done }); });
  };

  /* re-read every collection from the db (used after a partial clear so
     rows that refused to delete come back on screen) */
  function refreshAll(d) {
    var reads = COLLECTIONS.map(function (col) {
      return Promise.resolve(d.collection(col).get())
        .then(function (snap) { state[col] = rowsOf(snap); })
        .catch(function () { /* keep what we have */ });
    });
    return Promise.all(reads);
  }

  CMC.act.clearSamples = function () {
    clearing = true;
    var doomed = [];
    COLLECTIONS.forEach(function (col) {
      state[col].forEach(function (row) { if (row.sample) doomed.push(col + '/' + row.id); });
      state[col] = state[col].filter(function (row) { return !row.sample; });
    });
    if (state.meta) state.meta.sampleMode = false;
    rerender();
    return dbWrite(function (d) {
      /* each delete is wrapped so one failure never skips the rest */
      var failed = 0;
      var p = Promise.resolve();
      doomed.forEach(function (path) {
        p = p.then(function () {
          return withRetry(function () { return d.doc(path).delete(); }).catch(function (e) {
            failed++;
            console.warn('CMC clearSamples delete failed:', path, e && e.message ? e.message : e);
          });
        });
      });
      return p.then(function () {
        if (!failed) {
          return d.doc('meta/state').update({ sampleMode: false })
            .catch(function (e) { console.warn('CMC clearSamples meta update failed:', e && e.message ? e.message : e); });
        }
        /* some rows are still in the db: keep sample mode on so the
           banner and its clear button stay available, bring the
           surviving rows back on screen, and tell Chris */
        if (state.meta) state.meta.sampleMode = true;
        clearing = false;
        showSaveNotice('Some sample records did not clear. Tap "Clear sample data" to try again.');
        return refreshAll(d);
      });
    }).then(function () { clearing = false; rerender(); })
      .catch(function (e) {
        /* defense in depth: nothing above should reject, but the board must
           never stay stuck in clearing mode if something does */
        clearing = false;
        console.warn('CMC clearSamples failed:', e && e.message ? e.message : e);
        rerender();
      });
  };

  CMC.act.addJobUrl = function (url) {
    var raw = String(url || '').trim();
    if (raw && !/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
    var host = '';
    try { host = new URL(raw).hostname.replace(/^www\./, ''); } catch (e) { host = ''; }
    if (!host || host.indexOf('.') < 0) return Promise.reject(new Error('bad-url'));
    var labels = host.split('.');
    var skip = { www: 1, jobs: 1, careers: 1, apply: 1, boards: 1, 'job-boards': 1, career: 1 };
    var pickLabel = labels[0];
    for (var i = 0; i < labels.length - 1; i++) { if (!skip[labels[i]]) { pickLabel = labels[i]; break; } }
    var company = pickLabel ? pickLabel.charAt(0).toUpperCase() + pickLabel.slice(1) : host;
    /* Chris's own links enter as Evaluated (the real Career Ops pre-funnel
       status) with no score yet; panels show "Not scored yet" until Claude
       rates it, and unscored apps stay out of the average fit math. */
    var app = {
      id: 'app-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      company: company,
      role: 'New job link',
      url: raw,
      platform: 'Added by you',
      score: null,
      status: 'Evaluated',
      source: 'manual',
      dateFound: nowIso(),
      sample: false,
    };
    state.applications.push(app);
    rerender();
    var write = dbWrite(function (d) { return d.doc('applications/' + app.id).set(stripId(app)); });
    CMC.act.addActivity('You added a job link from ' + host + '. Claude will score it on the next pass.', 'found');
    return write;
  };

  /* ---------------- generic document actions (phase 2 panels) ----------- */
  /* Optimistic local update plus the same serialized, retried db write the
     older actions use. `col` is a top-level collection name; rows carry id. */
  function upsertLocal(col, row) {
    if (!state[col]) state[col] = [];
    var cur = findBy(state[col], row.id);
    if (cur) { for (var k in row) cur[k] = row[k]; return cur; }
    state[col].push(row);
    return row;
  }
  CMC.act.setDoc = function (col, id, body) {
    var row = { id: id };
    for (var k in body) if (k !== 'id') row[k] = body[k];
    upsertLocal(col, row);
    rerender();
    var copy = stripId(row);
    return dbWrite(function (d) { return d.doc(col + '/' + id).set(copy); });
  };
  CMC.act.updateDoc = function (col, id, patch) {
    var cur = findBy(state[col] || [], id);
    if (!cur) return CMC.act.setDoc(col, id, patch);
    for (var k in patch) if (k !== 'id') cur[k] = patch[k];
    rerender();
    /* set() with the full cached body: a doc whose create failed self-heals */
    var body = stripId(cur);
    return dbWrite(function (d) { return d.doc(col + '/' + id).set(body); });
  };
  CMC.act.deleteDoc = function (col, id) {
    if (state[col]) state[col] = state[col].filter(function (r) { return r.id !== id; });
    rerender();
    return dbWrite(function (d) { return d.doc(col + '/' + id).delete(); });
  };
  CMC.act.setMeta = function (patch) {
    if (!state.meta) state.meta = {};
    for (var k in patch) state.meta[k] = patch[k];
    rerender();
    var body = {};
    for (var m in state.meta) body[m] = state.meta[m];
    return dbWrite(function (d) { return d.doc('meta/state').set(body); });
  };
  CMC.act.setProfile = function (patch) {
    if (!state.profile) state.profile = {};
    for (var k in patch) state.profile[k] = patch[k];
    rerender();
    var body = {};
    for (var m in state.profile) body[m] = state.profile[m];
    return dbWrite(function (d) { return d.doc('profile/main').set(body); });
  };
  CMC.act.setActiveTargeting = function (slug) {
    var t = findBy(state.targeting || [], slug);
    if (!t) return Promise.resolve();
    var p = CMC.act.setMeta({ activeTargeting: slug });
    CMC.act.addActivity('Switched the targeting profile to ' + (t.name || slug) + '. Profiles change the rules, not the data. Run a scan to see matches under this profile.', 'system');
    return p;
  };

  /* ---------------- chrome: live pill, save notice, footer ---------------- */
  var noticeTimer = null;
  function showSaveNotice(msg) {
    var box = document.getElementById('saveNotice');
    var text = document.getElementById('saveNoticeText');
    if (!box || !text) return;
    text.textContent = msg;
    box.hidden = false;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () { box.hidden = true; }, 9000);
  }
  function hideSaveNotice() {
    var box = document.getElementById('saveNotice');
    if (box) box.hidden = true;
    if (noticeTimer) { clearTimeout(noticeTimer); noticeTimer = null; }
  }
  function renderChrome() {
    updateSwatches();
    var pill = document.getElementById('livePill');
    var dot = document.getElementById('liveDot');
    var label = document.getElementById('liveLabel');
    if (pill && dot && label) {
      pill.classList.toggle('is-live', state.live);
      pill.classList.toggle('is-degraded', !!state.degraded);
      if (state.degraded) {
        /* the live feed died (grant revoked or bridge gone): keep the
           last-known data on screen but stop claiming Live */
        dot.className = 'dot dot-warn';
        label.textContent = 'Offline, tap to reload';
        pill.title = 'The live connection dropped. Tap to reload the page.';
        pill.style.cursor = 'pointer';
        pill.onclick = function () { try { location.reload(); } catch (e) { /* ignore */ } };
      } else {
        dot.className = 'dot ' + (state.live ? 'dot-good pulse' : 'dot-idle');
        label.textContent = state.live ? 'Live' : 'Preview';
        pill.title = state.live ? 'Connection to the live tracker' : 'Not connected to the live tracker yet. Tap to reload, and allow the page its database access if asked.';
        pill.style.cursor = state.live ? '' : 'pointer';
        pill.onclick = state.live ? null : function () { try { location.reload(); } catch (e) { /* ignore */ } };
      }
    }
    var anySample = false;
    COLLECTIONS.forEach(function (col) {
      state[col].forEach(function (r) { if (r.sample) anySample = true; });
    });
    var banner = document.getElementById('sampleBanner');
    if (banner) banner.hidden = !(inSampleMode() && anySample);
    var sync = document.getElementById('lastSync');
    if (sync) {
      var ls = state.meta && state.meta.lastSync;
      sync.hidden = !ls;
      if (ls) sync.textContent = 'Last sync ' + fmt.scan(ls);
    }
  }

  /* the sticky command bar's height feeds --cmdbar-h so panel jumps and
     scrollIntoView land below it at every width (it wraps to two rows on
     a phone) */
  function watchCmdbar() {
    var bar = document.getElementById('cmdbar');
    if (!bar) return;
    var last = -1;
    function apply() {
      var hgt = Math.round(bar.getBoundingClientRect().height);
      if (hgt === last || !hgt) return;
      last = hgt;
      document.documentElement.style.setProperty('--cmdbar-h', hgt + 'px');
    }
    apply();
    if (typeof ResizeObserver === 'function') {
      try { new ResizeObserver(apply).observe(bar); } catch (e) { window.addEventListener('resize', apply); }
    } else {
      window.addEventListener('resize', apply);
    }
  }
  function wireHeader() {
    var btns = document.querySelectorAll('.t-swatch[data-pick]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function (ev) {
        setTheme(ev.currentTarget.getAttribute('data-pick'));
      });
    }
    watchCmdbar();
    var sform = document.getElementById('cmdSearch');
    var sinput = document.getElementById('cmdSearchInput');
    if (sform && sinput) {
      sform.addEventListener('submit', function (ev) {
        ev.preventDefault();
        if (!runSearch(sinput.value)) showSaveNotice('No match for "' + sinput.value.trim() + '" on the board.');
      });
      sinput.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { sinput.value = ''; sinput.blur(); } });
      /* the phone bar gives the search box a short slot; a short prompt
         fits it, and the full one comes back while it has focus or on
         wider screens (the aria-label carries the full wording always) */
      var narrow = window.matchMedia ? window.matchMedia('(max-width: 760px)') : null;
      function sizePrompt() {
        sinput.placeholder = (narrow && narrow.matches && document.activeElement !== sinput) ? 'Find' : 'Find a company';
      }
      sizePrompt();
      if (narrow) { try { narrow.addEventListener('change', sizePrompt); } catch (e) { narrow.addListener(sizePrompt); } }
      sinput.addEventListener('focus', sizePrompt);
      sinput.addEventListener('blur', sizePrompt);
    }
    var toggle = document.getElementById('addLinkBtn');
    var row = document.getElementById('addLinkRow');
    var input = document.getElementById('addLinkInput');
    var go = document.getElementById('addLinkGo');
    var cancel = document.getElementById('addLinkCancel');
    var note = document.getElementById('addLinkNote');
    if (!toggle || !row || !input || !go || !cancel || !note) return;
    function openRow(open) {
      row.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      note.hidden = true;
      if (open) input.focus();
      else input.value = '';
    }
    toggle.addEventListener('click', function () { openRow(row.hidden); });
    cancel.addEventListener('click', function () { openRow(false); });
    input.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') openRow(false); });
    row.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var v = input.value.trim();
      if (!v) { note.hidden = false; note.classList.add('is-error'); note.textContent = 'Paste the link to the job posting first.'; return; }
      go.disabled = true;
      cancel.disabled = true;
      CMC.act.addJobUrl(v).then(function () {
        go.disabled = false;
        cancel.disabled = false;
        openRow(false);
      }, function () {
        go.disabled = false;
        cancel.disabled = false;
        note.hidden = false;
        note.classList.add('is-error');
        note.textContent = 'That does not look like a web link. Paste the full job posting address.';
      });
    });
  }

  function wireFooter() {
    var noticeClose = document.getElementById('saveNoticeClose');
    if (noticeClose) noticeClose.addEventListener('click', hideSaveNotice);
    var first = document.getElementById('clearSamplesBtn');
    var confirmWrap = document.getElementById('clearConfirm');
    var yes = document.getElementById('clearYesBtn');
    var no = document.getElementById('clearNoBtn');
    if (!first || !confirmWrap || !yes || !no) return;
    first.addEventListener('click', function () {
      first.hidden = true;
      confirmWrap.hidden = false;
    });
    no.addEventListener('click', function () {
      confirmWrap.hidden = true;
      first.hidden = false;
    });
    yes.addEventListener('click', function () {
      yes.disabled = true;
      yes.textContent = 'Clearing...';
      CMC.act.clearSamples().then(function () {
        yes.disabled = false;
        yes.textContent = 'Yes, clear it';
        confirmWrap.hidden = true;
        first.hidden = false;
      }).catch(function () {
        /* defense in depth: the button must never stay stuck on "Clearing..." */
        yes.disabled = false;
        yes.textContent = 'Yes, clear it';
        confirmWrap.hidden = true;
        first.hidden = false;
      });
    });
  }

  /* ---------------- #only=<piece> and #proof ------------------------------ */
  var proofActive = false;
  function applyHash() {
    var hash = location.hash || '';
    if (!hash) {
      // file-URL fallback: a percent-encoded '#' lands in the path, not the hash
      var m23 = /%23([^?]*)$/.exec(location.href);
      if (m23) { try { hash = '#' + decodeURIComponent(m23[1]); } catch (e) { hash = '#' + m23[1]; } }
    }
    var m = /only=([\w-]+)/.exec(hash);
    proofActive = /proof/.test(hash);
    var slots = document.querySelectorAll('.panel-slot');
    for (var i = 0; i < slots.length; i++) {
      var name = slots[i].getAttribute('data-panel');
      slots[i].hidden = proofActive || (!!m && name !== m[1]);
    }
    var bands = document.querySelectorAll('.band-label');
    for (var b = 0; b < bands.length; b++) bands[b].hidden = proofActive || !!m;
    var existing = document.getElementById('proofSection');
    if (proofActive) renderProof();
    else if (existing) existing.remove();
  }

  /* ---------------- proof diagnostics ------------------------------------ */
  var TOKEN_NAMES = ['--bg', '--bg2', '--panel', '--panel2', '--line', '--fg', '--muted', '--faint',
    '--accent', '--accent-ink', '--glow', '--good', '--warn', '--bad', '--hot', '--info', '--ivl', '--idle',
    '--c1', '--c2', '--c3', '--c4', '--c5', '--c6'];
  function proofPanel(title, kicker) {
    var kids = Array.prototype.slice.call(arguments, 2);
    return h('div', { class: 'panel' },
      h('div', { class: 'panel-head' },
        h('h2', { class: 'panel-title' }, title),
        h('span', { class: 'panel-kicker' }, kicker)),
      h('div', { class: 'panel-body' }, kids));
  }
  function renderProof() {
    var main = document.getElementById('cmcMain');
    if (!main) return;
    var old = document.getElementById('proofSection');
    if (old) old.remove();
    var cs = getComputedStyle(document.documentElement);

    var swatches = h('div', { class: 'proof-swatches' }, TOKEN_NAMES.map(function (n) {
      var val = cs.getPropertyValue(n).trim();
      return h('div', { class: 'proof-swatch' },
        h('span', { class: 'pv', style: { background: 'var(' + n + ')' } }),
        h('span', { class: 'pn' }, n, h('small', null, val || '(unset)')));
    }));
    function shapeDemo(token, style, label) {
      return h('div', { class: 'proof-swatch' },
        h('span', { class: 'pv', style: style }),
        h('span', { class: 'pn' }, token, h('small', null, label)));
    }
    var shapes = h('div', { class: 'proof-swatches', style: { 'margin-top': '8px' } },
      shapeDemo('--r-panel', { background: 'var(--panel2)', 'border-radius': 'var(--r-panel)' }, cs.getPropertyValue('--r-panel').trim()),
      shapeDemo('--r-chip', { background: 'var(--panel2)', 'border-radius': 'var(--r-chip)' }, cs.getPropertyValue('--r-chip').trim()),
      shapeDemo('--shadow-panel', { background: 'var(--panel)', 'box-shadow': 'var(--shadow-panel)' }, 'panel shadow'),
      shapeDemo('--hiline', { background: 'var(--panel)', 'box-shadow': 'inset 0 2px 0 var(--hiline)' }, 'inner top highlight'),
      shapeDemo('--glow', { background: 'var(--panel)', 'box-shadow': '0 0 10px var(--glow)' }, 'state glow'),
      shapeDemo('--scan', { background: 'repeating-linear-gradient(0deg, var(--scan) 0 2px, var(--panel) 2px 5px)' }, 'scanline texture'));

    function dotCase(cls, label) {
      return h('span', { class: 'proof-dotcase' }, h('span', { class: 'dot ' + cls }), label);
    }
    var dots = h('div', { class: 'proof-row' },
      h('span', { class: 'proof-label' }, 'Status dots'),
      dotCase('dot-good', 'active / good / applied'),
      dotCase('dot-info', 'in progress / info'),
      dotCase('dot-warn', 'waiting / needs attention'),
      dotCase('dot-ivl', 'interview stage'),
      dotCase('dot-bad', 'rejected / problem'),
      dotCase('dot-idle', 'idle / closed'),
      dotCase('dot-hollow', 'disabled'),
      dotCase('dot-good pulse', 'pulse = genuinely live'));

    function chipRow(label, items) {
      return h('div', { class: 'proof-row' },
        h('span', { class: 'proof-label' }, label),
        items.map(function (s) {
          var kind = statusKind(s);
          return h('span', { class: 'chip chip-' + kind }, h('span', { class: 'dot dot-' + kind }), s);
        }));
    }
    var chips = [
      chipRow('Application statuses', ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Rejected', 'Discarded', 'Hired']),
      chipRow('Queue states', ['requested', 'prepping', 'ready', 'approved', 'submitted']),
      chipRow('Platform health', ['reachable', 'empty', 'network', 'auth', 'unknown']),
    ];

    var type = h('div', { style: { display: 'grid', gap: '10px', width: '100%' } },
      h('p', { class: 'spec-disp' }, 'At a glance 4.6/5'),
      h('p', { class: 'spec-body' }, 'Claude preps every application. Nothing is sent until Chris approves it. This sentence is the body face, IBM Plex Sans.'),
      h('p', { class: 'spec-mono' }, '$92K base · Oct 9 10:00a · 46 platforms · today 7:58a · a015'));

    var sample = h('div', { class: 'panel', style: { width: '100%', 'max-width': '460px', 'box-shadow': 'none' } },
      h('div', { class: 'panel-head' },
        h('h3', { class: 'panel-title' }, 'Mission log'),
        h('span', { class: 'chip mono' }, '15'),
        h('span', { class: 'panel-kicker', style: { 'margin-left': 'auto' } }, 'sample anatomy')),
      h('div', { class: 'panel-body', style: { display: 'grid', gap: '10px' } },
        h('div', { style: { display: 'flex', gap: '9px', 'align-items': 'baseline' } },
          h('span', { class: 'dot dot-ivl' }),
          h('span', null, 'Interview booked with Jobber for Thursday.'),
          h('span', { class: 'mono', style: { color: 'var(--muted)', 'margin-left': 'auto', 'font-size': '12px', 'white-space': 'nowrap' } }, '2h ago')),
        h('div', { style: { display: 'flex', gap: '9px', 'align-items': 'baseline' } },
          h('span', { class: 'dot dot-good' }),
          h('span', null, 'Applied to Acme Co, Customer Success Manager.'),
          h('span', { class: 'mono', style: { color: 'var(--muted)', 'margin-left': 'auto', 'font-size': '12px', 'white-space': 'nowrap' } }, '4d ago'))));

    var SVG = 'http://www.w3.org/2000/svg';
    var spark = document.createElementNS(SVG, 'svg');
    spark.setAttribute('width', '200');
    spark.setAttribute('height', '36');
    spark.setAttribute('viewBox', '0 0 200 36');
    spark.setAttribute('aria-hidden', 'true');
    var area = document.createElementNS(SVG, 'path');
    area.setAttribute('d', 'M0,30 L15,28 L31,29 L46,24 L62,26 L77,20 L92,22 L108,16 L123,18 L138,12 L154,15 L169,9 L185,11 L200,6 L200,36 L0,36 Z');
    area.setAttribute('fill', 'var(--accent)');
    area.setAttribute('opacity', '0.14');
    var line = document.createElementNS(SVG, 'path');
    line.setAttribute('d', 'M0,30 L15,28 L31,29 L46,24 L62,26 L77,20 L92,22 L108,16 L123,18 L138,12 L154,15 L169,9 L185,11 L200,6');
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', 'var(--accent)');
    line.setAttribute('stroke-width', '2');
    var end = document.createElementNS(SVG, 'circle');
    end.setAttribute('cx', '200'); end.setAttribute('cy', '6'); end.setAttribute('r', '3');
    end.setAttribute('fill', 'var(--accent)');
    spark.appendChild(area); spark.appendChild(line); spark.appendChild(end);
    var kpiTile = h('button', { type: 'button', class: 'elev kpi-demo', 'aria-label': 'Sample KPI tile' },
      h('span', { class: 'k-label' }, 'Applications this week'),
      h('div', { class: 'k-num' }, '6'),
      h('div', { class: 'k-delta' }, 'Goal 10. Four to go.'),
      spark);

    var section = h('section', { class: 'proof', id: 'proofSection' },
      proofPanel('Proof: tokens', effectiveTheme(), [swatches, shapes]),
      proofPanel('Proof: status grammar', 'dots + chips', [dots, chips]),
      proofPanel('Proof: type', 'Chakra Petch / IBM Plex Sans / IBM Plex Mono', type),
      proofPanel('Proof: panel anatomy', 'head, kicker, body', sample),
      proofPanel('Proof: KPI elevation', 'hover lifts the tile', kpiTile));
    main.appendChild(section);
  }

  /* ---------------- boot -------------------------------------------------- */
  function start() {
    if (booted) return;
    booted = true;
    applySavedTheme();
    wireHeader();
    wireFooter();
    applyHash();
    window.addEventListener('hashchange', applyHash);
    try {
      if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateSwatches);
      }
    } catch (e) {}
    rerender();
    connect();
    /* Stale tabs (Chris, Oct 16): a Chrome tab left open since the day
       before showed old cards and no buttons. When the tab comes back after
       being hidden for a while, or after the live feed died, reload so the
       newest page and the live data show. Nothing Chris typed is at risk:
       this fires only when the tab was hidden, never while it is in use. */
    var hiddenAt = 0;
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      var away = hiddenAt ? Date.now() - hiddenAt : 0;
      if (state.degraded || away > 20 * 60 * 1000) { try { location.reload(); } catch (e) { /* ignore */ } }
    });
  }
  CMC.start = start;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
