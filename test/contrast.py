#!/usr/bin/env python3
"""WCAG contrast audit for the four Career Ops Mission Control themes.

Reads every token block out of pieces/foundation.css (the bare :root light
default, the @media dark block, the host-stamped dark block, and the four
explicit data-cctheme picks), computes WCAG 2.x contrast ratios for the
text, state and boundary tokens, prints one table per theme and exits 1
on any miss.

Floors:
  text tokens (fg, muted, faint, accent, good, warn, bad, info, ivl)
                                on --panel and --panel2 ............ 4.5
  idle (dot and border token)   on --panel and --panel2 ............ 3.0
  hot (glyph and hairline)      on --panel and --panel2 ............ 3.0
  accent-ink on --accent, bad-ink on --bad ......................... 4.5
  line-strong (control borders) on --panel ......................... 3.0
  c1..c6 (chart series)         on --panel ......................... 3.0

accent-ink is the text that sits on an accent button, so it is judged on
--accent only; it is listed on the panels as a reference row with no floor.

The script also checks that the two viewer-scheme blocks mirror their
explicit twins: the bare :root block must equal t-light-pro and both dark
fallbacks must equal t-dark-ops, token for token.

Usage:  python3 test/contrast.py [path/to/foundation.css]
Stdlib only.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CSS = os.path.join(HERE, '..', 'pieces', 'foundation.css')

TEXT_4_5 = ['fg', 'muted', 'faint', 'accent', 'good', 'warn', 'bad', 'info', 'ivl']
TEXT_3_0 = ['idle', 'hot']
SERIES = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']

# selector text -> (theme label, twin label or None)
BLOCKS = [
    (':root', 'viewer-light (bare :root)', 't-light-pro'),
    (':root:not([data-theme="light"]):not([data-cctheme])', 'viewer-dark (@media)', 't-dark-ops'),
    (':root[data-theme="dark"]:not([data-cctheme])', 'host-dark (data-theme)', 't-dark-ops'),
    (':root[data-cctheme="t-dark-ops"]', 't-dark-ops', None),
    (':root[data-cctheme="t-light-pro"]', 't-light-pro', None),
    (':root[data-cctheme="t-bold"]', 't-bold', None),
    (':root[data-cctheme="t-green"]', 't-green', None),
]


def parse_blocks(css):
    """Return {selector: {token: value}} for every :root-ish block. The two
    bare :root blocks (swatch constants and the light default) merge."""
    out = {}
    pos = 0
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)  # comments mention ":root" too
    pat = re.compile(r'(:root[^{}]*?)\s*\{', re.S)
    while True:
        m = pat.search(css, pos)
        if not m:
            break
        sel = ' '.join(m.group(1).split())
        start = m.end()
        end = css.find('}', start)
        if end < 0:
            break
        body = css[start:end]
        toks = out.setdefault(sel, {})
        for tm in re.finditer(r'--([a-zA-Z0-9-]+)\s*:\s*([^;]+);', body):
            toks[tm.group(1)] = tm.group(2).strip()
        pos = end + 1
    return out


def to_rgb(value):
    """'#rgb', '#rrggbb', 'rgb()', 'rgba()' -> (r, g, b) ints or None."""
    v = value.strip()
    m = re.match(r'^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$', v)
    if m:
        hx = m.group(1)
        if len(hx) == 3:
            hx = ''.join(c * 2 for c in hx)
        return tuple(int(hx[i:i + 2], 16) for i in (0, 2, 4))
    m = re.match(r'^rgba?\(([^)]+)\)$', v)
    if m:
        parts = [p.strip() for p in m.group(1).split(',')]
        try:
            return tuple(int(round(float(p))) for p in parts[:3])
        except ValueError:
            return None
    return None


def luminance(rgb):
    def chan(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)


def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def hexs(rgb):
    return '#%02X%02X%02X' % rgb


def audit(label, toks):
    """Print the table for one block. Returns the list of misses."""
    misses = []
    missing = []

    def col(name):
        v = toks.get(name)
        rgb = to_rgb(v) if v else None
        if rgb is None:
            missing.append(name)
        return rgb

    panel = col('panel')
    panel2 = col('panel2')
    accent = col('accent')
    bad = col('bad')
    print('')
    print('== %s ==' % label)
    if panel is None or panel2 is None:
        print('  missing --panel or --panel2, cannot audit')
        return ['%s: missing panel tokens' % label]
    print('  panel %s  panel2 %s  bg %s  line %s  line-strong %s' % (
        hexs(panel), hexs(panel2), toks.get('bg', '?'), toks.get('line', '?'), toks.get('line-strong', '(none)')))
    print('  %-12s %-9s %8s %8s %6s  %s' % ('token', 'value', 'panel', 'panel2', 'floor', 'result'))

    def row(name, floor, surfaces):
        rgb = col(name)
        if rgb is None:
            print('  %-12s %-9s %8s %8s %6s  MISSING' % (name, '?', '', '', floor if floor else ''))
            misses.append('%s: --%s missing' % (label, name))
            return
        ratios = [contrast(rgb, s) for s in surfaces]
        cells = ['%8.2f' % r for r in ratios] + [''] * (2 - len(ratios))
        if floor is None:
            verdict = 'ref'
        else:
            ok = all(r >= floor for r in ratios)
            verdict = 'pass' if ok else 'FAIL'
            if not ok:
                misses.append('%s: --%s %s (floor %.1f)' % (label, name, ' / '.join('%.2f' % r for r in ratios), floor))
        print('  %-12s %-9s %s %s %6s  %s' % (name, hexs(rgb), cells[0], cells[1], ('%.1f' % floor) if floor else '', verdict))

    for n in TEXT_4_5:
        row(n, 4.5, [panel, panel2])
    for n in TEXT_3_0:
        row(n, 3.0, [panel, panel2])
    row('accent-ink', None, [panel, panel2])
    print('  %-12s %-9s %8s %8s %6s  %s' % ('', '', 'accent', 'bad', '', ''))
    ink = col('accent-ink')
    if ink is not None and accent is not None:
        r = contrast(ink, accent)
        ok = r >= 4.5
        print('  %-12s %-9s %8.2f %8s %6s  %s' % ('accent-ink', hexs(ink), r, '', '4.5', 'pass' if ok else 'FAIL'))
        if not ok:
            misses.append('%s: --accent-ink on --accent %.2f (floor 4.5)' % (label, r))
    bink = col('bad-ink')
    if bink is not None and bad is not None:
        r = contrast(bink, bad)
        ok = r >= 4.5
        print('  %-12s %-9s %8s %8.2f %6s  %s' % ('bad-ink', hexs(bink), '', r, '4.5', 'pass' if ok else 'FAIL'))
        if not ok:
            misses.append('%s: --bad-ink on --bad %.2f (floor 4.5)' % (label, r))
    print('  %-12s %-9s %8s %8s %6s  %s' % ('', '', 'panel', '', '', ''))
    row('line-strong', 3.0, [panel, panel2])
    for n in SERIES:
        row(n, 3.0, [panel])
    # chip text sits on a 10% tint of its own color over the surface
    # (.chip-good etc. mix the token with transparent 90%); on a --panel2
    # card that tint is the darkest case in light themes
    print('  %-12s %-9s %8s %8s %6s  %s' % ('', '', 'tint/p', 'tint/p2', '', ''))
    for n in ['good', 'warn', 'bad', 'info', 'ivl']:
        c = col(n)
        if c is None or panel is None or panel2 is None:
            continue
        def tint(surface, c=c):
            return tuple(c[i] * 0.10 + surface[i] * 0.90 for i in range(3))
        rs = [contrast(c, tint(panel)), contrast(c, tint(panel2))]
        ok = all(r >= 4.5 for r in rs)
        print('  %-12s %-9s %8.2f %8.2f %6s  %s' % (n + ' chip', hexs(c), rs[0], rs[1], '4.5', 'pass' if ok else 'FAIL'))
        if not ok:
            misses.append('%s: --%s on its chip tint %s (floor 4.5)' % (label, n, ' / '.join('%.2f' % r for r in rs)))
    if missing:
        print('  missing tokens: %s' % ', '.join(sorted(set(missing))))
    return misses


def check_twins(blocks):
    """The viewer-scheme fallbacks must equal their explicit twins."""
    misses = []
    by_label = {}
    for sel, label, twin in BLOCKS:
        by_label[label] = (sel, twin)
    for sel, label, twin in BLOCKS:
        if not twin:
            continue
        a = blocks.get(sel, {})
        tsel = [s for s, l, t in BLOCKS if l == twin][0]
        b = blocks.get(tsel, {})
        a_tokens = {k: v for k, v in a.items() if not k.startswith('sw-')}
        diffs = []
        for k in sorted(set(a_tokens) | set(b)):
            if a_tokens.get(k) != b.get(k):
                diffs.append('--%s: %s vs %s' % (k, a_tokens.get(k, '(none)'), b.get(k, '(none)')))
        if diffs:
            misses.append('%s does not mirror %s: %s' % (label, twin, '; '.join(diffs[:6])))
    return misses


def main(argv):
    path = argv[1] if len(argv) > 1 else DEFAULT_CSS
    with open(path, encoding='utf-8') as f:
        css = f.read()
    blocks = parse_blocks(css)
    misses = []
    for sel, label, twin in BLOCKS:
        toks = blocks.get(sel)
        if toks is None:
            misses.append('%s: block not found (%s)' % (label, sel))
            print('\n== %s ==\n  block not found: %s' % (label, sel))
            continue
        misses += audit(label, toks)
    misses += check_twins(blocks)
    print('')
    if misses:
        print('FAIL (%d):' % len(misses))
        for m in misses:
            print('  - ' + m)
        return 1
    print('PASS: every token clears its floor in all blocks, and the viewer-scheme blocks mirror their twins.')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
