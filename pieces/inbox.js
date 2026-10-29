/* piece: inbox. Job links a scan found but nobody has scored yet. Lanes are
   a pre-sort (career, stack, off target, unsorted), not a score. Evaluate
   moves a link onto the board as an Evaluated application; Dismiss parks it.
   Reads CMC.state.inbox, writes only via CMC.act.*, UI state lives in CMC.ui. */
(function () {
  'use strict';
  var CMC = window.CMC;
  if (!CMC) return;

  var NS = 'http://www.w3.org/2000/svg';

  var LANES = [
    { key: 'career_stack', label: 'Career + Stack', hint: 'Career and stack lanes together' },
    { key: 'career', label: 'Career', hint: 'Jobs on the career path' },
    { key: 'stack', label: 'Stack', hint: 'Jobs that use software you know' },
    { key: 'unsorted', label: 'Unsorted', hint: 'Claude has not sorted these yet' },
    { key: 'off_target', label: 'Off target', hint: 'Probably not a fit' },
    { key: 'all', label: 'All', hint: 'Every lane' },
  ];
  var LANE_META = {
    career: { word: 'Career', kind: 'good' },
    stack: { word: 'Stack', kind: 'info' },
    off_target: { word: 'Off target', kind: 'idle' },
    unsorted: { word: 'Unsorted', kind: 'idle' },
  };
  var LANE_RANK = { career: 0, stack: 1, unsorted: 2, off_target: 3 };

  /* sortable columns: key, label, default direction, how to compare */
  var COLS = [
    { key: 'lane', label: 'Lane', dir: 'asc', title: 'Sort by lane, then confidence' },
    { key: 'company', label: 'Company', dir: 'asc', title: 'Sort by company name' },
    { key: 'role', label: 'Role', dir: 'asc', title: 'Sort by role' },
    { key: 'remote', label: 'Location', dir: 'desc', title: 'Sort by how likely the job is remote in the US' },
    { key: 'pay', label: 'Pay', dir: 'desc', title: 'Sort by pay' },
    { key: 'posted', label: 'Posted', dir: 'desc', title: 'Sort by posting date' },
    { key: 'source', label: 'Source', dir: 'asc', title: 'Sort by where the link was found' },
  ];
  var PHONE_SORTS = [
    ['remote', 'Likely remote first'],
    ['lane', 'Lane'],
    ['company', 'Company'],
    ['role', 'Role'],
    ['pay', 'Pay, highest first'],
    ['pay:asc', 'Pay, lowest first'],
    ['posted', 'Newest first'],
  ];

  /* ---------------- small helpers ---------------------------------------- */
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
  function str(v) { return String(v || '').toLowerCase(); }
  function laneOf(row) { return LANE_META[row.lane] ? row.lane : 'unsorted'; }
  function pct(v) { return Math.round(num(v) * 100) + '%'; }
  function hostOf(s) {
    var t = String(s || '').trim();
    if (!t) return '';
    try { if (/^https?:\/\//i.test(t)) t = new URL(t).hostname; } catch (e) { /* keep the text */ }
    return t.replace(/^www\./i, '');
  }
  /* "2026-10-09" is a calendar day, not a moment: show it as that day in
     every time zone. Anything with a time goes through CMC.fmt.date. */
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dayText(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '').trim());
    if (!m) return CMC.fmt.date(v) || String(v || '');
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return String(v);
    var s = MONTHS[mo - 1] + ' ' + d;
    if (y !== new Date().getFullYear()) s += ', ' + y;
    return s;
  }
  /* a yearly dollar figure for sorting only, from the shared pay reader:
     "$180K" is 180,000, "$95K to $110K" sorts by its low end, "$58/hr"
     becomes a yearly figure, a bare "95 to 110" is read as thousands.
     0 means unreadable; sortRows keeps those last in both directions. */
  function payNum(s) {
    var p = CMC.pay && CMC.pay.read ? CMC.pay.read(s) : null;
    return p ? p.low : 0;
  }
  /* same id style as the seeded applications: lowercase words joined by
     hyphens, cut at 40 characters, no trailing hyphen */
  function slugify(text, max) {
    var s = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '');
    s = s.slice(0, max || 40).replace(/-+$/, '');
    return s || 'job';
  }
  function findBy(arr, id) {
    for (var i = 0; i < (arr || []).length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }

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
  function flagIcon() {
    return icon(10, [
      ['path', { d: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z' }],
      ['line', { x1: 4, y1: 22, x2: 4, y2: 15 }],
    ], '2.4');
  }
  function outIcon() {
    return icon(12, [
      ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }],
      ['polyline', { points: '15 3 21 3 21 9' }],
      ['line', { x1: 10, y1: 14, x2: 21, y2: 3 }],
    ], '2');
  }
  function sortIcon(dir) {
    return icon(12, [['path', { d: dir === 'asc' ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6' }]], '2.4');
  }
  function trayIcon() {
    return icon(26, [
      ['polyline', { points: '22 12 16 12 14 15 10 15 8 12 2 12' }],
      ['path', { d: 'M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z' }],
    ]);
  }
  function searchIcon() {
    return icon(14, [
      ['circle', { cx: 11, cy: 11, r: 7 }],
      ['line', { x1: 21, y1: 21, x2: 16.2, y2: 16.2 }],
    ], '2');
  }

  /* ---------------- ui state --------------------------------------------- */
  function sortState(ui) {
    if (!ui.ibSort) ui.ibSort = { key: 'remote', dir: 'desc' };
    return ui.ibSort;
  }
  function busyMap(ui) {
    if (!ui.ibBusy) ui.ibBusy = {};
    return ui.ibBusy;
  }
  function finishBusy(ui, key) {
    return function () {
      delete busyMap(ui)[key];
      CMC.rerender('inbox');
    };
  }
  function onLane(key, ui) {
    ui.ibLane = key;
    CMC.rerender('inbox');
  }
  function onRemote(ui) {
    ui.ibRemoteOnly = !ui.ibRemoteOnly;
    CMC.rerender('inbox');
  }
  function onShowDismissed(ui) {
    ui.ibShowDismissed = !ui.ibShowDismissed;
    CMC.rerender('inbox');
  }
  function onSort(key, ui) {
    var s = sortState(ui);
    if (s.key === key) s.dir = s.dir === 'asc' ? 'desc' : 'asc';
    else {
      var col = null;
      for (var i = 0; i < COLS.length; i++) if (COLS[i].key === key) col = COLS[i];
      s.key = key;
      s.dir = col ? col.dir : 'asc';
    }
    CMC.rerender('inbox');
  }
  function clearFilters(ui) {
    ui.ibLane = 'all';
    ui.ibRemoteOnly = false;
    ui.ibQuery = '';
    CMC.rerender('inbox');
  }

  /* ---------------- data actions ----------------------------------------- */
  function onEvaluate(row, ui) {
    if (busyMap(ui)[row.id]) return;
    busyMap(ui)[row.id] = true;
    var company = row.company || hostOf(row.source) || 'Unknown company';
    var role = row.role || 'New job link';
    var now = new Date().toISOString();
    var slug = slugify(company + ' ' + role, 40);
    /* a second link for the same company and role keeps its own doc */
    if (findBy(CMC.state.applications, slug)) slug = slugify(company + ' ' + role, 34) + '-' + Math.random().toString(36).slice(2, 6);
    var app = {
      company: company,
      role: role,
      url: row.url || '',
      platform: row.source || '',
      score: null,
      status: 'Evaluated',
      dateFound: now,
      location: row.location || '',
      pay: row.pay || '',
      notes: 'From the inbox. Claude scores it on the next pass.',
      sample: false,
    };
    /* three serialized writes, all optimistic: the board gains the app,
       the inbox row flips, the log records the move */
    CMC.act.setDoc('applications', slug, app);
    var p = CMC.act.updateDoc('inbox', row.id, { state: 'evaluated', evaluatedAt: now, appId: slug });
    CMC.act.addActivity('Moved ' + company + ', ' + role + ' from the inbox to the board.', 'found');
    var fin = finishBusy(ui, row.id);
    p.then(fin, fin);
  }
  function onDismiss(row, ui) {
    if (busyMap(ui)[row.id]) return;
    busyMap(ui)[row.id] = true;
    var company = row.company || hostOf(row.source) || 'Unknown company';
    var role = row.role || 'New job link';
    var p = CMC.act.updateDoc('inbox', row.id, { state: 'dismissed', dismissedAt: new Date().toISOString() });
    CMC.act.addActivity('Dismissed ' + company + ', ' + role + ' from the inbox.', 'system');
    var fin = finishBusy(ui, row.id);
    p.then(fin, fin);
  }
  function onRestore(row, ui) {
    if (busyMap(ui)[row.id]) return;
    busyMap(ui)[row.id] = true;
    var p = CMC.act.updateDoc('inbox', row.id, { state: 'pending', dismissedAt: null });
    var fin = finishBusy(ui, row.id);
    p.then(fin, fin);
  }

  /* ---------------- filtering and sorting -------------------------------- */
  function inLane(row, laneKey) {
    var lane = laneOf(row);
    if (laneKey === 'all') return true;
    if (laneKey === 'career_stack') return lane === 'career' || lane === 'stack';
    return lane === laneKey;
  }
  function matchesQuery(row, q) {
    if (!q) return true;
    var hay = [row.company, row.role, row.location, row.source, hostOf(row.source)].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }
  function compare(a, b, key) {
    switch (key) {
      case 'remote': return (num(b.remoteUs) - num(a.remoteUs)) || (num(b.confidence) - num(a.confidence));
      case 'lane': return (LANE_RANK[laneOf(a)] - LANE_RANK[laneOf(b)]) || (num(b.confidence) - num(a.confidence));
      case 'company': return str(a.company || hostOf(a.source)).localeCompare(str(b.company || hostOf(b.source)));
      case 'role': return str(a.role).localeCompare(str(b.role));
      case 'pay': return (payNum(b.pay) - payNum(a.pay));
      case 'posted': return String(b.posted || '').localeCompare(String(a.posted || ''));
      case 'source': return str(hostOf(a.source)).localeCompare(str(hostOf(b.source)));
      default: return 0;
    }
  }
  function sortRows(rows, s) {
    var col = null;
    for (var i = 0; i < COLS.length; i++) if (COLS[i].key === s.key) col = COLS[i];
    var flip = col && s.dir !== col.dir ? -1 : 1;
    return rows.slice().sort(function (a, b) {
      /* rows with no readable pay stay at the bottom whichever way pay sorts */
      if (s.key === 'pay') {
        var na = !payNum(a.pay), nb = !payNum(b.pay);
        if (na !== nb) return na ? 1 : -1;
      }
      var d = compare(a, b, s.key) * flip;
      if (d) return d;
      return String(b.foundAt || '').localeCompare(String(a.foundAt || ''));
    });
  }

  /* ---------------- pieces of the panel ----------------------------------- */
  function controls(base, ui, q) {
    var h = CMC.h;
    var lane = ui.ibLane || 'career_stack';
    var remoteOnly = !!ui.ibRemoteOnly;
    /* chip counts answer "what would I see if I tapped this", so they honor
       the search box and the Remote-US toggle */
    var pool = base.filter(function (r) { return matchesQuery(r, q) && (!remoteOnly || num(r.remoteUs) >= 0.5); });
    var s = sortState(ui);

    var sortSel = h('select', {
      id: 'ib-sort-select',
      /* an option value is a column key, or key:dir when it sorts the
         other way from the column's default ("pay:asc") */
      onchange: function (ev) {
        var parts = String(ev.target.value).split(':');
        var key = parts[0];
        var col = null;
        for (var i = 0; i < COLS.length; i++) if (COLS[i].key === key) col = COLS[i];
        ui.ibSort = { key: key, dir: parts[1] || (col ? col.dir : 'asc') };
        CMC.rerender('inbox');
      },
    }, (function () {
      /* select the option that matches key and direction; a sort set from a
         desktop header that has no exact phone option falls back to the
         first option with the same key */
      var sel = null, byKey = null;
      PHONE_SORTS.forEach(function (o) {
        var parts = o[0].split(':');
        var col = null;
        for (var i = 0; i < COLS.length; i++) if (COLS[i].key === parts[0]) col = COLS[i];
        var dir = parts[1] || (col ? col.dir : 'asc');
        if (s.key === parts[0] && s.dir === dir && sel === null) sel = o[0];
        if (s.key === parts[0] && byKey === null) byKey = o[0];
      });
      if (sel === null) sel = byKey;
      return PHONE_SORTS.map(function (o) {
        return h('option', { value: o[0], selected: o[0] === sel ? true : null }, o[1]);
      });
    })());

    return h('div', { class: 'ib-controls' },
      h('div', { class: 'ib-controls-top' },
        h('div', { class: 'field ib-search' },
          h('label', { for: 'ib-search-input' }, 'Search the inbox'),
          h('span', { class: 'ib-search-wrap' },
            searchIcon(),
            h('input', {
              id: 'ib-search-input',
              class: 'input',
              type: 'search',
              autocomplete: 'off',
              spellcheck: 'false',
              placeholder: 'Company, role, location or source',
              value: ui.ibQuery || '',
              oninput: function (ev) {
                ui.ibQuery = ev.target.value;
                /* keep the caret where it is: rebuild everything but the box */
                var sel = ev.target.selectionStart;
                CMC.rerender('inbox');
                var again = document.getElementById('ib-search-input');
                if (again) { again.focus(); try { again.setSelectionRange(sel, sel); } catch (e) { /* fine */ } }
              },
              onkeydown: function (ev) {
                if (ev.key === 'Escape' && ev.target.value) { ev.target.value = ''; ui.ibQuery = ''; CMC.rerender('inbox'); }
              },
            }))),
        h('div', { class: 'field ib-sortfield' },
          h('label', { for: 'ib-sort-select' }, 'Sort by'),
          h('span', { class: 'select-wrap' }, sortSel))),
      h('div', { class: 'chip-row ib-lanes', role: 'group', 'aria-label': 'Filter by lane' },
        LANES.map(function (l) {
          var n = pool.filter(function (r) { return inLane(r, l.key); }).length;
          var on = lane === l.key;
          return h('button', {
            type: 'button',
            class: 'chip-btn',
            'aria-pressed': on ? 'true' : 'false',
            title: l.hint,
            onclick: function () { onLane(l.key, ui); },
          }, l.label, h('span', { class: 'n' }, String(n)));
        }),
        h('span', { class: 'ib-lane-gap' }),
        h('button', {
          type: 'button',
          class: 'chip-btn ib-remote',
          'aria-pressed': remoteOnly ? 'true' : 'false',
          title: remoteOnly ? 'Showing only jobs that look remote in the US. Tap to show every job.' : 'Hide jobs that do not look remote in the US',
          onclick: function () { onRemote(ui); },
        }, h('span', { class: 'dot ' + (remoteOnly ? 'dot-good' : 'dot-hollow') }), 'Remote-US only')));
  }

  function headRow(ui) {
    var h = CMC.h;
    var s = sortState(ui);
    return h('tr', null,
      COLS.map(function (c) {
        var on = s.key === c.key;
        return h('th', {
          scope: 'col',
          class: 'ib-th-' + c.key,
          'aria-sort': on ? (s.dir === 'asc' ? 'ascending' : 'descending') : 'none',
        }, h('button', {
          type: 'button',
          title: c.title + (on ? '. Tap again to flip the order.' : ''),
          onclick: function () { onSort(c.key, ui); },
        }, c.label, on ? sortIcon(s.dir) : null));
      }),
      h('th', { scope: 'col', class: 'ib-th-act' }, h('span', { class: 'ib-sr' }, 'Actions')));
  }

  function laneCell(row) {
    var h = CMC.h;
    var meta = LANE_META[laneOf(row)];
    var conf = num(row.confidence);
    var low = conf < 0.6;
    return h('td', { class: 'ib-td-lane' },
      h('span', { class: 'ib-lane-wrap' },
        h('span', { class: 'chip chip-' + meta.kind, title: 'Lane: ' + meta.word },
          h('span', { class: 'dot dot-' + meta.kind }), meta.word),
        h('span', { class: 'ib-conf mono', title: 'How sure the pre-sort is: ' + pct(conf) }, pct(conf)),
        low ? h('span', {
          class: 'chip ib-q mono',
          role: 'img',
          title: 'Claude decides this one',
          'aria-label': 'Low confidence. Claude decides this one.',
        }, '?') : null));
  }

  function bodyRow(row, ui) {
    var h = CMC.h;
    var isBusy = !!busyMap(ui)[row.id];
    var dismissed = row.state === 'dismissed';
    var url = CMC.safeUrl(row.url);
    var role = row.role || 'New job link';
    var notRemote = num(row.remoteUs) < 0.5;
    var host = hostOf(row.source);

    return h('tr', { class: 'ib-row' + (dismissed ? ' is-dismissed' : ''), 'data-id': row.id },
      laneCell(row),
      h('td', { class: 'ib-td-co' },
        h('span', { class: 'ib-co-wrap' },
          h('span', { class: 'co' }, row.company || host || 'Unknown company'),
          row.flagged ? h('span', { class: 'chip chip-warn ib-flag', title: 'Claude flagged this one for a closer look' }, flagIcon(), 'Flagged') : null,
          dismissed ? h('span', { class: 'chip chip-idle' }, h('span', { class: 'dot dot-idle' }), 'Dismissed') : null)),
      h('td', { class: 'ib-td-role' },
        url ? h('a', { class: 'ib-role-link', href: url, target: '_blank', rel: 'noopener noreferrer', title: 'Open the posting in a new tab' }, role, outIcon())
          : h('span', { class: 'ib-role-text' }, role)),
      h('td', { class: 'ib-td-loc' },
        h('span', { class: 'ib-loc-wrap' },
          h('span', { class: row.location ? '' : 'muted' }, row.location || 'No location given'),
          notRemote ? h('span', { class: 'chip chip-warn', title: 'Looks like it may not be remote in the US (' + pct(row.remoteUs) + ' likely remote)' }, 'Not remote?') : null)),
      h('td', { class: 'ib-td-pay' },
        row.pay ? h('span', { class: 'ib-pay mono' }, row.pay) : h('span', { class: 'muted ib-pay-na' }, 'Not listed')),
      h('td', { class: 'ib-td-posted mono' },
        row.posted ? dayText(row.posted) : h('span', { class: 'muted' }, 'unknown')),
      h('td', { class: 'ib-td-src muted' }, h('span', { class: 'ib-src', title: host || '' }, host || '')),
      h('td', { class: 'ib-td-act' },
        h('span', { class: 'ib-acts' },
          h('button', {
            type: 'button', class: 'btn btn-ghost ib-eval', disabled: isBusy,
            title: 'Move this link to the board. Claude scores it on the next pass.',
            onclick: function () { onEvaluate(row, ui); },
          }, isBusy ? 'Moving...' : 'Evaluate'),
          dismissed ? h('button', {
            type: 'button', class: 'btn btn-ghost ib-restore', disabled: isBusy,
            title: 'Put this link back in the inbox',
            onclick: function () { onRestore(row, ui); },
          }, 'Restore') : h('button', {
            type: 'button', class: 'btn btn-ghost ib-dismiss', disabled: isBusy,
            title: 'Set this link aside. Show dismissed brings it back.',
            onclick: function () { onDismiss(row, ui); },
          }, 'Dismiss'))));
  }

  function emptyAll() {
    var h = CMC.h;
    return h('div', { class: 'ib-empty' },
      trayIcon(),
      h('span', { class: 'ib-empty-t' }, 'The inbox is clear'),
      h('p', { class: 'ib-empty-s' }, 'The inbox fills when Claude runs a scan. Nothing waiting right now.'));
  }
  function emptyFiltered(ui) {
    var h = CMC.h;
    return h('div', { class: 'ib-empty' },
      trayIcon(),
      h('span', { class: 'ib-empty-t' }, 'No links match these filters'),
      h('p', { class: 'ib-empty-s' }, 'Try another lane, clear the search, or turn off Remote-US only.'),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: function () { clearFilters(ui); } }, 'Show everything'));
  }

  function footer(shown, dismissedCount, ui) {
    var h = CMC.h;
    var on = !!ui.ibShowDismissed;
    return h('div', { class: 'ib-foot' },
      h('p', { class: 'ib-foot-line' },
        h('span', { class: 'mono' }, String(shown)),
        ' shown. Lanes are a pre-sort, not a score. Evaluation decides.'),
      dismissedCount > 0 || on ? h('button', {
        type: 'button',
        class: 'chip-btn ib-showdis',
        'aria-pressed': on ? 'true' : 'false',
        onclick: function () { onShowDismissed(ui); },
      }, on ? 'Hide dismissed' : 'Show dismissed', h('span', { class: 'n' }, String(dismissedCount))) : null);
  }

  /* ---------------- render ------------------------------------------------ */
  function render(el, state, ui) {
    var h = CMC.h;
    var all = state.inbox || [];
    var pending = all.filter(function (r) { return r.state === 'pending' || !r.state; });
    var dismissed = all.filter(function (r) { return r.state === 'dismissed'; });
    var base = ui.ibShowDismissed ? pending.concat(dismissed) : pending;
    var q = String(ui.ibQuery || '').trim().toLowerCase();
    var lane = ui.ibLane || 'career_stack';

    var visible = base.filter(function (r) {
      return inLane(r, lane) && matchesQuery(r, q) && (!ui.ibRemoteOnly || num(r.remoteUs) >= 0.5);
    });
    visible = sortRows(visible, sortState(ui));

    var body = [];
    if (!base.length) {
      body.push(emptyAll());
    } else {
      body.push(controls(base, ui, q));
      if (visible.length) {
        body.push(h('div', { class: 'tbl-wrap ib-wrap' },
          h('table', { class: 'tbl ib-tbl' },
            h('thead', null, headRow(ui)),
            h('tbody', null, visible.map(function (r) { return bodyRow(r, ui); })))));
      } else {
        body.push(emptyFiltered(ui));
      }
    }
    if (base.length || dismissed.length) body.push(footer(visible.length, dismissed.length, ui));

    el.textContent = '';
    el.appendChild(h('section', { class: 'panel ib-panel', 'aria-label': 'Job inbox' },
      h('div', { class: 'panel-head' },
        h('h2', { class: 'panel-title' }, 'Job inbox'),
        h('span', { class: 'chip mono' + (pending.length ? ' chip-warn' : '') },
          pending.length ? h('span', { class: 'dot dot-warn' }) : null,
          pending.length + ' awaiting review'),
        h('span', { class: 'panel-kicker' }, 'found by scans, not scored yet')),
      h('div', { class: 'panel-body ib-body' }, body)));
  }

  CMC.register('inbox', { render: render });
})();
