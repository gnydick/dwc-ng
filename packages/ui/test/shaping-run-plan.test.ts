/**
 * What a Measure and a Sweep run ARE — the geometry the Capture card draws and
 * the plan an armed confirm executes, which are required to be the same thing.
 *
 * `plannedSegments` is the load-bearing one. It is what the map is drawn from,
 * and the map is a PROMISE about where a 200 mm/s carriage is going. So these
 * assert the polyline against explicit coordinates rather than against a shape,
 * and one test closes the loop the other way: the segments' file names are
 * asserted to be exactly the files the procedure's own steps declare, so a map
 * that described a different run from the one about to be sent would fail here
 * rather than on a machine.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { plannedSegments, planProcedure, type Plan } from "../src/shaping/procedure.ts";
import {
	captureNameRange, defaultPrefix, envelopeText, measurePlans, plannedCaptureCount,
	runOrigin, runPlans, safePrefix, sweepLadder, sweepPlans, SWEEP_POINTS,
} from "../src/shaping/runPlan.ts";
import type { RunRequest } from "../src/shaping/runPlan.ts";
import { mm } from "../src/shaping/engine/units.ts";
import type { Envelope, ShapingDefaults } from "../src/config/types.ts";
import { BOX, config, freshPre, NOW, RATE , priorOf } from "./helpers/shapingMachine.ts";

const DEFAULTS: ShapingDefaults = { distMm: 60, speedMmS: 200, repeats: 3 };
const at = (x: number, y: number): { x: number; y: number } => ({ x, y });
const ends = (s: { from: { x: number; y: number }; to: { x: number; y: number } }): [number, number, number, number] =>
	[Number(s.from.x), Number(s.from.y), Number(s.to.x), Number(s.to.y)];

/* ------------------------------------------------------------- the speed ladder */

test("a sweep ladder climbs geometrically from top/8 to the speed that was set", () => {
	const ladder = sweepLadder(200);
	assert.equal(ladder.length, SWEEP_POINTS);
	assert.deepEqual(ladder, [25, 34, 45, 61, 82, 110, 149, 200]);
});

test("every ladder speed is a whole number, distinct and ascending — the file name depends on it", () => {
	// `<prefix>_<axis>_<speed>.csv` is what speedFamilies recognises, and it
	// recognises whole numbers only. Two speeds that rounded together would be
	// two captures under one name, i.e. one capture.
	for (const top of [3, 7, 12, 60, 137, 200, 1000]) {
		const ladder = sweepLadder(top);
		assert.ok(ladder.every(Number.isInteger), `${top}: ${ladder.join()}`);
		assert.ok(ladder.every(s => s >= 1), `${top}: ${ladder.join()}`);
		assert.deepEqual([...new Set(ladder)], [...ladder], `${top} repeats a speed: ${ladder.join()}`);
		assert.deepEqual([...ladder].sort((a, b) => a - b), [...ladder], `${top} is out of order`);
		assert.ok(ladder.includes(Math.round(top)), `${top} does not include the speed that was set`);
	}
});

test("a ladder from a speed that is not a speed is empty, not a guess", () => {
	// Refused downstream as `not-measurable` before anything moves — a run built
	// from an invented speed is the one thing this must never produce.
	for (const bad of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
		assert.deepEqual(sweepLadder(bad), [], String(bad));
	}
});

/* ----------------------------------------------------------------- the plans */

test("a measure run is one ring per axis, both centred on the box", () => {
	const plans = measurePlans(DEFAULTS, BOX, "t0_ring");
	assert.deepEqual(plans.map(p => p.axis), ["X", "Y"]);
	// BOX is 50..250 on both axes, so the middle is 150 and a 60 mm move
	// centred on it runs 120 -> 180.
	assert.deepEqual({ x: Number(plans[0]!.start.x), y: Number(plans[0]!.start.y) }, at(120, 150));
	assert.deepEqual({ x: Number(plans[1]!.start.x), y: Number(plans[1]!.start.y) }, at(150, 120));
});

test("a sweep run is ONE plan whose L corner is half a move below the middle", () => {
	const plans = sweepPlans(DEFAULTS, BOX, "t0_sweep");
	assert.equal(plans.length, 1);
	assert.deepEqual({ x: Number(plans[0]!.start.x), y: Number(plans[0]!.start.y) }, at(120, 120));
	assert.deepEqual(plans[0]!.speeds.map(Number), [25, 34, 45, 61, 82, 110, 149, 200]);
});

test("the capture count is counted off the plans, not restated from the settings", () => {
	assert.equal(plannedCaptureCount(measurePlans(DEFAULTS, BOX, "r")), 12);
	assert.equal(plannedCaptureCount(sweepPlans(DEFAULTS, BOX, "s")), 16);
	assert.equal(plannedCaptureCount([]), 0);
});

test("runOrigin is the first plan's own start, so a preview never depends on where the carriage is", () => {
	const origin = runOrigin(measurePlans(DEFAULTS, BOX, "r"));
	assert.deepEqual(origin === null ? null : { x: Number(origin.x), y: Number(origin.y) }, at(120, 150));
	assert.equal(runOrigin([]), null);
});

test("a move longer than the box is planned anyway — and refused, naming the corner", () => {
	// Deliberately NOT shortened here. The planner is the authority on what may
	// move, and a run quietly reduced to fit is a run the operator did not ask
	// for.
	const long: ShapingDefaults = { ...DEFAULTS, distMm: 400 };
	const plans = runPlans({ kind: "measure" }, long, BOX, "r");
	const planned = planProcedure(plans[0]!, freshPre(), config(), NOW, RATE, priorOf());
	assert.equal(planned.ok, false);
	if (planned.ok) return;
	assert.equal(planned.refusal.kind, "plan-leaves-envelope");
});

/* ------------------------------------------------------------ the polyline */

test("plannedSegments traces a ring out and back, every leg recorded, no travel", () => {
	const plans = measurePlans(DEFAULTS, BOX, "t0_ring");
	const x = plans[0]!;
	const segs = plannedSegments([x], x.start);
	// One repeat is out and back; three repeats is six passes, and because each
	// pass ends where the next begins there is no positioning leg anywhere.
	assert.equal(segs.length, 6);
	assert.ok(segs.every(s => s.kind === "capture"), segs.map(s => s.kind).join());
	assert.deepEqual(ends(segs[0]!), [120, 150, 180, 150]);
	assert.deepEqual(ends(segs[1]!), [180, 150, 120, 150]);
	assert.deepEqual(ends(segs[5]!), [180, 150, 120, 150]);
});

test("a measure run's two rings cross, with ONE travel leg between them", () => {
	const plans = measurePlans(DEFAULTS, BOX, "t0_ring");
	const segs = plannedSegments(plans, runOrigin(plans)!);
	assert.equal(segs.length, 13, segs.map(s => s.label).join(" | "));
	const travels = segs.filter(s => s.kind === "travel");
	assert.equal(travels.length, 1);
	// The X ring ends back at its own start; the Y ring begins at its own.
	assert.deepEqual(ends(travels[0]!), [120, 150, 150, 120]);
	// Both rings run through the middle of the box: X along y=150, Y along x=150.
	assert.deepEqual(ends(segs[0]!), [120, 150, 180, 150]);
	assert.deepEqual(ends(segs[7]!), [150, 120, 150, 180]);
});

test("a sweep traces the same L once per speed, positioning back to the corner each time", () => {
	const plans = sweepPlans({ ...DEFAULTS, speedMmS: 16 }, BOX, "t0_sweep");
	const segs = plannedSegments(plans, runOrigin(plans)!);
	const captures = segs.filter(s => s.kind === "capture");
	assert.equal(captures.length, plannedCaptureCount(plans));
	// X leg then Y leg, both from the corner.
	assert.deepEqual(ends(captures[0]!), [120, 120, 180, 120]);
	assert.deepEqual(ends(captures[1]!), [120, 120, 120, 180]);
	// Every leg after the first needs the carriage brought back to the corner.
	assert.equal(segs.filter(s => s.kind === "travel").length, captures.length - 1);
});

test("a zero-length positioning leg is omitted rather than drawn as a point", () => {
	const plans = measurePlans(DEFAULTS, BOX, "r");
	// Starting AT the ring's start: the first pass's positioning move is a move
	// to where the carriage already is, and a segment with two identical ends
	// draws nothing while still being counted in "N moves".
	const segs = plannedSegments([plans[0]!], plans[0]!.start);
	assert.ok(segs.every(s => Number(s.from.x) !== Number(s.to.x) || Number(s.from.y) !== Number(s.to.y)));
});

test("a preview from somewhere else opens with the travel leg that gets there", () => {
	const plans = measurePlans(DEFAULTS, BOX, "r");
	const segs = plannedSegments([plans[0]!], { x: mm(60), y: mm(60) });
	assert.equal(segs[0]!.kind, "travel");
	assert.deepEqual(ends(segs[0]!), [60, 60, 120, 150]);
});

/**
 * The loop closed: what the map says will be written IS what the procedure
 * arms. Two derivations that agreed by inspection would be exactly the promise
 * this card must not be able to break.
 */
test("the segments' file names are the procedure's own capture names, in order", () => {
	for (const kind of ["measure", "sweep"] as const) {
		const plans: readonly Plan[] = runPlans({ kind: kind } as RunRequest, DEFAULTS, BOX, "t0");
		const pre = freshPre();
		const fromSteps: string[] = [];
		for (const plan of plans) {
			// The reading a leg is planned from decides where its steps EXPECT the
			// carriage; it has no bearing on what the captures are called, which is
			// the whole of what this test is about.
			const planned = planProcedure(plan, pre, config(), NOW, RATE, priorOf());
			assert.equal(planned.ok, true, `${kind}: ${JSON.stringify(planned)}`);
			if (!planned.ok) return;
			for (const step of planned.proc.steps) {
				if (step.expectFile !== undefined) fromSteps.push(step.expectFile);
			}
		}
		const fromMap = plannedSegments(plans, runOrigin(plans)!)
			.flatMap(s => (s.kind === "capture" ? [s.file] : []));
		assert.deepEqual(fromMap, fromSteps, kind);
	}
});

/* --------------------------------------------------------------- the naming */

test("a run's name is reduced to what may appear in a file name", () => {
	// The prefix reaches the board inside M956 F"…", which RRF resolves against
	// 0:/sys/accelerometer. A slash would write somewhere else on the card; a
	// quote would end the parameter early.
	assert.equal(safePrefix("0:/sys/../evil", "ring"), "0sysevil");
	assert.equal(safePrefix('ring"1', "ring"), "ring1");
	assert.equal(safePrefix("t0_ring-2", "ring"), "t0_ring-2");
	assert.equal(safePrefix("....", "ring"), "ring");
	assert.equal(safePrefix("", "ring"), "ring");
	assert.equal(safePrefix("x".repeat(80), "ring").length, 24);
});

test("the default name carries the tool, so T1's captures cannot overwrite T0's", () => {
	assert.equal(defaultPrefix("measure", 0), "t0_ring");
	assert.equal(defaultPrefix("measure", 3), "t3_ring");
	assert.equal(defaultPrefix("sweep", 2), "t2_sweep");
});

test("the card states the first and last file, or nothing when there are none", () => {
	assert.deepEqual(captureNameRange(["a.csv", "b.csv", "c.csv"]), { first: "a.csv", last: "c.csv" });
	assert.deepEqual(captureNameRange(["only.csv"]), { first: "only.csv", last: "only.csv" });
	assert.equal(captureNameRange([]), null);
});

test("the envelope reads as the box the operator drew", () => {
	const env: Envelope = { x: [50, 250], y: [10, 190] };
	assert.equal(envelopeText(env), "X 50–250 · Y 10–190 mm");
});
