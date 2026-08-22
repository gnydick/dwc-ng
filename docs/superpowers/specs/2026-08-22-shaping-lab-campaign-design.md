# Shaping Lab — in-browser input-shaping analysis for dwc-ng

Campaign design, 2026-08-22. Companion to `2026-08-22-input-shaping-analysis-design.md`
(the Python prototype in `tools/accel/`, which is the reference implementation and the
source of test fixtures — read-only, nothing copied; the engine is rewritten in TS to
fit the store/connector architecture).

## Problem

RRF's input-shaping plugin in stock DWC records one short move, shows an uncalibrated
FFT magnitude per axis, and offers a frequency guess. It measures no damping, cannot
show the X-vs-Y compromise that RRF's single global `M593` forces, never verifies, and
cannot see the one failure mode that actually bit on 2026-08-22: a shaper whose
impulse spacing excites a *different* mode than the one it cancels (38 Hz artefact
from 17.5 Hz ZVDD/ZVDDD/custom; `tools/accel/README.md`).

The prototype proved the method: hard stops → fitted fingerprint (f, ζ, g per axis,
both directions) → RRF-3.6-exact shaper simulation → robustness-ranked candidates →
on-machine verification that catches artefacts → a measured recommendation
(`M593 P"ei2" F52 S0.075` for T0). Gabe's machine sets `M593` per tool in `tpostN.g`,
so the recommendation is per tool and each tool board carries its own LIS3DH.

This campaign puts that capability in dwc-ng, running entirely in the browser, with
graphs the user follows step by step, recommendations with pros and cons, a custom
analysis path, and nothing that can move the machine outside a sealed, guarded
procedure.

## Decisions (Gabe, 2026-08-22)

- Runs completely in the browser. No server-side component; the connector is the
  only way to the board.
- Recommendations are presented with pros and cons; the user chooses. The tool
  never writes `M593` into a macro without an explicit, armed confirm.
- Custom analysis is a first-class path (user-defined shaper impulse trains,
  user-defined test motion, re-analysis of any capture on the card).
- Graphs exist for every step so the user can follow the suggestion chain:
  capture → decay → fingerprint → candidates → verify → apply.
- Spec and plan are mine to decide; campaign is tracked as GitHub issue sets per
  `docs/github-issue-rules.md`.
- Motion envelope for Gabe's machine: X 10–320, Y 20–260 (user/tool coordinates).
  Stored as config, enforced as a refusal, never a default.
- Every capture/verify run reads position and homed state immediately before
  moving; `G92` is never emitted by this feature (memory:
  `never-g92-from-a-stale-read`).

## Scope

In: X and Y axes; the six RRF 3.6 shaper types + custom; per-tool fingerprints and
recommendations; ring (hard-stop) test, speed sweep, verify run; import/analysis of
any `0:/sys/accelerometer/*.csv`; results persisted on the card; mock-duet emulation
so the whole flow runs against the mock.

Out: Z/extruders; editing `M566`/`M204`; multi-resonance shaper synthesis beyond
ZV⊗ZV custom; anything in the standalone-only `rr_` transport that DSF lacks (both
connectors must work — the feature uses `sendCode`, `download`, `list`, `upload` only).

## User-facing shape

A new builtin screen **`shaping`** ("Shaping"). Cards, in the order the user follows:

1. **Shaping status** — per-tool table: fingerprint (f, ζ, g per axis) or "not
   measured", the `M593` currently active (from `move.shaping`), the line in
   `tpostN.g` if any, and the recommendation state (none / candidate / verified /
   applied). Buttons: Measure, Sweep, Rank, Verify, Apply — each gated by the
   procedure preconditions and visibly disabled with the reason.
2. **Capture** — the test-motion editor (axis, start, distance, speed, repeats,
   accelerometer) with the envelope drawn as a box on a tiny XY map; the user sees
   the moves before arming them. Arm → run, with a live progress strip.
3. **Decay viewer** — one capture at a time: raw g vs time with the detected stop,
   the band-passed envelope and the fitted exponential; per-axis/direction picker;
   the fitted f/ζ/peak beside the chart. Import any CSV from the card here.
4. **Speed sweep** — frequency × speed heatmap (g), with the full-step-rate line
   and the fitted ring frequencies overlaid, so forced ripple and ringing are
   visually separated and the user learns which one shaping can touch.
5. **Candidates** — ranked table of (shaper, F, S): predicted residual per axis,
   ±10 % robustness, duration, and a pros/cons column generated from rules
   (see Recommendation rules). Residual-vs-frequency chart with the modes marked;
   hovering a row highlights its curve.
6. **Custom** — impulse-train editor (H/T as RRF takes them, or ZV⊗ZV from two
   picked modes); evaluated live through the same engine; appears in the
   Candidates table as `custom`.
7. **Verify** — pick candidates → run → predicted vs measured bars per axis, plus
   "new peaks" (artefact) detection listed as a con on that candidate.
8. **Apply** — the exact `M593` line per tool, with Copy, and "Write to
   `tpostN.g`" which shows the diff of that file and requires `createArmed`
   confirmation. Also `M593 … now` to try it live without editing a file.

## Invariants

### Touched (existing)

- `gcode-producers` (rung 7) — every new G-code (M955, M956, M593 incl. custom
  H/T form, G1 with axis map, G4, M400) is a `cmd.*` builder in
  `control/commands.ts`. No string concatenation of G-code anywhere in
  `src/shaping/`.
- `guard-follows-the-declaration` (rung 7) — procedures use only `ConnectorWrites`
  methods; adding none.
- `escape-disarms` (rung 6) — every run/apply control uses `createArmed`.
- `om-entry-shape-gate` (rung 5) — `move.shaping` and `boards[].accelerometer` get
  interface + `emptyModel` + `conformModelKey` arms; the ungated patch route is
  covered by the engine re-parsing at read time as `om/speeds.ts` does.
- `registered-card-ids` / `def-body-totality` (rung 7) — eight new ids in
  `CARD_DEFS` with bodies in `CARD_RENDER`.
- px lint, lazy-bundle allowlist (the engine has no heavy deps; the worker is a
  new `new Worker(new URL(...))` site and must be the only one for shaping).

### Introduced

- **I1 `shaping-motion-only-via-procedure`** (target rung 7). The only producer of
  motion G-code in `src/shaping/` is `Procedure.run()`, and `Procedure` has a
  private constructor reachable only through `planProcedure(plan, guards)`, which
  returns `Result<Procedure, Refusal>`. `guards` is a `Preconditions` object
  constructible only from a fresh OM read (idle, homed X/Y, accelerometer present
  at the requested address, every planned point inside the configured envelope).
  There is no `Procedure` without a passed `Preconditions`; a `Preconditions` older
  than one poll cycle cannot be used (it carries the OM `seqs`/time it was read at,
  and `planProcedure` rejects stale ones).
- **I2 `restore-is-structural`** (rung 7). A procedure is a list of `Step`s plus a
  `restore: readonly GcodeCommand[]` captured at plan time from the OM (`M593`
  state, nothing else — this feature changes no driver setting). `run()` executes
  restore in `finally`; there is no API to run steps without it.
- **I3 `capture-is-parsed`** (rung 7). `Capture` has a private constructor; the
  only producer is `parseCapture(text)` which returns `Result<Capture, ParseError>`
  (rate > 0, trailer present, overflows == 0). The fitter accepts `Capture` only.
- **I4 `fingerprint-from-fit-only`** (rung 7). `Mode {f: Hz, zeta, peakG}` and
  `Fingerprint` are branded outputs of `fitDecay`/`aggregate`. Units are types:
  `Hz`, `Seconds`, `G`, `MmPerS`, `MmPerS2` — all branded numbers with one
  constructor each in `shaping/engine/units.ts`.
- **I5 `shaper-definitions-are-one-table`** (rung 8). The six RRF shapers are one
  exhaustive `switch` on `ShaperType` with a `never` arm; the `M593` builder in
  `commands.ts` takes a `ShaperSpec` discriminated union (`{type, F, S}` |
  `{type:"custom", H, T}`) so a custom shaper and a named one cannot be emitted
  with the wrong parameter set.
- **I6 `verified-is-a-type`** (rung 7). `Verified<Candidate>` is produced only by
  the verify procedure's analysis; the Apply card shows "unverified" for any
  `Candidate` that is not `Verified`, and the artefact flag is a field of
  `Verified`, not a separate lookup.
- **I7 `results-persist-through-one-writer`** (rung 6 → row). All on-card results
  (`0:/sys/dwc-ng/shaping/<tool>.json`) go through `shaping/store.ts` which is the
  only importer of the results path; parse on read through `parseResults`.
  Ledger row: promote by branding the path.
- **I8 `envelope-is-config-not-default`** (rung 7). `Envelope` has no default value;
  `DEFAULT_CONFIG.shaping.envelope` is `null`, and `planProcedure` refuses with
  `Refusal.NoEnvelope` until the user sets it in Settings. A machine never moves
  on a guessed box.

## Components

### 1. `packages/ui/src/shaping/engine/` (new, pure, no DOM)

`units.ts` (branded numbers), `capture.ts` (`parseCapture`, `detectStop`),
`spectrum.ts` (radix-2 FFT, zero-padded peak pick, band-pass envelope via analytic
signal), `fit.ts` (`fitDecay` → `Mode | NoFit`, `aggregate` → `Fingerprint`),
`shapers.ts` (`impulses(spec)` per RRF 3.6 `AxisShaper.cpp` semantics — rewritten,
not copied; `convolve`, `zv`), `residual.ts` (`residual(A,T,mode)`, `robust`),
`rank.ts` (grid over F/S, worst-axis + robust score, duration), `artefact.ts`
(new peaks in a verify fingerprint absent from the baseline, above floor),
`recommend.ts` (the rules → pros/cons strings), `sweep.ts` (speed × frequency
matrix, full-step line from `stepsPerMm`/`microstepping`).

`worker.ts` wraps the engine: in = `{kind:"fit"|"rank"|"sweep"|"artefact", …}`,
out = `{ok, result} | {ok:false, error}`; transfers Float64Array buffers. One
creation site: `shaping/useEngine.ts`.

### 2. `packages/ui/src/control/commands.ts` — builders

`cmd.accelConfig(addr)` (M955 P), `cmd.accelCapture(addr, samples, trigger, file)`
(M956), `cmd.inputShaping(spec: ShaperSpec)` (M593 named or custom), `cmd.shapingOff()`,
`cmd.queryShaping()` (M593), `cmd.waitMoves()` (M400), `cmd.dwell(ms)` (G4 P),
`cmd.moveAbs(points: AxisMm[], feedMmPerMin)` (G90 + G1 with `axisLetter`). All via
`gc` tag; `gcodeQuote` for the file name. Verified against `reference/duet-gcode.md`
sections M593/M955/M956/G4/M400 and `reference/dwc` at implementation time.

### 3. `packages/ui/src/om/types.ts` — shape gate

`Move.shaping: {type, frequency, damping, amplitudes, delays}` and
`Board.accelerometer: {orientation, points, runs} | null`; `emptyModel` and
`conformModelKey` arms; `om-conform.test.ts` cases for both.

### 4. `packages/ui/src/shaping/procedure.ts` (new) — I1/I2

`Plan` = discriminated union `{kind:"ring", axis, dir, start, dist, speed, repeats,
accel, samples}` | `{kind:"sweep", speeds, …}` | `{kind:"verify", spec, ringPlan}`.
`planProcedure(plan, pre: Preconditions, cfg)` → `Result<Procedure, Refusal>` with
`Refusal = NotIdle | NotHomed | NoAccelerometer | OutsideEnvelope(point) |
NoEnvelope | Stale`. `Procedure.run(connector, progress)` → `AsyncIterable<Event>`
(`step`, `capture(file)`, `reply`, `restored`, `done`, `failed`). Capture retrieval
follows the `reprobe` pattern: snapshot the accelerometer file list before, send,
await the reply, then poll `list("0:/sys/accelerometer")` for the new file (with the
OM `boards[].accelerometer.runs` counter as the fallback signal when the POST times
out), then `download`. Every move is preceded by a fresh `move.axes` read; a
mismatch with the plan's expected start position is `failed`, never corrected.

### 5. `packages/ui/src/shaping/store.ts` (new) — I7

Solid store: per tool `{fingerprint?, captures[], sweep?, candidates?, verified[],
applied?}`; `load(tool)`/`save(tool)` via `connector.download/upload` of
`0:/sys/dwc-ng/shaping/<tool>.json` (`parseResults` boundary); raw captures stay
on the card under `0:/sys/accelerometer/` and are referenced by name.

### 6. `packages/ui/src/config/` — section `shaping`

`{envelope: {x:[lo,hi], y:[lo,hi]} | null, defaults: {dist, speed, repeats,
samples}, accelByTool: Record<toolNumber, "bb.nn">}`; `parseShaping`,
`resetSection("shaping")`, Settings card `settings-shaping` with the envelope editor
(I8).

### 7. `packages/ui/src/compose/` — screen + cards

`SHAPING_COMPOSITION` + `BUILTIN_SCREENS.shaping`. Card ids: `shaping-status`,
`shaping-capture`, `shaping-decay`, `shaping-sweep`, `shaping-candidates`,
`shaping-custom`, `shaping-verify`, `shaping-apply`; bodies in
`cards/ShapingCards.tsx`; scenarios in `dev/cardScenarios.ts` (fixture data from
`tools/accel/runs/ring/ring1` so Card Lab shows real curves).

### 8. `packages/ui/src/charts/` — three new chart components

`DecayChart.tsx` (uPlot: raw + envelope + fit, stop marker), `ResidualChart.tsx`
(uPlot: residual % vs Hz per candidate, mode markers, hover-highlight),
`SweepHeatmap.tsx` (hand-rolled canvas in the `TemperatureChart` host pattern:
frequency × speed cells, sequential single-hue ramp from `themeColors`, full-step
line and mode markers overlaid, hover tooltip). All under `contain: inline-size`
with explicit min floors in `--u`.

### 9. `packages/mock-duet` — emulation

`M955 P` reply, `M956` writes a synthetic CSV to the virtual card
(`0:/sys/accelerometer/<name>.csv`) generated from a configurable two-mode model
(mode f/ζ per axis, forced 250 Hz line ∝ speed, decel pulse from `M204`, trailer
`Rate N, overflows 0`), and honours `M593` so a verify run against the mock shows a
reduced ring. `move.shaping` reflects the last `M593`. Scenario `shaping` for
`pnpm mock`.

### 10. Apply — `cards/ShapingCards.tsx` + `shaping/apply.ts`

`applyToMacro(tool, line)` downloads `tpostN.g`, replaces the single `M593` line
(or inserts after the last `M` line if none), shows the diff, and uploads only after
`createArmed` confirm. "Try now" sends `cmd.inputShaping(spec)` without touching
files and shows the OM's `move.shaping` as confirmation.

## Recommendation rules (engine/recommend.ts, each emits a pro or con string)

- `short-shaper` pro if duration ≤ 35 ms; con "slows corners by ~N ms" if > 60 ms.
- `robust-band` pro for EI2/EI3 when tools have different masses (>1 tool
  configured); con for ZV when the fingerprint spread across tools > 6 %.
- `artefact` con (from `Verified`) when verify shows a new peak ≥ 0.05 g not in the
  fingerprint: "excites N Hz that the unshaped machine does not".
- `unverified` con on any non-`Verified` candidate.
- `mzv-rrf-ordering` con: RRF's MZV leaves ~16 % at exact tuning; never ranked top.
- `both-axes-by-harmonic` note when one F nulls both axes via a 3F alignment:
  "depends on Y ≈ 3×X; re-measure after any carriage change".
- `measured-damping` pro when S equals the fitted ζ within 0.02.
- `forced-vibration-out-of-scope` note on the Sweep card when a fixed line > 100 Hz
  dominates: "shaping cannot reduce this; it is motor ripple meeting a frame mode".

## Testing

- Engine: fixtures copied from `tools/accel/runs/ring/ring1/*.csv` and one sweep
  CSV into `packages/ui/test/fixtures/shaping/`; tests assert the TS engine
  reproduces the Python numbers (X 18.1 Hz ζ 0.127; Y 51.6 Hz ζ 0.075; EI2 F52
  residual X 43 % / Y 1 %) within 2 % / 20 %; synthetic decays; shaper sanity (sum 1,
  monotone T, tuned residual < 6 % except MZV); exhaustiveness compile test.
- Procedure: `planProcedure` refuses every `Refusal` variant (table-driven); a
  fake connector records the exact command sequence for a ring plan and proves
  restore runs after a thrown step; stale `Preconditions` rejected.
- Structural walkers: a new `test/shaping-motion-fence.test.ts` asserts no file
  under `src/shaping/` other than `procedure.ts` calls `sendCode`, and no `gc\`` tag
  or `G92` appears anywhere under `src/shaping/`.
- OM conform cases; config parse/reset; card scenarios; Card Lab scale sweep
  passes for the eight cards; px lint; lazy-bundle walker updated for the worker.
- mock-duet: node:test cases for M955/M956/M593 and the CSV trailer.
- Full battery: `pnpm test` green in ui, connector, mock-duet.

## Live verification (on Gabe's machine, T0 loaded, envelope set)

1. Status card shows T0 "not measured", `move.shaping` none.
2. Measure → 12 captures land, Decay viewer shows X 18 ± 1 Hz / Y 52 ± 1 Hz.
3. Rank → `ei2 F52` in the top rows with "short shaper" pro; ZVDD 17.5 shows the
   3F note.
4. Verify ei2 F52 and zvdd 17.5 → the latter gets the 38 Hz artefact con; the
   former is `Verified` with Y ≤ 0.035 g.
5. Apply → diff of `tpost0.g` shows the one-line change; confirm; re-download shows
   it; `M593` after a T0 reload reports ei2 52.
6. Switch to T1 → repeat 2–3 with `--accel 21.0` mapping; recommendation differs
   from T0's only within EI2's band.

## Risks

- DSF `POST /machine/code` blocks until the code finishes; a 12-capture ring run
  is ~60 s of sequential awaits — fine, but the connector's request timeout must
  exceed one move + capture; the OM-fallback path in §4 covers a timeout.
- `M956 A2` on 3.6.3 delivered the whole move (prototype finding); stop detection
  from data is therefore mandatory, not an optimisation.
- uPlot has no heatmap; the hand-rolled canvas is the one new drawing surface and
  must respect the theme/containment rules like the others.
- `tuning` card id already exists (speed factor/babystep); the screen is
  `shaping`, not `tuning`.

## Follow-ups (own ticket pairs when reached)

- Per-tool automatic re-measure prompt after a carriage/tool hardware change.
- Acceleration sweep for the ring test (`--accel` equivalent) to show how
  excitation falls with M204.
- Export of a shareable report (HTML) from the Apply card.
