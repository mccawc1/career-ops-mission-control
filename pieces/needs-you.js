/* piece: needs-you: two lanes. Waiting on Chris: the tasks checklist,
   grouped by kind, Done / Skip / Undo. Interview ops: a 14-day strip plus
   every interview event, with add, edit and delete.
   Reads CMC.state, writes only via CMC.act.*, UI state lives in CMC.ui. */
(function () {
  'use strict';
  var CMC = window.CMC;
  if (!CMC) return;

  var NS = 'http://www.w3.org/2000/svg';
  var KINDS = [
    { key: 'decide', label: 'Decide' },
    { key: 'answer', label: 'Answer' },
    { key: 'approve', label: 'Approve' },
    { key: 'followup', label: 'Follow up' },
    { key: 'study', label: 'Study' },
    { key: 'signup', label: 'Sign up' },
  ];
  /* The task kinds foundation counts as waiting on Chris drive only the
     per-task dot title here (every count comes from CMC.needsChris()).
     Foundation keeps its list private today, so this mirror is the
     fallback; when it publishes CMC.needsChrisKinds the dot titles follow
     that instead and cannot drift. Every other open task is listed but
     worded as an open task, never as waiting. */
  var NEEDS_FALLBACK = { decide: 1, approve: 1 };
  function waitsOnChris(kind) {
    var kinds = CMC.needsChrisKinds || NEEDS_FALLBACK;
    return kinds[kind] === 1 || kinds[kind] === true;
  }
  var ROUNDS = ['Phone Screen', 'Recruiter Screen', '1st Interview', '2nd Interview', '3rd Interview', 'Final Round', 'Offer Call', 'Other'];
  var FORMATS = ['Phone', 'Video', 'On-site', 'Take-home', 'Other'];
  var BOOKABLE = { Applied: 1, Responded: 1, Interview: 1, Offer: 1 };
  /* booking an interview moves an application forward to Interview, never
     backward: Offer and Hired already sit past that stage and keep it */
  var FLIPS_TO_INTERVIEW = { Applied: 1, Responded: 1 };
  var DAY_CODE = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  var DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var OTHER = '__other';

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
  function outIcon() {
    return icon(13, [
      ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }],
      ['polyline', { points: '15 3 21 3 21 9' }],
      ['line', { x1: 10, y1: 14, x2: 21, y2: 3 }],
    ], '2');
  }
  function checkIcon() {
    return icon(13, [['polyline', { points: '20 6 9 17 4 12' }]], '2.4');
  }
  function caretIcon() {
    return icon(14, [['path', { d: 'M6 9l6 6 6-6' }]], '2.2');
  }
  function plusIcon() {
    return icon(14, [
      ['line', { x1: 12, y1: 5, x2: 12, y2: 19 }],
      ['line', { x1: 5, y1: 12, x2: 19, y2: 12 }],
    ], '2.2');
  }
  function inboxZeroIcon() {
    return icon(26, [
      ['path', { d: 'M22 11.08V12a10 10 0 1 1-5.93-9.14' }],
      ['polyline', { points: '22 4 12 14.01 9 11.01' }],
    ]);
  }
  function calendarIcon() {
    return icon(26, [
      ['rect', { x: 3, y: 4, width: 18, height: 18, rx: 2, ry: 2 }],
      ['line', { x1: 16, y1: 2, x2: 16, y2: 6 }],
      ['line', { x1: 8, y1: 2, x2: 8, y2: 6 }],
      ['line', { x1: 3, y1: 10, x2: 21, y2: 10 }],
    ]);
  }

  /* ---------------- dates (local, never UTC-shifted) ----------------------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function parseYmd(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d.getTime()) ? null : d;
  }
  function today0() {
    var t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), t.getDate());
  }
  function addDays(d, n) {
    var x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  }
  function dayDiff(d) { return Math.round((d.getTime() - today0().getTime()) / 864e5); }
  function fmtDay(d) { return DAY_SHORT[d.getDay()] + ' ' + MONTHS[d.getMonth()] + ' ' + d.getDate(); }
  function fmtClock(hhmm) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
    if (!m) return '';
    var hr = +m[1];
    return (hr % 12 || 12) + ':' + m[2] + (hr < 12 ? 'a' : 'p');
  }
  function whenWord(diff) {
    if (diff === 0) return 'today';
    if (diff === 1) return 'tomorrow';
    if (diff === -1) return 'yesterday';
    if (diff < 0) return (-diff) + ' days ago';
    return 'in ' + diff + ' days';
  }
  function nowIso() { return new Date().toISOString(); }

  /* ---------------- ui helpers --------------------------------------------- */
  function prep(ui) {
    if (!ui.nyBusy) ui.nyBusy = {};
    if (!ui.nyMore) ui.nyMore = {};
    return ui;
  }
  function finishBusy(ui, key) {
    return function () {
      delete ui.nyBusy[key];
      CMC.rerender('needs-you');
    };
  }
  function rerender() { CMC.rerender('needs-you'); }
  function findApp(state, id) {
    var apps = state.applications || [];
    for (var i = 0; i < apps.length; i++) if (apps[i].id === id) return apps[i];
    return null;
  }

  /* ======================= LANE 1: Waiting on Chris ======================== */
  function setTaskState(task, ui, st) {
    if (ui.nyBusy[task.id]) return;
    ui.nyBusy[task.id] = true;
    var patch = { state: st, doneAt: st === 'open' ? null : nowIso() };
    var p = CMC.act.updateDoc('tasks', task.id, patch);
    if (st === 'done') CMC.act.addActivity('Done: ' + (task.title || 'a task'), 'system');
    var fin = finishBusy(ui, task.id);
    p.then(fin, fin);
  }

  function taskRow(t, ui) {
    var h = CMC.h;
    var busy = !!ui.nyBusy[t.id];
    var more = !!ui.nyMore[t.id];
    var url = CMC.safeUrl(t.url);
    var detailId = 'ny-td-' + t.id;
    return h('li', { class: 'ny-task' + (t.priority === 1 ? ' is-top' : '') },
      h('span', { class: 'dot dot-warn ny-tdot', title: waitsOnChris(t.kind) ? 'Waiting on you' : 'Open' }),
      h('div', { class: 'ny-tmain' },
        h('span', { class: 'ny-ttitle' }, t.title || ''),
        t.detail ? h('p', { class: 'ny-tdetail' + (more ? ' is-open' : ''), id: detailId }, t.detail) : null,
        t.detail ? h('button', {
          type: 'button', class: 'chip-btn ny-more', id: 'ny-more-' + t.id,
          'aria-expanded': more ? 'true' : 'false', 'aria-controls': detailId,
          hidden: !more,
          onclick: function () { ui.nyMore[t.id] = !more; rerender(); },
        }, more ? 'Less' : 'More', caretIcon()) : null),
      h('div', { class: 'ny-tacts' },
        url ? h('a', {
          class: 'btn btn-ghost ny-open', href: url, target: '_blank', rel: 'noopener noreferrer',
          title: 'Opens in a new tab',
        }, outIcon(), 'Open') : null,
        h('button', {
          type: 'button', class: 'btn btn-ghost ny-done', id: 'ny-done-' + t.id, dataset: { task: t.id }, disabled: busy,
          onclick: function () { setTaskState(t, ui, 'done'); },
        }, checkIcon(), busy ? 'Saving...' : 'Done'),
        h('button', {
          type: 'button', class: 'btn btn-ghost ny-skip', id: 'ny-skip-' + t.id, dataset: { task: t.id }, disabled: busy,
          onclick: function () { setTaskState(t, ui, 'skipped'); },
        }, 'Skip')));
  }

  function byPriority(a, b) {
    var pa = typeof a.priority === 'number' ? a.priority : 9;
    var pb = typeof b.priority === 'number' ? b.priority : 9;
    if (pa !== pb) return pa - pb;
    return String(a.title || '').localeCompare(String(b.title || ''));
  }

  function groupBlock(kind, rows, ui) {
    var h = CMC.h;
    var kids = [h('span', { class: 'ny-glabel' }, kind.label, h('span', { class: 'ny-gn mono' }, String(rows.length)))];
    if (kind.key === 'signup') {
      var shown = !!ui.nyShowSignup;
      var n = rows.length;
      kids.push(h('div', { class: 'ny-signup-row' },
        h('span', { class: 'dot dot-warn' }),
        h('span', { class: 'ny-signup-t' }, n === 1 ? '1 side-income platform to sign up for.' : n + ' side-income platforms to sign up for.'),
        h('button', {
          type: 'button', class: 'chip-btn ny-signup-btn', id: 'ny-signup-btn',
          'aria-expanded': shown ? 'true' : 'false', 'aria-controls': 'ny-signups',
          onclick: function () { ui.nyShowSignup = !shown; rerender(); },
        }, shown ? 'Hide them' : 'Show them', caretIcon())));
      if (shown) kids.push(h('ul', { class: 'ny-tlist', id: 'ny-signups' }, rows.map(function (t) { return taskRow(t, ui); })));
    } else {
      kids.push(h('ul', { class: 'ny-tlist' }, rows.map(function (t) { return taskRow(t, ui); })));
    }
    return h('section', { class: 'ny-group', 'aria-label': kind.label }, kids);
  }

  function finishedRow(t, ui) {
    var h = CMC.h, fmt = CMC.fmt;
    var busy = !!ui.nyBusy[t.id];
    var done = t.state === 'done';
    return h('li', { class: 'ny-frow' },
      h('span', { class: 'dot ' + (done ? 'dot-good' : 'dot-idle') }),
      h('span', { class: 'ny-ftitle' }, t.title || ''),
      h('span', { class: 'chip ' + (done ? 'chip-good' : 'chip-idle') }, done ? 'Done' : 'Skipped'),
      t.doneAt ? h('span', { class: 'ny-fago mono', title: 'When you finished it' }, fmt.ago(t.doneAt)) : null,
      h('button', {
        type: 'button', class: 'btn btn-ghost ny-undo', id: 'ny-undo-' + t.id, dataset: { task: t.id }, disabled: busy,
        onclick: function () { setTaskState(t, ui, 'open'); },
      }, busy ? 'Saving...' : 'Undo'));
  }

  function finishedBlock(finished, ui) {
    var h = CMC.h;
    var shown = !!ui.nyShowFinished;
    var rows = finished.slice().sort(function (a, b) {
      return String(b.doneAt || '').localeCompare(String(a.doneAt || ''));
    });
    return h('section', { class: 'ny-fin', 'aria-label': 'Finished tasks' },
      h('button', {
        type: 'button', class: 'chip-btn ny-fin-btn', id: 'ny-fin-btn',
        'aria-expanded': shown ? 'true' : 'false', 'aria-controls': 'ny-finlist',
        onclick: function () { ui.nyShowFinished = !shown; rerender(); },
      }, h('span', { class: 'ny-fin-caret' + (shown ? ' is-up' : '') }, caretIcon()), 'Finished', h('span', { class: 'n' }, String(rows.length))),
      shown ? h('ul', { class: 'ny-tlist ny-finlist', id: 'ny-finlist' }, rows.map(function (t) { return finishedRow(t, ui); })) : null);
  }

  /* One number waits on Chris: CMC.needsChris().total (queue items ready
     for his OK plus open decide/approve tasks). The head chip shows it and
     the KPI deck and tab title show the same figure. The kicker words the
     whole list as open tasks, which is a different, larger count. */
  function laneKicker(nc) {
    var parts = [];
    if (nc.ready > 0) parts.push(nc.ready === 1 ? '1 ready in the Apply queue' : nc.ready + ' ready in the Apply queue');
    else if (nc.total === 0 && nc.openTasks > 0) parts.push('nothing ready to approve');
    if (nc.openTasks === 0) parts.push(nc.total === 0 ? 'all clear' : 'no open tasks');
    else parts.push(nc.openTasks === 1 ? '1 open task' : nc.openTasks + ' open tasks');
    return parts.join(', ');
  }

  function tasksLane(state, ui) {
    var h = CMC.h;
    var tasks = state.tasks || [];
    var open = tasks.filter(function (t) { return t.state !== 'done' && t.state !== 'skipped'; });
    var finished = tasks.filter(function (t) { return t.state === 'done' || t.state === 'skipped'; });
    var nc = CMC.needsChris();

    var body = [];
    if (!open.length) {
      body.push(h('div', { class: 'ny-empty' },
        inboxZeroIcon(),
        h('span', { class: 'ny-empty-t' }, nc.ready ? 'No open tasks.' : 'Nothing is waiting on you.'),
        h('p', { class: 'ny-empty-s' }, nc.ready
          ? (nc.ready === 1 ? '1 application in the Apply queue is ready for your OK.' : nc.ready + ' applications in the Apply queue are ready for your OK.')
          : 'Claude will add items here when it needs a decision or an answer.')));
    } else {
      var placed = {};
      KINDS.forEach(function (k) {
        var rows = open.filter(function (t) { return t.kind === k.key; }).sort(byPriority);
        rows.forEach(function (t) { placed[t.id] = 1; });
        if (rows.length) body.push(groupBlock(k, rows, ui));
      });
      var rest = open.filter(function (t) { return !placed[t.id]; }).sort(byPriority);
      if (rest.length) body.push(groupBlock({ key: 'other', label: 'Other' }, rest, ui));
    }
    if (finished.length) body.push(finishedBlock(finished, ui));

    return h('section', { class: 'panel ny-lane ny-tasks', 'aria-label': 'Waiting on Chris' },
      h('div', { class: 'panel-head' },
        h('h2', { class: 'panel-title' }, 'Waiting on Chris'),
        nc.total ? h('span', { class: 'chip chip-warn mono ny-count', title: 'waiting on you' }, String(nc.total)) : null,
        h('span', { class: 'panel-kicker' }, laneKicker(nc))),
      h('div', { class: 'panel-body' }, body));
  }

  /* ======================= LANE 2: Interview ops =========================== */
  function selectEl(id, label, values, cur, onchange, extraClass) {
    var h = CMC.h;
    return h('div', { class: 'field' },
      h('label', { for: id }, label),
      h('span', { class: 'select-wrap' + (extraClass ? ' ' + extraClass : '') },
        h('select', { id: id, onchange: onchange }, values.map(function (v) {
          return h('option', { value: v, selected: v === cur }, v);
        }))));
  }
  function inputEl(id, label, type, value, oninput, placeholder) {
    var h = CMC.h;
    return h('div', { class: 'field' },
      h('label', { for: id }, label),
      h('input', { id: id, class: 'input', type: type, value: value || '', placeholder: placeholder || null, oninput: oninput }));
  }
  function escClose(fn) {
    return function (ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); fn(); }
    };
  }

  /* ----- add form ----- */
  function openAdd(ui) {
    ui.nyAddOpen = true;
    ui.nyAdd = { appId: '', other: '', role: '', round: '1st Interview', format: 'Video', date: '', time: '', notes: '', err: '' };
    ui.nyFocus = 'ny-add-co';
    rerender();
  }
  function closeAdd(ui) {
    ui.nyAddOpen = false;
    ui.nyAdd = null;
    ui.nyFocus = 'ny-add-btn';
    rerender();
  }
  function saveAdd(state, ui) {
    var v = ui.nyAdd;
    if (!v) return;
    var app = v.appId && v.appId !== OTHER ? findApp(state, v.appId) : null;
    var company = app ? (app.company || '') : String(v.other || '').trim();
    if (!v.appId) { v.err = 'Pick a company first.'; ui.nyFocus = 'ny-add-co'; rerender(); return; }
    if (!company) { v.err = 'Type the company name.'; ui.nyFocus = 'ny-add-other'; rerender(); return; }
    var round = ROUNDS.indexOf(v.round) >= 0 ? v.round : '1st Interview';
    var format = FORMATS.indexOf(v.format) >= 0 ? v.format : 'Video';
    var date = parseYmd(v.date) ? v.date : null;
    var time = /^\d{2}:\d{2}/.test(String(v.time || '')) ? String(v.time).slice(0, 5) : null;
    var ts = nowIso();
    var doc = {
      appId: app ? app.id : null,
      company: company,
      role: String(v.role || '').trim(),
      round: round,
      format: format,
      date: date,
      time: time,
      notes: String(v.notes || '').trim(),
      createdAt: ts,
      updatedAt: ts,
    };
    CMC.act.setDoc('interviews', CMC.newId('iv'), doc);
    var note = '';
    if (app) {
      if (FLIPS_TO_INTERVIEW[app.status] === 1) {
        /* the shared retire pattern every status move on the page uses:
           retireQueue pulls any live prep request (its note is the phrase
           the log line ends with), then the status write goes out with
           keepQueue so the queue doc is touched once. Nothing here waits on
           the writes; dbWrite reports a failure in the save notice itself. */
        var r = CMC.act.retireQueue(app.id, 'Interview');
        CMC.act.setAppStatus(app.id, 'Interview', { keepQueue: true });
        note = r.note;
      }
      CMC.act.updateDoc('applications', app.id, { round: round });
    }
    var dayText = date ? fmtDay(parseYmd(date)) + (time ? ' ' + fmtClock(time) : '') : 'date to be set';
    CMC.act.addActivity('Interview booked with ' + company + ': ' + round + ', ' + dayText + '.' + note, 'interview');
    ui.nyAddOpen = false;
    ui.nyAdd = null;
    ui.nyFocus = 'ny-add-btn';
    rerender();
  }

  function addForm(state, ui) {
    var h = CMC.h;
    var v = ui.nyAdd;
    var apps = (state.applications || []).filter(function (a) { return BOOKABLE[a.status] === 1; })
      .sort(function (a, b) { return String(a.company || '').localeCompare(String(b.company || '')); });
    var isOther = v.appId === OTHER;

    var coSelect = h('select', {
      id: 'ny-add-co',
      onchange: function (ev) {
        v.appId = ev.target.value;
        v.err = '';
        var app = v.appId && v.appId !== OTHER ? findApp(state, v.appId) : null;
        if (app) v.role = app.role || '';
        ui.nyFocus = v.appId === OTHER ? 'ny-add-other' : 'ny-add-role';
        rerender();
      },
    },
      h('option', { value: '', selected: !v.appId }, 'Pick a company'),
      apps.map(function (a) {
        return h('option', { value: a.id, selected: v.appId === a.id }, (a.company || '') + ', ' + (a.role || ''));
      }),
      h('option', { value: OTHER, selected: isOther }, 'Other company'));

    return h('form', {
      class: 'ny-form', id: 'ny-addform', 'aria-label': 'Add an interview',
      onsubmit: function (ev) { ev.preventDefault(); saveAdd(state, ui); },
      onkeydown: escClose(function () { closeAdd(ui); }),
    },
      h('span', { class: 'ny-form-k' }, 'New interview'),
      h('div', { class: 'form-row' },
        h('div', { class: 'field' },
          h('label', { for: 'ny-add-co' }, 'Company'),
          h('span', { class: 'select-wrap' }, coSelect),
          apps.length ? null : h('p', { class: 'field-hint' }, 'No application is far enough along yet. Pick Other company to add one by hand.')),
        isOther ? inputEl('ny-add-other', 'Company name', 'text', v.other, function (ev) { v.other = ev.target.value; }, 'Who are you meeting?') : null,
        inputEl('ny-add-role', 'Role', 'text', v.role, function (ev) { v.role = ev.target.value; }, 'Job title')),
      h('div', { class: 'form-row' },
        selectEl('ny-add-round', 'Round', ROUNDS, v.round, function (ev) { v.round = ev.target.value; }),
        selectEl('ny-add-format', 'Format', FORMATS, v.format, function (ev) { v.format = ev.target.value; }),
        inputEl('ny-add-date', 'Date', 'date', v.date, function (ev) { v.date = ev.target.value; }),
        inputEl('ny-add-time', 'Time', 'time', v.time, function (ev) { v.time = ev.target.value; })),
      inputEl('ny-add-notes', 'Notes', 'text', v.notes, function (ev) { v.notes = ev.target.value; }, 'Who you meet, the link, what to prep'),
      v.err ? h('p', { class: 'ny-err', role: 'alert' }, v.err) : null,
      h('div', { class: 'form-actions' },
        h('button', { type: 'submit', class: 'btn btn-primary ny-add-save', id: 'ny-add-save' }, 'Save interview'),
        h('button', { type: 'button', class: 'btn btn-ghost ny-add-cancel', id: 'ny-add-cancel', onclick: function () { closeAdd(ui); } }, 'Cancel'),
        h('span', { class: 'ny-form-hint' }, 'Esc cancels')));
  }

  /* ----- edit form ----- */
  function openEdit(iv, ui) {
    ui.nyEdit = iv.id;
    ui.nyConfirmDel = null;
    ui.nyEditVals = {
      round: iv.round || 'Other',
      format: iv.format || 'Other',
      date: iv.date || '',
      time: iv.time || '',
      notes: iv.notes || '',
    };
    ui.nyFocus = 'ny-ed-round-' + iv.id;
    rerender();
  }
  function closeEdit(ui, id) {
    ui.nyEdit = null;
    ui.nyEditVals = null;
    ui.nyConfirmDel = null;
    ui.nyFocus = 'ny-edit-' + id;
    rerender();
  }
  function saveEdit(iv, state, ui) {
    var v = ui.nyEditVals;
    if (!v) return;
    var round = ROUNDS.indexOf(v.round) >= 0 ? v.round : 'Other';
    var patch = {
      round: round,
      format: FORMATS.indexOf(v.format) >= 0 ? v.format : 'Other',
      date: parseYmd(v.date) ? v.date : null,
      time: /^\d{2}:\d{2}/.test(String(v.time || '')) ? String(v.time).slice(0, 5) : null,
      notes: String(v.notes || '').trim(),
      updatedAt: nowIso(),
    };
    CMC.act.updateDoc('interviews', iv.id, patch);
    /* keep the tracker's round in step with the latest booked round */
    var app = iv.appId ? findApp(state, iv.appId) : null;
    if (app && app.round !== round) CMC.act.updateDoc('applications', app.id, { round: round });
    ui.nyEdit = null;
    ui.nyEditVals = null;
    ui.nyConfirmDel = null;
    ui.nyFocus = 'ny-edit-' + iv.id;
    rerender();
  }
  function deleteIv(iv, ui) {
    CMC.act.deleteDoc('interviews', iv.id);
    CMC.act.addActivity('Removed the ' + (iv.company || '') + ' interview (' + (iv.round || 'Other') + ').', 'system');
    ui.nyEdit = null;
    ui.nyEditVals = null;
    ui.nyConfirmDel = null;
    rerender();
  }

  function editForm(iv, state, ui) {
    var h = CMC.h;
    var v = ui.nyEditVals;
    var confirming = ui.nyConfirmDel === iv.id;
    var sfx = '-' + iv.id;
    return h('form', {
      class: 'ny-form ny-editform', id: 'ny-ef' + sfx, 'aria-label': 'Edit the ' + (iv.company || '') + ' interview',
      onsubmit: function (ev) { ev.preventDefault(); saveEdit(iv, state, ui); },
      onkeydown: escClose(function () { closeEdit(ui, iv.id); }),
    },
      h('div', { class: 'form-row' },
        selectEl('ny-ed-round' + sfx, 'Round', ROUNDS, v.round, function (ev) { v.round = ev.target.value; }),
        selectEl('ny-ed-format' + sfx, 'Format', FORMATS, v.format, function (ev) { v.format = ev.target.value; }),
        inputEl('ny-ed-date' + sfx, 'Date', 'date', v.date, function (ev) { v.date = ev.target.value; }),
        inputEl('ny-ed-time' + sfx, 'Time', 'time', v.time, function (ev) { v.time = ev.target.value; })),
      inputEl('ny-ed-notes' + sfx, 'Notes', 'text', v.notes, function (ev) { v.notes = ev.target.value; }, 'Who you meet, the link, what to prep'),
      h('div', { class: 'form-actions' },
        h('button', { type: 'submit', class: 'btn btn-primary ny-ed-save', id: 'ny-ed-save' + sfx }, 'Save'),
        h('button', {
          type: 'button', class: 'btn btn-ghost ny-ed-cancel', id: 'ny-ed-cancel' + sfx,
          'aria-expanded': 'true', 'aria-controls': 'ny-ef' + sfx,
          onclick: function () { closeEdit(ui, iv.id); },
        }, 'Cancel'),
        h('span', { class: 'spacer' }),
        confirming ? h('span', { class: 'ny-confirm', role: 'alert' },
          h('span', null, 'Delete this interview?'),
          h('button', { type: 'button', class: 'btn btn-danger ny-del-yes', id: 'ny-del-yes' + sfx, onclick: function () { deleteIv(iv, ui); } }, 'Yes, delete it'),
          h('button', { type: 'button', class: 'btn btn-ghost ny-del-no', id: 'ny-del-no' + sfx, onclick: function () { ui.nyConfirmDel = null; ui.nyFocus = 'ny-ed-del' + sfx; rerender(); } }, 'Keep it'))
          : h('button', {
            type: 'button', class: 'btn btn-ghost ny-ed-del', id: 'ny-ed-del' + sfx,
            onclick: function () { ui.nyConfirmDel = iv.id; ui.nyFocus = 'ny-del-no' + sfx; rerender(); },
          }, 'Delete')));
  }

  /* ----- event cards ----- */
  function ivCard(iv, state, ui) {
    var h = CMC.h;
    var editing = ui.nyEdit === iv.id;
    var d = parseYmd(iv.date);
    var diff = d ? dayDiff(d) : null;
    var past = diff !== null && diff < 0;
    var app = iv.appId ? findApp(state, iv.appId) : null;
    var whenText = d ? fmtDay(d) + (iv.time ? ' ' + fmtClock(iv.time) : '') : 'Date to be set';

    return h('article', { class: 'ny-iv' + (past ? ' is-past' : '') + (editing ? ' is-editing' : ''), 'data-k': past ? 'idle' : 'ivl' },
      h('div', { class: 'ny-ivhead' },
        h('span', { class: 'ny-ivco' }, iv.company || ''),
        iv.role ? h('span', { class: 'ny-ivrole' }, iv.role) : null),
      h('div', { class: 'ny-ivwhen' },
        h('span', { class: 'dot ' + (past ? 'dot-idle' : (d ? 'dot-ivl' : 'dot-hollow')) }),
        h('span', { class: 'mono ny-ivdate' + (d ? '' : ' is-tbd') }, whenText),
        diff !== null ? h('span', { class: 'ny-ivrel' }, whenWord(diff)) : null),
      h('div', { class: 'ny-ivchips' },
        h('span', { class: 'chip chip-ivl' }, iv.round || 'Other'),
        iv.format ? h('span', { class: 'chip' }, iv.format) : null,
        past ? h('span', { class: 'chip chip-idle' }, 'Already happened') : null),
      iv.notes && !editing ? h('p', { class: 'ny-ivnotes' }, iv.notes) : null,
      editing ? editForm(iv, state, ui) : h('div', { class: 'ny-ivacts' },
        h('button', {
          type: 'button', class: 'btn btn-ghost ny-edit', id: 'ny-edit-' + iv.id,
          'aria-expanded': 'false', 'aria-controls': 'ny-ef-' + iv.id,
          onclick: function () { openEdit(iv, ui); },
        }, 'Edit'),
        app ? h('button', {
          type: 'button', class: 'btn btn-ghost ny-details', id: 'ny-details-' + iv.id,
          onclick: function () { CMC.openDrawer(app.id); },
        }, 'Details') : null));
  }

  function strip(byDay) {
    var h = CMC.h;
    var t0 = today0();
    var cells = [];
    for (var i = 0; i < 14; i++) {
      var d = addDays(t0, i);
      var key = ymd(d);
      var evs = byDay[key] || [];
      var title = fmtDay(d) + (evs.length ? ': ' + evs.map(function (e) {
        return (e.company || 'Interview') + (e.time ? ' ' + fmtClock(e.time) : '');
      }).join(', ') : (i === 0 ? ', today, nothing booked' : ', nothing booked'));
      cells.push(h('div', {
        class: 'ny-cell' + (i === 0 ? ' is-today' : '') + (evs.length ? ' has-ev' : ''),
        role: 'listitem', title: title, 'aria-label': title,
        'data-day': key,
      },
        h('span', { class: 'ny-cell-w' }, DAY_CODE[d.getDay()]),
        h('span', { class: 'ny-cell-d mono' }, String(d.getDate())),
        evs.length ? h('span', { class: 'dot dot-ivl' }) : h('span', { class: 'ny-cell-no' })));
    }
    return h('div', { class: 'ny-stripwrap' },
      h('div', { class: 'ny-strip-k' },
        h('span', null, 'Next 14 days'),
        h('span', { class: 'ny-strip-leg' }, h('span', { class: 'dot dot-ivl' }), 'interview')),
      h('div', { class: 'ny-strip', role: 'list', 'aria-label': 'The next 14 days' }, cells));
  }

  function ivLane(state, ui) {
    var h = CMC.h;
    var all = (state.interviews || []).slice();
    var dated = all.filter(function (iv) { return !!parseYmd(iv.date); })
      .sort(function (a, b) {
        var c = String(a.date).localeCompare(String(b.date));
        if (c) return c;
        return String(a.time || '').localeCompare(String(b.time || ''));
      });
    var undated = all.filter(function (iv) { return !parseYmd(iv.date); })
      .sort(function (a, b) { return String(a.company || '').localeCompare(String(b.company || '')); });
    var byDay = {};
    dated.forEach(function (iv) { (byDay[iv.date] = byDay[iv.date] || []).push(iv); });
    var t0 = today0();
    var todayKey = ymd(t0);
    var next14 = 0;
    for (var i = 0; i < 14; i++) next14 += (byDay[ymd(addDays(t0, i))] || []).length;

    /* what is next comes first: today onward soonest first, then the ones
       with no date yet, then what already happened (newest first) */
    var upcoming = dated.filter(function (iv) { return String(iv.date) >= todayKey; });
    var past = dated.filter(function (iv) { return String(iv.date) < todayKey; }).reverse();
    var body = [strip(byDay)];
    var list = upcoming.concat(undated, past);
    if (list.length) {
      body.push(h('div', { class: 'ny-ivlist' }, list.map(function (iv) { return ivCard(iv, state, ui); })));
    } else {
      body.push(h('div', { class: 'ny-empty' },
        calendarIcon(),
        h('span', { class: 'ny-empty-t' }, 'No interviews booked yet.'),
        h('p', { class: 'ny-empty-s' }, 'They show up here the moment one is set, and on the calendar.')));
    }
    if (ui.nyAddOpen && ui.nyAdd) {
      body.push(addForm(state, ui));
    } else {
      body.push(h('div', { class: 'ny-addrow' },
        h('button', {
          type: 'button', class: 'btn btn-primary ny-add-btn', id: 'ny-add-btn',
          'aria-expanded': 'false', 'aria-controls': 'ny-addform',
          onclick: function () { openAdd(ui); },
        }, plusIcon(), 'Add interview')));
    }

    var kicker = next14 === 0 ? 'none in the next 14 days' : (next14 === 1 ? '1 in the next 14 days' : next14 + ' in the next 14 days');
    return h('section', { class: 'panel ny-lane ny-ivops', 'aria-label': 'Interview ops' },
      h('div', { class: 'panel-head' },
        h('h2', { class: 'panel-title' }, 'Interview ops'),
        list.length ? h('span', { class: 'chip chip-ivl mono', title: list.length + ' booked' }, String(list.length)) : null,
        h('span', { class: 'panel-kicker' }, kicker)),
      h('div', { class: 'panel-body' }, body));
  }

  /* ---------------- render -------------------------------------------------- */
  /* the More toggle only appears on a detail that really is clamped; when
     the panel is hidden (no layout) fall back to a length guess */
  function measureClamps(el) {
    var ps = el.querySelectorAll('.ny-tdetail:not(.is-open)');
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      var btn = p.nextElementSibling;
      if (!btn || !btn.classList.contains('ny-more')) continue;
      var clamped = p.clientHeight ? (p.scrollHeight > p.clientHeight + 1) : (String(p.textContent || '').length > 120);
      if (clamped) btn.hidden = false;
    }
  }

  /* Focus survives every rebuild (an action, a live snapshot, a timer).
     An explicit hand-off in ui.nyFocus wins (one id or a list to try in
     order). Otherwise whatever Chris had focused inside this panel comes
     back on the new DOM, caret included. Done, Skip and Undo move a task to
     the other list, so when that button is gone the next button of the same
     kind takes the focus, then the previous one, then the Finished toggle. */
  var MOVERS = ['ny-done', 'ny-skip', 'ny-undo'];
  function focusPlan(el, ui) {
    var plan = { ids: [], sel: null };
    if (ui.nyFocus) {
      plan.ids = [].concat(ui.nyFocus);
      ui.nyFocus = null;
      return plan;
    }
    var ae = document.activeElement;
    if (!ae || !ae.id || !el.contains(ae)) return plan;
    plan.ids.push(ae.id);
    try { if (typeof ae.selectionStart === 'number') plan.sel = [ae.selectionStart, ae.selectionEnd]; } catch (e) { plan.sel = null; }
    for (var m = 0; m < MOVERS.length; m++) {
      if (!ae.classList.contains(MOVERS[m])) continue;
      var same = el.querySelectorAll('button.' + MOVERS[m]);
      var i = Array.prototype.indexOf.call(same, ae);
      if (i >= 0 && same[i + 1]) plan.ids.push(same[i + 1].id);
      if (i > 0) plan.ids.push(same[i - 1].id);
      plan.ids.push('ny-fin-btn');
      /* an undone task is back in the open list under its Done button */
      if (MOVERS[m] === 'ny-undo' && ae.dataset.task) plan.ids.push('ny-done-' + ae.dataset.task);
    }
    return plan;
  }
  function applyFocus(el, ui, plan) {
    var saving = false;
    for (var i = 0; i < plan.ids.length; i++) {
      var f = document.getElementById(plan.ids[i]);
      if (!f || !el.contains(f)) continue;
      if (f.disabled) { saving = true; continue; }
      try { f.focus({ preventScroll: true }); } catch (e) { try { f.focus(); } catch (e2) { /* not focusable */ } }
      if (document.activeElement !== f) continue;
      if (plan.sel) { try { f.setSelectionRange(plan.sel[0], plan.sel[1]); } catch (e3) { /* not a text box */ } }
      ui.nyFocusTries = 0;
      return;
    }
    /* the only match is a button still saving: try again on the next
       rebuild, which the finished write triggers */
    if (saving && (ui.nyFocusTries || 0) < 4) {
      ui.nyFocus = plan.ids;
      ui.nyFocusTries = (ui.nyFocusTries || 0) + 1;
    } else {
      ui.nyFocusTries = 0;
    }
  }

  function render(el, state, ui) {
    var h = CMC.h;
    prep(ui);
    var plan = focusPlan(el, ui);
    el.textContent = '';
    el.appendChild(h('div', { class: 'ny-wrap' },
      tasksLane(state, ui),
      ivLane(state, ui)));
    measureClamps(el);
    /* the add and edit forms are inline, not sheets, so this piece never
       sets CMC.ui.sheetOpen; it only asks foundation whether something
       else is on top, and then leaves focus where that thing put it */
    if (plan.ids.length && !CMC.modalOpen()) applyFocus(el, ui, plan);
  }

  CMC.register('needs-you', { render: render });
})();
