#!/usr/bin/env python3
"""run_matrix.py: screenshot and audit matrix for Career Mission Control panels.

  python3 test/run_matrix.py --port 4800 [--only kpis,pipeline] [--db PATH]
      [--inject FILE.js] [--themes t-dark-ops,t-light-pro,t-bold,t-green]
      [--widths 1280x1000,400x900] [--out DIR] [--keep] [--hash only=kpis]
      [--settle MS] [--budget MS] [--fresh-db] [--ignore-console REGEX]

What it does, in order:
  1. assembles the page with build/make.py into DIR (honoring --only)
  2. copies the db (default a fresh copy of data/db.json) into DIR/db.json
  3. writes DIR/page-test.html: the page plus <pre id="testlog">, <pre id="auditlog">,
     test/audit.js and (with --inject) your click-test script, all before </body>
  4. starts server.py on --port with that db and that page
  5. starts ONE headless Brave with a throwaway profile and drives it over the
     DevTools protocol (the --dump-dom and --screenshot switches of the headless
     command line never return on this machine, so the harness does not use them)
  6. for each theme x width: loads ?cctheme=THEME, waits for the audit, takes a
     screenshot into DIR/shots/THEME-WxH.png, collects console errors; with
     --inject, loads the page again with &inject=1, records your #testlog and,
     once that log has settled, takes DIR/shots/THEME-WxH-inject.png so the state
     your click test leaves behind (an open sheet, drawer or popover) can be seen;
     per theme one more load at 1280 wide with prefers-reduced-motion: reduce
  7. prints a markdown report to stdout, writes DIR/report.md and DIR/results.json
  8. closes the browser and stops the server (unless --keep)

Exit code 0 when everything passed, 1 on any audit failure, console error or load
problem, 2 when the page, the server or the browser could not be set up. The report
and results.json are written on every exit, and on a setup failure the first line
says what went wrong. Python 3 stdlib only.
"""

import argparse
import base64
import json
import os
import re
import select
import shutil
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import time
from urllib.request import Request, urlopen

HERE = os.path.dirname(os.path.abspath(__file__))
DASH = os.path.dirname(HERE)
MAKE = os.path.join(DASH, 'build', 'make.py')
SERVER = os.path.join(DASH, 'server.py')
DB_DEFAULT = os.path.join(DASH, 'data', 'db.json')
AUDIT_JS = os.path.join(HERE, 'audit.js')
THEMES = ['t-dark-ops', 't-light-pro', 't-bold', 't-green']
WIDTHS = ['1280x1000', '400x900']
NSS_LINE = re.compile(r'nss_util|NSS error', re.I)
FAIL_KINDS = ['contrast', 'boundary', 'tap', 'font', 'scroll', 'emdash', 'audit-crash']

# The exact Brave flags. --user-data-dir, --remote-debugging-port and about:blank are added at launch.
BRAVE_FLAGS = ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
               '--disable-background-networking', '--disable-component-update', '--disable-sync',
               '--hide-scrollbars', '--window-size=1280,1000', '--remote-allow-origins=*',
               '--enable-logging=stderr', '--v=0']


def log(msg):
    sys.stderr.write('[matrix %s] %s\n' % (time.strftime('%H:%M:%S'), msg))
    sys.stderr.flush()


class SetupError(Exception):
    pass


# ----- build steps ---------------------------------------------------------
def assemble(out_dir, only):
    page = os.path.join(out_dir, 'dashboard.html')
    cmd = [sys.executable, MAKE, '--out', page]
    if only:
        cmd += ['--only', only]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise SetupError('make.py failed: %s%s' % (r.stdout, r.stderr))
    warn = r.stderr.strip()
    log('assembled %s%s' % (page, (' (%s)' % warn) if warn else ''))
    return page, warn


def atomic_copy(src, dst):
    fd, tmp = tempfile.mkstemp(prefix='.db-', dir=os.path.dirname(dst))
    os.close(fd)
    shutil.copyfile(src, tmp)
    os.replace(tmp, dst)


def build_test_page(page, inject_file, out):
    html = open(page, encoding='utf-8').read()
    audit = open(AUDIT_JS, encoding='utf-8').read()
    block = ('<pre id="testlog" style="display:none"></pre><pre id="auditlog" style="display:none"></pre>\n'
             '<script>\n%s\n</script>\n' % audit)
    if inject_file:
        src = open(inject_file, encoding='utf-8').read()
        if '</script' in src.lower():
            raise SetupError('the --inject file must not contain the text </script>')
        # The click test only runs when the URL says inject=1, so the clean
        # screenshot load and the audit load stay untouched.
        block += '<script>\nif (/[?&]inject=1\\b/.test(location.search)) {\n%s\n}\n</script>\n' % src
    i = html.rfind('</body>')
    if i < 0:
        raise SetupError('no </body> in the assembled page')
    open(out, 'w', encoding='utf-8').write(html[:i] + block + html[i:])
    return out


def port_free(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.5)
    try:
        s.connect(('127.0.0.1', port))
        return False
    except OSError:
        return True
    finally:
        s.close()


def http_json(url, method='GET', timeout=5):
    req = Request(url, method=method)
    with urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


def kill_group(proc, grace=5.0):
    if proc.poll() is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except OSError:
        pass
    end = time.time() + grace
    while time.time() < end and proc.poll() is None:
        time.sleep(0.1)
    if proc.poll() is None:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except OSError:
            pass
        proc.wait(timeout=5)


# ----- the local server ------------------------------------------------------
class Server(object):
    def __init__(self, port, db, page, out_dir):
        self.port, self.db, self.page = port, db, page
        self.logfile = os.path.join(out_dir, 'server.log')
        self.proc = None

    def start(self):
        if not port_free(self.port):
            raise SetupError('port %d is already in use; pick another --port (never 4777)' % self.port)
        f = open(self.logfile, 'ab')
        self.proc = subprocess.Popen([sys.executable, SERVER, '--port', str(self.port), '--db', self.db, '--page', self.page],
                                     cwd=DASH, stdout=f, stderr=f, start_new_session=True)
        end = time.time() + 10
        while time.time() < end:
            if self.proc.poll() is not None:
                raise SetupError('server.py exited early (code %s); see %s' % (self.proc.returncode, self.logfile))
            try:
                h = http_json('http://127.0.0.1:%d/_cmc/health' % self.port, timeout=2)
                if os.path.realpath(h.get('db', '')) != os.path.realpath(self.db):
                    raise SetupError('port %d answers with another db (%s); another server holds it' % (self.port, h.get('db')))
                log('server up on port %d, pid %d, %s docs rev %s' % (self.port, self.proc.pid, h.get('docs'), h.get('rev')))
                return
            except SetupError:
                raise
            except Exception:
                time.sleep(0.25)
        raise SetupError('server did not answer on port %d within 10 s; see %s' % (self.port, self.logfile))

    def stop(self):
        if not self.proc:
            return
        kill_group(self.proc)
        end = time.time() + 5
        while time.time() < end and not port_free(self.port):
            time.sleep(0.2)
        log('server stopped, port %d %s' % (self.port, 'free' if port_free(self.port) else 'STILL BUSY'))


# ----- a tiny WebSocket client for the DevTools protocol -----------------------
class WS(object):
    def __init__(self, url):
        hostport, path = url[len('ws://'):].split('/', 1)
        host, port = hostport.split(':')
        self.s = socket.create_connection((host, int(port)), timeout=30)
        key = base64.b64encode(os.urandom(16)).decode()
        req = ('GET /%s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
               'Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n') % (path, hostport, key)
        self.s.sendall(req.encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            chunk = self.s.recv(4096)
            if not chunk:
                raise IOError('websocket handshake closed')
            buf += chunk
        head, self.rest = buf.split(b'\r\n\r\n', 1)
        if b' 101 ' not in head.split(b'\r\n')[0]:
            raise IOError('websocket handshake failed: %r' % head[:120])
        self.nid = 0
        self.events = []

    def close(self):
        try:
            self.s.close()
        except OSError:
            pass

    def _read(self, n):
        out = b''
        while len(out) < n:
            if self.rest:
                take = self.rest[:n - len(out)]
                self.rest = self.rest[len(take):]
                out += take
                continue
            chunk = self.s.recv(min(65536, n - len(out)))
            if not chunk:
                raise IOError('websocket closed')
            out += chunk
        return out

    def send_text(self, text):
        data = text.encode('utf-8')
        n = len(data)
        hdr = bytearray([0x81])
        if n < 126:
            hdr.append(0x80 | n)
        elif n < 65536:
            hdr.append(0x80 | 126)
            hdr += struct.pack('>H', n)
        else:
            hdr.append(0x80 | 127)
            hdr += struct.pack('>Q', n)
        mask = os.urandom(4)
        hdr += mask
        self.s.sendall(bytes(hdr) + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv_text(self):
        parts = []
        while True:
            b0, b1 = self._read(2)
            fin, op, n = b0 & 0x80, b0 & 0x0f, b1 & 0x7f
            if n == 126:
                n = struct.unpack('>H', self._read(2))[0]
            elif n == 127:
                n = struct.unpack('>Q', self._read(8))[0]
            if b1 & 0x80:
                self._read(4)
            payload = self._read(n)
            if op == 0x8:
                raise IOError('websocket closed by browser')
            if op == 0x9:
                self.s.sendall(bytes([0x8a, 0x80]) + os.urandom(4))
                continue
            if op == 0xa:
                continue
            parts.append(payload)
            if fin:
                return b''.join(parts).decode('utf-8')

    def _recv_msg(self, deadline):
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                return None
            if not self.rest:
                r, _, _ = select.select([self.s], [], [], min(remaining, 0.5))
                if not r:
                    continue
            return json.loads(self.recv_text())

    def call(self, method, params=None, timeout=30):
        self.nid += 1
        mid = self.nid
        self.send_text(json.dumps({'id': mid, 'method': method, 'params': params or {}}))
        deadline = time.time() + timeout
        while True:
            msg = self._recv_msg(deadline)
            if msg is None:
                raise IOError('timeout waiting for %s' % method)
            if msg.get('id') == mid:
                if 'error' in msg:
                    raise RuntimeError('%s: %s' % (method, msg['error']))
                return msg.get('result', {})
            if 'method' in msg:
                self.events.append(msg)

    def wait_event(self, name, timeout):
        deadline = time.time() + timeout
        while True:
            msg = self._recv_msg(deadline)
            if msg is None:
                return None
            if 'method' in msg:
                self.events.append(msg)
                if msg['method'] == name:
                    return msg.get('params', {})

    def pump(self, seconds):
        deadline = time.time() + seconds
        while True:
            msg = self._recv_msg(deadline)
            if msg is None:
                return
            if 'method' in msg:
                self.events.append(msg)

    def eval(self, expr, timeout=20):
        r = self.call('Runtime.evaluate', {'expression': expr, 'returnByValue': True}, timeout=timeout)
        return (r.get('result') or {}).get('value')


# ----- the browser ------------------------------------------------------------
class Browser(object):
    def __init__(self, out_dir, binary):
        self.profile = os.path.join(out_dir, 'profile')
        self.stderr_path = os.path.join(out_dir, 'brave-stderr.txt')
        self.binary = binary
        self.proc = None
        self.port = None
        self.version = ''

    def start(self):
        shutil.rmtree(self.profile, ignore_errors=True)
        os.makedirs(self.profile)
        cmd = [self.binary] + BRAVE_FLAGS + ['--user-data-dir=' + self.profile, '--remote-debugging-port=0', 'about:blank']
        err = open(self.stderr_path, 'wb')
        try:
            self.proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=err, start_new_session=True)
        except OSError as e:
            raise SetupError('could not start %s: %s' % (self.binary, e))
        active = os.path.join(self.profile, 'DevToolsActivePort')
        end = time.time() + 25
        while time.time() < end:
            if self.proc.poll() is not None:
                raise SetupError('Brave exited early (code %s); see %s' % (self.proc.returncode, self.stderr_path))
            try:
                with open(active) as f:
                    self.port = int(f.readline().strip())
                break
            except (OSError, ValueError):
                time.sleep(0.25)
        if not self.port:
            raise SetupError('Brave never wrote DevToolsActivePort; see %s' % self.stderr_path)
        v = http_json('http://127.0.0.1:%d/json/version' % self.port)
        self.version = '%s, %s' % (v.get('Browser', '?'), v.get('User-Agent', '?'))
        log('browser up: %s (devtools port %d)' % (v.get('Browser', '?'), self.port))

    def new_page(self):
        t = http_json('http://127.0.0.1:%d/json/new?about:blank' % self.port, method='PUT')
        ws = WS(t['webSocketDebuggerUrl'])
        ws.target_id = t['id']
        return ws

    def close_page(self, ws):
        ws.close()
        try:
            urlopen('http://127.0.0.1:%d/json/close/%s' % (self.port, ws.target_id), timeout=5).read()
        except Exception:
            pass

    def close(self):
        if not self.proc:
            return
        try:
            v = http_json('http://127.0.0.1:%d/json/version' % self.port, timeout=3)
            b = WS(v['webSocketDebuggerUrl'])
            b.call('Browser.close', timeout=5)
            b.close()
        except Exception:
            pass
        try:
            self.proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            pass
        kill_group(self.proc)
        log('browser closed (exit %s)' % self.proc.returncode)


# ----- one page load ------------------------------------------------------------
def console_entry(ev):
    m, p = ev['method'], ev.get('params', {})
    if m == 'Runtime.consoleAPICalled':
        t = p.get('type', 'log')
        level = 'error' if t in ('error', 'assert') else ('warning' if t == 'warning' else 'info')
        text = ' '.join(str(a.get('value', a.get('description', a.get('type', '')))) for a in p.get('args', []))
        frames = (p.get('stackTrace') or {}).get('callFrames') or []
        where = '%s:%s' % (frames[0].get('url', '')[-50:], frames[0].get('lineNumber')) if frames else ''
        return {'level': level, 'text': text[:300], 'where': where, 'source': 'console.' + t}
    if m == 'Runtime.exceptionThrown':
        d = p.get('exceptionDetails', {})
        ex = d.get('exception') or {}
        text = ex.get('description') or d.get('text') or 'Uncaught exception'
        return {'level': 'error', 'text': text.split('\n')[0][:300], 'where': '%s:%s' % ((d.get('url') or '')[-50:], d.get('lineNumber')), 'source': 'uncaught'}
    if m == 'Log.entryAdded':
        e = p.get('entry', {})
        lvl = e.get('level')
        level = 'error' if lvl == 'error' else ('warning' if lvl == 'warning' else 'info')
        return {'level': level, 'text': (e.get('text') or '')[:300], 'where': (e.get('url') or '')[-80:], 'source': 'log.' + str(e.get('source'))}
    return None


def load_page(browser, url, width, height, reduced, want_inject, settle_ms, budget_ms, shot_path, ignore_rx):
    """Load url in a fresh tab, wait for the audit (and the inject log), screenshot, collect console."""
    res = {'url': url, 'width': width, 'height': height, 'reduced': reduced, 'problems': [], 'console': [],
           'audit': None, 'testlog': None, 'testlog_raw': '', 'shot': None}
    ws = browser.new_page()
    try:
        ws.call('Page.enable')
        ws.call('Runtime.enable')
        ws.call('Log.enable')
        ws.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': False})
        if reduced:
            ws.call('Emulation.setEmulatedMedia', {'features': [{'name': 'prefers-reduced-motion', 'value': 'reduce'}]})
        ws.call('Page.navigate', {'url': url})
        if ws.wait_event('Page.loadEventFired', 30) is None:
            res['problems'].append('load event did not fire within 30 s')
        t_load = time.time()
        deadline = t_load + budget_ms / 1000.0
        min_wait = t_load + settle_ms / 1000.0
        last_t, last_change = None, time.time()
        while True:
            ws.pump(0.25)
            a, t = ws.eval('(document.getElementById("auditlog")||{}).textContent||""'), ws.eval('(document.getElementById("testlog")||{}).textContent||""')
            if t != last_t:
                last_t, last_change = t, time.time()
            audit_done = bool(a)
            inject_done = (not want_inject) or (bool(t) and time.time() - last_change >= 1.5)
            if time.time() >= min_wait and audit_done and inject_done:
                break
            if time.time() >= deadline:
                if not audit_done:
                    res['problems'].append('audit never wrote #auditlog within %d ms' % budget_ms)
                if want_inject and not t:
                    res['problems'].append('inject script never wrote #testlog within %d ms' % budget_ms)
                break
        if a:
            try:
                res['audit'] = json.loads(a)
            except ValueError as e:
                res['problems'].append('audit output is not JSON: %s' % e)
        if t:
            res['testlog_raw'] = t
            try:
                res['testlog'] = json.loads(t)
            except ValueError:
                res['testlog'] = None
        if shot_path:
            png = base64.b64decode(ws.call('Page.captureScreenshot', {'format': 'png'}, timeout=60)['data'])
            open(shot_path, 'wb').write(png)
            res['shot'] = shot_path
        ws.pump(0.3)
    except Exception as e:
        res['problems'].append('browser error: %s' % e)
    finally:
        for ev in ws.events:
            c = console_entry(ev)
            if c and c['level'] != 'info':
                c['ignored'] = bool(ignore_rx and ignore_rx.search(c['text'] + ' ' + c['where']))
                res['console'].append(c)
        browser.close_page(ws)
    return res


# ----- report -------------------------------------------------------------------
def md(s):
    return str(s).replace('|', '\\|').replace('\n', ' ')


def dedupe(items):
    seen, out = {}, []
    for f in items:
        key = json.dumps([f.get(k) for k in ('kind', 'path', 'text', 'fg', 'bg', 'ratio', 'best', 'w', 'h', 'size')])
        if key in seen:
            seen[key]['n'] += 1
        else:
            seen[key] = dict(f, n=1)
            out.append(seen[key])
    return out


def detail(f):
    k = f.get('kind')
    if k == 'contrast':
        return '%s on %s = %s (needs %s, %spx w%s)' % (f.get('fg'), f.get('bg'), f.get('ratio'), f.get('needed'), f.get('size'), f.get('weight'))
    if k == 'boundary':
        return 'border %s, outline %s, bg vs parent %s; best %s needs 3.0; %s' % (f.get('border'), f.get('outline'), f.get('bgvs'), f.get('best'), f.get('note'))
    if k == 'tap':
        return '%sx%s px, needs 24x24' % (f.get('w'), f.get('h'))
    if k == 'tap-soft':
        return '%sx%s px, wants 40 tall' % (f.get('w'), f.get('h'))
    if k == 'font':
        return '%spx, floor %spx' % (f.get('size'), f.get('needed'))
    if k == 'scroll':
        return 'scrollWidth %s > viewport %s' % (f.get('scrollWidth'), f.get('viewport'))
    return ''


def console_errors(load):
    return [c for c in load['console'] if c['level'] == 'error' and not c.get('ignored')]


def write_report(ctx, runs):
    L = []
    total_fail = sum(len((r['clean']['audit'] or {}).get('failures', [])) for r in runs)
    total_cons = sum(len(console_errors(ld)) for r in runs for ld in r['loads'])
    total_prob = sum(len(ld['problems']) for r in runs for ld in r['loads'])
    ok = total_fail == 0 and total_cons == 0 and total_prob == 0 and not ctx.get('setup_error')
    L.append('# Matrix report, %s' % time.strftime('%Y-%m-%d %H:%M'))
    L.append('')
    if ctx.get('setup_error'):
        L.append('- RESULT: **SETUP ERROR** %s (%d of %d planned loads ran before it)' % (md(ctx['setup_error']), sum(len(r['loads']) for r in runs), ctx.get('planned', 0)))
    else:
        L.append('- RESULT: **%s** (%d audit failures, %d console errors, %d load problems)' % ('PASS' if ok else 'FAIL', total_fail, total_cons, total_prob))
    L.append('- pieces: %s' % (ctx['only'] or 'all'))
    L.append('- page: %s%s' % (('`%s`' % ctx['page']) if ctx.get('page') else 'not assembled', (' (make.py said: %s)' % ctx['make_warn']) if ctx.get('make_warn') else ''))
    L.append('- db: %s (copied from `%s`)' % (('`%s`' % ctx['db']) if ctx.get('db') else 'not copied', ctx['db_src']))
    L.append('- server: http://127.0.0.1:%d %s' % (ctx['port'], ctx['server_note'] or 'never started'))
    L.append('- browser: %s' % (ctx['browser'] or 'never started'))
    L.append('- driver: DevTools protocol over one headless Brave; profile `%s`; stderr `%s` (%s)' % (ctx.get('profile') or 'none', ctx.get('stderr_path') or 'none', ctx['stderr_note'] or 'no browser log'))
    L.append('- inject: %s' % (('`%s`' % ctx['inject']) if ctx['inject'] else 'none'))
    L.append('- themes: %s; widths: %s; url suffix: %s' % (', '.join(ctx['themes']), ', '.join(ctx['widths']), ctx['hash'] or 'none'))
    L.append('')
    L.append('## Summary')
    L.append('')
    L.append('| theme | width | checked | failures | contrast | boundary | tap | font | scroll | emdash | warnings | console errors | screenshots |')
    L.append('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for r in runs:
        a = r['clean']['audit'] or {}
        c = a.get('counts', {})
        cons = sum(len(console_errors(ld)) for ld in r['loads'])
        shots = [('`%s`' % os.path.relpath(ld['shot'], ctx['out'])) for ld in r['loads'] if ld.get('shot') and ld['label'] != 'reduced-motion']
        L.append('| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |' % (
            r['theme'], r['width'], a.get('checked', '?'), len(a.get('failures', [])) if a else 'no audit',
            c.get('contrast', 0), c.get('boundary', 0), c.get('tap', 0), c.get('font', 0), c.get('scroll', 0), c.get('emdash', 0),
            len(a.get('warnings', [])), cons, ', '.join(shots) or 'none'))
    L.append('')
    for r in runs:
        clean, a = r['clean'], r['clean']['audit'] or {}
        L.append('## %s at %s' % (r['theme'], r['width']))
        L.append('')
        L.append('- screenshot: `%s`' % (clean.get('shot') or 'none'))
        if r.get('inject'):
            L.append('- inject screenshot (after your #testlog settled): `%s`' % (r['inject'].get('shot') or 'none'))
        if r.get('reduced'):
            L.append('- reduced motion screenshot: `%s`' % (r['reduced'].get('shot') or 'none'))
        if a:
            tk = a.get('tokens', {})
            L.append('- page: title "%s"; data-cctheme %s; live pill "%s"; panels %s real, %s ghost; headless shim %s' % (
                a.get('title'), a.get('theme'), a.get('live'), a.get('panels', {}).get('real'), a.get('panels', {}).get('ghost'), 'yes' if a.get('headless') else 'NO'))
            L.append('- tokens: --accent %s, --fg %s, --panel %s, --line %s, --line-strong %s' % (tk.get('accent'), tk.get('fg'), tk.get('panel'), tk.get('line'), tk.get('lineStrong')))
            sk = a.get('skipped', {})
            L.append('- checked %s elements (skipped %s invisible, %s disabled, %s without text); scrollWidth %s of viewport %s; em dashes %s' % (
                a.get('checked'), sk.get('invisible'), sk.get('disabled'), sk.get('noText'), a.get('scrollWidth'), a.get('viewport', {}).get('w'), a.get('emdash', {}).get('count')))
            L.append('- failures: %d %s; warnings: %d %s' % (len(a.get('failures', [])), json.dumps(a.get('counts', {})), len(a.get('warnings', [])), json.dumps(a.get('warningCounts', {}))))
            if a.get('error'):
                L.append('- AUDIT CRASHED: %s' % md(a['error'])[:300])
        for ld in r['loads']:
            for p in ld['problems']:
                L.append('- PROBLEM (%s): %s' % (ld['label'], md(p)))
        L.append('')
        fails = dedupe(a.get('failures', []))
        if fails:
            L.append('### Failures')
            L.append('')
            L.append('| kind | where | text | detail |')
            L.append('|---|---|---|---|')
            for f in fails:
                L.append('| %s | %s: %s | "%s" | %s%s |' % (f.get('kind'), f.get('panel'), md(f.get('path')), md(f.get('text')), md(detail(f)), (' x%d' % f['n']) if f['n'] > 1 else ''))
            L.append('')
        warns = dedupe(a.get('warnings', []))
        if warns:
            L.append('### Warnings (do not fail the run)')
            L.append('')
            for w in warns:
                L.append('- %s: %s: %s "%s" %s%s' % (w.get('kind'), w.get('panel'), md(w.get('path')), md(w.get('text')), detail(w), (' x%d' % w['n']) if w['n'] > 1 else ''))
            L.append('')
        cons = [(ld['label'], c) for ld in r['loads'] for c in ld['console']]
        if cons:
            L.append('### Console (errors and warnings)')
            L.append('')
            for label, c in cons:
                L.append('- [%s%s] (%s) %s %s' % (c['level'], ' ignored' if c.get('ignored') else '', label, md(c['text']), ('(%s)' % md(c['where'])) if c['where'] else ''))
            L.append('')
        if r.get('inject'):
            inj = r['inject']
            L.append('### Inject log')
            L.append('')
            if inj['testlog'] is not None:
                L.append('```json')
                L.append(json.dumps(inj['testlog'], indent=1)[:6000])
                L.append('```')
            elif inj['testlog_raw']:
                L.append('(not JSON) `%s`' % md(inj['testlog_raw'][:1000]))
            else:
                L.append('(the inject script wrote nothing to #testlog)')
            L.append('')
    return '\n'.join(L) + '\n', ok


def parse_stderr(path):
    """Browser stderr: count CONSOLE lines, list Uncaught ones, ignore the NSS cert line."""
    cons, uncaught, other = 0, [], 0
    try:
        for line in open(path, encoding='utf-8', errors='replace'):
            if 'CONSOLE' in line:
                cons += 1
                if 'Uncaught' in line:
                    uncaught.append(line.strip()[:200])
            elif ':ERROR:' in line and not NSS_LINE.search(line):
                other += 1
    except OSError:
        return 'not readable'
    note = '%d console lines, %d uncaught, %d other error lines, NSS cert line ignored' % (cons, len(uncaught), other)
    return note


# ----- main ----------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description='Screenshot and audit matrix for Career Mission Control panels.')
    ap.add_argument('--port', type=int, required=True, help='server port for this run (never 4777, that is the live board)')
    ap.add_argument('--only', default='', help='comma-separated piece names to assemble; others stay ghosts')
    ap.add_argument('--db', default=DB_DEFAULT, help='db.json to copy into the run (default data/db.json)')
    ap.add_argument('--inject', default='', help='a .js click-test file; injected as a second script block')
    ap.add_argument('--themes', default=','.join(THEMES))
    ap.add_argument('--widths', default=','.join(WIDTHS), help='WxH list, default 1280x1000,400x900')
    ap.add_argument('--out', default='', help='output dir (default $TMPDIR/cmc-matrix-<port>)')
    ap.add_argument('--keep', action='store_true', help='leave the server running at the end')
    ap.add_argument('--hash', default='', help='URL fragment to append, for example only=kpis')
    ap.add_argument('--settle', type=int, default=2500, help='ms to wait after load before the screenshot (default 2500)')
    ap.add_argument('--budget', type=int, default=12000, help='max ms to wait for the audit and the inject log (default 12000)')
    ap.add_argument('--fresh-db', action='store_true', help='restore the db from the source copy before every inject load')
    ap.add_argument('--ignore-console', default='', help='regex; matching console errors are listed but do not fail the run')
    ap.add_argument('--brave', default='brave-browser', help='browser binary (default brave-browser)')
    ap.add_argument('--no-reduced', action='store_true', help='skip the reduced-motion screenshots')
    args = ap.parse_args()

    if args.port == 4777:
        sys.exit('refusing --port 4777: that is the live board the user is watching')
    themes = [t.strip() for t in args.themes.split(',') if t.strip()]
    bad = [t for t in themes if t not in THEMES]
    if bad:
        sys.exit('unknown theme(s) %s; known: %s' % (bad, ', '.join(THEMES)))
    widths = []
    for w in args.widths.split(','):
        m = re.match(r'^\s*(\d+)x(\d+)\s*$', w)
        if not m:
            sys.exit('bad --widths entry %r, want WxH like 1280x1000' % w)
        widths.append((int(m.group(1)), int(m.group(2))))
    out_dir = os.path.abspath(args.out or os.path.join(tempfile.gettempdir(), 'cmc-matrix-%d' % args.port))
    os.makedirs(os.path.join(out_dir, 'shots'), exist_ok=True)
    if args.inject and not os.path.isfile(args.inject):
        sys.exit('inject file not found: %s' % args.inject)
    ignore_rx = re.compile(args.ignore_console) if args.ignore_console else None
    log('output dir %s' % out_dir)

    server = browser = None
    runs = []
    ctx = {'only': args.only, 'out': out_dir, 'port': args.port, 'inject': os.path.abspath(args.inject) if args.inject else '',
           'themes': themes, 'widths': ['%dx%d' % w for w in widths], 'hash': args.hash, 'server_note': '', 'browser': '', 'stderr_note': '',
           'page': '', 'db': '', 'db_src': os.path.abspath(args.db), 'make_warn': '', 'profile': '', 'stderr_path': '', 'setup_error': '',
           'planned': len(themes) * len(widths) * (2 if args.inject else 1) + (0 if args.no_reduced else len(themes))}
    try:
        page, ctx['make_warn'] = assemble(out_dir, args.only)
        db = os.path.join(out_dir, 'db.json')
        db_src = os.path.join(out_dir, 'db-source.json')
        shutil.copyfile(args.db, db_src)
        atomic_copy(db_src, db)
        ctx['db'], ctx['db_src'] = db, os.path.abspath(args.db)
        ctx['page'] = build_test_page(page, args.inject, os.path.join(out_dir, 'page-test.html'))
        server = Server(args.port, db, ctx['page'], out_dir)
        server.start()
        browser = Browser(out_dir, args.brave)
        browser.start()
        ctx['browser'], ctx['profile'], ctx['stderr_path'] = browser.version, browser.profile, browser.stderr_path
        base = 'http://127.0.0.1:%d/?cctheme=' % args.port
        frag = ('#' + args.hash) if args.hash else ''
        for theme in themes:
            for (w, h) in widths:
                tag = '%s-%dx%d' % (theme, w, h)
                log('load %s' % tag)
                clean = load_page(browser, base + theme + frag, w, h, False, False, args.settle, args.budget,
                                  os.path.join(out_dir, 'shots', tag + '.png'), ignore_rx)
                clean['label'] = 'clean'
                run = {'theme': theme, 'width': '%dx%d' % (w, h), 'clean': clean, 'loads': [clean], 'inject': None, 'reduced': None}
                if args.inject:
                    if args.fresh_db:
                        atomic_copy(db_src, db)
                        time.sleep(1.3)
                    log('load %s with inject' % tag)
                    inj = load_page(browser, base + theme + '&inject=1' + frag, w, h, False, True, args.settle, args.budget,
                                    os.path.join(out_dir, 'shots', tag + '-inject.png'), ignore_rx)
                    inj['label'] = 'inject'
                    run['inject'] = inj
                    run['loads'].append(inj)
                runs.append(run)
            if not args.no_reduced:
                w, h = max(widths, key=lambda x: x[0])
                tag = '%s-%dx%d-reduced-motion' % (theme, w, h)
                log('load %s' % tag)
                red = load_page(browser, base + theme + frag, w, h, True, False, args.settle, args.budget,
                                os.path.join(out_dir, 'shots', tag + '.png'), ignore_rx)
                red['label'] = 'reduced-motion'
                for r in runs:
                    if r['theme'] == theme and r['width'] == '%dx%d' % (w, h):
                        r['reduced'] = red
                        r['loads'].append(red)
    except SetupError as e:
        # Recorded, not raised: the report below says what went wrong and the exit code is 2.
        ctx['setup_error'] = str(e)
        log('SETUP ERROR: %s' % e)
    finally:
        if browser:
            if browser.proc and browser.proc.poll() is None:
                browser.close()
            ctx['profile'] = browser.profile
            if os.path.exists(browser.stderr_path):
                ctx['stderr_path'] = browser.stderr_path
                ctx['stderr_note'] = parse_stderr(browser.stderr_path)
        if server and server.proc:
            if args.keep:
                ctx['server_note'] = 'still running, pid %d; stop with: kill %d' % (server.proc.pid, server.proc.pid)
                log('server kept running on port %d (pid %d)' % (args.port, server.proc.pid))
            else:
                server.stop()
                ctx['server_note'] = 'stopped at the end of the run'

    text, ok = write_report(ctx, runs)
    open(os.path.join(out_dir, 'report.md'), 'w', encoding='utf-8').write(text)
    with open(os.path.join(out_dir, 'results.json'), 'w', encoding='utf-8') as f:
        json.dump({'context': ctx, 'runs': runs}, f, indent=1)
    sys.stdout.write(text)
    sys.stdout.write('\nreport: %s\nresults: %s\n' % (os.path.join(out_dir, 'report.md'), os.path.join(out_dir, 'results.json')))
    sys.exit(2 if ctx['setup_error'] else (0 if ok else 1))


if __name__ == '__main__':
    main()
