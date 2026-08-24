/**
 * The recording a pass needs, derived (GIT_63).
 *
 * What this file exists to stop coming back: on 2026-08-23 the post-move dwell
 * was a constant 1,500 ms and the sample count was a free-floating setting.
 * Neither knew about the other or about the move, so a sweep raised to ~10,250
 * samples recorded 7.5 s against a 1.5 s dwell and every pass landed inside the
 * previous pass's file — while at the other end of the same ladder a 25 mm/s
 * pass recorded 1.09 s of a 4.0 s move and there was no stop in the record to
 * fit.
 *
 * Both halves are now consequences of the motion, and the tests below are in
 * three groups: the ARITHMETIC (pure, against numbers worked out by hand), the
 * REAL CAPTURES (the same arithmetic against files that actually came off a
 * board, including the truncated one), and the RUN (that a derived budget lets a
 * long capture through while still failing one that never arrives).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
	captureTiming, captureWindow, longestCapture, moveSeconds, ringSeconds, sampleRateFrom,
	MAX_CAPTURE_SAMPLES, planProcedure, type SampleRate,
} from "../src/shaping/procedure.ts";
import { FIT_DEFAULTS } from "../src/shaping/engine/fit.ts";
import { hz, mm, mmPerS, mmPerS2 } from "../src/shaping/engine/units.ts";
import { runMotion } from "../src/shaping/runner.ts";
import type { MotionState } from "../src/shaping/motionRun.ts";
import {
	M955_REPLY, NOW, RATE, config, drain, errorOf, fakeBoard, freshPre, kinds,
	modelWith, ringPlan, testClock,
} from "./helpers/shapingMachine.ts";

/** The machine the ticket's arithmetic was worked out against, and the one the
 *  fixtures came off: 6000 mm/s², sampling at 1375 Hz. */
const A = mmPerS2(6000);
const RATE_1375 = sampleRateFrom("samples at 1375Hz")!;

/** Gabe's X mode as measured on 2026-08-23. */
const X_MODE = { f: hz(38.6), zeta: 0.111 };

/** How much recording has to follow the stop for `decayWindow` to open at all,
 *  and the most it will ever read. Both come from the FITTER — this file must
 *  not mint a second copy of either. */
const RING_FLOOR = FIT_DEFAULTS.leadS + FIT_DEFAULTS.minWindowS;
const RING_CEILING = FIT_DEFAULTS.leadS + FIT_DEFAULTS.windowS;

// --- the arithmetic ---------------------------------------------------------

test("a move that reaches its speed is a trapezoid: d/v + v/a", () => {
	// The ticket's own table, to three decimals.
	assert.ok(Math.abs(moveSeconds(mm(60), mmPerS(200), A) - 0.333) < 0.001);
	assert.ok(Math.abs(moveSeconds(mm(100), mmPerS(400), A) - 0.317) < 0.001);
	assert.ok(Math.abs(moveSeconds(mm(300), mmPerS(400), A) - 0.817) < 0.001);
	assert.ok(Math.abs(moveSeconds(mm(100), mmPerS(50), A) - 2.008) < 0.001);
	assert.ok(Math.abs(moveSeconds(mm(100), mmPerS(25), A) - 4.004) < 0.001);
});

test("a move too short to reach its speed is a triangle: 2*sqrt(d/a)", () => {
	// 400 mm/s needs v²/a = 26.7 mm of ramp; 10 mm never gets there.
	assert.ok(Math.abs(moveSeconds(mm(10), mmPerS(400), A) - 2 * Math.sqrt(10 / 6000)) < 1e-9);
	// And the two agree at the boundary, so there is no step in the function.
	const rampD = mm((400 * 400) / 6000);
	assert.ok(Math.abs(moveSeconds(rampD, mmPerS(400), A) - 2 * Math.sqrt(rampD / 6000)) < 1e-9);
});

test("direction is not duration — a negative distance takes the same time", () => {
	assert.equal(moveSeconds(mm(-60), mmPerS(200), A), moveSeconds(mm(60), mmPerS(200), A));
});

test("the ring-down is the mode's own decay, clamped to what the fitter reads", () => {
	// A lightly damped mode decays for longer than the fitter's window, and
	// recording past it would be recording something nothing will look at.
	assert.equal(ringSeconds({ f: hz(10), zeta: 0.01 }), RING_CEILING);
	// A heavily damped one is over almost at once — but `decayWindow` returns
	// null below FIT_DEFAULTS.minWindowS of post-stop samples, which is
	// `short-window`: a capture too short to fit is worse than a slow one.
	assert.equal(ringSeconds({ f: hz(60), zeta: 0.4 }), RING_FLOOR);
	// In between, the decay itself decides.
	const mid = ringSeconds({ f: hz(18), zeta: 0.05 });
	assert.ok(mid > RING_FLOOR && mid < RING_CEILING, `${mid} is not inside the band`);
	assert.ok(Math.abs(mid - (Math.log(1 / 0.15) / (2 * Math.PI * 18 * 0.05)) * 1.25) < 1e-9);
});

test("an unknown mode records the whole window the fitter can read", () => {
	// Every FIRST measurement is this case: f and zeta are what the run exists
	// to find out. The answer is the fitter's window, not a guessed damping —
	// there is no machine to assume.
	assert.equal(ringSeconds(null), RING_CEILING);
	// A nonsense mode is an unknown mode, not a division by zero.
	assert.equal(ringSeconds({ f: hz(0), zeta: 0.1 }), RING_CEILING);
	assert.equal(ringSeconds({ f: hz(40), zeta: 0 }), RING_CEILING);
});

test("the capture is lead-in plus move plus ring-down, and the samples follow the rate", () => {
	const w = captureWindow(mm(100), mmPerS(400), A, X_MODE);
	assert.ok(Math.abs(w.captureS - (w.moveS + w.ringS + 0.12)) < 1e-9, "the parts are the whole");
	// 0.12 + 0.3167 + 0.16 = 0.5967 s; at 1375 Hz that is 821 samples.
	//
	// The ticket's own table said 667 here, from a ring term of 0.070 s — the
	// mode's bare decay to 15 %. That figure ignores `decayWindow`, which needs
	// FIT_DEFAULTS.minWindowS of samples after the stop before it will return a
	// region at all; a 667-sample record of this pass would have been a run that
	// worked and a fit that said `short-window`, which is the failure the ticket
	// was chasing under another name. The floor wins.
	const t = captureTiming(w, RATE_1375);
	assert.equal(t.samples, 821);
	assert.equal(t.samples, Math.ceil(w.captureS * 1375));
});

test("halving the speed doubles the recording — one setting could not have served both", () => {
	const fast = captureTiming(captureWindow(mm(100), mmPerS(400), A, X_MODE), RATE_1375);
	const slow = captureTiming(captureWindow(mm(100), mmPerS(25), A, X_MODE), RATE_1375);
	// This ratio IS the bug: a sweep runs 25 → 200 mm/s, so one number is wrong
	// across the ladder by the whole of it.
	assert.ok(slow.samples / fast.samples > 5, `only ${(slow.samples / fast.samples).toFixed(1)}x`);
	assert.equal(slow.samples, Math.ceil((0.12 + 4.0041666666 + 0.16) * 1375));
});

test("the dwell covers what is left of the recording after the move ends", () => {
	// Over a whole speed ladder, not one case: the property is that the carriage
	// is never the thing that ends the recording.
	for (const speed of [25, 34, 45, 61, 82, 110, 149, 200, 400]) {
		for (const mode of [null, X_MODE]) {
			const t = captureTiming(captureWindow(mm(100), mmPerS(speed), A, mode), RATE_1375);
			const recordS = t.samples / t.rate;
			assert.ok(
				t.moveS + t.dwellMs / 1000 >= recordS,
				`${speed} mm/s: move ${t.moveS} + dwell ${t.dwellMs / 1000} < record ${recordS}`,
			);
		}
	}
});

test("the dwell tracks the recording rather than standing beside it", () => {
	// The A/B on the constant. Two passes over the SAME move, differing only in
	// how much ring-down has to be recorded: a known, heavily damped mode against
	// an unknown one. A fixed dwell gives these two the same wait; a derived one
	// gives the longer recording the longer wait, by exactly the difference.
	const damped = captureTiming(captureWindow(mm(60), mmPerS(200), A, { f: hz(60), zeta: 0.4 }), RATE_1375);
	const unknown = captureTiming(captureWindow(mm(60), mmPerS(200), A, null), RATE_1375);
	assert.equal(damped.moveS, unknown.moveS, "same move");
	assert.ok(unknown.samples > damped.samples, "the unknown mode records more");
	const extra = (unknown.dwellMs - damped.dwellMs) / 1000;
	assert.ok(Math.abs(extra - (unknown.ringS - damped.ringS)) < 0.002, `dwell grew by ${extra}, ring by ${unknown.ringS - damped.ringS}`);
	// And the same for the budget, which is the other consumer of the recording.
	assert.ok(unknown.budgetMs > damped.budgetMs);
});

test("the dwell does not subtract the lead-in — an over-run costs nothing, an under-run costs the fit", () => {
	// The lead-in is the one term measured off a handful of files rather than
	// derived, so the dwell is computed as if the record began at the move. That
	// leaves it roughly a lead-in longer than the ring-down, and never shorter.
	const t = captureTiming(captureWindow(mm(60), mmPerS(200), A, X_MODE), RATE_1375);
	assert.ok(t.dwellMs / 1000 >= t.ringS, "the dwell must at least cover the ring-down");
	assert.ok(t.dwellMs / 1000 < t.ringS + 0.13, "and not by very much");
});

test("the wait budget covers the recording with room for the write", () => {
	const quick = captureTiming(captureWindow(mm(60), mmPerS(200), A, X_MODE), RATE_1375);
	const slow = captureTiming(captureWindow(mm(100), mmPerS(25), A, null), RATE_1375);
	for (const t of [quick, slow]) {
		const recordS = t.samples / t.rate;
		assert.ok(t.budgetMs / 1000 > recordS, "a budget under the recording is a false failure");
		assert.ok(t.budgetMs >= 10_000, "the old flat budget is the floor, not the answer");
	}
	// And it GROWS: the 4.3 s recording gets a bigger budget than the 0.6 s one.
	assert.ok(slow.budgetMs > quick.budgetMs + 5_000);
});

// --- the rate, from the board -----------------------------------------------

test("the sampling rate is parsed out of M955's own report", () => {
	const rate = sampleRateFrom(M955_REPLY);
	assert.equal(rate, 1375);
	// By the unit, not by position: the rest of that sentence is the firmware's
	// to reword between releases.
	assert.equal(sampleRateFrom("... samples at 1344Hz with 10-bit resolution"), 1344);
	assert.equal(sampleRateFrom("sampling at 3200 Hz"), 3200);
});

test("a reply with no rate in it is null, never a default", () => {
	for (const reply of ["", "ok", "Error: Accelerometer 20:0 not found", "orientation 41", "at 0Hz"]) {
		assert.equal(sampleRateFrom(reply), null, `must not read a rate out of ${JSON.stringify(reply)}`);
	}
});

// --- the refusals -----------------------------------------------------------

test("a machine that reports no travel acceleration is refused, not guessed at", () => {
	const r = planProcedure(ringPlan(), freshPre({ travelAcceleration: null }), config(), NOW, RATE);
	assert.equal(r.ok, false);
	if (r.ok) return;
	assert.deepEqual(r.refusal, { kind: "no-acceleration" });
});

test("a recording longer than one M956 can ask for is refused at plan time", () => {
	// 200 mm at 4 mm/s is 50 s of move, which at 1375 Hz is past a 16-bit S.
	// Refused HERE rather than by the board mid-run, which would leave the
	// carriage parked halfway through a plan with the lab's shaper still on.
	const crawl = ringPlan({ start: { x: mm(50), y: mm(100) }, distMm: mm(200), speed: mmPerS(4) });
	const r = planProcedure(crawl, freshPre(), config(), NOW, RATE);
	assert.equal(r.ok, false);
	if (r.ok) return;
	assert.equal(r.refusal.kind, "capture-too-long");
	if (r.refusal.kind !== "capture-too-long") return;
	assert.equal(r.refusal.max, MAX_CAPTURE_SAMPLES);
	assert.ok(r.refusal.samples > MAX_CAPTURE_SAMPLES, "the refusal states what was actually needed");
});

test("a speed too small for the move to have a duration refuses rather than throwing", () => {
	// `plan` is total: it returns a Refusal and never throws, and this is the one
	// input that could have broken that — 60 mm at 1e-320 mm/s overflows the
	// cruise term to Infinity, which `seconds()` will not mint.
	const crawl = ringPlan({ speed: mmPerS(1e-320) });
	const r = planProcedure(crawl, freshPre(), config(), NOW, RATE);
	assert.equal(r.ok, false);
	if (r.ok) return;
	assert.deepEqual(r.refusal, { kind: "not-measurable" });
});

test("a run whose board will not report a rate refuses before it moves", async () => {
	const model = modelWith();
	const fake = fakeBoard(model, { accelReply: "Error: Accelerometer 20:0 not found" });
	const states: MotionState[] = [];
	const result = await runMotion("measure", {
		conn: fake.conn,
		om: () => model,
		cfg: () => config(),
		accel: freshPre().accel,
		prefix: "t0_ring",
		report: s => { states.push(s); },
		signal: new AbortController().signal,
		...testClock(),
	});
	assert.deepEqual(result.outcome, { kind: "refused", refusal: { kind: "no-sample-rate" } });
	// The M955 went out — it is a report and changes nothing — and nothing else did.
	assert.deepEqual(fake.sent, ["M955 P20.0"]);
	assert.equal(result.captures.length, 0);
	assert.ok(states.length > 0);
});

// --- the real captures ------------------------------------------------------

/**
 * The prototype's ring run, from `tools/accel/runs/ring/ring1/ring.json`:
 * 60 mm at 200 mm/s under 6000 mm/s², recorded at ~1376 Hz. The twelve CSVs it
 * produced are in test/fixtures/shaping/ring1 and all twelve fit.
 */
const RING1 = { dist: mm(60), speed: mmPerS(200), rate: 1376, samples: 1500 };

const recordedSeconds = (file: string): number => {
	const lines = readFileSync(new URL(`./fixtures/shaping/${file}`, import.meta.url), "utf8").trim().split(/\r?\n/);
	const trailer = /^Rate (\d+), overflows/.exec(lines[lines.length - 1]!);
	assert.ok(trailer !== null, `${file} has no rate trailer`);
	// Header, then one row per sample, then the trailer.
	return (lines.length - 2) / Number(trailer![1]);
};

test("the derived recording is one a real, fitting capture actually contained", () => {
	// The strongest check available without a machine: size the recording the way
	// the tool now would, and confirm the real file that DID fit is at least that
	// long. If the derivation asked for more than 1.09 s here, it would be asking
	// for more than the captures this project's whole fingerprint is built from.
	const actual = recordedSeconds("ring1/ring1_Xp0.csv");
	assert.ok(Math.abs(actual - RING1.samples / RING1.rate) < 0.01, `${actual} s is not the file's length`);

	// A first measure run knows no mode, so this is the conservative case.
	const first = captureWindow(RING1.dist, RING1.speed, A, null);
	assert.ok(first.captureS <= actual, `would ask for ${first.captureS} s, the file holds ${actual} s`);
	// 1464 against the 1500 that was actually used — the derivation lands just
	// under the count a person chose by hand, which is the sanity check.
	assert.equal(captureTiming(first, sampleRateFrom("at 1376Hz")!).samples, 1464);

	// And a verify pass over the same geometry, which DOES know the mode
	// (X fits at ~18 Hz, zeta ~0.12), needs far less.
	const known = captureWindow(RING1.dist, RING1.speed, A, { f: hz(18.141), zeta: 0.1199 });
	assert.ok(known.captureS < first.captureS * 0.7, "a known mode should cost much less recording");
});

test("the truncated sweep capture is exactly what the derivation would have prevented", () => {
	// baseline_X_20.csv is a real 20 mm/s pass over the same 60 mm, recorded with
	// the fixed 1,500 samples. This is the failure Gabe hit fitting a sweep, and
	// #55 blamed on the M956 trigger.
	const actual = recordedSeconds("baseline_X_20.csv");
	const needed = captureWindow(mm(60), mmPerS(20), A, null);
	assert.ok(needed.captureS > actual * 3, `needed ${needed.captureS} s, the file holds ${actual} s`);
	// The move alone outruns the whole record, so there is no stop in it to
	// detect and no ring-down to fit — "window too short", with the cause here.
	assert.ok(needed.moveS > actual, `the move alone is ${needed.moveS} s`);
});

test("the fast end of the same sweep was fine, which is why the bug hid", () => {
	const actual = recordedSeconds("baseline_X_200.csv");
	const needed = captureWindow(mm(60), mmPerS(200), A, null);
	assert.ok(needed.captureS <= actual, "the 200 mm/s pass fitted inside 1,500 samples by luck");
});

// --- the card's figure ------------------------------------------------------

test("the longest capture a card states is the longest one the run will make", () => {
	const plans = [
		ringPlan({ speed: mmPerS(200) }),
		ringPlan({ axis: "Y", speed: mmPerS(25), start: { x: mm(100), y: mm(100) } }),
	];
	const origin = { x: mm(100), y: mm(100) };
	const longest = longestCapture(plans, origin, A);
	assert.ok(longest !== null);
	// The 25 mm/s leg, not the 200 mm/s one — the worst case is the number worth
	// stating before an armed confirm.
	assert.ok(Math.abs(longest.moveS - moveSeconds(mm(60), mmPerS(25), A)) < 1e-9);
	// And it is the SAME arithmetic the plan uses, not a second one.
	assert.deepEqual(longest, captureWindow(mm(60), mmPerS(25), A, null));
});

test("no reported acceleration means the card says nothing rather than guessing", () => {
	assert.equal(longestCapture([ringPlan()], { x: mm(100), y: mm(100) }, null), null);
	assert.equal(longestCapture([], { x: mm(100), y: mm(100) }, A), null);
});

// --- the run ----------------------------------------------------------------

test("a capture that takes longer than the old flat budget still succeeds", async () => {
	// 45 polls at 250 ms is 11.25 s — past the 10 s the budget used to be, inside
	// the 12.2 s this capture's own recording earns it. Before GIT_63 this run
	// reported "no capture appeared" while the board was working perfectly.
	const model = modelWith();
	const planned = planProcedure(ringPlan({ repeats: 1 }), freshPre(), config(), NOW, RATE);
	assert.equal(planned.ok, true);
	if (!planned.ok) return;
	const fake = fakeBoard(model, { fileAfterPolls: 45 });
	const clock = testClock();
	const events = await drain(planned.proc.run(fake.conn, () => model, clock));
	assert.deepEqual(kinds(events), ["step", "capture", "step", "capture", "done", "restored"]);
	assert.ok(clock.now() > 10_000, "the wait really did run past the old budget");
});

test("a capture that never arrives still fails, and says how long it waited", async () => {
	const model = modelWith();
	const planned = planProcedure(ringPlan({ repeats: 1 }), freshPre(), config(), NOW, RATE);
	assert.equal(planned.ok, true);
	if (!planned.ok) return;
	const fake = fakeBoard(model, { fileAfterPolls: 100_000 });
	const clock = testClock();
	const events = await drain(planned.proc.run(fake.conn, () => model, clock));
	assert.deepEqual(kinds(events), ["step", "failed", "restored"]);
	assert.match(errorOf(events), /ring_Xp0\.csv/);
	assert.match(errorOf(events), /within 12\.2 s/);
	assert.ok(clock.now() < 13_000, "and it gave up rather than waiting forever");
});

test("a plan's sample count is not something a caller can state", () => {
	// The type is the mechanism: `samples` is not a field of RingPlan, of
	// SweepPlan, or of ShapingDefaults, so there is nothing to disagree with
	// `captureTiming`. This is the compile-time claim written out, so that
	// re-adding the field breaks a test as well as an invariant row.
	const plan: Record<string, unknown> = { ...ringPlan() };
	assert.ok(!("samples" in plan), "a plan must not carry a sample count");
	assert.ok(!("samples" in config().defaults), "a config must not carry one either");
});

/** The rate a test mints is still a real one — it came through the parser. */
const _typecheck: SampleRate = RATE_1375;
void _typecheck;
