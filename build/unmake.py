#!/usr/bin/env python3
"""Take a built dashboard page apart into pieces/, the reverse of make.py.

Usage: unmake.py <built page.html> <pieces dir>

Use it to bring a page published somewhere else (the live claude.ai copy)
back into the build. It reads the layout make.py writes: one <style> with a
"/* ===== piece: NAME ===== */" marker before each panel's CSS, the
foundation <script>, then one <script> per panel. A panel may have script
and no style; pieces.json then lists the style order under "css".

After writing the pieces it rebuilds them with make.py into a temp file and
checks the result is byte for byte the page it started from.
"""
import json, os, re, subprocess, sys, tempfile

MARK = re.compile(r'\n/\* ===== piece: ([\w-]+) ===== \*/\n')
SCRIPT_MARK = re.compile(r'<script>\n/\* ===== piece: ([\w-]+) ===== \*/\n')


def take(text, sep, what):
    i = text.find(sep)
    if i < 0:
        sys.exit('unmake: could not find %s' % what)
    return text[:i], text[i + len(sep):]


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src, out = sys.argv[1], sys.argv[2]
    text = open(src, encoding='utf-8').read()
    files = {}

    wrapper, rest = take(text, '\n', 'the first line')
    files['wrapper.html'] = wrapper
    files['head.html'], rest = take(rest, '\n<style>\n', 'the <style> tag')
    css, rest = take(rest, '\n</style>\n', 'the </style> tag')
    parts = MARK.split(css)
    files['foundation.css'] = parts[0]
    css_order = []
    for name, body in zip(parts[1::2], parts[2::2]):
        css_order.append(name)
        files[name + '.css'] = body

    files['shell.html'], rest = take(rest, '\n<script>\n', 'the foundation <script>')
    files['foundation.js'], rest = take(rest, '\n</script>\n', 'the end of the foundation script')
    js_order = []
    while True:
        m = SCRIPT_MARK.match(rest)
        if not m:
            break
        name = m.group(1)
        body, rest = take(rest[m.end():], '\n</script>\n', 'the end of piece %s' % name)
        js_order.append(name)
        files[name + '.js'] = body
    files['tail.html'] = rest

    for name in css_order:
        if name not in js_order:
            sys.exit('unmake: piece %s has style but no script' % name)
    meta = {'pieces': js_order}
    if css_order != js_order:
        meta['css'] = css_order

    os.makedirs(out, exist_ok=True)
    for name, body in files.items():
        with open(os.path.join(out, name), 'w', encoding='utf-8') as f:
            f.write(body)
    with open(os.path.join(out, 'pieces.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=2)
        f.write('\n')

    make = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'make.py')
    fd, tmp = tempfile.mkstemp(suffix='.html')
    os.close(fd)
    try:
        subprocess.run([sys.executable, make, '--pieces', out, '--out', tmp], check=True,
                       stdout=subprocess.DEVNULL)
        same = open(tmp, encoding='utf-8').read() == text
    finally:
        os.unlink(tmp)
    print('pieces:', ', '.join(js_order))
    if meta.get('css'):
        print('style order:', ', '.join(css_order))
    print('rebuild matches the source byte for byte' if same else 'WARNING: rebuild differs from the source')
    sys.exit(0 if same else 1)


if __name__ == '__main__':
    main()
