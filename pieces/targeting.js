/* piece: targeting. The targeting strip (which job-search profile is in
   force, with a dropdown to switch, create, edit, duplicate and reset) plus
   the nine-step profile wizard. Profiles change the rules, not the data:
   switching moves nothing on screen until the next scan.
   Reads CMC.state, writes only through CMC.act.*, UI state lives in CMC.ui:
   ui.tgPick (dropdown slug), ui.tgBusy (switch in flight), ui.tgFocus (id to
   focus after the next render), ui.tgWizard {mode, slug, step, draft, ...}
   and ui.tgDraft (the same draft object while the wizard is open). While the
   wizard is open the shared ui.sheetOpen flag is raised too (foundation's
   CMC.modalOpen reads ui.tgWizard directly; the flag is for everyone else). */
(function () {
  'use strict';
  var CMC = window.CMC;
  if (!CMC) return;
  var h = CMC.h;
  var fmt = CMC.fmt;
  var NS = 'http://www.w3.org/2000/svg';
  var SLUG_MAX = 40;

  /* each policy carries the scoring table the scanner reads; a new or changed
     policy gets its own table instead of the one copied from the source */
  var POLICIES = [
    { v: 'remote-only', w: 'Remote only', rule: 'any hybrid, on-site, or stated return-to-office plan is a FAIL',
      scoring: { fullyRemoteUS: 5.0, remoteWithTravelUnder25: 4.5, hybridOrOnsite: 'FAIL' } },
    { v: 'remote-first', w: 'Remote first', rule: 'hybrid or on-site allowed only inside the allowed cities',
      scoring: { fullyRemoteUS: 5.0, remoteWithTravelUnder25: 4.5, hybridLocal: 4.0, onsiteLocal: 3.5, hybridOrOnsiteElsewhere: 'FAIL' } },
    { v: 'hybrid-ok', w: 'Hybrid OK', rule: 'hybrid is OK inside the allowed cities; on-site only if local',
      scoring: { fullyRemoteUS: 5.0, remoteWithTravelUnder25: 4.5, hybridLocal: 4.5, onsiteLocal: 3.5, hybridOrOnsiteElsewhere: 'FAIL' } },
    { v: 'onsite-ok', w: 'On-site OK', rule: 'hybrid or on-site is OK inside the allowed cities',
      scoring: { fullyRemoteUS: 5.0, remoteWithTravelUnder25: 4.5, hybridLocal: 4.5, onsiteLocal: 4.5, hybridOrOnsiteElsewhere: 'FAIL' } },
  ];
  var EMPLOYMENT = [
    { v: 'full-time', w: 'Full-time' },
    { v: 'contract', w: 'Contract' },
    { v: 'part-time', w: 'Part-time' },
  ];
  var MONEY_KEYS = ['floorBase', 'targetLow', 'targetHigh', 'hourlyFloor', 'hourlyTarget', 'monthlyNeedLow', 'monthlyNeedHigh'];

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
  function xIcon() {
    return icon(16, [
      ['line', { x1: 6, y1: 6, x2: 18, y2: 18 }],
      ['line', { x1: 18, y1: 6, x2: 6, y2: 18 }],
    ], '2.2');
  }
  function scopeIcon() {
    return icon(26, [
      ['circle', { cx: 12, cy: 12, r: 7 }],
      ['line', { x1: 12, y1: 2, x2: 12, y2: 6 }],
      ['line', { x1: 12, y1: 18, x2: 12, y2: 22 }],
      ['line', { x1: 2, y1: 12, x2: 6, y2: 12 }],
      ['line', { x1: 18, y1: 12, x2: 22, y2: 12 }],
    ]);
  }

  /* ---------------- small helpers ----------------------------------------- */
  function lines(text) {
    return String(text || '').split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
  }
  function joinLines(arr) {
    return Array.isArray(arr) ? arr.map(function (x) { return String(x); }).join('\n') : '';
  }
  function numStr(n) { return (typeof n === 'number' && !isNaN(n)) ? String(n) : ''; }
  /* '' -> null (left blank), bad text -> NaN, otherwise the number */
  function toNum(s) {
    s = String(s === null || s === undefined ? '' : s).trim();
    if (!s) return null;
    var n = Number(s);
    return isNaN(n) ? NaN : n;
  }
  function str(v) { return String(v === null || v === undefined ? '' : v); }
  function hasKeys(o) { for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) return true; return false; }
  function firstKey(o) { for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) return k; return null; }
  function slugify(name) {
    var s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    s = s.slice(0, SLUG_MAX).replace(/-+$/, '');
    return s || 'profile';
  }
  function policyWord(v) {
    for (var i = 0; i < POLICIES.length; i++) if (POLICIES[i].v === v) return POLICIES[i].w;
    return v ? String(v) : '';
  }
  function policyRule(v) {
    for (var i = 0; i < POLICIES.length; i++) if (POLICIES[i].v === v) return POLICIES[i].rule;
    return '';
  }
  function policyScoring(v) {
    var out = {};
    for (var i = 0; i < POLICIES.length; i++) {
      if (POLICIES[i].v !== v) continue;
      var t = POLICIES[i].scoring;
      for (var k in t) if (Object.prototype.hasOwnProperty.call(t, k)) out[k] = t[k];
    }
    return out;
  }
  function findRow(state, slug) {
    var rows = state.targeting || [];
    for (var i = 0; i < rows.length; i++) if (rows[i].id === slug) return rows[i];
    return null;
  }
  function activeRow() { return CMC.activeTargeting(); }
  function pickedSlug(state, ui) {
    if (ui.tgPick && findRow(state, ui.tgPick)) return ui.tgPick;
    var a = activeRow();
    return a ? a.id : '';
  }
  function nameOf(t) { return t ? (t.name || t.id || '') : ''; }
  function platformCount(state, t) {
    var p = (t && t.platforms) || {};
    if (p.mode === 'selected') return (p.selected || []).length;
    return (state.platforms || []).filter(function (x) { return !!x.enabled; }).length;
  }
  function payLine(pay) {
    pay = pay || {};
    var floor = typeof pay.floorBase === 'number' ? fmt.money(pay.floorBase) : '';
    var lo = typeof pay.targetLow === 'number' ? fmt.money(pay.targetLow) : '';
    var hi = typeof pay.targetHigh === 'number' ? fmt.money(pay.targetHigh) : '';
    var target = '';
    if (lo && hi) target = lo + ' to ' + hi;
    else if (lo || hi) target = lo || hi;
    if (floor && target) return 'Floor ' + floor + ', target ' + target;
    if (floor) return 'Floor ' + floor;
    if (target) return 'Target ' + target;
    return '';
  }

  /* ---------------- draft <-> doc ------------------------------------------ */
  /* The wizard edits a flat draft (strings for text, one-per-line text for
     lists, booleans for checks). Save turns it back into a targeting doc. */
  function draftFrom(t) {
    t = t || {};
    var r = t.roles || {};
    var loc = t.location || {};
    var pay = t.pay || {};
    var sc = t.scoring || {};
    var pl = t.platforms || {};
    var emp = Array.isArray(t.employmentTypes) ? t.employmentTypes.slice() : ['full-time', 'contract', 'part-time'];
    return {
      name: str(t.name),
      summary: str(t.summary),
      rolesPrimary: joinLines(r.primary),
      rolesSecondary: joinLines(r.secondary),
      rolesAdjacent: joinLines(r.adjacent),
      titleKeywords: joinLines(t.titleKeywords),
      excludeKeywords: joinLines(t.excludeKeywords),
      industries: joinLines(t.industries),
      policy: policyWord(loc.policy) ? loc.policy : 'remote-only',
      base: str(loc.base || t.base),
      allowCities: joinLines(loc.allowCities),
      travelMaxPct: numStr(loc.travelMaxPct),
      officeVisits: str(loc.officeVisits),
      relocate: !!loc.relocate,
      international: str(loc.international),
      timeZones: str(loc.timeZones),
      floorBase: numStr(pay.floorBase),
      targetLow: numStr(pay.targetLow),
      targetHigh: numStr(pay.targetHigh),
      hourlyFloor: numStr(pay.hourlyFloor),
      hourlyTarget: numStr(pay.hourlyTarget),
      monthlyNeedLow: numStr(pay.monthlyNeedLow),
      monthlyNeedHigh: numStr(pay.monthlyNeedHigh),
      basis: str(pay.basis),
      bonusEquity: str(pay.bonusEquity),
      employmentTypes: emp,
      dealBreakers: joinLines(t.dealBreakers),
      platformsMode: pl.mode === 'selected' ? 'selected' : 'all',
      platformsSelected: Array.isArray(pl.selected) ? pl.selected.slice() : [],
      applyLine: typeof sc.applyLine === 'number' ? numStr(sc.applyLine) : '4.0',
      considerLine: typeof sc.considerLine === 'number' ? numStr(sc.considerLine) : '3.0',
      notes: str(sc.notes),
      makeActive: false,
    };
  }
  /* carry = the profile the defaults came from (hybrid rule, location
     scoring, currency ride along); existing = the doc being edited, or null */
  function docFrom(d, carry, existing, slug, nowIso) {
    carry = carry || {};
    existing = existing || null;
    var cloc = carry.location || {};
    var cpay = carry.pay || {};
    var remoteOnly = d.policy === 'remote-only';
    var hybridRule = (cloc.policy === d.policy && cloc.hybridRule) ? cloc.hybridRule : policyRule(d.policy);
    var base = d.base.trim();
    return {
      name: d.name.trim(),
      slug: slug,
      summary: d.summary.trim(),
      roles: { primary: lines(d.rolesPrimary), secondary: lines(d.rolesSecondary), adjacent: lines(d.rolesAdjacent) },
      titleKeywords: lines(d.titleKeywords),
      excludeKeywords: lines(d.excludeKeywords),
      industries: lines(d.industries),
      base: base,
      location: {
        policy: d.policy,
        base: base,
        allowCities: remoteOnly ? [] : lines(d.allowCities),
        travelMaxPct: toNum(d.travelMaxPct),
        officeVisits: d.officeVisits.trim(),
        relocate: !!d.relocate,
        international: d.international.trim(),
        timeZones: d.timeZones.trim(),
        hybridRule: hybridRule,
      },
      locationScoring: (cloc.policy === d.policy && carry.locationScoring && hasKeys(carry.locationScoring))
        ? carry.locationScoring
        : policyScoring(d.policy),
      pay: {
        floorBase: toNum(d.floorBase),
        targetLow: toNum(d.targetLow),
        targetHigh: toNum(d.targetHigh),
        hourlyFloor: toNum(d.hourlyFloor),
        hourlyTarget: toNum(d.hourlyTarget),
        monthlyNeedLow: toNum(d.monthlyNeedLow),
        monthlyNeedHigh: toNum(d.monthlyNeedHigh),
        basis: d.basis.trim(),
        bonusEquity: d.bonusEquity.trim(),
        currency: cpay.currency || 'USD',
      },
      employmentTypes: d.employmentTypes.slice(),
      dealBreakers: lines(d.dealBreakers),
      scoring: { applyLine: toNum(d.applyLine), considerLine: toNum(d.considerLine), notes: d.notes.trim() },
      platforms: { mode: d.platformsMode, selected: d.platformsMode === 'selected' ? d.platformsSelected.slice() : [] },
      isDefault: existing ? !!existing.isDefault : false,
      createdAt: (existing && existing.createdAt) || nowIso,
      updatedAt: nowIso,
      sample: false,
    };
  }

  /* ---------------- validation ---------------------------------------------- */
  function badNumber(d, k, msg, e) {
    var n = toNum(d[k]);
    if (n !== null && (isNaN(n) || n < 0)) e[k] = msg;
    return n;
  }
  function validate(w, step) {
    var d = w.draft;
    var e = {};
    if (step === 1) {
      if (!d.name.trim()) e.name = 'Give the profile a name first.';
      else if (w.mode !== 'edit' && findRow(CMC.state, slugify(d.name))) e.name = 'A profile with this name already exists. Pick another one.';
    }
    if (step === 4) {
      var tv = toNum(d.travelMaxPct);
      if (tv !== null && (isNaN(tv) || tv < 0 || tv > 100)) e.travelMaxPct = 'Use a number from 0 to 100.';
    }
    if (step === 5) {
      var plain = 'Use a plain number, like 83000.';
      var f = badNumber(d, 'floorBase', plain, e);
      var lo = badNumber(d, 'targetLow', plain, e);
      var hi = badNumber(d, 'targetHigh', plain, e);
      var hf = badNumber(d, 'hourlyFloor', 'Use a plain number, like 40.', e);
      var ht = badNumber(d, 'hourlyTarget', 'Use a plain number, like 50.', e);
      var ml = badNumber(d, 'monthlyNeedLow', 'Use a plain number, like 6000.', e);
      var mh = badNumber(d, 'monthlyNeedHigh', 'Use a plain number, like 8000.', e);
      if (!e.floorBase && !e.targetLow && f !== null && lo !== null && lo < f) e.targetLow = 'The target low should be at least the floor.';
      if (!e.targetLow && !e.targetHigh && lo !== null && hi !== null && hi < lo) e.targetHigh = 'The target high should be at least the target low.';
      if (!e.floorBase && !e.targetHigh && lo === null && f !== null && hi !== null && hi < f) e.targetHigh = 'The target high should be at least the floor.';
      if (!e.hourlyFloor && !e.hourlyTarget && hf !== null && ht !== null && ht < hf) e.hourlyTarget = 'The hourly target should be at least the hourly floor.';
      if (!e.monthlyNeedLow && !e.monthlyNeedHigh && ml !== null && mh !== null && mh < ml) e.monthlyNeedHigh = 'The high end should be at least the low end.';
    }
    if (step === 9) {
      var a = toNum(d.applyLine);
      var c = toNum(d.considerLine);
      if (a === null || isNaN(a) || a < 0 || a > 5) e.applyLine = 'Use a score from 0 to 5, like 4.0.';
      if (c === null || isNaN(c) || c < 0 || c > 5) e.considerLine = 'Use a score from 0 to 5, like 3.0.';
      if (!e.applyLine && !e.considerLine && c > a) e.considerLine = 'The consider line should sit at or below the apply line.';
    }
    return e;
  }

  /* ---------------- wizard state ------------------------------------------- */
  function isDirty(w) { return JSON.stringify(w.draft) !== w.initial; }
  function openWizard(ui, state, mode, slug, openerId) {
    var active = activeRow();
    var src = mode === 'edit' ? findRow(state, slug) : active;
    if (mode === 'edit' && !src) return;
    var d = draftFrom(src);
    if (mode !== 'edit') { d.name = ''; }
    if (mode === 'new') { d.summary = ''; }
    d.makeActive = mode === 'edit' ? !!(active && active.id === slug) : true;
    ui.tgWizard = {
      mode: mode,
      slug: mode === 'edit' ? slug : null,
      step: 1,
      draft: d,
      initial: JSON.stringify(d),
      errors: {},
      confirm: false,
      focusFirst: true,
      opener: openerId || null,
      platformQuery: '',
      carry: src || null,
      existing: mode === 'edit' ? src : null,
    };
    ui.tgDraft = d;
    CMC.rerender('targeting');
  }
  function closeWizard(ui) {
    var w = ui.tgWizard;
    ui.tgWizard = null;
    ui.tgDraft = null;
    if (w && w.opener) ui.tgFocus = w.opener;
    CMC.rerender('targeting');
  }
  function requestClose(ui) {
    var w = ui.tgWizard;
    if (!w) return;
    if (isDirty(w)) {
      w.confirm = true;
      ui.tgFocus = 'tgKeepBtn';
      CMC.rerender('targeting');
      return;
    }
    closeWizard(ui);
  }
  function keepEditing(ui) {
    var w = ui.tgWizard;
    if (!w) return;
    w.confirm = false;
    ui.tgFocus = 'tgCloseBtn';
    CMC.rerender('targeting');
  }
  function next(ui) {
    var w = ui.tgWizard;
    if (!w) return;
    var e = validate(w, w.step);
    if (hasKeys(e)) {
      w.errors = e;
      ui.tgFocus = fid(firstKey(e));
      CMC.rerender('targeting');
      return;
    }
    w.errors = {};
    w.confirm = false;
    if (w.step < STEPS.length) { w.step++; w.focusFirst = true; }
    CMC.rerender('targeting');
  }
  function back(ui) {
    var w = ui.tgWizard;
    if (!w) return;
    w.errors = {};
    w.confirm = false;
    if (w.step > 1) { w.step--; w.focusFirst = true; }
    CMC.rerender('targeting');
  }
  function save(ui, state) {
    var w = ui.tgWizard;
    if (!w) return;
    for (var s = 1; s <= STEPS.length; s++) {
      var e = validate(w, s);
      if (hasKeys(e)) {
        w.step = s;
        w.errors = e;
        w.confirm = false;
        ui.tgFocus = fid(firstKey(e));
        CMC.rerender('targeting');
        return;
      }
    }
    var now = new Date().toISOString();
    var slug = w.mode === 'edit' ? w.slug : slugify(w.draft.name);
    var doc = docFrom(w.draft, w.carry, w.existing, slug, now);
    var active = activeRow();
    var makeActive = !!w.draft.makeActive && !(active && active.id === slug);
    var verb = w.mode === 'edit' ? 'Updated' : 'Created';
    /* the doc lands in state first so the dropdown can point at it */
    CMC.act.setDoc('targeting', slug, doc);
    ui.tgPick = slug;
    closeWizard(ui);
    CMC.act.addActivity(verb + ' the targeting profile ' + doc.name + '.', 'system');
    if (makeActive) CMC.act.setActiveTargeting(slug);
    CMC.toast('Saved the ' + doc.name + ' profile.' + (makeActive ? ' It is now in force.' : ''));
  }

  /* ---------------- strip actions ------------------------------------------ */
  function onSwitch(ui, state) {
    var slug = pickedSlug(state, ui);
    var t = findRow(state, slug);
    var a = activeRow();
    if (!t || (a && a.id === slug) || ui.tgBusy) return;
    ui.tgBusy = true;
    var p = CMC.act.setActiveTargeting(slug);
    CMC.toast('Switched to ' + nameOf(t) + '. Profiles change the rules, not the data. Run a scan to see matches under it.');
    var fin = function () { ui.tgBusy = false; CMC.rerender('targeting'); };
    p.then(fin, fin);
  }
  function onReset(ui, state) {
    var slug = pickedSlug(state, ui);
    var t = findRow(state, slug);
    ui.tgDraft = null;
    ui.tgWizard = null;
    if (t && Object.prototype.hasOwnProperty.call(t, 'draft')) {
      var body = {};
      for (var k in t) if (k !== 'id' && k !== 'draft') body[k] = t[k];
      delete t.draft;
      CMC.act.setDoc('targeting', slug, body);
    }
    CMC.toast('Back to the saved version of ' + nameOf(t) + '.');
    CMC.rerender('targeting');
  }

  /* ---------------- field builders ----------------------------------------- */
  function fid(k) { return 'tg-f-' + k; }
  function fieldWrap(w, k, label, control, hint) {
    var e = w.errors[k];
    return h('div', { class: 'field tg-field' + (e ? ' is-error' : '') },
      h('label', { for: fid(k) }, label),
      control,
      e ? h('p', { class: 'tg-err', id: fid(k) + '-err' }, e) : null,
      hint ? h('p', { class: 'field-hint' }, hint) : null);
  }
  /* clear an inline error in place, with no rerender, so the caret stays
     exactly where Chris is typing (number boxes cannot restore a caret) */
  function clearError(ui, w, k) {
    if (!w.errors[k]) return;
    delete w.errors[k];
    var box = document.getElementById(fid(k));
    if (!box) { CMC.rerender('targeting'); return; }
    box.removeAttribute('aria-invalid');
    box.removeAttribute('aria-describedby');
    var msg = document.getElementById(fid(k) + '-err');
    if (msg && msg.parentNode) msg.parentNode.removeChild(msg);
    var wrap = box.parentNode;
    while (wrap && wrap !== overlayHost && !(wrap.classList && wrap.classList.contains('tg-field'))) wrap = wrap.parentNode;
    if (wrap && wrap.classList) wrap.classList.remove('is-error');
  }
  function textField(ui, w, k, label, hint, opts) {
    opts = opts || {};
    var d = w.draft;
    var e = w.errors[k];
    var input = h('input', {
      type: opts.type || 'text',
      class: 'input',
      id: fid(k),
      value: d[k],
      inputmode: opts.inputmode || null,
      min: opts.min !== undefined ? opts.min : null,
      max: opts.max !== undefined ? opts.max : null,
      step: opts.step || null,
      placeholder: opts.placeholder || null,
      autocomplete: 'off',
      'aria-invalid': e ? 'true' : null,
      'aria-describedby': e ? fid(k) + '-err' : null,
      oninput: function (ev) { d[k] = ev.target.value; clearError(ui, w, k); },
    });
    return fieldWrap(w, k, label, input, hint);
  }
  function numField(ui, w, k, label, hint, opts) {
    opts = opts || {};
    opts.type = 'number';
    opts.inputmode = 'decimal';
    if (opts.step === undefined) opts.step = 'any';
    if (opts.min === undefined) opts.min = '0';
    return textField(ui, w, k, label, hint, opts);
  }
  function areaField(ui, w, k, label, hint, rows) {
    var d = w.draft;
    var e = w.errors[k];
    var ta = h('textarea', {
      class: 'input',
      id: fid(k),
      rows: rows || 4,
      placeholder: 'One per line',
      'aria-invalid': e ? 'true' : null,
      'aria-describedby': e ? fid(k) + '-err' : null,
      oninput: function (ev) { d[k] = ev.target.value; clearError(ui, w, k); },
    }, d[k]);
    return fieldWrap(w, k, label, ta, hint);
  }
  function checkField(ui, w, k, label, hint, opts) {
    opts = opts || {};
    var d = w.draft;
    return h('div', { class: 'field tg-field' },
      h('label', { class: 'check', for: fid(k) },
        h('input', {
          type: 'checkbox',
          id: fid(k),
          checked: !!d[k],
          disabled: !!opts.disabled,
          onchange: function (ev) { d[k] = ev.target.checked; },
        }),
        h('span', null, label)),
      hint ? h('p', { class: 'field-hint' }, hint) : null);
  }

  /* ---------------- the nine steps ----------------------------------------- */
  function stepName(ui, w) {
    return [
      textField(ui, w, 'name', 'Profile name', 'Short and clear, like Remote Only or Texas Hybrid.', { placeholder: 'Remote Only' }),
      textField(ui, w, 'summary', 'Summary', 'One line that says what this profile is for.', { placeholder: 'Fully remote US roles only.' }),
    ];
  }
  function stepRoles(ui, w) {
    return [
      areaField(ui, w, 'rolesPrimary', 'Primary roles', 'Best fit. Claude looks for these first.'),
      areaField(ui, w, 'rolesSecondary', 'Secondary roles', 'Backup plan. Good roles if the best fit runs dry.'),
      areaField(ui, w, 'rolesAdjacent', 'Adjacent roles', 'Side income. Related work that pays the bills.', 3),
    ];
  }
  function stepWords(ui, w) {
    return [
      areaField(ui, w, 'titleKeywords', 'Title keywords', 'A posting whose title has one of these gets a look.'),
      areaField(ui, w, 'excludeKeywords', 'Words to exclude', 'A posting with one of these in the title is skipped.'),
      areaField(ui, w, 'industries', 'Industries', 'The kinds of companies that fit best.'),
    ];
  }
  function stepWhere(ui, w) {
    var d = w.draft;
    var sel = h('span', { class: 'select-wrap' },
      h('select', {
        id: fid('policy'),
        onchange: function (ev) {
          d.policy = ev.target.value;
          ui.tgFocus = fid('policy');
          CMC.rerender('targeting');
        },
      }, POLICIES.map(function (p) {
        return h('option', { value: p.v, selected: p.v === d.policy }, p.w);
      })));
    var out = [
      fieldWrap(w, 'policy', 'Location policy', sel, 'Remote only means hybrid or on-site postings fail. The others loosen that rule.'),
      h('div', { class: 'form-row' },
        textField(ui, w, 'base', 'Base city', 'Your home city, used for hybrid and on-site checks.', { placeholder: 'Austin, TX' }),
        numField(ui, w, 'travelMaxPct', 'Max travel percent', 'The most travel you will take, as a percent of your time.', { min: '0', max: '100', step: '1', placeholder: '25' })),
    ];
    if (d.policy !== 'remote-only') {
      out.push(areaField(ui, w, 'allowCities', 'Allowed cities', 'Hybrid or on-site is OK only in these cities.', 3));
    }
    out.push(textField(ui, w, 'officeVisits', 'Office visits', 'What office visits are OK, in your words.'));
    out.push(checkField(ui, w, 'relocate', 'I would relocate for the right job', 'Leave this off and postings that need a move are skipped.'));
    out.push(h('div', { class: 'form-row' },
      textField(ui, w, 'international', 'International travel', 'When travel outside the US is OK.'),
      textField(ui, w, 'timeZones', 'Time zones', 'Hours in other time zones you can work.')));
    return out;
  }
  function stepPay(ui, w) {
    return [
      h('div', { class: 'form-row' },
        numField(ui, w, 'floorBase', 'Floor base', 'Lowest yearly base you will take, in dollars.', { placeholder: '83000', step: '1000' }),
        numField(ui, w, 'targetLow', 'Target low', 'The low end of the range you are aiming for.', { placeholder: '83000', step: '1000' }),
        numField(ui, w, 'targetHigh', 'Target high', 'The high end of that range.', { placeholder: '104000', step: '1000' })),
      h('div', { class: 'form-row' },
        numField(ui, w, 'hourlyFloor', 'Hourly floor', 'For contract work paid by the hour.', { placeholder: '40' }),
        numField(ui, w, 'hourlyTarget', 'Hourly target', 'The hourly rate you are aiming for.', { placeholder: '50' })),
      h('div', { class: 'form-row' },
        numField(ui, w, 'monthlyNeedLow', 'Monthly need, low', 'What covers the bills each month.', { placeholder: '6000', step: '100' }),
        numField(ui, w, 'monthlyNeedHigh', 'Monthly need, high', 'What covers the bills with some room.', { placeholder: '8000', step: '100' })),
      textField(ui, w, 'basis', 'Pay basis', 'How you want to be paid, in your words.', { placeholder: 'Base salary preferred; hourly contract OK if it covers the bills' }),
      textField(ui, w, 'bonusEquity', 'Bonus and equity', 'How bonus or equity counts, if at all.', { placeholder: 'Nice to have, never counted toward the floor' }),
    ];
  }
  function stepWorkTypes(ui, w) {
    var d = w.draft;
    return [
      h('div', { class: 'field tg-field', role: 'group', 'aria-labelledby': 'tg-l-emp' },
        h('span', { class: 'field-label', id: 'tg-l-emp' }, 'Employment types'),
        h('div', { class: 'tg-checks' }, EMPLOYMENT.map(function (t) {
          var id = 'tg-f-emp-' + t.v;
          return h('label', { class: 'check', for: id },
            h('input', {
              type: 'checkbox',
              id: id,
              checked: d.employmentTypes.indexOf(t.v) >= 0,
              onchange: function (ev) {
                var i = d.employmentTypes.indexOf(t.v);
                if (ev.target.checked && i < 0) d.employmentTypes.push(t.v);
                if (!ev.target.checked && i >= 0) d.employmentTypes.splice(i, 1);
              },
            }),
            h('span', null, t.w));
        })),
        h('p', { class: 'field-hint' }, 'Pick every kind of work you would take.')),
    ];
  }
  function stepDealBreakers(ui, w) {
    return [
      areaField(ui, w, 'dealBreakers', 'Deal-breakers', 'If a posting has one of these, it is out. Plain words, like commission-only pay.', 6),
    ];
  }
  function platformRows(state) {
    var rows = (state.platforms || []).slice();
    rows.sort(function (a, b) {
      var g = String(a.group || '').localeCompare(String(b.group || ''));
      if (g) return g;
      return String(a.name || a.id).localeCompare(String(b.name || b.id));
    });
    return rows;
  }
  function applyPlatformFilter(list, q) {
    q = String(q || '').trim().toLowerCase();
    var kids = list.children;
    var header = null;
    var headerHasVisible = false;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.classList.contains('tg-pgroup')) {
        if (header) header.hidden = !headerHasVisible;
        header = k;
        headerHasVisible = false;
        continue;
      }
      var show = !q || String(k.dataset.find || '').indexOf(q) >= 0;
      k.hidden = !show;
      if (show) headerHasVisible = true;
    }
    if (header) header.hidden = !headerHasVisible;
  }
  function stepPlatforms(ui, w, state) {
    var d = w.draft;
    var rows = platformRows(state);
    var selected = d.platformsSelected;
    function isSel(p) { return selected.indexOf(p.id) >= 0 || selected.indexOf(p.name) >= 0; }
    function countText() {
      var n = rows.filter(isSel).length;
      return n + ' of ' + rows.length + ' boards picked.';
    }
    var modes = [
      { v: 'all', w: 'All enabled boards', hint: 'Every board that is switched on gets scanned.' },
      { v: 'selected', w: 'Only the boards I pick', hint: 'Check the boards below. Everything else is skipped.' },
    ];
    var radios = h('div', { class: 'field tg-field', role: 'radiogroup', 'aria-labelledby': 'tg-l-pmode' },
      h('span', { class: 'field-label', id: 'tg-l-pmode' }, 'Which boards'),
      h('div', { class: 'tg-checks' }, modes.map(function (m) {
        var id = 'tg-f-pmode-' + m.v;
        return h('label', { class: 'check', for: id },
          h('input', {
            type: 'radio',
            name: 'tg-pmode',
            id: id,
            value: m.v,
            checked: d.platformsMode === m.v,
            onchange: function (ev) {
              if (!ev.target.checked) return;
              d.platformsMode = m.v;
              ui.tgFocus = id;
              CMC.rerender('targeting');
            },
          }),
          h('span', null, m.w));
      })),
      h('p', { class: 'field-hint' }, d.platformsMode === 'selected' ? modes[1].hint : modes[0].hint));
    if (d.platformsMode !== 'selected') return [radios];

    var count = h('p', { class: 'field-hint tg-pcount num' }, countText());
    var list = h('div', { class: 'tg-plist', role: 'group', 'aria-label': 'Boards to scan' });
    if (!rows.length) {
      list.appendChild(h('p', { class: 'tg-pnone' }, 'No boards are connected yet. They show up here once platforms sync.'));
    }
    var lastGroup = null;
    rows.forEach(function (p) {
      var g = String(p.group || 'Other');
      if (g !== lastGroup) {
        lastGroup = g;
        list.appendChild(h('div', { class: 'tg-pgroup' }, g));
      }
      var id = 'tg-p-' + p.id;
      var name = String(p.name || p.id);
      list.appendChild(h('label', {
        class: 'check tg-pcheck',
        for: id,
        dataset: { find: (name + ' ' + g).toLowerCase() },
      },
        h('input', {
          type: 'checkbox',
          id: id,
          checked: isSel(p),
          onchange: function (ev) {
            var i = selected.indexOf(p.id);
            var j = selected.indexOf(p.name);
            if (ev.target.checked) { if (i < 0 && j < 0) selected.push(p.id); }
            else {
              if (i >= 0) selected.splice(i, 1);
              j = selected.indexOf(p.name);
              if (j >= 0) selected.splice(j, 1);
            }
            count.textContent = countText();
          },
        }),
        h('span', { class: 'tg-pname' }, name),
        p.enabled ? null : h('span', { class: 'tg-poff' }, 'off')));
    });
    var search = h('input', {
      type: 'search',
      class: 'input',
      id: fid('platformQuery'),
      value: w.platformQuery || '',
      placeholder: 'Type part of a board name',
      autocomplete: 'off',
      oninput: function (ev) { w.platformQuery = ev.target.value; applyPlatformFilter(list, w.platformQuery); },
    });
    applyPlatformFilter(list, w.platformQuery);
    return [
      radios,
      h('div', { class: 'field tg-field' },
        h('label', { for: fid('platformQuery') }, 'Find a board'),
        search,
        count),
      list,
    ];
  }
  function stepScoring(ui, w) {
    var active = activeRow();
    var alreadyActive = w.mode === 'edit' && !!(active && active.id === w.slug);
    return [
      h('div', { class: 'form-row' },
        numField(ui, w, 'applyLine', 'Apply line', 'At or above this fit score, Claude preps an application.', { min: '0', max: '5', step: '0.1', placeholder: '4.0' }),
        numField(ui, w, 'considerLine', 'Consider line', 'Between the two lines, Claude flags it for you to decide.', { min: '0', max: '5', step: '0.1', placeholder: '3.0' })),
      areaField(ui, w, 'notes', 'Scoring notes', 'Anything Claude should keep in mind when it scores a posting.', 3),
      checkField(ui, w, 'makeActive', 'Make this the active profile',
        alreadyActive ? 'This profile is already in force.' : 'Switch to this profile as soon as it saves.',
        { disabled: alreadyActive }),
    ];
  }
  var STEPS = [
    { title: 'Name and summary', lead: 'Give this profile a name you will recognize in the dropdown.', fields: stepName },
    { title: 'Roles', lead: 'The job titles Claude hunts for, best fit first. One per line.', fields: stepRoles },
    { title: 'Words', lead: 'Words that pull a posting in, and words that throw it out.', fields: stepWords },
    { title: 'Where', lead: 'Where the work can be, and how far you will go.', fields: stepWhere },
    { title: 'Pay', lead: 'The money line. Postings under the floor are skipped.', fields: stepPay },
    { title: 'Work types', lead: 'The kinds of work you will take.', fields: stepWorkTypes },
    { title: 'Deal-breakers', lead: 'Anything that rules a posting out on sight.', fields: stepDealBreakers },
    { title: 'Platforms', lead: 'Which boards this profile scans.', fields: stepPlatforms },
    { title: 'Scoring', lead: 'Where the cutoff lines sit on the 5-point fit score.', fields: stepScoring },
  ];

  /* ---------------- wizard markup ------------------------------------------ */
  function rail(step) {
    return h('div', { class: 'tg-rail', role: 'img', 'aria-label': 'Step ' + step + ' of ' + STEPS.length },
      STEPS.map(function (s, i) {
        var n = i + 1;
        return h('i', { class: n < step ? 'is-done' : (n === step ? 'is-cur' : ''), title: s.title });
      }));
  }
  function confirmRow(ui) {
    return h('div', { class: 'tg-confirm', role: 'group', 'aria-label': 'Discard changes?' },
      h('span', { class: 'dot dot-warn', 'aria-hidden': 'true' }),
      h('span', { class: 'tg-confirm-t' }, 'Discard changes?'),
      h('button', { type: 'button', class: 'btn btn-danger', id: 'tgDiscardBtn', onclick: function () { closeWizard(ui); } }, 'Discard'),
      h('button', { type: 'button', class: 'btn btn-ghost', id: 'tgKeepBtn', onclick: function () { keepEditing(ui); } }, 'Keep editing'));
  }
  function wizard(state, ui) {
    var w = ui.tgWizard;
    var title;
    if (w.mode === 'edit') title = 'Edit ' + nameOf(w.carry);
    else if (w.mode === 'saveas') title = 'Save as a new profile';
    else title = 'New targeting profile';
    var step = STEPS[w.step - 1];
    var last = w.step === STEPS.length;
    return h('div', {
      class: 'overlay tg-overlay',
      onclick: function (ev) { if (ev.target === ev.currentTarget) requestClose(ui); },
    },
      h('div', { class: 'sheet tg-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tgWizTitle' },
        h('div', { class: 'panel-head tg-whead' },
          h('h2', { class: 'panel-title', id: 'tgWizTitle' }, title),
          h('span', { class: 'panel-kicker num' }, 'Step ' + w.step + ' of ' + STEPS.length),
          h('button', {
            type: 'button', class: 'btn btn-ghost close-x', id: 'tgCloseBtn',
            'aria-label': 'Close the profile form',
            onclick: function () { requestClose(ui); },
          }, xIcon())),
        h('div', { class: 'panel-body tg-wbody' },
          rail(w.step),
          h('div', { class: 'tg-stephead' },
            h('h3', { class: 'tg-steptitle' }, step.title),
            h('p', { class: 'tg-steplead' }, step.lead)),
          h('div', { class: 'tg-fields' }, step.fields(ui, w, state)),
          w.confirm ? confirmRow(ui) : null,
          h('div', { class: 'form-actions tg-foot' },
            w.step > 1 ? h('button', { type: 'button', class: 'btn btn-ghost', id: 'tgBackBtn', onclick: function () { back(ui); } }, 'Back') : null,
            h('span', { class: 'spacer' }),
            h('button', { type: 'button', class: 'btn btn-ghost', id: 'tgCancelBtn', onclick: function () { requestClose(ui); } }, 'Cancel'),
            last
              ? h('button', { type: 'button', class: 'btn btn-primary', id: 'tgSaveBtn', onclick: function () { save(ui, state); } }, 'Save')
              : h('button', { type: 'button', class: 'btn btn-primary', id: 'tgNextBtn', onclick: function () { next(ui); } }, 'Next')))));
  }

  /* ---------------- strip markup ------------------------------------------- */
  function chip(k, v, extraClass) {
    return h('span', { class: 'chip tg-chip' + (extraClass ? ' ' + extraClass : '') },
      h('span', { class: 'tg-k' }, k),
      h('span', { class: 'tg-v' }, v));
  }
  function contextChips(state, t) {
    var out = [];
    var primary = (t.roles && t.roles.primary) || [];
    primary.slice(0, 2).forEach(function (r) { out.push(chip('Role', String(r))); });
    var pay = payLine(t.pay);
    if (pay) out.push(chip('Pay', pay, 'num'));
    var pol = policyWord(t.location && t.location.policy);
    if (pol) out.push(chip('Where', pol));
    var n = platformCount(state, t);
    out.push(chip('Boards', n + (n === 1 ? ' platform' : ' platforms'), 'num'));
    return out;
  }
  function emptyStrip(ui, state) {
    return h('section', { class: 'panel tg-panel', 'aria-label': 'Targeting profile' },
      h('div', { class: 'tg-body tg-empty' },
        h('div', { class: 'tg-left' },
          h('div', { class: 'tg-kick' }, h('span', { class: 'panel-kicker' }, 'Targeting profile')),
          h('div', { class: 'tg-emptyrow' },
            scopeIcon(),
            h('div', null,
              h('h2', { class: 'tg-name' }, 'No targeting profile yet'),
              h('p', { class: 'tg-summary' }, 'A profile holds the rules of the search: roles, pay, where, and which boards. Make one and Claude scores every posting against it on the next scan.')))),
        h('div', { class: 'tg-right' },
          h('button', {
            type: 'button', class: 'btn btn-primary', id: 'tgEmptyNewBtn', 'aria-haspopup': 'dialog',
            onclick: function () { openWizard(ui, state, 'new', null, 'tgEmptyNewBtn'); },
          }, 'New profile'))));
  }
  function strip(state, ui) {
    var rows = (state.targeting || []).slice().sort(function (a, b) {
      return String(a.name || a.id).localeCompare(String(b.name || b.id));
    });
    var active = activeRow();
    if (!rows.length || !active) return emptyStrip(ui, state);
    var pick = pickedSlug(state, ui);
    var picked = findRow(state, pick) || active;
    var isActivePick = pick === active.id;
    var chips = contextChips(state, active);

    var select = h('select', {
      id: 'tgPick',
      onchange: function (ev) { ui.tgPick = ev.target.value; CMC.rerender('targeting'); },
    }, rows.map(function (r) {
      return h('option', { value: r.id, selected: r.id === pick }, nameOf(r) + (r.id === active.id ? ' (in force)' : ''));
    }));

    return h('section', { class: 'panel tg-panel', 'aria-label': 'Targeting profile' },
      h('div', { class: 'tg-body' },
        h('div', { class: 'tg-left' },
          h('div', { class: 'tg-kick' },
            h('span', { class: 'panel-kicker' }, 'Targeting profile'),
            h('span', { class: 'tg-force' }, h('span', { class: 'dot dot-good' }), 'in force')),
          h('h2', { class: 'tg-name' }, nameOf(active)),
          active.summary ? h('p', { class: 'tg-summary' }, String(active.summary)) : null,
          chips.length ? h('div', { class: 'tg-chips' }, chips) : null),
        h('div', { class: 'tg-right' },
          h('div', { class: 'tg-pickrow' },
            h('div', { class: 'field tg-pick' },
              h('label', { for: 'tgPick' }, 'Profile'),
              h('span', { class: 'select-wrap' }, select)),
            h('button', {
              type: 'button', class: 'btn tg-switch' + (isActivePick ? '' : ' btn-primary'), id: 'tgSwitchBtn',
              disabled: isActivePick || !!ui.tgBusy,
              title: isActivePick ? nameOf(active) + ' is already in force. Pick another profile to switch.' : 'Make ' + nameOf(picked) + ' the profile in force',
              onclick: function () { onSwitch(ui, state); },
            }, ui.tgBusy ? 'Switching...' : 'Switch')),
          isActivePick ? null : h('p', { class: 'tg-pickhint' },
            h('span', { class: 'dot dot-idle' }),
            nameOf(picked) + ' is not in force. Switch changes the rules, not the data.'),
          h('div', { class: 'tg-btns' },
            h('button', { type: 'button', class: 'btn btn-ghost', id: 'tgNewBtn', 'aria-haspopup': 'dialog', onclick: function () { openWizard(ui, state, 'new', null, 'tgNewBtn'); } }, 'New profile'),
            h('button', { type: 'button', class: 'btn btn-ghost', id: 'tgEditBtn', 'aria-haspopup': 'dialog', title: 'Edit ' + nameOf(picked), onclick: function () { openWizard(ui, state, 'edit', pick, 'tgEditBtn'); } }, 'Edit'),
            h('button', { type: 'button', class: 'btn btn-ghost', id: 'tgSaveAsBtn', 'aria-haspopup': 'dialog', title: 'Copy ' + nameOf(active) + ' into a new profile', onclick: function () { openWizard(ui, state, 'saveas', null, 'tgSaveAsBtn'); } }, 'Save as'),
            h('button', { type: 'button', class: 'btn btn-ghost', id: 'tgResetBtn', title: 'Back to the saved version of ' + nameOf(picked), onclick: function () { onReset(ui, state); } }, 'Reset')))));
  }

  /* ---------------- render -------------------------------------------------- */
  /* The wizard overlay is position: fixed, but main is its own stacking
     context under the sticky command bar, so the overlay mounts on body
     (one host element this piece owns) instead of inside the slot. */
  var overlayHost = null;
  function mountOverlay(node) {
    if (overlayHost && overlayHost.parentNode) overlayHost.parentNode.removeChild(overlayHost);
    overlayHost = null;
    if (!node) return;
    overlayHost = h('div', { id: 'tgOverlayHost', 'data-panel-host': 'targeting' }, node);
    document.body.appendChild(overlayHost);
  }
  var FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  /* ui.sheetOpen is the flag every sheet raises for the rest of the page;
     only the piece that raised it lowers it, so a sheet that opened on top
     of this one keeps its own flag when the wizard closes */
  var raisedSheetFlag = false;
  function syncSheetFlag(ui) {
    if (ui.tgWizard) {
      if (!raisedSheetFlag && !ui.sheetOpen) { ui.sheetOpen = true; raisedSheetFlag = true; }
    } else if (raisedSheetFlag) {
      ui.sheetOpen = false;
      raisedSheetFlag = false;
    }
  }

  /* The wizard answers Escape, Enter and Tab only while it is the top-most
     thing on the page. Another modal (a sheet, the job drawer, a calendar
     popover) is above it when its stacking context carries a higher z-index,
     or the same one and it comes later in the document. */
  function zChain(el) {
    var out = [];
    for (var n = el; n && n !== document.body && n.nodeType === 1; n = n.parentNode) {
      var cs = getComputedStyle(n);
      if (cs.position !== 'static' && cs.zIndex !== 'auto') out.unshift(parseInt(cs.zIndex, 10) || 0);
    }
    return out;
  }
  function paintsAbove(a, b) {
    var za = zChain(a), zb = zChain(b);
    for (var i = 0; i < za.length && i < zb.length; i++) {
      if (za[i] !== zb[i]) return za[i] > zb[i];
    }
    return !!(b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);
  }
  function wizardOnTop() {
    var mine = overlayHost && overlayHost.querySelector('.tg-sheet');
    if (!mine) return false;
    var els = document.querySelectorAll('[aria-modal="true"], .cal-pop');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el === mine || el.hidden || mine.contains(el)) continue;
      var r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && paintsAbove(el, mine)) return false;
    }
    return true;
  }

  function wireOnce() {
    if (document.__tgEscWired) return;
    document.__tgEscWired = true;
    document.addEventListener('keydown', function (ev) {
      var w = CMC.ui.tgWizard;
      if (!w || ev.defaultPrevented) return;
      if (ev.key !== 'Escape' && ev.key !== 'Enter' && ev.key !== 'Tab') return;
      if (!wizardOnTop()) return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        if (w.confirm) keepEditing(CMC.ui);
        else requestClose(CMC.ui);
        return;
      }
      var t = ev.target;
      var inside = !!(overlayHost && t && overlayHost.contains(t));
      /* Enter in a one-line box moves on, like a form would */
      if (ev.key === 'Enter' && inside && t.tagName === 'INPUT' && (t.type === 'text' || t.type === 'number')) {
        ev.preventDefault();
        if (w.step === STEPS.length) save(CMC.ui, CMC.state);
        else next(CMC.ui);
        return;
      }
      /* keep Tab inside the sheet while it is open */
      if (ev.key === 'Tab' && overlayHost) {
        var list = Array.prototype.slice.call(overlayHost.querySelectorAll(FOCUSABLE)).filter(function (x) { return x.offsetParent !== null; });
        if (!list.length) return;
        var first = list[0];
        var last = list[list.length - 1];
        if (!inside) { ev.preventDefault(); first.focus(); return; }
        if (ev.shiftKey && t === first) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && t === last) { ev.preventDefault(); first.focus(); }
      }
    });
  }
  function inOwn(node, el) {
    return !!node && (el.contains(node) || (overlayHost && overlayHost.contains(node)));
  }
  function render(el, state, ui) {
    wireOnce();
    if (ui.tgPick && !findRow(state, ui.tgPick)) ui.tgPick = null;
    /* an edit of a profile that vanished under us (cleared elsewhere) closes */
    if (ui.tgWizard && ui.tgWizard.mode === 'edit' && !findRow(state, ui.tgWizard.slug)) {
      ui.tgWizard = null;
      ui.tgDraft = null;
    }
    syncSheetFlag(ui);

    /* keep the caret where it was when a live update redraws the strip or
       the form under Chris's hands; ui.tgFocus wins when a handler set it */
    var keepId = ui.tgFocus || null;
    ui.tgFocus = null;
    var sel = null;
    var ae = document.activeElement;
    if (ae && ae.id && inOwn(ae, el)) {
      if (!keepId) keepId = ae.id;
      /* same box either way (a live poll, or an error clearing under the
         caret): keep the caret where it was, not at the end */
      if (keepId === ae.id) {
        try { if (typeof ae.selectionStart === 'number') sel = [ae.selectionStart, ae.selectionEnd]; } catch (e) { sel = null; }
      }
    }

    el.textContent = '';
    el.appendChild(strip(state, ui));
    mountOverlay(ui.tgWizard ? wizard(state, ui) : null);

    var w = ui.tgWizard;
    if (w && w.focusFirst) {
      w.focusFirst = false;
      var first = overlayHost && overlayHost.querySelector('.tg-fields input:not([disabled]), .tg-fields select, .tg-fields textarea');
      if (first) first.focus();
    } else if (keepId) {
      var k = document.getElementById(keepId);
      if (k && inOwn(k, el)) {
        k.focus();
        if (sel) { try { k.setSelectionRange(sel[0], sel[1]); } catch (e2) { /* not a text control */ } }
      }
    }
  }

  CMC.register('targeting', { render: render });
})();
