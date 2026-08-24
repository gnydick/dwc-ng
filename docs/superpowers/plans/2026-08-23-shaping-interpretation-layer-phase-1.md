# Shaping Interpretation Layer — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Shaping workflow's eight booleans with a real state machine whose products carry their own validity, so the screen can say what its readings mean instead of only showing them.

**Architecture:** Five identical small machines, one per product (fingerprint, sweep, candidates, verified, applied). Each is `ABSENT | RUNNING | FAILED | HELD{value, provenance, caveats[]} | SUPERSEDED{value, cause}`. A product's *verdict* — and with it the button's lifecycle and the card's message — is **derived** from its caveat list, never stored beside it. `steps.ts` is absorbed: its `StepInputs` booleans become the five evidence values and `blockOf` narrows the union with a `never` arm. Findings are caveat reasons produced by pure detectors and rendered by a `never`-armed copy table.

**Tech Stack:** TypeScript (strict), SolidJS, `node:test` (native TS type stripping, Node ≥ 23). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-23-shaping-interpretation-layer-design.md`

## Global Constraints

- **Issue marker:** every commit message ends its subject with `GIT_68`.
- **Test command (single file):** `cd packages/ui && node --conditions=browser --test test/<file>.test.ts`
- **Test command (all):** `pnpm test` from the repo root.
- **Typecheck:** `npx tsc -b --force` from the repo root. **`npx tsc --noEmit` checks zero files here** (solution-style root tsconfig) — do not use it.
- **Solid rules:** never destructure props; use `<Show>`/`<For>`; signals read inside tracking scopes only.
- **No new dependencies.** Ask before adding any.
- **Reference source is read-only.** Nothing under `reference/` may be copied, ported or paraphrased into this repo.
- **Copy tables are `never`-armed** with no `default` arm, matching `refusalText`/`stepNoteText` in `packages/ui/src/shaping/copy.ts`.
- **Positional stability:** any new on-card text occupies a slot reserved at the card's declared height, filled with the screen's em dash (`NONE`, `ShapingCards.tsx:62`) when empty. A finding arriving must move nothing under it.
- **A finding never disables a control that sends G-code.** Disqualifying caveats disable *derived* steps; the arm/confirm pattern (`createArmed`) is what a caveat triggers on anything that talks to the machine.
- **px lint:** every layout-space length is `calc(n * var(--u))`; borders are inset `box-shadow`, never `border:`. Enforced by `test/unit-lengths.test.ts`.

**Real-data fixtures** (already in the repo, do not copy — reference in place):
`tools/accel/runs/ui-first-run-2026-08-23/` — from `packages/ui/test/*.test.ts`, reach them with:

```ts
const run = (n: string): string =>
	readFileSync(new URL(`../../../tools/accel/runs/ui-first-run-2026-08-23/${n}`, import.meta.url), "utf8");
```

---

### Task 1: The caveat union and its copy table

The vocabulary every later task produces. Built first so the `never` arm exists before anything can add a reason without a sentence.

**Files:**
- Create: `packages/ui/src/shaping/evidence/caveat.ts`
- Modify: `packages/ui/src/shaping/copy.ts` (add `caveatText`, `severityOf` import)
- Test: `packages/ui/test/shaping-caveat.test.ts`

**Interfaces:**
- Consumes: `Axis` from `../engine/fit.ts`.
- Produces: `type Caveat`, `type Severity = "advisory" | "disqualifying"`, `severityOf(c: Caveat): Severity`, `caveatText(c: Caveat): string`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/shaping-caveat.test.ts`:

```ts
/**
 * Every caveat has a sentence, and the sentence carries the numbers the
 * operator needs in order to act on it.
 *
 * Exhaustiveness is a COMPILE-time property (`caveatText` has a `never` arm and
 * no default). What this file proves is what a compiler cannot: that each
 * sentence actually mentions its own payload, so a reason cannot be answered
 * with a generic apology and still pass.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { caveatText } from "../src/shaping/copy.ts";
import { type Caveat, severityOf } from "../src/shaping/evidence/caveat.ts";
import { hz } from "../src/shaping/engine/units.ts";

const EVERY: readonly Caveat[] = [
	{ kind: "forcing-band-excludes-mode", axis: "X", modeHz: hz(38.7), bandHz: [hz(125), hz(1000)], needMmPerS: 7.74 },
	{ kind: "rows-not-analysed", analysed: 7, rows: 8 },
	{ kind: "mode-on-forcing-locus", axis: "X", modeHz: hz(125), speedMmPerS: 25 },
	{ kind: "mode-locus-unknown" },
	{ kind: "direction-spread", axis: "X", plusHz: hz(4.48), minusHz: hz(0.23), modeHz: hz(18.14) },
	{ kind: "fits-at-damping-cap", axis: "Y", refused: 7, of: 10, cyclesFit: 1.9, cap: 0.1510 },
	{ kind: "few-fits", axis: "Y", n: 3, of: 10 },
	{ kind: "predicted-not-measured", n: 12 },
	{ kind: "inherited", from: "fingerprint", caveat: { kind: "few-fits", axis: "Y", n: 3, of: 10 } },
];

test("every caveat kind has a sentence that leaks no placeholder", () => {
	const seen = new Set<string>();
	for (const c of EVERY) {
		seen.add(c.kind);
		const text = caveatText(c);
		assert.ok(text.length > 0, `${c.kind} has no copy`);
		assert.ok(!/\bundefined\b|\bNaN\b|\[object/.test(text), `${c.kind} leaked a value: ${text}`);
		assert.ok(text.length > c.kind.length, `${c.kind} is a token, not a sentence: ${text}`);
	}
	assert.equal(seen.size, EVERY.length, "EVERY must hold one of each kind, no duplicates");
});

test("the sentences carry their own numbers", () => {
	assert.match(caveatText(EVERY[0]!), /38\.7/);
	assert.match(caveatText(EVERY[0]!), /125/);
	assert.match(caveatText(EVERY[0]!), /1000/);
	// The remedy is the whole point of this one: it must name the speed that
	// WOULD have driven the mode, not merely report that nothing did.
	assert.match(caveatText(EVERY[0]!), /7\.7/);
	assert.match(caveatText(EVERY[1]!), /7[^0-9]+8|8[^0-9]+7/);
	assert.match(caveatText(EVERY[4]!), /4\.48/);
	assert.match(caveatText(EVERY[4]!), /0\.23/);
	// Arithmetic, not noise — the cap has to appear beside the measurement.
	assert.match(caveatText(EVERY[5]!), /1\.9/);
	assert.match(caveatText(EVERY[5]!), /0\.151/);
});

test("only the two that shaping cannot act on are disqualifying", () => {
	assert.equal(severityOf(EVERY[2]!), "disqualifying", "a mode on the forcing locus is motor ripple");
	assert.equal(severityOf(EVERY[0]!), "advisory");
	assert.equal(severityOf(EVERY[5]!), "advisory");
});

test("an inherited caveat keeps the severity of the one it wraps", () => {
	const inner: Caveat = { kind: "mode-on-forcing-locus", axis: "X", modeHz: hz(125), speedMmPerS: 25 };
	assert.equal(severityOf({ kind: "inherited", from: "fingerprint", caveat: inner }), "disqualifying");
	assert.equal(severityOf(EVERY[8]!), "advisory");
});

test("an inherited caveat names where it came from and still says the inner sentence", () => {
	const text = caveatText(EVERY[8]!);
	assert.match(text, /fingerprint/);
	assert.ok(text.includes(caveatText(EVERY[8]!.kind === "inherited" ? EVERY[8]!.caveat : EVERY[8]!)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && node --conditions=browser --test test/shaping-caveat.test.ts`
Expected: FAIL — cannot resolve `../src/shaping/evidence/caveat.ts`.

- [ ] **Step 3: Write the union**

Create `packages/ui/src/shaping/evidence/caveat.ts`:

```ts
/**
 * The things that can be wrong with a measurement, as DATA rather than as
 * prose.
 *
 * Every entry answers one question the Shaping screen could previously only
 * answer in an operator's head, and each carries the numbers it was derived
 * from so the sentence can cite them. Nothing here decides anything: a caveat
 * describes evidence, and the machine (evidence.ts) decides what a product
 * carrying it is good for.
 *
 * @invariant every-caveat-has-copy
 * @rung 7  totality — `caveatText` (copy.ts) and `severityOf` below both switch
 *          on the discriminant with a `never` arm and no default, so a reason
 *          added here stops compilation in two places until someone has written
 *          its sentence AND decided whether shaping can act on it
 * @why the failure this whole layer exists to prevent is CONFIDENT WRONG
 *      ACTION. A caveat that rendered as the empty string would be worse than
 *      no caveat at all: the operator would read a clean card and act on it
 */
import type { Axis } from "../engine/fit.ts";
import type { Hz } from "../engine/units.ts";

export type Caveat =
	/** The ladder never drove this mode: it lies outside the forcing band. */
	| {
			readonly kind: "forcing-band-excludes-mode";
			readonly axis: Axis;
			readonly modeHz: Hz;
			readonly bandHz: readonly [Hz, Hz];
			/** The speed that WOULD have driven it: modeHz / fullStepsPerMm. */
			readonly needMmPerS: number;
	  }
	/** Rows the transform could not use, which a heat map would paint as silence. */
	| { readonly kind: "rows-not-analysed"; readonly analysed: number; readonly rows: number }
	/** The fitted mode sits where motor ripple would be. Shaping cannot move it. */
	| { readonly kind: "mode-on-forcing-locus"; readonly axis: Axis; readonly modeHz: Hz; readonly speedMmPerS: number }
	/** The locus question needs a sweep, and there is none. NOT the same as "checked, and fine". */
	| { readonly kind: "mode-locus-unknown" }
	/** One direction's spread eats the shaper's robustness band and the other does not. */
	| {
			readonly kind: "direction-spread";
			readonly axis: Axis;
			readonly plusHz: Hz;
			readonly minusHz: Hz;
			readonly modeHz: Hz;
	  }
	/** Refusals clustered on the two-cycle damping cap: arithmetic, not noise. */
	| {
			readonly kind: "fits-at-damping-cap";
			readonly axis: Axis;
			readonly refused: number;
			readonly of: number;
			/**
			 * Median cycles the refused fits managed, against `MIN_CYCLES`.
			 *
			 * The MEASURED quantity, not a back-computed ζ. A ζ inferred from
			 * the cap would be a number the detector invented, and
			 * `findings-cite-what-they-came-from` has no shape to put an
			 * invented number in.
			 */
			readonly cyclesFit: number;
			readonly cap: number;
	  }
	| { readonly kind: "few-fits"; readonly axis: Axis; readonly n: number; readonly of: number }
	/** The ranked list is arithmetic over a fingerprint, not a measurement. */
	| { readonly kind: "predicted-not-measured"; readonly n: number }
	/**
	 * A caveat on the thing this was derived FROM.
	 *
	 * Recursive on purpose, and it is the load-bearing arm of the whole layer:
	 * candidates are derived from a fingerprint, so a caveated fingerprint makes
	 * every candidate caveated without anyone remembering to check. "The
	 * top-ranked candidate previously introduced a 38 Hz mode" is not fixable by
	 * better arithmetic — only by inheritance stopping Apply from ever showing a
	 * clean button over dirty evidence.
	 */
	| { readonly kind: "inherited"; readonly from: "fingerprint"; readonly caveat: Caveat };

/**
 * Can shaping act on the thing this describes?
 *
 * `disqualifying` means the answer is no whatever the operator does next —
 * motor ripple is not a mode, and no `M593` moves it. Everything else is
 * advisory: it changes how much the number should be TRUSTED, not whether the
 * step is meaningful.
 */
export type Severity = "advisory" | "disqualifying";

export function severityOf(c: Caveat): Severity {
	switch (c.kind) {
		case "mode-on-forcing-locus":
			return "disqualifying";
		case "inherited":
			// The wrapper cannot be gentler than what it wraps; a disqualifying
			// fingerprint caveat must still disqualify the candidates ranked
			// from it, which is the entire point of note 3 in the spec.
			return severityOf(c.caveat);
		case "forcing-band-excludes-mode":
		case "rows-not-analysed":
		case "mode-locus-unknown":
		case "direction-spread":
		case "fits-at-damping-cap":
		case "few-fits":
		case "predicted-not-measured":
			return "advisory";
		default: {
			const unhandled: never = c;
			throw new Error(`unknown caveat: ${String((unhandled as { kind: unknown }).kind)}`);
		}
	}
}
```

- [ ] **Step 4: Write the copy table**

Append to `packages/ui/src/shaping/copy.ts` (and add `import type { Caveat } from "./evidence/caveat.ts";` beside the existing type imports at the top):

```ts
/* ------------------------------------------- what the readings actually mean */

const hz1 = (v: number): string => v.toFixed(1);

/**
 * One sentence per caveat, in the operator's vocabulary, citing the numbers it
 * was derived from.
 *
 * Here rather than in a module of its own for the reason the file header
 * already gives: ONE table, so the sweep card's inline note and the status
 * card's thread cannot say different things about the same measurement.
 *
 * Every sentence states the FACT and, where there is one, the remedy. Where
 * there is no remedy the sentence says what the number is good for instead,
 * because "we cannot tell you, and here is what would" is a legitimate finding
 * and often the most useful one.
 */
export function caveatText(c: Caveat): string {
	switch (c.kind) {
		case "forcing-band-excludes-mode":
			// Both ends of the band AND the speed that would fix it. The band
			// alone reads as a complaint; the speed makes it an instruction.
			return `nothing in this sweep drove ${c.axis} at ${hz1(c.modeHz)} Hz — the ladder forces ${hz1(c.bandHz[0])}–${hz1(c.bandHz[1])} Hz, so this band is black whether or not the mode is real; a pass near ${c.needMmPerS.toFixed(1)} mm/s would bracket it`;
		case "rows-not-analysed":
			return `${c.rows - c.analysed} of ${c.rows} speeds held too little constant-velocity motion to transform — those rows are missing, not quiet`;
		case "mode-on-forcing-locus":
			return `${c.axis} at ${hz1(c.modeHz)} Hz is exactly what the motors force at ${c.speedMmPerS.toFixed(0)} mm/s, so this is likely torque ripple rather than a resonance — shaping cannot move it; current, microstepping and the mechanics can`;
		case "mode-locus-unknown":
			// Silence here would read as "checked, and fine".
			return "no sweep on this tool, so whether these modes are resonances or motor ripple has not been checked — build one to find out";
		case "direction-spread":
			return `${c.axis} reads differently at the two ends of the move: ${hz1(c.plusHz)} Hz of spread in the plus direction against ${hz1(c.minusHz)} Hz in the minus, on a ${hz1(c.modeHz)} Hz mode — one end alone consumes the ±10 % the ranking is scored over`;
		case "fits-at-damping-cap":
			// The cycle count is the measurement and the cap is the rule, so
			// the sentence carries both: that is what turns "noise" into
			// arithmetic the operator can check for themselves.
			return `${c.refused} of ${c.of} ${c.axis} captures were refused because the ring died in ${c.cyclesFit.toFixed(1)} cycles, short of the two a fit needs — that is the ζ ${c.cap.toFixed(4)} ceiling, arithmetic rather than noise`;
		case "few-fits":
			return `${c.axis} rests on ${c.n} of ${c.of} captures — a median over that few moves with any one of them`;
		case "predicted-not-measured":
			return `these ${c.n} are arithmetic over the fingerprint, not measurements — verify one on the machine before trusting the order`;
		case "inherited":
			return `from the ${c.from} these were ranked from: ${caveatText(c.caveat)}`;
		default: {
			const unhandled: never = c;
			throw new Error(`unknown caveat: ${String((unhandled as { kind: unknown }).kind)}`);
		}
	}
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `cd packages/ui && node --conditions=browser --test test/shaping-caveat.test.ts`
Expected: PASS, 5 tests.

Run: `npx tsc -b --force` from the repo root.
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/shaping/evidence/caveat.ts packages/ui/src/shaping/copy.ts packages/ui/test/shaping-caveat.test.ts
git commit -m "feat(shaping): findings are data with a never-armed copy table GIT_68"
```

---

### Task 2: The evidence machine

**Files:**
- Create: `packages/ui/src/shaping/evidence/evidence.ts`
- Test: `packages/ui/test/shaping-evidence.test.ts`

**Interfaces:**
- Consumes: `Caveat`, `severityOf` from Task 1.
- Produces: `type Provenance`, `type Supersede`, `type Evidence<T>`, `type Held<T>`, `type Verdict`, `verdictOf<T>(h: Held<T>): Verdict`, `held<T>(value, provenance, caveats): Evidence<T>`, `valueFor<T>(e: Evidence<T>): T | null`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/shaping-evidence.test.ts`:

```ts
/**
 * The machine: what states a product can be in, and the ONE order in which a
 * held product's verdict is decided.
 *
 * The precedence test is the load-bearing one. More than one condition applies
 * at once in real sessions, and a verdict that depended on which check ran
 * first is exactly the drift this layer replaced booleans to prevent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Caveat } from "../src/shaping/evidence/caveat.ts";
import { type Evidence, held, valueFor, verdictOf } from "../src/shaping/evidence/evidence.ts";
import { hz } from "../src/shaping/engine/units.ts";

const MEASURED = { kind: "measured", at: "2026-08-23T09:14:02", tool: 0 } as const;
const UNKNOWN = { kind: "unknown", why: "assembled by hand from the card" } as const;

const ADVISORY: Caveat = { kind: "few-fits", axis: "Y", n: 3, of: 10 };
const DISQUALIFYING: Caveat = { kind: "mode-on-forcing-locus", axis: "X", modeHz: hz(125), speedMmPerS: 25 };

const h = (prov: typeof MEASURED | typeof UNKNOWN, caveats: readonly Caveat[]) => {
	const e = held(42, prov, caveats);
	assert.equal(e.state, "held");
	return e;
};

test("a clean measured product is sound", () => {
	assert.equal(verdictOf(h(MEASURED, [])), "sound");
});

test("advisory caveats make it caveated, not unusable", () => {
	assert.equal(verdictOf(h(MEASURED, [ADVISORY])), "caveated");
});

test("one disqualifying caveat makes it unusable", () => {
	assert.equal(verdictOf(h(MEASURED, [ADVISORY, DISQUALIFYING])), "unusable");
});

test("unknown provenance is unattributable even with no caveats", () => {
	// The caveat list cannot be trusted to be COMPLETE for something whose
	// origin is unknown, so an empty list is not evidence of soundness.
	assert.equal(verdictOf(h(UNKNOWN, [])), "unattributable");
});

test("a disqualifying caveat outranks unknown provenance", () => {
	// Precedence is the operator's: the actionable remedy wins over the fact
	// that something else could not be checked.
	assert.equal(verdictOf(h(UNKNOWN, [DISQUALIFYING])), "unusable");
});

test("unknown provenance outranks advisory caveats", () => {
	assert.equal(verdictOf(h(UNKNOWN, [ADVISORY])), "unattributable");
});

test("only held and superseded carry a value", () => {
	const cases: Array<[Evidence<number>, number | null]> = [
		[{ state: "absent" }, null],
		[{ state: "running", what: "measuring" }, null],
		[{ state: "failed", why: "the run was cancelled" }, null],
		[held(7, MEASURED, []), 7],
		[{ state: "superseded", value: 7, cause: { kind: "tool-changed", was: 0, now: 2 } }, 7],
	];
	for (const [e, want] of cases) {
		assert.equal(valueFor(e), want, `${e.state} carried the wrong value`);
	}
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && node --conditions=browser --test test/shaping-evidence.test.ts`
Expected: FAIL — cannot resolve `../src/shaping/evidence/evidence.ts`.

- [ ] **Step 3: Write the machine**

Create `packages/ui/src/shaping/evidence/evidence.ts`:

```ts
/**
 * One small state machine, instantiated once per product the Shaping workflow
 * makes: fingerprint, sweep, candidates, verified, applied.
 *
 * WHY THIS EXISTS. The workflow used to ask eight booleans — `hasFingerprint`,
 * `hasSweep` and so on. A boolean makes "a fingerprint exists" and "a
 * fingerprint valid for ranking" THE SAME VALUE, so a fingerprint measured
 * through an active shaper, or taken at an acceleration you do not print at, or
 * built from a sweep that never excited the modes, all read `true` exactly like
 * a clean one. And nothing ever went back to `false`: a tool change left every
 * product looking as fresh as the moment it was measured. On 2026-08-23 that
 * produced a wrong conclusion on real hardware.
 *
 * @invariant a-product-cannot-be-consumed-by-a-step-it-is-not-valid-for
 * @rung 8  illegal state unrepresentable — a consumer's parameter type is
 *          `Evidence<T>`, and the arms that hold no usable value hold no value
 *          at all. There is no boolean left in any signature to erase the
 *          distinction, so a step written by someone who read nothing must
 *          still narrow the union before it can reach a number
 * @why every finding in issue #68 is one sentence — evidence exists but is not
 *      valid for its consumer, and nothing could say so
 *
 * @invariant verdict-is-derived-never-stored
 * @rung 7  derive, don't duplicate — `verdictOf` is a pure function OF the
 *          caveat list and the provenance. A held product with an empty caveat
 *          list and a "caveated" verdict is not a state anything can build,
 *          because the verdict is not a field
 */
import { type Caveat, severityOf } from "./caveat.ts";

/**
 * Where a product came from.
 *
 * A union with an `unknown` arm rather than an optional field, so a product
 * cannot be held without SAYING where it came from. Hand-assembled captures
 * stay usable — that is deliberate, they are the only reason 259 prototype
 * captures are usable at all — but they stop looking identical to measured
 * ones, which is the whole requirement in #57.
 */
export type Provenance =
	| { readonly kind: "measured"; readonly at: string; readonly tool: number }
	| { readonly kind: "assembled"; readonly n: number }
	| { readonly kind: "loaded"; readonly path: string }
	| { readonly kind: "unknown"; readonly why: string };

/** What changed under a product after it was made. */
export type Supersede =
	| { readonly kind: "tool-changed"; readonly was: number; readonly now: number }
	| { readonly kind: "shaper-changed"; readonly was: string; readonly now: string }
	| { readonly kind: "accel-changed"; readonly was: number; readonly now: number };

export type Held<T> = {
	readonly state: "held";
	readonly value: T;
	readonly provenance: Provenance;
	readonly caveats: readonly Caveat[];
};

export type Evidence<T> =
	| { readonly state: "absent" }
	| { readonly state: "running"; readonly what: string }
	| { readonly state: "failed"; readonly why: string }
	| Held<T>
	| { readonly state: "superseded"; readonly value: T; readonly cause: Supersede };

/** The sole way to build a `held`, so provenance can never be omitted. */
export const held = <T>(value: T, provenance: Provenance, caveats: readonly Caveat[]): Evidence<T> => ({
	state: "held",
	value,
	provenance,
	caveats,
});

export type Verdict = "sound" | "caveated" | "unusable" | "unattributable";

/**
 * What a held product is good for.
 *
 * ONE total function evaluated in ONE order, and the order is the operator's:
 *
 *  1. `unusable` — there is something to go and fix, and that outranks
 *     everything because it is the only arm with an action attached.
 *  2. `unattributable` — it cannot be checked, so the caveat list cannot be
 *     trusted to be COMPLETE. An empty list on an unattributable product is
 *     not evidence of soundness, which is why this sits above `caveated`
 *     rather than below it.
 *  3. `caveated` — trustworthy, with stated limits.
 *  4. `sound`.
 */
export function verdictOf<T>(h: Held<T>): Verdict {
	if (h.caveats.some((c) => severityOf(c) === "disqualifying")) return "unusable";
	if (h.provenance.kind === "unknown") return "unattributable";
	return h.caveats.length > 0 ? "caveated" : "sound";
}

/**
 * The value, or null where the state does not carry one.
 *
 * `superseded` DOES carry its value: the numbers are still on the card and
 * still worth showing — what changed is whether they describe the machine in
 * front of you. Dropping the value would turn "this is out of date" into "this
 * never happened".
 */
export function valueFor<T>(e: Evidence<T>): T | null {
	switch (e.state) {
		case "held":
		case "superseded":
			return e.value;
		case "absent":
		case "running":
		case "failed":
			return null;
		default: {
			const unhandled: never = e;
			throw new Error(`unknown evidence state: ${String((unhandled as { state: unknown }).state)}`);
		}
	}
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `cd packages/ui && node --conditions=browser --test test/shaping-evidence.test.ts`
Expected: PASS, 7 tests.

Run: `npx tsc -b --force` from the repo root. Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/shaping/evidence/evidence.ts packages/ui/test/shaping-evidence.test.ts
git commit -m "feat(shaping): a product carries its provenance and what limits it GIT_68"
```

---

### Task 3: The finding that caused the incident — sweep coverage vs fingerprint

**Files:**
- Create: `packages/ui/src/shaping/evidence/findings.ts`
- Test: `packages/ui/test/shaping-findings-sweep.test.ts`

**Interfaces:**
- Consumes: `Caveat` (Task 1); `SweepMatrix`, `analysedRows` from `../engine/sweep.ts`; `Fingerprint` from `../engine/fit.ts`.
- Produces: `fullStepsPerMmOf(m: SweepMatrix): number | null`, `forcingBand(m: SweepMatrix): readonly [Hz, Hz] | null`, `sweepCaveats(m: SweepMatrix, fp: Fingerprint | null): readonly Caveat[]`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/shaping-findings-sweep.test.ts`:

```ts
/**
 * The finding that would have prevented the 2026-08-23 wrong conclusion.
 *
 * Gabe read the sweep heat map, saw black where the magenta fingerprint markers
 * stood, and concluded the fingerprint was garbage. It might be — but that
 * sweep could not have shown those modes. The ladder ran 25–200 mm/s; at 5 full
 * steps/mm the forcing band is 125–1000 Hz and the modes are at 38.7 and 41.5.
 * Nothing drove them.
 *
 * The arithmetic here is deterministic and does not depend on the fitter, so
 * these are exact-number assertions rather than characterisation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { forcingBand, fullStepsPerMmOf, sweepCaveats } from "../src/shaping/evidence/findings.ts";
import type { SweepMatrix } from "../src/shaping/engine/sweep.ts";
import type { Fingerprint, Mode } from "../src/shaping/engine/fit.ts";
import { g, hz, mmPerS } from "../src/shaping/engine/units.ts";

/** The real ladder, from tools/accel/runs/ui-first-run-2026-08-23/. */
const LADDER = [25, 34, 45, 61, 82, 110, 149, 200];
const PER_MM = 5;

/** A matrix with the real speeds; the amplitudes are what this finding is NOT
 *  about, so one non-zero bin per row keeps every row "analysed". */
const matrix = (speeds: readonly number[] = LADDER, perMm = PER_MM): SweepMatrix => {
	const maxHz = 700;
	const nBins = maxHz + 1;
	const freqs = new Float64Array(nBins);
	for (let i = 0; i < nBins; i++) freqs[i] = i;
	const amps = new Float64Array(speeds.length * nBins);
	for (let r = 0; r < speeds.length; r++) amps[r * nBins + 100] = 0.01;
	return {
		speeds: speeds.map(mmPerS),
		freqs,
		amps,
		fullStepHz: speeds.map((s) => hz(s * perMm)),
		maxHz,
	};
};

const mode = (f: number): Mode => ({ f: hz(f), zeta: 0.05, peakG: g(0.1), cyclesFit: 4 } as Mode);

const FP: Fingerprint = { X: mode(38.7), Y: mode(41.5), n: { X: 5, Y: 3 }, spreadHz: { X: 0.4, Y: 0.4 } };

test("the full-step rate is recovered from the matrix itself", () => {
	// No new plumbing: fullStepHz[i] / speeds[i] is the rate the matrix was
	// built with, so the finding cannot disagree with the chart's own locus.
	assert.equal(fullStepsPerMmOf(matrix()), 5);
});

test("the forcing band is the ladder's two ends times that rate", () => {
	const band = forcingBand(matrix());
	assert.ok(band !== null);
	assert.equal(band[0], 125);
	assert.equal(band[1], 1000);
});

test("both modes are reported as undriven, with the speed that would drive them", () => {
	const cs = sweepCaveats(matrix(), FP).filter(c => c.kind === "forcing-band-excludes-mode");
	assert.equal(cs.length, 2, "one per mode outside the band");

	const x = cs.find(c => c.axis === "X")!;
	assert.equal(x.modeHz, 38.7);
	assert.deepEqual([x.bandHz[0], x.bandHz[1]], [125, 1000]);
	// 38.7 Hz / 5 full steps per mm.
	assert.ok(Math.abs(x.needMmPerS - 7.74) < 0.01, `needed ${x.needMmPerS}`);

	const y = cs.find(c => c.axis === "Y")!;
	assert.ok(Math.abs(y.needMmPerS - 8.3) < 0.01, `needed ${y.needMmPerS}`);
});

test("a ladder that DOES bracket the modes says nothing", () => {
	// 5–15 mm/s at 5 steps/mm forces 25–75 Hz, which contains both modes.
	const cs = sweepCaveats(matrix([5, 8, 11, 15]), FP);
	assert.equal(cs.filter(c => c.kind === "forcing-band-excludes-mode").length, 0);
});

test("a mode sitting ON the locus is reported as forced, not as missing", () => {
	// 125 Hz is exactly what 25 mm/s forces at 5 steps/mm.
	const onLocus: Fingerprint = { ...FP, X: mode(125), Y: null, n: { X: 5, Y: 0 }, spreadHz: { X: 0.4, Y: 0 } };
	const cs = sweepCaveats(matrix(), onLocus);
	assert.equal(cs.filter(c => c.kind === "forcing-band-excludes-mode").length, 0);
	const forced = cs.find(c => c.kind === "mode-on-forcing-locus");
	assert.ok(forced !== undefined, "a mode on the locus must be called out");
	assert.equal(forced.speedMmPerS, 25);
});

test("rows the transform could not use are reported as missing, not quiet", () => {
	const m = matrix();
	// Blank row 3 entirely — that is what sweepMatrix leaves for a capture with
	// no cruise window in it.
	const nBins = m.freqs.length;
	(m.amps as Float64Array)[3 * nBins + 100] = 0;
	const c = sweepCaveats(m, FP).find(x => x.kind === "rows-not-analysed");
	assert.ok(c !== undefined);
	assert.equal(c.rows, 8);
	assert.equal(c.analysed, 7);
});

test("no fingerprint means no coverage claim either way", () => {
	assert.equal(sweepCaveats(matrix(), null).filter(c => c.kind === "forcing-band-excludes-mode").length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && node --conditions=browser --test test/shaping-findings-sweep.test.ts`
Expected: FAIL — cannot resolve `../src/shaping/evidence/findings.ts`.

- [ ] **Step 3: Write the detectors**

Create `packages/ui/src/shaping/evidence/findings.ts`:

```ts
/**
 * Pure functions from measurements to the caveats they imply.
 *
 * Everything here is arithmetic over data the app already holds, which is the
 * claim issue #68 rests on: every statement an operator worked out by hand on
 * 2026-08-23 was derivable from numbers already on the card. Nothing in this
 * module reads the object model, touches the connector or decides anything —
 * a detector's whole job is to notice, and `evidence.ts` decides what noticing
 * it means for a product.
 *
 * @invariant findings-cite-what-they-came-from
 * @rung 8  illegal state unrepresentable — a `Caveat` has no free-text arm.
 *          Every reason is a record of the numbers it was derived from, and the
 *          sentence is written from those numbers by the copy table. A detector
 *          therefore CANNOT emit a claim it has no evidence for: there is no
 *          shape in the union to put one in
 */
import type { Caveat } from "./caveat.ts";
import { type Axis, type Fingerprint, MAX_FIT_ZETA, type Mode } from "../engine/fit.ts";
import { analysedRows, type SweepMatrix } from "../engine/sweep.ts";
import { hz, type Hz } from "../engine/units.ts";

/**
 * The full-step rate the matrix was BUILT with, recovered from it.
 *
 * `sweepMatrix` stores `fullStepHz[i] = speeds[i] * fullStepsPerMm`, so the
 * quotient is that rate exactly. Recovered rather than passed in alongside,
 * because a rate handed to the finding separately is a second copy of a number
 * the matrix already holds — and the failure mode of two copies is a finding
 * that disagrees with the dashed locus drawn on the very chart it annotates.
 */
export function fullStepsPerMmOf(m: SweepMatrix): number | null {
	for (let i = 0; i < m.speeds.length; i++) {
		const speed = Number(m.speeds[i]);
		const forced = Number(m.fullStepHz[i]);
		if (speed > 0 && Number.isFinite(forced) && forced > 0) return forced / speed;
	}
	return null;
}

/** Lowest and highest frequency this ladder's motors actually forced. */
export function forcingBand(m: SweepMatrix): readonly [Hz, Hz] | null {
	if (m.fullStepHz.length === 0) return null;
	const fs = m.fullStepHz.map(Number);
	return [hz(Math.min(...fs)), hz(Math.max(...fs))];
}

/**
 * How close a mode has to sit to a forced frequency before it is more likely to
 * BE that forcing than to be a structure ringing near it.
 *
 * One FFT bin. `sweepMatrix` bins at 1 Hz and rounds each peak into the nearest
 * one, so a mode inside a bin of the locus is not distinguishable from the
 * locus by anything the chart can draw — and claiming a distinction the
 * instrument cannot resolve is the exact error this layer exists to prevent.
 */
const LOCUS_BIN_HZ = 1;

const modesOf = (fp: Fingerprint): ReadonlyArray<{ axis: Axis; mode: Mode }> =>
	([["X", fp.X], ["Y", fp.Y]] as const)
		.filter((e): e is readonly [Axis, Mode] => e[1] !== null)
		.map(([axis, mode]) => ({ axis, mode }));

/**
 * What this sweep can and cannot say, given the fingerprint beside it.
 *
 * The order of the two questions matters and is not arbitrary: a mode is asked
 * "are you ON the locus" BEFORE "are you outside the band", because a mode
 * sitting on a forced frequency is inside the band by definition, and reporting
 * it as merely undriven would name the wrong problem — and the wrong remedy.
 */
export function sweepCaveats(m: SweepMatrix, fp: Fingerprint | null): readonly Caveat[] {
	const out: Caveat[] = [];

	const analysed = analysedRows(m);
	if (analysed < m.speeds.length) {
		out.push({ kind: "rows-not-analysed", analysed, rows: m.speeds.length });
	}

	const band = forcingBand(m);
	const perMm = fullStepsPerMmOf(m);
	if (fp === null || band === null || perMm === null) return out;

	for (const { axis, mode } of modesOf(fp)) {
		const f = Number(mode.f);
		const onLocus = m.fullStepHz.findIndex((forced) => Math.abs(Number(forced) - f) <= LOCUS_BIN_HZ);
		if (onLocus >= 0) {
			out.push({
				kind: "mode-on-forcing-locus",
				axis,
				modeHz: mode.f,
				speedMmPerS: Number(m.speeds[onLocus]),
			});
			continue;
		}
		if (f < Number(band[0]) || f > Number(band[1])) {
			out.push({
				kind: "forcing-band-excludes-mode",
				axis,
				modeHz: mode.f,
				bandHz: band,
				needMmPerS: f / perMm,
			});
		}
	}
	return out;
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `cd packages/ui && node --conditions=browser --test test/shaping-findings-sweep.test.ts`
Expected: PASS, 7 tests.

Run: `npx tsc -b --force` from the repo root. Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/shaping/evidence/findings.ts packages/ui/test/shaping-findings-sweep.test.ts
git commit -m "feat(shaping): a sweep says which modes its ladder could not drive GIT_68"
```

---

### Task 4: Fingerprint findings — direction spread, damping cap, few fits

**Files:**
- Modify: `packages/ui/src/shaping/evidence/findings.ts`
- Test: `packages/ui/test/shaping-findings-fingerprint.test.ts`

**Interfaces:**
- Consumes: `CaptureRecord` from `../results.ts`; `MAX_FIT_ZETA`, `isMode` from `../engine/fit.ts`.
- Produces: `fingerprintCaveats(fp: Fingerprint, captures: readonly CaptureRecord[], sweep: SweepMatrix | null): readonly Caveat[]`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/shaping-findings-fingerprint.test.ts`:

```ts
/**
 * What a fingerprint can say about its own trustworthiness.
 *
 * The three numbers here are the ones worked out by hand on 2026-08-23: X
 * spreads 4.48 Hz one way against 0.23 Hz the other; seven of ten Y captures
 * refused with ζ ≈ 0.149 against a two-cycle cap of 0.1510; the median that
 * survived rests on three captures.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprintCaveats } from "../src/shaping/evidence/findings.ts";
import { MAX_FIT_ZETA, type Fingerprint, type Mode } from "../src/shaping/engine/fit.ts";
import type { CaptureRecord } from "../src/shaping/results.ts";
import { g, hz, seconds } from "../src/shaping/engine/units.ts";

const mode = (f: number): Mode => ({ f: hz(f), zeta: 0.05, peakG: g(0.1), cyclesFit: 4 } as Mode);

const fit = (axis: "X" | "Y", dir: "+" | "-", rep: number, f: number): CaptureRecord =>
	({ file: `${axis}${dir}${rep}.csv`, axis, dir, rep, fit: mode(f), tStop: seconds(0.5) });

const refused = (axis: "X" | "Y", dir: "+" | "-", rep: number, zeta: number): CaptureRecord =>
	({ file: `${axis}${dir}${rep}.csv`, axis, dir, rep, fit: { reason: "damping-out-of-range", f: hz(41.5), cyclesFit: 1.9 }, tStop: seconds(0.5) });

test("the two-cycle cap is exactly ln(1/0.15)/4pi", () => {
	// Pinned because the sentence quotes it: if the floor or the cycle count
	// ever moves, the copy must move with it rather than quoting a stale number.
	assert.ok(Math.abs(MAX_FIT_ZETA - 0.1510) < 0.0001, `cap is ${MAX_FIT_ZETA}`);
});

test("a direction that spreads across the robustness band is called out", () => {
	// X plus spreads 4.48 Hz on an 18.14 Hz mode (24.7 %); minus spreads 0.23
	// (1.3 %). The rule is 10 % — the same +/-10 % the Candidates card ranks over.
	const caps = [
		fit("X", "+", 0, 16.0), fit("X", "+", 1, 18.14), fit("X", "+", 2, 20.48),
		fit("X", "-", 0, 18.03), fit("X", "-", 1, 18.14), fit("X", "-", 2, 18.26),
	];
	const fp: Fingerprint = { X: mode(18.14), Y: null, n: { X: 6, Y: 0 }, spreadHz: { X: 4.48, Y: 0 } };
	const c = fingerprintCaveats(fp, caps, null).find(x => x.kind === "direction-spread");
	assert.ok(c !== undefined, "the asymmetry must be reported");
	assert.equal(c.axis, "X");
	assert.ok(Math.abs(c.plusHz - 4.48) < 0.01, `plus ${c.plusHz}`);
	assert.ok(Math.abs(c.minusHz - 0.23) < 0.01, `minus ${c.minusHz}`);
});

test("a symmetric axis says nothing", () => {
	const caps = [
		fit("X", "+", 0, 18.03), fit("X", "+", 1, 18.14),
		fit("X", "-", 0, 18.10), fit("X", "-", 1, 18.20),
	];
	const fp: Fingerprint = { X: mode(18.14), Y: null, n: { X: 4, Y: 0 }, spreadHz: { X: 0.17, Y: 0 } };
	assert.equal(fingerprintCaveats(fp, caps, null).filter(c => c.kind === "direction-spread").length, 0);
});

test("refusals clustered on the damping cap are reported as arithmetic", () => {
	const caps: CaptureRecord[] = [
		fit("Y", "+", 0, 41.5), fit("Y", "+", 1, 41.5), fit("Y", "+", 2, 41.5),
		...[0, 1, 2, 3].map(i => refused("Y", "+", 3 + i, 0.149)),
		...[0, 1, 2].map(i => refused("Y", "-", i, 0.149)),
	];
	const fp: Fingerprint = { X: null, Y: mode(41.5), n: { X: 0, Y: 3 }, spreadHz: { X: 0, Y: 0.1 } };
	const c = fingerprintCaveats(fp, caps, null).find(x => x.kind === "fits-at-damping-cap");
	assert.ok(c !== undefined);
	assert.equal(c.axis, "Y");
	assert.equal(c.refused, 7);
	assert.equal(c.of, 10);
	assert.ok(Math.abs(c.cap - MAX_FIT_ZETA) < 1e-9, "the cap must be the fitter's own constant");
});

test("a median resting on few captures is called out with both counts", () => {
	const caps: CaptureRecord[] = [
		fit("Y", "+", 0, 41.5), fit("Y", "+", 1, 41.5), fit("Y", "+", 2, 41.5),
		...[0, 1, 2, 3].map(i => refused("Y", "+", 3 + i, 0.149)),
		...[0, 1, 2].map(i => refused("Y", "-", i, 0.149)),
	];
	const fp: Fingerprint = { X: null, Y: mode(41.5), n: { X: 0, Y: 3 }, spreadHz: { X: 0, Y: 0.1 } };
	const c = fingerprintCaveats(fp, caps, null).find(x => x.kind === "few-fits");
	assert.ok(c !== undefined);
	assert.equal(c.n, 3);
	assert.equal(c.of, 10);
});

test("with no sweep, the locus question is answered as unasked", () => {
	// Silence would read as "checked, and fine" — the distinction the whole
	// layer exists to keep.
	const fp: Fingerprint = { X: mode(38.7), Y: null, n: { X: 5, Y: 0 }, spreadHz: { X: 0.2, Y: 0 } };
	const cs = fingerprintCaveats(fp, [], null);
	assert.ok(cs.some(c => c.kind === "mode-locus-unknown"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && node --conditions=browser --test test/shaping-findings-fingerprint.test.ts`
Expected: FAIL — `fingerprintCaveats` is not exported.

- [ ] **Step 3: Implement**

Append to `packages/ui/src/shaping/evidence/findings.ts`:

```ts
/**
 * How much spread makes an axis untrustworthy, as a fraction of its own mode
 * frequency.
 *
 * Ten per cent, and the number is NOT invented for this finding: it is the same
 * +/-10 % mistuning band the Candidates card already ranks robustness over —
 * the margin that decides whether a shaper survives a tool change. A direction
 * whose spread eats that whole band has made the ranking meaningless, which is
 * precisely when the operator needs telling.
 */
const SPREAD_FRACTION = 0.1;

const spreadOf = (caps: readonly CaptureRecord[]): number => {
	const fs = caps.filter((c) => isMode(c.fit)).map((c) => Number((c.fit as Mode).f));
	return fs.length === 0 ? 0 : Math.max(...fs) - Math.min(...fs);
};

/**
 * What a fingerprint can say about its own trustworthiness.
 *
 * `sweep` is passed so the locus question can be ASKED here, on the card that
 * shows the modes, rather than only on the sweep card. Passing `null` does not
 * mean "no problem": it produces `mode-locus-unknown`, because a fingerprint
 * card that stayed silent about a check nobody ran reads as a card that ran it.
 */
export function fingerprintCaveats(
	fp: Fingerprint,
	captures: readonly CaptureRecord[],
	sweep: SweepMatrix | null,
): readonly Caveat[] {
	const out: Caveat[] = [];

	for (const { axis, mode } of modesOf(fp)) {
		const mine = captures.filter((c) => c.axis === axis);
		const plus = spreadOf(mine.filter((c) => c.dir === "+"));
		const minus = spreadOf(mine.filter((c) => c.dir === "-"));
		const limit = Number(mode.f) * SPREAD_FRACTION;
		// One direction over the band and the other under it. Both over is a
		// noisy axis, which `few-fits` and the spread on the card already say;
		// what is worth a sentence is the ASYMMETRY, because its cause is
		// physical — the ring-down happens at the opposite end each way.
		if ((plus > limit) !== (minus > limit)) {
			out.push({ kind: "direction-spread", axis, plusHz: hz(plus), minusHz: hz(minus), modeHz: mode.f });
		}

		const attempted = mine.length;
		const capped = mine.filter(
			(c) => !isMode(c.fit) && c.fit.reason === "damping-out-of-range",
		).length;
		if (capped > 0 && attempted > 0) {
			// The MEASURED quantity is how few cycles the ring managed, which
			// is what `fitDecay` actually rejected on. Reporting a ζ here would
			// mean back-computing one from the cap — a number the detector
			// invented, which `findings-cite-what-they-came-from` forbids.
			const cycles = mine
				.filter((c) => !isMode(c.fit) && c.fit.reason === "damping-out-of-range")
				.map((c) => c.fit.cyclesFit ?? 0)
				.sort((a, b) => a - b);
			out.push({
				kind: "fits-at-damping-cap",
				axis,
				refused: capped,
				of: attempted,
				cyclesFit: cycles[cycles.length >> 1] ?? 0,
				cap: MAX_FIT_ZETA,
			});
		}

		const n = axis === "X" ? fp.n.X : fp.n.Y;
		if (attempted > 0 && n < attempted / 2) {
			out.push({ kind: "few-fits", axis, n, of: attempted });
		}
	}

	if (sweep === null && modesOf(fp).length > 0) out.push({ kind: "mode-locus-unknown" });
	else if (sweep !== null) out.push(...sweepCaveats(sweep, fp).filter((c) => c.kind === "mode-on-forcing-locus"));

	return out;
}
```

Add to the imports at the top of the file: `isMode` from `../engine/fit.ts` and `type CaptureRecord` from `../results.ts`.

Note that `NoFit` already carries an optional `cyclesFit` ("How short
'short-decay' actually was, so a near-miss reads as one" — `engine/fit.ts`), so
the median above reads a field the fitter already publishes rather than
introducing one.

- [ ] **Step 4: Run tests and typecheck**

Run: `cd packages/ui && node --conditions=browser --test test/shaping-findings-fingerprint.test.ts test/shaping-caveat.test.ts`
Expected: PASS.

Run: `npx tsc -b --force` from the repo root. Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/shaping/evidence/ packages/ui/src/shaping/copy.ts packages/ui/test/shaping-findings-fingerprint.test.ts
git commit -m "feat(shaping): a fingerprint says what limits its own trustworthiness GIT_68"
```

---

### Task 5: The real-data stress test

The spec's acceptance gate: the findings must fire on the captures that produced the wrong conclusion.

**Files:**
- Test: `packages/ui/test/shaping-findings-real-run.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–4, plus `parseCapture`, `detectStop` from `../src/shaping/engine/capture.ts`, `fitDecay`, `aggregate` from `../src/shaping/engine/fit.ts`, `sweepMatrix` from `../src/shaping/engine/sweep.ts`.
- Produces: nothing — this is the gate.

- [ ] **Step 1: Write the test**

Create `packages/ui/test/shaping-findings-real-run.test.ts`:

```ts
/**
 * The gate: run the findings over the captures that produced the 2026-08-23
 * wrong conclusion, and require them to say the thing that was worked out by
 * hand that night.
 *
 * These are the real files, referenced in place rather than copied — #53 also
 * names this directory as its regression fixture home, and two copies of 1.3 MB
 * of captures is two things that can drift.
 *
 * Note what is and is not asserted. The ARITHMETIC findings (which band, which
 * speed) are exact: they do not go through the fitter and cannot move. The
 * FITTED numbers are asserted as "the finding fires", not as an exact Hz,
 * because pinning a fitter's output in a test that is not about the fitter
 * turns every legitimate improvement to fit.ts into a red test here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCapture, detectStop } from "../src/shaping/engine/capture.ts";
import { aggregate, type Axis, fitDecay } from "../src/shaping/engine/fit.ts";
import { sweepMatrix, type SweepRow } from "../src/shaping/engine/sweep.ts";
import { caveatText } from "../src/shaping/copy.ts";
import { fingerprintCaveats, forcingBand, sweepCaveats } from "../src/shaping/evidence/findings.ts";
import { mmPerS, seconds } from "../src/shaping/engine/units.ts";
import type { CaptureRecord } from "../src/shaping/results.ts";

const run = (n: string): string =>
	readFileSync(new URL(`../../../tools/accel/runs/ui-first-run-2026-08-23/${n}`, import.meta.url), "utf8");

const LADDER = [25, 34, 45, 61, 82, 110, 149, 200];
/** Gabe's X: 80 steps/mm / 16x microstepping. */
const PER_MM = 5;

/** The 20 ring captures, fitted exactly as the app fits them. */
const records = (): CaptureRecord[] => {
	const out: CaptureRecord[] = [];
	for (const axis of ["X", "Y"] as const) {
		for (const dir of ["p", "m"] as const) {
			for (let rep = 0; rep < 5; rep++) {
				const file = `t0_ring_${axis}${dir}${rep}.csv`;
				const parsed = parseCapture(run(file));
				assert.ok(parsed.ok, `${file} did not parse`);
				const cap = parsed.capture;
				const moveAxis = axis === "X" ? cap.x : cap.y;
				const tStop = detectStop(moveAxis, cap.rate);
				out.push({
					file,
					axis,
					dir: dir === "p" ? "+" : "-",
					rep,
					fit: tStop === null
						? { reason: "short-window" }
						: fitDecay(moveAxis, cap.rate, tStop),
					tStop,
				});
			}
		}
	}
	return out;
};

test("the real ladder forces 125-1000 Hz", () => {
	const rows: SweepRow[] = LADDER.map(speed => {
		const parsed = parseCapture(run(`t0_sweep_X_${speed}.csv`));
		assert.ok(parsed.ok, `t0_sweep_X_${speed}.csv did not parse`);
		// 100 mm of travel at this speed.
		return { speed: mmPerS(speed), capture: parsed.capture, moveS: seconds(100 / speed), axis: 0 as const };
	});
	const m = sweepMatrix(rows, PER_MM);
	const band = forcingBand(m);
	assert.ok(band !== null);
	assert.equal(band[0], 125);
	assert.equal(band[1], 1000);
});

test("the sweep says out loud that it could not have seen the fitted modes", () => {
	const caps = records();
	const fp = aggregate(caps.map(c => ({ axis: c.axis as Axis, fit: c.fit })));

	const rows: SweepRow[] = LADDER.map(speed => {
		const parsed = parseCapture(run(`t0_sweep_X_${speed}.csv`));
		assert.ok(parsed.ok);
		return { speed: mmPerS(speed), capture: parsed.capture, moveS: seconds(100 / speed), axis: 0 as const };
	});
	const m = sweepMatrix(rows, PER_MM);

	const cs = sweepCaveats(m, fp);
	const undriven = cs.filter(c => c.kind === "forcing-band-excludes-mode");
	assert.ok(undriven.length > 0, "the fitted modes are far below 125 Hz; this must fire");

	for (const c of undriven) {
		// The remedy has to be inside the range Gabe derived by hand: ~5-15 mm/s.
		assert.ok(c.needMmPerS > 1 && c.needMmPerS < 25, `suggested ${c.needMmPerS} mm/s`);
		const text = caveatText(c);
		assert.match(text, /125/);
		assert.match(text, /1000/);
		assert.match(text, /mm\/s/);
	}
});

test("the fingerprint reports the direction asymmetry and the capped refusals", () => {
	const caps = records();
	const fp = aggregate(caps.map(c => ({ axis: c.axis as Axis, fit: c.fit })));
	const cs = fingerprintCaveats(fp, caps, null);

	// Every sentence must render without leaking a placeholder, whichever
	// findings this data happens to produce.
	for (const c of cs) {
		const text = caveatText(c);
		assert.ok(text.length > 0);
		assert.ok(!/\bundefined\b|\bNaN\b|\[object/.test(text), `${c.kind}: ${text}`);
	}

	// Y is the axis that refused on this run (#53: the shaper was active).
	const capped = cs.filter(c => c.kind === "fits-at-damping-cap");
	const few = cs.filter(c => c.kind === "few-fits");
	assert.ok(
		capped.length + few.length > 0,
		"this run had refusals; at least one of the two quality findings must fire",
	);
});
```

- [ ] **Step 2: Run it and record what it says**

Run: `cd packages/ui && node --conditions=browser --test test/shaping-findings-real-run.test.ts`

**If a test fails, do not weaken it.** The numbers in `#68` were derived by hand
from this data; a mismatch is a finding about the detector or about the fitter,
and it goes in the report either way. Print the caveat sentences and compare
them to the spec's "Stress test" section before changing anything.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/test/shaping-findings-real-run.test.ts
git commit -m "test(shaping): the findings fire on the run that misled us GIT_68"
```

---

### Task 6: Candidate findings and inheritance

**Files:**
- Modify: `packages/ui/src/shaping/evidence/findings.ts`
- Test: `packages/ui/test/shaping-findings-candidates.test.ts`

**Interfaces:**
- Consumes: `Candidate` from `../engine/rank.ts`; `Held`, `Evidence` from `./evidence.ts`.
- Produces: `candidateCaveats(candidates: readonly Candidate[], fingerprint: Evidence<unknown>, verifiedCount: number): readonly Caveat[]`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/shaping-findings-candidates.test.ts`:

```ts
/**
 * Candidates are arithmetic over a fingerprint, and they inherit its problems.
 *
 * This is the arm that stops Apply presenting a clean button over dirty
 * evidence: on this machine the top-ranked candidate previously introduced a
 * 38 Hz mode, and no amount of better ranking would have caught it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { candidateCaveats } from "../src/shaping/evidence/findings.ts";
import { caveatText } from "../src/shaping/copy.ts";
import { type Caveat } from "../src/shaping/evidence/caveat.ts";
import { held } from "../src/shaping/evidence/evidence.ts";

const MEASURED = { kind: "measured", at: "2026-08-23T09:14:02", tool: 0 } as const;
const FEW: Caveat = { kind: "few-fits", axis: "Y", n: 3, of: 10 };
const CANDS = [{}, {}, {}] as never[];

test("candidates always say they are predictions until something is verified", () => {
	const cs = candidateCaveats(CANDS, held(null, MEASURED, []), 0);
	const c = cs.find(x => x.kind === "predicted-not-measured");
	assert.ok(c !== undefined);
	assert.equal(c.n, 3);
});

test("once a candidate has been verified the prediction caveat drops", () => {
	const cs = candidateCaveats(CANDS, held(null, MEASURED, []), 1);
	assert.equal(cs.filter(c => c.kind === "predicted-not-measured").length, 0);
});

test("a caveated fingerprint makes every candidate caveated, with the reason", () => {
	const cs = candidateCaveats(CANDS, held(null, MEASURED, [FEW]), 1);
	const inherited = cs.find(c => c.kind === "inherited");
	assert.ok(inherited !== undefined, "the fingerprint's problem must reach the ranking");
	assert.equal(inherited.from, "fingerprint");
	assert.deepEqual(inherited.caveat, FEW);
	// The sentence has to carry the ORIGINAL reason, not merely a pointer to
	// it: "see the fingerprint" is the kind of note an operator skips.
	const text = caveatText(inherited);
	assert.match(text, /fingerprint/);
	assert.ok(text.includes(caveatText(FEW)), "the inner sentence must survive intact");
});

test("a fingerprint that is not held contributes nothing to inherit", () => {
	const cs = candidateCaveats(CANDS, { state: "absent" }, 1);
	assert.equal(cs.filter(c => c.kind === "inherited").length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && node --conditions=browser --test test/shaping-findings-candidates.test.ts`
Expected: FAIL — `candidateCaveats` is not exported.

- [ ] **Step 3: Implement**

Append to `packages/ui/src/shaping/evidence/findings.ts`:

```ts
/**
 * What a ranked list has to say about itself.
 *
 * Two things, and the second is the important one. It is a PREDICTION until
 * something has been measured on the machine — the ranking is arithmetic over
 * an impulse model, and on this machine the top-ranked candidate once
 * introduced a 38 Hz mode that no amount of better arithmetic would have
 * caught. And it INHERITS: whatever limits the fingerprint limits everything
 * ranked from it, automatically, because a step that had to remember to check
 * is a step that will one day forget.
 */
export function candidateCaveats(
	candidates: readonly unknown[],
	fingerprint: Evidence<unknown>,
	verifiedCount: number,
): readonly Caveat[] {
	const out: Caveat[] = [];
	if (candidates.length === 0) return out;
	if (verifiedCount === 0) out.push({ kind: "predicted-not-measured", n: candidates.length });
	if (fingerprint.state === "held") {
		for (const c of fingerprint.caveats) out.push({ kind: "inherited", from: "fingerprint", caveat: c });
	}
	return out;
}
```

Add `import type { Evidence } from "./evidence.ts";` to the file's imports.

- [ ] **Step 4: Run tests and typecheck**

Run: `cd packages/ui && node --conditions=browser --test test/shaping-findings-candidates.test.ts`
Expected: PASS, 4 tests.

Run: `npx tsc -b --force` from the repo root. Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/shaping/evidence/findings.ts packages/ui/test/shaping-findings-candidates.test.ts
git commit -m "feat(shaping): a ranking inherits the limits of the fingerprint under it GIT_68"
```

---

### Task 7: Absorb `steps.ts` — the workflow reads evidence, not booleans

The structural change. After this task there is no `hasFingerprint` anywhere.

**Files:**
- Modify: `packages/ui/src/shaping/steps.ts`
- Modify: `packages/ui/src/shaping/copy.ts` (two new `StepBlock` arms)
- Modify: `packages/ui/test/shaping-steps.test.ts`, `packages/ui/test/shaping-copy.test.ts`
- Test: `packages/ui/test/shaping-steps-evidence.test.ts`

**Interfaces:**
- Consumes: `Evidence`, `Held`, `verdictOf`, `Supersede` (Task 2); `Caveat`, `severityOf` (Task 1).
- Produces: `StepInputs` with `products: WorkflowProducts`; `StepBlock` gains `{kind:"unusable"; caveat: Caveat}` and `{kind:"superseded"; cause: Supersede}`; `type WorkflowProducts`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/shaping-steps-evidence.test.ts`:

```ts
/**
 * The invariant, tested through a consumer: a step cannot reach a product it is
 * not valid for.
 *
 * The COMPILE-time half (a consumer must narrow the union before it can touch a
 * value) is proved by the fact that this file compiles; the half a compiler
 * cannot check is that the block a step reports actually corresponds to the
 * state its product is in.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHAPING_STEPS, stepReadiness, type StepInputs, type WorkflowProducts } from "../src/shaping/steps.ts";
import { held } from "../src/shaping/evidence/evidence.ts";
import type { Caveat } from "../src/shaping/evidence/caveat.ts";
import { hz } from "../src/shaping/engine/units.ts";

const MEASURED = { kind: "measured", at: "2026-08-23T09:14:02", tool: 0 } as const;
const DISQUALIFYING: Caveat = { kind: "mode-on-forcing-locus", axis: "X", modeHz: hz(125), speedMmPerS: 25 };
const ADVISORY: Caveat = { kind: "few-fits", axis: "Y", n: 3, of: 10 };

const EMPTY: WorkflowProducts = {
	fingerprint: { state: "absent" },
	sweep: { state: "absent" },
	candidates: { state: "absent" },
	verified: { state: "absent" },
	applied: { state: "absent" },
};

const inputs = (products: WorkflowProducts): StepInputs => ({
	refusal: null,
	present: true,
	offered: true,
	busy: false,
	products,
});

const spec = (step: string) => SHAPING_STEPS.find(s => s.step === step)!;

test("rank is blocked while no fingerprint is held", () => {
	const r = stepReadiness(spec("rank"), inputs(EMPTY));
	assert.equal(r.enabled, false);
	assert.equal(r.block.kind, "input");
});

test("rank runs on a sound fingerprint", () => {
	const products = { ...EMPTY, fingerprint: held({}, MEASURED, []) };
	assert.equal(stepReadiness(spec("rank"), inputs(products)).enabled, true);
});

test("rank runs on a caveated fingerprint and says what the caveat is", () => {
	// A caveat does not take the step away — it makes the operator read one
	// sentence first. The firmware and the planner remain the authorities.
	const products = { ...EMPTY, fingerprint: held({}, MEASURED, [ADVISORY]) };
	const r = stepReadiness(spec("rank"), inputs(products));
	assert.equal(r.enabled, true);
	assert.ok(r.note.length > 0);
	assert.notEqual(r.note, "ready", "a caveated product must not read as clean");
});

test("rank is blocked on a disqualified fingerprint, naming the remedy", () => {
	const products = { ...EMPTY, fingerprint: held({}, MEASURED, [DISQUALIFYING]) };
	const r = stepReadiness(spec("rank"), inputs(products));
	assert.equal(r.enabled, false);
	assert.equal(r.block.kind, "unusable");
	// Ranking against motor ripple is arithmetic against a mode that is not
	// there — the one case where taking the step away is the honest answer,
	// and it sends no G-code, so nothing 1:1 with a code is being gated.
	assert.match(r.note, /ripple|shaping cannot/i);
});

test("a superseded fingerprint blocks with what changed under it", () => {
	const products: WorkflowProducts = {
		...EMPTY,
		fingerprint: { state: "superseded", value: {}, cause: { kind: "tool-changed", was: 0, now: 2 } },
	};
	const r = stepReadiness(spec("rank"), inputs(products));
	assert.equal(r.enabled, false);
	assert.equal(r.block.kind, "superseded");
	assert.match(r.note, /T0|T2|tool/);
});

test("a failed run reports why rather than reading as never-run", () => {
	const products: WorkflowProducts = { ...EMPTY, fingerprint: { state: "failed", why: "the run was cancelled" } };
	const r = stepReadiness(spec("rank"), inputs(products));
	assert.equal(r.enabled, false);
	assert.match(r.note, /cancelled/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && node --conditions=browser --test test/shaping-steps-evidence.test.ts`
Expected: FAIL — `WorkflowProducts` is not exported.

- [ ] **Step 3: Change `StepInputs` and `StepBlock`**

In `packages/ui/src/shaping/steps.ts`:

Replace the six product booleans on `StepInputs` with one record, and keep
`refusal`, `present`, `offered`, `busy` exactly as they are:

```ts
/**
 * The five products, each in whatever state its own machine says.
 *
 * This replaced six booleans, and the replacement is the point. A boolean made
 * "a fingerprint exists" and "a fingerprint valid for ranking" the same value,
 * so a fingerprint measured through an active shaper read `true` exactly like a
 * clean one — and nothing ever went back to `false`, so a tool change left
 * every product looking as fresh as the moment it was measured.
 */
export type WorkflowProducts = {
	readonly fingerprint: Evidence<unknown>;
	readonly sweep: Evidence<unknown>;
	readonly candidates: Evidence<unknown>;
	readonly verified: Evidence<unknown>;
	readonly applied: Evidence<unknown>;
};

export interface StepInputs {
	readonly refusal: Refusal | null;
	readonly present: boolean;
	readonly offered: boolean;
	readonly busy: boolean;
	readonly products: WorkflowProducts;
}
```

Add two arms to `StepBlock`:

```ts
	/** The product exists and shaping cannot act on what it measured. */
	| { readonly kind: "unusable"; readonly caveat: Caveat }
	/** The product is real but something changed under it. */
	| { readonly kind: "superseded"; readonly cause: Supersede }
	/** The run that would have produced it did not finish. */
	| { readonly kind: "run-failed"; readonly why: string }
```

Replace `met` and `produced` with narrowing over the union:

```ts
const productOf = (key: StepNeed | StepProduct, p: WorkflowProducts): Evidence<unknown> => {
	switch (key) {
		case "fingerprint":
			return p.fingerprint;
		case "sweep":
			return p.sweep;
		case "candidates":
			return p.candidates;
		case "verified":
			return p.verified;
		case "applied":
			return p.applied;
		case "recommendation":
			// A recommendation is whichever of the two the Apply card would use,
			// preferring the measured one — derived here so "is there something
			// to apply" has one answer, not one per caller.
			return p.verified.state === "held" ? p.verified : p.candidates;
		default: {
			const unhandled: never = key;
			throw new Error(`unknown product key: ${String(unhandled)}`);
		}
	}
};

/**
 * What a needed product contributes to the block, or null when it is fine.
 *
 * Order inside this function is the verdict's own precedence (evidence.ts):
 * something to go and fix outranks something that cannot be checked, which
 * outranks a stated limit.
 */
const blockFromEvidence = (need: StepNeed, e: Evidence<unknown>): StepBlock | null => {
	switch (e.state) {
		case "absent":
			return { kind: "input", need };
		case "running":
			return { kind: "busy" };
		case "failed":
			return { kind: "run-failed", why: e.why };
		case "superseded":
			return { kind: "superseded", cause: e.cause };
		case "held": {
			const bad = e.caveats.find((c) => severityOf(c) === "disqualifying");
			return bad === undefined ? null : { kind: "unusable", caveat: bad };
		}
		default: {
			const unhandled: never = e;
			throw new Error(`unknown evidence state: ${String((unhandled as { state: unknown }).state)}`);
		}
	}
};
```

and in `blockOf`, replace the `met(...)` line with:

```ts
	if (spec.needs !== undefined) {
		const stop = blockFromEvidence(spec.needs, productOf(spec.needs, inputs.products));
		if (stop !== null) return stop;
	}
```

`produced` becomes:

```ts
const produced = (product: StepProduct, p: WorkflowProducts): boolean =>
	productOf(product, p).state === "held";
```

Add to `StepReadiness` a field carrying the advisory caveats, so the card can
render them without asking a second time:

```ts
	/** Stated limits on the product this step consumes. Advisory by
	 *  construction — a disqualifying one became the block above. */
	readonly caveats: readonly Caveat[];
```

set in `stepReadiness`:

```ts
export function stepReadiness(spec: StepSpec, inputs: StepInputs): StepReadiness {
	const block = blockOf(spec, inputs);
	const need = spec.needs;
	const source = need === undefined ? null : productOf(need, inputs.products);
	const caveats = source !== null && source.state === "held" ? source.caveats : [];
	return { enabled: block.kind === "none", block, note: stepNoteText(block, caveats), caveats };
}
```

- [ ] **Step 4: Extend the copy table**

In `packages/ui/src/shaping/copy.ts`, `stepNoteText` takes the advisory caveats
and gains three arms. An available step with caveats no longer says "ready":

```ts
export function stepNoteText(b: StepBlock, caveats: readonly Caveat[] = []): string {
	switch (b.kind) {
		case "none":
			// A step whose evidence has stated limits does NOT read as clean.
			// Saying "ready" over a caveated fingerprint is precisely the
			// confident-wrong-action this layer exists to prevent.
			return caveats.length === 0 ? "ready" : caveatText(caveats[0]!);
		case "unusable":
			return caveatText(b.caveat);
		case "superseded":
			return supersedeText(b.cause);
		case "run-failed":
			return b.why;
		case "machine":
			return refusalText(b.refusal);
		case "input":
			return NEED_NOTE[b.need];
		case "off-screen":
			return `add the ${b.owner} card to this screen`;
		case "not-built":
			return `the ${b.owner} card cannot run this yet`;
		case "busy":
			return "working…";
		default: {
			const unhandled: never = b;
			throw new Error(`unknown step block: ${String((unhandled as { kind: unknown }).kind)}`);
		}
	}
}

/** What changed under a measurement, and therefore what to do about it. */
export function supersedeText(s: Supersede): string {
	switch (s.kind) {
		case "tool-changed":
			return `this was measured on T${s.was} and T${s.now} is selected now — carriage mass is what moves the frequency, so measure again`;
		case "shaper-changed":
			return `the shaper changed from ${s.was} to ${s.now} since this was measured — a baseline taken through a shaper describes the suppressed machine`;
		case "accel-changed":
			return `this was measured at ${s.was.toFixed(0)} mm/s² and the machine is set to ${s.now.toFixed(0)} now — acceleration decides which mode dominates`;
		default: {
			const unhandled: never = s;
			throw new Error(`unknown supersede cause: ${String((unhandled as { kind: unknown }).kind)}`);
		}
	}
}
```

Add `Supersede` and `Caveat` to the type imports at the top of `copy.ts`.

- [ ] **Step 5: Update the two existing test files**

`shaping-steps.test.ts` and `shaping-copy.test.ts` build `StepInputs` literals
with the old booleans. Replace each with the `products` record. The mechanical
mapping is:

| old | new |
|---|---|
| `hasFingerprint: true` | `fingerprint: held({}, MEASURED, [])` |
| `hasFingerprint: false` | `fingerprint: { state: "absent" }` |
| `hasSweep: true` | `sweep: held({}, MEASURED, [])` |
| `hasCandidates: true` | `candidates: held({}, MEASURED, [])` |
| `hasVerified: true` | `verified: held({}, MEASURED, [])` |
| `hasRecommendation: true` | `candidates: held({}, MEASURED, [])` |
| `hasApplied: true` | `applied: held({}, MEASURED, [])` |

Add to `shaping-copy.test.ts`'s `EVERY`-style coverage the three new
`StepBlock` kinds, so the copy-coverage assertion still counts every arm.

- [ ] **Step 6: Run the whole suite and typecheck**

Run: `pnpm test` from the repo root.
Expected: PASS. The compiler will point at every remaining `hasFingerprint`
reference; there should be none left outside `ShapingCards.tsx`, which Task 8
handles.

Run: `npx tsc -b --force`. Expected: errors ONLY in `ShapingCards.tsx` until
Task 8.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/shaping/steps.ts packages/ui/src/shaping/copy.ts packages/ui/test/
git commit -m "feat(shaping): the workflow reads evidence, not booleans GIT_68"
```

---

### Task 8: Wire the status card, and supersede on tool change

**Files:**
- Modify: `packages/ui/src/cards/ShapingCards.tsx:220-247` (`inputsFor`)
- Modify: `packages/ui/src/compose/services.ts` (build the five `Evidence` values)
- Modify: `packages/ui/src/app.css` (the caveat slot)
- Test: `packages/ui/test/shaping-thread.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `svc.products(): WorkflowProducts` on the shaping service; `screenThread(p: WorkflowProducts): Caveat | null`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/shaping-thread.test.ts`:

```ts
/**
 * The screen-level thread: one sentence, chosen from the five products, that
 * answers "what does this mean, and what is the next question?".
 *
 * It is a FOLD over the products, never a sixth stored state — a thread that
 * could be set independently is a thread that can contradict the cards it
 * summarises.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { screenThread } from "../src/shaping/evidence/findings.ts";
import { held } from "../src/shaping/evidence/evidence.ts";
import type { Caveat } from "../src/shaping/evidence/caveat.ts";
import type { WorkflowProducts } from "../src/shaping/steps.ts";
import { hz } from "../src/shaping/engine/units.ts";

const MEASURED = { kind: "measured", at: "2026-08-23T09:14:02", tool: 0 } as const;
const ADVISORY: Caveat = { kind: "few-fits", axis: "Y", n: 3, of: 10 };
const DISQUALIFYING: Caveat = { kind: "mode-on-forcing-locus", axis: "X", modeHz: hz(125), speedMmPerS: 25 };

const EMPTY: WorkflowProducts = {
	fingerprint: { state: "absent" },
	sweep: { state: "absent" },
	candidates: { state: "absent" },
	verified: { state: "absent" },
	applied: { state: "absent" },
};

test("nothing measured means no thread", () => {
	assert.equal(screenThread(EMPTY), null);
});

test("a clean session has no thread either", () => {
	assert.equal(screenThread({ ...EMPTY, fingerprint: held({}, MEASURED, []) }), null);
});

test("the worst finding on the screen is the thread", () => {
	const p: WorkflowProducts = {
		...EMPTY,
		fingerprint: held({}, MEASURED, [ADVISORY]),
		sweep: held({}, MEASURED, [DISQUALIFYING]),
	};
	assert.deepEqual(screenThread(p), DISQUALIFYING, "disqualifying outranks advisory");
});

test("with only advisories, the earliest product in the workflow wins", () => {
	// The operator works left to right; a note about the ranking while the
	// fingerprint under it is questionable points at the wrong thing.
	const other: Caveat = { kind: "predicted-not-measured", n: 12 };
	const p: WorkflowProducts = {
		...EMPTY,
		fingerprint: held({}, MEASURED, [ADVISORY]),
		candidates: held({}, MEASURED, [other]),
	};
	assert.deepEqual(screenThread(p), ADVISORY);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && node --conditions=browser --test test/shaping-thread.test.ts`
Expected: FAIL — `screenThread` is not exported.

- [ ] **Step 3: Implement the fold**

Append to `packages/ui/src/shaping/evidence/findings.ts`:

```ts
/**
 * The one sentence for the top of the screen, folded out of the five products.
 *
 * A FOLD and not a stored value: a thread anything could set independently is a
 * thread that can contradict the card it summarises, which is the drift
 * `nextStep` was already built to prevent one level down.
 *
 * The pick, in the operator's order: anything shaping cannot act on first,
 * because it is the only kind with an action attached; then the earliest
 * product in the workflow, because a note about the ranking while the
 * fingerprint under it is questionable points at the wrong thing.
 */
export function screenThread(p: WorkflowProducts): Caveat | null {
	const inOrder: ReadonlyArray<Evidence<unknown>> = [p.fingerprint, p.sweep, p.candidates, p.verified, p.applied];
	const all = inOrder.flatMap((e) => (e.state === "held" ? [...e.caveats] : []));
	return all.find((c) => severityOf(c) === "disqualifying") ?? all[0] ?? null;
}
```

Add `import { severityOf } from "./caveat.ts";` and
`import type { WorkflowProducts } from "../steps.ts";` to the imports.

- [ ] **Step 4: Build the products in the service**

In `packages/ui/src/compose/services.ts`, inside `shapingService`, add an
accessor that turns the selected tool's `ToolResults` into `WorkflowProducts`,
running the detectors once per change:

```ts
	/**
	 * The five products of the selected tool, each with what limits it.
	 *
	 * Derived from `results()` on every read rather than stored beside it: a
	 * cached copy is a second answer to "is this fingerprint any good", and the
	 * two would part company the first time a capture was added.
	 *
	 * `provenance` is `unknown` for everything at this phase. That is not a
	 * placeholder — it is the honest answer until #57 records what a run was
	 * taken under, and it is what makes the screen say "this cannot be checked"
	 * instead of implying it was.
	 */
	const products = createMemo((): WorkflowProducts => {
		const r = results();
		const prov = { kind: "unknown", why: "measurements do not yet record the conditions they were taken under" } as const;

		const fingerprint: Evidence<Fingerprint> = r.fingerprint === null
			? { state: "absent" }
			: held(r.fingerprint, prov, fingerprintCaveats(r.fingerprint, r.captures, r.sweep));

		const sweep: Evidence<SweepMatrix> = r.sweep === null
			? { state: "absent" }
			: held(r.sweep, prov, sweepCaveats(r.sweep, r.fingerprint));

		const candidates: Evidence<readonly Candidate[]> = r.candidates.length === 0
			? { state: "absent" }
			: held(r.candidates, prov, candidateCaveats(r.candidates, fingerprint, r.verified.length));

		return {
			fingerprint,
			sweep,
			candidates,
			verified: r.verified.length === 0 ? { state: "absent" } : held(r.verified, prov, []),
			applied: r.applied === null ? { state: "absent" } : held(r.applied, prov, []),
		};
	});
```

Expose `products` on the service's returned object beside `results`.

- [ ] **Step 5: Point the status card at it**

In `packages/ui/src/cards/ShapingCards.tsx`, `inputsFor` becomes:

```ts
	const inputsFor = (spec: StepSpec): StepInputs => ({
		refusal: svc.gate(),
		present: svc.onScreen(spec.ownerCard),
		offered: svc.offers(spec.step),
		busy: (spec.step === "rank" && svc.ranking()) || (spec.moves && motionBusy(svc.motion())),
		products: svc.products(),
	});
```

Add the thread line above the next-step button, in a slot reserved whether or
not there is one:

```tsx
			{/* The screen-level thread. Its slot is declared here, so a finding
			    arriving moves nothing under it — this card is watched while the
			    machine works. */}
			<p class="shp-thread">
				<Show when={screenThread(svc.products())} fallback={NONE}>
					{c => caveatText(c())}
				</Show>
			</p>
```

- [ ] **Step 6: Reserve the slot in CSS**

In `packages/ui/src/app.css`, beside the other `shp-` rules:

```css
/* Two lines, always. The thread is watched while the machine works, so its
   arrival must not move the next-step button under it. */
.shp-thread {
	min-height: calc(6 * var(--u));
	margin: 0;
	font-size: calc(3.25 * var(--u));
	line-height: calc(3 * var(--u));
	color: var(--ink-dim);
}
```

- [ ] **Step 7: Supersede on tool change**

In `services.ts`, keep the tool a measurement was filed under and compare it to
the selected tool inside `products`:

```ts
		// `ToolResults.tool` is the head this file was written for. Selecting a
		// different one does not make the numbers wrong — it makes them about a
		// different carriage, and carriage mass is what moves the frequency.
		const staleTool = r.tool !== tool() ? { kind: "tool-changed", was: r.tool, now: tool() } as const : null;
```

and wrap each product: when `staleTool !== null` and the product would be
`held`, return `{ state: "superseded", value, cause: staleTool }` instead.

- [ ] **Step 8: Run everything**

Run: `pnpm test` from the repo root. Expected: PASS.
Run: `npx tsc -b --force`. Expected: no errors.
Run: `pnpm build`. Expected: clean.

- [ ] **Step 9: Verify in the browser**

Run `pnpm mock` and `pnpm dev`, open the Shaping screen, and confirm:
1. With nothing measured, the thread slot holds the em dash and the layout is identical to before.
2. After loading a tool with a fingerprint and a sweep, the thread reads the coverage sentence.
3. Switching tool changes the step notes to the superseded sentence.
4. At mobile width the thread wraps to two lines and still moves nothing — check with the device toolbar, not by narrowing the desktop window.

- [ ] **Step 10: Commit**

```bash
git add packages/ui/src packages/ui/test docs
git commit -m "feat(shaping): the screen says what its readings mean GIT_68"
```

---

### Task 9: Card-level caveats and the ARMED lifecycle

**Files:**
- Modify: `packages/ui/src/cards/ShapingCards.tsx` (sweep, decay, candidates bodies)
- Modify: `packages/ui/src/app.css`
- Test: `packages/ui/test/shaping-lifecycle.test.ts`

**Interfaces:**
- Consumes: `verdictOf`, `Held` (Task 2).
- Produces: `lifecycleOf<T>(e: Evidence<T>): Lifecycle` in `evidence/evidence.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/shaping-lifecycle.test.ts`:

```ts
/**
 * One value decides a button's enabled state, its confirm sentence and its
 * note — the same guarantee `stepReadiness` already gives one level down.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { held, lifecycleOf } from "../src/shaping/evidence/evidence.ts";
import type { Caveat } from "../src/shaping/evidence/caveat.ts";
import { hz } from "../src/shaping/engine/units.ts";

const MEASURED = { kind: "measured", at: "2026-08-23T09:14:02", tool: 0 } as const;
const UNKNOWN = { kind: "unknown", why: "conditions were not recorded" } as const;
const ADVISORY: Caveat = { kind: "few-fits", axis: "Y", n: 3, of: 10 };
const DISQUALIFYING: Caveat = { kind: "mode-on-forcing-locus", axis: "X", modeHz: hz(125), speedMmPerS: 25 };

test("a sound product gives a plain enabled button", () => {
	assert.equal(lifecycleOf(held(1, MEASURED, [])).kind, "enabled");
});

test("a caveated product arms the button with the reason as the confirm", () => {
	const l = lifecycleOf(held(1, MEASURED, [ADVISORY]));
	assert.equal(l.kind, "armed");
	assert.ok(l.confirm.includes("3"), "the confirm must carry the caveat's own numbers");
});

test("an unattributable product arms rather than blocks", () => {
	// Hand-assembled captures are the only reason 259 prototype captures are
	// usable at all. They must be marked, not blocked.
	assert.equal(lifecycleOf(held(1, UNKNOWN, [])).kind, "armed");
});

test("a disqualified product disables and names the remedy", () => {
	const l = lifecycleOf(held(1, MEASURED, [DISQUALIFYING]));
	assert.equal(l.kind, "disabled");
	assert.match(l.note, /ripple|current, microstepping/i);
});

test("absent, running and failed are all disabled with their own note", () => {
	assert.equal(lifecycleOf({ state: "absent" }).kind, "disabled");
	assert.equal(lifecycleOf({ state: "running", what: "measuring" }).kind, "disabled");
	const f = lifecycleOf({ state: "failed", why: "the run was cancelled" });
	assert.equal(f.kind, "disabled");
	assert.match(f.note, /cancelled/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && node --conditions=browser --test test/shaping-lifecycle.test.ts`
Expected: FAIL — `lifecycleOf` is not exported.

- [ ] **Step 3: Implement**

Append to `packages/ui/src/shaping/evidence/evidence.ts`:

```ts
/**
 * What a control over this product may do, as one value.
 *
 * `armed` is not a new invention: `createArmed` is already how this screen asks
 * for confirmation before writing to the card. Routing a caveat into it rather
 * than into a `disabled` is deliberate — a caveat must never take away a
 * control that sends G-code, because the firmware and the planner are the
 * authorities on what the machine may do. What a caveat buys is one sentence
 * the operator has to read first.
 *
 * `disabled` is reserved for the two cases where there is nothing to confirm:
 * no product at all, and a product shaping demonstrably cannot act on.
 */
export type Lifecycle =
	| { readonly kind: "enabled" }
	| { readonly kind: "armed"; readonly confirm: string }
	| { readonly kind: "disabled"; readonly note: string };

export function lifecycleOf<T>(e: Evidence<T>): Lifecycle {
	switch (e.state) {
		case "absent":
			return { kind: "disabled", note: "nothing measured yet" };
		case "running":
			return { kind: "disabled", note: `${e.what}…` };
		case "failed":
			return { kind: "disabled", note: e.why };
		case "superseded":
			return { kind: "armed", confirm: supersedeText(e.cause) };
		case "held": {
			switch (verdictOf(e)) {
				case "sound":
					return { kind: "enabled" };
				case "unusable": {
					const bad = e.caveats.find((c) => severityOf(c) === "disqualifying")!;
					return { kind: "disabled", note: caveatText(bad) };
				}
				case "unattributable":
					return { kind: "armed", confirm: `${e.provenance.kind === "unknown" ? e.provenance.why : ""} — this cannot be checked against the machine in front of you` };
				case "caveated":
					return { kind: "armed", confirm: caveatText(e.caveats[0]!) };
			}
		}
		default: {
			const unhandled: never = e;
			throw new Error(`unknown evidence state: ${String((unhandled as { state: unknown }).state)}`);
		}
	}
}
```

`evidence.ts` now imports `caveatText` and `supersedeText` from `../copy.ts`.
**Check for an import cycle:** `copy.ts` imports the `Caveat` *type* only
(erased at runtime), so the runtime cycle does not exist. If `tsc` complains,
move `caveatText`/`supersedeText` into `evidence/copy.ts` and re-export them
from `shaping/copy.ts` so the screen still has one table to read.

- [ ] **Step 4: Render caveats on the owning cards**

In `ShapingSweepBody`, add a caveat line under the existing readout, using the
same reserved-slot pattern:

```tsx
			<p class="shp-caveat">
				<Show when={svc.products().sweep} keyed>
					{e => <>{e.state === "held" && e.caveats.length > 0 ? caveatText(e.caveats[0]!) : NONE}</>}
				</Show>
			</p>
```

Do the same in `ShapingDecayBody` (reading `products().fingerprint`) and
`ShapingCandidatesBody` (reading `products().candidates`).

- [ ] **Step 5: CSS**

```css
/* One line, reserved. Same rule as .shp-thread and for the same reason. */
.shp-caveat {
	min-height: calc(3 * var(--u));
	margin: 0;
	font-size: calc(3 * var(--u));
	line-height: calc(3 * var(--u));
	color: var(--ink-dim);
}
```

- [ ] **Step 6: Run everything**

Run: `pnpm test`, then `npx tsc -b --force`, then `pnpm build`. All must be clean.
The px lint in `test/unit-lengths.test.ts` will fail if any length above is not
`calc(n * var(--u))`.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src packages/ui/test
git commit -m "feat(shaping): each card states the limits of its own reading GIT_68"
```

---

### Task 10: Deploy, and close the loop

- [ ] **Step 1: Full battery**

```bash
pnpm test && npx tsc -b --force && pnpm build
```

All three must be clean before anything ships.

- [ ] **Step 2: Deploy to the board**

```bash
pnpm build
pnpm ship --target http://duet3.nydick.net --mode dsf
```

- [ ] **Step 3: Verify on the real machine**

Open the Shaping screen on the printer, select T0, and load its saved results.
The coverage sentence must appear against the saved sweep. Name the check that
could have failed: **if the thread slot renders the em dash on a tool whose
sweep ladder does not bracket its fitted modes, the finding is not wired** —
that is the falsifying observation, and it must be made before claiming this
works.

- [ ] **Step 4: Update the issue pair**

```bash
gh issue comment 69 --body "Phase 1 landed: evidence machine + 8 findings. Spec docs/superpowers/specs/2026-08-23-shaping-interpretation-layer-design.md, plan docs/superpowers/plans/2026-08-23-shaping-interpretation-layer-phase-1.md. Phases 2-4 blocked on #53/#57/#51 as specced."
```

Then open the ticket pairs for phases 2–4 per `docs/github-issue-rules.md`, and
one for the `project-curriculum` companion lesson.

---

## Self-Review

**Spec coverage.** Machine → Task 2. Caveat union + copy → Task 1. All eight
phase-1 findings → Tasks 3, 4, 6 (`forcing-band-excludes-mode`,
`rows-not-analysed`, `mode-on-forcing-locus`, `mode-locus-unknown`,
`direction-spread`, `fits-at-damping-cap`, `few-fits`,
`predicted-not-measured`, `inherited`). Absorption of `steps.ts` → Task 7.
Placement and the thread → Tasks 8, 9. `SUPERSEDED` on tool change → Task 8
step 7. Stress test → Task 5. Verdict precedence → Task 2. Positional
stability → Tasks 8 step 6, 9 step 5. Curriculum companion → Task 10 step 4
(its own pair, as the spec says).

**Known gap, deliberate:** the spec's A/B compile-failure red-check ("deleting
the narrow fails to compile") is asserted by Task 7's test file compiling at
all, not by an automated negative-compile test. There is no
`expect-error`-style harness in this repo. **Ledger row:** *invariant
`a-product-cannot-be-consumed-by-a-step-it-is-not-valid-for` is rung 8 by
construction in the types and rung 3 for the red-check; promoting the
red-check needs a `tsc`-expects-failure fixture, which does not exist yet.*
Raise it as its own ticket rather than leaving it silent.
