# Panel test harness

Three files, Python 3 stdlib plus headless Brave, no Node, no Playwright:

- `run_matrix.py` assembles a page from `pieces/`, serves it with a private copy
  of the db, drives one headless Brave through every theme and width, and
  writes a markdown report with screenshots, audit failures, console errors and
  the log of your click test.
- `audit.js` runs inside the page about 2 s after load and checks contrast,
  control boundaries, tap targets, font sizes, horizontal overflow, em dashes
  and the theme tokens. It writes one JSON object into `<pre id="auditlog">`.
- this README.

Never run this against port 4777. That is the live board Chris is watching.
Use the port you were given (and that port plus 10 for a second run).

## Run it

```
cd "the project folder"

# everything: all pieces, four themes, two widths, plus reduced-motion shots
python3 test/run_matrix.py --port 4800 --out "$S/ws-NAME/matrix"

# only your pieces (others stay "standing by" ghosts), and hide the ghosts with #only=
python3 test/run_matrix.py --port 4800 --only tracker --hash only=tracker --out "$S/ws-NAME/matrix"

# a click test (see below), on one theme and both widths, fast
python3 test/run_matrix.py --port 4800 --only tracker --inject "$S/ws-NAME/clicks.js" \
    --themes t-dark-ops --widths 1280x1000,400x900 --no-reduced --out "$S/ws-NAME/clicks"

# a db with your own test rows
python3 test/run_matrix.py --port 4800 --db "$S/ws-NAME/db.json" --out "$S/ws-NAME/matrix"
```

Options:

| flag | meaning |
|---|---|
| `--port N` | required; the server port for this run (refuses 4777) |
| `--only a,b` | piece names passed to `build/make.py --only`; everything else stays a ghost |
| `--db PATH` | the db to copy into the run; default `data/db.json`. The run never writes to the source |
| `--inject FILE.js` | your click test, injected as a second script block (runs only on the `&inject=1` loads) |
| `--themes` | default `t-dark-ops,t-light-pro,t-bold,t-green` |
| `--widths` | default `1280x1000,400x900` |
| `--out DIR` | where everything lands; default `$TMPDIR/cmc-matrix-<port>` |
| `--hash STR` | fragment appended to the URL, for example `only=kpis` |
| `--keep` | leave the server running when the run ends (the browser always closes) |
| `--settle MS` | wait after load before the screenshot, default 2500 |
| `--budget MS` | longest wait for the audit and your inject log, default 12000 |
| `--fresh-db` | put the source db back before every inject load, so click tests start from the same rows |
| `--ignore-console REGEX` | console errors matching this are listed but do not fail the run |
| `--no-reduced` | skip the reduced-motion screenshots (faster) |

The run takes about 5 s per page load: themes x widths loads, one more per
theme for reduced motion, and one more per theme x width with `--inject`.
The full default matrix is 12 loads, about a minute.

What lands in `--out DIR`:

```
dashboard.html      the assembled page (make.py output)
page-test.html      the served page: dashboard.html + testlog/auditlog pres + audit.js (+ your inject)
db.json             the private db this run served (click tests write here)
db-source.json      untouched copy of the db you passed in
shots/THEME-WxH.png                     one per theme x width (the clean load)
shots/THEME-WxH-inject.png              one per theme x width with --inject, taken
                                        after your #testlog settled
shots/THEME-1280x1000-reduced-motion.png one per theme (widest width)
report.md           the markdown report (also printed to stdout)
results.json        everything the report was built from, including every failure
server.log          server.py output
brave-stderr.txt    the browser's own log (--enable-logging=stderr)
profile/            throwaway browser profile, fresh every run
```

Exit code: 0 when every audit passed and no console error fired, 1 otherwise,
2 when the page could not be assembled or the server or the browser could not
start. `report.md` and `results.json` are written on every exit; on a 2 the
first line reads `RESULT: SETUP ERROR <reason>` and `results.json` carries it
as `context.setup_error`. The server is still stopped on that path (unless
`--keep`), and the browser log is still summarized when Brave got far enough
to write one.

## Read the report

The first line is the verdict: `RESULT: PASS` or `FAIL (n audit failures, m
console errors, k load problems)`. Then a summary table, one row per theme x
width, then a section per combination.

Failure kinds (each one fails the run):

| kind | rule | detail column |
|---|---|---|
| `contrast` | text vs its effective background: 4.5:1, or 3:1 when 24px+ or 18.66px+ bold | `fg on bg = ratio (needs n, size, weight)` |
| `boundary` | a control needs 3:1 somewhere: border, resting outline, or its background vs the parent | the three ratios, the best one, and `no visible boundary` or `boundary too faint` |
| `tap` | a control smaller than 24 x 24 px | `w x h` |
| `font` | text under 12px, or under 11px in a mono face | size and floor |
| `scroll` | `scrollWidth` wider than the viewport (phone width overflow) | both numbers |
| `emdash` | an em dash in visible text, a title, an aria-label or a placeholder | the snippet |
| `audit-crash` | audit.js itself threw; the message is in the section | |

`where` is `panel: tag.class#id > ... > tag.class` (up to five levels, three
classes each). The panel is the `data-panel` of the slot, or `cmdbar`,
`footer`, `page`. Identical lines are collapsed with ` x7`; `results.json`
keeps every one.

Warnings do not fail the run: `tap-soft` is a control under 40px tall (a
compact table select at 36px is excused). Fix them anyway, the brief asks for
40px controls.

With `--inject`, each section also names the inject screenshot, and the
summary table's last column lists both PNGs.

Each section also records: the document title, `data-cctheme`, the live pill
text, how many panel slots are real vs ghost, whether the shim took its
headless path, the computed `--accent`, `--fg`, `--panel`, `--line` and
`--line-strong` (`(unset)` when the theme does not define it), how many
elements were checked and skipped (invisible, disabled, no text), and the em
dash count.

Console: every error and warning from the DevTools protocol, with its source
(`console.error`, `uncaught`, `log.network` for a failed request) and
`file:line`. Errors fail the run. The browser's own stderr is kept in
`brave-stderr.txt` (CONSOLE lines counted; the NSS cert line ignored).

Problems: a load that never fired `load`, an audit that never wrote, or an
inject script that never wrote `#testlog` within `--budget`. These fail the run.

Reading the screenshots is on you: open each PNG and look at it as a picky
designer. The audit cannot see layout, hierarchy or taste.

## Write a click test (`--inject`)

Your file is plain ES5 that runs inside the page, after `audit.js`, only on
the inject loads (the URL carries `&inject=1`; the harness wraps your code in
`if (/[?&]inject=1\b/.test(location.search)) { ... }`). Clean screenshot loads
never run it. Write JSON into `<pre id="testlog">`; the harness waits until
that text stops changing for 1.5 s (or `--budget` runs out), then prints it
under "Inject log" for each theme x width.

The pattern:

```js
(function () {
  var log = [];
  function say(x) { log.push(x); document.getElementById('testlog').textContent = JSON.stringify(log); }
  function q(sel) { return document.querySelector('[data-panel="tracker"] ' + sel); }

  setTimeout(function () {                       // 1. let the panel render
    var sel = q('select.tr-status');
    say({ step: 'found', select: !!sel });
    if (!sel) return;
    sel.value = 'Interview';                       // 2. drive a dropdown
    sel.dispatchEvent(new Event('change', { bubbles: true }));

    setTimeout(function () {                       // 3. let the optimistic write land
      fetch('/api/docs/applications/spiralyze-project-manager')
        .then(function (r) { return r.json(); })
        .then(function (d) { say({ step: 'db', status: d.data && d.data.status }); })
        .then(function () {
          var open = q('.btn-open-sheet'); if (open) open.click();
          setTimeout(function () {
            say({ step: 'sheet-open', sheets: document.querySelectorAll('.overlay:not([hidden])').length });
            say({ step: 'audit-with-sheet', failures: window.__cmcRunAudit().failures.length });
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            setTimeout(function () {
              say({ step: 'after-escape', sheets: document.querySelectorAll('.overlay:not([hidden])').length });
            }, 300);
          }, 300);
        });
    }, 700);
  }, 1500);
})();
```

Rules of thumb:

- Timers run in real time here (no virtual clock), so keep chains short: 1500 ms
  for the first render, 500 to 700 ms after each write. The whole chain must
  finish inside `--budget` (12 s by default; raise it for long tests).
- Prove every button and dropdown by reading the db back through
  `fetch('/api/docs/<collection>/<id>')` after the action. The response is
  `{id, exists, version, data, rev}`. Compare against what the label promised.
- A click test runs once per theme x width, against the same `db.json`. Either
  write tests that read their own "before" state, or pass `--fresh-db` so each
  inject load starts from the source rows again.
- `window.__cmcRunAudit()` re-runs the audit on demand and returns the object,
  so you can audit an open sheet, drawer or popover. The audit only reads
  (computed styles, boxes, a text walk) and writes `#auditlog`; it never
  focuses, clicks or dispatches, so it does not close what you opened. Proven
  with the targeting wizard: Edit, audit 900 ms later, sheet still open with
  focus on the name field.
- The inject screenshot (`shots/THEME-WxH-inject.png`) is the viewport as your
  chain leaves it, taken after `#testlog` stopped changing for 1.5 s. Want to
  see the sheet? End the chain with it open. Want to see something below the
  fold? Call `el.scrollIntoView()` first. Keep gaps between `say` calls under
  1.5 s or the harness will decide you are done before your last line lands.
- The harness guarantees `#testlog` and `#auditlog` exist. If you reuse an
  inject file in a script of your own (say, on the harness's CDP client), build
  the page the same way or guard `say` against a missing element: a null
  `#testlog` makes the first `say` throw before your first click, so the thing
  you meant to open never opens and the screenshot shows it closed.
- Escape: dispatch a `keydown` with `key: 'Escape'` on `document` (or on the
  focused element), then check the sheet, drawer or popover is gone.
- Do not put the text `</script>` in the file.
- Do not log secrets or whole documents; `say` small facts.

## Exactly what the browser runs

`--dump-dom` and `--screenshot` on the headless command line never return on
this machine (Brave 155 with a throwaway `--user-data-dir`, fresh or reused;
the process just sits there and the dump never arrives). Without a profile dir
the launch would attach to the user's running Brave and open a GUI tab, which
is never allowed, so the harness does not use those switches at all. It starts one Brave and talks to it over the DevTools protocol
(a 100-line WebSocket client in `run_matrix.py`), one tab per load:

```
brave-browser --headless=new --disable-gpu --no-sandbox --no-first-run --disable-extensions \
  --disable-background-networking --disable-component-update --disable-sync \
  --hide-scrollbars --window-size=1280,1000 --remote-allow-origins=* \
  --enable-logging=stderr --v=0 \
  --user-data-dir=DIR/profile --remote-debugging-port=0 about:blank
```

Per tab: `Page.enable`, `Runtime.enable`, `Log.enable`,
`Emulation.setDeviceMetricsOverride` to the width x height,
`Emulation.setEmulatedMedia` with `prefers-reduced-motion: reduce` for the
reduced-motion loads, `Page.navigate`, wait for `Page.loadEventFired`, poll
`#auditlog` and `#testlog`, `Page.captureScreenshot` (viewport, PNG) on
every load, inject loads included. The
profile is throwaway and never the user's own, so no GUI window can open and
no saved theme pick leaks in. The user agent is `HeadlessChrome/155`, which is
what the shim keys on to poll instead of opening an event stream.

The server is `python3 server.py --port N --db DIR/db.json --page DIR/page-test.html`,
started with its own process group and stopped with SIGTERM at the end (its
pid file is `data/server-<port>.pid`). With `--keep` the report prints the pid
and the kill command; always confirm with `ss -ltnp | grep <port>`.

## What the audit does not do

- Backgrounds come from `background-color` only. Gradients, images and the
  neural canvas are ignored, which is fine for this page because every panel
  is an opaque surface.
- Hover and focus states are not exercised. A resting `outline` counts, a
  `:focus-visible` ring does not. Check focus rings by eye or with a click test
  that calls `el.focus()` then `window.__cmcRunAudit()`.
- Icon-only controls with no border and a transparent background (the theme
  swatches, sort buttons) are reported as `no visible boundary`. Decide by eye
  whether the icon itself is the boundary.
- Text inside `opacity` is composited, so a dimmed chip is judged at what the
  eye sees, not at its token color.
- `color-mix()` colors come back from Chrome as `oklab(...)`; the audit
  converts them. Anything else exotic falls back to a canvas read.
