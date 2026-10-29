/* piece: know-you. "Get to know you": one card per question Claude still
   needs answered, grouped, with a text box and Save. Answers feed resumes
   and application forms. Reads CMC.state.interview, writes only via
   CMC.act.*, open/closed state lives in CMC.ui.kyOpen, drafts in ui.kyDraft,
   ui.kyFocus names the control to focus after the next render. */
(function () {
  'use strict';
  var CMC = window.CMC;
  if (!CMC) return;

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
  function checkIcon() {
    return icon(16, [['polyline', { points: '20 6 9 17 4 12' }]], '2.4');
  }

  /* ---------------- ui state --------------------------------------------- */
  function openMap(ui) { if (!ui.kyOpen) ui.kyOpen = {}; return ui.kyOpen; }
  function draftMap(ui) { if (!ui.kyDraft) ui.kyDraft = {}; return ui.kyDraft; }
  function busyMap(ui) { if (!ui.kyBusy) ui.kyBusy = {}; return ui.kyBusy; }
  function errMap(ui) { if (!ui.kyErr) ui.kyErr = {}; return ui.kyErr; }
  /* when the write lands the card folds; a keyboard user who was still on
     that card lands on its Edit or Answer button. Focus that moved somewhere
     else in the meantime (another card's text box) is left alone. */
  function finishBusy(ui, id) {
    return function () {
      delete busyMap(ui)[id];
      var ae = document.activeElement;
      var card = document.getElementById('ky-card-' + id);
      if (!ae || ae === document.body || (card && card.contains(ae))) ui.kyFocus = 'ky-edit-' + id;
      CMC.rerender('know-you');
    };
  }
  /* every render rebuilds the slot, so focus and the caret are carried
     across by id: a handler names its target in ui.kyFocus, otherwise the
     control Chris is on keeps its place (text, caret and all) */
  function captureFocus(el, ui) {
    var keep = { id: ui.kyFocus || null, sel: null, byHandler: !!ui.kyFocus };
    ui.kyFocus = null;
    var ae = document.activeElement;
    if (!keep.id && ae && ae.id && el.contains(ae)) {
      keep.id = ae.id;
      try { if (typeof ae.selectionStart === 'number') keep.sel = [ae.selectionStart, ae.selectionEnd]; } catch (e) { keep.sel = null; }
    }
    return keep;
  }
  function focusNode(node, keep) {
    try { node.focus({ preventScroll: true }); } catch (e) { node.focus(); }
    if (typeof node.selectionStart !== 'number') return;
    try {
      if (keep.sel) node.setSelectionRange(keep.sel[0], keep.sel[1]);
      else if (keep.byHandler) { var n = node.value.length; node.setSelectionRange(n, n); }
    } catch (e2) { /* not a text control */ }
  }
  function restoreFocus(el, keep) {
    if (!keep.id) return;
    var k = document.getElementById(keep.id);
    if (k && !k.disabled && el.contains(k)) { focusNode(k, keep); return; }
    /* that control is gone or busy (the card folded, or a write is in
       flight): land on the same card's Edit button, then its text box, then
       the card itself, so Tab carries on from here, not the top of the page */
    var m = /^ky-(?:box|save|skip|cancel|edit)-(.+)$/.exec(keep.id);
    if (!m) return;
    var tries = ['ky-edit-', 'ky-box-', 'ky-card-'];
    for (var i = 0; i < tries.length; i++) {
      var n = document.getElementById(tries[i] + m[1]);
      if (n && !n.disabled && el.contains(n)) { focusNode(n, { sel: null, byHandler: false }); return; }
    }
  }
  /* a card is open when Chris opened it, or by default while it is still
     unanswered and not skipped */
  function isOpen(card, ui) {
    var o = openMap(ui);
    if (o[card.id] === true) return true;
    if (o[card.id] === false) return false;
    return card.status === 'open' && !card.skipped;
  }
  function onEdit(card, ui) {
    openMap(ui)[card.id] = true;
    ui.kyFocus = 'ky-box-' + card.id;
    CMC.rerender('know-you');
  }
  function onCancel(card, ui) {
    openMap(ui)[card.id] = false;
    delete draftMap(ui)[card.id];
    delete errMap(ui)[card.id];
    ui.kyFocus = 'ky-edit-' + card.id;
    CMC.rerender('know-you');
  }
  function onToggleAll(ui) {
    ui.kyShowAll = !ui.kyShowAll;
    ui.kyFocus = 'ky-toggle-all';
    CMC.rerender('know-you');
  }
  function shortQ(q) {
    var s = String(q || '');
    return s.length > 60 ? s.slice(0, 60).replace(/\s+$/, '') + '...' : s;
  }

  /* ---------------- data actions ----------------------------------------- */
  function onSave(card, ui) {
    if (busyMap(ui)[card.id]) return;
    var box = document.getElementById('ky-box-' + card.id);
    var text = String(box ? box.value : (draftMap(ui)[card.id] || '')).trim();
    if (!text) {
      errMap(ui)[card.id] = 'Type an answer first, or skip for now.';
      ui.kyFocus = 'ky-box-' + card.id;
      CMC.rerender('know-you');
      return;
    }
    busyMap(ui)[card.id] = true;
    delete errMap(ui)[card.id];
    var wasAnswered = card.status === 'answered';
    var p = CMC.act.updateDoc('interview', card.id, {
      answer: text,
      answeredAt: new Date().toISOString(),
      status: 'answered',
      skipped: false,
    });
    CMC.act.addActivity((wasAnswered ? 'You updated your answer: ' : 'You answered: ') + shortQ(card.question), 'system');
    openMap(ui)[card.id] = false;
    delete draftMap(ui)[card.id];
    var fin = finishBusy(ui, card.id);
    p.then(fin, fin);
  }
  function onSkip(card, ui) {
    if (busyMap(ui)[card.id]) return;
    busyMap(ui)[card.id] = true;
    delete errMap(ui)[card.id];
    var p = CMC.act.updateDoc('interview', card.id, { skipped: true });
    openMap(ui)[card.id] = false;
    var fin = finishBusy(ui, card.id);
    p.then(fin, fin);
  }

  /* ---------------- cards ------------------------------------------------- */
  function openCard(card, ui) {
    var h = CMC.h;
    var isBusy = !!busyMap(ui)[card.id];
    var boxId = 'ky-box-' + card.id;
    var hintId = 'ky-hint-' + card.id;
    var drafts = draftMap(ui);
    var err = errMap(ui)[card.id];
    var value = drafts[card.id] !== undefined ? drafts[card.id] : (card.answer || '');
    var editing = card.status === 'answered';

    return h('article', { class: 'ky-card is-open', 'data-id': card.id, id: 'ky-card-' + card.id, tabindex: '-1' },
      h('p', { class: 'ky-q' }, card.question || ''),
      card.why ? h('p', { class: 'ky-why' }, card.why) : null,
      h('div', { class: 'field ky-field' },
        h('label', { for: boxId }, editing ? 'Your answer (saved, edit it here)' : 'Your answer'),
        h('textarea', {
          id: boxId,
          class: 'input ky-box',
          rows: 3,
          placeholder: 'A sentence or two is plenty.',
          'aria-invalid': err ? 'true' : null,
          'aria-describedby': err ? hintId : null,
          disabled: isBusy,
          oninput: function (ev) {
            drafts[card.id] = ev.target.value;
            if (errMap(ui)[card.id] && ev.target.value.trim()) {
              delete errMap(ui)[card.id];
              ev.target.removeAttribute('aria-invalid');
              var hint = document.getElementById(hintId);
              if (hint) hint.hidden = true;
            }
          },
          onkeydown: function (ev) {
            /* Escape backs out of editing a saved answer; a fresh card has
               nothing to close */
            if (ev.key === 'Escape' && editing) onCancel(card, ui);
          },
        }, value),
        err ? h('p', { class: 'field-hint ky-err', id: hintId }, err) : null),
      h('div', { class: 'form-actions ky-actions' },
        h('button', {
          type: 'button', class: 'btn btn-primary', disabled: isBusy, id: 'ky-save-' + card.id,
          onclick: function () { onSave(card, ui); },
        }, isBusy ? 'Saving...' : 'Save'),
        editing ? h('button', {
          type: 'button', class: 'btn btn-ghost', disabled: isBusy, id: 'ky-cancel-' + card.id,
          onclick: function () { onCancel(card, ui); },
        }, 'Cancel') : h('button', {
          type: 'button', class: 'btn btn-ghost', disabled: isBusy, id: 'ky-skip-' + card.id,
          onclick: function () { onSkip(card, ui); },
        }, 'Skip for now')));
  }

  function closedCard(card, ui) {
    var h = CMC.h, fmt = CMC.fmt;
    var applied = card.status === 'applied';
    var answered = card.status === 'answered';
    var dotKind = (applied || answered) ? 'good' : 'idle';
    var word = applied ? 'Applied' : (answered ? 'Answered' : 'Skipped');
    var when = applied ? (card.appliedAt || card.answeredAt) : card.answeredAt;
    var sub = applied
      ? 'Applied to your files' + (when ? ' ' + fmt.date(when) : '')
      : (answered ? (card.answer ? card.answer : 'Saved' + (when ? ' ' + fmt.date(when) : '')) : 'Skipped for now. Come back to it any time.');

    return h('article', { class: 'ky-card is-closed ky-' + (applied ? 'applied' : (answered ? 'answered' : 'skipped')), 'data-id': card.id, id: 'ky-card-' + card.id, tabindex: '-1' },
      h('span', { class: 'dot dot-' + dotKind }),
      h('span', { class: 'ky-closed-main' },
        h('span', { class: 'ky-closed-top' },
          h('span', { class: 'ky-word mono' }, word),
          h('span', { class: 'ky-closed-q' }, card.question || '')),
        h('span', { class: 'ky-closed-sub' + (applied || !answered ? ' is-note' : '') }, sub)),
      applied ? null : h('button', {
        type: 'button', class: 'btn btn-ghost ky-edit', id: 'ky-edit-' + card.id,
        'aria-expanded': 'false',
        title: answered ? 'Change this answer' : 'Answer this one now',
        onclick: function () { onEdit(card, ui); },
      }, answered ? 'Edit' : 'Answer'));
  }

  function groupBlock(label, cards, ui) {
    var h = CMC.h;
    var done = cards.filter(function (c) { return c.status === 'answered' || c.status === 'applied'; }).length;
    return h('section', { class: 'ky-group', 'aria-label': label },
      h('div', { class: 'ky-group-h' },
        h('span', { class: 'ky-group-l' }, label),
        h('span', { class: 'ky-group-n mono' }, done + ' of ' + cards.length)),
      /* open cards first (the work), folded ones after (the receipts), each
         set in question order; folded cards run full width so a short row
         never sits beside a tall text box with a hole under it */
      h('div', { class: 'ky-grid' },
        cards.filter(function (c) { return isOpen(c, ui); }).map(function (c) { return openCard(c, ui); }),
        cards.filter(function (c) { return !isOpen(c, ui); }).map(function (c) { return closedCard(c, ui); })));
  }

  /* ---------------- render ------------------------------------------------ */
  function render(el, state, ui) {
    var h = CMC.h;
    var cards = (state.interview || []).slice();
    var keep = captureFocus(el, ui);
    el.textContent = '';
    /* nothing to ask: the panel leaves the page entirely */
    if (!cards.length) return;

    cards.sort(function (a, b) {
      var d = (Number(a.order) || 0) - (Number(b.order) || 0);
      if (d) return d;
      return String(a.id).localeCompare(String(b.id));
    });
    var total = cards.length;
    var done = cards.filter(function (c) { return c.status === 'answered' || c.status === 'applied'; }).length;
    var allDone = done === total;
    var pctDone = total ? Math.round((done / total) * 100) : 0;

    var body;
    if (allDone && !ui.kyShowAll) {
      body = [h('p', { class: 'ky-done' },
        h('span', { class: 'ky-done-ic' }, checkIcon()),
        h('span', null, 'All questions answered.'),
        h('button', {
          type: 'button', class: 'btn btn-ghost', id: 'ky-toggle-all',
          'aria-expanded': 'false',
          onclick: function () { onToggleAll(ui); },
        }, 'Edit your answers'))];
    } else {
      /* groups keep the order of their first question */
      var groups = [], byLabel = {};
      cards.forEach(function (c) {
        var g = c.group || 'Other';
        if (!byLabel[g]) { byLabel[g] = []; groups.push(g); }
        byLabel[g].push(c);
      });
      body = [
        h('p', { class: 'ky-intro' }, 'Answer in your own words. Short is fine. Claude turns these into resume lines and application answers.'),
        h('div', { class: 'ky-progress', role: 'img', 'aria-label': done + ' of ' + total + ' answered' },
          h('span', { class: 'ky-track' }, h('span', { class: 'ky-bar', style: { width: pctDone + '%' } })),
          h('span', { class: 'ky-progress-n mono' }, total - done === 0 ? 'all done' : (total - done) + ' to go')),
        groups.map(function (g) { return groupBlock(g, byLabel[g], ui); }),
      ];
      if (allDone) {
        body.push(h('div', { class: 'ky-foot' },
          h('button', {
            type: 'button', class: 'btn btn-ghost', id: 'ky-toggle-all',
            'aria-expanded': 'true',
            onclick: function () { onToggleAll(ui); },
          }, 'Hide the cards')));
      }
    }

    el.appendChild(h('section', { class: 'panel ky-panel' + (allDone && !ui.kyShowAll ? ' is-quiet' : ''), 'aria-label': 'Get to know you' },
      h('div', { class: 'panel-head' },
        h('h2', { class: 'panel-title' }, 'Get to know you'),
        h('span', { class: 'chip mono' + (allDone ? ' chip-good' : '') },
          allDone ? h('span', { class: 'dot dot-good' }) : null,
          done + ' of ' + total + ' answered'),
        h('span', { class: 'panel-kicker' }, 'your answers feed every application')),
      h('div', { class: 'panel-body ky-body' }, body)));
    restoreFocus(el, keep);
  }

  CMC.register('know-you', { render: render });
})();
