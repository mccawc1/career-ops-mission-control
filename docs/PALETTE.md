# Career Ops Mission Control, palette

Written October 10, 2026, with the "crisp, epic, optimized" refresh. Revised the same day at 10:40 after the control-boundary and chip-text audit. The four themes, every token name, the status grammar and the chart set `--c1` to `--c6` are unchanged. Only values moved, plus one token added by the refresh, `--line-strong`. `python3 test/contrast.py` audits every block in `pieces/foundation.css` and must pass before a palette change ships; its full output is pasted in section 5.

## 1. Grammar: what each token is for

One line each. If a color is not on this list, it does not exist.

| token | job |
|---|---|
| `--bg` | The page floor. Near-black on the dark themes, cool off-white on light. The neural field paints this color under everything. |
| `--bg2` | The command bar and footer surface: one step above the floor, still below a panel. |
| `--panel` | The opaque surface every panel, sheet, drawer and table sits on. Text contrast is measured here first. |
| `--panel2` | The raised step inside a panel: KPI tiles, table headers, chips, buttons, key caps. Text contrast is measured here too. |
| `--line` | The decorative hairline: panel edges, dividers, band rules, table rules, the resting edge of a status chip. About 1.4:1, meant to be felt, not read. |
| `--line-strong` | The control boundary: inputs, selects, text areas, buttons, filter chips, key caps, KPI tiles. At least 3:1 on both `--panel` and `--panel2` (3.4 to 3.7:1 on the panel, 3.0 to 3.2:1 on the tile), which is what WCAG 1.4.11 asks of a component edge. Most controls sit on a `--panel2` card, so the tile ratio is the one that binds. |
| `--fg` | Primary text. Near-white on dark themes, near-black on light. |
| `--muted` | Secondary text: labels, sublines, helper copy. At least 4.5:1 on both panel steps. |
| `--faint` | Tertiary text: kickers, timestamps, band labels, empty-state hints. At least 4.5:1 on both panel steps, nothing lighter is allowed for text. |
| `--accent` | The one action color: the primary button, the focus ring, the live pill when truly live, the hero number, links. Never on decoration. |
| `--accent-ink` | Text that sits on `--accent`. |
| `--glow` | The accent at low alpha for focus halos and the live dot. Always the accent family. |
| `--good` | Done, sent, healthy, hired. Text, dot and chip tint. |
| `--warn` | Needs Chris: ready to approve, waiting on an answer. Text, dot and chip tint. |
| `--bad` | Rejected, expired, a problem. Text, dot and chip tint. |
| `--bad-ink` | Text that sits on `--bad` (the danger button). |
| `--hot` | Due today, or the "needs your review" glow. A glyph or hairline tone, 3:1 floor. |
| `--info` | In progress, scheduled. Also the link color of the neural field on dark themes. Text, dot and chip tint. |
| `--ivl` | Interview stage. Text, dot and chip tint. |
| `--idle` | Waiting on them, closed, standing by. A dot and border tone, 3:1 floor, never small text. |
| `--c1` to `--c6` | Chart series only, one chart at a time, never state. Validated for color-blind separation, 3:1 on `--panel`. |
| `--hiline` | The 1px inner highlight on raised tiles. |
| `--shadow-panel`, `--shadow-panel-hover` | Panel depth. Unchanged. |
| `--scan` | The scanline tint, transparent on light. Unchanged. |
| `--sw-ops`, `--sw-pro`, `--sw-bold`, `--sw-green` | The four theme swatch coins. Fixed so each coin shows its own theme. |

Status is never color alone: every chip carries a word, every dot sits next to a label.

### Three rules the audit enforces

**The chip-tint rule.** A status chip (`.chip-good`, `.chip-warn`, `.chip-bad`, `.chip-info`, `.chip-ivl`) sets its text to the status token, its background to `color-mix(in oklab, <token>, transparent 90%)` and its border to the same mix at 60%. So the text never sits on `--panel` or `--panel2` directly; it sits on a 10% wash of itself over whichever surface holds the chip. That wash moves the surface toward the text color and costs contrast, most of all on the light theme, where a dark token on a tinted `--panel2` card is the darkest case. The rule: each of the five status tokens must clear 4.5:1 against its own 10% tint over `--panel` and over `--panel2`, in every theme. `test/contrast.py` approximates the oklab mix with a 10/90 sRGB blend and prints these as the `chip` rows. This is why the light status tokens were deepened on October 10 at 10:40: `--good` #157A49 to #126B40, `--warn` #935600 to #8A5000, `--bad` #C62A41 to #B52438, `--info` #0A6F99 to #0B6588. Tightest cases now: bold `--bad` chip 4.51:1 and light `--bad` chip 4.66:1 on the `--panel2` tint.

**The `--line` vs `--line-strong` rule.** If a person can click it, tap it, type in it or focus it, its edge is `--line-strong`. If it only separates or decorates, its edge is `--line`. In foundation that puts `--line-strong` on `.btn`, `.input`, `.select-wrap select`, `textarea.input`, `.add-row input`, `.cmd-search input`, `.chip-btn` and `.elev` (KPI tiles are buttons), and the pieces follow it for their own controls (pipeline stage pills and summary, calendar day cells and entries, platform toggles, the activity "show earlier" button, the career-path goal buttons). `--line` stays on panel edges, `.band-label` rules, `.tbl-wrap`, table header and row rules, the command bar and footer, the proof swatches, and the resting border of a non-interactive `.chip`. `--line-strong` must clear 3:1 on both `--panel` and `--panel2` because buttons, inputs and filter chips mostly live on a `--panel2` card; `--line` has no floor. Never promote `--line` to a control edge to make it "match", and never use `--line-strong` as a divider, because a 3:1 rule next to text reads as a box.

**The agreed boundary exceptions.** `test/audit.js` holds every visible control to a 3:1 boundary (border, resting outline, or its background against the parent). WCAG 1.4.11 asks for a boundary only where one is needed to identify the control, so four cases are excused by agreement and the pass bar is 0 failures and 0 warnings with them in place: `.t-swatch` (the theme swatch coins) and `.jarvis-btn` (the neural toggle) are icon-only buttons whose icon is the boundary; `.tbl th > button` (table sort headers) are text-styled by design, with hover and `aria-sort` carrying the state; native checkbox and radio inputs draw their own box, which the audit cannot read. Nothing else is exempt. A new control that wants onto this list needs the same reasoning written down here and in `audit.js`.

## 2. Token tables with contrast ratios

Ratios are WCAG 2.x, computed from the token values (no rounding in the audit; 2.999 fails). Floors: 4.5 for text on both panel steps, 4.5 for chip text on its own tint over both panel steps, 3.0 for idle and hot on both steps, 3.0 for `--line-strong` on both steps, 3.0 for the chart set on `--panel`. The `chip` rows measure the token against its 10% tint over that surface, not against the bare surface. The viewer-scheme fallback blocks (bare `:root` and the two dark fallbacks) mirror `t-light-pro` and `t-dark-ops` token for token, and the audit checks that too.

### t-dark-ops

Surfaces: `--bg` #060910, `--bg2` #0B111B, `--panel` #101826, `--panel2` #19243A. Steps: bg to panel 1.12:1, panel to panel2 1.15:1.

| token | value | on panel | on panel2 | floor |
|---|---|---|---|---|
| `--fg` | #EEF3FA | 15.95 | 13.90 | 4.5 |
| `--muted` | #97A8C0 | 7.35 | 6.41 | 4.5 |
| `--faint` | #8292AA | 5.62 | 4.90 | 4.5 |
| `--accent` | #FFB42E | 10.01 | 8.72 | 4.5 |
| `--good` | #3BDF93 | 10.30 | 8.98 | 4.5 |
| `--warn` | #FFB42E | 10.01 | 8.72 | 4.5 |
| `--bad` | #FF5F75 | 6.05 | 5.27 | 4.5 |
| `--info` | #4FC7FF | 9.27 | 8.08 | 4.5 |
| `--ivl` | #AE95FF | 7.24 | 6.31 | 4.5 |
| `--idle` | #6A7D96 | 4.22 | 3.68 | 3.0 |
| `--hot` | #FF8C3B | 7.68 | 6.69 | 3.0 |
| `--line` | #243247 | 1.37 | | hairline, no floor |
| `--line-strong` | #5F7394 | 3.70 | 3.22 | 3.0 on both |
| `--accent-ink` on `--accent` | #1C1200 | 10.41 | | 4.5 |
| `--bad-ink` on `--bad` | #2A050B | 6.35 | | 4.5 |
| `--good` chip | on its tint | 8.49 | 7.27 | 4.5 |
| `--warn` chip | on its tint | 8.34 | 7.17 | 4.5 |
| `--bad` chip | on its tint | 5.39 | 4.67 | 4.5 |
| `--info` chip | on its tint | 7.69 | 6.59 | 4.5 |
| `--ivl` chip | on its tint | 6.17 | 5.30 | 4.5 |
| `--c1` | #3987E5 | 4.89 | | 3.0 |
| `--c2` | #D95926 | 4.58 | | 3.0 |
| `--c3` | #199E70 | 5.22 | | 3.0 |
| `--c4` | #C98500 | 5.79 | | 3.0 |
| `--c5` | #D55181 | 4.51 | | 3.0 |
| `--c6` | #9085E9 | 5.69 | | 3.0 |
| `--glow` | rgba(255,180,46,.38) | | | accent family, decorative |

### t-light-pro

Surfaces: `--bg` #ECF0F5, `--bg2` #F7F9FC, `--panel` #FFFFFF, `--panel2` #E8EDF4. Steps: bg to panel 1.14:1, panel to panel2 1.18:1.

| token | value | on panel | on panel2 | floor |
|---|---|---|---|---|
| `--fg` | #111B27 | 17.36 | 14.75 | 4.5 |
| `--muted` | #4F6179 | 6.33 | 5.38 | 4.5 |
| `--faint` | #5E6B7C | 5.43 | 4.61 | 4.5 |
| `--accent` | #1F5ED6 | 5.78 | 4.92 | 4.5 |
| `--good` | #126B40 | 6.56 | 5.57 | 4.5 |
| `--warn` | #8A5000 | 6.51 | 5.53 | 4.5 |
| `--bad` | #B52438 | 6.41 | 5.45 | 4.5 |
| `--info` | #0B6588 | 6.50 | 5.52 | 4.5 |
| `--ivl` | #6446C4 | 6.53 | 5.55 | 4.5 |
| `--idle` | #76848F | 3.84 | 3.26 | 3.0 |
| `--hot` | #BF3F0A | 5.34 | 4.54 | 3.0 |
| `--line` | #D3DAE4 | 1.41 | | hairline, no floor |
| `--line-strong` | #788799 | 3.67 | 3.12 | 3.0 on both |
| `--accent-ink` on `--accent` | #FFFFFF | 5.78 | | 4.5 |
| `--bad-ink` on `--bad` | #FFFFFF | 6.41 | | 4.5 |
| `--good` chip | on its tint | 5.65 | 4.85 | 4.5 |
| `--warn` chip | on its tint | 5.62 | 4.81 | 4.5 |
| `--bad` chip | on its tint | 5.45 | 4.66 | 4.5 |
| `--info` chip | on its tint | 5.60 | 4.80 | 4.5 |
| `--ivl` chip | on its tint | 5.63 | 4.83 | 4.5 |
| `--c1` | #2A78D6 | 4.42 | | 3.0 |
| `--c2` | #EB6834 | 3.20 | | 3.0 |
| `--c3` | #12A06D | 3.35 | | 3.0 |
| `--c4` | #B98400 | 3.30 | | 3.0 |
| `--c5` | #D4568A | 3.82 | | 3.0 |
| `--c6` | #4A3AA7 | 8.56 | | 3.0 |
| `--glow` | rgba(31,94,214,.22) | | | accent family, decorative |

### t-bold

Surfaces: `--bg` #0C0806, `--bg2` #120D0A, `--panel` #1B1410, `--panel2` #281C16. Steps: bg to panel 1.10:1, panel to panel2 1.10:1.

| token | value | on panel | on panel2 | floor |
|---|---|---|---|---|
| `--fg` | #F9F0E9 | 16.18 | 14.72 | 4.5 |
| `--muted` | #BEA796 | 7.93 | 7.22 | 4.5 |
| `--faint` | #A28F80 | 5.87 | 5.34 | 4.5 |
| `--accent` | #FF5C1F | 5.89 | 5.37 | 4.5 |
| `--good` | #3DDC97 | 10.30 | 9.37 | 4.5 |
| `--warn` | #FFC53D | 11.53 | 10.49 | 4.5 |
| `--bad` | #FF4D5E | 5.61 | 5.11 | 4.5 |
| `--info` | #4FB9FF | 8.42 | 7.66 | 4.5 |
| `--ivl` | #B899FF | 7.83 | 7.13 | 4.5 |
| `--idle` | #9C8A7B | 5.49 | 5.00 | 3.0 |
| `--hot` | #FFD21F | 12.56 | 11.43 | 3.0 |
| `--line` | #402D23 | 1.40 | | hairline, no floor |
| `--line-strong` | #836353 | 3.36 | 3.06 | 3.0 on both |
| `--accent-ink` on `--accent` | #210A02 | 6.13 | | 4.5 |
| `--bad-ink` on `--bad` | #2A0509 | 5.76 | | 4.5 |
| `--good` chip | on its tint | 8.62 | 7.75 | 4.5 |
| `--warn` chip | on its tint | 9.38 | 8.37 | 4.5 |
| `--bad` chip | on its tint | 5.01 | 4.51 | 4.5 |
| `--info` chip | on its tint | 7.19 | 6.47 | 4.5 |
| `--ivl` chip | on its tint | 6.68 | 5.99 | 4.5 |
| `--c1` | #3987E5 | 5.00 | | 3.0 |
| `--c2` | #D95926 | 4.69 | | 3.0 |
| `--c3` | #199E70 | 5.34 | | 3.0 |
| `--c4` | #C98500 | 5.93 | | 3.0 |
| `--c5` | #D55181 | 4.61 | | 3.0 |
| `--c6` | #9085E9 | 5.82 | | 3.0 |
| `--glow` | rgba(255,92,31,.42) | | | accent family, decorative |

### t-green

Surfaces: `--bg` #060C09, `--bg2` #0B130F, `--panel` #111B16, `--panel2` #19281F. Steps: bg to panel 1.12:1, panel to panel2 1.14:1.

| token | value | on panel | on panel2 | floor |
|---|---|---|---|---|
| `--fg` | #E8F5EC | 15.69 | 13.71 | 4.5 |
| `--muted` | #91B29E | 7.60 | 6.64 | 4.5 |
| `--faint` | #7D998A | 5.70 | 4.98 | 4.5 |
| `--accent` | #35D97B | 9.53 | 8.33 | 4.5 |
| `--good` | #35D97B | 9.53 | 8.33 | 4.5 |
| `--warn` | #EFC94A | 11.01 | 9.62 | 4.5 |
| `--bad` | #FF6B7E | 6.42 | 5.61 | 4.5 |
| `--info` | #4FC7FF | 9.18 | 8.02 | 4.5 |
| `--ivl` | #AE95FF | 7.17 | 6.26 | 4.5 |
| `--idle` | #6B8B78 | 4.69 | 4.10 | 3.0 |
| `--hot` | #B6F09C | 13.36 | 11.68 | 3.0 |
| `--line` | #28392E | 1.44 | | hairline, no floor |
| `--line-strong` | #527661 | 3.46 | 3.02 | 3.0 on both |
| `--accent-ink` on `--accent` | #03180C | 9.97 | | 4.5 |
| `--bad-ink` on `--bad` | #2A070D | 6.75 | | 4.5 |
| `--good` chip | on its tint | 7.88 | 6.77 | 4.5 |
| `--warn` chip | on its tint | 8.93 | 7.67 | 4.5 |
| `--bad` chip | on its tint | 5.65 | 4.91 | 4.5 |
| `--info` chip | on its tint | 7.61 | 6.55 | 4.5 |
| `--ivl` chip | on its tint | 6.12 | 5.29 | 4.5 |
| `--c1` | #3987E5 | 4.84 | | 3.0 |
| `--c2` | #D95926 | 4.54 | | 3.0 |
| `--c3` | #199E70 | 5.17 | | 3.0 |
| `--c4` | #C98500 | 5.74 | | 3.0 |
| `--c5` | #D55181 | 4.47 | | 3.0 |
| `--c6` | #9085E9 | 5.63 | | 3.0 |
| `--glow` | rgba(53,217,123,.35) | | | accent family, decorative |

## 3. What changed and why

### October 10, 10:40: chip text and control edges

- **Light status tokens deepened.** `--good` #157A49 to #126B40, `--warn` #935600 to #8A5000, `--bad` #C62A41 to #B52438, `--info` #0A6F99 to #0B6588. Each already cleared 4.5:1 on bare `--panel2`, but a chip's text does not sit on the bare surface; it sits on a 10% wash of itself (the chip-tint rule in section 1), and on a tinted `--panel2` card the old values landed between 4.0 and 4.4:1 (`--good` 4.01, `--warn` 4.37, `--bad` 4.04, `--info` 4.17). The new values clear 4.5:1 on the tint over both steps (4.66 to 4.85:1 on `--panel2`, 5.45 to 5.65:1 on `--panel`) and 6.4 to 6.6:1 as plain text on white. `--bad-ink` on the new `--bad` rose from 5.51 to 6.41:1. `--ivl` #6446C4 and `--hot` #BF3F0A did not need to move. The three dark themes already cleared the chip rule (tightest: bold `--bad` chip 4.51:1), so nothing moved there.
- **`--line-strong` lifted on ops and light.** Ops #56698A to #5F7394 (3.20:1 to 3.70:1 on `--panel`, 3.22:1 on `--panel2`), light #808FA4 to #788799 (3.29:1 to 3.67:1 on `--panel`, 3.12:1 on `--panel2`). The old values cleared 3:1 on the panel only; most buttons, inputs and filter chips sit on a `--panel2` card, where they fell to 2.79:1 and 2.80:1. Bold #836353 and green #527661 stay, because they already clear both steps (3.06:1 and 3.02:1 on `--panel2`); the audit now holds all four themes to 3:1 on both surfaces.
- **The audit grew two checks.** `test/contrast.py` prints `chip` rows (each status token on its 10% tint over both steps, floor 4.5) and judges `--line-strong` on `--panel2` as well as `--panel`. `test/audit.js` excuses the four agreed boundary cases listed in section 1 and nothing else, so the pass bar for a piece is 0 audit failures and 0 warnings.
- **Nothing else moved.** Every other value, both dark fallbacks and the mirror check are as they were after the refresh.

### The "crisp, epic, optimized" refresh (earlier the same day)

- **Surfaces step clearly now.** Each dark theme's floor dropped to near-black (`--bg` #060910, #0C0806, #060C09) while `--panel` rose a touch and `--panel2` rose more, so page, panel and tile read as three distinct steps instead of one murky block (bg to panel 1.10 to 1.12:1, panel to panel2 1.10 to 1.15:1, up from 1.05 to 1.09). `--bg2` sits between floor and panel so the command bar reads as chrome, not as another panel. Light got a slightly deeper floor (#ECF0F5) so white panels pop without a heavier shadow.
- **Text is near-white on dark and the three tiers all clear 4.5:1 on both panel steps.** `--fg` moved up (#EEF3FA, #F9F0E9, #E8F5EC); `--muted` and `--faint` were lifted so `--faint` sits at 4.9 to 5.3:1 on `--panel2` instead of hovering at 4.56 to 4.62. On light, `--fg` #111B27 is 17.4:1 and `--faint` #5E6B7C clears 4.6:1 on the tinted step.
- **Bold lost its mud.** `--muted` #B09A8C became #BEA796 and `--faint` #938376 became #A28F80: warmer and brighter, 7.9 and 5.9:1 instead of brown-gray. `--idle` on bold moved up with them.
- **Accents stayed, their neighbors got cleaner.** The four accents (#FFB42E amber, #1F5ED6 blue, #FF5C1F orange, #35D97B green) and their `--glow` values are unchanged, because every swatch, screenshot and test keys on them. Around them: `--good` on ops is a brighter mint (#3BDF93), `--info` is a crisper sky (#4FC7FF, #4FB9FF on bold), `--ivl` a cleaner lavender (#AE95FF, #B899FF on bold), `--bad` on ops #FF5F75. Light's `--warn` moved from olive #996000 to a true dark amber (#935600 then, #8A5000 now), and light's `--good`, `--bad`, `--info` and `--hot` deepened so each clears 4.5:1 on `--panel2`, not only on white; the 10:40 revision above took three of them one step deeper for the chip tint.
- **New `--line-strong` for control edges.** `--line` stays the decorative hairline (1.37 to 1.44:1). The new token borders every control (the list is in section 1) and now sits at 3.4 to 3.7:1 on `--panel` and 3.0 to 3.2:1 on `--panel2` (#5F7394, #788799, #836353, #527661, each in its theme's hue). Inputs and buttons finally have an edge you can see; panel edges, dividers and `.tbl-wrap` keep the quiet hairline.
- **`--idle` is a dot and border tone, not text.** It clears 3:1 everywhere (3.3:1 on light's `--panel2` is the tightest), and the audit holds it to that floor so nobody promotes it to small text by accident.
- **Nothing else moved.** Radii, fonts, shadows, `--hiline`, `--scan` and the chart set `--c1` to `--c6` are byte-identical. The chart set was re-audited against the new panels and still clears 3:1 in every theme (tightest: `--c2` 3.20:1 on light).

## 4. How to check

```
python3 test/contrast.py            # audits pieces/foundation.css, exits 1 on any miss
python3 test/contrast.py path.css   # audits another copy
```

The token audit covers the text floors, the chip-tint rule, `--line-strong` on both steps, the chart set and the mirror check. The in-page audit (`test/audit.js`, run by `test/run_matrix.py`) covers what tokens alone cannot: real text on its real background, the 3:1 boundary on every control (with the four agreed exceptions), tap targets, font floors, phone-width overflow and em dashes. A palette change ships only when both pass: `contrast.py` prints `PASS`, and a full matrix run reports 0 audit failures and 0 warnings.

Then screenshots in all four themes at 1280 and 400 (`?cctheme=t-bold` in the URL previews one theme) and a five-minute eyeball pass: one hero per panel, status words readable in grayscale, a chip's word readable on its tint on a `--panel2` card, every input and button with a visible edge, the light theme looks designed rather than inverted, the neural field shows only in the gutters.

## 5. Audit output

`python3 test/contrast.py` on `pieces/foundation.css` as of this revision, verbatim. The three viewer-scheme blocks repeat their twins because the mirror check requires it. The `chip` rows at the end of each block are the chip-tint rule; the `line-strong` row carries both surfaces.

```

== viewer-light (bare :root) ==
  panel #FFFFFF  panel2 #E8EDF4  bg #ECF0F5  line #D3DAE4  line-strong #788799
  token        value        panel   panel2  floor  result
  fg           #111B27      17.36    14.75    4.5  pass
  muted        #4F6179       6.33     5.38    4.5  pass
  faint        #5E6B7C       5.43     4.61    4.5  pass
  accent       #1F5ED6       5.78     4.92    4.5  pass
  good         #126B40       6.56     5.57    4.5  pass
  warn         #8A5000       6.51     5.53    4.5  pass
  bad          #B52438       6.41     5.45    4.5  pass
  info         #0B6588       6.50     5.52    4.5  pass
  ivl          #6446C4       6.53     5.55    4.5  pass
  idle         #76848F       3.84     3.26    3.0  pass
  hot          #BF3F0A       5.34     4.54    3.0  pass
  accent-ink   #FFFFFF       1.00     1.18         ref
                           accent      bad         
  accent-ink   #FFFFFF       5.78             4.5  pass
  bad-ink      #FFFFFF                6.41    4.5  pass
                            panel                  
  line-strong  #788799       3.67     3.12    3.0  pass
  c1           #2A78D6       4.42     3.0  pass
  c2           #EB6834       3.20     3.0  pass
  c3           #12A06D       3.35     3.0  pass
  c4           #B98400       3.30     3.0  pass
  c5           #D4568A       3.82     3.0  pass
  c6           #4A3AA7       8.56     3.0  pass
                           tint/p  tint/p2         
  good chip    #126B40       5.65     4.85    4.5  pass
  warn chip    #8A5000       5.62     4.81    4.5  pass
  bad chip     #B52438       5.45     4.66    4.5  pass
  info chip    #0B6588       5.60     4.80    4.5  pass
  ivl chip     #6446C4       5.63     4.83    4.5  pass

== viewer-dark (@media) ==
  panel #101826  panel2 #19243A  bg #060910  line #243247  line-strong #5F7394
  token        value        panel   panel2  floor  result
  fg           #EEF3FA      15.95    13.90    4.5  pass
  muted        #97A8C0       7.35     6.41    4.5  pass
  faint        #8292AA       5.62     4.90    4.5  pass
  accent       #FFB42E      10.01     8.72    4.5  pass
  good         #3BDF93      10.30     8.98    4.5  pass
  warn         #FFB42E      10.01     8.72    4.5  pass
  bad          #FF5F75       6.05     5.27    4.5  pass
  info         #4FC7FF       9.27     8.08    4.5  pass
  ivl          #AE95FF       7.24     6.31    4.5  pass
  idle         #6A7D96       4.22     3.68    3.0  pass
  hot          #FF8C3B       7.68     6.69    3.0  pass
  accent-ink   #1C1200       1.04     1.19         ref
                           accent      bad         
  accent-ink   #1C1200      10.41             4.5  pass
  bad-ink      #2A050B                6.35    4.5  pass
                            panel                  
  line-strong  #5F7394       3.70     3.22    3.0  pass
  c1           #3987E5       4.89     3.0  pass
  c2           #D95926       4.58     3.0  pass
  c3           #199E70       5.22     3.0  pass
  c4           #C98500       5.79     3.0  pass
  c5           #D55181       4.51     3.0  pass
  c6           #9085E9       5.69     3.0  pass
                           tint/p  tint/p2         
  good chip    #3BDF93       8.49     7.27    4.5  pass
  warn chip    #FFB42E       8.34     7.17    4.5  pass
  bad chip     #FF5F75       5.39     4.67    4.5  pass
  info chip    #4FC7FF       7.69     6.59    4.5  pass
  ivl chip     #AE95FF       6.17     5.30    4.5  pass

== host-dark (data-theme) ==
  panel #101826  panel2 #19243A  bg #060910  line #243247  line-strong #5F7394
  token        value        panel   panel2  floor  result
  fg           #EEF3FA      15.95    13.90    4.5  pass
  muted        #97A8C0       7.35     6.41    4.5  pass
  faint        #8292AA       5.62     4.90    4.5  pass
  accent       #FFB42E      10.01     8.72    4.5  pass
  good         #3BDF93      10.30     8.98    4.5  pass
  warn         #FFB42E      10.01     8.72    4.5  pass
  bad          #FF5F75       6.05     5.27    4.5  pass
  info         #4FC7FF       9.27     8.08    4.5  pass
  ivl          #AE95FF       7.24     6.31    4.5  pass
  idle         #6A7D96       4.22     3.68    3.0  pass
  hot          #FF8C3B       7.68     6.69    3.0  pass
  accent-ink   #1C1200       1.04     1.19         ref
                           accent      bad         
  accent-ink   #1C1200      10.41             4.5  pass
  bad-ink      #2A050B                6.35    4.5  pass
                            panel                  
  line-strong  #5F7394       3.70     3.22    3.0  pass
  c1           #3987E5       4.89     3.0  pass
  c2           #D95926       4.58     3.0  pass
  c3           #199E70       5.22     3.0  pass
  c4           #C98500       5.79     3.0  pass
  c5           #D55181       4.51     3.0  pass
  c6           #9085E9       5.69     3.0  pass
                           tint/p  tint/p2         
  good chip    #3BDF93       8.49     7.27    4.5  pass
  warn chip    #FFB42E       8.34     7.17    4.5  pass
  bad chip     #FF5F75       5.39     4.67    4.5  pass
  info chip    #4FC7FF       7.69     6.59    4.5  pass
  ivl chip     #AE95FF       6.17     5.30    4.5  pass

== t-dark-ops ==
  panel #101826  panel2 #19243A  bg #060910  line #243247  line-strong #5F7394
  token        value        panel   panel2  floor  result
  fg           #EEF3FA      15.95    13.90    4.5  pass
  muted        #97A8C0       7.35     6.41    4.5  pass
  faint        #8292AA       5.62     4.90    4.5  pass
  accent       #FFB42E      10.01     8.72    4.5  pass
  good         #3BDF93      10.30     8.98    4.5  pass
  warn         #FFB42E      10.01     8.72    4.5  pass
  bad          #FF5F75       6.05     5.27    4.5  pass
  info         #4FC7FF       9.27     8.08    4.5  pass
  ivl          #AE95FF       7.24     6.31    4.5  pass
  idle         #6A7D96       4.22     3.68    3.0  pass
  hot          #FF8C3B       7.68     6.69    3.0  pass
  accent-ink   #1C1200       1.04     1.19         ref
                           accent      bad         
  accent-ink   #1C1200      10.41             4.5  pass
  bad-ink      #2A050B                6.35    4.5  pass
                            panel                  
  line-strong  #5F7394       3.70     3.22    3.0  pass
  c1           #3987E5       4.89     3.0  pass
  c2           #D95926       4.58     3.0  pass
  c3           #199E70       5.22     3.0  pass
  c4           #C98500       5.79     3.0  pass
  c5           #D55181       4.51     3.0  pass
  c6           #9085E9       5.69     3.0  pass
                           tint/p  tint/p2         
  good chip    #3BDF93       8.49     7.27    4.5  pass
  warn chip    #FFB42E       8.34     7.17    4.5  pass
  bad chip     #FF5F75       5.39     4.67    4.5  pass
  info chip    #4FC7FF       7.69     6.59    4.5  pass
  ivl chip     #AE95FF       6.17     5.30    4.5  pass

== t-light-pro ==
  panel #FFFFFF  panel2 #E8EDF4  bg #ECF0F5  line #D3DAE4  line-strong #788799
  token        value        panel   panel2  floor  result
  fg           #111B27      17.36    14.75    4.5  pass
  muted        #4F6179       6.33     5.38    4.5  pass
  faint        #5E6B7C       5.43     4.61    4.5  pass
  accent       #1F5ED6       5.78     4.92    4.5  pass
  good         #126B40       6.56     5.57    4.5  pass
  warn         #8A5000       6.51     5.53    4.5  pass
  bad          #B52438       6.41     5.45    4.5  pass
  info         #0B6588       6.50     5.52    4.5  pass
  ivl          #6446C4       6.53     5.55    4.5  pass
  idle         #76848F       3.84     3.26    3.0  pass
  hot          #BF3F0A       5.34     4.54    3.0  pass
  accent-ink   #FFFFFF       1.00     1.18         ref
                           accent      bad         
  accent-ink   #FFFFFF       5.78             4.5  pass
  bad-ink      #FFFFFF                6.41    4.5  pass
                            panel                  
  line-strong  #788799       3.67     3.12    3.0  pass
  c1           #2A78D6       4.42     3.0  pass
  c2           #EB6834       3.20     3.0  pass
  c3           #12A06D       3.35     3.0  pass
  c4           #B98400       3.30     3.0  pass
  c5           #D4568A       3.82     3.0  pass
  c6           #4A3AA7       8.56     3.0  pass
                           tint/p  tint/p2         
  good chip    #126B40       5.65     4.85    4.5  pass
  warn chip    #8A5000       5.62     4.81    4.5  pass
  bad chip     #B52438       5.45     4.66    4.5  pass
  info chip    #0B6588       5.60     4.80    4.5  pass
  ivl chip     #6446C4       5.63     4.83    4.5  pass

== t-bold ==
  panel #1B1410  panel2 #281C16  bg #0C0806  line #402D23  line-strong #836353
  token        value        panel   panel2  floor  result
  fg           #F9F0E9      16.18    14.72    4.5  pass
  muted        #BEA796       7.93     7.22    4.5  pass
  faint        #A28F80       5.87     5.34    4.5  pass
  accent       #FF5C1F       5.89     5.37    4.5  pass
  good         #3DDC97      10.30     9.37    4.5  pass
  warn         #FFC53D      11.53    10.49    4.5  pass
  bad          #FF4D5E       5.61     5.11    4.5  pass
  info         #4FB9FF       8.42     7.66    4.5  pass
  ivl          #B899FF       7.83     7.13    4.5  pass
  idle         #9C8A7B       5.49     5.00    3.0  pass
  hot          #FFD21F      12.56    11.43    3.0  pass
  accent-ink   #210A02       1.04     1.14         ref
                           accent      bad         
  accent-ink   #210A02       6.13             4.5  pass
  bad-ink      #2A0509                5.76    4.5  pass
                            panel                  
  line-strong  #836353       3.36     3.06    3.0  pass
  c1           #3987E5       5.00     3.0  pass
  c2           #D95926       4.69     3.0  pass
  c3           #199E70       5.34     3.0  pass
  c4           #C98500       5.93     3.0  pass
  c5           #D55181       4.61     3.0  pass
  c6           #9085E9       5.82     3.0  pass
                           tint/p  tint/p2         
  good chip    #3DDC97       8.62     7.75    4.5  pass
  warn chip    #FFC53D       9.38     8.37    4.5  pass
  bad chip     #FF4D5E       5.01     4.51    4.5  pass
  info chip    #4FB9FF       7.19     6.47    4.5  pass
  ivl chip     #B899FF       6.68     5.99    4.5  pass

== t-green ==
  panel #111B16  panel2 #19281F  bg #060C09  line #28392E  line-strong #527661
  token        value        panel   panel2  floor  result
  fg           #E8F5EC      15.69    13.71    4.5  pass
  muted        #91B29E       7.60     6.64    4.5  pass
  faint        #7D998A       5.70     4.98    4.5  pass
  accent       #35D97B       9.53     8.33    4.5  pass
  good         #35D97B       9.53     8.33    4.5  pass
  warn         #EFC94A      11.01     9.62    4.5  pass
  bad          #FF6B7E       6.42     5.61    4.5  pass
  info         #4FC7FF       9.18     8.02    4.5  pass
  ivl          #AE95FF       7.17     6.26    4.5  pass
  idle         #6B8B78       4.69     4.10    3.0  pass
  hot          #B6F09C      13.36    11.68    3.0  pass
  accent-ink   #03180C       1.05     1.20         ref
                           accent      bad         
  accent-ink   #03180C       9.97             4.5  pass
  bad-ink      #2A070D                6.75    4.5  pass
                            panel                  
  line-strong  #527661       3.46     3.02    3.0  pass
  c1           #3987E5       4.84     3.0  pass
  c2           #D95926       4.54     3.0  pass
  c3           #199E70       5.17     3.0  pass
  c4           #C98500       5.74     3.0  pass
  c5           #D55181       4.47     3.0  pass
  c6           #9085E9       5.63     3.0  pass
                           tint/p  tint/p2         
  good chip    #35D97B       7.88     6.77    4.5  pass
  warn chip    #EFC94A       8.93     7.67    4.5  pass
  bad chip     #FF6B7E       5.65     4.91    4.5  pass
  info chip    #4FC7FF       7.61     6.55    4.5  pass
  ivl chip     #AE95FF       6.12     5.29    4.5  pass

PASS: every token clears its floor in all blocks, and the viewer-scheme blocks mirror their twins.
```
