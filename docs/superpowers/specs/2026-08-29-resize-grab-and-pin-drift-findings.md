# UAT findings, 2026-08-29: the grab-time span rewrite and the card-pin sweep

Filed as #154 (grab-time rewrite), #155 / #156 / #157 (pin drift: three measured
cards, the sweep, the re-pins), #158 (input alignment), #159 (label-changing
controls), #160 (unbounded inputs). This document records the two things a
ticket body cannot carry: the **measurement method**, so a later reader can
re-run it and get a different answer if the code has changed, and the **raw
sweep**, so the numbers are checkable rather than quoted.

Both were produced on **main `bf78ea7`**, against `pnpm mock` on the default
`idle` scenario, in **headless Edge** driven over CDP. Neither is a `uat`
measurement; #156 requires the sweep re-run on `uat` `e1db642`.

## The harness

There is no browser harness checked into this repo. This one was assembled ad
hoc and is described rather than committed, because the durable form of it is
#156's mechanism decision, not a script in `tools/`.

```
mock   node packages/mock-duet/src/cli.ts -p 8299          (cwd packages/mock-duet)
vite   DWC_TARGET=http://127.0.0.1:8299 npx vite --port 5299 --strictPort
edge   msedge.exe --headless=new --remote-debugging-port=9299 --user-data-dir=<tmp>
CDP    node >= 22 has a global WebSocket; GET /json/list for the target, then
       Page.enable, Runtime.enable, Emulation.setDeviceMetricsOverride
       {width:1600,height:1200,deviceScaleFactor:1}, Runtime.evaluate.
```

Two things this cost, worth not rediscovering:

- `--window-size` does **not** size the headless viewport reliably; without
  `Emulation.setDeviceMetricsOverride` the page rendered at `clientHeight` 324
  and every scroll-dependent measurement was distorted.
- `/json/list` returns the extension's own pages first. Select the target by
  URL (`t.url.includes('5299')`), not by `type === 'page'`.

**Ports: 5299 / 8299 / 9299 only.** 5199 / 8199 are Gabe's merged-UAT mock.

## Finding 1 — a grab, with no pointer movement, rewrites the card's span

Full trace in #154. The measurement, verbatim from the probe:

```
fresh session (localStorage cleared), Settings, card "console", span 75
1) first gesture of the session, grip mid-viewport
   pointerdown -> +1 frame: span 75 (unchanged)
   drag down 200px -> span 125, released
2) scroll to the bottom of .view-scroll, TAP the grip (pointerdown, NO
   pointermove, pointerup 150ms later)
   before        span 125   scrollTop 2883   scrollHeight 3996
   +1 frame      span  75   scrollTop 2683   scrollHeight 3796
   after         span  75   PERSISTED
```

200 px of browser scroll clamp / 4 px per row = 50 rows = exactly the span
lost. A second capture on a card already at its floor showed the clamp at
-592 px (-148 rows). The cause is `holdFloor` (`panelCanvas.ts:2252` ->
`:2017`) re-pointing the shared floor element upward, shrinking the canvas,
while `originScrollTop` was captured at `:2166` *before* that write — so the
clamp is counted as pointer travel at `:2266`.

The hypothesis the investigation started from — "the gesture applies the
computed floor instead of the current span" — was **refuted**: `clampToStop`
(`:441`) can only raise a span. Stationary taps on eight cards with no prior
settled floor changed nothing.

Two further zero-movement rewrites, both measured, both in #154: the edge
auto-scroll starting before the first `pointermove` (`:2262`), and a card
stored below its content floor being raised to the floor on the first frame
(`camera-config` 40 -> 42, persisted).

## Finding 2 — the pin sweep

53 cards in `CARD_DEFS`; 50 are placed on the nine built-in screens (60
placements); `camera`, `jobs-inventory` and `macros-inventory` are on no
built-in screen and were not measured. `.panel-body` `scrollHeight` vs
`clientHeight`, at `data-scale` 075 / 100 / 150.

**17 of 60 placements draw more than their pin reserves.** The over-run is
scale-invariant in rows, which is the global-unit system behaving as designed
— these are pin errors, not scaling defects.

| screen / card | span | over @0.75 | @1.0 | @1.5 | rows @1.0 | owner |
|---|---:|---:|---:|---:|---:|---|
| `control/filament` | 50 | 135 | 180 | 270 | 45 | #157 |
| `settings/settings-shaping` | 178 | 134 | 179 | 268 | 45 | #157 |
| `system/firmware` | 112 | 39 | 51 | 71 | 13 | #157 |
| `settings/config-save` | 26 | 37 | 50 | 75 | 13 | **#155** |
| `control/fans` | 62 | 30 | 40 | 60 | 10 | #157 |
| `shaping/shaping-apply` | 50 | 27 | 36 | 54 | 9 | #157 |
| `shaping/shaping-capture` | 140 | 25 | 33 | 53 | 9 | #157 |
| `control/movement` | 76 | 15 | 20 | 30 | 5 | #157 |
| `machine/position` | 103 | 13 | 17 | 26 | 5 | #157 |
| `activity/position` | 103 | 13 | 17 | 26 | 5 | #157 |
| `settings/axis-roles` | 109 | 9 | 12 | 19 | 3 | **#155** |
| `shaping/shaping-sweep` | 118 | 9 | 12 | 18 | 3 | #157 |
| `machine/sensors` | 42 | 7 | 9 | 14 | 3 | #157 |
| `settings/bed-probe` | 45 | 6 | 7 | 10 | 2 | fixed on `uat` (GIT_138) |
| `settings/camera-config` | 40 | 4 | 5 | 8 | 2 | fixed on `uat` (GIT_138) |
| `settings/tool-dock-sensors` | 76 | 2 | 3 | 4 | 1 | **#155** |
| `control/tuning` | 33 | 2 | 2 | 3 | 1 | #157 |

`shaping/shaping-apply`, `shaping/shaping-capture` and `shaping/shaping-sweep`
are the three #132's commit message predicted ("+36, +33, +12 at their CODED
spans, before and after, on main as well… that is registry floor drift and
wants its own ticket"). This is that ticket, and the prediction is confirmed to
the pixel.

## What this sweep cannot say

Stated here because #156 requires it stated, and because a sweep whose scope is
not declared is not falsifiable:

- **One scenario** (mock `idle`), **one machine shape**, **one viewport**
  (1600x1200), **one branch** (`main`, which lacks the four merged branches).
- **Three placements rendered header-only** and their numbers say nothing about
  a populated card: `activity/layers`, `control/atx`, `jobs/job-details`.
- **Per-tool cards scale with tool count.** `tool-dock-sensors` was measured at
  the mock's default tool count, not at Gabe's four.
- **Three registry cards were not measured at all** (on no built-in screen).

## Working-rule notes

- `docs/github-issue-rules.md` lists `bughunt`, `fixture-catalog`,
  `logging-residuals`, `perf` and `research` as "type labels in use". None of
  them exist in the repository's label set (`gh label list`). The labels that
  do exist are `bug`, `feature`, `debt`, `campaign`, `documentation`,
  `enhancement` plus the `GIT_N` set. `needs-input` did not exist either and
  was created for #160. Repo prose read authoritative and was stale — the
  CLAUDE.md rule about checking tooling from the environment applied exactly.
