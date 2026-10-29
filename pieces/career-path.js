/* piece: career-path: The target. Headline, comp, and guardrails from
   state.profile, target roles grouped in plain words, superpowers with
   check marks, and this week's goals with real numbers from state.goals.
   Goal rows log +1 through CMC.act.bumpGoal with an inline 5-second undo
   whose open state lives in CMC.ui.cpUndo. Reads CMC.state only; all data
   rendered through CMC.h text nodes. */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var UNDO_MS = 5000;
  var undoTimer = null;

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
  function checkIcon() { return icon(13, [['polyline', { points: '4.5 12.5 9.5 17.5 19.5 6.5' }]]); }
  function plusIcon() {
    return icon(14, [
      ['line', { x1: 12, y1: 5, x2: 12, y2: 19 }],
      ['line', { x1: 5, y1: 12, x2: 19, y2: 12 }],
    ]);
  }
  function undoIcon() {
    return icon(13, [
      ['polyline', { points: '9 14 4 9 9 4' }],
      ['path', { d: 'M4 9h10a6 6 0 0 1 0 12h-3' }],
    ]);
  }

  /* dollar amounts inside the comp sentence become mono spans; everything
     else stays plain text nodes */
  function compLine(text) {
    text = String(text || '');
    var re = /\$\d+(?:\.\d+)?K?/g;
    var kids = [];
    var last = 0;
    var m;
    while ((m = re.exec(text))) {
      if (m.index > last) kids.push(text.slice(last, m.index));
      kids.push(CMC.h('span', { class: 'cp-money' }, m[0]));
      last = m.index + m[0].length;
    }
    if (last < text.length) kids.push(text.slice(last));
    return kids.length ? kids : [text];
  }

  function sectionLabel(text) {
    return CMC.h('span', { class: 'cp-label' }, text);
  }

  /* --- the active targeting profile, when one exists ------------------------ */
  /* The target reads roles, comp and guardrails from the targeting profile
     in force (CMC.activeTargeting) and falls back to profile/main only when
     no targeting row exists. */
  function activeTargeting() {
    return typeof CMC.activeTargeting === 'function' ? CMC.activeTargeting() : null;
  }
  function policyWord(v) {
    switch (String(v || '')) {
      case 'remote-only': return 'Remote only';
      case 'remote-first': return 'Remote first';
      case 'hybrid-ok': return 'Hybrid OK';
      case 'onsite-ok': return 'On-site OK';
      default: return v ? String(v) : '';
    }
  }
  function targetingComp(t) {
    var pay = (t && t.pay) || {};
    var money = CMC.fmt.money;
    var floor = typeof pay.floorBase === 'number' ? money(pay.floorBase) : '';
    var lo = typeof pay.targetLow === 'number' ? money(pay.targetLow) : '';
    var hi = typeof pay.targetHigh === 'number' ? money(pay.targetHigh) : '';
    var parts = [];
    if (floor) parts.push('Floor ' + floor + ' base.');
    if (lo && hi) parts.push('Target ' + lo + ' to ' + hi + '.');
    else if (lo || hi) parts.push('Target ' + (lo || hi) + '.');
    return parts.join(' ');
  }
  function targetingGuards(t) {
    var out = [];
    var pol = policyWord(t && t.location && t.location.policy);
    if (pol) out.push(pol);
    ((t && t.dealBreakers) || []).slice(0, 3).forEach(function (d) {
      var s = String(d || '').trim();
      if (s) out.push('No ' + s);
    });
    return out;
  }

  /* --- intro: headline, comp, guardrail chips ----------------------------- */
  function introBlock(profile) {
    var t = activeTargeting();
    if (!profile && !t) {
      return CMC.h('div', { class: 'cp-head' },
        CMC.h('p', { class: 'cp-empty' },
          'Your profile has not synced yet. The headline, pay target, and target roles will show here.'));
    }
    profile = profile || {};
    var guards = t ? targetingGuards(t) : String(profile.guardrails || '')
      .split('·')
      .map(function (g) { return g.trim(); })
      .filter(function (g) { return g.length > 0; });
    var comp = t ? targetingComp(t) : profile.compTarget;
    return CMC.h('div', { class: 'cp-head' },
      profile.headline ? CMC.h('p', { class: 'cp-headline' }, profile.headline) : null,
      comp ? CMC.h('p', { class: 'cp-comp' }, compLine(comp)) : null,
      guards.length ? CMC.h('div', { class: 'cp-guards', 'aria-label': 'Ground rules for the search' },
        guards.map(function (g) {
          return CMC.h('span', { class: 'chip cp-guard' }, g);
        })) : null);
  }

  /* --- target roles grouped in plain words -------------------------------- */
  var FIT_GROUPS = [
    { fit: 'primary', label: 'Best fit', cls: ' cp-role-best' },
    { fit: 'secondary', label: 'Backup plan', cls: '' },
    { fit: 'adjacent', label: 'Side income', cls: ' cp-role-side' },
  ];
  function bucketOf(fit) {
    if (fit === 'primary') return 'primary';
    if (fit === 'adjacent') return 'adjacent';
    return 'secondary';
  }
  function rolesSection(profile) {
    var t = activeTargeting();
    var byFit = { primary: [], secondary: [], adjacent: [] };
    if (t) {
      var tr = t.roles || {};
      ['primary', 'secondary', 'adjacent'].forEach(function (fit) {
        (Array.isArray(tr[fit]) ? tr[fit] : []).forEach(function (r) {
          var s = String(r || '').trim();
          if (s) byFit[fit].push(s);
        });
      });
    } else {
      var roles = (profile && profile.targetRoles) || [];
      roles.forEach(function (r) {
        if (r && r.role) byFit[bucketOf(r.fit)].push(String(r.role));
      });
    }
    if (!byFit.primary.length && !byFit.secondary.length && !byFit.adjacent.length) return null;
    var groups = FIT_GROUPS.map(function (g) {
      var list = byFit[g.fit];
      if (!list.length) return null;
      return CMC.h('div', { class: 'cp-role-group' },
        sectionLabel(g.label),
        CMC.h('div', { class: 'cp-chips' }, list.map(function (role) {
          return CMC.h('span', { class: 'chip cp-role' + g.cls }, role);
        })));
    });
    return CMC.h('div', { class: 'cp-sect cp-roles', 'aria-label': 'Target roles' }, groups);
  }

  /* --- superpowers --------------------------------------------------------- */
  function superpowersSection(profile) {
    var sp = (profile && profile.superpowers) || [];
    if (!sp.length) return null;
    return CMC.h('div', { class: 'cp-sect' },
      sectionLabel('Superpowers'),
      CMC.h('ul', { class: 'cp-sp' }, sp.slice(0, 4).map(function (s) {
        return CMC.h('li', null, checkIcon(), CMC.h('span', null, String(s)));
      })));
  }

  /* --- this week's goals --------------------------------------------------- */
  /* Phones fire quick double taps. One tap must mean exactly one action, so
     each goal ignores a second tap inside 450ms: a jittery double tap on a
     goal logs +1 once, and after an undo the row that slides up under the
     finger cannot swallow the tap as a fresh +1. A deliberate second tap a
     beat later still logs another one. */
  var TAP_GUARD_MS = 450;
  var lastTap = {};
  function tapAllowed(goalId) {
    var now = Date.now();
    if (lastTap[goalId] && now - lastTap[goalId] < TAP_GUARD_MS) return false;
    lastTap[goalId] = now;
    return true;
  }
  function clearUndo() {
    if (undoTimer) { clearTimeout(undoTimer); undoTimer = null; }
    CMC.ui.cpUndo = null;
  }
  function armUndo(goalId) {
    if (undoTimer) clearTimeout(undoTimer);
    CMC.ui.cpUndo = goalId;
    undoTimer = setTimeout(function () {
      undoTimer = null;
      if (CMC.ui.cpUndo) {
        CMC.ui.cpUndo = null;
        CMC.rerender('career-path');
      }
    }, UNDO_MS);
  }
  function logOne(goal) {
    if (!tapAllowed(goal.id)) return;
    armUndo(goal.id);
    CMC.act.bumpGoal(goal.id, 1);
  }
  function undoOne(goal) {
    lastTap[goal.id] = Date.now();
    clearUndo();
    CMC.act.bumpGoal(goal.id, -1);
  }

  function goalRow(goal, ui) {
    var name = String(goal.goal || '');
    var done = typeof goal.done === 'number' ? goal.done : 0;
    var target = typeof goal.target === 'number' ? goal.target : 0;
    var pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : (done > 0 ? 100 : 0);
    var full = target > 0 && done >= target;
    var undoOpen = ui.cpUndo === goal.id;

    var row = CMC.h('button', {
      type: 'button',
      class: 'cp-goal-btn',
      'aria-label': name + ', ' + done + ' of ' + target + ' done. Tap to log one more.',
      onclick: function () { logOne(goal); },
    },
      CMC.h('div', { class: 'cp-goal-top' },
        CMC.h('span', { class: 'cp-goal-name' }, name),
        CMC.h('span', { class: 'cp-goal-count mono' + (full ? ' is-done' : '') }, done + '/' + target),
        CMC.h('span', { class: 'cp-plus' }, plusIcon())),
      CMC.h('div', {
        class: 'cp-bar',
        role: 'img',
        'aria-label': pct + ' percent of the weekly target',
      },
        CMC.h('i', {
          class: 'cp-fill' + (full ? ' is-done' : ''),
          style: { width: pct + '%' },
        })));

    var undo = undoOpen ? CMC.h('button', {
      type: 'button',
      class: 'cp-undo',
      'aria-label': 'Undo the one you just logged for ' + name,
      onclick: function () { undoOne(goal); },
    }, undoIcon(), '+1 logged, tap to undo') : null;

    return CMC.h('li', { class: 'cp-goal' }, row, undo);
  }

  function goalsSection(state, ui) {
    var goals = (state.goals || []).slice();
    goals.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });

    var body;
    if (!goals.length) {
      body = CMC.h('p', { class: 'cp-empty' },
        'No goals set for this week yet. They will show up when the tracker syncs.');
    } else {
      body = [
        CMC.h('ul', { class: 'cp-goals' }, goals.map(function (g) { return goalRow(g, ui); })),
        CMC.h('p', { class: 'cp-goal-hint' }, 'Tap a goal to log one more.'),
      ];
    }

    var totalDone = 0;
    var totalTarget = 0;
    goals.forEach(function (g) {
      totalDone += typeof g.done === 'number' ? g.done : 0;
      totalTarget += typeof g.target === 'number' ? g.target : 0;
    });

    return CMC.h('div', { class: 'cp-sect' },
      CMC.h('div', { class: 'cp-label-row' },
        sectionLabel('This week\'s goals'),
        goals.length ? CMC.h('span', { class: 'cp-sum mono' }, totalDone + '/' + totalTarget + ' this week') : null),
      body);
  }

  /* --- render -------------------------------------------------------------- */
  function render(el, state, ui) {
    /* drop a stale undo if its goal vanished (sample data cleared, etc.) */
    if (ui.cpUndo) {
      var alive = (state.goals || []).some(function (g) { return g.id === ui.cpUndo; });
      if (!alive) clearUndo();
    }

    el.textContent = '';
    el.appendChild(CMC.h('div', { class: 'panel cp-panel' },
      CMC.h('div', { class: 'panel-head' },
        CMC.h('h2', { class: 'panel-title' }, 'The target'),
        CMC.h('span', { class: 'panel-kicker' }, 'the plan')),
      CMC.h('div', { class: 'panel-body cp-body' },
        introBlock(state.profile),
        rolesSection(state.profile),
        superpowersSection(state.profile),
        goalsSection(state, ui))));
  }

  CMC.register('career-path', { render: render });
})();
