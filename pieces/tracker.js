/* piece: tracker: the full table of every application on the board. Search,
   status chips with counts, sortable headers, inline Status and Round
   dropdowns, a Details button and row click that open the job drawer.
   Reads CMC.state, writes only through CMC.act.*, UI state lives in CMC.ui
   (trQuery, trFilter, trSort, trDir, appBusy, plus trFocus and trFocusTries
   for the control to focus after the next rebuild). Queue facts come from
   the shared helpers: CMC.queueFor says whether a row is still in the Apply
   queue, CMC.act.retireQueue takes a row out of it when its status moves. */
(function () {
  'use strict';
  var CMC = window.CMC;
  if (!CMC) return;

  var NS = 'http://www.w3.org/2000/svg';

  /* exact status values; the words Chris sees are plainer */
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
  var CHIPS = [
    { key: 'all', label: 'All' },
    { key: 'Evaluated', label: 'New' },
    { key: 'queued', label: 'In queue' },
    { key: 'Applied', label: 'Applied' },
    { key: 'Responded', label: 'Heard back' },
    { key: 'Interview', label: 'Interview' },
    { key: 'Offer', label: 'Offer' },
    { key: 'Hired', label: 'Hired' },
    { key: 'Rejected', label: 'Rejected' },
    { key: 'Discarded', label: 'Passed' },
  ];
  var STATUS_RANK = { Hired: 0, Offer: 1, Interview: 2, Responded: 3, Applied: 4, queued: 5, Evaluated: 6, found: 7, Rejected: 8, Discarded: 9 };
  /* stages that sit before Interview: picking a round moves these to Interview.
     Offer, Hired, Rejected and Discarded keep their status and only get the round */
  var BEFORE_INTERVIEW = { found: 1, Evaluated: 1, queued: 1, Applied: 1, Responded: 1 };
  /* closed rows get no new interview record */
  var CLOSED = { Rejected: 1, Discarded: 1 };
  /* mission-log kind per status, same buckets the activity feed draws */
  var LOG_KIND = { Evaluated: 'found', Applied: 'applied', Responded: 'system', Interview: 'interview', Offer: 'offer', Hired: 'win', Rejected: 'system', Discarded: 'system' };
  var COLS = [
    { key: 'num', label: '#', dir: 'asc', cls: 'tr-c-num', hint: 'Order found, oldest first' },
    { key: 'found', label: 'Found', dir: 'desc', cls: 'tr-c-found', hint: 'When Claude found it' },
    { key: 'applied', label: 'Applied', dir: 'desc', cls: 'tr-c-applied', hint: 'When it went out' },
    { key: 'age', label: 'Age', dir: 'desc', cls: 'tr-c-age', hint: 'Days since it went out' },
    { key: 'company', label: 'Company', dir: 'asc', cls: 'tr-c-co', hint: 'Company name' },
    { key: 'role', label: 'Role', dir: 'asc', cls: 'tr-c-role', hint: 'Job title' },
    { key: 'score', label: 'Score', dir: 'desc', cls: 'tr-c-score', hint: 'Fit score out of 5, unscored last' },
    { key: 'status', label: 'Status', dir: 'asc', cls: 'tr-c-status', hint: 'Furthest along first' },
    { key: 'round', label: 'Round', dir: 'asc', cls: 'tr-c-round', hint: 'Interview round' },
  ];
  var DAY = 24 * 60 * 60 * 1000;

  /* ---------------- icons (inline svg, currentColor) --------------------- */
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
  function sortIcon(dir) {
    return icon(11, [['path', { d: dir === 'asc' ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6' }]], '2.6');
  }
  function outIcon() {
    return icon(14, [
      ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }],
      ['polyline', { points: '15 3 21 3 21 9' }],
      ['line', { x1: 10, y1: 14, x2: 21, y2: 3 }],
    ], '2');
  }
  function searchIcon() {
    return icon(15, [
      ['circle', { cx: 11, cy: 11, r: 7 }],
      ['line', { x1: 21, y1: 21, x2: 16.2, y2: 16.2 }],
    ], '2');
  }
  function tableIcon() {
    return icon(26, [
      ['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }],
      ['line', { x1: 3, y1: 10, x2: 21, y2: 10 }],
      ['line', { x1: 3, y1: 15, x2: 21, y2: 15 }],
      ['line', { x1: 9, y1: 10, x2: 9, y2: 20 }],
    ]);
  }

  /* ---------------- small helpers ---------------------------------------- */
  function find(arr, id) {
    for (var i = 0; i < (arr || []).length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }
  /* the status Chris sees: a new row with a live prep request shows as
     In queue. CMC.queueFor ignores submitted queue docs, so a finished
     request never pulls a re-opened row back into the queue */
  function effStatus(app) {
    if (app.status === 'queued') return 'queued';
    if ((app.status === 'Evaluated' || app.status === 'found') && CMC.queueFor(app.id)) return 'queued';
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
  /* whole days since it went out, only while the row sits in Applied */
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

  /* ---------------- data actions ----------------------------------------- */
  function onStatus(app, value, ui) {
    if (busyMap(ui)[app.id]) return;
    if (!value || value === app.status) return;
    busyMap(ui)[app.id] = true;
    /* a row that leaves the queue takes its prep request with it: Applied
       marks the queue doc submitted, anything else deletes it. The note is
       the phrase the log line ends with when a doc was pulled */
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
    /* read these before any write: the patch changes app.status in place */
    var flipped = !!(round && BEFORE_INTERVIEW[app.status]);
    var closed = !!CLOSED[app.status];
    var patch = { round: round };
    if (flipped) {
      /* the row moves to Interview in the same write as the round, with the
         stamp setAppStatus would put on it, so the doc is set once, not twice */
      patch.status = 'Interview';
      patch.statusChangedAt = nowIso();
    }
    var writes = [CMC.act.updateDoc('applications', app.id, patch)];
    if (round) {
      var note = '';
      if (flipped) {
        /* the row left for Interview, so its prep request is done with */
        var r = CMC.act.retireQueue(app.id, 'Interview');
        if (r.write) writes.push(r.write);
        note = r.note;
      }
      var has = false;
      (state.interviews || []).forEach(function (iv) { if (iv.appId === app.id) has = true; });
      if (!has && !closed) {
        var ts = nowIso();
        writes.push(CMC.act.setDoc('interviews', CMC.newId('iv'), {
          appId: app.id, company: app.company || '', role: app.role || '', round: round,
          format: 'Video', date: null, time: null, notes: '', createdAt: ts, updatedAt: ts,
        }));
      }
      CMC.act.addActivity((flipped ? 'Interview booked with ' + co + ': ' + round + '.' : co + ' is now at ' + round + '.') + note, 'interview');
    } else {
      CMC.act.addActivity('Round cleared for ' + co + '.', 'system');
    }
    var fin = finishBusy(ui, app.id);
    Promise.all(writes).then(fin, fin);
  }

  /* ---------------- ui actions ------------------------------------------- */
  function onChip(key, ui) {
    ui.trFilter = key === 'all' ? null : key;
    CMC.rerender('tracker');
  }
  function onSort(col, ui) {
    if (ui.trSort === col.key) ui.trDir = ui.trDir === 'asc' ? 'desc' : 'asc';
    else { ui.trSort = col.key; ui.trDir = col.dir; }
    CMC.rerender('tracker');
  }
  /* the focus keeper in render() puts the caret back where Chris was typing */
  function onSearch(ev, ui) {
    ui.trQuery = ev.target.value;
    CMC.rerender('tracker');
  }
  /* the Show everything button goes away with the empty state, so focus
     moves to the search box it just cleared */
  function clearAll(ui) {
    ui.trQuery = '';
    ui.trFilter = null;
    ui.trFocus = ['.tr-search'];
    CMC.rerender('tracker');
  }

  /* ---------------- focus across the rebuild ------------------------------ */
  /* Every render tears the slot down, so the control Chris had focused is
     found again on the new DOM by a key: the row id plus the cell for a
     Status or Round select, the posting link or the Details button; the
     column for a sort header; the filter for a chip; the search box, caret
     included. A handler can hand off in ui.trFocus (one key or a list to try
     in order). A twin that is still saving (disabled) is retried on the next
     render, which the finished write triggers. Nothing is focused while a
     sheet or the drawer is on top. */
  var FOCUS_TRIES = 12;
  function cssStr(s) {
    s = String(s);
    return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
  }
  function rowKey(id, cell, ctl) { return 'tr.tr-row[data-id="' + cssStr(id) + '"] td.' + cell + ' ' + ctl; }
  function cellClass(node) {
    var m = /(^|\s)(tr-c-[a-z]+)(\s|$)/.exec(node.className || '');
    return m ? m[2] : null;
  }
  function focusPlan(el, ui) {
    var plan = { keys: [], sel: null };
    if (ui.trFocus) {
      plan.keys = [].concat(ui.trFocus);
      ui.trFocus = null;
      return plan;
    }
    var ae = document.activeElement;
    if (!ae || ae === document.body || !el.contains(ae) || !ae.closest) return plan;
    if (ae.classList.contains('tr-search')) {
      plan.keys.push('.tr-search');
      try { if (typeof ae.selectionStart === 'number') plan.sel = [ae.selectionStart, ae.selectionEnd]; } catch (e) { plan.sel = null; }
      return plan;
    }
    var tr = ae.closest('tr.tr-row');
    var td = ae.closest('td');
    var cell = td ? cellClass(td) : null;
    if (tr && cell && tr.getAttribute('data-id')) {
      var ctl = ae.tagName === 'SELECT' ? 'select' : ae.tagName === 'A' ? 'a' : 'button';
      plan.keys.push(rowKey(tr.getAttribute('data-id'), cell, ctl));
      /* the row can leave the shown list (a filter, a status move under a
         chip): the same control on the next row, then the one before, then
         the pressed chip, then the search box */
      var rows = tr.parentNode ? tr.parentNode.querySelectorAll('tr.tr-row') : [];
      var i = Array.prototype.indexOf.call(rows, tr);
      if (i >= 0 && rows[i + 1]) plan.keys.push(rowKey(rows[i + 1].getAttribute('data-id'), cell, ctl));
      if (i > 0) plan.keys.push(rowKey(rows[i - 1].getAttribute('data-id'), cell, ctl));
      plan.keys.push('.tr-chips button[aria-pressed="true"]', '.tr-search');
      return plan;
    }
    var th = ae.closest('th');
    if (th && cellClass(th)) {
      plan.keys.push('th.' + cellClass(th) + ' > button');
      return plan;
    }
    var chip = ae.closest('.tr-chips button');
    if (chip && chip.getAttribute('data-key')) {
      plan.keys.push('.tr-chips button[data-key="' + cssStr(chip.getAttribute('data-key')) + '"]', '.tr-chips button[aria-pressed="true"]');
      return plan;
    }
    if (ae.closest('.tr-empty')) plan.keys.push('.tr-empty button', '.tr-search');
    return plan;
  }
  function applyFocus(el, ui, plan) {
    for (var i = 0; i < plan.keys.length; i++) {
      var f = el.querySelector(plan.keys[i]);
      if (!f) continue;
      if (f.disabled) {
        /* the twin is still saving: wait for it rather than jump to a
           neighbour; the finished write rebuilds the table and tries again */
        if ((ui.trFocusTries || 0) < FOCUS_TRIES) {
          ui.trFocus = plan.keys.slice(i);
          ui.trFocusTries = (ui.trFocusTries || 0) + 1;
        } else {
          ui.trFocusTries = 0;
        }
        return;
      }
      try { f.focus({ preventScroll: true }); } catch (e) { try { f.focus(); } catch (e2) { /* not focusable */ } }
      if (document.activeElement !== f) continue;
      if (plan.sel) { try { f.setSelectionRange(plan.sel[0], plan.sel[1]); } catch (e3) { /* not a text box */ } }
      break;
    }
    ui.trFocusTries = 0;
  }

  /* ---------------- sorting ---------------------------------------------- */
  function sortValue(app, key, ctx) {
    switch (key) {
      case 'num': return ctx.numOf[app.id];
      case 'found': return Date.parse(app.dateFound || '') || null;
      case 'applied': return Date.parse(app.dateApplied || '') || null;
      case 'age': return ageDays(app, ctx.now);
      case 'company': return app.company ? String(app.company).toLowerCase() : null;
      case 'role': return app.role ? String(app.role).toLowerCase() : null;
      case 'score': return hasScore(app) ? app.score : null;
      case 'status': { var r = STATUS_RANK[ctx.effOf[app.id]]; return r === undefined ? 10 : r; }
      case 'round': { var i = ROUNDS.indexOf(app.round); return i < 0 ? null : i; }
      default: return null;
    }
  }
  function compareRows(a, b, key, dir, ctx) {
    var va = sortValue(a, key, ctx);
    var vb = sortValue(b, key, ctx);
    var m = dir === 'asc' ? 1 : -1;
    /* blanks and unscored always sink to the bottom, whichever way we sort */
    if (va === null && vb === null) return tieBreak(a, b);
    if (va === null) return 1;
    if (vb === null) return -1;
    var c = 0;
    if (typeof va === 'string') c = va.localeCompare(vb);
    else c = va - vb;
    if (c !== 0) return c * m;
    return tieBreak(a, b);
  }
  function tieBreak(a, b) {
    var c = String(b.dateFound || '').localeCompare(String(a.dateFound || ''));
    if (c !== 0) return c;
    return String(a.id).localeCompare(String(b.id));
  }

  /* ---------------- cells ------------------------------------------------ */
  function statusSelect(app, st, kind, busy, ui) {
    var h = CMC.h;
    var known = false;
    var opts = STATUSES.map(function (o) {
      if (o.value === st) known = true;
      return h('option', { value: o.value }, o.label);
    });
    if (!known) opts.unshift(h('option', { value: st, disabled: true }, statusLabel(st)));
    var sel = h('select', {
      'aria-label': 'Status for ' + (app.company || 'this application'),
      disabled: busy ? true : null,
      onchange: function (ev) { onStatus(app, ev.target.value, ui); },
    }, opts);
    sel.value = st;
    return h('span', { class: 'select-wrap is-compact', 'data-k': kind }, sel);
  }
  function roundSelect(app, busy, ui, state) {
    var h = CMC.h;
    var cur = ROUNDS.indexOf(app.round) >= 0 ? app.round : '';
    var sel = h('select', {
      'aria-label': 'Interview round for ' + (app.company || 'this application'),
      disabled: busy ? true : null,
      onchange: function (ev) { onRound(app, ev.target.value, ui, state); },
    }, [h('option', { value: '' }, 'None')].concat(ROUNDS.map(function (r) { return h('option', { value: r }, r); })));
    sel.value = cur;
    return h('span', { class: 'select-wrap is-compact', 'data-k': cur ? 'ivl' : 'idle' }, sel);
  }
  function scoreCell(app) {
    var h = CMC.h;
    if (!hasScore(app)) return h('span', { class: 'tr-score-na', title: 'Claude has not scored this one yet' }, 'Not scored');
    var text = app.score.toFixed(1);
    return h('span', { class: 'tr-score mono' + bandClass(app.score), title: 'Fit score ' + text + ' out of 5' }, text, h('small', null, '/5'));
  }

  function row(app, ctx) {
    var h = CMC.h, fmt = CMC.fmt, ui = ctx.ui;
    var st = ctx.effOf[app.id];
    var kind = CMC.statusKind(st);
    var busy = !!busyMap(ui)[app.id];
    var age = ageDays(app, ctx.now);
    var url = CMC.safeUrl(app.url);
    var co = app.company || '';

    return h('tr', {
      class: 'tr-row is-clickable' + (busy ? ' is-busy' : ''),
      'data-k': kind,
      'data-id': app.id,
      onclick: function (ev) {
        /* controls inside the row do their own job; anywhere else opens the drawer */
        if (ev.target.closest('button, a, select, input, label, option')) return;
        CMC.openDrawer(app.id);
      },
    },
      h('td', { class: 'tr-c-num num mono muted' }, String(ctx.numOf[app.id])),
      h('td', { class: 'tr-c-found mono' }, fmt.date(app.dateFound)),
      h('td', { class: 'tr-c-applied mono' }, app.dateApplied ? fmt.date(app.dateApplied) : ''),
      h('td', { class: 'tr-c-age num mono' + (age !== null && age >= 7 ? ' is-warn' : '') + (age === null ? ' muted' : ''),
        title: age === null ? '' : age + (age === 1 ? ' day' : ' days') + ' since it went out' },
        age === null ? '' : age + 'd'),
      h('td', { class: 'tr-c-co co' },
        h('span', { class: 'tr-co' }, co),
        h('span', { class: 'tr-role-s muted' }, app.role || '')),
      h('td', { class: 'tr-c-role muted' }, app.role || ''),
      h('td', { class: 'tr-c-score num' }, scoreCell(app)),
      h('td', { class: 'tr-c-status' }, statusSelect(app, st, kind, busy, ui)),
      h('td', { class: 'tr-c-round' }, roundSelect(app, busy, ui, ctx.state)),
      h('td', { class: 'tr-c-links' },
        h('div', { class: 'tr-links' },
          url ? h('a', {
            class: 'tr-out', href: url, target: '_blank', rel: 'noopener noreferrer',
            'aria-label': 'Open the posting for ' + (co || 'this job'), title: 'Open the posting',
          }, outIcon()) : h('span', { class: 'tr-out is-none', title: 'No link on file' }, outIcon()),
          h('button', {
            type: 'button', class: 'btn btn-ghost tr-details',
            'aria-label': 'Details for ' + (co || 'this job'),
            onclick: function () { CMC.openDrawer(app.id); },
          }, 'Details'))));
  }

  function headCell(col, ui) {
    var h = CMC.h;
    var active = ui.trSort === col.key;
    var dir = active ? ui.trDir : null;
    return h('th', {
      scope: 'col', class: col.cls,
      'aria-sort': active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none',
    }, h('button', {
      type: 'button',
      title: col.hint + '. Tap to sort' + (active ? ' the other way' : '') + '.',
      onclick: function () { onSort(col, ui); },
    }, col.label, active ? sortIcon(dir) : null));
  }

  /* phone: the fade on the right edge goes away once the wrap is scrolled to its end */
  function markScrollEnd(wrap) {
    var frame = wrap.parentNode;
    if (!frame) return;
    var atEnd = wrap.scrollWidth - wrap.clientWidth - wrap.scrollLeft <= 1;
    if (atEnd) frame.classList.add('is-at-end');
    else frame.classList.remove('is-at-end');
  }

  function emptyState(ui, filtered) {
    var h = CMC.h;
    return h('div', { class: 'tr-empty' },
      tableIcon(),
      h('span', { class: 'tr-empty-t' }, filtered ? 'Nothing matches' : 'No applications yet.'),
      h('p', { class: 'tr-empty-s' }, filtered
        ? 'Try another word, or show everything on the board.'
        : 'When Claude finds and scores a match it lands here.'),
      filtered ? h('button', {
        type: 'button', class: 'btn btn-ghost',
        onclick: function () { clearAll(ui); },
      }, 'Show everything') : null);
  }

  /* ---------------- render ------------------------------------------------ */
  function render(el, state, ui) {
    var h = CMC.h;
    var apps = state.applications || [];
    var now = Date.now();
    if (!ui.trSort) { ui.trSort = 'found'; ui.trDir = 'desc'; }

    /* the shown status of every row, read once per render */
    var effOf = {};
    apps.forEach(function (a) { effOf[a.id] = effStatus(a); });

    /* stable row number: order found, oldest first */
    var numOf = {};
    apps.slice().sort(function (a, b) {
      var c = String(a.dateFound || '').localeCompare(String(b.dateFound || ''));
      return c !== 0 ? c : String(a.id).localeCompare(String(b.id));
    }).forEach(function (a, i) { numOf[a.id] = i + 1; });

    var ctx = { state: state, ui: ui, now: now, effOf: effOf, numOf: numOf };
    /* who has focus, noted before the slot is torn down */
    var plan = focusPlan(el, ui);

    var q = String(ui.trQuery || '').trim().toLowerCase();
    var searched = apps.filter(function (a) {
      if (!q) return true;
      var hay = [a.company, a.role, a.notes, a.platform].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    var counts = {};
    searched.forEach(function (a) {
      var st = effOf[a.id];
      counts[st] = (counts[st] || 0) + 1;
    });
    var visible = searched.filter(function (a) { return !ui.trFilter || effOf[a.id] === ui.trFilter; });
    visible.sort(function (a, b) { return compareRows(a, b, ui.trSort, ui.trDir, ctx); });

    var search = h('label', { class: 'field tr-search-f' },
      h('span', { class: 'field-label' }, 'Search'),
      h('span', { class: 'tr-search-w' },
        searchIcon(),
        h('input', {
          class: 'input tr-search', type: 'search', value: ui.trQuery || '',
          placeholder: 'Company, role or notes', autocomplete: 'off', spellcheck: 'false',
          oninput: function (ev) { onSearch(ev, ui); },
        })));

    var chips = h('div', { class: 'chip-row tr-chips', role: 'group', 'aria-label': 'Filter by status' },
      CHIPS.map(function (c) {
        var n = c.key === 'all' ? searched.length : (counts[c.key] || 0);
        var on = c.key === 'all' ? !ui.trFilter : ui.trFilter === c.key;
        return h('button', {
          type: 'button', class: 'chip-btn' + (n === 0 && c.key !== 'all' ? ' is-empty' : ''),
          'data-key': c.key,
          'aria-pressed': on ? 'true' : 'false',
          onclick: function () { onChip(c.key, ui); },
        }, c.label, h('span', { class: 'n' }, String(n)));
      }));

    var body, wrap = null, swipe = null;
    if (!apps.length) {
      body = emptyState(ui, false);
    } else if (!visible.length) {
      body = emptyState(ui, true);
    } else {
      /* on phone the Applied column stays hidden while no shown row has gone out */
      var anyApplied = false;
      visible.forEach(function (a) { if (a.dateApplied) anyApplied = true; });
      wrap = h('div', { class: 'tbl-wrap tr-wrap', onscroll: function (ev) { markScrollEnd(ev.currentTarget); } },
        h('table', { class: 'tbl tr-tbl' + (anyApplied ? '' : ' is-no-applied') },
          h('thead', null, h('tr', null,
            COLS.map(function (c) { return headCell(c, ui); }),
            h('th', { scope: 'col', class: 'tr-c-links' }, 'Links'))),
          h('tbody', null, visible.map(function (a) { return row(a, ctx); }))));
      body = h('div', { class: 'tr-frame' }, wrap, h('div', { class: 'tr-fade', 'aria-hidden': 'true' }));
      /* phone, measured at 400px: with the Applied column shown the Status
         select sits mostly past the right edge; without it, Status fits and
         only the posting link and Details are off to the right */
      swipe = h('p', { class: 'tr-swipe' }, anyApplied
        ? 'Swipe the table sideways for status, the posting link and Details.'
        : 'Swipe the table sideways for the posting link and Details.');
    }

    el.textContent = '';
    el.appendChild(h('section', { class: 'panel tr-panel', 'aria-label': 'Application tracker' },
      h('div', { class: 'panel-head' },
        h('h2', { class: 'panel-title' }, 'Application tracker'),
        apps.length ? h('span', { class: 'chip mono' }, String(apps.length)) : null,
        h('span', { class: 'panel-kicker' }, 'every job on the board')),
      h('div', { class: 'panel-body tr-body' },
        h('div', { class: 'tr-controls' }, search, chips),
        swipe,
        body,
        apps.length ? h('p', { class: 'tr-foot' },
          h('span', { class: 'mono' }, visible.length + ' shown of ' + apps.length)) : null)));
    /* the wrap has a size only once it is in the page */
    if (wrap) {
      markScrollEnd(wrap);
      if (window.requestAnimationFrame) window.requestAnimationFrame(function () { markScrollEnd(wrap); });
    }
    /* focus goes back where it was, unless a sheet or the drawer owns it */
    if (plan.keys.length) {
      if (CMC.modalOpen()) ui.trFocusTries = 0;
      else applyFocus(el, ui, plan);
    }
  }

  CMC.register('tracker', { render: render });
})();
