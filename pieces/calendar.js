/* piece: calendar: the Applied calendar. Five weeks, Sunday to Saturday:
   three weeks back, this week and next week, so a booked interview shows
   before it happens. Applications land on the day they went out
   (dateApplied); interviews (state.interviews) join them on their booked
   day. A day popover lists everything on one day and each entry opens the
   job drawer. Reads CMC.state, writes nothing, UI state lives in CMC.ui
   (calOpen holds the open day key so a live rerender keeps it open). */
(function () {
  'use strict';

  var CMC = window.CMC;
  if (!CMC) return;

  var NS = 'http://www.w3.org/2000/svg';
  /* statuses that mean "this one went out" */
  var APPLIED = { Applied: 1, Responded: 1, Interview: 1, Offer: 1, Hired: 1, Rejected: 1 };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var WEEKS = 5;
  var WEEKS_BACK = 3;
  var MAX_CHIPS = 3;
  var MAX_DOTS = 4;
  var POP_WIDTH = 360;
  var SHEET_QUERY = '(max-width: 539px)';

  /* ---------------- dates ------------------------------------------------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  /* a stored date (ISO timestamp or YYYY-MM-DD) becomes a local day key, or
     '' when it is missing or unreadable. Nothing is ever guessed. */
  function keyOf(v) {
    var s = String(v || '').trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var t = new Date(s);
    return isNaN(t.getTime()) ? '' : dayKey(t);
  }
  function longDate(d) { return DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate(); }
  function shortDate(d) { return MONTHS[d.getMonth()] + ' ' + d.getDate(); }
  function time12(hhmm) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || '').trim());
    if (!m) return '';
    var hr = parseInt(m[1], 10);
    if (isNaN(hr) || hr > 23) return '';
    var half = hr < 12 ? 'AM' : 'PM';
    hr = hr % 12 || 12;
    return hr + ':' + m[2] + ' ' + half;
  }
  function isSheet() {
    try { return !!(window.matchMedia && window.matchMedia(SHEET_QUERY).matches); } catch (e) { return false; }
  }

  /* ---------------- icons -------------------------------------------------- */
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
  function caretIcon() { return icon(14, [['path', { d: 'M6 9l6 6 6-6' }]], '2.2'); }
  function closeIcon() {
    return icon(16, [
      ['line', { x1: 18, y1: 6, x2: 6, y2: 18 }],
      ['line', { x1: 6, y1: 6, x2: 18, y2: 18 }],
    ], '2.2');
  }
  function calendarIcon() {
    return icon(26, [
      ['rect', { x: 3, y: 4, width: 18, height: 17, rx: 2 }],
      ['line', { x1: 16, y1: 2, x2: 16, y2: 6 }],
      ['line', { x1: 8, y1: 2, x2: 8, y2: 6 }],
      ['line', { x1: 3, y1: 10, x2: 21, y2: 10 }],
    ]);
  }

  /* ---------------- words -------------------------------------------------- */
  function statusLabel(status) {
    if (status === 'Responded') return 'Heard back';
    if (status === 'Evaluated') return 'New';
    if (status === 'queued') return 'In queue';
    return String(status || 'Applied');
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  /* ---------------- model -------------------------------------------------- */
  function appItem(a) {
    return {
      kind: 'app', k: 'info', id: a.id, appId: a.id,
      company: a.company || '', role: a.role || '', status: a.status || '',
    };
  }
  function ivItem(iv) {
    return {
      kind: 'iv', k: 'ivl', id: iv.id, appId: iv.appId || '',
      company: iv.company || '', role: iv.role || '',
      round: iv.round || 'Interview', format: iv.format || '', time: time12(iv.time),
    };
  }
  function byCompany(a, b) { return String(a.company || '').localeCompare(String(b.company || '')); }
  function byTime(a, b) { return String(a.time || '').localeCompare(String(b.time || '')); }

  function buildModel(state) {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var todayKey = dayKey(today);
    var start = new Date(today);
    start.setDate(today.getDate() - today.getDay() - 7 * WEEKS_BACK);
    var weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 6);
    var weekKey = dayKey(weekAgo);

    var days = [], byKey = {};
    for (var i = 0; i < WEEKS * 7; i++) {
      var d = new Date(start);
      d.setDate(start.getDate() + i);
      var k = dayKey(d);
      var cell = { key: k, date: d, apps: [], ivs: [], items: [], isToday: k === todayKey, isFuture: d.getTime() > today.getTime() };
      days.push(cell);
      byKey[k] = cell;
    }
    var last = days[days.length - 1];

    var total = 0, noDate = 0, before = 0, todayN = 0, weekN = 0;
    (state.applications || []).forEach(function (a) {
      if (!APPLIED[a.status]) return;
      total++;
      var k = keyOf(a.dateApplied);
      if (!k) { noDate++; return; }
      if (k === todayKey) todayN++;
      if (k >= weekKey && k <= todayKey) weekN++;
      if (byKey[k]) byKey[k].apps.push(a);
      else if (k < days[0].key) before++;
    });
    var ivTotal = 0, ivAfter = 0;
    (state.interviews || []).forEach(function (iv) {
      var k = keyOf(iv.date);
      if (!k) return;
      ivTotal++;
      if (byKey[k]) byKey[k].ivs.push(iv);
      else if (k > last.key) ivAfter++;
    });
    days.forEach(function (c) {
      c.ivs.sort(byTime);
      c.apps.sort(byCompany);
      c.items = c.ivs.map(ivItem).concat(c.apps.map(appItem));
    });

    /* with nothing sent and nothing booked, only this week is drawn and the
       empty state sits right under it */
    var collapsed = !total && !ivTotal;
    var shown = collapsed ? days.slice(WEEKS_BACK * 7, WEEKS_BACK * 7 + 7) : days;

    return {
      days: days, shown: shown, collapsed: collapsed, byKey: byKey,
      start: start, last: last.date, today: today, todayKey: todayKey,
      total: total, noDate: noDate, before: before, todayN: todayN, weekN: weekN,
      ivTotal: ivTotal, ivAfter: ivAfter,
    };
  }

  /* ---------------- ui state ---------------------------------------------- */
  function toggleDay(key, ui, focus) {
    ui.calOpen = ui.calOpen === key ? null : key;
    ui.calFocus = !!focus && !!ui.calOpen;
    CMC.rerender('calendar');
  }
  function closeDay(ui) {
    if (!ui.calOpen) return;
    ui.calOpen = null;
    ui.calFocus = false;
    CMC.rerender('calendar');
  }
  function openEntry(item, ui) {
    if (!item.appId) return;
    ui.calOpen = null;
    ui.calFocus = false;
    CMC.openDrawer(item.appId);
    CMC.rerender('calendar');
  }

  /* one set of page-level listeners: Escape, outside click, focus leaving,
     resize */
  var wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    /* Escape is taken in the capture phase: the popover is the top layer
       while it is open, so it must close before the drawer or the Jarvis
       sheet see the key, whatever order their listeners were added in.
       Both skip a handled (defaultPrevented) Escape. */
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape' || !CMC.ui.calOpen || ev.defaultPrevented) return;
      ev.preventDefault();
      var key = CMC.ui.calOpen;
      closeDay(CMC.ui);
      /* hand focus back to the cell that opened the popover */
      var back = document.querySelector('.cal-cell[data-day="' + key + '"] .cal-caret');
      if (!back || !back.offsetParent) back = document.querySelector('.cal-cell[data-day="' + key + '"]');
      if (back) back.focus();
    }, true);
    function outside(t) {
      if (!t || typeof t.closest !== 'function') return false;
      return !t.closest('.cal-pop') && !t.closest('.cal-grid');
    }
    document.addEventListener('click', function (ev) {
      if (CMC.ui.calOpen && outside(ev.target)) closeDay(CMC.ui);
    });
    /* the keyboard twin of the outside click: focus moving anywhere past
       the popover and the grid (the search box, a tracker row, the drawer)
       closes the day, so the popover never sits over another layer */
    document.addEventListener('focusin', function (ev) {
      if (CMC.ui.calOpen && outside(ev.target)) closeDay(CMC.ui);
    });
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      if (!CMC.ui.calOpen) return;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { resizeTimer = null; CMC.rerender('calendar'); }, 80);
    });
  }

  /* ---------------- pieces of the panel ----------------------------------- */
  function statChip(n, label) {
    var h = CMC.h;
    return h('span', { class: 'chip cal-stat' + (n ? '' : ' is-zero') },
      h('strong', { class: 'mono' }, String(n)), h('span', null, label));
  }

  function legend() {
    var h = CMC.h;
    return h('div', { class: 'cal-legend', 'aria-label': 'Legend' },
      h('span', { class: 'cal-legend-i' }, h('span', { class: 'dot dot-info' }), 'Applied'),
      h('span', { class: 'cal-legend-i' }, h('span', { class: 'dot dot-ivl' }), 'Interview'),
      h('span', { class: 'cal-legend-i' }, h('span', { class: 'cal-legend-today' }), 'Today'));
  }

  function chip(item) {
    var h = CMC.h;
    if (item.kind === 'iv') {
      var bits = [item.company || 'Interview'];
      if (item.round) bits.push(item.round);
      if (item.time) bits.push(item.time);
      var text = bits.join(' · ');
      return h('span', { class: 'chip chip-ivl cal-chip', title: (item.format ? item.format + ' · ' : '') + text },
        item.format ? h('span', { class: 'cal-tag' }, item.format) : null,
        h('span', { class: 'cal-chip-t' }, text));
    }
    var full = item.company + (item.role ? ' · ' + item.role : '') + ' · ' + statusLabel(item.status);
    return h('span', { class: 'chip chip-info cal-chip', title: full },
      h('span', { class: 'cal-chip-t' }, item.company || 'Unknown company'));
  }

  function dotRow(items) {
    var h = CMC.h;
    var n = items.length;
    return h('span', { class: 'cal-dots', 'aria-hidden': 'true' },
      items.slice(0, MAX_DOTS).map(function (it) { return h('span', { class: 'dot dot-' + it.k }); }),
      n > MAX_DOTS ? h('span', { class: 'cal-dots-n mono' }, '+' + (n - MAX_DOTS)) : null);
  }

  function cellEl(c, idx, model, ui, slot) {
    var h = CMC.h;
    var n = c.items.length;
    var open = ui.calOpen === c.key;
    var showMonth = idx === 0 || c.date.getDate() === 1;
    var when = longDate(c.date);
    var label = when + (c.isToday ? ', today' : '') + ', ' + (n ? plural(n, 'item', 'items') : 'nothing');
    if (n) label += '. Press Enter to show everything that day.';

    var cls = 'cal-cell' + (n ? ' has-items' : ' is-empty') + (c.isToday ? ' is-today' : '') +
      (c.isFuture ? ' is-future' : '') + (open ? ' is-open' : '');

    var kids = [
      h('span', { class: 'cal-top' },
        h('span', { class: 'cal-date mono' },
          showMonth ? h('span', { class: 'cal-mon' }, MONTHS[c.date.getMonth()] + ' ') : null,
          showMonth ? h('span', { class: 'cal-mon-n' }, (c.date.getMonth() + 1) + '/') : null,
          String(c.date.getDate())),
        c.isToday ? h('span', { class: 'cal-today-tag' }, 'Today') : null,
        n ? h('button', {
          type: 'button', class: 'cal-caret',
          'aria-label': 'Show everything on ' + when,
          title: 'Show everything on ' + when,
          'aria-expanded': open ? 'true' : 'false',
          onclick: function () { toggleDay(c.key, ui, true); },
        }, h('span', { class: 'mono' }, String(n)), caretIcon()) : null),
    ];
    if (n) {
      kids.push(h('span', { class: 'cal-chips' }, c.items.slice(0, MAX_CHIPS).map(chip)));
      kids.push(dotRow(c.items));
      if (n > MAX_CHIPS) {
        kids.push(h('button', {
          type: 'button', class: 'btn btn-ghost cal-more',
          'aria-label': 'Show ' + (n - MAX_CHIPS) + ' more on ' + when,
          'aria-expanded': open ? 'true' : 'false',
          onclick: function () { toggleDay(c.key, ui, true); },
        }, '+' + (n - MAX_CHIPS) + ' more'));
      }
    }

    return h('div', {
      class: cls,
      role: 'gridcell',
      tabindex: n ? '0' : '-1',
      'aria-label': label,
      'aria-current': c.isToday ? 'date' : null,
      dataset: { day: c.key },
      onclick: function (ev) {
        var t = ev.target;
        if (t && typeof t.closest === 'function' && t.closest('button')) return;
        if (n) toggleDay(c.key, ui, true);
        else closeDay(ui);
      },
      onkeydown: function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          if (ev.target !== ev.currentTarget) return;
          ev.preventDefault();
          if (n) toggleDay(c.key, ui, true);
          return;
        }
        var step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[ev.key];
        if (!step) return;
        ev.preventDefault();
        var cells = slot.querySelectorAll('.cal-cell');
        var j = idx + step;
        if (j >= 0 && j < cells.length) cells[j].focus();
      },
    }, kids);
  }

  function gridEl(model, ui, slot) {
    var h = CMC.h;
    var rows = [h('div', { class: 'cal-row cal-dows', role: 'row' },
      DAYS_SHORT.map(function (d, i) {
        return h('span', { class: 'cal-dow', role: 'columnheader', 'aria-label': DAYS[i] }, d);
      }))];
    var shown = model.shown;
    var weeks = shown.length / 7;
    for (var w = 0; w < weeks; w++) {
      var cells = [];
      for (var d = 0; d < 7; d++) {
        var idx = w * 7 + d;
        cells.push(cellEl(shown[idx], idx, model, ui, slot));
      }
      rows.push(h('div', { class: 'cal-row', role: 'row' }, cells));
    }
    var first = shown[0].date, last = shown[shown.length - 1].date;
    return h('div', {
      class: 'cal-grid',
      role: 'grid',
      'aria-label': 'Applied calendar, ' + shortDate(first) + ' to ' + shortDate(last) + ', ' +
        (weeks === 1 ? 'this week' : 'five weeks') + ', Sunday to Saturday',
      'aria-rowcount': String(weeks + 1),
      'aria-colcount': '7',
    }, rows);
  }

  function entryEl(item, ui) {
    var h = CMC.h;
    var chipKind, chipText, when = null;
    if (item.kind === 'iv') {
      chipKind = 'ivl';
      chipText = item.round || 'Interview';
      var bits = [];
      if (item.format) bits.push(item.format);
      bits.push(item.time || 'time not set');
      when = bits.join(' · ');
    } else {
      chipKind = CMC.statusKind(item.status);
      chipText = statusLabel(item.status);
    }
    var kids = [
      h('span', { class: 'dot dot-' + item.k + ' cal-e-dot' }),
      h('span', { class: 'cal-e-main' },
        h('span', { class: 'cal-e-co' }, item.company || 'Unknown company'),
        item.role ? h('span', { class: 'cal-e-role' }, item.role) : null,
        when ? h('span', { class: 'cal-e-when mono' }, when) : null),
      h('span', { class: 'chip chip-' + chipKind }, h('span', { class: 'dot dot-' + chipKind }), chipText),
    ];
    var entryId = item.kind + '-' + item.id;
    if (item.appId) {
      return h('button', {
        type: 'button', class: 'cal-entry',
        title: 'Open ' + (item.company || 'this job'),
        dataset: { id: entryId },
        onclick: function () { openEntry(item, ui); },
      }, kids);
    }
    return h('div', { class: 'cal-entry is-static', dataset: { id: entryId }, title: 'No application is linked to this interview yet' }, kids);
  }

  function popoverEl(c, ui, sheet) {
    var h = CMC.h;
    var n = c.items.length;
    var apps = c.apps.length, ivs = c.ivs.length;
    var sub = [];
    if (apps) sub.push(plural(apps, 'application', 'applications'));
    if (ivs) sub.push(plural(ivs, 'interview', 'interviews'));
    return h('div', {
      class: 'panel cal-pop' + (sheet ? ' is-sheet' : ''),
      role: 'dialog',
      'aria-label': 'Everything on ' + longDate(c.date),
      tabindex: '-1',
    },
      h('div', { class: 'panel-head cal-pop-head' },
        h('h3', { class: 'panel-title cal-pop-title' }, longDate(c.date)),
        h('span', { class: 'chip mono' }, String(n)),
        h('span', { class: 'panel-kicker' }, c.isToday ? 'today' : sub.join(', ')),
        h('button', {
          type: 'button', class: 'btn btn-ghost close-x cal-pop-close',
          'aria-label': 'Close', title: 'Close',
          onclick: function () { closeDay(ui); },
        }, closeIcon())),
      h('div', { class: 'panel-body cal-pop-body' },
        c.items.map(function (it) { return entryEl(it, ui); })),
      h('p', { class: 'cal-pop-hint' }, 'Tap an entry to open the job.'));
  }

  /* The popover lives in a small root at the end of <body>, not inside the
     slot: main and the footer are sibling stacking layers, so anything
     positioned inside main would paint under the footer. Desktop: absolute
     in page coordinates next to the cell. Narrow screens: a fixed bottom
     sheet with a scrim. The root is rebuilt on every render. */
  var PORTAL_ID = 'cal-portal';
  function unmountPopover() {
    var old = document.getElementById(PORTAL_ID);
    if (old) old.remove();
  }
  function mountPopover(slot, c, ui, sheet) {
    var h = CMC.h;
    unmountPopover();
    /* the panel is hidden (#only= another piece): nothing to anchor to */
    if (slot.hidden || !slot.getClientRects().length) return null;
    var root = h('div', { id: PORTAL_ID, class: 'cal-portal' + (sheet ? ' is-sheet' : '') },
      sheet ? h('div', { class: 'cal-scrim', onclick: function () { closeDay(ui); } }) : null,
      popoverEl(c, ui, sheet));
    document.body.appendChild(root);
    if (!sheet) placePopover(slot, root, c.key);
    return root;
  }
  function placePopover(slot, root, key) {
    var pop = root.querySelector('.cal-pop');
    var wrap = slot.querySelector('.cal-wrap');
    var cell = slot.querySelector('.cal-cell[data-day="' + key + '"]');
    if (!pop || !wrap || !cell) return;
    var wr = wrap.getBoundingClientRect();
    var cr = cell.getBoundingClientRect();
    var sx = window.pageXOffset || 0, sy = window.pageYOffset || 0;
    var w = Math.min(POP_WIDTH, Math.floor(wr.width) || POP_WIDTH);
    pop.style.setProperty('width', w + 'px');
    /* near the right edge the popover flips to hang left of the cell's right edge */
    var left = cr.left;
    if (left + w > wr.right) left = Math.max(wr.left, cr.right - w);
    /* under the cell; above it only when below would run off the bottom of
       the screen and above fits under the sticky command bar */
    var top = cr.bottom + 6;
    var ph = pop.offsetHeight;
    var bar = document.querySelector('.cmdbar');
    var barH = bar ? bar.getBoundingClientRect().height : 0;
    var onScreen = cr.top >= barH && cr.bottom <= window.innerHeight;
    if (onScreen && top + ph > window.innerHeight && cr.top - ph - 6 >= barH) top = cr.top - ph - 6;
    pop.style.setProperty('left', Math.round(left + sx) + 'px');
    pop.style.setProperty('top', Math.round(top + sy) + 'px');
  }

  /* ---------------- focus across a rebuild -------------------------------- */
  /* Every render tears the grid and the popover down, and a live refresh
     renders without anyone asking for it, so whatever had focus is noted
     first and given back after: a day cell, its count button, its "+N more",
     the popover itself, its close button or one of its entries. */
  function focusQuiet(el) {
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
  }
  function focusMark(slot) {
    var a = document.activeElement;
    if (!a || a === document.body || typeof a.closest !== 'function') return null;
    var portal = document.getElementById(PORTAL_ID);
    if (portal && portal.contains(a)) {
      if (a.classList.contains('cal-pop-close')) return { where: 'pop', what: 'close' };
      var entry = a.closest('.cal-entry');
      if (entry) return { where: 'pop', what: 'entry', id: entry.dataset.id || '' };
      return { where: 'pop', what: 'pop' };
    }
    if (slot.contains(a)) {
      var cell = a.closest('.cal-cell');
      if (!cell) return null;
      var what = a.classList.contains('cal-caret') ? 'caret' : (a.classList.contains('cal-more') ? 'more' : 'cell');
      return { where: 'grid', what: what, day: cell.dataset.day || '' };
    }
    return null;
  }
  function focusBack(slot, root, mark) {
    if (!mark) return;
    var el = null, i;
    if (mark.where === 'pop') {
      if (!root) return;
      if (mark.what === 'close') el = root.querySelector('.cal-pop-close');
      else if (mark.what === 'entry') {
        var entries = root.querySelectorAll('.cal-entry');
        for (i = 0; i < entries.length; i++) if (entries[i].dataset.id === mark.id) { el = entries[i]; break; }
      }
      if (!el) el = root.querySelector('.cal-pop');
    } else {
      var cell = slot.querySelector('.cal-cell[data-day="' + mark.day + '"]');
      if (!cell) return;
      if (mark.what === 'caret') el = cell.querySelector('.cal-caret');
      else if (mark.what === 'more') el = cell.querySelector('.cal-more');
      /* on a phone the count button is not drawn: the cell takes the focus */
      if (!el || !el.offsetParent) el = cell;
    }
    if (el) focusQuiet(el);
  }

  function footnotes(model) {
    var h = CMC.h;
    var out = [];
    if (model.noDate > 0) {
      out.push(h('p', { class: 'cal-foot' },
        h('span', { class: 'dot dot-idle' }),
        h('span', null, model.noDate + ' applied with no date recorded. ' +
          (model.noDate === 1 ? 'It counts in the total but has no day to land on.' : 'They count in the total but have no day to land on.'))));
    }
    if (model.before > 0) {
      out.push(h('p', { class: 'cal-foot' },
        h('span', { class: 'dot dot-idle' }),
        h('span', null, model.before + ' applied before ' + shortDate(model.start) + ', outside this view.')));
    }
    if (model.ivAfter > 0) {
      out.push(h('p', { class: 'cal-foot' },
        h('span', { class: 'dot dot-ivl' }),
        h('span', null, plural(model.ivAfter, 'interview', 'interviews') + ' booked after ' + shortDate(model.last) +
          ', past the end of this view. ' + (model.ivAfter === 1 ? 'It moves' : 'They move') + ' onto the grid as the weeks roll forward.')));
    }
    return out;
  }

  function emptyState() {
    var h = CMC.h;
    return h('div', { class: 'cal-empty' },
      calendarIcon(),
      h('span', { class: 'cal-empty-t' }, 'Nothing sent yet.'),
      h('p', { class: 'cal-empty-s' }, 'Applications land here on the day they go out, and interviews join them when they are booked, up to a week ahead.'));
  }

  /* ---------------- render ------------------------------------------------ */
  function render(el, state, ui) {
    var h = CMC.h;
    wire();
    var mark = focusMark(el);
    var model = buildModel(state);

    /* an open day that is no longer on the grid, or has nothing left on it,
       closes itself */
    var openCell = ui.calOpen ? model.byKey[ui.calOpen] : null;
    if (ui.calOpen && (!openCell || !openCell.items.length)) { ui.calOpen = null; openCell = null; }
    var sheet = !!openCell && isSheet();

    var body = [legend(), h('div', { class: 'cal-wrap' }, gridEl(model, ui, el))];
    if (model.collapsed) body.push(emptyState());
    body = body.concat(footnotes(model));
    var firstShown = model.shown[0].date, lastShown = model.shown[model.shown.length - 1].date;
    var kicker = (model.collapsed ? 'this week, ' : '') + shortDate(firstShown) + ' to ' + shortDate(lastShown);

    el.textContent = '';
    el.appendChild(h('section', { class: 'panel cal-panel', 'aria-label': 'Applied calendar' },
      h('div', { class: 'panel-head cal-head' },
        h('h2', { class: 'panel-title' }, 'Applied calendar'),
        h('span', { class: 'cal-stats', role: 'group', 'aria-label': 'Applications sent' },
          statChip(model.todayN, 'today'),
          statChip(model.weekN, 'in the last 7 days'),
          statChip(model.total, 'total')),
        h('span', { class: 'panel-kicker cal-kicker' }, kicker)),
      h('div', { class: 'panel-body cal-body' }, body)));

    var root = openCell ? mountPopover(el, openCell, ui, sheet) : (unmountPopover(), null);
    if (root && ui.calFocus) {
      ui.calFocus = false;
      var pop = root.querySelector('.cal-pop');
      if (pop) focusQuiet(pop);
    } else {
      focusBack(el, root, mark);
    }
  }

  CMC.register('calendar', { render: render });
})();
