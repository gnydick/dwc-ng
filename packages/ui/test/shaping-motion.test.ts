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
import { hz, seconds } from "../src/shaping/engine/units.ts";
import type { ShaperSpec } from "../src/shaping/engine/shapers.ts";
import type { Shaping } from "../src/om/types.ts";
import type { ShapingConfig } from "../src/config/types.ts";
import { accelAddr } from "../src/control/commands.ts";
import { config, EI2_PRIOR, fakeBoard, modelWith, TOOLBOARD, testClock } from "./helpers/shapingMachine.ts";

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

/** The two M593s a leg on a shaped machine sends, spelled once. `EI2_PRIOR` is
 *  the fixture machine's own shaper, so `EI2_LINE` is what putting it back
 *  looks like on the wire and `OFF` is what measuring past it looks like. */
const OFF = 'M593 P"none"';
const EI2_LINE = 'M593 P"ei2" F52 S0.075';

type Harness = {
	readonly deps: Parameters<typeof runMotion>[1];
	readonly states: MotionState[];
	readonly sent: string[];
	readonly abort: AbortController;
	/** What the BOARD is holding, which is not what `model.move.shaping` says:
	 *  the fake's mirror lags its board exactly as a polled object model lags a
	 *  machine (helpers/shapingMachine.ts). "Was the shaper put back?" is a
	 *  question about the board. */
	readonly shaping: () => Shaping;
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
		shaping: board.shaping,
		deps: {
			conn: board.conn,
			om: () => model,
			cfg: () => cfg,
			tool: 0,
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

test("each leg states the shaper it measures through and puts the operator's own back — a measure run is two legs", async () => {
	// The machine's own shaper is a NAMED one, which is what makes the two
	// M593s of a leg tell each other apart: since #53 a baseline leg opens with
	// `M593 P"none"` and closes by restoring what was found. Measured on an
	// unshaped machine the two are spelled identically, and dropping either
	// would still count.
	const h = harness({ cfg: ONE_REP, model: modelWith({ shaping: EI2_PRIOR }) });
	await runMotion({ kind: "measure" }, h.deps);
	assert.deepEqual(h.sent.filter(c => c.startsWith("M593")), [OFF, EI2_LINE, OFF, EI2_LINE]);
});

/* ---------------------------------------- the shaper across a multi-leg run */
//
// The bug these four are here to keep dead (#53 follow-on): every leg of a run
// re-reads the machine to be authorised, and `Preconditions.read` takes the
// prior shaper off the POLLED object model — which the run's own G-code has
// been changing. Leg 1 states `M593 P"none"`, the poll catches up, and leg 2's
// fresh reading hands back `none` as "the shaper this machine had". Restoring
// to that leaves a measure run with the operator's shaper silently switched
// off, and a verify run with the unproven candidate still installed, under a
// screen that reports the run as successful and the shaper as put back.
//
// None of it was visible until the fake board started holding the shaper its
// M593s set AND letting the object model lag behind it, the way a polled mirror
// of a machine does (helpers/shapingMachine.ts). Both halves are load-bearing:
// with the frozen fixture leg 2 re-read the value the test was BUILT with, and
// with a mirror that moved on the send it re-read a perfectly current one. In
// either case `pre.priorShaping` happened to be right and the bug was invisible
// — reverting the fix left all of these green. That is why the first test below
// asserts the FIXTURE, before any of the three that lean on it.

/** A candidate deliberately unlike the machine's own shaper, so "the candidate"
 *  and "the operator's" can never be spelled the same way on the wire. */
const MZV_SPEC: ShaperSpec = { type: "mzv", F: hz(40), S: 0.1 };
const MZV_LINE = 'M593 P"mzv" F40 S0.1';

test("the object model LAGS the board it mirrors — the fixture the three tests below rest on", async () => {
	// Not the wire: what `move.shaping` reads as at the moment each M593 goes
	// out, which is the value `Preconditions.read` would take a prior shaper
	// from. Row three is the whole bug in one cell — leg 2 opens on a model that
	// still reports leg 1's `none`, because a leg's restore is the last thing it
	// sends and nothing polls the machine after it.
	const model = modelWith({ shaping: EI2_PRIOR });
	const mirror: Array<[string, string]> = [];
	const h = harness({
		cfg: ONE_REP,
		model,
		onSend: (code) => { if (code.startsWith("M593")) mirror.push([code, model.move.shaping.type]); },
	});
	await runMotion({ kind: "measure" }, h.deps);
	assert.deepEqual(mirror, [
		[OFF, "ei2"],       // leg 1 opens on the machine as the operator left it
		[EI2_LINE, "none"], // and restores from a model the captures polled to `none`
		[OFF, "none"],      // leg 2 opens on a model that has NOT seen leg 1's restore
		[EI2_LINE, "none"], // and its restore is issued off that same stale reading
	]);
	// And the board itself was never confused: it has the operator's shaper.
	assert.deepEqual(h.shaping(), EI2_PRIOR);
});

test("leg 2 of a measure run restores the OPERATOR's shaper, not the one leg 1 left on the board", async () => {
	const h = harness({ cfg: ONE_REP, model: modelWith({ shaping: EI2_PRIOR }) });
	const result = await runMotion({ kind: "measure" }, h.deps);
	assert.equal(result.outcome.kind, "done", JSON.stringify(result.outcome));

	const m593 = h.sent.filter(c => c.startsWith("M593"));
	assert.deepEqual(m593, [OFF, EI2_LINE, OFF, EI2_LINE]);
	// Named on its own, because it is the ONE line the bug got wrong: with the
	// restore taken from each leg's own reading this was `M593 P"none"` and the
	// run still reported "the shaper is back as it was found".
	assert.equal(m593[3], EI2_LINE, "leg 2's restore is the operator's shaper");
	assert.notEqual(m593[3], OFF, "and emphatically not the `none` leg 1 stated");

	// The end state, not just the traffic: the machine is left holding it.
	assert.deepEqual(h.shaping(), EI2_PRIOR);
	assert.equal(result.restored, true);
});

test("leg 2 of a VERIFY run restores the operator's shaper, never the candidate under test", async () => {
	// Worse than losing the shaper: a run that ends with an UNPROVEN shaper
	// installed, on a machine whose operator has been told it was put back.
	const h = harness({ cfg: ONE_REP, model: modelWith({ shaping: EI2_PRIOR }) });
	const result = await runMotion({ kind: "verify", spec: MZV_SPEC }, { ...h.deps, prefix: "t0_ver" });
	assert.equal(result.outcome.kind, "done", JSON.stringify(result.outcome));

	const m593 = h.sent.filter(c => c.startsWith("M593"));
	assert.deepEqual(m593, [MZV_LINE, EI2_LINE, MZV_LINE, EI2_LINE]);
	assert.equal(m593[3], EI2_LINE, "leg 2's restore is the operator's shaper");
	assert.notEqual(m593[3], MZV_LINE, "and not the candidate leg 2 was measuring through");
	assert.deepEqual(h.shaping(), EI2_PRIOR);
	assert.equal(result.restored, true);
});

test("a run that fails in leg 2 still hands back the shaper the RUN began with", async () => {
	// The restore is what the `finally` sends, so the failure path is a separate
	// route to the same line — and it reads the same stale `move.shaping`.
	const h = harness({
		cfg: ONE_REP,
		model: modelWith({ shaping: EI2_PRIOR }),
		// Leg 2's first capture, named rather than counted: the Y ring is the
		// second leg by construction, so this cannot drift onto leg 1 the way an
		// index into the wire would.
		onSend: (code) => { if (code.includes("t0_ring_Yp0.csv")) throw new Error("503 firmware busy"); },
	});
	const result = await runMotion({ kind: "measure" }, h.deps);
	assert.equal(result.outcome.kind, "failed", JSON.stringify(result.outcome));
	assert.equal(result.restored, true);
	// It really did get past leg 1: both of leg 1's captures are in hand, so the
	// reading the failed leg restored from is one taken AFTER leg 1 ran.
	assert.equal(result.captures.length, 2, result.captures.map(c => c.file).join());
	const m593 = h.sent.filter(c => c.startsWith("M593"));
	assert.deepEqual(m593, [OFF, EI2_LINE, OFF, EI2_LINE]);
	assert.equal(m593[m593.length - 1], EI2_LINE, "the last thing the board hears is the operator's shaper");
	assert.deepEqual(h.shaping(), EI2_PRIOR);
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
	// Six steps over two legs — each leg states the shaper it measures through
	// (#53) and then makes its two captures — counted 1..6 rather than 1,2,3
	// twice. The counter counts STEPS, so the shaper statement is one of them.
	assert.equal(Math.max(...steps), 6);
	assert.ok(steps.every(n => n <= 6));
});

test("the progress DENOMINATOR is the whole run's steps, so the bar cannot run past its own end", async () => {
	// The other half of the counter above, and the half that was wrong: the
	// numerator counted every step and the denominator counted only captures,
	// so a one-repeat measure run reported "6 of 4". `motionProgress` clamps
	// the FILL and not the COUNT on purpose (motionRun.ts), which means a bar
	// that looks right is not evidence — the numbers have to be checked.
	const h = harness({ cfg: ONE_REP });
	await runMotion({ kind: "measure" }, h.deps);
	const running = h.states.filter(s => s.kind === "running");
	assert.ok(running.length > 0, "the run reported no progress at all");

	// Two legs, each stating the shaper it measures through (#53) and then
	// making its two captures: 2 + 4. Written out rather than derived, so this
	// cannot agree with a `totalStepsOf` that is wrong in the same way.
	for (const s of running) assert.equal(motionProgress(s).steps, 6, JSON.stringify(s));
	for (const s of running) {
		const p = motionProgress(s);
		assert.ok(p.step <= p.steps, `${p.step} of ${p.steps} — the count ran past the total`);
		assert.ok(p.fraction <= 1, `${p.fraction}`);
	}
	const last = motionProgress(running[running.length - 1]!);
	assert.deepEqual({ step: last.step, steps: last.steps, fraction: last.fraction }, { step: 6, steps: 6, fraction: 1 });
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
