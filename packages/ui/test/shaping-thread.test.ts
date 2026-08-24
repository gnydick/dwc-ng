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
import { held, type Provenance } from "../src/shaping/evidence/evidence.ts";
import type { Caveat } from "../src/shaping/evidence/caveat.ts";
import type { WorkflowProducts } from "../src/shaping/steps.ts";
import { hz } from "../src/shaping/engine/units.ts";

const MEASURED: Provenance = { kind: "measured", at: "2026-08-23T09:14:02", tool: 0 };
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

test("a superseded product contributes no thread, because its block says more", () => {
	// Its caveats describe a machine that is no longer the one in front of you;
	// the superseded sentence on the step is the useful thing to read.
	const p: WorkflowProducts = {
		...EMPTY,
		fingerprint: { state: "superseded", value: {}, cause: { kind: "tool-changed", was: 0, now: 2 } },
	};
	assert.equal(screenThread(p), null);
});
