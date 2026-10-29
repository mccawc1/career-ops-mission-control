#!/usr/bin/env python3
"""One-time: split dashboard.html into pieces/ (foundation + one css/js pair per panel).
Usage: split.py <dashboard.html> <pieces dir>"""
import re, sys, os, json
src_path, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
text = open(src_path, encoding='utf-8').read()
lines = text.split('\n')
# locate boundaries
i_style = next(i for i, l in enumerate(lines) if l.strip() == '<style>' and i > 0)
i_style_end = next(i for i, l in enumerate(lines) if l.strip() == '</style>')
i_script = next(i for i, l in enumerate(lines) if l.strip() == '<script>')
i_script_end = next(i for i, l in enumerate(lines) if l.strip() == '</script>')
marker = re.compile(r'^/\* ===== piece: ([\w-]+) ===== \*/$')
def split_block(block_lines, ext):
    chunks, cur, name = [], [], 'foundation'
    for l in block_lines:
        m = marker.match(l)
        if m:
            chunks.append((name, cur)); name, cur = m.group(1), []
        else:
            cur.append(l)
    chunks.append((name, cur))
    order = []
    for n, c in chunks:
        open(os.path.join(out, f'{n}.{ext}'), 'w', encoding='utf-8').write('\n'.join(c))
        if n != 'foundation': order.append(n)
    return order
open(os.path.join(out, 'wrapper.html'), 'w', encoding='utf-8').write(lines[0])
open(os.path.join(out, 'head.html'), 'w', encoding='utf-8').write('\n'.join(lines[1:i_style]))
css_order = split_block(lines[i_style + 1:i_style_end], 'css')
open(os.path.join(out, 'shell.html'), 'w', encoding='utf-8').write('\n'.join(lines[i_style_end + 1:i_script]))
js_order = split_block(lines[i_script + 1:i_script_end], 'js')
open(os.path.join(out, 'tail.html'), 'w', encoding='utf-8').write('\n'.join(lines[i_script_end + 1:]))
assert css_order == js_order, (css_order, js_order)
json.dump({'pieces': css_order}, open(os.path.join(out, 'pieces.json'), 'w'), indent=2)
print('pieces:', css_order)
