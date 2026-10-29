#!/usr/bin/env python3
"""Assemble dashboard.html from pieces/. Usage: make.py [--pieces DIR] [--out FILE]
Order of panels comes from pieces/pieces.json. Each panel has <name>.css and <name>.js."""
import sys, os, json, argparse
here = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument('--pieces', default=os.path.join(here, '..', 'pieces'))
ap.add_argument('--out', default=os.path.join(here, '..', 'dashboard.html'))
ap.add_argument('--only', default='', help='comma-separated piece names to include (others become empty); default all')
a = ap.parse_args()
P = a.pieces
def rd(name): return open(os.path.join(P, name), encoding='utf-8').read()
meta = json.load(open(os.path.join(P, 'pieces.json')))
order = meta['pieces']
# a panel can be script only; "css" then lists the panels that have styles,
# in style order (build/unmake.py writes it when the two orders differ)
css_order = meta.get('css', order)
only = set([x.strip() for x in a.only.split(',') if x.strip()])
def piece(n, ext):
    return rd(n + '.' + ext) if (not only or n in only) else ('/* piece %s left out of this build (--only) */' % n)
parts = [rd('wrapper.html'), '\n', rd('head.html'), '\n<style>\n', rd('foundation.css')]
for n in css_order:
    parts += ['\n/* ===== piece: %s ===== */\n' % n, piece(n, 'css')]
# foundation in its own <script>, then EACH piece in its own <script>: a syntax
# error in one panel file only loses that panel (it stays a ghost) instead of
# blanking the whole page
parts += ['\n</style>\n', rd('shell.html'), '\n<script>\n', rd('foundation.js'), '\n</script>\n']
for n in order:
    parts += ['<script>\n/* ===== piece: %s ===== */\n' % n, piece(n, 'js'), '\n</script>\n']
parts += [rd('tail.html')]
html = ''.join(parts)
if '—' in html:
    bad = [i + 1 for i, l in enumerate(html.split('\n')) if '—' in l]
    print('warning: em dash on lines', bad[:20], '(count %d)' % len(bad), file=sys.stderr)
open(a.out, 'w', encoding='utf-8').write(html)
print('wrote', a.out, len(html), 'bytes,', html.count('\n') + 1, 'lines')
