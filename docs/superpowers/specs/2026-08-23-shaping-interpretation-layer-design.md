# The interpretation layer — one workflow state machine, and evidence that carries its own validity

Campaign design, 2026-08-23. Issue set #68 / #69. Companion to
`2026-08-22-shaping-lab-campaign-design.md` (the capability) and
`2026-08-22-input-shaping-analysis-design.md` (the method).

## Problem

The Shaping screen presents instruments. Reading them requires knowing things the
tool already holds but never says, and on 2026-08-23 that gap produced a wrong
conclusion on real hardware: the sweep heat map showed black where the magenta
fingerprint markers stood, and the fingerprint was judged garbage. It might be —
but **that sweep could not have shown those modes**. The ladder ran 25–200 mm/s;
at 5 full steps/mm the forcing band is 125–1000 Hz, while the fitted modes are
38.7 and 41.5 Hz. Nothing drove them. The tool holds `stepsPerMm`, the ladder and
the fingerprint, and said nothing.

The failure mode is not confusion. It is **confident wrong action**: a shaper
applied against a forced peak, a fingerprint trusted from an unexcited band, a
candidate applied because it ranked first — the last of which previously
introduced a 38 Hz mode on this machine. Each looks exactly like success.

## Root cause, stated as an invariant violation

`steps.ts` asks eight booleans (`hasFingerprint`, `hasSweep`, …). A boolean makes
**"a fingerprint exists"** and **"a fingerprint valid for ranking"** the same
value. So:

- A fingerprint measured through an active shaper reads `true`, exactly like a
  clean one (#53).
- A fingerprint taken at 6000 mm/s² reads `true` when you print at 10000.
- A sweep whose ladder never excited the modes reads `true`, exactly like one
  that bracketed them.
- Nothing ever goes back to `false`. A tool change, a shaper install and an accel
  change all leave every product looking as fresh as the moment it was measured.

That is an illegal state the type system currently permits. The whole of #68's
list is one sentence: **evidence exists but is not valid for its consumer, and
nothing can say so.**

## Ruling (Gabe, 2026-08-23)

> "state machine controls button life cycles and card messages. make it a real
> state machine and driven by it, not an approximation. map the state machine to
> the implied flow-chart that is the workflow and decisions, exceptions,
> constraints, etc."

And, on judging the architecture up front: *"i honestly don't know, we'll stress
test it when it's done."* — which is why "Stress test" below is a requirement of
this spec, not a postscript.

## Approaches considered

- **One machine per product, composed** — chosen. Five identical small machines;
  the screen-level view is a fold over them.
- **One screen-level machine** (`unmeasured` → `measured` → … → `applied`).
  Rejected: the screen genuinely holds a good fingerprint and a bad sweep at
  once, which one global state can only express as the cross-product.
- **Guard graph** — transitions with guards, state implicit. Rejected: this is
  what `steps.ts` is today, and it is the approximation the ruling names.

## The machine

Identical for each of the five products (fingerprint, sweep, candidates,
verified, applied):

```
                        +---------- invalidate <-------------+
                        |  (tool change, shaper, accel)      |
                        v                                    |
   ABSENT ---act---> RUNNING ---ok--->   HELD  --------> SUPERSEDED
      ^              |  |               value              value
      |              |  |               provenance         cause
      |          fail|  |cancel         caveats[]            |
      |              v  v                                    |
      +--- clear --- FAILED <--------------------------- clear
                      why
```

The verdict, and with it the button's lifecycle, is **derived** from the caveat
list — never stored beside it:

| `HELD` shape                    | verdict           | button lifecycle                    |
|---------------------------------|-------------------|-------------------------------------|
| `caveats: []`                   | `sound`           | enabled, plain                      |
| `caveats: [advisory…]`          | `caveated`        | enabled, ARMED — confirm says why   |
| `caveats: [any disqualifying]`  | `unusable`        | disabled, note names the remedy     |
| `provenance.kind === "unknown"` | `unattributable`  | enabled, ARMED — "cannot be checked"|

**Precedence, since more than one row can apply at once.** The verdict is a
single total function evaluated in exactly this order, and the order is the
operator's: `unusable` first (there is something to go and fix), then
`unattributable` (it cannot be checked, so no caveat list about it can be
trusted to be complete), then `caveated`, then `sound`. A product with unknown
provenance *and* a disqualifying caveat reads `unusable`, because the remedy is
actionable and the missing provenance is not.

### Notes

1. **`verdict` is computed, not stored** (technique 8, derive don't duplicate). A
   held product with an empty caveat list and a `caveated` verdict is
   unrepresentable.
2. **`provenance` is a union with an `unknown{why}` arm, not an optional.** A
   product cannot be held without stating where it came from. Hand-assembled
   captures stay usable — #57's explicit requirement — but stop looking identical
   to measured ones.
3. **Caveats inherit down the derivation chain.** `candidates` are
   `derived-from(fingerprint)` and carry its caveats. This is load-bearing: *"the
   top-ranked candidate previously introduced a 38 Hz mode"* is not fixable by
   better arithmetic, and inheritance is what stops Apply from presenting a clean
   button over dirty evidence.
4. **ARMED is not new.** `createArmed` is already the screen's confirm pattern
   (the Decay and Sweep save bars). A caveat therefore never blocks a control
   that sends G-code; it makes the operator read one sentence first. Firmware and
   the planner remain the only authorities on whether the machine may move, so
   `controls-are-1to1-with-gcode` is preserved.
5. **`SUPERSEDED` does not exist today in any form.** It is the transition that
   answers a tool change, a shaper install, and an acceleration change.
6. **`steps.ts` is absorbed, not wrapped.** `StepInputs`' booleans become the
   five evidence values; `blockOf` switches on evidence state with a `never` arm.
   Its two invariants — `step-readiness-has-one-answer` and
   `next-step-comes-from-the-readiness-it-shows` — survive verbatim. They were
   already the right shape; they were reading the wrong inputs.

### The invariant

> **A product cannot be consumed by a step whose validity conditions it does not
> meet.**

`@rung 8` — illegal state unrepresentable. The consumer's parameter type is the
evidence union; the `boolean` that erased the distinction no longer appears in
any signature. A new consumer written by someone who read nothing must still
narrow the union to reach the value, and the arms that are not valid for it have
no value to hand over.

Supporting, at their own rungs:

- `@rung 7` totality — `caveatText` switches on the caveat union with a `never`
  arm, as `refusalText` and `stepNoteText` already do. A caveat added without a
  sentence stops compilation.
- `@rung 7` derive, don't duplicate — `verdict`, the button's `enabled`, its chip
  and its note all come from one call, as `stepReadiness` already guarantees for
  the narrower question.

## Findings catalogue

Each finding is a caveat reason: data carrying its evidence, rendered by the
`never`-armed copy table. A finding **cites what it came from**; where the app
lacks a number, the finding is *"we cannot tell you, and here is what would"*.

### On `sweep`

- **`forcing-band-excludes-mode`** *(advisory)* — a fitted mode lies outside
  `[min(fullStepHz), max(fullStepHz)]`. Evidence: the band, the mode, and the
  speed that would bracket it (`f / fullStepsPerMm`). **This is the one that
  misled Gabe.** It needs no new plumbing: `fullStepsPerMm` is recoverable from
  the matrix itself as `fullStepHz[i] / speeds[i]`.
- **`rows-not-analysed`** *(advisory)* — `analysedRows(matrix) < speeds.length`.
  Already computed today, but only inside `SweepState.built`, so it evaporates on
  reload. Promoted to a caveat, it survives with the product.

### On `fingerprint`

- **`mode-on-forcing-locus`** *(disqualifying)* — a fitted mode coincides with a
  full-step frequency at a swept speed, so it may be motor ripple rather than
  structure. Shaping cannot touch it. **Cross-product:** it needs a sweep as well
  as a fingerprint, so with no sweep held it is not "absent", it is *not yet
  askable* — and the fingerprint card says exactly that rather than staying
  silent, because silence here reads as "checked, and fine".
- **`direction-spread`** *(advisory)* — one direction's spread consumes the
  shaper's robustness band while the other does not: X plus-direction 4.48 Hz
  against minus-direction 0.23 Hz, on an 18.14 Hz mode, is 25 % against 1.3 %.
  The ring-down happens at the opposite end of the move each way.
  **Threshold, and where it comes from:** it fires when one direction's spread
  exceeds 10 % of the mode frequency and the other does not. The 10 % is not
  invented for this finding — it is the same ±10 % mistuning band the Candidates
  card already ranks robustness against, i.e. exactly the margin that decides
  whether a shaper survives a tool change. A spread that eats the whole band is a
  spread that makes the ranking meaningless, which is why that is the number.
- **`fits-at-damping-cap`** *(advisory)* — refusals cluster on
  `damping-out-of-range` with ζ near `MAX_FIT_ZETA` = **0.1510** (verified:
  `ln(1/0.15) / 4π`). Seven of ten Y captures refused at ζ ≈ 0.149 is arithmetic,
  not noise, and the sentence says so.
- **`few-fits`** *(advisory)* — `n` small against the captures attempted.
- **`axes-agree`** *(advisory)* — X and Y came back within 10 % of each other.
  Two axes of one machine carry different effective masses and normally ring
  clearly apart (18.14 vs 51.68 Hz on this machine with shaping off). Agreement
  means either a shared frame mode or a shaper active during the measurement
  suppressing both; the sentence names both and picks neither. Added
  2026-08-24 because the stress test showed the known-bad run produces no other
  finding at all.
- **`measured-through-shaper`** *(disqualifying)* — provenance records an active
  shaper. Phase 2; before #53 lands, `provenance.unknown` speaks instead.
- **`condition-mismatch`** *(advisory)* — recorded accel/tool/shaper differ from
  current. Phase 3; before #57, `provenance.unknown` speaks instead.

### On `candidates`

- **`inherited`** — carries the source fingerprint's caveats (note 3).
- **`predicted-not-measured`** — intrinsic, and present until a `verified` entry
  exists for that spec. The ranked list is arithmetic over a fingerprint, not a
  measurement.

### Cross-product

*"These two instruments disagree, and here is why that is expected"* is
`forcing-band-excludes-mode` **stated from the other side**. The reason carries
the mode it is about, so the fingerprint card renders the same caveat the sweep
card produced. One reason, two placements — not two findings that can drift.

## Placement

- A caveat renders on the card that owns its product.
- The status card renders the **fold** — the screen-level thread #68 asks for —
  derived from the five, never a sixth stored state.
- Positional stability: every caveat slot is reserved at its card's declared
  height and filled with the screen's em dash when empty, as `shp-sweep-read` and
  the step-note slot already are. A finding arriving must move nothing under it.
  Verified at mobile width, not only at desktop.

## Out of scope

- **Auto-correcting anything.** A tool that silently re-runs a sweep at a better
  ladder hides the lesson.
- **Hiding instruments behind a guided path.** The composable cards are
  deliberate.
- A finding never disables a control that sends G-code (note 4).

## Phasing

| Phase | Blocked by | Contents |
|---|---|---|
| **1** | nothing | The machine, evidence types, provenance union, `never`-armed caveat table, absorption of `steps.ts`. Findings: `forcing-band-excludes-mode`, `rows-not-analysed`, `mode-on-forcing-locus`, `direction-spread`, `fits-at-damping-cap`, `few-fits`, `predicted-not-measured`, `inherited`. `SUPERSEDED` on tool change. `provenance.unknown` standing in for the two below. |
| **2** | #53 | `measured-through-shaper` becomes real; `SUPERSEDED` on shaper change. |
| **3** | #57 | `condition-mismatch` becomes real; provenance populated at capture time; `SUPERSEDED` on accel change. |
| **4** | #51 | Tool attribution becomes provable rather than assumed. |

Phase 1 is the whole architecture plus every finding that needs no prerequisite —
including the one that caused the incident. Phases 2–4 add data to a machine that
already exists; none of them changes its shape. Each phase is its own ticket pair
against this spec.

## Stress test

The architecture is to be judged by running it against the data that produced the
wrong conclusion, all of which is already in the repo.

`tools/accel/runs/ui-first-run-2026-08-23/` — 36 real captures from the first
hardware run through the UI:

- `t0_sweep_X_{25,34,45,61,82,110,149,200}.csv` — the 8-speed ladder. At 5 full
  steps/mm that is a 125–1000 Hz forcing band, and the modes are at 38.7/41.5 Hz.
  `forcing-band-excludes-mode` must fire, and must name 7.7–8.3 mm/s as the speeds
  that would bracket them.
- `t0_ring_{X,Y}{p,m}{0..4}.csv` — 20 decays, five reps per axis per direction.

**Corrected 2026-08-24, by measurement.** An earlier draft of this section
claimed these 20 captures would reproduce #68's "X plus-direction 4.48 Hz
against minus 0.23 Hz" and "seven of ten Y captures refused at ζ ≈ 0.149".
**They do not.** Fitted here, all 20 succeed:

| set | shaping | X | Y |
|---|---|---|---|
| `ring1_*` (prototype baseline) | **off** | 18.14 Hz | 51.68 Hz |
| `t0_ring_*` (2026-08-23 UI run) | **on** | 14.78 Hz | 14.99 Hz |

which reproduces #53's numbers exactly. #68's spread and refusal figures came
from a different capture set — most likely among the 259 on the board — and
attributing them to this run was an unverified assumption. The `direction-spread`
and `fits-at-damping-cap` detectors therefore ship with constructed-input tests
carrying those exact numbers, and gain a real-data test when the originating
capture set is identified.

**What the correction bought.** The 2026-08-23 run is the known-bad one (#53:
`M593 P"ei2" F52 S0.034` active throughout), and *every one of its captures fits
cleanly* — so no refusal, no `few-fits` and no `direction-spread` finding fires.
The worst bug currently open produced a spotless card. The signature that IS
available without provenance is **the two axes agreeing**: 1.4 % apart here,
against 2.85× apart on the same machine with shaping off. Hence the
`axes-agree` finding, which fires on the contaminated run and is silent on the
prototype — both asserted, because a detector that fires on everything says
nothing. It is advisory and names both explanations, since a shared frame mode
is legitimate and the tool cannot yet tell which it is looking at; #57 settles
that.

- `ring1_*` under `packages/ui/test/fixtures/shaping/ring1/` is the clean
  negative case, and is required: it is what proves the detector discriminates.

Every finding gets a node test asserting **the sentence**, not merely the
predicate, against the real capture that produced the wrong conclusion. A finding
with no such test does not ship.

Additionally, an A/B regression proving the invariant holds *through* a new
consumer: a step wired to consume a `caveated` fingerprint must not be able to
reach the value without narrowing, and the red-check is that deleting the narrow
fails to compile.

## Companion

A `project-curriculum` lesson holds this material once — forced vibration versus
ringing, why the two instruments measure different things, what the damping cap
is — and the findings cite it rather than duplicating it. Its own ticket pair.
