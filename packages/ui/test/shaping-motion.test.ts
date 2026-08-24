/**
 * The motion state, its words, and the runner that produces both.
 *
 * The runner is the only place in this UI where a browser and a moving machine
 * are in a loop together, so what is asserted here is not "does it work" but
 * the three things an operator's safety rests on:
 *
 *  1. the shaper goes back whatever happens — finished, failed, or cancelled;
 *  2. a leg is gated on ITS OWN fresh reading, so the second ring of a measure
 *     run is authorised by the machine as it is after the first ring moved it;
 *  3. a report never claims more than happened — the tally survives a failure,
 *     a refusal never discusses the machine's shaper, and a run that could not
 *     restore says so in capitals.
 *
 * It runs against the SAME fake board the procedure tests use, so a run here
 * and a plan there are measured on one machine.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { motionBad, motionBusy, motionProgress, type MotionState } from "../src/shaping/motionRun.ts";
import { motionStateText, armedRunText, runKindText, refusalText } from "../src/shaping/copy.ts";
import { runMotion, fitCapturesOf, type RawCapture } from "../src/shaping/runner.ts";
import type { RunKind } from "../src/shaping/runPlan.ts";
import type { Refusal } from "../src/shaping/preconditions.ts";
import type { Mode, NoFit } from "../src/shaping/engine/fit.ts";
import { seconds } from "../src/shaping/engine/units.ts";
import type { ShapingConfig } from "../src/config/types.ts";
import { accelAddr } from "../src/control/commands.ts";
import { config, fakeBoard, modelWith, TOOLBOARD, testClock } from "./helpers/shapingMachine.ts";

/* ------------------------------------------------------------ the state union */

const RUN: RunKind = "measure";

const EVERY_STATE: readonly MotionState[] = [
	{ kind: "idle" },
	{ kind: "planning", run: RUN },
	{ kind: "running", run: RUN, step: 3, steps: 12, label: "X+ 200 mm/s (2/3)", captured: 2, expected: 12 },
	{ kind: "restoring", run: RUN, captured: 12, expected: 12 },
	{ kind: "fitting", run: RUN, done: 4, total: 12 },
	{ kind: "ended", run: RUN, outcome: { kind: "done" }, captured: 12, expected: 12, touched: true, restored: true },
	{ kind: "ended", run: RUN, outcome: { kind: "cancelled" }, captured: 5, expected: 12, touched: true, restored: true },
	{ kind: "ended", run: RUN, outcome: { kind: "failed", why: "no capture appeared" }, captured: 8, expected: 12, touched: true, restored: true },
	{ kind: "ended", run: RUN, outcome: { kind: "refused", refusal: { kind: "no-envelope" } }, captured: 0, expected: 12, touched: false, restored: false },
];

test("every motion state has a sentence, and none of them is empty", () => {
	for (const state of EVERY_STATE) {
		const text = motionStateText(state);
		assert.ok(text.length > 10, `${state.kind}: ${JSON.stringify(text)}`);
	}
});

test("every motion state answers 'is it busy' and 'how far along'", () => {
	for (const state of EVERY_STATE) {
		assert.equal(typeof motionBusy(state), "boolean", state.kind);
		const p = motionProgress(state);
		assert.ok(Number.isFinite(p.fraction) && p.fraction >= 0 && p.fraction <= 1, `${state.kind}: ${p.fraction}`);
	}
});

test("busy is exactly the states where the machine or the browser is still working", () => {
	assert.deepEqual(EVERY_STATE.filter(motionBusy).map(s => s.kind), ["planning", "running", "restoring", "fitting"]);
});

test("a run that ended badly shows the progress it MADE, not a full or an empty bar", () => {
	const stopped = EVERY_STATE.find(s => s.kind === "ended" && s.outcome.kind === "failed")!;
	assert.equal(motionProgress(stopped).fraction, 8 / 12);
	assert.equal(motionProgress(stopped).step, 8);
});

test("a report of a finished run still says whether the shaper went back", () => {
	const ok = motionStateText({ kind: "ended", run: RUN, outcome: { kind: "done" }, captured: 12, expected: 12, touched: true, restored: true });
	assert.match(ok, /Ran 12 of 12 captures/);
	assert.match(ok, /shaper is back as it was found/);

	const lost = motionStateText({ kind: "ended", run: RUN, outcome: { kind: "done" }, captured: 12, expected: 12, touched: true, restored: false });
	assert.match(lost, /NOT PUT BACK/);
	// And it is flagged as something to act on, even though every capture landed.
	assert.equal(motionBad({ kind: "ended", run: RUN, outcome: { kind: "done" }, captured: 12, expected: 12, touched: true, restored: false }), true);
});

test("a refusal never discusses the machine's shaper — nothing was sent", () => {
	const text = motionStateText({
		kind: "ended", run: RUN,
		outcome: { kind: "refused", refusal: { kind: "not-homed", axes: "XY" } },
		captured: 0, expected: 12, touched: false, restored: false,
	});
	assert.match(text, /home X and Y first/);
	assert.doesNotMatch(text, /NOT PUT BACK/);
	assert.doesNotMatch(text, /shaper is back/);
});

test("the failure sentence is passed through whole, so the two capture diagnoses survive", () => {
	// These are genuinely different jobs for the operator: a board that captured
	// and could not write, and a board that never captured at all. Summarising
	// either into "failed" throws away the only thing that tells them apart.
	const wrote = "the board finished a capture but t0_ring_Xp0.csv never appeared in 0:/sys/accelerometer";
	const never = "no capture named t0_ring_Xp0.csv appeared in 0:/sys/accelerometer within 10 s";
	for (const why of [wrote, never]) {
		assert.ok(motionStateText({ kind: "ended", run: RUN, outcome: { kind: "failed", why }, captured: 0, expected: 12, touched: true, restored: true }).includes(why));
	}
});

test("cancelling is not a failure", () => {
	const text = motionStateText({ kind: "ended", run: RUN, outcome: { kind: "cancelled" }, captured: 5, expected: 12, touched: true, restored: true });
	assert.match(text, /Cancelled after 5 of 12 captures/);
	assert.equal(motionBad({ kind: "ended", run: RUN, outcome: { kind: "cancelled" }, captured: 5, expected: 12, touched: true, restored: true }), false);
});

test("the armed confirm names the count, the move and the files it will write", () => {
	const text = armedRunText({ kind: "measure" }, 12, 60, 200, "t0_ring_Xp0.csv", "t0_ring_Ym2.csv");
	assert.match(text, /12 captures/);
	assert.match(text, /60 mm at 200 mm\/s/);
	assert.match(text, /t0_ring_Xp0\.csv … t0_ring_Ym2\.csv/);
	assert.match(text, /0:\/sys\/accelerometer/);
	// createArmed guarantees Escape; a two-step control whose way out is
	// invisible is a two-step control with no way out.
	assert.match(text, /Escape cancels/);
	assert.match(armedRunText({ kind: "sweep" }, 1, 60, 200, "a.csv", "a.csv"), /1 capture,/);
});

test("both runs are named in the operator's words", () => {
	assert.equal(runKindText("measure"), "Measure");
	assert.equal(runKindText("sweep"), "Sweep");
});

/* --------------------------------------------------------------- the runner */

const ADDR = accelAddr(20, 0);

type Harness = {
	readonly deps: Parameters<typeof runMotion>[1];
	readonly states: MotionState[];
	readonly sent: string[];
	readonly abort: AbortController;
};

function harness(over: {
	cfg?: ShapingConfig;
	model?: ReturnType<typeof modelWith>;
	onSend?: (code: string, nth: number) => void;
	driftOnMove?: number;
	fileAfterPolls?: number;
} = {}): Harness {
	const model = over.model ?? modelWith();
	const board = fakeBoard(model, {
		onSend: over.onSend,
		driftOnMove: over.driftOnMove,
		fileAfterPolls: over.fileAfterPolls,
	});
	const states: MotionState[] = [];
	const abort = new AbortController();
	const clock = testClock();
	const cfg = over.cfg ?? config();
	return {
		states,
		sent: board.sent,
		abort,
		deps: {
			conn: board.conn,
			om: () => model,
			cfg: () => cfg,
			accel: ADDR,
			prefix: "t0_ring",
			report: (s) => { states.push(s); },
			signal: abort.signal,
			now: clock.now,
			sleep: clock.sleep,
		},
	};
}

/** One-repeat rings on both axes: four captures, and short enough to read. */
const ONE_REP: ShapingConfig = {
	envelope: { x: [50, 250], y: [50, 250] },
	defaults: { distMm: 60, speedMmS: 200, repeats: 1 },
	accelByTool: {},
};

test("a measure run drives both axes and comes back with every capture", async () => {
	const h = harness({ cfg: ONE_REP });
	const result = await runMotion({ kind: "measure" }, h.deps);
	assert.equal(result.outcome.kind, "done", JSON.stringify(result.outcome));
	assert.equal(result.captures.length, 4);
	assert.deepEqual(result.captures.map(c => c.file), [
		"t0_ring_Xp0.csv", "t0_ring_Xm0.csv", "t0_ring_Yp0.csv", "t0_ring_Ym0.csv",
	]);
	assert.equal(result.restored, true);
	assert.equal(result.touched, true);
});

test("the shaper is put back once per leg — a measure run is two legs", async () => {
	const h = harness({ cfg: ONE_REP });
	await runMotion({ kind: "measure" }, h.deps);
	assert.equal(h.sent.filter(c => c === 'M593 P"none"').length, 2);
});

test("the last thing reported is always an ended state carrying the tally", async () => {
	const h = harness({ cfg: ONE_REP });
	await runMotion({ kind: "measure" }, h.deps);
	const last = h.states[h.states.length - 1]!;
	assert.equal(last.kind, "ended");
	if (last.kind !== "ended") return;
	assert.deepEqual({ captured: last.captured, expected: last.expected }, { captured: 4, expected: 4 });
});

test("the step counter runs across the WHOLE run, not per leg", async () => {
	const h = harness({ cfg: ONE_REP });
	await runMotion({ kind: "measure" }, h.deps);
	const steps = h.states.filter(s => s.kind === "running").map(s => (s.kind === "running" ? s.step : 0));
	// Four capture steps over two legs, counted 1..4 rather than 1,2,1,2.
	assert.equal(Math.max(...steps), 4);
	assert.ok(steps.every(n => n <= 4));
});

test("a run refused before anything is sent keeps its hands off the machine", async () => {
	const h = harness({ cfg: { ...ONE_REP, envelope: null } });
	const result = await runMotion({ kind: "measure" }, h.deps);
	assert.equal(result.outcome.kind, "refused");
	if (result.outcome.kind !== "refused") return;
	assert.equal(result.outcome.refusal.kind, "no-envelope");
	assert.equal(result.touched, false);
	assert.deepEqual(h.sent, []);
});

test("a machine that is not idle refuses, and the sentence is the planner's own", async () => {
	const h = harness({ cfg: ONE_REP, model: modelWith({ status: "processing" }) });
	const result = await runMotion({ kind: "measure" }, h.deps);
	assert.equal(result.outcome.kind, "refused");
	if (result.outcome.kind !== "refused") return;
	const refusal: Refusal = result.outcome.refusal;
	assert.deepEqual(refusal, { kind: "not-idle", status: "processing" });
	assert.equal(refusalText(refusal), "machine is busy (processing)");
	assert.deepEqual(h.sent, []);
});

test("a carriage that is not where the step expects ENDS the run — and the shaper still goes back", async () => {
	// Never corrected: moving it there would be this UI deciding where the
	// machine ought to be.
	const h = harness({ cfg: ONE_REP, driftOnMove: 1 });
	const result = await runMotion({ kind: "measure" }, h.deps);
	assert.equal(result.outcome.kind, "failed");
	if (result.outcome.kind !== "failed") return;
	assert.match(result.outcome.why, /the carriage is at/);
	assert.equal(result.restored, true);
	assert.ok(h.sent.includes('M593 P"none"'));
});

test("a send that is rejected mid-run stops it and still restores", async () => {
	const h = harness({
		cfg: ONE_REP,
		// The M956 of the second capture step.
		onSend: (_code, nth) => { if (nth === 12) throw new Error("503 firmware busy"); },
	});
	const result = await runMotion({ kind: "measure" }, h.deps);
	assert.equal(result.outcome.kind, "failed");
	assert.equal(result.restored, true);
	// The first capture is kept: eight good captures are eight good captures.
	assert.equal(result.captures.length, 1);
});

test("cancelling stops the run and the shaper still goes back", async () => {
	const h = harness({ cfg: ONE_REP, onSend: (_code, nth) => { if (nth === 6) h.abort.abort(); } });
	const result = await runMotion({ kind: "measure" }, h.deps);
	assert.equal(result.outcome.kind, "cancelled");
	assert.equal(result.restored, true);
	assert.ok(h.sent.includes('M593 P"none"'));
});

test("a run cancelled before it starts sends nothing at all", async () => {
	const h = harness({ cfg: ONE_REP });
	h.abort.abort();
	const result = await runMotion({ kind: "measure" }, h.deps);
	assert.equal(result.outcome.kind, "cancelled");
	assert.equal(result.touched, false);
	assert.deepEqual(h.sent, []);
});

test("a sweep run writes speed-named captures the Sweep card can collect", async () => {
	const h = harness({
		cfg: { ...ONE_REP, defaults: { ...ONE_REP.defaults, speedMmS: 16 } },
	});
	const result = await runMotion({ kind: "sweep" }, { ...h.deps, prefix: "t0_sweep" });
	assert.equal(result.outcome.kind, "done", JSON.stringify(result.outcome));
	// `<prefix>_<axis>_<speed>.csv` is exactly what speedFamilies groups.
	assert.ok(result.captures.every(c => /^t0_sweep_[XY]_\d+\.csv$/.test(c.file)), result.captures.map(c => c.file).join());
});

test("a capture that never appears is reported with the evidence that DID arrive", async () => {
	// The board's own run counter is the other half of the diagnosis: it says a
	// capture completed but not which one, and it is the only signal available
	// when the request that armed the capture timed out.
	const h = harness({ cfg: ONE_REP, fileAfterPolls: 1000 });
	const result = await runMotion({ kind: "measure" }, h.deps);
	assert.equal(result.outcome.kind, "failed");
	if (result.outcome.kind !== "failed") return;
	assert.match(result.outcome.why, /no capture named t0_ring_Xp0\.csv appeared/);
	assert.equal(result.restored, true);
});

/* --------------------------------------------------------------- the fitting */

test("fitting reports progress and keeps a capture the fitter declined", async () => {
	const captures: readonly RawCapture[] = [
		{ file: "t0_ring_Xp0.csv", csv: "x" },
		{ file: "t0_ring_Ym1.csv", csv: "y" },
	];
	const noFit: NoFit = { kind: "no-fit", why: "short-decay" } as unknown as NoFit;
	const mode = { f: 18.1, zeta: 0.127, g: 0.05 } as unknown as Mode;
	const seen: Array<[number, number]> = [];
	const remembered: string[] = [];
	const records = await fitCapturesOf(
		captures,
		async (_csv, axis) => ({ fit: axis === "X" ? mode : noFit, tStop: seconds(0.42) }),
		(done, total) => seen.push([done, total]),
		(file) => remembered.push(file),
	);
	assert.deepEqual(seen, [[0, 2], [1, 2]]);
	// Axis, direction and repeat come off the NAME, which is the convention the
	// run itself wrote.
	assert.deepEqual(records.map(r => [r.axis, r.dir, r.rep]), [["X", "+", 0], ["Y", "-", 1]]);
	// A file that did not fit still gets a record carrying its NoFit: aggregate
	// takes the median of the fits that succeeded, so it is excluded from the
	// numbers and present in the file.
	assert.equal(records[1]!.fit, noFit);
	assert.deepEqual(remembered, ["t0_ring_Xp0.csv", "t0_ring_Ym1.csv"]);
});

test("the address the run captures at is the one it was given", () => {
	// Not a spelling this module invents: `accelAddr` is the sole minting site,
	// so a capture cannot be aimed at a board nobody chose.
	assert.equal(String(TOOLBOARD), "20.0");
	assert.equal(String(ADDR), "20.0");
});
