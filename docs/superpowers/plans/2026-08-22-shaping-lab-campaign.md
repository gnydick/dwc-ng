# Shaping Lab Implementation Plan (campaign)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every worker MUST Read `.claude/skills/`-loaded `unbreakable:cant-break-by-design` and `solid-patterns` before writing code (memory: subagents-load-cant-break-by-design).

**Goal:** Put the input-shaping analysis proven in `tools/accel/` into dwc-ng as a Shaping screen: capture → fingerprint → candidates with pros/cons → on-machine verify → apply per tool, running entirely in the browser against either connector or mock-duet.

**Architecture:** A pure TypeScript engine (`src/shaping/engine/`) behind a Web Worker; machine motion only through a sealed `Procedure` planned from fresh `Preconditions`; results in a Solid store persisted on the card; eight cards on a new `shaping` screen with three new chart components.

**Tech Stack:** SolidJS + TypeScript + Vite, uPlot, hand-rolled canvas, node:test, pnpm workspace (`@dwc-ng/ui`, `@dwc-ng/connector`, `@dwc-ng/mock-duet`).

**Spec:** `docs/superpowers/specs/2026-08-22-shaping-lab-campaign-design.md` · **Campaign:** GitHub #13 (context #14); work items #15–#30 in pairs (and the prototype spec `2026-08-22-input-shaping-analysis-design.md`; prototype code in `tools/accel/` is reference + fixtures, never copied).

## Global Constraints

- No new dependencies (CLAUDE.md). Node ≥ 23 type stripping; tests cannot import JSX — keep data and JSX halves split as `compose/defs.ts` / `compose/cards.tsx` do.
- Every G-code string is produced by a `cmd.*` builder in `packages/ui/src/control/commands.ts` (`gcode-producers`, rung 7). Verify each code against `reference/duet-gcode.md` (`grep '^## M593:'` etc.) and `reference/dwc` before writing the builder; never from memory.
- Every machine-moving control uses `createArmed` (`control/armed.ts`); `test/armed.test.ts` rejects anything else.
- Every layout length is `calc(n * var(--u))`; `test/unit-lengths.test.ts` fails on px.
- `G92` is never emitted by this feature. Position and homed state are read from the OM immediately before each move.
- Envelope has no default; motion is refused until the user sets it (spec I8).
- Work items map 1:1 to GitHub ticket pairs (`docs/github-issue-rules.md`); each lives in worktree `.claude/worktrees/GIT_N` on branch `GIT_N`; commits carry `GIT_N`; merge `--no-ff` only after `pnpm test` is green in `ui`, `connector`, and `mock-duet`.
- Reference source (RRF `AxisShaper.cpp`, Klipper, DWC plugin) is read-only; implement from understanding.

---

## File structure

```
packages/ui/src/shaping/
  engine/units.ts          branded Hz/Seconds/G/MmPerS/MmPerS2 + constructors
  engine/capture.ts        parseCapture (Result<Capture,ParseError>), detectStop
  engine/spectrum.ts       fft, amplitudeSpectrum, peakHz, bandEnvelope
  engine/fit.ts            fitDecay → Mode|NoFit, aggregate → Fingerprint
  engine/shapers.ts        ShaperType, ShaperSpec, impulses(), zv(), convolve()
  engine/residual.ts       residual(), robust()
  engine/rank.ts           rank(fingerprint, grid) → Candidate[]
  engine/artefact.ts       newPeaks(baseline, verified) → Artefact[]
  engine/recommend.ts      prosCons(candidate, ctx) → Note[]
  engine/sweep.ts          sweepMatrix(captures) → SweepMatrix
  engine/index.ts          barrel
  worker.ts                Worker entry (request/response union)
  useEngine.ts             sole `new Worker(new URL(...))` site + typed calls
  procedure.ts             Plan, Preconditions, Refusal, Procedure (I1/I2)
  preconditions.ts         readPreconditions(om, cfg, addr) → Preconditions
  store.ts                 per-tool results store + load/save (I7)
  results.ts               parseResults boundary, ResultsFile type
  apply.ts                 applyToMacro: diff + upload
packages/ui/src/control/commands.ts        + shaping builders
packages/ui/src/om/types.ts                + move.shaping, boards[].accelerometer
packages/ui/src/config/{types,parse,store}.ts + shaping section
packages/ui/src/compose/{defs.ts,cards.tsx,screens.ts}  + 8 cards, 1 screen
packages/ui/src/cards/ShapingCards.tsx      bodies
packages/ui/src/charts/{DecayChart,ResidualChart,SweepHeatmap}.tsx
packages/ui/src/dev/cardScenarios.ts        + shaping scenarios
packages/ui/test/shaping-*.test.ts          + fixtures/shaping/*.csv
packages/mock-duet/src/{accelerometer.ts,gcode.ts,...}  emulation
```

---

## Work item A — Engine (ticket #15 / context #16, worktree GIT_15)

### Task A1: units + capture parse

**Files:**
- Create: `packages/ui/src/shaping/engine/units.ts`, `packages/ui/src/shaping/engine/capture.ts`
- Create: `packages/ui/test/fixtures/shaping/ring1_Xp0.csv` (copy of `tools/accel/runs/ring/ring1/ring1_Xp0.csv`), `.../ring1_Yp0.csv`, `.../baseline_X_100.csv` (copy of `tools/accel/runs/baseline/baseline_X_100.csv`)
- Test: `packages/ui/test/shaping-capture.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Hz = number & { readonly __unit: "Hz" }; export const hz = (n: number): Hz
  export type Seconds = ...; export const seconds
  export type G = ...; export const g
  export type MmPerS = ...; export const mmPerS
  export type MmPerS2 = ...; export const mmPerS2
  export type Capture = { readonly rate: Hz; readonly x: Float64Array; readonly y: Float64Array; readonly z: Float64Array; readonly durationS: Seconds }  // private ctor, see below
  export type ParseError = { kind: "no-trailer" } | { kind: "overflows"; count: number } | { kind: "no-samples" }
  export function parseCapture(text: string): { ok: true; capture: Capture } | { ok: false; error: ParseError }
  export function detectStop(moveAxis: Float64Array, rate: Hz, opts?: { threshG?: number; winS?: number }): Seconds | null
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/ui/test/shaping-capture.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { parseCapture, detectStop } from "../src/shaping/engine/capture.ts"

const fx = (n: string) => readFileSync(new URL(`./fixtures/shaping/${n}`, import.meta.url), "utf8")

test("parseCapture reads rate from the trailer and all three axes", () => {
  const r = parseCapture(fx("ring1_Xp0.csv"))
  assert.ok(r.ok)
  assert.equal(r.capture.rate, 1376)
  assert.equal(r.capture.x.length, 1500)
  assert.ok(Math.abs(r.capture.z[1] - 0.98) < 0.2)   // Z sees gravity
})

test("parseCapture refuses a capture without the trailer", () => {
  const r = parseCapture("Sample,X,Y,Z\n0,0,0,1\n")
  assert.ok(!r.ok && r.error.kind === "no-trailer")
})

test("parseCapture refuses overflows", () => {
  const r = parseCapture("Sample,X,Y,Z\n0,0,0,1\n1,0,0,1\nRate 1344, overflows 3\n")
  assert.ok(!r.ok && r.error.kind === "overflows" && r.error.count === 3)
})

test("detectStop finds the end of the decel pulse in a real ring capture", () => {
  const r = parseCapture(fx("ring1_Xp0.csv")); assert.ok(r.ok)
  const t = detectStop(r.capture.x, r.capture.rate)
  assert.ok(t !== null && t > 0.40 && t < 0.45, String(t))   // prototype: 0.425 s
})

test("detectStop returns null on a capture with no motion", () => {
  const flat = new Float64Array(1000).fill(0.01)
  assert.equal(detectStop(flat, 1344 as never), null)
})
```

- [ ] **Step 2: Run to verify failure** — `cd packages/ui && node --conditions=browser --test test/shaping-capture.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement units.ts**

```ts
// Branded units. One constructor per unit; nothing else mints them (cant-break rung 7).
type Brand<U extends string> = number & { readonly __unit: U }
export type Hz = Brand<"Hz">; export type Seconds = Brand<"s">; export type G = Brand<"g">
export type MmPerS = Brand<"mm/s">; export type MmPerS2 = Brand<"mm/s2">; export type Mm = Brand<"mm">
const mint = <U extends string>(n: number, unit: U): Brand<U> => {
  if (!Number.isFinite(n)) throw new RangeError(`${unit}: not finite`)
  return n as Brand<U>
}
export const hz = (n: number): Hz => mint(n, "Hz")
export const seconds = (n: number): Seconds => mint(n, "s")
export const g = (n: number): G => mint(n, "g")
export const mmPerS = (n: number): MmPerS => mint(n, "mm/s")
export const mmPerS2 = (n: number): MmPerS2 => mint(n, "mm/s2")
export const mm = (n: number): Mm => mint(n, "mm")
```

- [ ] **Step 4: Implement capture.ts**

```ts
import { hz, seconds, type Hz, type Seconds } from "./units.ts"

export type ParseError = { kind: "no-trailer" } | { kind: "overflows"; count: number } | { kind: "no-samples" }

export class Capture {
  private constructor(readonly rate: Hz, readonly x: Float64Array, readonly y: Float64Array, readonly z: Float64Array) {}
  get durationS(): Seconds { return seconds(this.x.length / this.rate) }
  /** @internal sole producer is parseCapture */
  static _mint(rate: Hz, x: Float64Array, y: Float64Array, z: Float64Array): Capture { return new Capture(rate, x, y, z) }
}

const TRAILER = /^Rate (\d+), overflows (\d+)/

export function parseCapture(text: string): { ok: true; capture: Capture } | { ok: false; error: ParseError } {
  const xs: number[] = [], ys: number[] = [], zs: number[] = []
  let rate = 0, overflows = -1
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const m = TRAILER.exec(line)
    if (m) { rate = Number(m[1]); overflows = Number(m[2]); continue }
    if (!/^\d/.test(line)) continue
    const f = line.split(",")
    xs.push(Number(f[1])); ys.push(Number(f[2])); zs.push(Number(f[3]))
  }
  if (rate <= 0 || overflows < 0) return { ok: false, error: { kind: "no-trailer" } }
  if (overflows > 0) return { ok: false, error: { kind: "overflows", count: overflows } }
  if (xs.length === 0) return { ok: false, error: { kind: "no-samples" } }
  return { ok: true, capture: Capture._mint(hz(rate), Float64Array.from(xs), Float64Array.from(ys), Float64Array.from(zs)) }
}

/** End of the last acceleration pulse on the move axis. M956 A2 on 3.6.3 delivers the whole move, so this is required. */
export function detectStop(moveAxis: Float64Array, rate: Hz, opts: { threshG?: number; winS?: number } = {}): Seconds | null {
  const thresh = opts.threshG ?? 0.25, k = Math.max(1, Math.round((opts.winS ?? 0.012) * rate))
  const med = median(moveAxis)
  let last = -1
  let acc = 0
  for (let i = 0; i < moveAxis.length; i++) {
    acc += moveAxis[i]! - med
    if (i >= k) acc -= moveAxis[i - k]! - med
    if (i >= k - 1 && Math.abs(acc / k) > thresh) last = i
  }
  return last < 0 ? null : seconds(last / rate)
}

function median(a: Float64Array): number { const s = Float64Array.from(a).sort(); return s[s.length >> 1]! }
```

Note: `Capture._mint` is the one documented seam; `test/shaping-motion-fence.test.ts` (Task C4) asserts `_mint` is referenced only from `capture.ts`.

- [ ] **Step 5: Run tests** → PASS. Adjust `threshG`/window only if the 0.40–0.45 s window fails; the fixture's stop is at 0.425 s.

- [ ] **Step 6: Commit** — `git commit -m "feat(shaping): branded units, capture parse, stop detection GIT_15"` (+ Co-Authored-By).

### Task A2: spectrum + decay fit

**Files:** Create `engine/spectrum.ts`, `engine/fit.ts`; Test `test/shaping-fit.test.ts`.

**Interfaces:**
```ts
export function amplitudeSpectrum(x: Float64Array, rate: Hz, padFactor?: number): { freqs: Float64Array; amps: Float64Array }  // Hann window, amplitude in g
export function peakHz(x: Float64Array, rate: Hz, minHz: number, maxHz: number): Hz   // rectangular window, 8x zero pad
export function bandEnvelope(x: Float64Array, rate: Hz, centre: Hz, rel?: number): Float64Array  // |analytic signal| of band-passed x
export type Mode = { readonly f: Hz; readonly zeta: number; readonly peakG: G; readonly cyclesFit: number; readonly __mode: true }
export type NoFit = { readonly reason: "short-window" | "below-floor" | "short-decay" | "damping-out-of-range"; readonly f?: Hz; readonly peakG?: G }
export function fitDecay(axis: Float64Array, rate: Hz, tStop: Seconds, opts?: { fmax?: number; floorG?: number; windowS?: number }): Mode | NoFit
export type Fingerprint = { readonly X: Mode | null; readonly Y: Mode | null; readonly n: { X: number; Y: number }; readonly spreadHz: { X: number; Y: number } }
export function aggregate(fits: ReadonlyArray<{ axis: "X" | "Y"; fit: Mode | NoFit }>): Fingerprint
```

- [ ] **Step 1: Failing tests** — synthetic decays (f ∈ {14, 38, 55, 90}, ζ ∈ {0.05, 0.1, 0.15, 0.03}, noise 0.01 g) must fit f within 2 % and ζ within 20 %; noise-only returns `below-floor`; the real fixture `ring1_Xp0.csv` fits 18.1 ± 0.5 Hz, ζ 0.127 ± 0.03; `ring1_Yp0.csv` fits 51.7 ± 1 Hz. Use `detectStop` from A1 for the real fixtures.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement spectrum.ts** — in-place radix-2 FFT (`fft(re, im)`), `amplitudeSpectrum` (Hann, `2|X|/Σw`), `peakHz` (rectangular, zero-pad to `nextPow2(n*8)`, argmax in [min,max]), `bandEnvelope` (FFT mask `[centre(1-rel), centre(1+rel)]`, rel default 0.25, analytic signal by doubling positive bins, inverse FFT, magnitude).
- [ ] **Step 4: Implement fit.ts** — window `[tStop+0.01, +windowS(0.6)]`; `below-floor` if max|seg| in first 100 ms < floorG (0.02); `f0 = peakHz(seg, rate, 5, fmax 150)`; envelope; peak index in first 100 ms; fit `ln(env)` from peak until env < 15 % of peak; require ≥ 2 cycles else `short-decay`; `zeta = -slope/(2π f0)`; range 0.005–0.5 else `damping-out-of-range`. `aggregate`: per axis median of f and ζ over ok fits, `spreadHz = max-min`, `null` when no ok fit.
- [ ] **Step 5: Run → PASS.** Numbers must match the prototype (`tools/accel/runs/ring/ring1/fingerprint.json`: X 18.1/0.127, Y 51.6/0.075 as medians over 6).
- [ ] **Step 6: Commit** `feat(shaping): spectrum + decay fit reproduce prototype fingerprint GIT_N`.

### Task A3: shapers, residual, rank, artefact

**Files:** Create `engine/shapers.ts`, `engine/residual.ts`, `engine/rank.ts`, `engine/artefact.ts`; Test `test/shaping-shapers.test.ts`, `test/shaping-rank.test.ts`.

**Interfaces:**
```ts
export type ShaperType = "zvd" | "zvdd" | "zvddd" | "mzv" | "ei2" | "ei3"
export const SHAPER_TYPES: readonly ShaperType[]
export type ShaperSpec = { readonly type: ShaperType; readonly F: Hz; readonly S: number } | { readonly type: "custom"; readonly H: readonly number[]; readonly T: readonly Seconds[] }
export type Impulses = { readonly A: Float64Array; readonly T: Float64Array }   // A sums to 1, T[0] = 0, strictly increasing
export function impulses(spec: ShaperSpec): Impulses        // exhaustive switch with `never` arm (I5)
export function zv(f: Hz, zeta: number): Impulses
export function convolve(a: Impulses, b: Impulses): Impulses
export function residual(imp: Impulses, mode: Mode): number  // 0..1
export function robust(imp: Impulses, mode: Mode, rel?: number): number  // max over ±rel (0.1) in 5 steps
export type Candidate = { readonly spec: ShaperSpec; readonly residual: { X?: number; Y?: number }; readonly robust: { X?: number; Y?: number }; readonly worstRobust: number; readonly durationS: Seconds; readonly __candidate: true }
export function rank(fp: Fingerprint, opts?: { sValues?: number[]; fStepHz?: number }): Candidate[]  // sorted by (worstRobust, duration)
export function customCandidate(spec: Extract<ShaperSpec, { type: "custom" }>, fp: Fingerprint): Candidate
export type Artefact = { readonly hz: Hz; readonly peakG: G; readonly axis: "X" | "Y" }
export function newPeaks(baseline: Fingerprint, verified: Fingerprint, floorG?: number, tolRel?: number): Artefact[]  // modes in verified not within ±tolRel (0.15) of a baseline mode, peak ≥ floorG (0.05)
```

- [ ] **Step 1: Failing tests** — each type: `A` sums to 1 (1e-9), all > 0, `T` strictly increasing; tuned residual < 0.06 except mzv (< 0.2, documenting RRF's reversed ordering); detuned (×1.5; ×2 for ei3) worse; band width ei3 > zvdd > zvd (count of f in 20–60 Hz with residual < 0.1); `convolve(zv(18.1,0.127), zv(51.6,0.075))` has 4 impulses and ≤ 0.01 residual on both modes; `rank` of the prototype fingerprint puts a `zvddd` at F 17.5 first and reports ei2 F52 residual X ≈ 0.43 / Y ≈ 0.01; `newPeaks` flags a 38 Hz mode of 0.08 g against the prototype baseline and ignores a 52 Hz one.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement shapers.ts** from the RRF 3.6 semantics (read `AxisShaper.cpp` as reference, write the formulas yourself): `k = exp(-ζπ/√(1-ζ²))`, damped period `td = 1/(F√(1-ζ²))`; zvd/zvdd/zvddd binomial in `k` at `td/2` spacing; mzv with `km = exp(-0.75ζπ/√(1-ζ²))`, amplitudes `[a3, a2, a1]/sum` at `[0, 3td/8, 3td/4]`; ei2/ei3 polynomial coefficients and delays in ζ; last amplitude = 1 − Σ. `custom` passes H/T through (validate sum(H) < 1, T increasing). `switch (spec.type)` with `default: { const _x: never = spec; throw ... }`.
- [ ] **Step 4: Implement residual.ts, rank.ts, artefact.ts** — residual: `e^{-ζω T_last} · |Σ A e^{ζω t}(cos ω_d t, sin ω_d t)|`; rank: F grid `floor(0.7·minF) … ceil(1.3·maxF)` step 0.5, S ∈ {0.05,0.1,0.15,0.2}; sort by `(round(worstRobust,3), durationS)`.
- [ ] **Step 5: Run → PASS.** **Step 6: Commit** `feat(shaping): RRF-3.6 shaper model, residual ranking, artefact detection GIT_N`.

### Task A4: recommend + sweep + worker

**Files:** Create `engine/recommend.ts`, `engine/sweep.ts`, `engine/index.ts`, `shaping/worker.ts`, `shaping/useEngine.ts`; Modify `packages/ui/test/lazy-bundle.test.ts` only if the walker flags the worker URL import (it should not — no heavy dep); Test `test/shaping-recommend.test.ts`, `test/shaping-sweep.test.ts`.

**Interfaces:**
```ts
export type Note = { readonly kind: "pro" | "con" | "note"; readonly rule: "short-shaper" | "long-shaper" | "robust-band" | "narrow-band" | "artefact" | "unverified" | "mzv-rrf-ordering" | "both-axes-by-harmonic" | "measured-damping" ; readonly text: string }
export type RecommendCtx = { readonly fp: Fingerprint; readonly toolsConfigured: number; readonly verified?: { readonly residual: { X?: number; Y?: number }; readonly artefacts: readonly Artefact[] } }
export function prosCons(c: Candidate, ctx: RecommendCtx): Note[]
export type SweepMatrix = { readonly speeds: MmPerS[]; readonly freqs: Float64Array; readonly amps: Float64Array /* speeds.length × freqs.length, g */; readonly fullStepHz: Hz[] /* per speed */ }
export function sweepMatrix(rows: ReadonlyArray<{ speed: MmPerS; capture: Capture; moveS: Seconds }>, fullStepsPerMm: number, maxHz?: number): SweepMatrix
// worker protocol
export type EngineRequest = { id: number } & ({ kind: "fit"; csv: string; axis: "X" | "Y" } | { kind: "rank"; fp: Fingerprint } | { kind: "sweep"; rows: ...; fullStepsPerMm: number } | { kind: "artefact"; baseline: Fingerprint; verified: Fingerprint })
export type EngineResponse = { id: number } & ({ ok: true; result: unknown } | { ok: false; error: string })
export function useEngine(): { fit(csv: string, axis: "X"|"Y"): Promise<{ tStop: Seconds | null; fit: Mode | NoFit; capture: Capture }>; rank(fp): Promise<Candidate[]>; sweep(...): Promise<SweepMatrix>; artefact(...): Promise<Artefact[]> }
```

- [ ] **Step 1: Failing tests** — `prosCons` emits `short-shaper` pro for a 29 ms ei2, `long-shaper` con for 88 ms zvdd with the ms in the text, `artefact` con when ctx.verified has a 38 Hz artefact, `unverified` con without ctx.verified, `mzv-rrf-ordering` con for mzv, `both-axes-by-harmonic` note when `|F·3 − fp.Y.f| / fp.Y.f < 0.1`, `measured-damping` pro when `|S − ζ| ≤ 0.02`, `robust-band` pro for ei2/ei3 when `toolsConfigured > 1`; `sweepMatrix` over 4 fixture captures (copy `baseline_X_{20,50,100,200}.csv`) has `fullStepHz = speed×5` and the 100 mm/s row's argmax ≈ 250 Hz.
- [ ] **Step 2–4:** implement; worker posts with transferables like `gcode/parseGcode.worker.ts` (`self` cast to a local interface; lib has no WebWorker). `useEngine` creates one worker per app (`new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })`), correlates by `id`, rejects on `ok:false`.
- [ ] **Step 5: Run all `shaping-*` tests → PASS. `pnpm -r test` green.** **Step 6: Commit.**

---

## Work item B — Board surface: OM types, G-code builders, mock-duet emulation (ticket #17 / context #18, worktree GIT_17)

### Task B1: OM types

**Files:** Modify `packages/ui/src/om/types.ts` (`Move` ~line 72, `Board` ~155, `emptyModel`, `conformModelKey` `move`/`boards` arms); Test `packages/ui/test/om-conform.test.ts` (add cases).

**Interfaces:**
```ts
export interface Shaping { readonly type: string; readonly frequency: number; readonly damping: number; readonly amplitudes: readonly number[]; readonly delays: readonly number[] }
export interface Move { ...; readonly shaping: Shaping }
export interface Accelerometer { readonly orientation: number; readonly points: number; readonly runs: number }
export interface Board { ...; readonly accelerometer: Accelerometer | null }
```
Cite `reference/objectmodel/src/move/InputShaping.ts` and `reference/objectmodel/src/boards/Accelerometer.ts` (check exact file names under `reference/objectmodel/`) in the interface comments.

- [ ] **Step 1: Failing tests** — `conformModelKey("move", {...no shaping})` yields `shaping.type === "none"`; a board without `accelerometer` conforms to `null`; a board with `{orientation:41,points:0,runs:3}` passes through.
- [ ] **Step 2–4:** implement; default `shaping = { type: "none", frequency: 0, damping: 0, amplitudes: [], delays: [] }`.
- [ ] **Step 5: `pnpm --filter @dwc-ng/ui test` → PASS.** **Step 6: Commit.**

### Task B2: G-code builders

**Files:** Modify `packages/ui/src/control/commands.ts` (add under the existing `cmd` object); Test `packages/ui/test/commands-shaping.test.ts`.

**Interfaces:**
```ts
cmd.accelConfig(addr: AccelAddr): GcodeCommand                   // M955 P<bb.nn>
cmd.accelCapture(addr: AccelAddr, samples: number, trigger: 0|1|2, file: string): GcodeCommand  // M956 P S A F"..."
cmd.inputShaping(spec: ShaperSpec): GcodeCommand                 // M593 P"type" F S   |  M593 P"custom" H.. T..
cmd.shapingOff(): GcodeCommand                                   // M593 P"none"
cmd.queryShaping(): GcodeCommand                                 // M593
cmd.waitMoves(): GcodeCommand                                    // M400
cmd.dwell(ms: number): GcodeCommand                              // G4 P<ms>
cmd.absolute(): GcodeCommand                                     // G90
cmd.moveTo(target: ReadonlyArray<{ axis: "X"|"Y"; mm: Mm }>, feedMmPerMin: number): GcodeCommand  // G1 X.. Y.. F..
export type AccelAddr = string & { readonly __accel: true }; export function accelAddr(boardAddress: number, device: number): AccelAddr
```

- [ ] **Step 1: Read the reference first** — `grep -n '^## M593:\|^## M955:\|^## M956:\|^## G4:\|^## M400:' reference/duet-gcode.md` and read those sections; confirm the custom form `H` = amplitudes except last, `T` = cumulative delays except first, in seconds (3.6).
- [ ] **Step 2: Failing tests** — exact strings: `M955 P20.0`, `M956 P20.0 S1500 A2 F"ring_Xp0.csv"`, `M593 P"ei2" F52 S0.075`, `M593 P"custom" H0.3350:0.2641:0.2242 T0.00972:0.02780:0.03752`, `M593 P"none"`, `G4 P500`, `G1 X180 Y120 F12000`; `S` and `F` formatted with `%g`-style (no trailing zeros); custom `H` to 4 dp, `T` to 5 dp.
- [ ] **Step 3–4:** implement with the `gc` tag, `gcodeQuote` for the file name and shaper type, `axisLetter` for axes; `inputShaping` switches on `spec.type` with the `never` arm.
- [ ] **Step 5: PASS; run `test/gcode-producers` walker (whatever enforces the brand) → green.** **Step 6: Commit.**

### Task B3: mock-duet accelerometer + shaping emulation

**Files:** Create `packages/mock-duet/src/accelerometer.ts`; Modify `packages/mock-duet/src/gcode.ts` (or wherever M-codes dispatch — find with `grep -n "case \"M" packages/mock-duet/src/*.ts`), `packages/mock-duet/src/snapshot.ts:223` (`move.shaping` reflects M593), scenario list; Test `packages/mock-duet/test/accelerometer.test.ts`.

**Interfaces:**
```ts
export type MockModes = { X: { f: number; zeta: number; g: number }; Y: { f: number; zeta: number; g: number }; forced?: { hz: number; gAt100: number } }
export function synthCapture(opts: { rate: number; samples: number; axis: "X"|"Y"; speed: number; dist: number; accel: number; modes: MockModes; shaper?: Impulse[] }): string  // CSV text with trailer
```

- [ ] **Step 1: Failing tests** — `M955 P20.0` replies `Accelerometer 20:0 type LIS3DH with orientation 41 samples at 1344Hz with 10-bit resolution`; `M956 P20.0 S1500 A1 F"t.csv"` followed by `G1 X250 F6000` creates `0:/sys/accelerometer/t.csv` with 1500 rows and trailer `Rate 1344, overflows 0`; the CSV, parsed with the UI engine (`packages/ui/src/shaping/engine` imported across the workspace in the test), fits the configured Y mode within 2 %; after `M593 P"zvd" F52 S0.1` the synthesized Y ring peak is < 30 % of the unshaped one; `M593` reply string matches RRF's format (`Input shaping "zvd" at 52.0Hz damping ratio 0.10 …` — copy the exact shape from `reference/dwc` or the 3.6 docs) and `move.shaping` in the model updates.
- [ ] **Step 2–4:** implement synth: accel pulse `+a` for `v/a` s, cruise `dist/v − 2v/a` s with forced sine `gAt100·(v/100)` at `forced.hz`, decel pulse `−a`, then ring `g·e^{−ζωt}cos(ω_d t)` on the move axis (scaled by the shaper's residual when a shaper is active), Z = 1 g + noise, 0.01 g Gaussian noise everywhere; capture begins at the move start (match the 3.6.3 behaviour that the prototype found).
- [ ] **Step 5: `pnpm --filter @dwc-ng/mock-duet test` → PASS; `pnpm mock --scenario shaping` serves it.** **Step 6: Commit.**

---

## Work item C — Procedures, preconditions, config, results store (ticket #19 / context #20, worktree GIT_19)

### Task C1: config section `shaping` (I8)

**Files:** Modify `packages/ui/src/config/types.ts` (`UiConfig`, `DEFAULT_CONFIG`), `config/parse.ts` (`parseShaping` + wire into `parseOverlay`), `config/store.ts` (`setShaping`, `resetSection("shaping")`); Test `test/config-shaping.test.ts`.

```ts
export interface ShapingConfig { readonly envelope: { readonly x: readonly [number, number]; readonly y: readonly [number, number] } | null; readonly defaults: { readonly distMm: number; readonly speedMmS: number; readonly repeats: number; readonly samples: number }; readonly accelByTool: Readonly<Record<number, string>> }
DEFAULT_CONFIG.shaping = { envelope: null, defaults: { distMm: 60, speedMmS: 200, repeats: 3, samples: 1500 }, accelByTool: {} }
```
- [ ] Tests: overlay with `envelope` round-trips; `parseShaping` drops `envelope: {x:[1]}` (malformed) to `null`; `accelByTool` keeps only `"\d+\.\d+"` strings; `resetSection("shaping")` returns `envelope` to `null`.
- [ ] Implement, PASS, commit.

### Task C2: preconditions + plan + refusal (I1)

**Files:** Create `packages/ui/src/shaping/preconditions.ts`, `packages/ui/src/shaping/procedure.ts`; Test `test/shaping-procedure.test.ts`.

**Interfaces:**
```ts
export type Refusal = { kind: "not-idle"; status: string } | { kind: "not-homed"; axes: string } | { kind: "no-accelerometer"; addr: string } | { kind: "no-envelope" } | { kind: "outside-envelope"; point: { x: number; y: number } } | { kind: "stale" }
export class Preconditions { private constructor(...); readonly readAt: number; readonly position: { x: Mm; y: Mm }; readonly accel: AccelAddr; readonly travelAccel: MmPerS2; readonly priorShaping: Shaping
  static read(om: ObjectModel, cfg: ShapingConfig, accel: AccelAddr, now: number): { ok: true; pre: Preconditions } | { ok: false; refusal: Refusal } }
export type RingPlan = { kind: "ring"; axis: "X"|"Y"; start: { x: Mm; y: Mm }; distMm: Mm; speed: MmPerS; repeats: number; samples: number; namePrefix: string }
export type SweepPlan = { kind: "sweep"; start: { x: Mm; y: Mm }; distMm: Mm; speeds: MmPerS[]; samples: number; namePrefix: string }
export type VerifyPlan = { kind: "verify"; spec: ShaperSpec; ring: RingPlan }
export type Plan = RingPlan | SweepPlan | VerifyPlan
export type Step = { readonly codes: readonly GcodeCommand[]; readonly expectFile?: string; readonly label: string; readonly expectPosition: { x: Mm; y: Mm } }
export class Procedure { private constructor(readonly steps: readonly Step[], readonly restore: readonly GcodeCommand[], readonly pre: Preconditions) ... }
export function planProcedure(plan: Plan, pre: Preconditions, cfg: ShapingConfig, now: number): { ok: true; proc: Procedure } | { ok: false; refusal: Refusal }
```
Rules: `stale` if `now − pre.readAt > 2000 ms`; every point of the plan (start, start+dist on the axis, and for `X-Y` variants both corners) must be inside `cfg.envelope`; `restore` = `[cmd.inputShaping(pre.priorShaping as spec)]` or `[cmd.shapingOff()]` when prior type is `none` — computed at plan time only (I2). Each `Step` carries the position the carriage must be at before its codes run.

- [ ] **Step 1: Failing tests** — table-driven: each `Refusal` variant from a crafted OM/config; a valid ring plan yields `2·repeats` capture steps per direction with `expectFile` names `${prefix}_X{p|m}{i}.csv` and codes in the exact order `[G90, G1 start, M400, G4, M956, G1 end, M400, G4]`; `restore` equals `M593 P"none"` when prior is none and `M593 P"ei2" F52 S0.075` when prior is that; a verify plan prepends `M593 <spec>` as step 0 and its restore is the prior.
- [ ] **Step 2–4:** implement. No `G92` anywhere. Use only `cmd.*`.
- [ ] **Step 5: PASS.** **Step 6: Commit.**

**Carried forward from B2 (2026-08-22):** `reference/dwc` (`plugins/InputShaping/RecordMotionProfileDialog.vue:555,557`) puts `M400`, `M956` and the move on a SINGLE line so the capture arms in the same buffer as the move. Our builders are one-command-each and `joinCommands` separates with `
`. With trigger `A1`/`A2` the M956 is still queued before the move, so ordering should hold — but this is UNVERIFIED on the board. MOCK HALF SETTLED 2026-08-22: driving mock-duet over HTTP with M956 and the move as SEPARATE rr_gcode requests still produced the capture file, so the arm survives separation there. The REAL BOARD is still unverified - confirm before trusting the first hardware capture; if the separate-line form loses the arm, the step must emit one joined command.


### Task C3: run loop with capture retrieval + structural restore (I2)

**Files:** Modify `shaping/procedure.ts` (add `run`); Test `test/shaping-procedure-run.test.ts` with a fake connector.

```ts
export type ProcEvent = { kind: "step"; index: number; label: string } | { kind: "capture"; file: string; csv: string } | { kind: "restored" } | { kind: "done" } | { kind: "failed"; error: string }
Procedure.run(conn: { sendCode(c: GcodeCommand): Promise<string>; list(dir: string): Promise<string[]>; download(p: string): Promise<string> }, om: () => ObjectModel): AsyncGenerator<ProcEvent>
```
Rules: before each step read `om().move.axes` and compare `userPosition` of X/Y to `step.expectPosition` within 0.05 mm → otherwise yield `failed` (never correct); snapshot `list("0:/sys/accelerometer")` before the capture step; after the move, poll `list` every 250 ms up to 10 s for `expectFile`, falling back to `om().boards[b].accelerometer.runs` increment when the POST rejected with a timeout; `download` and yield `capture`; `finally` sends every `restore` code and yields `restored`.

- [ ] **Step 1: Failing tests** — fake connector records the exact command sequence for a 1-repeat ring plan; a fake whose `sendCode` throws on step 3 still sees the restore codes sent and the generator yields `failed` then `restored`; a position mismatch before step 2 yields `failed` without sending that step's codes; capture file appearing on the second `list` poll is downloaded.
- [ ] **Step 2–4:** implement. **Step 5: PASS.** **Step 6: Commit.**

### Task C4: results store + motion fence walker (I7)

**Files:** Create `shaping/results.ts`, `shaping/store.ts`; Create `test/shaping-motion-fence.test.ts`, `test/shaping-results.test.ts`.

```ts
export type ToolResults = { readonly tool: number; readonly fingerprint: Fingerprint | null; readonly captures: readonly { file: string; axis: "X"|"Y"; dir: "+"|"-"; rep: number; fit: Mode | NoFit; tStop: Seconds | null }[]; readonly sweep: SweepMatrix | null; readonly candidates: readonly Candidate[]; readonly verified: readonly VerifiedCandidate[]; readonly applied: ShaperSpec | null }
export type VerifiedCandidate = Candidate & { readonly __verified: true; readonly measured: { X?: number; Y?: number }; readonly artefacts: readonly Artefact[]; readonly fingerprint: Fingerprint }   // sole producer: verifyAnalysis() in store.ts (I6)
export const RESULTS_PATH = (tool: number) => `0:/sys/dwc-ng/shaping/tool${tool}.json`
export function parseResults(text: string): ToolResults | null
export function createShapingStore(conn: ConnectorReads & Pick<ConnectorWrites, "upload">): { results: Store<Record<number, ToolResults>>; load(tool): Promise<void>; save(tool): Promise<void>; setFingerprint(...); addVerified(...); ... }
```
Fence test: walk `src/shaping/**`; assert `sendCode(` appears only in `procedure.ts`; `"G92"`/`G92 ` appears nowhere; `` gc` `` appears nowhere (builders live in `commands.ts`); `Capture._mint` appears only in `engine/capture.ts`; `__verified: true` literal appears only in `store.ts`.

- [ ] Tests for parse round-trip, malformed → null, fence walker red-check (a temp file containing `sendCode(` under `src/shaping/` makes it fail — write the red check as a test that constructs the offending source in memory and runs the walker's predicate).
- [ ] Implement, PASS, commit.

---

## Work item D — Screen, status + capture cards (ticket #21 / context #22, worktree GIT_21)

### Task D1: screen + card defs + scenarios

**Files:** Modify `compose/defs.ts` (8 defs), `compose/cards.tsx` (8 bodies, placeholders allowed only as `<ShapingStatusBody/>` etc. that render real content by the end of this work item), `compose/screens.ts` (`SHAPING_COMPOSITION`, `BUILTIN_SCREENS.shaping`), `dev/cardScenarios.ts` (scenario `shaping-measured` built from `test/fixtures/shaping` numbers: T0 fingerprint X 18.1/0.127/0.05, Y 51.6/0.075/0.103; a candidates list; one verified entry with a 38 Hz artefact); Create `cards/ShapingCards.tsx`.
- [ ] Card defs: `shaping-status` (title "Shaping", tip `M593 · M955 · M956`), `shaping-capture`, `shaping-decay`, `shaping-sweep`, `shaping-candidates`, `shaping-custom`, `shaping-verify`, `shaping-apply`; sizes measured via Card Lab (start at `{colSpan: 156, rowSpan: 40}` and let `contentRowSpan` correct them).
- [ ] Tests: `test/card-scenarios.test.ts` picks up the new scenario automatically; `pnpm test` (px lint, armed walker, layout audit) green.
- [ ] Commit.

### Task D2: status card

- Per-tool table from `app.om.om.tools` × store results; `move.shaping` live; reads `tpostN.g` lazily on expand via `sysBrowser` (`compose/services.ts:215`) and shows the `M593` line found; buttons Measure/Sweep/Rank/Verify/Apply with disabled reasons from `Preconditions.read` (`Refusal` → copy table: `not-idle` "machine is busy", `not-homed` "home X and Y first", `no-accelerometer` "no accelerometer at {addr} — check Settings › Shaping", `no-envelope` "set the motion envelope in Settings › Shaping", `outside-envelope` "test would leave the envelope at X{x} Y{y}").
- [ ] Tests: a pure `refusalText(r: Refusal): string` in `shaping/copy.ts` is exhaustive (`never` arm) and tested per variant.
- [ ] Commit.

### Task D3: capture card with armed run + progress

- Motion editor bound to `config.shaping.defaults`; tiny XY map (SVG, lengths in `--u`) drawing envelope box + planned segments; `createArmed<"run">()` two-step; on confirm: `Preconditions.read` → `planProcedure` → `for await (ev of proc.run(...))` updating a progress strip; captures go to the store with `useEngine().fit`; refusals render inline.
- [ ] Tests: `test/armed.test.ts` walker passes; a node test for `plannedSegments(plan)` (pure) returns the polyline the map draws.
- [ ] Commit. **Live check against mock-duet scenario `shaping`:** a full ring run lands 12 captures and the status card shows a fingerprint.

---

## Work item E — Decay + sweep charts (ticket #23 / context #24, worktree GIT_23)

### Task E1: `charts/DecayChart.tsx` + decay card
- uPlot, pattern from `TemperatureChart.tsx` (build once, `setData`, host-measured height, `contain: inline-size` + min floors in `app.css`); series: raw g, envelope, fitted `peak·e^{−ζω(t−t_pk)}`; vertical marker at `tStop`; picker for capture (axis/dir/rep) and an Import button listing `0:/sys/accelerometer/*.csv` via `list` → `useEngine().fit` → shown without being stored unless "Keep".
- [ ] Tests: `decaySeries(capture, fit, tStop)` pure function in `charts/decayData.ts` tested for lengths/marker index; px lint; scale sweep.
- [ ] Commit.

### Task E2: `charts/SweepHeatmap.tsx` + sweep card
- Canvas component: host-measured size, draws `SweepMatrix` cells with a single-hue ramp built from `themeColors.token("--accent")` steps (light/dark both validated — reuse the dataviz palette rule: sequential = one hue light→dark), overlays `fullStepHz` line and `fingerprint` markers, hover tooltip (speed, Hz, g) in an HTML layer; `sweepMatrix` computed in the worker from the store's sweep captures.
- [ ] Tests: `heatmapCells(matrix, w, h)` pure layout function; px lint; scale sweep.
- [ ] Commit. Live check on mock: the forced line appears at the configured `forced.hz` across speeds.

---

## Work item F — Candidates, recommendation, custom (ticket #25 / context #26, worktree GIT_25)

### Task F1: `charts/ResidualChart.tsx` + candidates card
- uPlot; x = Hz 8–90, one series per candidate (top 8 + selected), mode markers; hover row ↔ series highlight via a shared signal; table columns: shaper, F, S, residual X/Y, ±10 % X/Y, duration ms, notes (pros ✓ / cons ✗ / notes ·) from `prosCons`; "Rank" button runs `useEngine().rank(fp)`; `toolsConfigured` = number of tools with an `accelByTool` entry.
- [ ] Tests: `candidateRows(cands, ctx)` pure → strings; px lint.
- [ ] Commit.

### Task F2: custom card
- Two modes: (a) H/T fields exactly as M593 takes them, validated (`sum(H) < 1`, `T` increasing) → `customCandidate`; (b) "ZV ⊗ ZV of two modes" picker (defaults to fingerprint X and Y) → `convolve(zv, zv)` → H/T shown read-only + the resulting `M593 P"custom"` line. Live residual/robust numbers and the curve added to the residual chart.
- [ ] Tests: `parseHT(text)` pure parser with red cases; commit.

---

## Work item G — Verify + apply (ticket #27 / context #28, worktree GIT_27)

### Task G1: verify card
- Multi-select candidates (top 3 preselected, one per type); armed run of `VerifyPlan` per candidate (`repeats − 1`), fit → `verifyAnalysis(baselineFp, candidate, fits)` in `store.ts` → `VerifiedCandidate` with `measured = verifiedPeak/baselinePeak` per axis and `artefacts = newPeaks(...)`; bar chart (inline SVG, `--u` lengths): predicted vs measured per axis per candidate; artefacts rendered as ✗ notes.
- [ ] Tests: `verifyAnalysis` with the prototype numbers (ZVDD 17.5 verify fits at 38 Hz 0.084 g → artefact; ei2 F52 → X `no-fit` ⇒ measured X = 0, Y 0.028/0.103 = 0.27); commit.

### Task G2: apply card + `shaping/apply.ts`
```ts
export function rewriteMacro(text: string, line: string): { text: string; diff: { removed: string | null; added: string; at: number } }  // replace the single M593 line or insert after the last line starting with "M"
export async function applyToMacro(conn, tool: number, spec: ShaperSpec): Promise<{ path: string; diff }>
```
- Card: per tool the recommended line (`Verified` preferred, else best-ranked with the `unverified` con shown), Copy, "Try now" (sends `cmd.inputShaping`, shows `move.shaping` after), "Write to tpostN.g" → shows diff → `createArmed` confirm → `upload`. Click on the macro name opens it in the editor (click semantics: files never run).
- [ ] Tests: `rewriteMacro` on the real `tpost0.g` shape (a commented `;M593` line must be left alone and the active one replaced; a file with none gets an insert after the last `M` line); commit.

---

## Work item H — Ledger, docs, live verification (ticket #29 / context #30, worktree GIT_29)

- [ ] Add `@invariant` blocks for I1–I8 in their files with rungs as in the spec; register them wherever the ledger auto-registers (`packages/invariants`); debt rows for I7.
- [ ] `docs/` lesson via `project-curriculum` skill: "Ringing vs forced vibration; why verify beats simulate" citing the 38 Hz artefact.
- [ ] Run the spec's Live verification 1–6 on the machine with the runner-style caution (T0 loaded, envelope set in Settings); record outcomes in the campaign ledger comment on the Context child.
- [ ] Merge `--no-ff`, deploy (`pnpm build && pnpm ship --target http://duet3.nydick.net --mode dsf`), close the pair.

---

## Self-review

- **Spec coverage:** cards 1–8 → D2, D3, E1, E2, F1, F2, G1, G2; engine → A1–A4; builders → B2; OM → B1; mock → B3; procedure/preconditions/restore → C2/C3; config/envelope → C1; results → C4; recommendation rules → A4 (`prosCons`) + G1 (artefact) ; custom → A3 (`customCandidate`, `convolve`) + F2; apply → G2; live verification + ledger → H. Risks: DSF timeout → C3 fallback; `A2` whole-move → A1 `detectStop`; heatmap → E2; `tuning` id clash → D1 uses `shaping-*`.
- **Placeholders:** none; every task names files, signatures, and test assertions.
- **Type consistency:** `Capture`, `Mode`, `NoFit`, `Fingerprint`, `ShaperSpec`, `Impulses`, `Candidate`, `VerifiedCandidate`, `Artefact`, `Note`, `SweepMatrix`, `Refusal`, `Preconditions`, `Plan`, `Step`, `Procedure`, `ProcEvent`, `ToolResults`, `AccelAddr` are defined once (A1–A4, C2–C4, B2) and used by those names in D–G.
