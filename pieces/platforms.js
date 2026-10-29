/* piece: platforms, shown as "Intel sources": every board and feed Claude
   pulls from, fleet-status style. Three count chips, a by-method bar list,
   then collapsible groups in a fixed order. Reads CMC.state.platforms,
   keeps open/closed state, the Show all boards toggle and the method
   legend toggle in CMC.ui, and renders every value through CMC.h text
   nodes. Nothing here writes. Every toggle rebuilds the slot, so the
   focused control is found again by id after the rebuild (the panel
   contract in BASE-CODE 5.4). */
(function () {
  'use strict';

  var CMC = window.CMC;
  if (!CMC) return;

  var NS = 'http://www.w3.org/2000/svg';

  /* fixed group order: the seven original groups first, then the groups
     from the Oct 10 remote-platforms sheet. Any group not listed lands
     after these, in the order it first appears in the data. */
  var GROUPS = [
    'Field-service & trades software',
    'Lawn & home-services marketplaces',
    'Construction tech',
    'Facilities & vendor management',
    'AI training platforms',
    'Remote job boards',
    'Search feeds',
    'Remote job boards (sweep)',
    'Other employers',
    'Side income platforms',
    'On hold',
  ];
  var HOLD_GROUP = 'On hold';
  var OTHER_GROUP = 'Other platforms';

  var KIND_LABELS = {
    company_board: 'Company board',
    job_board: 'Job board',
    search_feed: 'Search feed',
    ai_platform: 'AI platform',
    signup: 'Sign-up platform',
  };

  /* how Claude pulls from a board. key '' is the original boards, which
     carry no method field. The bar list and the legend share this table. */
  var METHODS = [
    { key: 'AUTO', label: 'AUTO', what: 'scanner provider' },
    { key: 'SEARCH', label: 'SEARCH', what: 'web or connector search' },
    { key: 'SWEEP', label: 'SWEEP', what: 'browser sweep' },
    { key: 'EMPLOYER', label: 'EMPLOYER', what: 'single company careers page' },
    { key: 'SIGNUP', label: 'SIGNUP', what: 'account you create, not scanned' },
    { key: 'HOLD', label: 'HOLD', what: 'on hold' },
    { key: '', label: 'Company boards', what: 'the boards from the first setup' },
  ];

  /* display text passes through here: plain words, never an em or en dash */
  function plain(s) {
    return String(s === null || s === undefined ? '' : s).replace(/\s*[\u2014\u2013]\s*/g, ', ');
  }

  function methodOf(p) { return plain(p.method).trim().toUpperCase(); }
  function methodWhat(m) {
    for (var i = 0; i < METHODS.length; i++) if (METHODS[i].key === m) return METHODS[i].what;
    return '';
  }

  function isOn(p) { return p.enabled !== false; }
  function scanned(p) { return !!p.lastScan; }
  /* the honest coverage test: turned on, answered the last reachability
     check, and scanned at least once. A silent board never counts. */
  function isProducing(p) { return isOn(p) && p.health === 'reachable' && scanned(p); }
  /* a board with health "unknown" and no scan yet is simply new: it waits
     for its first scan and does not need Chris. A failed check (network,
     auth) or an unknown result after a real scan does need a look. */
  function notScanned(p) { return !scanned(p) && (!p.health || p.health === 'unknown'); }
  function needsLook(p) {
    if (notScanned(p)) return false;
    return p.health === 'network' || p.health === 'auth' || p.health === 'unknown';
  }

  function alertLabel(health) {
    if (health === 'auth') return 'Blocked, needs attention';
    if (health === 'network') return 'Not reachable, check this';
    return 'Needs a check';
  }

  /* ---------------- inline svg icons -------------------------------------- */
  function icon(size, parts, sw) {
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', sw || '1.8');
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
  function caretIcon() {
    return icon(14, [['path', { d: 'M6 9l6 6 6-6' }]], '2.2');
  }
  function outIcon() {
    return icon(13, [
      ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }],
      ['polyline', { points: '15 3 21 3 21 9' }],
      ['line', { x1: 10, y1: 14, x2: 21, y2: 3 }],
    ], '2');
  }
  function radioIcon() {
    return icon(26, [
      ['circle', { cx: 12, cy: 12, r: 2 }],
      ['path', { d: 'M16.24 7.76a6 6 0 0 1 0 8.49' }],
      ['path', { d: 'M7.76 16.24a6 6 0 0 1 0-8.49' }],
      ['path', { d: 'M19.07 4.93a10 10 0 0 1 0 14.14' }],
      ['path', { d: 'M4.93 19.07a10 10 0 0 1 0-14.14' }],
    ]);
  }

  /* ---------------- status dots ------------------------------------------- */
  function rowDotClass(p) {
    if (!isOn(p)) return 'dot-hollow';
    if (notScanned(p)) return 'dot-idle';
    return 'dot-' + CMC.statusKind(p.health);
  }
  function groupDotClass(rows) {
    /* A broken platform turns its group amber even when it is turned off:
       today that is exactly right for The Muse (off BECAUSE it is blocked,
       and Chris should still see the group needs attention). If a platform
       is ever turned off on purpose while broken and should stop flagging
       its group, add an isOn() guard to this loop. */
    var i;
    for (i = 0; i < rows.length; i++) if (needsLook(rows[i])) return 'dot-warn';
    var anyOn = false, anyGood = false;
    for (i = 0; i < rows.length; i++) {
      if (!isOn(rows[i])) continue;
      anyOn = true;
      if (rows[i].health === 'reachable') anyGood = true;
    }
    if (!anyOn) return 'dot-hollow';
    return anyGood ? 'dot-good' : 'dot-idle';
  }

  /* ---------------- ui state ----------------------------------------------- */
  /* Chris's own taps (ui.pfOpen) always win. Default: every group stays
     closed (the header row already carries the count and a status dot)
     and only a group with a board that needs a look opens, so the panel
     shows less on a busy day and the one thing that needs him is in view. */
  function groupOpen(ui, key, alert) {
    if (ui.pfOpen && (key in ui.pfOpen)) return !!ui.pfOpen[key];
    return alert;
  }
  /* focus survives the rebuild a toggle (or a live snapshot) triggers:
     note the focused control inside this panel by id before clearing,
     then find it again on the new DOM. Skipped while a sheet or drawer
     is on top, so focus stays where that thing put it. */
  function focusedId(el) {
    var ae = document.activeElement;
    return (ae && ae.id && el.contains(ae)) ? ae.id : '';
  }
  function refocus(el, id) {
    if (!id || CMC.modalOpen()) return;
    var f = document.getElementById(id);
    if (!f || !el.contains(f) || f.disabled) return;
    try { f.focus({ preventScroll: true }); } catch (e) { try { f.focus(); } catch (e2) { /* not focusable */ } }
  }

  function onToggle(ui, key, open) {
    if (!ui.pfOpen) ui.pfOpen = {};
    ui.pfOpen[key] = !open;
    CMC.rerender('platforms');
  }
  function onShowAll(ui) {
    ui.pfShowAll = !ui.pfShowAll;
    CMC.rerender('platforms');
  }
  function onLegend(ui) {
    ui.pfLegend = !ui.pfLegend;
    CMC.rerender('platforms');
  }

  /* ---------------- row ----------------------------------------------------- */
  function row(p) {
    var h = CMC.h, fmt = CMC.fmt;
    var name = plain(p.name);
    var note = plain(p.note);
    var kindLabel = KIND_LABELS[p.kind] || plain(p.kindLabel) || 'Platform';
    var method = methodOf(p);
    var on = isOn(p);
    /* only a real http(s) address becomes a link (db docs are data) */
    var linkUrl = CMC.safeUrl(p.url);
    var hasLink = !!linkUrl;

    var status;
    if (needsLook(p)) {
      status = h('span', { class: 'pf-scan pf-alert mono' }, alertLabel(p.health));
    } else if (on && p.health === 'empty' && p.lastScan) {
      /* say it in words, never by dot color alone */
      status = h('span', { class: 'pf-scan mono', title: 'Answered the last scan but had no matches' },
        fmt.scan(p.lastScan) + ' · no matches');
    } else if (p.lastScan) {
      var scannedAt = fmt.scan(p.lastScan);
      status = h('span', { class: 'pf-scan mono', title: 'Last scanned ' + scannedAt }, scannedAt);
    } else if (method === 'SIGNUP') {
      /* a sign-up platform is a checklist item, never a scan source, so
         "yet" would be a promise the scanner cannot keep */
      status = h('span', { class: 'pf-scan pf-noscan mono', title: 'An account you create. Claude does not scan it.' }, 'Not a scan source');
    } else {
      status = h('span', { class: 'pf-scan pf-noscan mono', title: 'Shows the time of the first scan once it runs' }, 'Not scanned yet');
    }

    return h('li', {
      class: 'pf-row' + (on ? '' : ' is-off') + (hasLink ? '' : ' no-link')
        + (p.kind === 'search_feed' ? ' is-feed' : ''),
    },
      h('span', { class: 'dot ' + rowDotClass(p), title: on ? undefined : 'Turned off' }),
      h('span', { class: 'pf-main' },
        h('span', { class: 'pf-name' }, name),
        h('span', { class: 'chip pf-kind' }, kindLabel),
        method ? h('span', { class: 'pf-method mono', title: methodWhat(method) ? 'Method: ' + methodWhat(method) : 'Method' }, method) : null,
        on ? null : h('span', { class: 'pf-off mono', title: 'Turned off. Claude does not pull from it.' }, 'Off'),
        note ? h('span', { class: 'pf-note', title: note }, note) : null),
      status,
      hasLink ? h('a', {
        class: 'pf-link',
        id: 'pf-link-' + p.id,
        href: linkUrl,
        target: '_blank',
        rel: 'noopener noreferrer',
        'aria-label': 'Open ' + name + ' in a new tab',
        title: 'Open ' + name + ' in a new tab',
      }, outIcon()) : null);
  }

  /* ---------------- group --------------------------------------------------- */
  function group(key, rows, idx, ui, showAll) {
    var h = CMC.h;
    var isHold = key === HOLD_GROUP;
    var on = 0, alert = false;
    for (var i = 0; i < rows.length; i++) {
      if (isOn(rows[i])) on++;
      if (needsLook(rows[i])) alert = true;
    }
    var open = groupOpen(ui, key, alert);
    var listId = 'pf-list-' + idx;
    /* Show all boards off: disabled rows stay out of sight, except in
       On hold, where every row is off by definition and shows muted */
    var shown = (showAll || isHold) ? rows : rows.filter(isOn);
    var hidden = rows.length - shown.length;
    var countText = (on === rows.length)
      ? on + ' enabled'
      : on + ' of ' + rows.length + ' enabled';

    var items = shown.map(row);
    if (!shown.length) {
      items.push(h('li', { class: 'pf-ghint' }, hidden === 1
        ? 'The one board here is turned off. Tap Show all boards to see it.'
        : 'All ' + hidden + ' boards here are turned off. Tap Show all boards to see them.'));
    }

    return h('section', { class: 'pf-group' + (open ? ' is-open' : '') + (isHold ? ' is-hold' : '') },
      h('button', {
        type: 'button',
        class: 'pf-ghead',
        id: 'pf-ghead-' + idx,
        'aria-expanded': open ? 'true' : 'false',
        'aria-controls': listId,
        title: open ? 'Tap to close this group' : 'Tap to open this group',
        onclick: function () { onToggle(ui, key, open); },
      },
        h('span', { class: 'dot ' + groupDotClass(rows) }),
        h('span', { class: 'pf-gname' }, plain(key)),
        h('span', { class: 'pf-gcount mono' }, countText),
        h('span', { class: 'pf-caret' + (open ? ' is-up' : '') }, caretIcon())),
      h('ul', { class: 'pf-list', id: listId, hidden: !open }, items));
  }

  /* ---------------- counts -------------------------------------------------- */
  function tally(platforms) {
    var t = { enabled: 0, disabled: 0, producing: 0, pending: 0, latest: '', look: [] };
    for (var i = 0; i < platforms.length; i++) {
      var p = platforms[i];
      if (isOn(p)) t.enabled++; else t.disabled++;
      if (isProducing(p)) t.producing++;
      /* enabled scan sources still waiting for their first scan (a sign-up
         platform is never scanned, so it does not wait for anything) */
      if (isOn(p) && notScanned(p) && methodOf(p) !== 'SIGNUP') t.pending++;
      if (needsLook(p)) t.look.push(plain(p.name));
      var ls = p.lastScan || '';
      if (ls && ls > t.latest) t.latest = ls;
    }
    return t;
  }

  /* three facts under the chips: when the fleet last ran, what needs a
     look (even when a broken board is tucked away by the toggle), and how
     many enabled boards are still waiting for a first scan */
  function facts(t) {
    var h = CMC.h, fmt = CMC.fmt;
    var lookText;
    if (!t.look.length) lookText = 'nothing right now';
    else if (t.look.length <= 2) lookText = t.look.join(' and ');
    else lookText = t.look.length + ' boards';
    var pendingText = t.pending === 0 ? 'none'
      : (t.pending === 1 ? '1 enabled board' : t.pending + ' enabled boards');
    function fact(label, value, kind) {
      return h('div', { class: 'pf-fact' },
        h('span', { class: 'pf-fk' }, label),
        h('span', { class: 'pf-fv' + (kind ? ' is-' + kind : '') }, value));
    }
    return h('div', { class: 'pf-facts' },
      fact('Last scan', t.latest ? fmt.scan(t.latest) : 'none yet'),
      fact('Needs a look', lookText, t.look.length ? 'warn' : ''),
      fact('First scan pending', pendingText));
  }

  function countChip(cls, dotCls, n, word, title) {
    var h = CMC.h;
    return h('span', { class: 'chip mono pf-chip' + (cls ? ' ' + cls : ''), title: title },
      h('span', { class: 'dot ' + dotCls }),
      h('span', { class: 'pf-chip-n' }, String(n)),
      ' ' + word);
  }

  /* ---------------- summary block -------------------------------------------- */
  function summary(platforms, ui, hiddenCount) {
    var h = CMC.h;
    var t = tally(platforms);
    var showAll = !!ui.pfShowAll;
    var toggleTitle;
    if (!hiddenCount) toggleTitle = 'Every board is already showing';
    else if (showAll) toggleTitle = 'Showing every board. Tap to tuck the turned-off ones away again.';
    else toggleTitle = hiddenCount === 1 ? '1 turned-off board is tucked away. Tap to show it.' : hiddenCount + ' turned-off boards are tucked away. Tap to show them.';

    return h('div', { class: 'pf-sum' },
      h('div', { class: 'pf-sum-row' },
        h('div', { class: 'pf-chips', role: 'group', 'aria-label': 'Board counts' },
          countChip('', 'dot-info', t.enabled, 'enabled', 'Boards Claude is allowed to pull from'),
          countChip('chip-idle', 'dot-hollow', t.disabled, 'disabled', 'Boards turned off, on hold or blocked'),
          countChip('chip-good', 'dot-good', t.producing, 'producing', 'Enabled, reachable at the last check and scanned at least once. This is the real coverage number.')),
        h('button', {
          type: 'button',
          class: 'chip-btn pf-showall',
          id: 'pf-showall',
          'aria-pressed': showAll ? 'true' : 'false',
          disabled: !hiddenCount,
          title: toggleTitle,
          onclick: function () { onShowAll(ui); },
        }, 'Show all boards', h('span', { class: 'n' }, String(hiddenCount)))),
      h('p', { class: 'pf-sumnote' }, 'Health is from the last reachability check. New platforms show Not scanned yet until the first scan.'),
      facts(t));
  }

  /* ---------------- by method bar list ---------------------------------------- */
  /* the bars first; what each method means waits behind one small toggle
     (and sits on every row as a hover title) so the block stays short */
  function methodBlock(platforms, ui) {
    var h = CMC.h;
    var legendOpen = !!ui.pfLegend;
    var counts = {};
    platforms.forEach(function (p) {
      var m = methodOf(p);
      counts[m] = (counts[m] || 0) + 1;
    });
    var rows = METHODS.map(function (m, i) {
      return { label: m.label, mono: m.key !== '', n: counts[m.key] || 0, order: i, what: m.what };
    });
    /* a method the table does not know still gets a bar, after the known ones */
    var known = {};
    METHODS.forEach(function (m) { known[m.key] = 1; });
    for (var k in counts) if (!known[k]) rows.push({ label: k, mono: true, n: counts[k], order: rows.length });
    rows.sort(function (a, b) { return (b.n - a.n) || (a.order - b.order); });
    var max = rows[0].n || 1;

    return h('div', { class: 'pf-methods' },
      h('span', { class: 'pf-methods-k' }, 'By method'),
      h('div', { class: 'pf-mlist', role: 'list', 'aria-label': 'Boards by method' }, rows.map(function (r) {
        var pct = Math.max(0, Math.round((r.n / max) * 100));
        return h('div', { class: 'pf-mrow' + (r.n === 0 ? ' is-zero' : ''), role: 'listitem', title: r.what ? r.label + ': ' + r.what : undefined },
          h('span', { class: 'pf-mlabel' + (r.mono ? ' mono' : '') }, r.label),
          h('span', { class: 'pf-mtrack', 'aria-hidden': 'true' },
            h('span', { class: 'pf-mbar', style: { width: pct + '%' } })),
          h('span', { class: 'pf-mn mono' }, String(r.n)));
      })),
      h('div', { class: 'pf-legend-row' },
        h('button', {
          type: 'button',
          class: 'chip-btn pf-legend-btn',
          id: 'pf-legend-btn',
          'aria-expanded': legendOpen ? 'true' : 'false',
          'aria-controls': 'pf-legend',
          title: legendOpen ? 'Tap to tuck the meanings away' : 'Tap to see what each method means',
          onclick: function () { onLegend(ui); },
        }, 'What the methods mean', h('span', { class: 'pf-caret' + (legendOpen ? ' is-up' : '') }, caretIcon()))),
      h('dl', { class: 'pf-legend', id: 'pf-legend', hidden: !legendOpen }, METHODS.map(function (m) {
        return [h('dt', { class: m.key ? 'mono' : '' }, m.label), h('dd', {}, m.what)];
      })));
  }

  /* ---------------- footer line ----------------------------------------------- */
  function footer(platforms) {
    var h = CMC.h;
    var t = tally(platforms);
    return h('p', { class: 'pf-foot' },
      t.enabled + (t.enabled === 1 ? ' board' : ' boards') + ' enabled, ' + t.disabled + ' disabled. Health from the last reachability check.');
  }

  function emptyState() {
    var h = CMC.h;
    return h('div', { class: 'pf-empty' },
      radioIcon(),
      h('span', { class: 'pf-empty-t' }, 'No intel sources yet'),
      h('p', { class: 'pf-empty-s' }, 'When Claude hooks up job boards, company pages, search feeds and sign-up platforms, they all show up here with their health and last scan.'));
  }

  /* ---------------- render --------------------------------------------------- */
  function render(el, state, ui) {
    var h = CMC.h;

    var platforms = state.platforms || [];
    var byGroup = {};
    var order = GROUPS.slice();
    platforms.forEach(function (p) {
      var g = p.group || OTHER_GROUP;
      if (!byGroup[g]) {
        byGroup[g] = [];
        if (order.indexOf(g) < 0) order.push(g);
      }
      byGroup[g].push(p);
    });

    var showAll = !!ui.pfShowAll;
    /* the rows the toggle actually controls: turned off and not in On hold
       (On hold rows show muted no matter what) */
    var hiddenCount = 0;
    platforms.forEach(function (p) {
      if (!isOn(p) && (p.group || OTHER_GROUP) !== HOLD_GROUP) hiddenCount++;
    });

    var body;
    if (!platforms.length) {
      body = [emptyState()];
    } else {
      var groups = [];
      var idx = 0;
      order.forEach(function (key) {
        if (!byGroup[key]) return;
        groups.push(group(key, byGroup[key], idx, ui, showAll));
        idx++;
      });
      body = [
        h('div', { class: 'pf-top' }, summary(platforms, ui, hiddenCount), methodBlock(platforms, ui)),
        h('div', { class: 'pf-groups' }, groups),
        footer(platforms),
      ];
    }

    var keep = focusedId(el);
    el.textContent = '';
    el.appendChild(h('section', { class: 'panel pf-panel', 'aria-label': 'Intel sources' },
      h('div', { class: 'panel-head' },
        h('h2', { class: 'panel-title' }, 'Intel sources'),
        platforms.length ? h('span', { class: 'chip mono' }, String(platforms.length)) : null,
        h('span', { class: 'panel-kicker' }, 'every board and feed Claude pulls from')),
      h('div', { class: 'panel-body pf-body' }, body)));
    refocus(el, keep);
  }

  CMC.register('platforms', { render: render });
})();
