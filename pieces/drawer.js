/* piece: drawer: the job detail side panel. Any panel opens it with
   CMC.openDrawer(appId); it renders only while CMC.ui.drawerOpen names an
   application, otherwise the slot stays empty. Reads CMC.state, writes only
   through CMC.act.*, shares the appBusy map with the tracker. */
(function () {
  'use strict';
  var CMC = window.CMC;
  if (!CMC) return;

  var NS = 'http://www.w3.org/2000/svg';
  var STATUSES = [
    { value: 'Evaluated', label: 'New' },
    { value: 'Applied', label: 'Applied' },
    { value: 'Responded', label: 'Heard back' },
    { value: 'Interview', label: 'Interview' },
    { value: 'Offer', label: 'Offer' },
    { value: 'Rejected', label: 'Rejected' },
    { value: 'Discarded', label: 'Passed' },
    { value: 'Hired', label: 'Hired' },
  ];
  var ROUNDS = ['Phone Screen', 'Recruiter Screen', '1st Interview', '2nd Interview', '3rd Interview', 'Final Round', 'Offer Call', 'Other'];
  var QUEUE_STATES = ['requested', 'prepping', 'ready', 'approved', 'submitted'];
  var LOG_KIND = { Evaluated: 'found', Applied: 'applied', Responded: 'system', Interview: 'interview', Offer: 'offer', Hired: 'win', Rejected: 'system', Discarded: 'system' };
  var CLOSED = { Hired: 1, Rejected: 1, Discarded: 1 };
  /* statuses that sit before Interview in the pipeline: picking a round on
     one of these books the interview and moves the app forward. Offer and
     Hired already sit past it, so a round pick there only records the round. */
  var BEFORE_INTERVIEW = { Evaluated: 1, found: 1, queued: 1, Applied: 1, Responded: 1 };
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  var DAY = 24 * 60 * 60 * 1000;
  var lastOpen = null;
  /* where focus should land after a redraw while the drawer stays open:
     a key for the control that had it (see focusKey), or null */
  var pendingFocus = null;

  /* ---------------- icons ------------------------------------------------ */
  function icon(size, parts, strokeWidth) {
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', strokeWidth || '1.8');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < parts.length; i++) {
      var el = document.createElementNS(NS, parts[i][0]);
      var attrs = parts[i][1];
      for (var k in attrs) el.setAttribute(k, attrs[k]);
      s.appendChild(el);
    }
    return s;
  }
  function xIcon() {
    return icon(16, [
      ['line', { x1: 18, y1: 6, x2: 6, y2: 18 }],
      ['line', { x1: 6, y1: 6, x2: 18, y2: 18 }],
    ], '2.2');
  }
  function outIcon() {
    return icon(13, [
      ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }],
      ['polyline', { points: '15 3 21 3 21 9' }],
      ['line', { x1: 10, y1: 14, x2: 21, y2: 3 }],
    ], '2');
  }
  function fileIcon() {
    return icon(14, [
      ['path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }],
      ['polyline', { points: '14 2 14 8 20 8' }],
    ], '2');
  }
  function checkIcon() {
    return icon(12, [
      ['polyline', { points: '20 6 9 17 4 12' }],
    ], '2.6');
  }

  /* ---------------- helpers ---------------------------------------------- */
  function find(arr, id) {
    for (var i = 0; i < (arr || []).length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }
  /* every queue doc for the app, a submitted one included: the queue block
     shows a finished request as five done steps, and Apply clears it before
     the fresh request goes in. The live doc (not submitted) is
     CMC.queueFor(appId); the status moves below use that one. */
  function anyQueueDoc(state, appId) {
    var hit = null;
    (state.queue || []).forEach(function (q) { if (q.appId === appId) hit = q; });
    return hit;
  }
  /* a submitted queue doc is finished business: CMC.queueFor skips it, so
     it no longer pulls an Evaluated app back into the queue and a re-opened
     app offers Apply */
  function effStatus(app) {
    if (app.status === 'queued') return 'queued';
    if (CMC.queueFor(app.id) && (app.status === 'Evaluated' || app.status === 'found')) return 'queued';
    return app.status;
  }
  function statusLabel(st) {
    if (st === 'queued') return 'In queue';
    if (st === 'found') return 'New link';
    for (var i = 0; i < STATUSES.length; i++) if (STATUSES[i].value === st) return STATUSES[i].label;
    return String(st || '');
  }
  function hasScore(app) { return typeof app.score === 'number' && !isNaN(app.score); }
  function bandClass(score) {
    if (typeof score !== 'number' || isNaN(score)) return '';
    if (score >= 4.5) return ' band-strong';
    if (score >= 4.0) return ' band-good';
    if (score >= 3.5) return ' band-edge';
    return '';
  }
  function verdict(app) {
    if (!hasScore(app)) return { word: 'Not scored', kind: 'idle' };
    if (app.score >= 4.0) return { word: 'Apply', kind: 'good' };
    if (app.score >= 3.0) return { word: 'Consider', kind: 'warn' };
    return { word: 'Skip', kind: 'idle' };
  }
  function ageDays(app, now) {
    if (app.status !== 'Applied') return null;
    var t = Date.parse(app.dateApplied || '');
    if (!t) return null;
    return Math.max(0, Math.floor((now - t) / DAY));
  }
  function busyMap(ui) {
    if (!ui.appBusy) ui.appBusy = {};
    return ui.appBusy;
  }
  function finishBusy(ui, key) {
    return function () {
      delete busyMap(ui)[key];
      CMC.rerender('tracker');
      CMC.rerender('drawer');
    };
  }
  function nowIso() { return new Date().toISOString(); }
  function hasInterview(state, appId) {
    var has = false;
    (state.interviews || []).forEach(function (iv) { if (iv.appId === appId) has = true; });
    return has;
  }
  function newInterview(app, round) {
    var ts = nowIso();
    return CMC.act.setDoc('interviews', CMC.newId('iv'), {
      appId: app.id, company: app.company || '', role: app.role || '', round: round,
      format: 'Video', date: null, time: null, notes: '', createdAt: ts, updatedAt: ts,
    });
  }
  /* ---------------- data actions ----------------------------------------- */
  /* Every status move here goes through the shared pair: CMC.act.retireQueue
     takes the live queue doc with the app (Applied marks it submitted,
     anything else deletes it) and hands back the words for the log line;
     setAppStatus runs with keepQueue so the queue doc is written once. */
  function onStatus(app, value, ui) {
    if (busyMap(ui)[app.id]) return;
    if (!value || value === app.status) return;
    busyMap(ui)[app.id] = true;
    var r = CMC.act.retireQueue(app.id, value);
    var writes = [CMC.act.setAppStatus(app.id, value, { keepQueue: true })];
    if (r.write) writes.push(r.write);
    CMC.act.addActivity((app.company || 'An application') + ' moved to ' + statusLabel(value) + '.' + r.note, LOG_KIND[value] || 'system');
    var fin = finishBusy(ui, app.id);
    Promise.all(writes).then(fin, fin);
  }
  function onRound(app, value, ui, state) {
    if (busyMap(ui)[app.id]) return;
    var round = value || null;
    if ((app.round || null) === round) return;
    busyMap(ui)[app.id] = true;
    var co = app.company || 'this company';
    /* read this before any write: setAppStatus changes app.status in place */
    var flipped = !!(round && BEFORE_INTERVIEW[app.status]);
    var writes = [CMC.act.updateDoc('applications', app.id, { round: round })];
    if (round) {
      var note = '';
      if (flipped) {
        var r = CMC.act.retireQueue(app.id, 'Interview');
        writes.push(CMC.act.setAppStatus(app.id, 'Interview', { keepQueue: true }));
        if (r.write) writes.push(r.write);
        note = r.note;
      }
      if (!hasInterview(state, app.id)) writes.push(newInterview(app, round));
      CMC.act.addActivity((flipped ? 'Interview booked with ' + co + ': ' + round + '.' : co + ' is now at ' + round + '.') + note, 'interview');
    } else {
      CMC.act.addActivity('Round cleared for ' + co + '.', 'system');
    }
    var fin = finishBusy(ui, app.id);
    Promise.all(writes).then(fin, fin);
  }
  function onApply(app, ui, q) {
    if (busyMap(ui)[app.id]) return;
    busyMap(ui)[app.id] = true;
    /* a finished (submitted) queue doc from an earlier run makes way for
       the fresh request, so the queue shows one honest step */
    if (q) CMC.act.deleteDoc('queue', q.id);
    var p = CMC.act.applyTo(app.id).then(function (ok) {
      if (ok) CMC.act.addActivity('You tapped Apply on ' + (app.company || 'a match') + ', ' + (app.role || 'new role') + '. Claude is prepping the application.', 'queue');
    });
    var fin = finishBusy(ui, app.id);
    p.then(fin, fin);
  }
  function onMove(app, ui, state, b) {
    if (busyMap(ui)[app.id]) return;
    busyMap(ui)[app.id] = true;
    var r = CMC.act.retireQueue(app.id, b.to);
    var writes = [CMC.act.setAppStatus(app.id, b.to, { keepQueue: true })];
    if (b.booked) {
      if (!hasInterview(state, app.id)) writes.push(newInterview(app, '1st Interview'));
      if (!app.round) writes.push(CMC.act.updateDoc('applications', app.id, { round: '1st Interview' }));
    }
    if (r.write) writes.push(r.write);
    CMC.act.addActivity(b.text + r.note, b.kind);
    var fin = finishBusy(ui, app.id);
    Promise.all(writes).then(fin, fin);
  }
  /* Applied marks the live queue doc submitted (retireQueue does that) */
  function onSubmitted(app, ui) {
    if (busyMap(ui)[app.id]) return;
    busyMap(ui)[app.id] = true;
    var r = CMC.act.retireQueue(app.id, 'Applied');
    var writes = [CMC.act.setAppStatus(app.id, 'Applied', { keepQueue: true })];
    if (r.write) writes.push(r.write);
    CMC.act.addActivity('Chris submitted the ' + (app.company || '') + ' application himself.', 'applied');
    var fin = finishBusy(ui, app.id);
    Promise.all(writes).then(fin, fin);
  }

  /* same words and targets as the pipeline cards */
  function moveButtons(app, st) {
    var co = app.company || 'this company';
    var saidNo = { label: 'They said no', to: 'Rejected', text: co + ' said no. On to the next one.', kind: 'system' };
    var pass = { label: 'Pass', to: 'Discarded', text: 'You passed on ' + co + '.', kind: 'system' };
    switch (st) {
      case 'Evaluated':
      case 'found':
        return [{ label: 'Apply', primary: true, apply: true }, pass];
      case 'queued':
        return [pass];
      case 'Applied':
        return [
          { label: 'They answered', to: 'Responded', text: co + ' answered your application.', kind: 'system' },
          saidNo,
        ];
      case 'Responded':
        return [
          { label: 'Interview booked', primary: true, to: 'Interview', booked: true, text: 'Interview booked with ' + co + '.', kind: 'interview' },
          saidNo,
        ];
      case 'Interview':
        return [
          { label: 'Got an offer', primary: true, to: 'Offer', text: 'Offer from ' + co + ' is on the table.', kind: 'offer' },
          saidNo,
        ];
      case 'Offer':
        return [
          { label: 'I took the job', primary: true, to: 'Hired', text: 'You accepted the ' + co + ' offer. Mission complete.', kind: 'win' },
          { label: 'I turned it down', to: 'Discarded', text: 'You turned down the ' + co + ' offer.', kind: 'system' },
        ];
      case 'Rejected':
      case 'Discarded':
        return [{ label: 'Back in the running', to: 'Evaluated', text: co + ' is back in the running.', kind: 'system' }];
      default:
        return [];
    }
  }

  /* ---------------- focus bookkeeping ------------------------------------ */
  /* a small key for the control that holds focus inside the drawer, so a
     redraw (a save landing, a live update) can put focus back on its twin */
  function focusKey(node) {
    if (!node || node === document.body) return null;
    if (node.id) return '#' + node.id;
    if (node.classList && node.classList.contains('close-x')) return '.close-x';
    var k = node.getAttribute && node.getAttribute('data-key');
    return k ? '[data-key="' + k + '"]' : null;
  }
  function restoreFocus(el, key) {
    if (!key) return null;
    var n = el.querySelector(key);
    if (!n) return null;
    if (n.disabled) return key;
    try { n.focus(); } catch (e) {}
    return null;
  }
  /* the control that opened the drawer, remembered so closing can hand
     focus back to it (the Details button, the row, the calendar entry) */
  function rememberOpener(ui, el) {
    var a = document.activeElement;
    if (!a || a === document.body || el.contains(a)) { ui.drawerOpener = null; return; }
    var panel = a.closest ? a.closest('[data-panel]') : null;
    ui.drawerOpener = {
      node: a,
      id: a.id || null,
      panel: panel ? panel.getAttribute('data-panel') : null,
      label: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 80),
      tag: a.tagName,
    };
  }
  function visible(n) { return !!n && n.offsetParent !== null; }
  function returnFocus(ui) {
    var op = ui.drawerOpener;
    ui.drawerOpener = null;
    if (!op) return false;
    var n = op.node;
    if (!(n && document.contains(n) && visible(n))) n = null;
    if (!n && op.id) { n = document.getElementById(op.id); if (!visible(n)) n = null; }
    if (!n && op.panel && op.label) {
      /* the opener was redrawn: find its twin by panel and label */
      var slot = document.querySelector('[data-panel="' + op.panel + '"]');
      var cands = slot ? slot.querySelectorAll(op.tag || 'button') : [];
      for (var i = 0; i < cands.length && !n; i++) {
        var c = cands[i];
        var lbl = (c.getAttribute('aria-label') || c.textContent || '').trim().slice(0, 80);
        if (lbl === op.label && visible(c)) n = c;
      }
    }
    if (!n) return false;
    try { n.focus(); } catch (e) { return false; }
    return document.activeElement === n;
  }
  /* a sheet sits above the drawer (the keyboard shortcuts, the targeting
     wizard, or any piece that set CMC.ui.sheetOpen); while one is open the
     keys belong to it. The drawer itself is what makes CMC.modalOpen() true,
     so the check reads the documented ui keys for the layers above it. */
  function sheetOnTop() {
    var u = CMC.ui;
    return !!(u.jvSheet || u.tgWizard || u.sheetOpen);
  }
  function trapTab(ev) {
    var aside = document.querySelector('.drawer-aside.dw');
    if (!aside) return;
    var list = Array.prototype.slice.call(aside.querySelectorAll(FOCUSABLE)).filter(visible);
    if (!list.length) return;
    var first = list[0];
    var last = list[list.length - 1];
    var t = ev.target;
    if (!aside.contains(t)) { ev.preventDefault(); first.focus(); return; }
    if (ev.shiftKey && t === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && t === last) { ev.preventDefault(); first.focus(); }
  }

  /* ---------------- pieces ------------------------------------------------ */
  function fact(label, value, opts) {
    var h = CMC.h;
    opts = opts || {};
    return h('div', { class: 'dw-fact' + (opts.wide ? ' is-wide' : '') },
      h('span', { class: 'dw-fk' }, label),
      typeof value === 'string'
        ? h('span', { class: 'dw-fv' + (opts.mono ? ' mono' : '') + (opts.muted ? ' muted' : '') }, value)
        : value);
  }
  function statusSelect(app, st, busy, ui) {
    var h = CMC.h;
    var known = false;
    var opts = STATUSES.map(function (o) {
      if (o.value === st) known = true;
      return h('option', { value: o.value }, o.label);
    });
    if (!known) opts.unshift(h('option', { value: st, disabled: true }, statusLabel(st)));
    var sel = h('select', {
      id: 'dw-status', 'aria-label': 'Status',
      disabled: busy ? true : null,
      onchange: function (ev) { onStatus(app, ev.target.value, ui); },
    }, opts);
    sel.value = st;
    return h('span', { class: 'select-wrap dw-sel', 'data-k': CMC.statusKind(st) }, sel);
  }
  function roundSelect(app, busy, ui, state) {
    var h = CMC.h;
    var cur = ROUNDS.indexOf(app.round) >= 0 ? app.round : '';
    var sel = h('select', {
      id: 'dw-round', 'aria-label': 'Interview round',
      disabled: busy ? true : null,
      onchange: function (ev) { onRound(app, ev.target.value, ui, state); },
    }, [h('option', { value: '' }, 'None')].concat(ROUNDS.map(function (r) { return h('option', { value: r }, r); })));
    sel.value = cur;
    return h('span', { class: 'select-wrap dw-sel', 'data-k': cur ? 'ivl' : 'idle' }, sel);
  }
  function scoreBlock(app) {
    var h = CMC.h;
    var v = verdict(app);
    return h('span', { class: 'dw-score' },
      hasScore(app)
        ? h('span', { class: 'dw-score-n mono' + bandClass(app.score), title: 'Fit score ' + app.score.toFixed(1) + ' out of 5' }, app.score.toFixed(1), h('small', null, '/5'))
        : h('span', { class: 'dw-score-na' }, 'Not scored'),
      h('span', { class: 'chip chip-' + v.kind }, h('span', { class: 'dot dot-' + v.kind }), v.word));
  }
  function queueBlock(q) {
    var h = CMC.h;
    var idx = QUEUE_STATES.indexOf(q.state);
    if (idx < 0) idx = 0;
    var kind = CMC.statusKind(q.state);
    return h('div', { class: 'dw-sec dw-queue' },
      h('span', { class: 'dw-k' }, 'Apply queue'),
      h('div', { class: 'chip-row', role: 'list', 'aria-label': 'Queue progress, step ' + (idx + 1) + ' of 5: ' + QUEUE_STATES[idx] },
        QUEUE_STATES.map(function (s, i) {
          /* done steps carry a check, the current one a status dot, the
             rest wait in faint text: the word is always there */
          if (i < idx) return h('span', { class: 'chip is-done', role: 'listitem', title: s + ', done' }, checkIcon(), s);
          if (i === idx) return h('span', { class: 'chip chip-' + kind + ' is-current', role: 'listitem', 'aria-current': 'step' }, h('span', { class: 'dot dot-' + kind }), s);
          return h('span', { class: 'chip is-todo', role: 'listitem' }, s);
        })),
      q.blocked ? h('p', { class: 'dw-sub dw-onhold' }, 'On hold. Waiting on ' + (q.blocked.waitingOn || 'a reply') + '. ' + (q.blocked.reason || '')) : null,
      q.note ? h('p', { class: 'dw-sub' }, q.note) : null);
  }
  /* the posting itself, saved on the application doc as description (plain text).
     Blank lines split paragraphs; a paragraph whose lines all start with a dash
     or bullet becomes a list. Expanding never rebuilds the drawer, so the
     scroll position stays where Chris is reading. */
  function descBlock(app, ui) {
    var h = CMC.h;
    var text = String(app.description || '').replace(/\s*[\u2014\u2013]\s*/g, ' - ').trim();
    var kids = [h('span', { class: 'dw-k' }, 'Job description')];
    if (app.postedAt) kids.push(h('p', { class: 'dw-posted' }, 'Posted ' + CMC.fmt.date(app.postedAt)));
    if (!text) {
      kids.push(h('p', { class: 'dw-sub' }, 'The full posting is not saved here yet. Use Open the posting below to read it on the company site.'));
      return h('div', { class: 'dw-sec dw-desc' }, kids);
    }
    var open = !!ui.dwDescOpen;
    var paras = text.split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean);
    var body = paras.map(function (p) {
      var lines = p.split(/\n/).map(function (l) { return l.trim(); }).filter(Boolean);
      var isList = lines.length > 0 && lines.every(function (l) { return /^[-\u2022*]\s+/.test(l); });
      if (isList) return h('ul', { class: 'dw-dlist' }, lines.map(function (l) { return h('li', null, l.replace(/^[-\u2022*]\s+/, '')); }));
      return h('p', { class: 'dw-dp' }, lines.join(' '));
    });
    kids.push(h('div', { class: 'dw-desc-body' + (open ? ' is-open' : ''), id: 'dw-desc-body' }, body));
    kids.push(h('button', {
      type: 'button', class: 'chip-btn dw-desc-toggle', id: 'dw-desc-toggle',
      'aria-expanded': open ? 'true' : 'false', 'aria-controls': 'dw-desc-body',
      onclick: function (ev) {
        var box = document.getElementById('dw-desc-body');
        if (!box) return;
        var now = !box.classList.contains('is-open');
        box.classList.toggle('is-open', now);
        ui.dwDescOpen = now;
        ev.currentTarget.setAttribute('aria-expanded', now ? 'true' : 'false');
        ev.currentTarget.textContent = now ? 'Show less' : 'Read the full description';
      },
    }, open ? 'Show less' : 'Read the full description'));
    return h('div', { class: 'dw-sec dw-desc' }, kids);
  }
  /* the queue doc carries the saved draft links (docs: [{ label, url }]),
     so the drawer shows the same tap-to-open files the Apply queue does */
  function docsBlock(app, q) {
    var h = CMC.h;
    var co = app.company || 'Company';
    var docs = (q && Array.isArray(q.docs)) ? q.docs : (Array.isArray(app.docs) ? app.docs : []);
    var items = [];
    var hasLinks = false;
    docs.forEach(function (d) {
      if (!d) return;
      var label = String(d.label || d.name || '').trim() || 'Document';
      var gh = CMC.safeUrl(d.url);
      var here = CMC.safeUrl(d.alt);
      /* the copy stored with the dashboard opens with no sign-in, so it is
         the main link; GitHub is the second copy */
      var url = here || gh;
      var alt = here ? gh : '';
      if (url) {
        hasLinks = true;
        items.push(h('li', { class: 'dw-file' }, fileIcon(),
          h('a', {
            class: 'dw-filelink', href: url, target: '_blank', rel: 'noopener noreferrer',
            title: 'Open ' + label + ' in a new tab',
          }, label, outIcon()),
          alt && alt !== url ? h('a', {
            class: 'dw-docalt', href: alt, target: '_blank', rel: 'noopener noreferrer',
            title: 'Open the GitHub copy of ' + label + ' in a new tab (needs a GitHub sign-in)',
          }, 'GitHub copy') : null));
      } else {
        items.push(h('li', { class: 'dw-file' }, fileIcon(), h('span', null, label)));
      }
    });
    if (!items.length) {
      var qs = q ? q.state : '';
      var msg = 'Not prepped yet. Tap Apply and Claude drafts a tailored resume, a signed cover letter and the portal answers for your OK.';
      if (qs === 'ready' || qs === 'approved' || qs === 'submitted') msg = 'The drafts exist, but their links are not saved on this job yet.';
      else if (qs === 'prepping') msg = 'Claude is building the resume, cover letter and portal answers now.';
      else if (qs === 'requested') msg = 'In line. Claude builds the resume, cover letter and portal answers next.';
      return h('div', { class: 'dw-sec dw-docs' },
        h('span', { class: 'dw-k' }, 'Documents'),
        h('p', { class: 'dw-sub' }, msg));
    }
    return h('div', { class: 'dw-sec dw-docs' },
      h('span', { class: 'dw-k' }, 'Documents'),
      h('ul', { class: 'dw-files' }, items),
      h('p', { class: 'dw-sub' }, 'Tap a file to open it. The GitHub copy beside each is a second copy that needs a GitHub sign-in (account mccawc1). Chris reviews everything before anything is sent.'));
  }
  /* emails about this job (mail docs whose appId or company match), newest
     first; the whole section stays out of the way when there are none */
  function mailBlock(app, state) {
    var h = CMC.h;
    var kinds = { applied: 'info', reply: 'good', screening: 'warn', interview: 'ivl', offer: 'good', closed: 'bad', account: 'idle', alert: 'idle' };
    var words = { applied: 'Applied', reply: 'Reply', screening: 'Screening', interview: 'Interview', offer: 'Offer', closed: 'Closed', account: 'Account', alert: 'Alert' };
    var co = String(app.company || '').toLowerCase();
    var rows = (state.mail || []).filter(function (m) {
      if (m.appId) return m.appId === app.id;
      return !!co && String(m.company || '').toLowerCase() === co;
    }).sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
    if (!rows.length) return null;
    return h('div', { class: 'dw-sec dw-mail' },
      h('span', { class: 'dw-k' }, 'Emails'),
      h('ul', { class: 'dw-files' }, rows.slice(0, 6).map(function (m) {
        var url = CMC.safeUrl(m.url);
        var kind = kinds[m.stage] || 'idle';
        var subject = String(m.subject || '(no subject)').replace(/\s*[\u2014\u2013]\s*/g, ' - ');
        return h('li', { class: 'dw-file' },
          h('span', { class: 'chip chip-' + kind }, h('span', { class: 'dot dot-' + kind }), words[m.stage] || 'Email'),
          url ? h('a', {
            class: 'dw-filelink', href: url, target: '_blank', rel: 'noopener noreferrer',
            title: 'Open this email in Gmail in a new tab',
          }, subject, outIcon()) : h('span', null, subject),
          m.date ? h('span', { class: 'dw-when' }, CMC.fmt.date(m.date)) : null);
      })),
      h('p', { class: 'dw-sub' }, 'Tap an email to open it in Gmail. Claude sorts these from Chris\'s mailbox.'));
  }
  function actionRow(app, st, q, busy, ui, state) {
    var h = CMC.h;
    var btns = CLOSED[st] ? moveButtons(app, st).filter(function (b) { return !b.apply; }) : moveButtons(app, st);
    var canSubmit = !CLOSED[st] && (st === 'queued' || st === 'Evaluated' || st === 'found')
      && ((q && (q.state === 'ready' || q.state === 'approved')) || !!app.prepped);
    var url = CMC.safeUrl(app.url);
    /* Open the form (Chris, Oct 16): same link as the queue card, so the
       Find a company path also opens the page and copies the prompt */
    var formUrl = q && q.helper && (q.state === 'ready' || q.state === 'approved') ? CMC.safeUrl(q.helper.page) : '';
    return h('div', { class: 'dw-actions' },
      btns.map(function (b) {
        return h('button', {
          type: 'button',
          class: 'btn ' + (b.primary ? 'btn-primary' : 'btn-ghost'),
          'data-key': b.label,
          disabled: busy ? true : null,
          onclick: function () {
            if (b.apply) onApply(app, ui, q);
            else onMove(app, ui, state, b);
          },
        }, busy ? 'Saving...' : b.label);
      }),
      canSubmit ? h('button', {
        type: 'button', class: 'btn btn-ghost dw-submitted', disabled: busy ? true : null,
        'data-key': 'submitted',
        title: 'Mark it Applied because you sent it yourself',
        onclick: function () { onSubmitted(app, ui); },
      }, busy ? 'Saving...' : 'Chris submitted it') : null,
      url ? h('a', { class: 'dw-open', href: url, target: '_blank', rel: 'noopener noreferrer', 'data-key': 'open' }, 'Open the posting', outIcon()) : null,
      formUrl ? h('a', {
        class: 'dw-open', href: formUrl, target: '_blank', rel: 'noopener noreferrer', 'data-key': 'openform',
        title: 'Opens the application page in a new tab and copies the Claude prompt, ready to paste into the Claude panel there.',
        onclick: function () { if (typeof CMC.openForm === 'function') CMC.openForm(q); },
      }, 'Open the form', outIcon()) : null);
  }

  /* ---------------- render ------------------------------------------------ */
  function render(el, state, ui) {
    var h = CMC.h, fmt = CMC.fmt;
    var id = ui.drawerOpen || null;
    var app = id ? find(state.applications, id) : null;

    if (!app) {
      /* closed, or the application vanished under us: clear the slot and
         hand focus back to whatever opened the drawer */
      var hadFocus = el.contains(document.activeElement) && document.activeElement !== document.body;
      el.textContent = '';
      document.body.classList.remove('dw-lock');
      if (id) ui.drawerOpen = null;
      var wasOpen = lastOpen !== null;
      lastOpen = null;
      pendingFocus = null;
      if (wasOpen || hadFocus) {
        if (!returnFocus(ui) && document.activeElement && document.activeElement !== document.body) {
          try { document.activeElement.blur(); } catch (e) {}
        }
      } else {
        ui.drawerOpener = null;
      }
      return;
    }

    var now = Date.now();
    var q = anyQueueDoc(state, app.id);
    var st = effStatus(app);
    var busy = !!busyMap(ui)[app.id];
    var age = ageDays(app, now);
    var opening = lastOpen !== id;
    if (opening) ui.dwDescOpen = false;
    if (lastOpen === null) rememberOpener(ui, el);
    var keep = opening ? null : (focusKey(el.contains(document.activeElement) ? document.activeElement : null) || pendingFocus);

    var facts = [
      fact('Status', statusSelect(app, st, busy, ui)),
      fact('Score', scoreBlock(app)),
      fact('Found', app.dateFound ? fmt.date(app.dateFound) : 'Unknown', { mono: true, muted: !app.dateFound }),
      fact('Applied', app.dateApplied ? fmt.date(app.dateApplied) : 'Not yet', { mono: true, muted: !app.dateApplied }),
    ];
    if (age !== null) facts.push(fact('Age', age + (age === 1 ? ' day' : ' days') + ' since it went out', { mono: true }));
    facts.push(fact('Round', roundSelect(app, busy, ui, state)));
    if (app.pay) facts.push(fact('Pay', String(app.pay), { mono: true }));
    if (app.location) facts.push(fact('Location', String(app.location), { wide: true }));
    if (app.platform) facts.push(fact('Platform', String(app.platform)));
    if (app.nextDate) facts.push(fact('Next step', fmt.date(app.nextDate) || String(app.nextDate), { mono: true }));

    var closeBtn = h('button', {
      type: 'button', class: 'btn btn-ghost close-x', 'aria-label': 'Close',
      onclick: function () { CMC.closeDrawer(); },
    }, xIcon());

    var aside = h('aside', {
      class: 'drawer-aside dw', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dw-title',
    },
      h('div', { class: 'panel-head dw-head' },
        h('div', { class: 'dw-titles' },
          h('span', { class: 'dw-k' }, 'Job details'),
          h('h2', { class: 'dw-co', id: 'dw-title' }, app.company || 'Unknown company'),
          h('p', { class: 'dw-role' }, app.role || '')),
        closeBtn),
      h('div', { class: 'panel-body dw-body' },
        h('div', { class: 'dw-facts' }, facts),
        app.notes ? h('div', { class: 'dw-sec dw-notes' },
          h('span', { class: 'dw-k' }, 'Notes'),
          h('p', null, String(app.notes))) : null,
        descBlock(app, ui),
        docsBlock(app, q),
        q && q.helper && typeof CMC.helperBlock === 'function' ? CMC.helperBlock(q, 'dw-helper-' + app.id, CMC.ui, 'drawer') : null,
        mailBlock(app, state),
        q ? queueBlock(q) : null,
        actionRow(app, st, q, busy, ui, state)));

    el.textContent = '';
    el.appendChild(h('div', { class: 'overlay dw-backdrop', onclick: function () { CMC.closeDrawer(); } }));
    el.appendChild(aside);
    document.body.classList.add('dw-lock');
    if (opening) {
      pendingFocus = null;
      try { closeBtn.focus(); } catch (e) {}
    } else {
      pendingFocus = restoreFocus(el, keep);
    }
    lastOpen = id;
  }

  /* Escape closes the drawer from anywhere on the page, unless a sheet is
     open above it (that one closes first, on its own Escape). Tab stays
     inside the drawer while it is open. */
  document.addEventListener('keydown', function (ev) {
    if (!CMC.ui.drawerOpen) return;
    if (ev.key === 'Escape') {
      if (ev.defaultPrevented || sheetOnTop()) return;
      ev.preventDefault();
      CMC.closeDrawer();
      return;
    }
    if (ev.key === 'Tab' && !ev.defaultPrevented && !sheetOnTop()) trapTab(ev);
  });

  CMC.register('drawer', { render: render });
})();
