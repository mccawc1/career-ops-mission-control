/* piece: activity: Mission log. Feed rows newest first with a round
   type-icon chip per kind, company names tinted accent (parsed from state,
   rendered as text spans), relative time right-aligned in mono. Caps at 12
   visible rows with a "Show earlier" expander whose open state lives in
   CMC.ui. Reads CMC.state only; renders everything through CMC.h. */
(function () {
  'use strict';

  var LIMIT = 12;        /* phone: keep the log short */
  var LIMIT_DESK = 20;   /* desktop: the log column sits beside The Target, so show it all */
  var NS = 'http://www.w3.org/2000/svg';

  /* matches the two-column breakpoint in foundation.css */
  var deskMq = (typeof window.matchMedia === 'function') ? window.matchMedia('(min-width: 980px)') : null;
  if (deskMq) {
    var onMq = function () { if (window.CMC && CMC.rerender) CMC.rerender('activity'); };
    if (deskMq.addEventListener) deskMq.addEventListener('change', onMq);
    else if (deskMq.addListener) deskMq.addListener(onMq);
  }

  /* one stroke family for every icon: 1.8, round caps and joins */
  function icon(size, parts) {
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.8');
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

  var SHAPES = {
    /* scan = radar sweep */
    scan: [
      ['circle', { cx: 12, cy: 12, r: 8.5 }],
      ['line', { x1: 12, y1: 12, x2: 18, y2: 6 }],
      ['path', { d: 'M13.4 6.7A5.5 5.5 0 0 1 15.9 8.1' }],
      ['circle', { cx: 12, cy: 12, r: 1, fill: 'currentColor', stroke: 'none' }],
      ['circle', { cx: 7.9, cy: 13.4, r: 1, fill: 'currentColor', stroke: 'none' }],
    ],
    /* found = target */
    found: [
      ['circle', { cx: 12, cy: 12, r: 8.5 }],
      ['circle', { cx: 12, cy: 12, r: 4.4 }],
      ['circle', { cx: 12, cy: 12, r: 1, fill: 'currentColor', stroke: 'none' }],
    ],
    /* applied = paper plane */
    applied: [
      ['line', { x1: 21, y1: 3, x2: 11, y2: 13 }],
      ['path', { d: 'M21 3 14.5 21 11 13 3 9.5 21 3z' }],
    ],
    /* queue = stack */
    queue: [
      ['polygon', { points: '12 3 3 7.5 12 12 21 7.5 12 3' }],
      ['polyline', { points: '3 12 12 16.5 21 12' }],
      ['polyline', { points: '3 16.5 12 21 21 16.5' }],
    ],
    /* interview = calendar */
    interview: [
      ['rect', { x: 3.5, y: 5, width: 17, height: 16, rx: 2 }],
      ['line', { x1: 8, y1: 3, x2: 8, y2: 7 }],
      ['line', { x1: 16, y1: 3, x2: 16, y2: 7 }],
      ['line', { x1: 3.5, y1: 10.5, x2: 20.5, y2: 10.5 }],
      ['circle', { cx: 9, cy: 15.2, r: 1.1, fill: 'currentColor', stroke: 'none' }],
    ],
    /* offer = flag */
    offer: [
      ['path', { d: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z' }],
      ['line', { x1: 4, y1: 22, x2: 4, y2: 15 }],
    ],
    /* win = star */
    win: [
      ['polygon', { points: '12 3 14.7 8.6 20.8 9.4 16.4 13.7 17.5 19.8 12 16.9 6.5 19.8 7.6 13.7 3.2 9.4 9.3 8.6 12 3' }],
    ],
    /* system = gear */
    system: [
      ['circle', { cx: 12, cy: 12, r: 5 }],
      ['circle', { cx: 12, cy: 12, r: 1.4, fill: 'currentColor', stroke: 'none' }],
      ['line', { x1: 12, y1: 3.6, x2: 12, y2: 6.6 }],
      ['line', { x1: 12, y1: 17.4, x2: 12, y2: 20.4 }],
      ['line', { x1: 3.6, y1: 12, x2: 6.6, y2: 12 }],
      ['line', { x1: 17.4, y1: 12, x2: 20.4, y2: 12 }],
      ['line', { x1: 6.1, y1: 6.1, x2: 8.2, y2: 8.2 }],
      ['line', { x1: 15.8, y1: 15.8, x2: 17.9, y2: 17.9 }],
      ['line', { x1: 15.8, y1: 8.2, x2: 17.9, y2: 6.1 }],
      ['line', { x1: 6.1, y1: 17.9, x2: 8.2, y2: 15.8 }],
    ],
  };

  /* kind -> status-grammar color bucket (matches the foundation dot grammar) */
  var KIND_COLOR = {
    scan: 'idle',
    found: 'info',
    applied: 'good',
    queue: 'accent',
    interview: 'ivl',
    offer: 'good',
    win: 'good',
    system: 'idle',
  };

  function caretIcon() {
    return icon(14, [['path', { d: 'M6 9l6 6 6-6' }]]);
  }

  /* ------- company names come from state only; text stays text ----------- */
  function companyNames(state) {
    var seen = {};
    function add(raw) {
      var n = String(raw || '').trim();
      if (n.length >= 2) seen[n] = 1;
      var m = /^(.*?)\s*\((.*?)\)$/.exec(n);
      if (m) {
        if (m[1].trim().length >= 2) seen[m[1].trim()] = 1;
        if (m[2].trim().length >= 2) seen[m[2].trim()] = 1;
      }
    }
    (state.applications || []).forEach(function (a) { add(a.company); });
    (state.queue || []).forEach(function (q) { add(q.company); });
    (state.platforms || []).forEach(function (p) { add(p.name); });
    var names = Object.keys(seen);
    names.sort(function (a, b) { return b.length - a.length; });
    return names;
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* split the entry text around company-name matches; matched names become
     accent-tinted spans, everything else stays plain text nodes */
  function richText(text, re) {
    text = String(text || '');
    var kids = [];
    if (!re) return [text];
    re.lastIndex = 0;
    var last = 0;
    var m;
    while ((m = re.exec(text))) {
      var start = m.index;
      var end = start + m[0].length;
      var before = start === 0 ? '' : text.charAt(start - 1);
      var after = end >= text.length ? '' : text.charAt(end);
      if (/[A-Za-z0-9]/.test(before) || /[A-Za-z0-9]/.test(after)) continue;
      if (start > last) kids.push(text.slice(last, start));
      kids.push(CMC.h('span', { class: 'act-co' }, m[0]));
      last = end;
    }
    if (last < text.length) kids.push(text.slice(last));
    return kids.length ? kids : [text];
  }

  function sortedRows(state) {
    var rows = (state.activity || []).slice();
    rows.sort(function (a, b) {
      var ta = Date.parse(a.ts) || 0;
      var tb = Date.parse(b.ts) || 0;
      if (tb !== ta) return tb - ta;
      return String(a.id) < String(b.id) ? 1 : -1;
    });
    return rows;
  }

  function feedRow(row, re) {
    var kind = SHAPES[row.kind] ? row.kind : 'system';
    var when = CMC.fmt.ago(row.ts);
    var full = CMC.fmt.date(row.ts);
    var t = CMC.fmt.time(row.ts);
    if (t) full += ', ' + t;
    return CMC.h('li', { class: 'act-row' + (kind === 'win' ? ' is-win' : '') },
      CMC.h('span', { class: 'act-ic', 'data-k': KIND_COLOR[kind] || 'idle' }, icon(15, SHAPES[kind])),
      CMC.h('p', { class: 'act-text' }, richText(row.text, re)),
      CMC.h('span', { class: 'act-time mono', title: full }, when));
  }

  function emptyState() {
    return CMC.h('div', { class: 'act-empty' },
      icon(26, SHAPES.scan),
      CMC.h('span', { class: 'act-empty-t' }, 'Nothing in the log yet'),
      CMC.h('p', { class: 'act-empty-s' },
        'Every scan, new match, application, and interview will land here the moment it happens.'));
  }

  function render(el, state, ui) {
    var rows = sortedRows(state);
    var names = companyNames(state);
    var re = names.length ? new RegExp(names.map(escapeRe).join('|'), 'g') : null;

    var limit = (deskMq && deskMq.matches) ? LIMIT_DESK : LIMIT;
    var showAll = !!ui.actShowAll;
    var earlier = Math.max(0, rows.length - limit);
    var visible = (showAll || earlier === 0) ? rows : rows.slice(0, limit);

    var body;
    if (!rows.length) {
      body = emptyState();
    } else {
      var kids = [CMC.h('ol', { class: 'act-feed', 'aria-label': 'Mission log entries, newest first' },
        visible.map(function (r) { return feedRow(r, re); }))];
      if (earlier > 0) {
        kids.push(CMC.h('div', { class: 'act-foot' },
          CMC.h('button', {
            type: 'button',
            class: 'act-more',
            'aria-expanded': showAll ? 'true' : 'false',
            onclick: function () { ui.actShowAll = !ui.actShowAll; CMC.rerender('activity'); },
          },
            showAll ? 'Show fewer' : 'Show ' + earlier + ' earlier ' + (earlier === 1 ? 'entry' : 'entries'),
            caretIcon()),
          showAll ? null : CMC.h('p', { class: 'act-foot-note' },
            'Showing the latest ' + visible.length + ' of ' + rows.length)));
      }
      body = kids;
    }

    el.textContent = '';
    el.appendChild(CMC.h('div', { class: 'panel act-panel' },
      CMC.h('div', { class: 'panel-head' },
        CMC.h('h2', { class: 'panel-title' }, 'Mission log'),
        rows.length ? CMC.h('span', { class: 'chip mono', title: rows.length + ' log entries' }, String(rows.length)) : null,
        CMC.h('span', { class: 'panel-kicker' }, 'newest first')),
      CMC.h('div', { class: 'panel-body act-body' }, body)));
  }

  CMC.register('activity', { render: render });
})();
