/* Career Mission Control - panel "kpis": the At-a-glance briefing line plus
   the floating KPI deck. Reads CMC.state only; UI state lives in CMC.ui. */
(function () {
  'use strict';
  var CMC = window.CMC;
  if (!CMC) return;
  var h = CMC.h;
  var fmt = CMC.fmt;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var DAY = 864e5;
  var WINDOW = 14;
  var APP_TITLE = 'Career Ops Mission Control';

  /* ---------------- tiny helpers ---------------------------------------- */
  function s(tag, attrs) {
    var el = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }
  function st(x, y, anchor, cls, str) {
    var el = s('text', { x: x, y: y, 'text-anchor': anchor, 'class': cls });
    el.textContent = str;
    return el;
  }
  function ts(x) {
    if (!x) return null;
    var t = new Date(x).getTime();
    return isNaN(t) ? null : t;
  }
  /* interviews docs store date as YYYY-MM-DD and time as HH:MM. Build the
     moment in local time so Oct 13 never turns into Oct 12 west of UTC. */
  function localTs(date, time) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || '').trim());
    if (!m) return ts(date);
    var hm = /^(\d{1,2}):(\d{2})/.exec(String(time || '').trim());
    var d = new Date(+m[1], +m[2] - 1, +m[3], hm ? +hm[1] : 0, hm ? +hm[2] : 0);
    var t = d.getTime();
    return isNaN(t) ? null : t;
  }
  function lastDays(n) {
    var out = [], now = new Date();
    for (var i = n - 1; i >= 0; i--) out.push(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
    return out;
  }
  function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
  function dayEnd(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(); }
  function dayLabel(d) { return fmt.date(d.toISOString()); }
  function cumulative(days, times) {
    return days.map(function (d) {
      var end = dayEnd(d), n = 0;
      for (var i = 0; i < times.length; i++) if (times[i] !== null && times[i] < end) n++;
      return n;
    });
  }
  function between(times, from, to) {
    var n = 0;
    for (var i = 0; i < times.length; i++) if (times[i] !== null && times[i] >= from && times[i] < to) n++;
    return n;
  }
  function maxOf(arr) {
    var m = 0;
    for (var i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
    return m;
  }
  function count(n) { return String(n); }
  function pct(v) { return Math.round(v) + '%'; }
  function oneDec(v) { return (Math.round(v * 10) / 10).toFixed(1); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function findApp(apps, id) {
    for (var i = 0; i < apps.length; i++) if (apps[i].id === id) return apps[i];
    return null;
  }
  /* "in 3 days", "today", "tomorrow": a date with its distance */
  function daysAway(t, now) {
    var d = Math.round((dayStart(new Date(t)) - dayStart(new Date(now))) / DAY);
    if (d <= 0) return 'today';
    if (d === 1) return 'tomorrow';
    return 'in ' + d + ' days';
  }

  var IN_FLIGHT = { Applied: 1, Responded: 1 };
  var SENT = { Applied: 1, Responded: 1, Interview: 1, Offer: 1, Hired: 1, Rejected: 1 };
  var ANSWERED = { Responded: 1, Interview: 1, Offer: 1, Hired: 1, Rejected: 1 };

  /* ---------------- derive everything from state ------------------------- */
  function compute(state) {
    var apps = state.applications || [];
    var queue = state.queue || [];
    var goals = state.goals || [];
    var platforms = state.platforms || [];
    var interviews = state.interviews || [];
    var inbox = state.inbox || [];
    var days = lastDays(WINDOW);
    var now = Date.now();
    var weekAgo = now - 7 * DAY;
    var twoWeeksAgo = now - 14 * DAY;
    var weekAhead = now + 7 * DAY;
    var today = dayStart(new Date(now));
    var i, t;

    var sentApps = apps.filter(function (a) { return SENT[a.status] && ts(a.dateApplied) !== null; });
    var sentTimes = sentApps.map(function (a) { return ts(a.dateApplied); });
    var inflightApps = apps.filter(function (a) { return IN_FLIGHT[a.status]; });
    var inflightTimes = [];
    inflightApps.forEach(function (a) { var x = ts(a.dateApplied); if (x !== null) inflightTimes.push(x); });
    var interviewApps = apps.filter(function (a) { return a.status === 'Interview'; });
    /* Offers means offers on the table: Hired is a win, not an open offer,
       so it is counted apart and shown under the tile as "1 hired" */
    var offerApps = apps.filter(function (a) { return a.status === 'Offer'; });
    var hiredApps = apps.filter(function (a) { return a.status === 'Hired'; });
    var scored = apps.filter(function (a) { return typeof a.score === 'number' && !isNaN(a.score); });

    /* weekly application goal (Career Ops cadence) */
    var goal = null;
    for (i = 0; i < goals.length; i++) {
      if (goals[i].id === 'apps' || /application/i.test(String(goals[i].goal || ''))) { goal = goals[i]; break; }
    }
    var weekSends = 0;
    sentTimes.forEach(function (x) { if (x >= weekAgo) weekSends++; });
    /* the goal counter is what Claude bumps on each send; if it lags the
       real dateApplied stamps, the real count wins so the tile can never
       say 0 while its own delta chip says +2 */
    var appsDone = goal && typeof goal.done === 'number' ? Math.max(goal.done, weekSends) : weekSends;
    var appsTarget = goal && typeof goal.target === 'number' ? goal.target : null;

    /* interviews: every interview number on this panel reads the same
       bookings the Next deadline tile reads. For each app that is at the
       interview stage, the moment is the soonest upcoming interviews doc
       with that appId (what Needs You and the calendar write), and the
       app's own nextDate is the fallback. Past dates are kept separately
       so a row can say "was Oct 1" instead of pretending nothing is set. */
    var ivDocs = {};
    interviews.forEach(function (iv) {
      if (!iv.appId) return;
      var x = localTs(iv.date, iv.time);
      var made = ts(iv.createdAt);
      var slot = ivDocs[iv.appId] || (ivDocs[iv.appId] = { next: null, last: null, bookedAt: null });
      if (made !== null && (slot.bookedAt === null || made < slot.bookedAt)) slot.bookedAt = made;
      if (x === null) return;
      var m = { t: x, hasTime: !!iv.time };
      if (x >= today) { if (!slot.next || x < slot.next.t) slot.next = m; }
      else if (!slot.last || x > slot.last.t) slot.last = m;
    });
    function appMoment(a) {
      var x = ts(a.nextDate);
      var own = x !== null ? { t: x, hasTime: /T\d\d:\d\d/.test(String(a.nextDate)) && !/T00:00/.test(String(a.nextDate)) } : null;
      var slot = ivDocs[a.id] || { next: null, last: null };
      var next = slot.next;
      if (own && own.t >= today && (!next || own.t < next.t)) next = own;
      var last = slot.last;
      if (own && own.t < today && (!last || own.t > last.t)) last = own;
      return { next: next, last: last };
    }
    var nextIv = null, nextIvT = null, nextIvHasTime = false;
    var ivThisWeek = 0;
    var ivRows = interviewApps.map(function (a) {
      var m = appMoment(a);
      if (m.next) {
        if (nextIvT === null || m.next.t < nextIvT) { nextIv = a; nextIvT = m.next.t; nextIvHasTime = m.next.hasTime; }
        if (m.next.t <= weekAhead) ivThisWeek++;
      }
      return { app: a, next: m.next, last: m.last };
    });
    ivRows.sort(function (p, q) {
      var a = p.next ? p.next.t : Infinity, b = q.next ? q.next.t : Infinity;
      return a - b;
    });

    /* response rate */
    var answered = sentApps.filter(function (a) { return ANSWERED[a.status]; });
    var ratePct = sentApps.length ? Math.round(100 * answered.length / sentApps.length) : 0;
    var rateSeries = days.map(function (d) {
      var end = dayEnd(d), out = 0, ans = 0;
      sentApps.forEach(function (a) {
        var x = ts(a.dateApplied);
        if (x !== null && x < end) { out++; if (ANSWERED[a.status]) ans++; }
      });
      return out ? Math.round(100 * ans / out) : 0;
    });

    /* fit score */
    var fitSum = 0;
    scored.forEach(function (a) { fitSum += a.score; });
    var fitAvg = scored.length ? fitSum / scored.length : 0;
    var fitSeries = days.map(function (d) {
      var end = dayEnd(d), sum = 0, n = 0;
      scored.forEach(function (a) {
        var x = ts(a.dateFound);
        if (x !== null && x < end) { sum += a.score; n++; }
      });
      return n ? sum / n : 0;
    });
    /* band colors live in CSS classes so themes where two status tokens
       share a hue (amber accent + amber warn in dark ops, green accent +
       green good in field green) can still tell the bands apart */
    var bands = [
      { name: 'Strong match', range: '4.5+', cls: 'kxb-strong', n: 0 },
      { name: 'Good match', range: '4.0 to 4.4', cls: 'kxb-good', n: 0 },
      { name: 'Borderline', range: '3.5 to 3.9', cls: 'kxb-edge', n: 0 },
      { name: 'Weak', range: 'under 3.5', cls: 'kxb-weak', n: 0 }
    ];
    scored.forEach(function (a) {
      if (a.score >= 4.5) bands[0].n++;
      else if (a.score >= 4) bands[1].n++;
      else if (a.score >= 3.5) bands[2].n++;
      else bands[3].n++;
    });

    /* interview + offer moments come from the same rows the tiles count,
       never from the mission log: a log line can outlive a deleted
       booking or belong to a company with no application, and then the
       chip would say +2 under a tile that says 1. The moment an app
       reached the stage is its first booking (createdAt), else the
       status stamp. Apps with neither still count in the value and are
       simply dateless for the trend. */
    var ivTimes = [], offerTimes = [];
    interviewApps.forEach(function (a) {
      var slot = ivDocs[a.id];
      var x = slot && slot.bookedAt !== null ? slot.bookedAt : ts(a.statusChangedAt);
      if (x !== null) ivTimes.push(x);
    });
    offerApps.forEach(function (a) {
      var x = ts(a.statusChangedAt);
      if (x !== null) offerTimes.push(x);
    });

    /* week-over-week deltas, all from the same series the sparklines use */
    function delta(times) {
      var cur = between(times, weekAgo, now + DAY);
      var prev = between(times, twoWeeksAgo, weekAgo);
      return (cur || prev) ? { now: cur, prev: prev } : null;
    }

    /* best base pay among offers: read through the shared pay reader so
       "$125,000 - $163,000", "$80k - $160k" and "$58/hr" all count; the
       best offer is the one with the highest top end, then the highest
       floor */
    var best = null;
    offerApps.forEach(function (a) {
      var p = CMC.pay.read(a.pay);
      if (!p) return;
      if (!best || p.high > best.high || (p.high === best.high && p.low > best.low)) {
        best = { low: p.low, high: p.high, text: CMC.pay.short(p), company: a.company || '' };
      }
    });

    /* follow-ups (the Aging 7d+ list): applied over a week ago, still no
       answer, and no follow-up already sent in the last 7 days */
    var agingApps = [];
    apps.forEach(function (a) {
      var x = ts(a.dateApplied);
      if (a.status !== 'Applied' || x === null || x >= weekAgo) return;
      var f = ts(a.lastFollowUp);
      if (f !== null && f >= weekAgo) return;
      agingApps.push(a);
    });
    agingApps.sort(function (a, b) { return ts(a.dateApplied) - ts(b.dateApplied); });
    var followups = agingApps.length;

    var queued = 0;
    queue.forEach(function (q) { if (q.state !== 'submitted') queued++; });
    /* a match is an Evaluated app with no live queue doc, read through
       CMC.queueFor (a submitted doc is finished business, so the app is
       back on the board), the same reader the pipeline New pill, the
       tracker New chip and the drawer use, so one screen never shows two
       numbers for the same idea */
    var matches = 0;
    apps.forEach(function (a) { if (a.status === 'Evaluated' && !CMC.queueFor(a.id)) matches++; });

    /* what waits on Chris (queue items prepped and ready, plus open decide
       and approve tasks) comes from foundation, so the tab title, the
       briefing, the summary sentence, Needs you and the Apply queue all
       show one number for the same idea */
    var waiting = CMC.needsChris();

    var connected = 0;
    platforms.forEach(function (p) { if (p.enabled !== false) connected++; });
    /* honest coverage: a board counts only with a reachable check AND a
       real scan on record */
    /* honest coverage, the same test Intel sources uses: enabled, with a
       reachable check AND a real scan on record */
    var producing = platforms.filter(function (p) { return p.enabled !== false && p.health === 'reachable' && !!p.lastScan; });
    producing.sort(function (a, b) { return (ts(b.lastScan) || 0) - (ts(a.lastScan) || 0); });

    /* job inbox: links found by scans, not yet looked at. A row with no
       state yet is pending, the same way the Job inbox panel counts it. */
    var pending = inbox.filter(function (r) { return r.state === 'pending' || !r.state; });
    var inboxCareer = 0, inboxStack = 0;
    pending.forEach(function (r) {
      if (r.lane === 'career') inboxCareer++;
      else if (r.lane === 'stack') inboxStack++;
    });

    /* next deadline: the soonest upcoming interview event or application
       next step, today included */
    var deadlines = [];
    interviews.forEach(function (iv) {
      var x = localTs(iv.date, iv.time);
      if (x === null) return;
      var app = iv.appId ? findApp(apps, iv.appId) : null;
      deadlines.push({
        t: x,
        hasTime: !!iv.time,
        company: iv.company || (app && app.company) || '',
        role: iv.role || (app && app.role) || '',
        round: iv.round || 'Interview',
        kind: 'ivl'
      });
    });
    apps.forEach(function (a) {
      var x = ts(a.nextDate);
      if (x === null) return;
      deadlines.push({
        t: x,
        hasTime: /T\d\d:\d\d/.test(String(a.nextDate)) && !/T00:00/.test(String(a.nextDate)),
        company: a.company || '',
        role: a.role || '',
        round: a.round || (a.status === 'Interview' ? 'Interview' : 'Next step'),
        kind: a.status === 'Interview' ? 'ivl' : CMC.statusKind(a.status)
      });
    });
    deadlines = deadlines.filter(function (d) { return d.t >= today; });
    deadlines.sort(function (a, b) { return a.t - b.t; });
    var nextDl = deadlines.length ? deadlines[0] : null;

    var firstT = null;
    apps.forEach(function (a) {
      var x = ts(a.dateFound);
      if (x !== null && (firstT === null || x < firstT)) firstT = x;
    });
    var weeks = firstT !== null ? Math.max(1, Math.round((now - firstT) / (7 * DAY))) : 0;

    return {
      days: days,
      now: now,
      apps: apps,
      sentApps: sentApps,
      inflightApps: inflightApps,
      interviewApps: interviewApps,
      offerApps: offerApps,
      hiredApps: hiredApps,
      scored: scored,
      appsSeries: cumulative(days, sentTimes),
      inflightSeries: cumulative(days, inflightTimes),
      ivSeries: cumulative(days, ivTimes),
      offerSeries: cumulative(days, offerTimes),
      appsDelta: delta(sentTimes),
      ivDelta: delta(ivTimes),
      offerDelta: delta(offerTimes),
      rateSeries: rateSeries,
      fitSeries: fitSeries,
      bands: bands,
      appsDone: appsDone,
      appsTarget: appsTarget,
      weekSends: weekSends,
      nextIv: nextIv,
      nextIvT: nextIvT,
      nextIvHasTime: nextIvHasTime,
      ivRows: ivRows,
      ivThisWeek: ivThisWeek,
      answered: answered.length,
      sentCount: sentApps.length,
      ratePct: ratePct,
      fitAvg: fitAvg,
      best: best,
      followups: followups,
      agingApps: agingApps,
      ready: waiting.ready,
      decisions: waiting.decisions,
      queued: queued,
      matches: matches,
      needsChris: waiting.total,
      connected: connected,
      producing: producing,
      pending: pending,
      inboxCareer: inboxCareer,
      inboxStack: inboxStack,
      deadlines: deadlines,
      nextDl: nextDl,
      weeks: weeks
    };
  }

  /* ---------------- the ten KPI definitions ------------------------------ */
  function kpiDefs(c) {
    var noAnswer = 0, inTalks = 0;
    c.inflightApps.forEach(function (a) { if (a.status === 'Responded') inTalks++; else noAnswer++; });

    var ivWhen = c.nextIvT !== null ? fmt.date(new Date(c.nextIvT)) + (c.nextIvHasTime ? ', ' + fmt.time(new Date(c.nextIvT)) : '') : '';
    var ivCtx;
    if (c.nextIv) ivCtx = 'Next: ' + (c.nextIv.company || '') + ' · ' + ivWhen;
    else if (c.interviewApps.length) ivCtx = 'in play, no date set yet';
    else ivCtx = 'none booked yet';

    var ivMeaning;
    if (c.nextIv) ivMeaning = (c.nextIv.company || 'The next company') + ' is next ' + daysAway(c.nextIvT, c.now) + ', ' + ivWhen + '. Interviews are the strongest sign the resume is landing.';
    else if (c.interviewApps.length) ivMeaning = 'An interview is in play but not on the calendar yet. Locking in a time is the next move.';
    else ivMeaning = 'No interviews yet. They usually show up a week or two behind steady applications.';

    var hired = c.hiredApps.length;
    var hiredCo = hired ? (c.hiredApps[0].company || 'the company') : '';
    var offerCtx;
    if (c.best) offerCtx = 'Best: ' + c.best.text + ' base at ' + c.best.company;
    else if (c.offerApps.length) offerCtx = 'pay details to come';
    else offerCtx = hired ? 'none open right now' : 'none yet';

    var offerMeaning;
    if (c.best) offerMeaning = c.best.company + ' put ' + c.best.text + ' base on the table. The job now is deciding, not chasing.';
    else if (c.offerApps.length) offerMeaning = 'An offer is in and the pay details are coming. Keep the other conversations warm anyway.';
    else if (hired) offerMeaning = 'You took the job at ' + hiredCo + '. No other offers are open. Mission complete.';
    else offerMeaning = 'No offers yet. They come out of the interview column, so keep feeding it.';
    if (hired && c.offerApps.length) offerMeaning += ' You already took the job at ' + hiredCo + '.';

    var rem = c.appsTarget !== null ? Math.max(0, c.appsTarget - c.appsDone) : 0;

    var dl = c.nextDl;
    var dlDate = dl ? new Date(dl.t) : null;
    var dlWhen = dl ? fmt.date(dlDate) + (dl.hasTime ? ', ' + fmt.time(dlDate) : '') : '';
    var oldest = c.agingApps.length ? Math.floor((c.now - ts(c.agingApps[0].dateApplied)) / DAY) : 0;
    var coverage = c.connected ? Math.round(100 * c.producing.length / c.connected) : 0;

    return [
      {
        key: 'apps',
        /* the hero: the one number this panel is about. Sent against the
           weekly goal, with a goal bar whose length is the number. */
        hero: true,
        label: 'Sent this week',
        value: count(c.appsDone),
        suffix: c.appsTarget !== null ? '/ ' + c.appsTarget : '',
        delta: c.appsDelta,
        ctx: c.appsTarget !== null
          ? (rem > 0 ? 'Goal ' + c.appsTarget + ' this week. ' + rem + ' to go.' : 'Goal ' + c.appsTarget + ' this week. Done.')
          : 'sent in the last 7 days',
        bar: c.appsTarget ? Math.min(100, 100 * c.appsDone / c.appsTarget) : undefined,
        barKind: c.appsTarget && c.appsDone >= c.appsTarget ? 'good' : 'accent',
        foot: c.appsTarget !== null
          ? (c.appsDone >= c.appsTarget ? 'goal met' : Math.round(100 * c.appsDone / c.appsTarget) + '% of the way')
          : '',
        series: c.appsSeries,
        idle: 'no sends in 14 days',
        fmtv: count,
        caption: 'Applications sent, running total, last 14 days',
        chart: 'line',
        rows: function () {
          var sent = c.sentApps.slice().sort(function (a, b) { return ts(b.dateApplied) - ts(a.dateApplied); });
          var out = sent.slice(0, 5).map(function (a) {
            return row(CMC.statusKind(a.status), a.company || '', a.role || '', fmt.date(a.dateApplied));
          });
          if (sent.length > 5) out.push(h('div', { 'class': 'kx-more' }, '+ ' + (sent.length - 5) + ' more'));
          if (!sent.length) out.push(h('div', { 'class': 'kx-row kx-sub' }, 'Nothing sent yet. The first one is the hardest.'));
          return out;
        },
        meaning: c.appsTarget === null
          ? 'You sent ' + c.weekSends + (c.weekSends === 1 ? ' application' : ' applications') + ' in the last 7 days. Steady volume is what turns into interviews.'
          : (rem > 0
            ? 'You have sent ' + c.appsDone + ' of ' + c.appsTarget + ' planned applications this week. Steady volume is what turns into interviews.'
            : 'You hit this week\'s goal of ' + c.appsTarget + ' applications. Keep the streak alive.')
      },
      {
        key: 'inflight',
        label: 'In flight',
        value: count(c.inflightApps.length),
        suffix: '',
        ctx: c.inflightApps.length
          ? noAnswer + ' no answer yet · ' + inTalks + ' in talks'
          : 'nothing out right now',
        series: c.inflightSeries,
        idle: 'none out in 14 days',
        fmtv: count,
        caption: 'Today\'s in-flight applications, counted by day sent',
        chart: 'line',
        rows: function () {
          var list = c.inflightApps.slice().sort(function (a, b) { return (ts(a.dateApplied) || 0) - (ts(b.dateApplied) || 0); });
          var out = list.slice(0, 6).map(function (a) {
            var x = ts(a.dateApplied);
            var waitTxt = x !== null ? Math.max(0, Math.floor((c.now - x) / DAY)) + 'd waiting' : '';
            return row(CMC.statusKind(a.status), a.company || '', a.role || '', waitTxt);
          });
          if (list.length > 6) out.push(h('div', { 'class': 'kx-more' }, '+ ' + (list.length - 6) + ' more'));
          if (!list.length) out.push(h('div', { 'class': 'kx-row kx-sub' }, 'Applications land here once they go out the door.'));
          return out;
        },
        meaning: c.inflightApps.length === 0
          ? 'Nothing is in flight right now. New applications land here once they go out.'
          : (c.inflightApps.length === 1
            ? '1 application is out the door with no final answer yet. A follow-up keeps it warm.'
            : c.inflightApps.length + ' applications are out the door with no final answer yet. Each one is a live chance, and follow-ups keep them warm.')
      },
      {
        key: 'interviews',
        label: 'Interviews',
        value: count(c.interviewApps.length),
        suffix: '',
        delta: c.ivDelta,
        ctx: ivCtx,
        series: c.ivSeries,
        idle: 'none in 14 days',
        fmtv: count,
        caption: 'Interviews booked, running total, last 14 days',
        chart: 'line',
        rows: function () {
          var out = c.ivRows.map(function (r) {
            var a = r.app, right;
            if (r.next) right = fmt.date(new Date(r.next.t)) + (r.next.hasTime ? ', ' + fmt.time(new Date(r.next.t)) : '');
            else if (r.last) right = 'was ' + fmt.date(new Date(r.last.t));
            else right = 'no date yet';
            return row('ivl', a.company || '', a.role || '', right);
          });
          if (!out.length) out.push(h('div', { 'class': 'kx-row kx-sub' }, 'No interviews on the books yet.'));
          return out;
        },
        meaning: ivMeaning
      },
      {
        key: 'rate',
        label: 'Response rate',
        value: count(c.ratePct),
        suffix: '%',
        ctx: c.sentCount
          ? c.answered + (c.answered === 1 ? ' answer' : ' answers') + ' from ' + c.sentCount + ' sent'
          : 'nothing sent yet',
        series: c.rateSeries,
        idle: c.sentCount ? 'no answers yet' : 'starts at first send',
        ymax: 100,
        fmtv: pct,
        caption: 'Share of sent applications with an answer, by day',
        chart: 'line',
        rows: function () {
          var counts = {};
          c.sentApps.forEach(function (a) { counts[a.status] = (counts[a.status] || 0) + 1; });
          var spec = [
            ['Applied', 'Applied, no answer yet'],
            ['Responded', 'Heard back'],
            ['Interview', 'Interview'],
            ['Offer', 'Offer'],
            ['Hired', 'Hired'],
            ['Rejected', 'Rejected']
          ];
          var out = [];
          spec.forEach(function (p) {
            if (counts[p[0]]) out.push(row(CMC.statusKind(p[0]), p[1], '', count(counts[p[0]])));
          });
          if (!out.length) out.push(h('div', { 'class': 'kx-row kx-sub' }, 'This fills in once applications start going out.'));
          return out;
        },
        meaning: c.sentCount
          ? c.ratePct + '% of your sent applications have gotten some kind of answer. New sends drag this down at first, and that is normal.'
          : 'No applications are out yet, so there is nothing to answer. This fills in once you start sending.'
      },
      {
        key: 'fit',
        label: 'Average fit',
        /* no scored roles yet: say so in words, never a misleading 0.0/5 */
        na: !c.scored.length,
        value: c.scored.length ? oneDec(c.fitAvg) : 'Not scored yet',
        suffix: c.scored.length ? '/ 5' : '',
        ctx: c.scored.length
          ? c.scored.length + (c.scored.length === 1 ? ' role scored' : ' roles scored') + ' · 4.0 is the apply line'
          : '4.0 is the apply line',
        series: c.fitSeries,
        idle: c.scored.length ? 'no new scores, 14 days' : 'starts at first score',
        ymax: 5,
        fmtv: oneDec,
        caption: 'Where your matches score',
        chart: 'bands',
        bands: c.bands,
        rows: function () {
          var top = c.scored.slice().sort(function (a, b) { return b.score - a.score; }).slice(0, 3);
          var out = top.map(function (a) {
            return row(CMC.statusKind(a.status), a.company || '', a.role || '', oneDec(a.score) + '/5');
          });
          if (!out.length) out.push(h('div', { 'class': 'kx-row kx-sub' }, 'Scores show up as the scanners find matches.'));
          return out;
        },
        meaning: c.scored.length
          ? 'Your average match score is ' + oneDec(c.fitAvg) + ' out of 5, and 4.0 is the apply line. The scanners are finding roles worth your time.'
          : 'Nothing has been scored yet. The scanners rate every find from 1.0 to 5.0.'
      },
      {
        key: 'offers',
        label: 'Offers',
        value: count(c.offerApps.length),
        suffix: '',
        delta: c.offerDelta,
        ctx: offerCtx,
        series: c.offerSeries,
        idle: 'none in 14 days',
        /* a win is not an open offer: it gets its own line under the trend
           so the big number matches "offers on the table" up top */
        after: hired ? hired + ' hired' : '',
        afterKind: 'good',
        fmtv: count,
        caption: 'Offers on the table, running total, last 14 days',
        chart: 'line',
        rows: function () {
          var out = c.offerApps.map(function (a) {
            var pay = CMC.pay.short(a.pay);
            return row('good', a.company || '', a.role || '', pay ? pay + ' base' : 'pay to come');
          });
          c.hiredApps.forEach(function (a) { out.push(row('good', a.company || '', a.role || '', 'hired')); });
          if (!out.length) out.push(h('div', { 'class': 'kx-row kx-sub' }, 'Offers land here. They grow out of the interview column.'));
          return out;
        },
        meaning: offerMeaning
      },
      /* ----- the four phase 2 tiles: no chart, a rows list on open ----- */
      {
        key: 'inbox',
        label: 'Inbox',
        jump: 'panel-inbox',
        value: count(c.pending.length),
        suffix: '',
        ctx: c.inboxCareer + ' career, ' + c.inboxStack + ' stack',
        foot: 'Open the Job inbox'
      },
      {
        key: 'deadline',
        label: 'Next deadline',
        na: !dl,
        value: dl ? fmt.date(dlDate) : 'none set',
        suffix: '',
        ctx: dl
          ? (dl.company || 'Unnamed') + ' · ' + dl.round
          : 'no interview or next step dated',
        foot: dl ? daysAway(dl.t, c.now) : 'none on the calendar',
        caption: 'Upcoming interviews and next steps, soonest first',
        chart: 'rows',
        rows: function () {
          var out = c.deadlines.slice(0, 6).map(function (d) {
            var when = new Date(d.t);
            return row(d.kind, d.company || 'Unnamed', d.round, fmt.date(when) + (d.hasTime ? ', ' + fmt.time(when) : ''));
          });
          if (c.deadlines.length > 6) out.push(h('div', { 'class': 'kx-more' }, '+ ' + (c.deadlines.length - 6) + ' more'));
          if (!out.length) out.push(h('div', { 'class': 'kx-row kx-sub' }, 'No dates on the calendar yet. Booked interviews and next steps show up here.'));
          return out;
        },
        meaning: dl
          ? (dl.company || 'The next company') + ' ' + dl.round + ' is ' + daysAway(dl.t, c.now) + ', ' + dlWhen + '. Prep for this one first; everything else lines up behind it.'
          : 'Nothing is dated yet. Once an interview is booked or an application gets a next step, the soonest one shows here with a countdown.'
      },
      {
        key: 'aging',
        label: 'Aging 7d+',
        value: count(c.followups),
        suffix: '',
        ctx: c.followups ? 'follow up · sent 7+ days ago, no reply' : 'nothing to follow up',
        foot: c.followups ? 'oldest ' + oldest + 'd waiting' : (c.sentCount ? 'all under a week old' : 'nothing sent yet'),
        caption: 'Applied 7+ days ago, no reply, no follow-up in the last week',
        chart: 'rows',
        rows: function () {
          var out = c.agingApps.slice(0, 6).map(function (a) {
            var d = Math.floor((c.now - ts(a.dateApplied)) / DAY);
            return row('warn', a.company || '', a.role || '', d + 'd waiting');
          });
          if (c.agingApps.length > 6) out.push(h('div', { 'class': 'kx-more' }, '+ ' + (c.agingApps.length - 6) + ' more'));
          if (!out.length) out.push(h('div', { 'class': 'kx-row kx-sub' }, 'Nothing is going quiet. Sent applications land here after a week with no reply.'));
          return out;
        },
        meaning: c.followups
          ? plural(c.followups, 'application has', 'applications have') + ' sat a week or more with no reply and no follow-up. A short, friendly note usually gets an answer or a clean no.'
          : 'Nothing is going stale. Every sent application is under a week old or already has a fresh follow-up.'
      },
      {
        key: 'boards',
        label: 'Boards producing',
        value: count(c.producing.length),
        suffix: '',
        ctx: 'of ' + c.connected + ' enabled',
        bar: coverage,
        foot: coverage + '% with a real scan',
        caption: 'Boards with a reachable check and a real scan on record',
        chart: 'rows',
        rows: function () {
          var out = c.producing.slice(0, 6).map(function (p) {
            return row('good', p.name || p.id, p.group || '', 'scanned ' + fmt.scan(p.lastScan));
          });
          if (c.producing.length > 6) out.push(h('div', { 'class': 'kx-more' }, '+ ' + (c.producing.length - 6) + ' more'));
          if (!out.length) out.push(h('div', { 'class': 'kx-row kx-sub' }, 'No board has a real scan on record yet. The first scan fills this in.'));
          return out;
        },
        meaning: c.producing.length
          ? c.producing.length + ' of ' + c.connected + ' enabled boards have actually returned a scan. The rest are connected on paper only, so this is the honest coverage number.'
          : 'None of the ' + c.connected + ' enabled boards has returned a scan yet, so coverage is zero until the first one does.'
      }
    ];
  }

  function row(kind, main, sub, right) {
    return h('div', { 'class': 'kx-row' },
      kind ? h('span', { 'class': 'dot dot-' + kind }) : null,
      h('span', { 'class': 'kx-main' }, main, sub ? h('span', { 'class': 'kx-sub' }, ' · ' + sub) : null),
      right ? h('span', { 'class': 'kx-right' }, right) : null);
  }

  /* week-over-week delta chip: direction by sign AND color, never color
     alone. Hidden upstream when both weeks are zero. */
  function deltaChip(d) {
    var diff = d.now - d.prev;
    var kind = diff > 0 ? 'good' : (diff < 0 ? 'bad' : 'idle');
    var text = diff > 0 ? '+' + diff + ' vs last week'
      : (diff < 0 ? '\u2212' + (-diff) + ' vs last week' : 'same as last week');
    return h('span', {
      'class': 'chip chip-' + kind + ' k-delta',
      title: d.now + ' in the last 7 days, ' + d.prev + ' in the 7 before'
    }, text);
  }

  /* footer slot for tiles without a sparkline: one line of context, plus a
     thin coverage bar where length means something */
  function foot(k) {
    var kids = [];
    if (typeof k.bar === 'number') {
      kids.push(h('span', { 'class': 'k-bar', 'aria-hidden': 'true' },
        h('i', { 'class': 'is-' + (k.barKind || 'good'), style: { width: Math.max(0, Math.min(100, k.bar)) + '%' } })));
    }
    if (k.foot) kids.push(h('span', { 'class': 'k-foot-t' }, k.foot));
    return h('span', { 'class': 'k-foot' }, kids);
  }

  /* a second line under a sparkline (the Offers tile's hired count): a
     status dot beside the words, never color alone */
  function footAfter(k) {
    if (!k.after) return null;
    return h('span', { 'class': 'k-foot k-after' },
      h('span', { 'class': 'k-foot-t' },
        k.afterKind ? h('span', { 'class': 'dot dot-' + k.afterKind }) : null,
        k.after));
  }

  /* a sparkline that is flat at zero carries no information, so the tile
     says so in words instead and keeps the footer line for alignment */
  function hasTrend(vals) {
    for (var i = 0; i < vals.length; i++) if (vals[i]) return true;
    return false;
  }
  function trend(k, vw) {
    if (hasTrend(k.series)) return spark(k, vw);
    return h('span', { 'class': 'k-foot k-idle' }, h('span', { 'class': 'k-foot-t' }, k.idle || 'flat so far'));
  }

  /* ---------------- sparkline (tile) ------------------------------------- */
  /* vw 160 is the regular tile. The wide hero gets a 480 box that keeps a
     fixed 40px height whatever the tile width: the line stretches with
     non-scaling strokes and the end dot is an HTML element placed by
     percent, so nothing turns into an ellipse. */
  function spark(k, vw) {
    var vals = k.series, n = vals.length;
    var wide = vw > 160;
    var VW = vw || 160, VH = 40, X0 = 4, X1 = VW - 8, Y0 = 7, Y1 = 36;
    var ymax = k.ymax || Math.max(1, maxOf(vals));
    function px(i) { return X0 + (X1 - X0) * (n > 1 ? i / (n - 1) : 1); }
    function py(v) { return Y1 - (Y1 - Y0) * (v / ymax); }
    var d = '';
    for (var i = 0; i < n; i++) d += (i ? ' L' : 'M') + px(i).toFixed(1) + ',' + py(vals[i]).toFixed(1);
    var svg = s('svg', { 'class': 'k-spark', viewBox: '0 0 ' + VW + ' ' + VH, 'aria-hidden': 'true', focusable: 'false' });
    svg.appendChild(s('path', { d: d + ' L' + X1 + ',' + Y1 + ' L' + X0 + ',' + Y1 + ' Z', fill: 'var(--accent)', opacity: '0.13' }));
    var line = s('path', { d: d, fill: 'none', stroke: 'var(--accent)', 'stroke-width': '2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    svg.appendChild(line);
    var ex = px(n - 1), ey = py(vals[n - 1]);
    if (!wide) {
      svg.appendChild(s('circle', { cx: ex, cy: ey, r: '6', fill: 'var(--accent)', opacity: '0.18' }));
      svg.appendChild(s('circle', { cx: ex, cy: ey, r: '3', fill: 'var(--accent)' }));
      return svg;
    }
    svg.setAttribute('preserveAspectRatio', 'none');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    return h('span', { 'class': 'k-spark-wide', 'aria-hidden': 'true' }, svg,
      h('i', { 'class': 'k-spark-dot', style: { left: (100 * ex / VW) + '%', top: (100 * ey / VH) + '%' } }));
  }

  /* ---------------- bigger chart in the expansion ------------------------ */
  function lineChart(k) {
    var days = k.days, vals = k.series, n = vals.length;
    var VW = 640, VH = 152, X0 = 8, X1 = 632, Y0 = 24, Y1 = 118;
    if (k.narrow) { VW = 340; VH = 170; X0 = 6; X1 = 334; Y0 = 26; Y1 = 134; }
    var ymax = k.ymax || Math.max(1, maxOf(vals));
    function px(i) { return X0 + (X1 - X0) * (n > 1 ? i / (n - 1) : 1); }
    function py(v) { return Y1 - (Y1 - Y0) * (v / ymax); }
    var d = '';
    for (var i = 0; i < n; i++) d += (i ? ' L' : 'M') + px(i).toFixed(1) + ',' + py(vals[i]).toFixed(1);

    var svg = s('svg', { viewBox: '0 0 ' + VW + ' ' + VH, role: 'img', 'aria-label': k.caption });
    svg.appendChild(s('line', { x1: X0, y1: Y0, x2: X1, y2: Y0, 'class': 'kx-grid' }));
    svg.appendChild(s('line', { x1: X0, y1: Y1, x2: X1, y2: Y1, 'class': 'kx-base' }));
    svg.appendChild(s('path', { d: d + ' L' + X1 + ',' + Y1 + ' L' + X0 + ',' + Y1 + ' Z', fill: 'var(--accent)', opacity: '0.09' }));
    svg.appendChild(s('path', { d: d, fill: 'none', stroke: 'var(--accent)', 'stroke-width': '2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    var ex = px(n - 1), ey = py(vals[n - 1]);
    svg.appendChild(s('circle', { cx: ex, cy: ey, r: '6', fill: 'var(--panel2)' }));
    svg.appendChild(s('circle', { cx: ex, cy: ey, r: '3.5', fill: 'var(--accent)' }));
    svg.appendChild(st(X0, Y0 - 8, 'start', 'kx-lab', k.fmtv(ymax)));
    svg.appendChild(st(X0, VH - 6, 'start', 'kx-lab', dayLabel(days[0])));
    svg.appendChild(st(X1, VH - 6, 'end', 'kx-lab', dayLabel(days[n - 1])));
    svg.appendChild(st(X1, Math.max(14, ey - 11), 'end', 'kx-end', k.fmtv(vals[n - 1])));

    /* hover: nearest-day dot + tooltip */
    var hov = s('g', {});
    hov.setAttribute('style', 'display:none');
    var hovRing = s('circle', { r: '6', fill: 'var(--panel2)' });
    var hovDot = s('circle', { r: '3.5', fill: 'var(--accent)' });
    hov.appendChild(hovRing);
    hov.appendChild(hovDot);
    svg.appendChild(hov);
    svg.appendChild(s('rect', { x: 0, y: 0, width: VW, height: VH, fill: 'transparent' }));

    var wrap = h('div', { 'class': 'kx-chart' }, svg);
    var tip = h('div', { 'class': 'kx-tip', hidden: true });
    wrap.appendChild(tip);
    function show(ev) {
      var r = svg.getBoundingClientRect();
      if (!r.width) return;
      var fx = (ev.clientX - r.left) / r.width * VW;
      var i = Math.round((fx - X0) / (X1 - X0) * (n - 1));
      i = Math.max(0, Math.min(n - 1, i));
      var cx = px(i), cy = py(vals[i]);
      hovRing.setAttribute('cx', cx); hovRing.setAttribute('cy', cy);
      hovDot.setAttribute('cx', cx); hovDot.setAttribute('cy', cy);
      hov.setAttribute('style', '');
      tip.hidden = false;
      tip.textContent = dayLabel(days[i]) + ' · ' + k.fmtv(vals[i]);
      tip.style.left = (cx / VW * 100) + '%';
      tip.style.top = (cy / VH * 100) + '%';
    }
    function hide() {
      hov.setAttribute('style', 'display:none');
      tip.hidden = true;
    }
    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', hide);
    return wrap;
  }

  function bandsChart(k) {
    var mx = 1;
    k.bands.forEach(function (b) { if (b.n > mx) mx = b.n; });
    return h('div', { 'class': 'kx-bands' }, k.bands.map(function (b) {
      return h('div', { 'class': 'kx-band' },
        h('span', { 'class': 'kx-band-name' },
          h('span', { 'class': 'dot ' + b.cls }),
          b.name, ' ',
          h('small', null, b.range)),
        h('span', { 'class': 'kx-band-bar' },
          h('i', { 'class': b.cls, style: 'width:' + Math.round(100 * b.n / mx) + '%' })),
        h('span', { 'class': 'kx-band-n mono' }, String(b.n)));
    }));
  }

  /* ---------------- open/close ------------------------------------------- */
  function setOpen(key, focusKey) {
    CMC.ui.kpiOpen = key || null;
    CMC.rerender('kpis');
    var slot = document.querySelector('.panel-slot[data-panel="kpis"]');
    if (!slot) return;
    var btn = focusKey ? slot.querySelector('[data-kpi="' + focusKey + '"]') : null;
    if (btn) { try { btn.focus({ preventScroll: true }); } catch (e) { btn.focus(); } }
  }

  /* the Inbox tile is a jump, not a disclosure: it scrolls to the Job
     inbox panel and leaves the deck as it was */
  function jumpTo(id) {
    var target = document.getElementById(id);
    if (!target) return;
    var reduce = false;
    try { reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e0) {}
    try { target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); } catch (e) { target.scrollIntoView(); }
  }

  /* ---------------- browser tab ------------------------------------------ */
  function setTitle(n) {
    var want = n > 0 ? '(' + n + ') ' + APP_TITLE : APP_TITLE;
    if (document.title !== want) document.title = want;
  }

  /* ---------------- briefing line ---------------------------------------- */
  function clause(cl) {
    return h('a', { 'class': 'brief-link', href: cl.href, title: cl.title || null },
      h('span', { 'class': 'dot dot-' + cl.kind + (cl.glow ? ' brief-glow' : '') }),
      h('span', { 'class': 'brief-n' }, String(cl.n)),
      h('span', { 'class': 'brief-t' }, cl.text));
  }

  function briefing(c) {
    /* the first clause carries CMC.needsChris().total, the same number the
       tab title and the summary sentence call "waiting on you", so the
       quiet line below can only appear when that count is zero. The words
       say which kind it is when there is only one kind; mixed, the tooltip
       splits it. */
    var items = [];
    if (c.needsChris > 0) {
      var wait = { kind: 'warn', glow: true, n: c.needsChris, text: 'waiting on you', href: '#panel-needs-you' };
      if (!c.decisions) { wait.text = c.ready === 1 ? 'needs your review' : 'need your review'; wait.href = '#panel-jobs-queue'; }
      else if (!c.ready) wait.text = c.decisions === 1 ? 'decision waiting on you' : 'decisions waiting on you';
      else wait.title = c.ready + ' ready for your review in the Apply queue, ' + plural(c.decisions, 'decision', 'decisions') + ' in Needs you';
      items.push(wait);
    }
    if (c.offerApps.length > 0) items.push({ kind: 'good', n: c.offerApps.length, text: c.offerApps.length === 1 ? 'offer on the table' : 'offers on the table', href: '#panel-pipeline' });
    if (c.hiredApps.length > 0) items.push({ kind: 'good', n: c.hiredApps.length, text: 'hired', href: '#panel-pipeline' });
    if (c.ivThisWeek > 0) items.push({ kind: 'ivl', n: c.ivThisWeek, text: c.ivThisWeek === 1 ? 'interview this week' : 'interviews this week', href: '#panel-pipeline' });
    if (c.inflightApps.length > 0) items.push({ kind: 'info', n: c.inflightApps.length, text: 'in flight', href: '#panel-pipeline' });
    if (c.followups > 0) items.push({ kind: 'warn', n: c.followups, text: c.followups === 1 ? 'follow-up due' : 'follow-ups due', href: '#panel-pipeline' });

    var kids = [];
    if (!items.length) {
      kids.push(h('span', { 'class': 'brief-quiet' },
        h('span', { 'class': 'dot dot-idle' }),
        'Nothing needs you right now. The scanners are watching.'));
    } else {
      /* no separator glyphs: flex gap does the separating, so nothing
         dangles at the end of a wrapped line on a phone */
      items.forEach(function (cl) { kids.push(clause(cl)); });
    }
    return h('p', { 'class': 'kpi-brief' }, kids);
  }

  /* one plain sentence under the briefing: what is on the board, what is
     in the queue, what waits on Chris. Skipped when the board is empty. */
  function summary(c) {
    if (!c.apps.length && !c.queued && !c.needsChris) return null;
    var waiting = c.needsChris + ' waiting on you';
    /* both kinds at once: say which is which; the number stays the total */
    if (c.ready && c.decisions) waiting += ' (' + plural(c.ready, 'application', 'applications') + ' to review, ' + plural(c.decisions, 'decision', 'decisions') + ')';
    var parts = [
      c.matches ? plural(c.matches, 'match', 'matches') + ' on the board' : 'no new matches on the board',
      c.queued + ' in the queue',
      waiting
    ];
    var text = parts.join(', ') + '.';
    text = text.charAt(0).toUpperCase() + text.slice(1);
    return h('p', { 'class': 'kpi-summary' }, text);
  }

  function subline(c) {
    /* each clause is one nowrap chip in a flex-wrap row: the gap is the
       separator, so no "·" glyph can dangle at the end of a wrapped line */
    var kids = [
      h('span', { 'class': 'sub-item' },
        h('span', { 'class': 'mono' }, String(c.apps.length)),
        c.apps.length === 1 ? ' application so far' : ' applications so far'),
      h('span', { 'class': 'sub-item' },
        h('span', { 'class': 'mono' }, String(c.connected)),
        ' platforms connected')
    ];
    if (c.weeks > 0) {
      kids.push(h('span', { 'class': 'sub-item' },
        'searching ',
        h('span', { 'class': 'mono' }, String(c.weeks)),
        c.weeks === 1 ? ' week' : ' weeks'));
    }
    return h('p', { 'class': 'kpi-subline' }, kids);
  }

  /* ---------------- number tick-up --------------------------------------- */
  /* When a tile's number changes while Chris is looking (a reply lands, a
     task is done, Claude logs a send), the number counts from the old value
     to the new one in about 0.7 s and its digits glow once in the accent.
     Rules: the first live load never animates (numbers arrive from several
     collections in the first seconds, which is loading, not change); only
     plain numbers tick ("4.2" keeps one decimal, words and dates never
     animate); reduced motion, a hidden tab or a page that is not live sets
     the number at once. A rerender mid-count carries on from the digit on
     screen, so the count never jumps backward. */
  var TICK_MS = 700, SETTLE_MS = 2500;
  var tickShown = {}, tickAnim = {}, liveSince = 0;
  function reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  function numOf(text) {
    var t = String(text || '').trim();
    if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
    var dot = t.indexOf('.');
    return { v: parseFloat(t), dec: dot < 0 ? 0 : t.length - dot - 1 };
  }
  function tickNumbers(root, state) {
    var now = (window.performance && performance.now) ? performance.now() : Date.now();
    var animate = !!state.live && !reducedMotion() && !document.hidden;
    if (state.live && !liveSince) liveSince = now;
    if (liveSince && now - liveSince < SETTLE_MS) animate = false;
    var tiles = root.querySelectorAll('.kpi-tile[data-kpi]');
    for (var i = 0; i < tiles.length; i++) tickOne(tiles[i], animate);
  }
  function tickOne(tile, animate) {
    var key = tile.getAttribute('data-kpi');
    var numEl = tile.querySelector('.k-num');
    var node = numEl && numEl.firstChild;
    if (!node || node.nodeType !== 3) { tickShown[key] = null; return; }
    var final = node.nodeValue;
    var target = numOf(final);
    var run = tickAnim[key];
    if (!target) {
      if (run) { cancelAnimationFrame(run.raf); delete tickAnim[key]; }
      tickShown[key] = null;
      return;
    }
    /* where the eye is now: mid-count digit, else the last settled value */
    var from = run ? run.cur : tickShown[key];
    tickShown[key] = target.v;
    if (run) { cancelAnimationFrame(run.raf); delete tickAnim[key]; }
    if (!animate || typeof from !== 'number' || from === target.v) return;
    var t0 = null;
    var state = { cur: from, raf: 0 };
    tickAnim[key] = state;
    tile.classList.add('is-ticking');
    node.nodeValue = from.toFixed(target.dec);
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / TICK_MS);
      var e = 1 - Math.pow(1 - p, 3);
      state.cur = from + (target.v - from) * e;
      if (p < 1 && tickAnim[key] === state) {
        node.nodeValue = state.cur.toFixed(target.dec);
        state.raf = requestAnimationFrame(step);
        return;
      }
      if (tickAnim[key] === state) delete tickAnim[key];
      node.nodeValue = final;
      setTimeout(function () { tile.classList.remove('is-ticking'); }, 260);
    }
    state.raf = requestAnimationFrame(step);
  }

  /* ---------------- render ------------------------------------------------ */
  function render(el, state, ui) {
    var c = compute(state);
    var list = kpiDefs(c);
    var open = null;
    list.forEach(function (k) { if (k.key === ui.kpiOpen && !k.jump) open = k; });

    setTitle(c.needsChris);

    var deck = h('div', { 'class': 'kpi-deck' }, list.map(function (k) {
      var isOpen = !!(open && open.key === k.key);
      var attrs = {
        type: 'button',
        'class': 'elev kpi-tile' + (k.jump ? ' is-jump' : '') + (k.hero ? ' is-hero' : ''),
        'data-kpi': k.key
      };
      if (k.jump) {
        attrs.title = 'Jump to the Job inbox';
        attrs.onclick = function () { jumpTo(k.jump); };
      } else {
        attrs['aria-expanded'] = isOpen ? 'true' : 'false';
        attrs['aria-controls'] = 'kpiExpand';
        attrs.onclick = function () { setOpen(isOpen ? null : k.key, k.key); };
      }
      var label = h('span', { 'class': 'k-label' }, k.label);
      var numrow = h('span', { 'class': 'k-numrow' },
        h('span', { 'class': 'k-num' + (k.na ? ' is-na' : '') }, k.value, k.suffix ? h('span', { 'class': 'k-suffix' }, k.suffix) : null),
        k.delta ? deltaChip(k.delta) : null);
      var ctx = h('span', { 'class': 'k-ctx' }, k.ctx);
      if (k.hero) {
        /* the hero: the big number, then a foot row pinned to the bottom
           edge with the goal bar on the left and the 14-day trend on the
           right, so the tile stays as tall as its neighbors */
        return h('button', attrs, label, numrow, ctx,
          h('span', { 'class': 'k-hero-foot' }, foot(k), k.series ? trend(k, 240) : null));
      }
      return h('button', attrs, label, numrow, ctx, k.series ? trend(k, 160) : foot(k), footAfter(k));
    }));

    var expand = null;
    if (open) {
      var closeIcon = s('svg', { width: '14', height: '14', viewBox: '0 0 14 14', 'aria-hidden': 'true', focusable: 'false' });
      closeIcon.appendChild(s('line', { x1: '2', y1: '2', x2: '12', y2: '12', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round' }));
      closeIcon.appendChild(s('line', { x1: '12', y1: '2', x2: '2', y2: '12', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round' }));
      open.days = c.days;
      var slotW = 0;
      try { slotW = el.getBoundingClientRect().width; } catch (e3) {}
      open.narrow = (slotW || window.innerWidth || 1280) < 560;
      var chart = null;
      if (open.chart === 'bands') chart = bandsChart(open);
      else if (open.chart === 'line') chart = lineChart(open);
      expand = h('div', { 'class': 'kpi-expand' + (chart ? '' : ' is-rows'), id: 'kpiExpand', role: 'region', 'aria-label': open.label + ' details' },
        h('div', { 'class': 'kx-head' },
          h('span', { 'class': 'kx-title' }, open.label),
          h('button', {
            type: 'button',
            'class': 'btn btn-ghost kx-close',
            'aria-label': 'Close details',
            onclick: function () { setOpen(null, open.key); }
          }, closeIcon)),
        h('p', { 'class': 'kx-caption' }, open.caption),
        chart,
        h('div', { 'class': 'kx-rows' }, open.rows()),
        h('p', { 'class': 'kx-meaning' }, open.meaning));
    }

    var kicker = state.meta && state.meta.lastSync ? 'updated ' + fmt.scan(state.meta.lastSync) : '';

    var panel = h('div', { 'class': 'panel kpi-panel' },
      h('div', { 'class': 'panel-head' },
        h('h2', { 'class': 'panel-title' }, 'At a glance'),
        kicker ? h('span', { 'class': 'panel-kicker' }, kicker) : null),
      h('div', { 'class': 'panel-body' },
        briefing(c),
        summary(c),
        subline(c),
        deck,
        expand));

    while (el.firstChild) el.removeChild(el.firstChild);
    el.appendChild(panel);
    tickNumbers(el, state);

    if (!el.__kpisWired) {
      el.__kpisWired = true;
      el.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape' && CMC.ui.kpiOpen) {
          var k = CMC.ui.kpiOpen;
          ev.stopPropagation();
          setOpen(null, k);
        }
      });
    }
  }

  CMC.register('kpis', { render: render });
})();
