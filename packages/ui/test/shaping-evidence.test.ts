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
import type { Caveat } from "../src/shaping/evidence/caveat.ts";
import { type Evidence, held, type Provenance, valueFor, verdictOf } from "../src/shaping/evidence/evidence.ts";
import { hz } from "../src/shaping/engine/units.ts";
import { measuredUnder } from "./helpers/shaping.ts";

const MEASURED: Provenance = measuredUnder();
const UNKNOWN: Provenance = { kind: "unknown", why: "assembled by hand from the card" };

const ADVISORY: Caveat = { kind: "few-fits", axis: "Y", n: 3, of: 10 };
const DISQUALIFYING: Caveat = { kind: "mode-on-forcing-locus", axis: "X", modeHz: hz(125), speedMmPerS: 25 };

const h = (prov: Provenance, caveats: readonly Caveat[]) => {
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

test("a superseded product keeps its numbers", () => {
	// Dropping the value would turn "this is out of date" into "this never
	// happened" — the numbers are still on the card and still worth showing.
	const e: Evidence<number> = { state: "superseded", value: 41, cause: { kind: "tool-changed", was: 0, now: 2 } };
	assert.equal(valueFor(e), 41);
});
