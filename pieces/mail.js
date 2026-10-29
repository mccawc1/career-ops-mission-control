/* piece: mail. The job-search emails Claude sorted out of Chris's Gmail, one
   card per email, by stage. Reads CMC.state.mail (written by Claude from
   Gmail: subject, sender name, date, a one-line summary, never a message body).
   Every subject links to that email in Gmail. "Handled" clears a flag.
   Writes only via CMC.act.*, UI state lives in CMC.ui. */
(function () {
  'use strict';
  var CMC = window.CMC;
  if (!CMC) return;

  var NS = 'http://www.w3.org/2000/svg';
  var PAGE = 15;

  /* pipeline order. gmail is the Gmail label that holds the same emails. */
  var STAGES = [
    { key: 'applied', label: 'Applied', kind: 'info', gmail: 'job search/2 Applied', hint: 'Confirmations and auto-replies after an application' },
    { key: 'reply', label: 'Reply', kind: 'good', gmail: 'job search/3 Reply from employer', hint: 'A real person from the employer wrote back' },
    { key: 'screening', label: 'Screening', kind: 'warn', gmail: 'job search/4 Screening', hint: 'Pre-screens, questionnaires and assessments' },
    { key: 'interview', label: 'Interview', kind: 'ivl', gmail: 'job search/5 Interview', hint: 'Interview invites, times and confirmations' },
    { key: 'offer', label: 'Offer', kind: 'good', gmail: 'job search/6 Offer', hint: 'Offers and offer paperwork' },
    { key: 'closed', label: 'Closed', kind: 'bad', gmail: 'job search/7 Closed', hint: 'Rejections and filled jobs' },
    { key: 'account', label: 'Accounts', kind: 'idle', gmail: 'job search/8 Accounts', hint: 'Job-site account and sign-up emails' },
    { key: 'alert', label: 'Alerts', kind: 'idle', gmail: 'job search/1 Alerts and matches', hint: 'Job alerts and matches from Indeed, LinkedIn and ZipRecruiter' },
  ];
  var STAGE = {};
  STAGES.forEach(function (s) { STAGE[s.key] = s; });
  var ACTION_LABEL = 'job search/0 Needs action';
  var PARENT_LABEL = 'job search';

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
  function outIcon() {
    return icon(12, [
      ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }],
      ['polyline', { points: '15 3 21 3 21 9' }],
      ['line', { x1: 10, y1: 14, x2: 21, y2: 3 }],
    ], '2');
  }
  function searchIcon() {
    return icon(14, [
      ['circle', { cx: 11, cy: 11, r: 7 }],
      ['line', { x1: 21, y1: 21, x2: 16.2, y2: 16.2 }],
    ], '2');
  }
  function mailIcon() {
    return icon(26, [
      ['rect', { x: 3, y: 5, width: 18, height: 14, rx: 2 }],
      ['polyline', { points: '3 7 12 13 21 7' }],
    ]);
  }

  /* ---------------- small helpers ---------------------------------------- */
  var DASHES = new RegExp('\\s*[' + String.fromCharCode(0x2014, 0x2013) + ']\\s*', 'g');
  function plain(s) { return String(s || '').replace(DASHES, ' - ').trim(); }
  function stageOf(r) { return STAGE[r.stage] ? r.stage : 'applied'; }
  function when(r) { var t = Date.parse(r.date || ''); return isNaN(t) ? 0 : t; }
  function taskFor(r, state) {
    var rows = state.tasks || [];
    for (var i = 0; i < rows.length; i++) if (rows[i].mailId === r.id) return rows[i];
    return null;
  }
  /* an email is waiting on Chris while its doc says so and its follow-up
     task (if it has one) is still open */
  function isAction(r, state) {
    if (r.needsAction !== true) return false;
    var t = taskFor(r, state);
    return !(t && t.state && t.state !== 'open');
  }
  /* the Gmail address part of a stored thread link, without the #thread part,
     so the page never hard-codes whose mailbox it is */
  function baseUrl(rows) {
    for (var i = 0; i < rows.length; i++) {
      var u = CMC.safeUrl(rows[i].url);
      if (u && u.indexOf('#') > 0) return u.slice(0, u.indexOf('#'));
    }
    return '';
  }
  function labelQuery(name) {
    return 'label:' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function gmailSearch(base, name) {
    return base ? base + '#search/' + encodeURIComponent(labelQuery(name)) : '';
  }
  function filterKey(ui) { return ui.mlFilter || 'active'; }
  function inFilter(r, key, state) {
    var st = stageOf(r);
    if (key === 'all') return true;
    if (key === 'active') return st !== 'alert';
    if (key === 'action') return isAction(r, state);
    return st === key;
  }
  function matchesQuery(r, q) {
    if (!q) return true;
    var hay = [r.subject, r.from, r.company, r.role, r.summary, r.source].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }
  function busyMap(ui) { if (!ui.mlBusy) ui.mlBusy = {}; return ui.mlBusy; }

  /* ---------------- actions ---------------------------------------------- */
  function onHandled(r, state, ui) {
    if (busyMap(ui)[r.id]) return;
    busyMap(ui)[r.id] = true;
    var now = new Date().toISOString();
    var p = CMC.act.updateDoc('mail', r.id, { needsAction: false, handledAt: now });
    var t = taskFor(r, state);
    if (t && (!t.state || t.state === 'open')) CMC.act.updateDoc('tasks', t.id, { state: 'done', doneAt: now });
    CMC.act.addActivity('Marked an email handled: ' + plain(r.subject), 'system');
    var fin = function () { delete busyMap(ui)[r.id]; CMC.rerender('mail'); };
    p.then(fin, fin);
  }
  function setFilter(key, ui) {
    ui.mlFilter = key;
    ui.mlLimit = PAGE;
    CMC.rerender('mail');
  }

  /* ---------------- pieces of the panel ----------------------------------- */
  function controls(rows, ui, state, q) {
    var h = CMC.h;
    var key = filterKey(ui);
    var pool = rows.filter(function (r) { return matchesQuery(r, q); });
    function n(k) { return pool.filter(function (r) { return inFilter(r, k, state); }).length; }
    var chips = [
      { key: 'active', label: 'Active', hint: 'Every email except job alerts' },
      { key: 'action', label: 'Needs action', hint: 'Emails waiting on you' },
    ].concat(STAGES.map(function (s) { return { key: s.key, label: s.label, hint: s.hint }; }))
      .concat([{ key: 'all', label: 'All', hint: 'Every email' }]);
    return h('div', { class: 'ml-controls' },
      h('div', { class: 'field ml-search' },
        h('label', { for: 'ml-search-input' }, 'Search the emails'),
        h('span', { class: 'ml-search-wrap' },
          searchIcon(),
          h('input', {
            id: 'ml-search-input',
            class: 'input',
            type: 'search',
            autocomplete: 'off',
            spellcheck: 'false',
            placeholder: 'Subject, sender, company or role',
            value: ui.mlQuery || '',
            oninput: function (ev) {
              ui.mlQuery = ev.target.value;
              ui.mlLimit = PAGE;
              var sel = ev.target.selectionStart;
              CMC.rerender('mail');
              var again = document.getElementById('ml-search-input');
              if (again) { again.focus(); try { again.setSelectionRange(sel, sel); } catch (e) { /* fine */ } }
            },
            onkeydown: function (ev) {
              if (ev.key === 'Escape' && ev.target.value) { ev.target.value = ''; ui.mlQuery = ''; CMC.rerender('mail'); }
            },
          }))),
      h('div', { class: 'chip-row ml-stages', role: 'group', 'aria-label': 'Filter emails by stage' },
        chips.map(function (c) {
          return h('button', {
            type: 'button',
            class: 'chip-btn',
            'data-filter': c.key,
            'aria-pressed': key === c.key ? 'true' : 'false',
            title: c.hint,
            onclick: function () { setFilter(c.key, ui); },
          }, c.label, h('span', { class: 'n' }, String(n(c.key))));
        })));
  }

  function rowEl(r, state, ui) {
    var h = CMC.h;
    var meta = STAGE[stageOf(r)];
    var url = CMC.safeUrl(r.url);
    var subject = plain(r.subject) || '(no subject)';
    var act = isAction(r, state);
    var who = [];
    var from = r.direction === 'out' ? 'You sent this' : plain(r.from);
    if (from) who.push(from);
    /* name the company only when the sender line does not already say it */
    var co = plain(r.company), role = plain(r.role), job = [];
    if (co && from.toLowerCase().indexOf(co.toLowerCase()) < 0) job.push(co);
    if (role) job.push(role);
    if (job.length) who.push(job.join(', '));
    if (r.pay) who.push(plain(r.pay));
    var busy = !!busyMap(ui)[r.id];
    return h('li', { class: 'ml-row' + (act ? ' is-action' : ''), 'data-id': r.id, 'data-stage': stageOf(r) },
      h('span', { class: 'ml-stage' },
        h('span', { class: 'chip chip-' + meta.kind, title: meta.hint }, h('span', { class: 'dot dot-' + meta.kind }), meta.label)),
      h('div', { class: 'ml-main' },
        url ? h('a', {
          class: 'ml-subject', href: url, target: '_blank', rel: 'noopener noreferrer',
          title: 'Open this email in Gmail in a new tab',
        }, subject, outIcon()) : h('span', { class: 'ml-subject' }, subject),
        who.length ? h('div', { class: 'ml-meta' }, who.join(' · ')) : null,
        r.summary ? h('p', { class: 'ml-sum' }, plain(r.summary)) : null,
        r.note ? h('p', { class: 'ml-note' }, plain(r.note)) : null,
        act ? h('div', { class: 'ml-actrow' },
          h('span', { class: 'chip chip-warn' }, h('span', { class: 'dot dot-warn' }), 'Needs action'),
          r.action ? h('span', { class: 'ml-acttext' }, plain(r.action)) : null,
          h('button', {
            type: 'button', class: 'btn btn-ghost ml-handled', disabled: busy ? true : null,
            title: 'Clear the flag when you have dealt with this email',
            onclick: function () { onHandled(r, state, ui); },
          }, busy ? 'Saving...' : 'Handled')) : null),
      h('span', { class: 'ml-date mono', title: r.date || '' }, r.date ? CMC.fmt.date(r.date) : ''));
  }

  function emptyAll() {
    var h = CMC.h;
    return h('div', { class: 'ml-empty' },
      mailIcon(),
      h('span', { class: 'ml-empty-t' }, 'No job emails sorted yet'),
      h('p', { class: 'ml-empty-s' }, 'When Claude sorts Chris\'s Gmail, every job email lands here with its stage and a link that opens it in Gmail.'));
  }
  function emptyFiltered(ui) {
    var h = CMC.h;
    return h('div', { class: 'ml-empty' },
      mailIcon(),
      h('span', { class: 'ml-empty-t' }, 'No emails here'),
      h('p', { class: 'ml-empty-s' }, 'Nothing matches this stage or search. Try another stage, or show everything.'),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: function () { ui.mlQuery = ''; setFilter('active', ui); } }, 'Show active emails'));
  }

  function footer(shownN, totalN, key, base, state) {
    var h = CMC.h;
    var name = key === 'action' ? ACTION_LABEL : (STAGE[key] ? STAGE[key].gmail : PARENT_LABEL);
    var link = gmailSearch(base, name);
    var sync = state.meta && state.meta.lastMailSync;
    return h('div', { class: 'ml-foot' },
      h('p', { class: 'ml-foot-line' },
        h('span', { class: 'mono' }, String(shownN)), ' of ', h('span', { class: 'mono' }, String(totalN)),
        ' shown. Claude sorted these from Chris\'s Gmail' + (sync ? ' on ' + CMC.fmt.date(sync) : '') + '. The same stages are labels in Gmail under "job search". Claude reads and labels; nothing is sent, moved or deleted.'),
      link ? h('a', { class: 'ml-gmail', href: link, target: '_blank', rel: 'noopener noreferrer', title: 'Search Gmail for this stage in a new tab' }, 'Open this stage in Gmail', outIcon()) : null);
  }

  /* ---------------- render ------------------------------------------------ */
  function render(el, state, ui) {
    var h = CMC.h;
    var rows = (state.mail || []).slice();
    var q = String(ui.mlQuery || '').trim().toLowerCase();
    var key = filterKey(ui);
    var visible = rows.filter(function (r) { return inFilter(r, key, state) && matchesQuery(r, q); })
      .sort(function (a, b) { return when(b) - when(a); });
    var limit = ui.mlLimit || PAGE;
    var shown = visible.slice(0, limit);
    var actionN = rows.filter(function (r) { return isAction(r, state); }).length;
    var base = baseUrl(rows);

    var body = [];
    if (!rows.length) {
      body.push(emptyAll());
    } else {
      body.push(controls(rows, ui, state, q));
      if (shown.length) {
        body.push(h('ul', { class: 'ml-list', 'aria-label': 'Job emails' }, shown.map(function (r) { return rowEl(r, state, ui); })));
      } else {
        body.push(emptyFiltered(ui));
      }
      if (visible.length > shown.length) {
        var more = Math.min(PAGE, visible.length - shown.length);
        body.push(h('button', {
          type: 'button', class: 'chip-btn ml-more', id: 'ml-more',
          onclick: function () { ui.mlLimit = limit + PAGE; CMC.rerender('mail'); },
        }, 'Show ' + more + ' more'));
      }
      body.push(footer(shown.length, visible.length, key, base, state));
    }

    el.textContent = '';
    el.appendChild(h('section', { class: 'panel ml-panel', 'aria-label': 'Job emails' },
      h('div', { class: 'panel-head' },
        h('h2', { class: 'panel-title' }, 'Job emails'),
        h('span', { class: 'chip mono' + (actionN ? ' chip-warn' : '') },
          actionN ? h('span', { class: 'dot dot-warn' }) : null,
          actionN ? actionN + ' need action' : 'nothing waiting'),
        h('span', { class: 'panel-kicker' }, 'sorted by stage from Chris\'s Gmail')),
      h('div', { class: 'panel-body ml-body' }, body)));
  }

  CMC.register('mail', { render: render });
})();
