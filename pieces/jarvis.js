/* piece: jarvis. Three things live here, each in its own section:
     A. the neural field: a plain canvas 2D drift of nodes and links that sits
        under every panel (foundation.css puts #jarvisCanvas at z-index -1),
        colored from the theme tokens, cheap enough to leave on all day;
     B. the FX button in the command bar and window.CMCFX for tests;
     C. keyboard shortcuts and the "Keyboard shortcuts" cheat sheet.
   Nothing here touches the db. UI state lives in CMC.ui. */
(function () {
  'use strict';
  var CMC = window.CMC;
  if (!CMC) return;
  var h = CMC.h;
  var root = document.documentElement;
  var TAU = Math.PI * 2;
  var FX_KEY = 'cmc-fx';
  var THEMES = ['t-dark-ops', 't-light-pro', 't-bold', 't-green'];
  /* the nine panels the number keys jump to, top to bottom */
  var JUMP = [
    ['targeting', 'Targeting'], ['kpis', 'At a glance'], ['needs-you', 'Needs you'],
    ['jobs-queue', 'Action center'], ['know-you', 'Get to know you'], ['pipeline', 'Pipeline'],
    ['tracker', 'Application tracker'], ['inbox', 'Job inbox'], ['calendar', 'Applied calendar'],
  ];

  function mq(q) {
    try { return window.matchMedia(q); } catch (e) { return { matches: false, addEventListener: function () {}, addListener: function () {} }; }
  }
  function onMq(m, fn) {
    if (typeof m.addEventListener === 'function') m.addEventListener('change', fn);
    else if (typeof m.addListener === 'function') m.addListener(fn);
  }
  var reduce = mq('(prefers-reduced-motion: reduce)');
  var scheme = mq('(prefers-color-scheme: dark)');

  /* ======================================================================
     A. neural field
     ====================================================================== */
  var canvas = document.createElement('canvas');
  canvas.id = 'jarvisCanvas';
  canvas.setAttribute('aria-hidden', 'true');
  /* foundation.css positions #jarvisCanvas; these inline values are only a
     fallback so the canvas can never sit on top of the page */
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '-1';
  canvas.style.position = 'fixed';
  if (document.body) document.body.insertBefore(canvas, document.body.firstChild);
  var ctx = null;
  try { ctx = canvas.getContext('2d', { alpha: false }); } catch (e) { ctx = null; }
  var hasPath2D = typeof window.Path2D === 'function';

  var W = 0, H = 0, LINK = 130, LINK2 = LINK * LINK, PULL = 170, PULL2 = PULL * PULL;
  var nodes = [], raf = 0, last = 0, tick = 0, T = null;
  var mouse = { x: -1e9, y: -1e9 };
  var RING = 120, ring = new Float64Array(RING), ringN = 0, ringI = 0, frames = 0, totalMs = 0, lastMs = 0;
  var userOff = readPref();
  /* fx-off on <html> tells every other HUD accent (the live pill sweep,
     panel glows) that Chris turned the effects off */
  root.classList.toggle('fx-off', userOff);

  function readPref() {
    var q = '';
    try { q = new URLSearchParams(location.search).get('fx') || ''; } catch (e) {}
    if (q === 'off') return true;
    if (q === 'on') return false;
    try { return localStorage.getItem(FX_KEY) === 'off'; } catch (e2) { return false; }
  }
  function cssVar(name) {
    try { return getComputedStyle(root).getPropertyValue(name).trim(); } catch (e) { return ''; }
  }
  function toRGB(c, fallback) {
    var m;
    if ((m = /^#([0-9a-f]{3,8})$/i.exec(c))) {
      var hx = m[1];
      if (hx.length < 6) hx = hx.replace(/./g, '$&$&');
      return [parseInt(hx.slice(0, 2), 16), parseInt(hx.slice(2, 4), 16), parseInt(hx.slice(4, 6), 16)];
    }
    if ((m = /rgba?\(([^)]+)\)/.exec(c))) {
      var p = m[1].split(/[\s,\/]+/).filter(Boolean).slice(0, 3).map(function (v) { return Math.round(parseFloat(v)); });
      if (p.length === 3 && !p.some(isNaN)) return p;
    }
    return fallback;
  }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(3) + ')'; }
  function lum(c) { return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; }
  function readTheme() {
    var bg = toRGB(cssVar('--bg'), [6, 9, 16]);
    var accent = toRGB(cssVar('--accent'), [255, 180, 46]);
    var info = toRGB(cssVar('--info'), [79, 199, 255]);
    var light = lum(bg) > 0.5;
    /* caps from the research: dark themes draw nodes in the accent and links
       in the cooler --info so the accent stays reserved for actions; the
       light theme draws both in the accent at lower alpha */
    T = {
      bg: rgba(bg, 1),
      node: accent,
      link: light ? accent : info,
      nodeA: light ? 0.32 : 0.55,
      linkA: light ? 0.16 : 0.26,
      mouseA: light ? 0.25 : 0.35,
    };
  }
  function spawn() {
    var a = Math.random() * TAU, s = 0.12 + Math.random() * 0.18;
    return { x: Math.random() * W, y: Math.random() * H, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: 1 + Math.random() * 1.2 };
  }
  function resize() {
    if (!ctx) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    LINK = W < 600 ? 110 : 130; LINK2 = LINK * LINK;
    var target = Math.min(160, Math.max(36, Math.round(W * H / 13000)));
    while (nodes.length < target) nodes.push(spawn());
    nodes.length = target;
    if (!raf) drawOnce();
  }
  function step(dt) {
    var lean = mouse.x > -1e8;
    for (var i = 0, n; i < nodes.length; i++) {
      n = nodes[i];
      n.x += n.vx * dt; n.y += n.vy * dt;
      if (n.x < -20) n.x = W + 20; else if (n.x > W + 20) n.x = -20;
      if (n.y < -20) n.y = H + 20; else if (n.y > H + 20) n.y = -20;
      if (lean) {
        var dx = mouse.x - n.x, dy = mouse.y - n.y;
        if (dx * dx + dy * dy < PULL2) { n.x += dx * 0.02 * dt; n.y += dy * 0.02 * dt; }
      }
    }
  }
  function draw(withMouse) {
    if (!ctx || !T) return;
    var t0 = performance.now();
    var B = 5, i, j, a, c, dx, dy, d2, b;
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 1;
    if (hasPath2D) {
      /* five alpha buckets, one stroke each: no per-line state changes */
      var paths = [];
      for (b = 0; b < B; b++) paths.push(new Path2D());
      for (i = 0; i < nodes.length; i++) {
        a = nodes[i];
        for (j = i + 1; j < nodes.length; j++) {
          c = nodes[j]; dx = a.x - c.x; dy = a.y - c.y; d2 = dx * dx + dy * dy;
          if (d2 < LINK2) {
            b = Math.min(B - 1, ((1 - d2 / LINK2) * B) | 0);
            paths[b].moveTo(a.x | 0, a.y | 0);
            paths[b].lineTo(c.x | 0, c.y | 0);
          }
        }
      }
      for (b = 0; b < B; b++) { ctx.strokeStyle = rgba(T.link, T.linkA * (b + 1) / B); ctx.stroke(paths[b]); }
    } else {
      ctx.strokeStyle = rgba(T.link, T.linkA * 0.6);
      ctx.beginPath();
      for (i = 0; i < nodes.length; i++) {
        a = nodes[i];
        for (j = i + 1; j < nodes.length; j++) {
          c = nodes[j]; dx = a.x - c.x; dy = a.y - c.y;
          if (dx * dx + dy * dy < LINK2) { ctx.moveTo(a.x | 0, a.y | 0); ctx.lineTo(c.x | 0, c.y | 0); }
        }
      }
      ctx.stroke();
    }
    if (withMouse && mouse.x > -1e8) {
      ctx.strokeStyle = rgba(T.node, T.mouseA);
      ctx.beginPath();
      for (i = 0; i < nodes.length; i++) {
        a = nodes[i]; dx = a.x - mouse.x; dy = a.y - mouse.y;
        if (dx * dx + dy * dy < PULL2) { ctx.moveTo(a.x | 0, a.y | 0); ctx.lineTo(mouse.x | 0, mouse.y | 0); }
      }
      ctx.stroke();
    }
    ctx.fillStyle = rgba(T.node, T.nodeA);
    ctx.beginPath();
    for (i = 0; i < nodes.length; i++) {
      a = nodes[i];
      ctx.moveTo((a.x | 0) + a.r, a.y | 0);
      ctx.arc(a.x | 0, a.y | 0, a.r, 0, TAU);
    }
    ctx.fill();
    lastMs = performance.now() - t0;
    totalMs += lastMs; frames++;
    ring[ringI] = lastMs; ringI = (ringI + 1) % RING; if (ringN < RING) ringN++;
  }
  /* one still frame: used under reduced motion, for theme changes while
     paused, and right after a resize */
  function drawOnce() {
    if (userOff || !ctx || W < 320) return;
    draw(false);
  }
  function running() { return !!ctx && !document.hidden && !reduce.matches && !userOff && W >= 320; }
  function frame(ts) {
    raf = 0;
    var dt = Math.min(50, ts - (last || ts)) / 16.667;
    last = ts;
    if (W * H < 500000 && (tick++ & 1)) { raf = requestAnimationFrame(frame); return; } /* 30 fps on phones */
    step(dt);
    draw(true);
    if (running()) raf = requestAnimationFrame(frame);
  }
  function start() {
    if (running()) { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }
    else { stop(); drawOnce(); }
  }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  function setFx(on) {
    userOff = !on;
    root.classList.toggle('fx-off', !on);
    try { localStorage.setItem(FX_KEY, on ? 'on' : 'off'); } catch (e) {}
    canvas.style.display = on ? '' : 'none';
    syncButton();
    if (on) start(); else stop();
  }

  if (ctx) {
    document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
    onMq(reduce, function () { stop(); start(); });
    /* a theme change recolors at once instead of waiting for the next
       animation frame, so the field never shows the old theme's colors */
    var recolor = function () {
      readTheme();
      if (userOff || !ctx || W < 320) return;
      draw(raf !== 0);
    };
    onMq(scheme, recolor);
    try {
      new MutationObserver(recolor).observe(root, { attributes: true, attributeFilter: ['data-cctheme', 'data-theme'] });
    } catch (e) {}
    var rt = 0;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(resize, 120); });
    window.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'mouse') { mouse.x = e.clientX; mouse.y = e.clientY; }
    }, { passive: true });
    root.addEventListener('pointerleave', function () { mouse.x = mouse.y = -1e9; });
    document.addEventListener('mouseleave', function () { mouse.x = mouse.y = -1e9; });
  }

  /* ======================================================================
     B. FX button and the CMCFX hooks
     ====================================================================== */
  var fxBtn = document.getElementById('jarvisBtn');
  function syncButton() {
    if (!fxBtn) return;
    fxBtn.setAttribute('aria-pressed', userOff ? 'false' : 'true');
    fxBtn.title = 'Neural background ' + (userOff ? 'off' : 'on') + ' (press F)';
  }
  if (fxBtn) {
    /* #jarvisBtn is a plain .jarvis-btn: foundation sizes it and binds its
       theme handler only to .t-swatch[data-pick], so a click here is just
       the toggle. It never touches the theme or the saved theme pick. */
    fxBtn.addEventListener('click', function () { setFx(userOff); });
    document.addEventListener('DOMContentLoaded', syncButton);
  }

  window.CMCFX = {
    set: setFx,
    isOn: function () { return !userOff; },
    isAnimating: function () { return raf !== 0; },
    stats: function () {
      var sum = 0;
      for (var i = 0; i < ringN; i++) sum += ring[i];
      return {
        avgMs: ringN ? sum / ringN : 0,
        allTimeMs: frames ? totalMs / frames : 0,
        lastMs: lastMs,
        frames: frames,
        nodes: nodes.length,
        fps: W * H < 500000 ? 30 : 60,
        animating: raf !== 0,
        reducedMotion: !!reduce.matches,
      };
    },
  };

  readTheme();
  resize();
  canvas.style.display = userOff ? 'none' : '';
  syncButton();
  start();

  /* ======================================================================
     C. keyboard shortcuts and the cheat sheet
     ====================================================================== */
  var layer = h('div', { id: 'jarvisLayer' });
  if (document.body) document.body.appendChild(layer);
  var lastFocus = null;

  function isTyping(t) {
    if (!t || t === document || t === window) return false;
    var tag = (t.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || !!t.isContentEditable;
  }
  function effectiveTheme() {
    var pick = root.getAttribute('data-cctheme');
    if (THEMES.indexOf(pick) >= 0) return pick;
    var host = root.getAttribute('data-theme');
    if (host === 'dark') return 't-dark-ops';
    if (host === 'light') return 't-light-pro';
    return scheme.matches ? 't-dark-ops' : 't-light-pro';
  }
  function cycleTheme() {
    var i = THEMES.indexOf(effectiveTheme());
    CMC.setTheme(THEMES[(i + 1) % THEMES.length]);
  }
  function focusSearch() {
    var s = document.getElementById('cmdSearchInput');
    if (!s) return false;
    s.focus();
    try { s.select(); } catch (e) {}
    return true;
  }
  function jumpTo(n) {
    var key = JUMP[n] && JUMP[n][0];
    var slot = key && document.querySelector('.panel-slot[data-panel="' + key + '"]');
    if (!slot || slot.hidden) return false;
    /* an instant jump, not a smooth glide: the chrome stays still and the
       panel is simply there, which is what a shortcut is for */
    try { slot.scrollIntoView({ block: 'start', behavior: 'auto' }); }
    catch (e) { slot.scrollIntoView(true); }
    return true;
  }

  function closeIcon() {
    var NS = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('width', '16'); s.setAttribute('height', '16'); s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2.2');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('aria-hidden', 'true');
    var l1 = document.createElementNS(NS, 'line'), l2 = document.createElementNS(NS, 'line');
    l1.setAttribute('x1', '6'); l1.setAttribute('y1', '6'); l1.setAttribute('x2', '18'); l1.setAttribute('y2', '18');
    l2.setAttribute('x1', '18'); l2.setAttribute('y1', '6'); l2.setAttribute('x2', '6'); l2.setAttribute('y2', '18');
    s.appendChild(l1); s.appendChild(l2);
    return s;
  }
  function keyRow(keys, label) {
    var kids = [];
    for (var i = 0; i < keys.length; i++) {
      if (i) kids.push(h('span', { class: 'jv-or' }, 'or'));
      kids.push(h('kbd', { class: 'jv-key' }, keys[i]));
    }
    return h('li', null, h('span', { class: 'jv-keys' }, kids), h('span', { class: 'jv-what' }, label));
  }
  function focusablesIn(node) {
    var all = node.querySelectorAll('button, [href], input, select, textarea, [tabindex]');
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      if (n.disabled || n.getAttribute('tabindex') === '-1' || n.hidden) continue;
      if (n.closest('[hidden]')) continue;
      out.push(n);
    }
    return out;
  }
  function renderSheet() {
    layer.textContent = '';
    if (!CMC.ui.jvSheet) return;
    var moveRows = [keyRow(['/', 'Ctrl K'], 'Find a company (Cmd K on a Mac)')];
    for (var i = 0; i < JUMP.length; i++) moveRows.push(keyRow([String(i + 1)], 'Jump to ' + JUMP[i][1]));
    var doRows = [
      keyRow(['T'], 'Next color theme'),
      keyRow(['F'], 'Neural background on or off'),
      keyRow(['?'], 'Open or close this list'),
      keyRow(['Esc'], 'Close this list or a drawer'),
    ];
    var closeBtn = h('button', { type: 'button', class: 'btn btn-ghost close-x', 'aria-label': 'Close keyboard shortcuts', onClick: closeSheet }, closeIcon());
    var sheet = h('div', { class: 'sheet jv-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'jvSheetTitle', tabindex: '-1' },
      h('div', { class: 'panel-head' },
        h('h2', { class: 'panel-title', id: 'jvSheetTitle' }, 'Keyboard shortcuts'),
        h('span', { class: 'panel-kicker' }, 'Esc closes'),
        closeBtn),
      h('div', { class: 'panel-body' },
        h('p', { class: 'jv-note' }, 'These work whenever you are not typing in a box.'),
        h('div', { class: 'jv-cols' },
          h('div', { class: 'jv-col' }, h('h3', { class: 'jv-col-title' }, 'Find and move'), h('ul', { class: 'jv-list' }, moveRows)),
          h('div', { class: 'jv-col' }, h('h3', { class: 'jv-col-title' }, 'Switch'), h('ul', { class: 'jv-list' }, doRows)))));
    var overlay = h('div', { class: 'overlay jv-overlay', onClick: function (ev) { if (ev.target === overlay) closeSheet(); } }, sheet);
    layer.appendChild(overlay);
    try { closeBtn.focus(); } catch (e) {}
  }
  /* while the sheet is up, CMC.ui.sheetOpen tells foundation's modalOpen()
     (and every piece that asks it) that something sits on top of the page.
     The flag is only cleared on close when this piece was the one to set it,
     so another piece's sheet is never un-flagged from here. */
  var setSheetFlag = false;
  function openSheet() {
    if (CMC.ui.jvSheet) return;
    lastFocus = document.activeElement;
    CMC.ui.jvSheet = true;
    if (!CMC.ui.sheetOpen) { CMC.ui.sheetOpen = true; setSheetFlag = true; }
    renderSheet();
  }
  function closeSheet() {
    if (!CMC.ui.jvSheet) return;
    CMC.ui.jvSheet = false;
    if (setSheetFlag) { CMC.ui.sheetOpen = false; setSheetFlag = false; }
    renderSheet();
    if (lastFocus && typeof lastFocus.focus === 'function' && document.contains(lastFocus)) {
      try { lastFocus.focus(); } catch (e) {}
    }
    lastFocus = null;
  }
  /* Tab stays inside the sheet while it is open: with one focusable control
     (the close button) that means Tab and Shift+Tab both land back on it */
  function trapTab(ev) {
    var sheet = layer.querySelector('.jv-sheet');
    if (!sheet) return;
    var f = focusablesIn(sheet);
    if (!f.length) { ev.preventDefault(); try { sheet.focus(); } catch (e) {} return; }
    var first = f[0], lastEl = f[f.length - 1], cur = document.activeElement;
    var inside = sheet.contains(cur);
    if (!inside) { ev.preventDefault(); first.focus(); return; }
    if (ev.shiftKey && (cur === first || f.length === 1)) { ev.preventDefault(); lastEl.focus(); return; }
    if (!ev.shiftKey && (cur === lastEl || f.length === 1)) { ev.preventDefault(); first.focus(); }
  }
  document.addEventListener('focusin', function (ev) {
    if (!CMC.ui.jvSheet) return;
    var sheet = layer.querySelector('.jv-sheet');
    if (!sheet || sheet.contains(ev.target)) return;
    var f = focusablesIn(sheet);
    try { (f[0] || sheet).focus(); } catch (e) {}
  });

  /* another piece has a modal open (the targeting wizard, the job drawer,
     a calendar day popover, or anything marked aria-modal): the single-key
     shortcuts stay quiet so a keypress cannot scroll the page or swap the
     theme behind it. Escape is left to that piece. Foundation owns the one
     definition (CMC.modalOpen); the DOM walk below is only a fallback for a
     page where that helper is missing. This runs only while our own sheet
     is closed, so modalOpen() answering true always means someone else. */
  function otherModalOpen() {
    if (typeof CMC.modalOpen === 'function') return !!CMC.modalOpen();
    var ui = CMC.ui || {};
    if (ui.tgWizard || ui.drawerOpen || ui.calOpen || ui.sheetOpen) return true;
    var m = document.querySelector('[aria-modal="true"], .cal-pop');
    return !!m && !layer.contains(m);
  }

  document.addEventListener('keydown', function (ev) {
    if (ev.defaultPrevented) return;
    var k = ev.key;
    var mod = ev.ctrlKey || ev.metaKey;
    if (CMC.ui.jvSheet) {
      if (k === 'Escape') { closeSheet(); ev.preventDefault(); return; }
      if (k === 'Tab') { trapTab(ev); return; }
      if (k === '?' && !mod && !ev.altKey && !isTyping(ev.target)) { closeSheet(); ev.preventDefault(); }
      return;
    }
    if (otherModalOpen()) return;
    if (mod && !ev.altKey && !ev.shiftKey && (k === 'k' || k === 'K')) {
      if (focusSearch()) ev.preventDefault();
      return;
    }
    if (mod || ev.altKey || isTyping(ev.target)) return;
    if (k === '/') { if (focusSearch()) ev.preventDefault(); return; }
    if (k === '?') { openSheet(); ev.preventDefault(); return; }
    if (k.length === 1 && k >= '1' && k <= '9') { if (jumpTo(k.charCodeAt(0) - 49)) ev.preventDefault(); return; }
    var low = k.length === 1 ? k.toLowerCase() : k;
    if (low === 't') { cycleTheme(); ev.preventDefault(); return; }
    if (low === 'f') { setFx(userOff); ev.preventDefault(); }
  });

  /* teach the keys where they are used */
  var sinput = document.getElementById('cmdSearchInput');
  if (sinput) sinput.title = 'Find a company (press / or Ctrl K)';

  CMC.jarvis = { openSheet: openSheet, closeSheet: closeSheet, cycleTheme: cycleTheme };
})();
