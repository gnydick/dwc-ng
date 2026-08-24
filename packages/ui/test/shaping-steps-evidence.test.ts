/**
 * The invariant, tested through a consumer: a step cannot reach a product it is
 * not valid for.
 *
 * The COMPILE-time half — a consumer must narrow the union before it can touch
 * a value — is proved by the fact that this file compiles at all. What a
 * compiler cannot check, and what this file checks instead, is that the block a
 * step reports actually corresponds to the state its product is in.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHAPING_STEPS, type ShapingStep, stepReadiness, type StepInputs, type WorkflowProducts } from "../src/shaping/steps.ts";
import { held, type Provenance } from "../src/shaping/evidence/evidence.ts";
import type { Caveat } from "../src/shaping/evidence/caveat.ts";
import { hz } from "../src/shaping/engine/units.ts";

const MEASURED: Provenance = { kind: "measured", at: "2026-08-23T09:14:02", tool: 0 };
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

const spec = (step: ShapingStep) => {
	const s = SHAPING_STEPS.find((x) => x.step === step);
	assert.ok(s !== undefined);
	return s;
};

test("rank is blocked while no fingerprint is held", () => {
	const r = stepReadiness(spec("rank"), inputs(EMPTY));
	assert.equal(r.enabled, false);
	assert.equal(r.block.kind, "input");
});

test("rank runs on a sound fingerprint", () => {
	const products = { ...EMPTY, fingerprint: held({}, MEASURED, []) };
	const r = stepReadiness(spec("rank"), inputs(products));
	assert.equal(r.enabled, true);
	assert.equal(r.note, "ready");
});

test("rank runs on a caveated fingerprint and says what the caveat is", () => {
	// A caveat does not take the step away — it makes the operator read one
	// sentence first. The firmware and the planner remain the authorities.
	const products = { ...EMPTY, fingerprint: held({}, MEASURED, [ADVISORY]) };
	const r = stepReadiness(spec("rank"), inputs(products));
	assert.equal(r.enabled, true);
	assert.notEqual(r.note, "ready", "a caveated product must not read as clean");
	assert.match(r.note, /3 of 10/);
	assert.deepEqual(r.caveats, [ADVISORY]);
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
	assert.equal(r.block.kind, "run-failed");
	assert.match(r.note, /cancelled/);
});

test("a product still being produced reads as busy, not as missing", () => {
	const products: WorkflowProducts = { ...EMPTY, fingerprint: { state: "running", what: "measuring" } };
	const r = stepReadiness(spec("rank"), inputs(products));
	assert.equal(r.enabled, false);
	assert.equal(r.block.kind, "busy");
});

test("a step with no product need is unaffected by any of it", () => {
	// Measure needs nothing, so a disqualified fingerprint must not block it —
	// re-measuring is exactly the remedy.
	const products = { ...EMPTY, fingerprint: held({}, MEASURED, [DISQUALIFYING]) };
	assert.equal(stepReadiness(spec("measure"), inputs(products)).enabled, true);
});
