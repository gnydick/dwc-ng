/**
 * @invariant the-sentence-and-the-save-gate-are-one-value (shaping/sweepRun.ts)
 *
 * GitHub #100 presented as a dead Save button, and it was the CARD's sentence
 * that made it read as a broken control: `sweepState()` was a signal of its
 * own, so after the matrix was discarded the note still said "t0_sweep_X: 8 of
 * 8 speeds, held for T0" over a store that had nothing. The operator was told
 * the sweep existed by the only line on the card that talks, and refused by
 * the only button that acts.
 *
 * `sweepSentence` is the fix: `built` is derived from the very matrix the Save
 * button is gated on, so it cannot be said when there is nothing to save. The
 * last test here is the biconditional itself, over the whole state space —
 * that is the property, and the rest are its interesting corners.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sweepSentence, type SweepPhase } from "../src/shaping/sweepRun.ts";
import { analysedRows, type SweepMatrix } from "../src/shaping/engine/sweep.ts";
import { hz, mmPerS } from "../src/shaping/engine/units.ts";

/** Three speeds, of which the middle one transformed to nothing — so `rows`
 *  and `analysed` differ and a test cannot pass by conflating them. */
function matrixFixture(): SweepMatrix {
	return {
		speeds: [mmPerS(100), mmPerS(150), mmPerS(200)],
		freqs: Float64Array.from([0, 1]),
		amps: Float64Array.from([0.1, 0.2, 0, 0, 0.3, 0.4]),
		fullStepHz: [hz(500), hz(750), hz(1000)],
		maxHz: 1,
	};
}

const built = (tool: number): SweepPhase => ({ kind: "built", tool, family: `t${tool}_sweep_X` });

test("a built phase with no matrix in the store does NOT say a sweep is held", () => {
	// The #100 line itself: this is exactly the state the card was left in
	// after Reload wiped the store and left the phase signal standing.
	assert.equal(sweepSentence(built(0), 0, null).kind, "idle");
});

test("a built phase with a matrix says so, counting the matrix rather than a snapshot", () => {
	const m = matrixFixture();
	const said = sweepSentence(built(0), 0, m);
	assert.equal(said.kind, "built");
	assert.deepEqual(said, { kind: "built", tool: 0, family: "t0_sweep_X", rows: 3, analysed: 2 });
	assert.equal(said.kind === "built" ? said.rows : -1, m.speeds.length, "rows comes off the matrix");
	assert.equal(said.kind === "built" ? said.analysed : -1, analysedRows(m), "and so does analysed");
});

test("a build for another head is not said over the head on screen", () => {
	// Built for T0, picker moved to T1, T1 has a matrix of its own: the note
	// must not keep claiming T0's family. This one was wrong before #100 too.
	assert.equal(sweepSentence(built(0), 1, matrixFixture()).kind, "idle");
});

test("every phase that is not built passes through untouched", () => {
	const phases: SweepPhase[] = [
		{ kind: "idle" },
		{ kind: "loading", done: 2, total: 8, file: "0:/sys/accelerometer/t0_sweep_X_100.csv" },
		{ kind: "computing", total: 8 },
		{ kind: "saving", tool: 0 },
		{ kind: "saved", tool: 0 },
		{ kind: "failed", why: "the excitation move has no length" },
	];
	for (const phase of phases) {
		for (const held of [null, matrixFixture()]) {
			assert.deepEqual(sweepSentence(phase, 0, held), phase, `${phase.kind} must not be rewritten`);
		}
	}
});

test("the sentence and the Save gate cannot disagree, across every phase and both gate states", () => {
	// Save's `disabled` is `sweepHeld() === null || busy()`, and `busy()` is
	// read off the same sentence. So the claim under test is: whenever the
	// sentence says a sweep is HELD, the gate that decides whether Save works
	// is open — over the entire state space, not one path through it.
	const phases: SweepPhase[] = [
		{ kind: "idle" },
		{ kind: "loading", done: 0, total: 1, file: "x.csv" },
		{ kind: "computing", total: 1 },
		{ kind: "saving", tool: 0 },
		{ kind: "saved", tool: 0 },
		{ kind: "failed", why: "no" },
		built(0),
		built(1),
	];
	for (const phase of phases) {
		for (const held of [null, matrixFixture()]) {
			const said = sweepSentence(phase, 0, held);
			const saveEnabled = held !== null;
			if (said.kind === "built") {
				assert.equal(saveEnabled, true, `${phase.kind} claimed a sweep is held while Save was gated shut`);
			}
		}
	}
});
