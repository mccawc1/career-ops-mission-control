/* piece: pipeline: the funnel plus every application. Stage pills filter by
   CURRENT status (effective: a New row with a live prep request is In queue);
   the funnel block shows CUMULATIVE reach per Career Ops ranks over the
   applications that were actually sent (a dateApplied stamp, the same rule
   the KPI deck uses; Rejected counts as a response; Interview includes Offer
   and Hired). Reads CMC.state, writes only via CMC.act.*, UI state lives in
   CMC.ui (plBusy, plFilter, plShowClosed, plOpen, plFocus, plFocusTries).
   Every status move goes through the shared retire pattern: retireQueue
   first (so the Apply queue never keeps prepping a job Chris moved on from),
   then setAppStatus with keepQueue, and the log line carries r.note. */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  /* pills filter by current status; label "New" = Evaluated per contract */
  var PILLS = [
    { key: 'Evaluated', label: 'New', hint: 'Scored by Claude, not applied yet' },
    { key: 'queued', label: 'In queue', hint: 'Claude is prepping the application' },
    { key: 'Applied', label: 'Applied', hint: 'Sent, waiting to hear back' },
    { key: 'Responded', label: 'Heard back', hint: 'They wrote back' },
    { key: 'Interview', label: 'Interview', hint: 'Interview stage' },
    { key: 'Offer', label: 'Offer', hint: 'Offer on the table' },
    { key: 'Hired', label: 'Hired', hint: 'Signed and done' },
  ];

  /* cumulative funnel ranks (Career Ops): each stage counts everything that
     got at least that far, among the applications that were actually sent.
     A row only counts when it carries a dateApplied stamp (wasSent), the
     same definition the KPI deck uses for "n answers from m sent", so a row
     that jumped to Interview or Rejected without an application never pads
     "Ever applied" or "Ever heard back". Rejected after a send = a response.
     "Ever" phrasing keeps the cumulative counts from reading as
     current-status counts (the pills). */
  var FUNNEL = [
    { label: 'Ever applied', set: { Applied: 1, Responded: 1, Rejected: 1, Interview: 1, Offer: 1, Hired: 1 } },
    { label: 'Ever heard back', set: { Responded: 1, Rejected: 1, Interview: 1, Offer: 1, Hired: 1 } },
    { label: 'Ever interviewed', set: { Interview: 1, Offer: 1, Hired: 1 } },
    { label: 'Ever got an offer', set: { Offer: 1, Hired: 1 } },
    { label: 'Hired', set: { Hired: 1 } },
  ];

  var CLOSED = { Rejected: 1, Discarded: 1 };
  /* sent = a real dateApplied stamp (set on the first move to Applied, or by
     "Chris submitted it"); a bad or missing date never counts as sent */
  function wasSent(app) {
    return !!(app.dateApplied && !isNaN(Date.parse(app.dateApplied)));
  }
  var RANK = { Hired: 0, Offer: 1, Interview: 2, Responded: 3, Applied: 4, queued: 5, Evaluated: 6, found: 7, Rejected: 8, Discarded: 9 };
  var MS_30_DAYS = 30 * 24 * 60 * 60 * 1000;

  /* a New or found app with a live (not submitted) Apply queue doc shows as
     queued; CMC.queueFor is the one reader the tracker and drawer use too */
  function effStatus(app) {
    if ((app.status === 'Evaluated' || app.status === 'found') && CMC.queueFor(app.id)) return 'queued';
    return app.status;
  }

  /* default filter per CONTRACT-DESIGN, exactly: hide Rejected and Discarded
     older than 30 days; everything else stays. Fresh rejections stay on the
     board so Chris sees what just closed, and a closed app with no usable
     date is NOT assumed old, it stays visible. "Show closed" reveals all of
     the hidden ones. */
  function isOldClosed(app, now) {
    if (!CLOSED[app.status]) return false;
    var t = Date.parse(app.statusChangedAt || app.dateApplied || app.dateFound || '') || 0;
    return !!t && now - t > MS_30_DAYS;
  }

  function chipLabel(status) {
    if (status === 'queued') return 'In queue';
    if (status === 'found') return 'New link';
    /* same plain word as the stage pill: Evaluated reads as "New" */
    if (status === 'Evaluated') return 'New';
    /* one user-facing word for the Responded status, everywhere: Heard back */
    if (status === 'Responded') return 'Heard back';
    /* and Discarded is "Passed", the same word the tracker and drawer use */
    if (status === 'Discarded') return 'Passed';
    return String(status || '');
  }

  function bandClass(score) {
    if (typeof score !== 'number' || isNaN(score)) return '';
    if (score >= 4.5) return ' band-strong';
    if (score >= 4.0) return ' band-good';
    if (score >= 3.5) return ' band-edge';
    return '';
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
  function flagIcon() {
    return icon(10, [
      ['path', { d: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z' }],
      ['line', { x1: 4, y1: 22, x2: 4, y2: 15 }],
    ], '2.4');
  }
  function layersIcon() {
    return icon(26, [
      ['polygon', { points: '12 2 2 7 12 12 22 7 12 2' }],
      ['polyline', { points: '2 12 12 17 22 12' }],
      ['polyline', { points: '2 17 12 22 22 17' }],
    ]);
  }

  /* ---------------- ui helpers ------------------------------------------- */
  function busyMap(ui) {
    if (!ui.plBusy) ui.plBusy = {};
    return ui.plBusy;
  }
  function finishBusy(ui, key) {
    return function () {
      delete busyMap(ui)[key];
      CMC.rerender('pipeline');
    };
  }
  function onPill(key, ui) {
    ui.plFilter = ui.plFilter === key ? null : key;
    CMC.rerender('pipeline');
  }
  function onToggleClosed(ui) {
    ui.plShowClosed = !ui.plShowClosed;
    CMC.rerender('pipeline');
  }
  function onCard(app, ui) {
    ui.plOpen = ui.plOpen === app.id ? null : app.id;
    CMC.rerender('pipeline');
  }
  function clearFilter(ui) {
    ui.plFilter = null;
    CMC.rerender('pipeline');
  }

  /* ---------------- data actions ------------------------------------------ */
  function onApply(app, ui) {
    if (busyMap(ui)[app.id]) return;
    busyMap(ui)[app.id] = true;
    /* the card updates optimistically inside applyTo; the mission-log line
       waits for the queue write to land so a failed save never logs
       "Claude is prepping" for a request that never saved */
    var p = CMC.act.applyTo(app.id).then(function (ok) {
      if (ok) CMC.act.addActivity('You tapped Apply on ' + (app.company || 'a match') + ', ' + (app.role || 'new role') + '. Claude is prepping the application.', 'queue');
    });
    var fin = finishBusy(ui, app.id);
    p.then(fin, fin);
  }
  /* the shared retire pattern: the queue doc is retired first (deleted, or
     marked submitted on Applied), the app moves with keepQueue so the
     foundation does not retire it twice, and the log line says when the
     job left the Apply queue */
  function onSetStatus(app, ui, to, text, kind) {
    if (busyMap(ui)[app.id]) return;
    busyMap(ui)[app.id] = true;
    var r = CMC.act.retireQueue(app.id, to);
    var writes = [CMC.act.setAppStatus(app.id, to, { keepQueue: true })];
    if (r.write) writes.push(r.write);
    CMC.act.addActivity(text + r.note, kind);
    var fin = finishBusy(ui, app.id);
    Promise.all(writes).then(fin, fin);
  }

  /* status-change buttons per current status, plain words, honest targets */
  function moveButtons(app, ui) {
    var co = app.company || 'this company';
    var saidNo = { label: 'They said no', to: 'Rejected', text: co + ' said no. On to the next one.', kind: 'system' };
    switch (effStatus(app)) {
      case 'Evaluated':
        return [
          { label: 'Apply', primary: true, apply: true },
          { label: 'Pass', to: 'Discarded', text: 'You passed on ' + co + '.', kind: 'system' },
        ];
      case 'queued':
        /* Pass pulls the prep request too (the retire pattern adds the
           "Pulled it from the Apply queue." note); Details opens the drawer */
        return [
          { label: 'Pass', to: 'Discarded', text: 'You passed on ' + co + '.', kind: 'system' },
          { label: 'Details', drawer: true },
        ];
      case 'Applied':
        return [
          { label: 'They answered', to: 'Responded', text: co + ' answered your application.', kind: 'system' },
          saidNo,
        ];
      case 'Responded':
        return [
          { label: 'Interview booked', to: 'Interview', text: 'Interview booked with ' + co + '.', kind: 'interview' },
          saidNo,
        ];
      case 'Interview':
        return [
          { label: 'Got an offer', to: 'Offer', text: 'Offer from ' + co + ' is on the table.', kind: 'offer' },
          saidNo,
        ];
      case 'Offer':
        return [
          { label: 'I took the job', primary: true, to: 'Hired', text: 'You accepted the ' + co + ' offer. Mission complete.', kind: 'win' },
          { label: 'I turned it down', to: 'Discarded', text: 'You turned down the ' + co + ' offer.', kind: 'system' },
        ];
      case 'Rejected':
      case 'Discarded':
        return [
          { label: 'Back in the running', to: 'Evaluated', text: co + ' is back in the running.', kind: 'system' },
        ];
      default:
        return [];
    }
  }

  function noteLine(status) {
    switch (status) {
      case 'found': return { dot: 'dot-info', text: 'You added this link. Claude scores it on the next pass.' };
      case 'queued': return { dot: 'dot-info', text: 'In the Apply queue. Claude is prepping the application for sign-off.' };
      case 'Hired': return { dot: 'dot-good', text: 'You took this job. Mission complete.' };
      default: return null;
    }
  }

  /* ---------------- pieces of the panel ----------------------------------- */
  function pillRow(apps, ui) {
    var h = CMC.h;
    return h('div', { class: 'pl-pills', role: 'group', 'aria-label': 'Filter applications by stage' },
      PILLS.map(function (p) {
        var n = apps.filter(function (a) { return effStatus(a) === p.key; }).length;
        var on = ui.plFilter === p.key;
        var kind = CMC.statusKind(p.key);
        return h('button', {
          type: 'button',
          id: 'pl-pill-' + p.key,
          class: 'pl-pill' + (on ? ' is-on' : '') + (n === 0 ? ' is-empty' : ''),
          'data-pill': p.key,
          'aria-pressed': on ? 'true' : 'false',
          title: p.hint + '. ' + (on ? 'Tap again to show everything.' : 'Tap to show only these.'),
          onclick: function () { onPill(p.key, ui); },
        },
          /* an empty stage gets the hollow dot: nothing here yet */
          h('span', { class: 'dot dot-' + kind + (n === 0 ? ' dot-hollow' : '') }),
          h('span', { class: 'pl-pill-l' }, p.label),
          h('span', { class: 'pl-pill-n mono' }, String(n)));
      }));
  }

  function funnelBlock(apps) {
    var h = CMC.h;
    var rows = FUNNEL.map(function (f) {
      return { label: f.label, n: apps.filter(function (a) { return wasSent(a) && f.set[a.status] === 1; }).length };
    });
    if (!rows[0].n) return null;
    var max = rows[0].n;
    return h('div', { class: 'pl-funnel' },
      h('span', { class: 'pl-funnel-k' }, 'From applied to hired'),
      rows.map(function (r) {
        var pct = Math.max(0, Math.round((r.n / max) * 100));
        return h('div', { class: 'pl-frow' + (r.n === 0 ? ' is-zero' : '') },
          h('span', { class: 'pl-flabel' }, r.label),
          h('span', { class: 'pl-ftrack' },
            h('span', { class: 'pl-fbar', style: { width: pct + '%' } })),
          h('span', { class: 'pl-fn mono' }, String(r.n)));
      }),
      h('span', { class: 'pl-funnel-s' }, 'Only applications with a sent date count. Each row includes everything that got at least that far.'));
  }

  function cardSummary(app, ui, open, detailId) {
    var h = CMC.h, fmt = CMC.fmt;
    var kind = CMC.statusKind(effStatus(app));
    var scoreText = (typeof app.score === 'number' && !isNaN(app.score)) ? app.score.toFixed(1) : null;

    var meta = [];
    if (app.platform) meta.push(app.platform);
    if (app.dateFound) meta.push('found ' + fmt.date(app.dateFound));
    if (app.dateApplied) meta.push('applied ' + fmt.date(app.dateApplied));

    return h('button', {
      type: 'button',
      id: 'pl-sum-' + app.id,
      class: 'pl-sum',
      'data-app': app.id,
      'aria-expanded': open ? 'true' : 'false',
      'aria-controls': detailId,
      onclick: function () { onCard(app, ui); },
    },
      h('span', { class: 'pl-toprow' },
        h('span', { class: 'pl-co' }, app.company || ''),
        scoreText ? h('span', {
          class: 'pl-score mono' + bandClass(app.score),
          title: 'Fit score ' + scoreText + ' out of 5',
        }, scoreText, h('small', null, '/5')) : h('span', {
          class: 'pl-score pl-score-na mono',
          title: 'Claude has not scored this one yet',
        }, 'Not scored yet')),
      h('span', { class: 'pl-role' }, app.role || ''),
      meta.length ? h('span', { class: 'pl-meta mono' }, meta.join(' · ')) : null,
      h('span', { class: 'pl-chiprow' },
        h('span', { class: 'chip chip-' + kind },
          h('span', { class: 'dot dot-' + kind }),
          chipLabel(effStatus(app))),
        app.priority ? h('span', { class: 'chip chip-accent pl-pri' }, flagIcon(), 'Priority') : null,
        h('span', { class: 'pl-caret' + (open ? ' is-up' : '') }, caretIcon())));
  }

  function cardDetail(app, ui, detailId) {
    var h = CMC.h, fmt = CMC.fmt;
    var isBusy = !!busyMap(ui)[app.id];
    var facts = [];
    if (app.pay) facts.push(['Pay', app.pay]);
    if (app.location) facts.push(['Location', app.location]);
    if (app.nextDate) facts.push(['Next step', fmt.date(app.nextDate)]);
    var note = noteLine(effStatus(app));
    /* a link Chris added himself sits in Evaluated with no score yet */
    if (!note && effStatus(app) === 'Evaluated' && typeof app.score !== 'number') {
      note = { dot: 'dot-info', text: 'You added this link. Claude scores it on the next pass.' };
    }
    var btns = moveButtons(app, ui);
    /* only a real http(s) address becomes a link (db docs are data) */
    var postingUrl = CMC.safeUrl(app.url);

    return h('div', { class: 'pl-detail', id: detailId },
      note ? h('p', { class: 'pl-stline' },
        h('span', { class: 'dot ' + note.dot }),
        h('span', null, note.text)) : null,
      app.notes ? h('p', { class: 'pl-notes' }, app.notes) : null,
      facts.length ? h('div', { class: 'pl-facts' },
        facts.map(function (f) {
          return h('div', { class: 'pl-fact' },
            h('span', { class: 'pl-fk' }, f[0]),
            h('span', { class: 'pl-fv mono' }, f[1]));
        })) : null,
      (btns.length || postingUrl) ? h('div', { class: 'pl-acts' },
        btns.map(function (b) {
          /* Details only opens the drawer: never busy, never relabeled */
          if (b.drawer) {
            return h('button', {
              type: 'button',
              id: 'pl-details-' + app.id,
              class: 'btn btn-ghost',
              'data-app': app.id,
              onclick: function () { CMC.openDrawer(app.id); },
            }, b.label);
          }
          return h('button', {
            type: 'button',
            id: 'pl-act-' + app.id + '-' + slug(b.label),
            class: 'btn ' + (b.primary ? 'btn-primary' : 'btn-ghost'),
            'data-app': app.id,
            disabled: isBusy,
            onclick: function () {
              if (b.apply) onApply(app, ui);
              else onSetStatus(app, ui, b.to, b.text, b.kind);
            },
          }, isBusy ? 'Saving...' : b.label);
        }),
        postingUrl ? h('a', {
          id: 'pl-open-' + app.id,
          class: 'pl-open',
          'data-app': app.id,
          href: postingUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
        }, 'Open the posting', outIcon()) : null) : null);
  }

  function card(app, ui) {
    var h = CMC.h;
    var open = ui.plOpen === app.id;
    var detailId = 'pl-d-' + app.id;
    return h('article', {
      class: 'pl-card' + (open ? ' is-open' : ''),
      'data-k': CMC.statusKind(effStatus(app)),
    },
      cardSummary(app, ui, open, detailId),
      open ? cardDetail(app, ui, detailId) : null);
  }

  function emptyState(ui, filtered, label) {
    var h = CMC.h;
    return h('div', { class: 'pl-empty' },
      layersIcon(),
      h('span', { class: 'pl-empty-t' }, filtered ? 'Nothing in ' + label + ' right now' : 'No applications yet'),
      h('p', { class: 'pl-empty-s' }, filtered
        ? 'As jobs move forward they will land in this stage.'
        : 'When Claude finds and scores a match, it shows up here with everything else in play.'),
      /* data-pill: when this button goes away with the filter, focus lands
         on the pill that was filtering */
      filtered ? h('button', {
        type: 'button', id: 'pl-show-all', class: 'btn btn-ghost',
        'data-pill': ui.plFilter || null,
        onclick: function () { clearFilter(ui); },
      }, 'Show everything') : null);
  }

  function closedFoot(ui, closedCount) {
    var h = CMC.h;
    var shown = !!ui.plShowClosed;
    var text;
    if (shown) text = closedCount === 1 ? 'Showing 1 closed application older than 30 days.' : 'Showing ' + closedCount + ' closed applications older than 30 days.';
    else text = closedCount === 1 ? '1 closed application older than 30 days is hidden.' : closedCount + ' closed applications older than 30 days are hidden.';
    return h('p', { class: 'pl-foot' },
      h('span', { class: 'dot dot-idle' }),
      h('span', null, text),
      h('button', {
        type: 'button',
        id: 'pl-closed-btn',
        class: 'pl-showbtn',
        'aria-pressed': shown ? 'true' : 'false',
        onclick: function () { onToggleClosed(ui); },
      }, shown ? (closedCount === 1 ? 'Hide it again' : 'Hide them again') : (closedCount === 1 ? 'Show it' : 'Show them')));
  }

  /* ---------------- focus across the rebuild (contract 5.4) ---------------- */
  /* Every control here has a stable id: the pill key, or the app id plus the
     button's label. Before the slot is cleared we note the focused control
     and the places focus can fall back to when that control is gone after
     the move (Pass turns into Back in the running, a filtered card leaves
     its stage, Show everything leaves with the filter): the card's summary,
     the pill the control named, the pill that is filtering, the first pill.
     A twin that is still saving (disabled) is skipped and retried on the
     next rebuild, which the finished write triggers. A pending hand-off is
     dropped as soon as focus has moved somewhere else on purpose. */
  function slug(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function focusPlan(el, ui) {
    var ae = document.activeElement;
    var inSlot = !!(ae && ae !== document.body && el.contains(ae));
    if (!inSlot) {
      var pending = ui.plFocus || null;
      ui.plFocus = null;
      return (pending && (!ae || ae === document.body)) ? pending : [];
    }
    ui.plFocus = null;
    ui.plFocusTries = 0;
    var ids = [];
    if (ae.id) ids.push(ae.id);
    var app = ae.getAttribute('data-app');
    if (app) ids.push('pl-sum-' + app);
    var pill = ae.getAttribute('data-pill');
    if (pill) ids.push('pl-pill-' + pill);
    if (ui.plFilter) ids.push('pl-pill-' + ui.plFilter);
    ids.push('pl-pill-' + PILLS[0].key);
    return ids;
  }
  function applyFocus(el, ui, ids) {
    var saving = false;
    for (var i = 0; i < ids.length; i++) {
      var f = document.getElementById(ids[i]);
      if (!f || !el.contains(f)) continue;
      if (f.disabled) { saving = true; continue; }
      try { f.focus({ preventScroll: true }); } catch (e) { try { f.focus(); } catch (e2) { /* not focusable */ } }
      if (document.activeElement === f) { ui.plFocusTries = 0; return; }
    }
    /* every match is a button still saving: try again on the next rebuild */
    if (saving && (ui.plFocusTries || 0) < 12) {
      ui.plFocus = ids;
      ui.plFocusTries = (ui.plFocusTries || 0) + 1;
    } else {
      ui.plFocusTries = 0;
    }
  }

  /* ---------------- render ------------------------------------------------ */
  function render(el, state, ui) {
    var h = CMC.h;
    var apps = state.applications;
    var now = Date.now();
    var focusIds = focusPlan(el, ui);

    var visible = apps.filter(function (a) { return ui.plShowClosed || !isOldClosed(a, now); });
    var filterLabel = null;
    if (ui.plFilter) {
      visible = visible.filter(function (a) { return effStatus(a) === ui.plFilter; });
      for (var i = 0; i < PILLS.length; i++) if (PILLS[i].key === ui.plFilter) filterLabel = PILLS[i].label;
    }
    visible = visible.slice().sort(function (a, b) {
      var ra = RANK[effStatus(a)] !== undefined ? RANK[effStatus(a)] : 9;
      var rb = RANK[effStatus(b)] !== undefined ? RANK[effStatus(b)] : 9;
      if (ra !== rb) return ra - rb;
      var d = (b.score || 0) - (a.score || 0);
      if (d) return d;
      return String(b.dateFound || '').localeCompare(String(a.dateFound || ''));
    });

    var closedCount = apps.filter(function (a) { return isOldClosed(a, now); }).length;

    var funnel = funnelBlock(apps);
    var body = [h('div', { class: 'pl-top' }, pillRow(apps, ui), funnel)];
    if (visible.length) {
      body.push(h('div', { class: 'pl-grid' }, visible.map(function (a) { return card(a, ui); })));
    } else {
      body.push(emptyState(ui, !!ui.plFilter, filterLabel || 'this stage'));
    }
    if (!ui.plFilter && closedCount > 0) body.push(closedFoot(ui, closedCount));

    el.textContent = '';
    el.appendChild(h('section', { class: 'panel pl-panel', 'aria-label': 'Pipeline' },
      h('div', { class: 'panel-head' },
        h('h2', { class: 'panel-title' }, 'Pipeline'),
        apps.length ? h('span', { class: 'chip mono' }, String(apps.length)) : null,
        h('span', { class: 'panel-kicker' }, 'tap a stage to filter')),
      h('div', { class: 'panel-body pl-body' }, body)));
    applyFocus(el, ui, focusIds);
  }

  CMC.register('pipeline', { render: render });
})();
