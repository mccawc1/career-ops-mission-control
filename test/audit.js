/* audit.js: in-page accessibility and layout audit for Career Mission Control.
   run_matrix.py injects this before </body>. About 2 s after the page loads it
   checks every visible text element and control, then writes ONE JSON object
   into <pre id="auditlog"> (or #testlog when #auditlog is missing).
   Call window.__cmcRunAudit() to audit again, for example after opening a sheet.
   ES5 on purpose, no libraries, like the rest of the page. */
(function () {
  'use strict';
  var SEL = 'button, select, input, textarea, a, .chip, .btn, .chip-btn, .kpi-tile, .pl-pill, th, td, p, span, h1, h2, h3, li, label';
  var CONTROL = 'button, select, input, textarea, .chip-btn, .pl-pill';
  var DELAY = 2000;
  var canvasCtx = null;
  var DASH = String.fromCharCode(8212); /* the em dash, spelled by code point so this file has none */

  function num(s) { s = String(s); return /%$/.test(s) ? parseFloat(s) / 100 * 255 : parseFloat(s); }
  function alpha(s) { s = String(s); return /%$/.test(s) ? parseFloat(s) / 100 : parseFloat(s); }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function gamma(c) { c = clamp01(c); return (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255; }
  function oklabToRgb(L, a, b) {
    var l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
    var m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
    var s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
    return [gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      gamma(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)];
  }
  function viaCanvas(str) {
    try {
      if (!canvasCtx) { var c = document.createElement('canvas'); c.width = c.height = 1; canvasCtx = c.getContext('2d', { willReadFrequently: true }); }
      canvasCtx.clearRect(0, 0, 1, 1); canvasCtx.fillStyle = str; canvasCtx.fillRect(0, 0, 1, 1);
      var d = canvasCtx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    } catch (e) { return null; }
  }
  /* any computed color string -> [r, g, b, a] (0..255, alpha 0..1) */
  function parseColor(str) {
    if (!str) return null;
    str = String(str).trim();
    if (str === 'transparent') return [0, 0, 0, 0];
    var m = /^rgba?\(([^)]+)\)$/.exec(str), p;
    if (m) { p = m[1].replace(/[\/,]/g, ' ').split(/\s+/); return [num(p[0]), num(p[1]), num(p[2]), p.length > 3 ? alpha(p[3]) : 1]; }
    m = /^color\(srgb\s+([^)]+)\)$/.exec(str);
    if (m) { p = m[1].replace(/\//g, ' ').split(/\s+/); return [clamp01(parseFloat(p[0])) * 255, clamp01(parseFloat(p[1])) * 255, clamp01(parseFloat(p[2])) * 255, p.length > 3 ? alpha(p[3]) : 1]; }
    m = /^okl(ab|ch)\(([^)]+)\)$/.exec(str);
    if (m) {
      p = m[2].replace(/\//g, ' ').split(/\s+/);
      var L = /%$/.test(p[0]) ? parseFloat(p[0]) / 100 : parseFloat(p[0]);
      var A = parseFloat(p[1]), B = parseFloat(p[2]);
      if (m[1] === 'ch') { var h = parseFloat(p[2]) * Math.PI / 180; B = A * Math.sin(h); A = A * Math.cos(h); }
      return oklabToRgb(L, A, B).concat([p.length > 3 ? alpha(p[3]) : 1]);
    }
    return viaCanvas(str);
  }
  function over(top, bottom) {
    var ta = top[3], ba = bottom[3], a = ta + ba * (1 - ta);
    if (a <= 0) return [0, 0, 0, 0];
    var mix = function (i) { return (top[i] * ta + bottom[i] * ba * (1 - ta)) / a; };
    return [mix(0), mix(1), mix(2), a];
  }
  function lum(c) {
    var f = function (v) { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  }
  function ratio(a, b) { var la = lum(a), lb = lum(b); return Math.round(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)) * 100) / 100; }
  function rgbStr(c) { return c ? 'rgb(' + Math.round(c[0]) + ', ' + Math.round(c[1]) + ', ' + Math.round(c[2]) + ')' : 'none'; }

  /* first opaque background-color walking up, with translucent layers composited */
  function effectiveBg(el) {
    var layers = [], node = el;
    while (node && node.nodeType === 1) {
      var bg = parseColor(getComputedStyle(node).backgroundColor);
      if (bg && bg[3] > 0) { layers.push(bg); if (bg[3] >= 1) break; }
      node = node.parentNode;
    }
    if (!layers.length || layers[layers.length - 1][3] < 1) layers.push([255, 255, 255, 1]);
    var acc = layers[layers.length - 1];
    for (var i = layers.length - 2; i >= 0; i--) acc = over(layers[i], acc);
    return acc;
  }
  function chainOpacity(el) {
    var o = 1, node = el;
    while (node && node.nodeType === 1 && node !== document.body) { o *= parseFloat(getComputedStyle(node).opacity) || 0; node = node.parentNode; }
    return o;
  }
  function ownText(el) {
    var t = '';
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) t += n.nodeValue;
    return t.replace(/\s+/g, ' ').trim();
  }
  function pathOf(el) {
    var parts = [], n = el, depth = 0;
    while (n && n.nodeType === 1 && n !== document.body && depth < 5) {
      var s = n.tagName.toLowerCase();
      if (n.id) s += '#' + n.id;
      var cls = typeof n.className === 'string' ? n.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
      if (cls.length) s += '.' + cls.join('.');
      parts.unshift(s); n = n.parentNode; depth++;
    }
    return parts.join(' > ');
  }
  function panelOf(el) {
    var slot = el.closest ? el.closest('[data-panel]') : null;
    if (slot) return slot.getAttribute('data-panel');
    if (el.closest && el.closest('#cmdbar')) return 'cmdbar';
    if (el.closest && el.closest('footer')) return 'footer';
    return 'page';
  }
  function matches(el, sel) { return el.matches ? el.matches(sel) : false; }
  function isMono(cs) { return /mono/i.test(cs.fontFamily); }
  function weightOf(cs) { var w = cs.fontWeight; return w === 'bold' ? 700 : (w === 'normal' ? 400 : parseInt(w, 10) || 400); }

  function run() {
    var t0 = Date.now(), failures = [], warnings = [], checked = 0, skipped = { invisible: 0, disabled: 0, noText: 0 };
    var vw = window.innerWidth, vh = window.innerHeight;
    var els = document.querySelectorAll(SEL);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.closest && el.closest('#testlog, #auditlog, script, style, template')) continue;
      var cs = getComputedStyle(el);
      var rect = el.getBoundingClientRect();
      if (cs.display === 'none' || cs.visibility === 'hidden' || !el.getClientRects().length || chainOpacity(el) <= 0.02) { skipped.invisible++; continue; }
      var isControl = matches(el, CONTROL), tag = el.tagName.toLowerCase();
      var disabled = !!el.disabled || el.getAttribute('aria-disabled') === 'true';
      var text = ownText(el), textColor = cs.color;
      if (!text && isControl) {
        if (tag === 'input' || tag === 'textarea') {
          text = (el.value || '').trim();
          if (!text && el.placeholder) { text = el.placeholder; textColor = getComputedStyle(el, '::placeholder').color || textColor; }
        } else if (tag === 'select' && el.options && el.selectedIndex >= 0) text = el.options[el.selectedIndex].text;
      }
      if (!text && !isControl) { skipped.noText++; continue; }
      checked++;
      var base = { path: pathOf(el), panel: panelOf(el), text: (text || el.getAttribute('aria-label') || el.title || '').slice(0, 40) };
      var bg = effectiveBg(el);
      var size = parseFloat(cs.fontSize), weight = weightOf(cs);
      if (text && rect.width >= 2 && rect.height >= 2 && !disabled) {
        var fg = parseColor(textColor);
        if (fg) {
          fg[3] = fg[3] * chainOpacity(el);
          var eff = over(fg, bg), r = ratio(eff, bg);
          var large = size >= 24 || (size >= 18.66 && weight >= 700);
          var need = large ? 3.0 : 4.5;
          if (r < need) failures.push(ext(base, { kind: 'contrast', fg: rgbStr(eff), bg: rgbStr(bg), ratio: r, needed: need, size: size, weight: weight }));
        }
        var floor = isMono(cs) ? 11 : 12;
        if (size < floor) failures.push(ext(base, { kind: 'font', size: size, needed: floor }));
      } else if (disabled) skipped.disabled++;
      /* Agreed exceptions to the 3:1 boundary rule (WCAG 1.4.11 asks for a
         boundary only where it is needed to identify the control): the
         theme swatch coins and the neural toggle are icon-only buttons
         whose icon is the boundary, table sort headers are text-styled
         by design (hover and aria-sort carry the state), and native
         checkbox/radio inputs draw their own box the audit cannot read. */
      var boundaryExempt = matches(el, '.t-swatch, .jarvis-btn, .tbl th > button') ||
        (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio'));
      if (isControl && !disabled && !boundaryExempt) {
        var outer = effectiveBg(el.parentNode || document.body);
        var ownBg = parseColor(cs.backgroundColor);
        var ownEff = (ownBg && ownBg[3] > 0) ? over(ownBg, outer) : outer;
        var bgvs = ratio(ownEff, outer), border = 0, outline = 0;
        if (cs.borderTopStyle !== 'none' && parseFloat(cs.borderTopWidth) > 0) {
          var bc = parseColor(cs.borderTopColor);
          if (bc) border = ratio(over(bc, ownEff), outer);
        }
        if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) {
          var oc = parseColor(cs.outlineColor);
          if (oc) outline = ratio(over(oc, outer), outer);
        }
        var best = Math.max(bgvs, border, outline);
        if (best < 3.0) failures.push(ext(base, { kind: 'boundary', border: border, outline: outline, bgvs: bgvs, best: best, needed: 3.0,
          note: (border === 0 && outline === 0 && bgvs < 1.05) ? 'no visible boundary' : 'boundary too faint' }));
      }
      if (isControl) {
        var box = rect;
        if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio') && el.closest && el.closest('label')) box = el.closest('label').getBoundingClientRect();
        var w = Math.round(box.width), hh = Math.round(box.height);
        if (w < 24 || hh < 24) failures.push(ext(base, { kind: 'tap', w: w, h: hh, needed: 24 }));
        else if (hh < 40 && !(tag === 'select' && hh >= 36 && el.closest && el.closest('.is-compact'))) warnings.push(ext(base, { kind: 'tap-soft', w: w, h: hh, wanted: 40 }));
      }
    }
    var sw = document.documentElement.scrollWidth;
    if (sw > vw) failures.push({ kind: 'scroll', path: 'html', panel: 'page', text: '', scrollWidth: sw, viewport: vw });

    /* em dashes anywhere in visible copy, titles, labels and placeholders */
    var dash = { count: 0, first: [] };
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false), tn;
    while ((tn = walker.nextNode())) {
      if (tn.nodeValue.indexOf(DASH) < 0) continue;
      var par = tn.parentNode;
      if (par && par.closest && par.closest('script, style, #testlog, #auditlog, template')) continue;
      dash.count++;
      if (dash.first.length < 5) dash.first.push({ path: pathOf(par), text: tn.nodeValue.replace(/\s+/g, ' ').trim().slice(0, 60) });
    }
    var attrEls = document.querySelectorAll('[title], [aria-label], [placeholder]');
    for (var k = 0; k < attrEls.length; k++) {
      var v = (attrEls[k].getAttribute('title') || '') + (attrEls[k].getAttribute('aria-label') || '') + (attrEls[k].getAttribute('placeholder') || '');
      if (v.indexOf(DASH) >= 0) { dash.count++; if (dash.first.length < 5) dash.first.push({ path: pathOf(attrEls[k]), text: 'attribute: ' + v.slice(0, 60) }); }
    }
    if (document.title.indexOf(DASH) >= 0) { dash.count++; dash.first.push({ path: 'title', text: document.title.slice(0, 60) }); }
    for (var d = 0; d < dash.first.length; d++) failures.push({ kind: 'emdash', path: dash.first[d].path, panel: 'page', text: dash.first[d].text });
    if (dash.count > dash.first.length) failures.push({ kind: 'emdash', path: '(more)', panel: 'page', text: (dash.count - dash.first.length) + ' more em dashes not listed' });

    var counts = {}, wcounts = {};
    for (var f = 0; f < failures.length; f++) counts[failures[f].kind] = (counts[failures[f].kind] || 0) + 1;
    for (var g = 0; g < warnings.length; g++) wcounts[warnings[g].kind] = (wcounts[warnings[g].kind] || 0) + 1;
    var rs = getComputedStyle(document.documentElement);
    var tok = function (n) { return rs.getPropertyValue(n).trim() || '(unset)'; };
    var live = document.getElementById('liveLabel');
    var out = {
      ok: failures.length === 0, checked: checked, skipped: skipped, counts: counts, warningCounts: wcounts,
      failures: failures, warnings: warnings,
      scrollWidth: sw, viewport: { w: vw, h: vh },
      theme: document.documentElement.getAttribute('data-cctheme') || '(none)',
      tokens: { accent: tok('--accent'), fg: tok('--fg'), panel: tok('--panel'), line: tok('--line'), lineStrong: tok('--line-strong') },
      title: document.title, emdash: dash,
      live: live ? live.textContent : '(no pill)',
      headless: !!(window.__cmcLocal && window.__cmcLocal.headless),
      panels: { real: document.querySelectorAll('.panel-slot:not(.is-ghost):not([hidden])').length, ghost: document.querySelectorAll('.panel-slot.is-ghost:not([hidden])').length },
      reducedMotion: !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches),
      ms: Date.now() - t0
    };
    write(out);
    return out;
  }
  function ext(base, more) { var o = {}; for (var k in base) o[k] = base[k]; for (var m in more) o[m] = more[m]; return o; }
  function write(obj) {
    var pre = document.getElementById('auditlog') || document.getElementById('testlog');
    if (!pre) { pre = document.createElement('pre'); pre.id = 'auditlog'; pre.style.display = 'none'; document.body.appendChild(pre); }
    pre.textContent = JSON.stringify(obj);
    window.__cmcAudit = obj;
  }
  function safeRun() {
    try { return run(); }
    catch (e) { var o = { ok: false, error: String(e && e.stack || e), failures: [{ kind: 'audit-crash', path: 'audit.js', panel: 'page', text: String(e) }], counts: { 'audit-crash': 1 }, checked: 0 }; write(o); return o; }
  }
  window.__cmcRunAudit = safeRun;
  if (document.readyState === 'complete') setTimeout(safeRun, DELAY);
  else window.addEventListener('load', function () { setTimeout(safeRun, DELAY); });
})();
