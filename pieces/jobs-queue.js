/* piece: jobs-queue, the Action center. Two lanes: New matches (Evaluated
   apps, score desc, Apply / Pass / Details) and Apply queue (5-step timeline,
   Approve on ready, "Chris submitted it" on ready and approved, View
   documents once a prep exists). Reads CMC.state, writes only via
   CMC.act.*, UI state lives in CMC.ui. */
(function () {
  'use strict';

  var STATES = ['requested', 'prepping', 'ready', 'approved', 'submitted'];
  var QUEUE_SORT = { ready: 0, prepping: 1, requested: 2, approved: 3, submitted: 4 };
  var NS = 'http://www.w3.org/2000/svg';

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
  function shieldIcon() {
    return icon(14, [['path', { d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' }]], '2');
  }
  function searchIcon() {
    return icon(26, [
      ['circle', { cx: 11, cy: 11, r: 7 }],
      ['line', { x1: 21, y1: 21, x2: 16.2, y2: 16.2 }],
    ]);
  }
  function sendIcon() {
    return icon(26, [
      ['line', { x1: 22, y1: 2, x2: 11, y2: 13 }],
      ['path', { d: 'M22 2l-7 20-4-9-9-4 20-7z' }],
    ]);
  }
  function outIcon() {
    return icon(12, [
      ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }],
      ['polyline', { points: '15 3 21 3 21 9' }],
      ['line', { x1: 10, y1: 14, x2: 21, y2: 3 }],
    ], '2');
  }
  /* the check mark Chris asked for on every prepped card (Oct 16) */
  function checkIcon() {
    return icon(13, [['polyline', { points: '20 6 9 17 4 12' }]], '2.6');
  }
  /* a clock: the package is done but the apply path is closed (q.blocked) */
  function holdIcon() {
    return icon(13, [['circle', { cx: 12, cy: 12, r: 9 }], ['polyline', { points: '12 7 12 12 15.5 14' }]], '2.2');
  }
  function holdText(q) {
    var b = q && q.blocked;
    return b ? ('Prepped, waiting on ' + (b.waitingOn || 'a reply')) : '';
  }

  function bandOf(score) {
    if (typeof score !== 'number' || isNaN(score)) return null;
    if (score >= 4.5) return { cls: 'band-strong', word: 'strong' };
    if (score >= 4.0) return { cls: 'band-good', word: 'good' };
    if (score >= 3.5) return { cls: 'band-edge', word: 'close' };
    return { cls: '', word: 'weak' };
  }

  function busyMap(ui) {
    if (!ui.jqBusy) ui.jqBusy = {};
    return ui.jqBusy;
  }
  function finishBusy(ui, key) {
    return function () {
      delete busyMap(ui)[key];
      CMC.rerender('jobs-queue');
    };
  }

  function onApply(app, ui, stale) {
    if (busyMap(ui)[app.id]) return;
    busyMap(ui)[app.id] = true;
    /* a finished (submitted) queue doc from an earlier run makes way for
       the fresh request, the same way the drawer's Apply does, so the
       queue shows one honest card for this job */
    if (stale) CMC.act.deleteDoc('queue', stale.id);
    /* the card updates optimistically inside applyTo; the mission-log line
       waits for the queue write to land so a failed save never logs
       "Claude is prepping" for a request that never saved */
    var p = CMC.act.applyTo(app.id).then(function (ok) {
      if (ok) CMC.act.addActivity('You tapped Apply on ' + (app.company || 'a match') + ', ' + (app.role || 'new role') + '. Claude is prepping the application.', 'queue');
    });
    var fin = finishBusy(ui, app.id);
    p.then(fin, fin);
  }
  /* Pass: the shared retire pattern. retireQueue pulls any live prep
     request first (and hands back the words for the log line), then the
     status write goes out with keepQueue so the queue doc is touched once. */
  function onPass(app, ui) {
    if (busyMap(ui)[app.id]) return;
    busyMap(ui)[app.id] = true;
    var r = CMC.act.retireQueue(app.id, 'Discarded');
    var writes = [CMC.act.setAppStatus(app.id, 'Discarded', { keepQueue: true })];
    if (r.write) writes.push(r.write);
    CMC.act.addActivity('You passed on ' + (app.company || 'a match') + ', ' + (app.role || 'new role') + '.' + r.note, 'system');
    var fin = finishBusy(ui, app.id);
    Promise.all(writes).then(fin, fin);
  }
  function onApprove(q, ui) {
    if (busyMap(ui)[q.id]) return;
    busyMap(ui)[q.id] = 'approve';
    var p = CMC.act.setQueueState(q.id, 'approved');
    CMC.act.addActivity('You approved the ' + (q.company || 'queued') + ' application. Next: finish it in Chrome with the helper, then tap Chris submitted it. Nothing is sent from the dashboard.', 'queue');
    var fin = finishBusy(ui, q.id);
    p.then(fin, fin);
  }
  /* Chris sent it himself (on the board's site, by email, whatever): the
     queue item is done, the application counts as Applied, and the log
     says who did it. Same retire pattern as Pass: retireQueue marks the
     queue doc submitted (one write), then the Applied status goes out
     with keepQueue so nothing touches the queue doc twice. A queue doc
     with no live app behind it is still marked submitted directly. */
  function onSubmitted(q, ui) {
    if (busyMap(ui)[q.id]) return;
    busyMap(ui)[q.id] = 'submit';
    var r = q.appId ? CMC.act.retireQueue(q.appId, 'Applied') : { write: null, note: '' };
    var writes = [r.write || CMC.act.setQueueState(q.id, 'submitted')];
    if (q.appId) writes.push(CMC.act.setAppStatus(q.appId, 'Applied', { keepQueue: true }));
    writes.push(CMC.act.addActivity('Chris submitted the ' + (q.company || 'queued') + ' application himself.' + r.note, 'applied'));
    var fin = finishBusy(ui, q.id);
    Promise.all(writes).then(fin, fin);
  }
  function onToggleDraft(q, ui) {
    ui.jqDraftOpen = (ui.jqDraftOpen === q.id) ? null : q.id;
    CMC.rerender('jobs-queue');
  }
  function onToggleDocs(q, ui) {
    ui.jqDocsOpen = (ui.jqDocsOpen === q.id) ? null : q.id;
    CMC.rerender('jobs-queue');
  }
  /* Escape closes an open reveal (draft or documents) and hands focus back
     to the button that opened it */
  function closeReveals(ui) {
    var open = ui.jqDocsOpen ? ['docs', ui.jqDocsOpen] : (ui.jqDraftOpen ? ['draft', ui.jqDraftOpen] : null);
    if (!open) return false;
    ui.jqDocsOpen = null;
    ui.jqDraftOpen = null;
    CMC.rerender('jobs-queue');
    var slot = document.querySelector('.panel-slot[data-panel="jobs-queue"]');
    var btn = slot ? slot.querySelector('[data-jq-toggle="' + open[0] + ':' + open[1] + '"]') : null;
    if (btn) { try { btn.focus({ preventScroll: true }); } catch (e) { btn.focus(); } }
    return true;
  }

  /* the files Claude writes for every prepped application. A prep saves
     real links on the queue doc as docs: [{ label, url }], and each one
     renders as a tap-to-open link (only a real http(s) address becomes a
     link; db docs are data, the same CMC.safeUrl rule as everywhere else).
     A prep without links yet falls back to the two expected file names. */
  /* the Apply-together helper, saved on the queue doc as `helper` by
     chris-tools/apply-helper.mjs --queue (Chris's rule, Oct 16: everything
     from the dashboard). Steps, the files, and the prompt to paste into the
     Claude in Chrome panel. Nothing here sends anything. */
  function copyMap(ui) { if (!ui.jqCopied) ui.jqCopied = {}; return ui.jqCopied; }
  function onCopyPrompt(q, ui, boxId, panel) {
    var text = String((q.helper && q.helper.prompt) || '');
    var done = function (ok) { copyMap(ui)[q.id] = ok ? 'ok' : 'fail'; CMC.rerender(panel || 'jobs-queue'); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
        return;
      }
    } catch (e) { /* fall through to the text box */ }
    try {
      var box = document.getElementById(boxId);
      if (box) { box.focus(); box.select(); if (document.execCommand('copy')) { done(true); return; } }
    } catch (e2) { /* fall through */ }
    done(false);
  }
  /* Open the form (Chris, Oct 16): one tap opens the employer's page in a
     new tab and puts the Claude prompt on the clipboard, so in Chrome it is
     click the Claude icon, paste, Enter. The anchor does the opening; this
     only copies and says what to do next. */
  function onOpenForm(q) {
    var text = String((q.helper && q.helper.prompt) || '');
    var ok = function () { CMC.toast('Prompt copied. On the page that just opened, click the Claude icon in the toolbar, paste, and press Enter.'); };
    var fail = function () { CMC.toast('The page is opening. Copy the prompt with the Copy button under Apply in Chrome on this card.'); };
    try {
      if (text && navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(ok, fail); return; }
    } catch (e) { /* fall through */ }
    fail();
  }
  function helperBlock(q, id, ui, panel) {
    var h = CMC.h;
    var hp = q.helper || {};
    var strs = function (a) { return (Array.isArray(a) ? a : []).filter(function (x) { return typeof x === 'string' && x.trim(); }); };
    var list = function (items, cls) {
      var arr = strs(items);
      return arr.length ? h('ol', { class: cls || 'jq-hlist' }, arr.map(function (t) { return h('li', null, t); })) : null;
    };
    var page = CMC.safeUrl(hp.page);
    var files = (Array.isArray(hp.files) ? hp.files : []).filter(function (f) { return f && typeof f.file === 'string' && f.file; });
    var copyId = 'jq-copy-' + q.id;
    var boxId = 'jq-prompt-' + q.id;
    var copied = copyMap(ui)[q.id] || '';
    return h('div', { class: 'jq-draft jq-helper', id: id },
      h('span', { class: 'jq-draft-k' }, 'Apply together with Claude in Chrome'),
      h('p', { class: 'jq-draft-sub' }, 'Claude fills in the form inside your own Chrome. You attach the file, do any puzzle check, read it over and press Submit. Nothing here sends anything.'),
      h('p', { class: 'jq-hstep' }, '1. Settle these first (answer this job\'s cards in Get to know you)'),
      list(hp.settle),
      h('p', { class: 'jq-hstep' }, '2. Have these ready'),
      h('ul', { class: 'jq-hlist jq-hbul' },
        page ? h('li', null, 'Application page: ', h('a', { href: page, target: '_blank', rel: 'noopener noreferrer' }, page, outIcon()), hp.openNote ? ' ' + String(hp.openNote) : '') : null,
        files.map(function (f) { return h('li', null, 'File to attach in ' + String(f.spot || 'the upload spot') + ': ', h('b', null, f.file), '. Open it from Documents on this card and save it to your Downloads folder.'); })),
      h('p', { class: 'jq-hstep' }, '3. What to expect on this form' + (hp.platform ? ' (' + String(hp.platform) + ')' : '')),
      list(hp.expect, 'jq-hlist jq-hbul'),
      h('p', { class: 'jq-hstep' }, '4. Copy the prompt. Then open the application page in Chrome (the Open the form button on this card does both at once), click the Claude icon, paste the prompt into the panel and press Enter.'),
      h('div', { class: 'jq-copyrow' },
        h('button', {
          type: 'button', class: 'btn btn-primary', id: copyId,
          onclick: function () { onCopyPrompt(q, ui, boxId, panel); },
        }, copied === 'ok' ? 'Copied' : 'Copy the Claude prompt'),
        copied === 'fail' ? h('span', { class: 'jq-copynote' }, 'Copy did not work here. Tap in the box, press Ctrl+A, then Ctrl+C.') : null),
      h('textarea', { class: 'jq-prompt', id: boxId, readonly: 'readonly', rows: '12', spellcheck: 'false', 'aria-label': 'Prompt for Claude in Chrome' }, String(hp.prompt || '')),
      h('p', { class: 'jq-hstep' }, '5. When Claude says it is done'),
      list(hp.after));
  }

  CMC.helperBlock = helperBlock; // the job drawer shows the same block (Chris, Oct 16: Find a company, then apply)
  CMC.openForm = onOpenForm; // the drawer's Open the form link copies the prompt the same way

  function docsBlock(q, id) {
    var h = CMC.h;
    var co = q.company || 'Company';
    var items = [];
    var hasLinks = false;
    (Array.isArray(q.docs) ? q.docs : []).forEach(function (d) {
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
        items.push(h('li', null, h('span', { class: 'dot dot-good' }),
          h('a', {
            class: 'jq-doclink', href: url, target: '_blank', rel: 'noopener noreferrer',
            title: 'Open ' + label + ' in a new tab',
          }, label, outIcon()),
          alt && alt !== url ? h('a', {
            class: 'jq-docalt', href: alt, target: '_blank', rel: 'noopener noreferrer',
            title: 'Open the GitHub copy of ' + label + ' in a new tab (needs a GitHub sign-in)',
          }, 'GitHub copy') : null));
      } else {
        items.push(h('li', null, h('span', { class: 'dot dot-good' }), label));
      }
    });
    if (!items.length) {
      return h('div', { class: 'jq-docs', id: id },
        h('span', { class: 'jq-draft-k' }, 'Documents for this application'),
        h('p', { class: 'jq-draft-sub' }, 'The links for this application are not saved on the card yet. The drafts are in the output folder on your Career Ops branch on GitHub.'));
    }
    return h('div', { class: 'jq-docs', id: id },
      h('span', { class: 'jq-draft-k' }, 'Documents for this application'),
      h('ul', { class: 'jq-doclist' }, items),
      h('p', { class: 'jq-draft-sub' }, 'Tap a file to open it. The GitHub copy beside each is a second copy that needs a GitHub sign-in (account mccawc1).'));
  }

  /* ---------------- New matches lane ------------------------------------- */
  function matchCard(app, ui, stale) {
    var h = CMC.h, fmt = CMC.fmt;
    var band = bandOf(app.score);
    var isBusy = !!busyMap(ui)[app.id];
    var scoreText = (typeof app.score === 'number' && !isNaN(app.score)) ? app.score.toFixed(1) : null;

    var meta = [];
    if (app.platform) meta.push(app.platform);
    if (app.dateFound) meta.push('found ' + fmt.date(app.dateFound));
    if (app.pay) meta.push(app.pay);

    return h('article', { class: 'jq-card' },
      h('div', { class: 'jq-scorecol' },
        h('span', {
          class: 'jq-score' + (band ? ' ' + band.cls : '') + (scoreText ? '' : ' jq-score-na'),
          title: scoreText ? 'Fit score ' + scoreText + ' out of 5' : 'Claude has not scored this one yet',
        }, scoreText || 'Not scored yet', scoreText ? h('small', null, '/5') : null),
        band ? h('span', { class: 'jq-band' }, band.word + ' fit') : null),
      h('div', { class: 'jq-main' },
        h('div', { class: 'jq-corow' },
          h('span', { class: 'jq-co' }, app.company || ''),
          app.priority ? h('span', { class: 'chip chip-accent jq-pri' }, flagIcon(), 'Priority') : null),
        h('div', { class: 'jq-role' }, app.role || ''),
        meta.length ? h('div', { class: 'jq-meta' }, meta.join(' · ')) : null,
        app.notes ? h('p', { class: 'jq-why' }, app.notes) : null,
        h('div', { class: 'jq-actions' },
          h('button', {
            type: 'button', class: 'btn btn-primary', id: 'jq-apply-' + app.id, disabled: isBusy,
            onclick: function () { onApply(app, ui, stale); },
          }, isBusy ? 'Applying...' : 'Apply'),
          h('button', {
            type: 'button', class: 'btn btn-ghost', id: 'jq-pass-' + app.id, disabled: isBusy,
            onclick: function () { onPass(app, ui); },
          }, 'Pass'),
          h('button', {
            type: 'button', class: 'btn btn-ghost', id: 'jq-details-' + app.id,
            onclick: function () { CMC.openDrawer(app.id); },
          }, 'Details'))));
  }

  /* every queue doc for the app, a submitted one included. CMC.queueFor
     skips a submitted doc (finished business), so a re-opened app shows up
     here again like it does in the pipeline and the drawer, and Apply
     clears that old doc before the fresh request goes in. */
  function staleQueueDoc(state, appId) {
    var hit = null;
    (state.queue || []).forEach(function (q) { if (q.appId === appId || q.id === 'q-' + appId) hit = q; });
    return hit;
  }

  function matchesLane(state, ui) {
    var h = CMC.h;
    /* an app with a live prep request lives in the Apply queue next door;
       Apply and Pass are not offered on it there. A submitted request is
       finished, so its app is a match again (same reader as the pipeline,
       the tracker and the drawer: CMC.queueFor). */
    var matches = state.applications
      .filter(function (a) { return a.status === 'Evaluated' && !CMC.queueFor(a.id); })
      .sort(function (a, b) {
        var d = (b.score || 0) - (a.score || 0);
        if (d) return d;
        if (!!b.priority !== !!a.priority) return b.priority ? 1 : -1;
        return String(b.dateFound || '').localeCompare(String(a.dateFound || ''));
      });
    var waiting = state.applications.filter(function (a) { return a.status === 'found'; }).length;

    var body;
    if (matches.length) {
      body = matches.map(function (a) { return matchCard(a, ui, staleQueueDoc(state, a.id)); });
    } else {
      body = [h('div', { class: 'jq-empty' },
        searchIcon(),
        h('span', { class: 'jq-empty-t' }, 'No new matches right now'),
        h('p', { class: 'jq-empty-s' }, 'You are caught up. Claude scans your platforms every morning and posts fresh matches here.'))];
    }
    if (waiting > 0) {
      body.push(h('p', { class: 'jq-foot' },
        h('span', { class: 'dot dot-info' }),
        waiting === 1
          ? '1 job link is waiting for Claude to score it.'
          : waiting + ' job links are waiting for Claude to score them.'));
    }

    return h('section', { class: 'panel jq-lane', 'aria-label': 'New matches' },
      h('div', { class: 'panel-head' },
        h('h2', { class: 'panel-title', id: 'jq-head-matches', tabindex: '-1' }, 'New matches'),
        matches.length ? h('span', { class: 'chip mono' }, String(matches.length)) : null,
        h('span', { class: 'panel-kicker' }, 'scored by Claude, best first')),
      h('div', { class: 'panel-body' }, body));
  }

  /* ---------------- Apply queue lane -------------------------------------- */
  /* a request that is waiting its turn: requested, or a state this page
     does not know (the stepper shows those at step one too) */
  function inLine(q) { return STATES.indexOf(q.state) < 1; }

  function stepper(cur) {
    var h = CMC.h;
    var idx = STATES.indexOf(cur);
    if (idx < 0) idx = 0;
    return h('ol', { class: 'jq-steps', 'data-cur': STATES[idx], 'aria-label': 'Application progress, step ' + (idx + 1) + ' of 5: ' + STATES[idx] },
      STATES.map(function (s, i) {
        var cls = i < idx ? 'is-done' : (i === idx ? 'is-current' : 'is-todo');
        return h('li', { class: 'jq-step ' + cls },
          h('span', { class: 'jq-dot' }),
          h('span', { class: 'jq-sl' }, s));
      }));
  }

  /* pos: where a waiting request stands in the line (0 = front), null for
     every other state. Only the front card is next; the rest say how many
     sit ahead of them, so four cards never all claim to be next. */
  function statusFor(q, pos) {
    var fmt = CMC.fmt;
    switch (q.state) {
      case 'prepping': return { dot: 'dot-info pulse', text: 'Claude is building the tailored resume.' };
      case 'ready':
        if (q.blocked) return { dot: 'dot-warn', cls: 'jq-status-ready', text: 'On hold. Waiting on ' + (q.blocked.waitingOn || 'a reply') + '.' };
        return { dot: 'dot-warn', cls: 'jq-status-ready', text: 'Ready for your review.' };
      case 'approved': return { dot: 'dot-good', text: 'Approved. Now finish it in Chrome: tap Apply in Chrome, press Submit yourself, then tap Chris submitted it.' };
      case 'submitted': return { dot: 'dot-good', text: 'Submitted' + (q.updatedAt ? ' ' + fmt.date(q.updatedAt) : '') + '.' };
      default:
        if (!pos) return { dot: 'dot-idle', text: 'In line. Claude starts on this one next.' };
        return { dot: 'dot-idle', text: 'In line, ' + pos + ' ahead of it.' };
    }
  }

  function queueCard(q, ui, pos) {
    var h = CMC.h, fmt = CMC.fmt;
    var isReady = q.state === 'ready';
    var isApproved = q.state === 'approved';
    var isSubmitted = q.state === 'submitted';
    /* documents exist from the moment the prep is ready */
    var hasDocs = isReady || isApproved || isSubmitted;
    var busy = busyMap(ui)[q.id] || '';
    var isBusy = !!busy;
    var draftOpen = (isReady || isApproved) && ui.jqDraftOpen === q.id;
    var docsOpen = hasDocs && ui.jqDocsOpen === q.id;
    var st = statusFor(q, pos);
    var draftId = 'jq-draft-' + q.id;
    var docsId = 'jq-docs-' + q.id;

    var actions = [];
    /* on hold (q.blocked): the apply path is closed, so there is nothing to approve yet */
    /* Approve only marks the package approved. Nothing is sent from this
       page: Chris sends each one in Chrome with the helper (Oct 16). */
    if (isReady && !q.blocked) {
      actions.push(h('button', {
        type: 'button', class: 'btn btn-primary', id: 'jq-approve-' + q.id, disabled: isBusy,
        title: 'Marks this one approved. Nothing is sent from the dashboard; you send it in Chrome next.',
        onclick: function () { onApprove(q, ui); },
      }, busy === 'approve' ? 'Saving...' : 'Approve'));
    }
    if (isReady || isApproved) {
      actions.push(h('button', {
        type: 'button', class: 'btn btn-ghost', id: 'jq-submit-' + q.id, disabled: isBusy,
        title: 'Already sent this one yourself? Mark it submitted and applied.',
        onclick: function () { onSubmitted(q, ui); },
      }, busy === 'submit' ? 'Saving...' : 'Chris submitted it'));
    }
    if (isReady || isApproved) {
      actions.push(h('button', {
        type: 'button', class: 'btn btn-ghost', id: 'jq-tg-draft-' + q.id,
        'aria-expanded': draftOpen ? 'true' : 'false', 'aria-controls': draftId,
        'data-jq-toggle': 'draft:' + q.id,
        onclick: function () { onToggleDraft(q, ui); },
      }, draftOpen ? (q.helper ? 'Hide the Chrome helper' : 'Hide draft') : (q.helper ? 'Apply in Chrome' : 'View draft')));
    }
    /* Open the form (Chris, Oct 16): a plain link beside Apply in Chrome */
    var formUrl = (isReady || isApproved) && q.helper ? CMC.safeUrl(q.helper.page) : '';
    if (formUrl) {
      actions.push(h('a', {
        class: 'btn btn-ghost jq-openform', id: 'jq-open-' + q.id,
        href: formUrl, target: '_blank', rel: 'noopener noreferrer',
        title: 'Opens the application page in a new tab and copies the Claude prompt, ready to paste into the Claude panel there.',
        onclick: function () { onOpenForm(q); },
      }, 'Open the form', outIcon()));
    }
    if (hasDocs) {
      actions.push(h('button', {
        type: 'button', class: 'btn btn-ghost', id: 'jq-tg-docs-' + q.id,
        'aria-expanded': docsOpen ? 'true' : 'false', 'aria-controls': docsId,
        'data-jq-toggle': 'docs:' + q.id,
        onclick: function () { onToggleDocs(q, ui); },
      }, docsOpen ? 'Hide documents' : 'View documents'));
    }

    return h('article', { class: 'jq-q' + (isReady ? ' needs-you' : '') },
      h('div', { class: 'jq-qhead' },
        h('div', { class: 'jq-qtitle' },
          h('span', { class: 'jq-qco' }, q.company || ''),
          h('span', { class: 'jq-qrole' }, q.role || ''),
          isReady && q.blocked ? h('span', { class: 'chip chip-warn jq-prepped jq-onhold', title: q.blocked.reason || 'The files are done, but the apply path is closed for now.' }, holdIcon(), holdText(q)) : null,
          isReady && !q.blocked ? h('span', { class: 'chip chip-good jq-prepped', title: 'Resume, cover letter and answers are done. Only you can send it.' }, checkIcon(), 'Prepped and ready to send') : null),
        q.updatedAt ? h('span', { class: 'jq-qago', title: 'Last update' }, fmt.ago(q.updatedAt)) : null),
      stepper(q.state),
      h('p', { class: 'jq-status' + (st.cls ? ' ' + st.cls : '') },
        h('span', { class: 'dot ' + st.dot }),
        h('span', null, st.text)),
      (isReady || isApproved) && q.note && !draftOpen ? h('p', { class: 'jq-note' }, q.note) : null,
      actions.length ? h('div', { class: 'jq-qactions' }, actions) : null,
      draftOpen ? (q.helper ? helperBlock(q, draftId, ui) : h('div', { class: 'jq-draft', id: draftId },
        h('span', { class: 'jq-draft-k' }, 'Draft summary'),
        q.note ? h('p', null, q.note) : null,
        h('p', { class: 'jq-draft-sub' }, 'The full draft lives in your Career Ops tracker. A tap-to-read preview is coming in a later update.'))) : null,
      docsOpen ? docsBlock(q, docsId) : null);
  }

  function queueLane(state, ui) {
    var h = CMC.h;
    var items = state.queue.slice().sort(function (a, b) {
      var d = (QUEUE_SORT[a.state] !== undefined ? QUEUE_SORT[a.state] : 9) - (QUEUE_SORT[b.state] !== undefined ? QUEUE_SORT[b.state] : 9);
      if (d) return d;
      /* a line is first come, first served: waiting requests sit oldest
         first, so a new Apply joins the back and the front card stays
         next. Every other state shows the freshest card first. */
      if (inLine(a) && inLine(b)) {
        return String(a.requestedAt || a.updatedAt || '').localeCompare(String(b.requestedAt || b.updatedAt || ''));
      }
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
    /* the same count the tab title and the KPI deck use, so the kicker
       never disagrees with "N waiting on you" up top: ready queue docs
       only, worded as what Chris can do about them here */
    var ready = CMC.needsChris().ready;

    var body = [h('p', { class: 'jq-trust' },
      shieldIcon(),
      h('span', null, 'Claude preps every application. Nothing is sent from this page: you send each one yourself in Chrome, then tap Chris submitted it.'))];

    if (items.length) {
      var waiting = 0;
      body = body.concat(items.map(function (q) {
        return queueCard(q, ui, inLine(q) ? waiting++ : null);
      }));
    } else {
      body.push(h('div', { class: 'jq-empty' },
        sendIcon(),
        h('span', { class: 'jq-empty-t' }, 'The queue is clear'),
        h('p', { class: 'jq-empty-s' }, 'Tap Apply on a match and Claude will prep the application here for your sign-off.')));
    }

    /* the head chip counts what "in the queue" means everywhere else on the
       page (At a glance, the pipeline's In queue pill): live requests only.
       Finished cards stay listed at the bottom and get their own words. */
    var live = items.filter(function (q) { return q.state !== 'submitted'; }).length;
    var sent = items.length - live;
    var kicker = ready > 0 ? ready + ' ready for your review' : 'nothing ready to approve';
    var approvedN = items.filter(function (q) { return q.state === 'approved'; }).length;
    if (approvedN > 0) kicker += ', ' + approvedN + ' approved for you to send in Chrome';
    if (sent > 0) kicker += ', ' + sent + ' sent';

    return h('section', { class: 'panel jq-lane', 'aria-label': 'Apply queue' },
      h('div', { class: 'panel-head' },
        h('h2', { class: 'panel-title', id: 'jq-head-queue', tabindex: '-1' }, 'Apply queue'),
        live ? h('span', { class: 'chip mono', title: live + ' in the queue' }, String(live)) : null,
        h('span', { class: 'panel-kicker' }, kicker)),
      h('div', { class: 'panel-body' }, body));
  }

  /* ---------------- render ------------------------------------------------ */
  /* Focus survives every rebuild (an action, a live snapshot). The button
     Chris had focused inside this panel comes back by id on the new DOM.
     When it is gone (Apply and Pass take the card out of New matches,
     Approve and "Chris submitted it" drop their own button), the next stop
     is another button on the same card, then the first button of a later
     card in the lane, then an earlier one, then the lane heading, so a
     keyboard user never lands back on body at the top of the page. The
     plan is read off the old DOM before the clear and applied after the
     append. A disabled (saving) button is skipped, not waited for. */
  function focusPlan(el) {
    var ids = [];
    var ae = document.activeElement;
    if (!ae || !ae.id || !el.contains(ae)) return ids;
    ids.push(ae.id);
    var card = ae.closest ? ae.closest('.jq-card, .jq-q') : null;
    if (!card) return ids;
    var mates = card.querySelectorAll('button[id]');
    for (var i = 0; i < mates.length; i++) if (mates[i] !== ae) ids.push(mates[i].id);
    var lane = card.closest('.jq-lane');
    if (!lane) return ids;
    var cards = lane.querySelectorAll('.jq-card, .jq-q');
    var at = Array.prototype.indexOf.call(cards, card);
    var j, b;
    for (j = at + 1; j < cards.length; j++) { b = cards[j].querySelector('button[id]'); if (b) { ids.push(b.id); break; } }
    for (j = at - 1; j >= 0; j--) { b = cards[j].querySelector('button[id]'); if (b) { ids.push(b.id); break; } }
    var head = lane.querySelector('.panel-title[id]');
    if (head) ids.push(head.id);
    return ids;
  }
  function applyFocus(el, ids) {
    for (var i = 0; i < ids.length; i++) {
      var f = document.getElementById(ids[i]);
      if (!f || !el.contains(f) || f.disabled) continue;
      try { f.focus({ preventScroll: true }); } catch (e) { try { f.focus(); } catch (e2) { /* not focusable */ } }
      if (document.activeElement === f) return;
    }
  }

  function render(el, state, ui) {
    var h = CMC.h;
    var plan = focusPlan(el);
    el.textContent = '';
    el.appendChild(h('div', { class: 'jq-wrap' },
      matchesLane(state, ui),
      queueLane(state, ui)));
    /* the reveals here are inline, not sheets, so this piece never sets
       CMC.ui.sheetOpen; it only asks whether something else is on top
       (the drawer after Details, say) and then leaves focus there */
    if (plan.length && !CMC.modalOpen()) applyFocus(el, plan);
    if (!el.__jqWired) {
      el.__jqWired = true;
      el.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape' && closeReveals(ui)) ev.stopPropagation();
      });
    }
  }

  CMC.register('jobs-queue', { render: render });
})();
