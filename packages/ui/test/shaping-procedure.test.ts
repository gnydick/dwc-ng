/**
 * Preconditions, plans and the sealed Procedure — the whole of what stands
 * between the Shaping Lab and the carriage.
 *
 * These tests assert EXACT emitted strings, not shapes. A procedure that has
 * the right number of steps but sends the capture arm after the move records
 * nothing, and one whose restore line is spelled differently leaves the
 * machine shaped when the operator thinks it is not. The order
 * `[G90, G1 start, M400, G4, M956, G1 end, M400, G4]` is the contract.
 *
 * The refusal table is the other half: every reason the lab can decline to
 * move is produced here from a crafted object model, so a new reason cannot be
 * added without a row and an existing one cannot quietly stop firing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { Preconditions, type Refusal } from "../src/shaping/preconditions.ts";
import { planProcedure, Procedure, type SweepPlan, type VerifyPlan } from "../src/shaping/procedure.ts";
import { accelAddr } from "../src/control/commands.ts";
import type { ShapingConfig } from "../src/config/types.ts";
import { hz, mm, mmPerS } from "../src/shaping/engine/units.ts";
import type { ShaperSpec } from "../src/shaping/engine/shapers.ts";
import type { Shaping } from "../src/om/types.ts";
import {
	BOX, EI2_PRIOR, MAINBOARD, NO_SHAPER, NOW, RATE, TOOLBOARD,
	axis, board, codesOf, config, drain, fakeBoard, freshPre, kinds, modelWith, ringPlan, sentBy, sentByStep, testClock,
	type ModelOverrides,
} from "./helpers/shapingMachine.ts";

// --- refusals from Preconditions.read ---------------------------------------

const READ_REFUSALS: ReadonlyArray<{ name: string; over: ModelOverrides; cfg?: ShapingConfig; addr?: ReturnType<typeof accelAddr>; want: Refusal }> = [
	{ name: "printing is not idle", over: { status: "processing" }, want: { kind: "not-idle", status: "processing" } },
	{ name: "halted is not idle", over: { status: "halted" }, want: { kind: "not-idle", status: "halted" } },
	{ name: "X unhomed", over: { axes: [axis("X", false, 100), axis("Y", true, 100)] }, want: { kind: "not-homed", axes: "X" } },
	{ name: "both unhomed", over: { axes: [axis("X", false, null), axis("Y", false, null)] }, want: { kind: "not-homed", axes: "XY" } },
	{ name: "Y missing entirely", over: { axes: [axis("X", true, 100)] }, want: { kind: "not-homed", axes: "Y" } },
	{ name: "homed but no position is not plannable", over: { axes: [axis("X", true, 100), axis("Y", true, null)] }, want: { kind: "not-homed", axes: "Y" } },
	{ name: "board 20 has no accelerometer", over: { boards: [board(0, false), board(20, false)] }, want: { kind: "no-accelerometer", addr: "20.0" } },
	{ name: "board 20 is not on the bus at all", over: { boards: [board(0, true)] }, want: { kind: "no-accelerometer", addr: "20.0" } },
	{ name: "mainboard asked for, toolboard has it", over: {}, addr: MAINBOARD, want: { kind: "no-accelerometer", addr: "0" } },
	{ name: "no envelope set", over: {}, cfg: config(null), want: { kind: "no-envelope" } },
];

for (const row of READ_REFUSALS) {
	test(`Preconditions.read refuses: ${row.name}`, () => {
		const r = Preconditions.read(modelWith(row.over), row.cfg ?? config(), row.addr ?? TOOLBOARD, NOW);
		assert.equal(r.ok, false);
		if (r.ok) return;
		assert.deepEqual(r.refusal, row.want);
	});
}

test("Preconditions.read on a ready machine carries the read time, position and prior shaper", () => {
	const r = Preconditions.read(modelWith({ shaping: EI2_PRIOR }), config(), TOOLBOARD, NOW);
	assert.equal(r.ok, true);
	if (!r.ok) return;
	assert.equal(r.pre.readAt, NOW);
	assert.deepEqual({ x: Number(r.pre.position.x), y: Number(r.pre.position.y) }, { x: 100, y: 100 });
	assert.equal(String(r.pre.accel), "20.0");
	assert.equal(r.pre.travelAccel, 3000);
	assert.equal(r.pre.priorShaping.type, "ei2");
	assert.deepEqual(r.pre.envelope, BOX);
});

test("travelAcceleration the board never reported is null, not a guessed number", () => {
	const r = Preconditions.read(modelWith({ travelAcceleration: undefined }), config(), TOOLBOARD, NOW);
	assert.equal(r.ok, true);
	if (!r.ok) return;
	assert.equal(r.pre.travelAccel, null);
});

test("the mainboard's own accelerometer is addressed as P0", () => {
	const r = Preconditions.read(modelWith({ boards: [board(0, true)] }), config(), MAINBOARD, NOW);
	assert.equal(r.ok, true);
});

// --- refusals from planProcedure --------------------------------------------

test("planProcedure refuses a Preconditions older than one poll cycle", () => {
	const pre = freshPre();
	const fresh = planProcedure(ringPlan(), pre, config(), NOW + 2000, RATE, NO_SHAPER);
	assert.equal(fresh.ok, true, "exactly 2000 ms is still fresh");
	const stale = planProcedure(ringPlan(), pre, config(), NOW + 2001, RATE, NO_SHAPER);
	assert.equal(stale.ok, false);
	if (stale.ok) return;
	assert.deepEqual(stale.refusal, { kind: "stale" });
});

test("planProcedure refuses when the envelope changed after the read", () => {
	const pre = freshPre();
	const r = planProcedure(ringPlan(), pre, config({ x: [0, 300], y: [0, 300] }), NOW, RATE, NO_SHAPER);
	assert.equal(r.ok, false);
	if (r.ok) return;
	assert.deepEqual(r.refusal, { kind: "stale" });
});

test("planProcedure refuses when the envelope was cleared after the read", () => {
	const pre = freshPre();
	const r = planProcedure(ringPlan(), pre, config(null), NOW, RATE, NO_SHAPER);
	assert.equal(r.ok, false);
	if (r.ok) return;
	assert.deepEqual(r.refusal, { kind: "no-envelope" });
});

test("planProcedure names the point that leaves the envelope — the far end of the ring", () => {
	const r = planProcedure(ringPlan({ start: { x: mm(220), y: mm(100) } }), freshPre(), config(), NOW, RATE, NO_SHAPER);
	assert.equal(r.ok, false);
	if (r.ok) return;
	assert.deepEqual(r.refusal, { kind: "outside-envelope", point: { x: 280, y: 100 } });
});

test("planProcedure names the ring's own start when that is what is outside", () => {
	const r = planProcedure(ringPlan({ start: { x: mm(10), y: mm(100) } }), freshPre(), config(), NOW, RATE, NO_SHAPER);
	assert.equal(r.ok, false);
	if (r.ok) return;
	assert.deepEqual(r.refusal, { kind: "outside-envelope", point: { x: 10, y: 100 } });
});

/**
 * A head parked outside the box is refused by `read`, not by `plan`.
 *
 * Moved there 2026-08-23 (D3), and the move is the point: every run starts by
 * moving FROM wherever the head is parked, so a head outside the box cannot be
 * the start of ANY plan — which makes it a fact about the machine rather than
 * about a plan. Deciding it at plan time meant the screen's shared gate
 * (compose/services.ts, a bare `read`) could not see it, and the Capture card
 * offered a live Run button that refused the instant it was confirmed. Now
 * holding a `Preconditions` IS the proof the carriage is in the box, so
 * `planProcedure` does not re-check it and cannot disagree.
 */
test("a carriage parked outside the box is refused by the READING, before any plan exists", () => {
	const r = Preconditions.read(modelWith({ axes: [axis("X", true, 20), axis("Y", true, 100)] }), config(), TOOLBOARD, NOW);
	assert.equal(r.ok, false);
	if (r.ok) return;
	assert.deepEqual(r.refusal, { kind: "outside-envelope", point: { x: 20, y: 100 } });
});

test("a Preconditions therefore always carries a position inside its own envelope", () => {
	// The property the check above buys: no arrangement of arguments produces a
	// reading whose position is outside the box it carries.
	const pre = freshPre();
	const box = pre.envelope;
	assert.ok(Number(pre.position.x) >= box.x[0] && Number(pre.position.x) <= box.x[1]);
	assert.ok(Number(pre.position.y) >= box.y[0] && Number(pre.position.y) <= box.y[1]);
});

test("a negative-going ring is checked at both ends", () => {
	const r = planProcedure(ringPlan({ distMm: mm(-60), start: { x: mm(60), y: mm(100) } }), freshPre(), config(), NOW, RATE, NO_SHAPER);
	assert.equal(r.ok, false);
	if (r.ok) return;
	assert.deepEqual(r.refusal, { kind: "outside-envelope", point: { x: 0, y: 100 } });
});

// --- a plan that measures nothing is refused, never thrown over ----------

test("planProcedure is TOTAL: a plan that measures nothing refuses instead of throwing", () => {
	const unmeasurable = [
		{ name: "zero distance — the excitation move would be zero length and the board writes no file", plan: ringPlan({ distMm: mm(0) }) },
		{ name: "a distance that is not a number", plan: ringPlan({ distMm: Number.NaN as unknown as ReturnType<typeof mm> }) },
		{ name: "zero speed", plan: ringPlan({ speed: mmPerS(0) }) },
		{ name: "no repeats", plan: ringPlan({ repeats: 0 }) },
		{ name: "a fractional repeat count", plan: ringPlan({ repeats: 1.5 }) },
		{ name: "a sweep with no speeds", plan: sweepPlan({ speeds: [] }) },
		{ name: "a sweep with a negative speed", plan: sweepPlan({ speeds: [mmPerS(-10)] }) },
		{ name: "a verify whose ring measures nothing", plan: { kind: "verify", spec: EI2_SPEC, ring: ringPlan({ repeats: 0 }) } as VerifyPlan },
	];
	for (const row of unmeasurable) {
		const r = planProcedure(row.plan, freshPre(), config(), NOW, RATE, NO_SHAPER);
		assert.equal(r.ok, false, row.name);
		if (r.ok) continue;
		assert.deepEqual(r.refusal, { kind: "not-measurable" }, row.name);
	}
});

// --- ring plan --------------------------------------------------------------

test("a ring plan yields a shaper step and then 2 x repeats capture steps, one per direction per repeat", () => {
	const r = planProcedure(ringPlan(), freshPre(), config(), NOW, RATE, NO_SHAPER);
	assert.equal(r.ok, true);
	if (!r.ok) return;
	// Seven, not six: EVERY plan states the shaper it measures through before it
	// records anything (#53), and that step records nothing itself — which is
	// what the leading `undefined` says.
	assert.equal(r.proc.steps.length, 7);
	assert.deepEqual(
		r.proc.steps.map((s) => s.expectFile),
		[undefined, "ring_Xp0.csv", "ring_Xm0.csv", "ring_Xp1.csv", "ring_Xm1.csv", "ring_Xp2.csv", "ring_Xm2.csv"],
	);
});

test("a Y ring names its files on Y", () => {
	const r = planProcedure(ringPlan({ axis: "Y", repeats: 1, namePrefix: "probe" }), freshPre(), config(), NOW, RATE, NO_SHAPER);
	assert.equal(r.ok, true);
	if (!r.ok) return;
	assert.deepEqual(r.proc.steps.map((s) => s.expectFile), [undefined, "probe_Yp0.csv", "probe_Ym0.csv"]);
});

test("every capture step puts exactly [G90, G1 start, M400, G4, M956, G1 end, M400, G4] on the wire", async () => {
	const model = modelWith();
	const r = planProcedure(ringPlan({ repeats: 1 }), freshPre(), config(), NOW, RATE, NO_SHAPER);
	assert.equal(r.ok, true);
	if (!r.ok) return;
	// A procedure does not hand out its commands — running it against a fake
	// board is how you see them, which is also the thing worth asserting. Cut
	// into steps and reached by LABEL, so this stays a claim about one capture
	// step rather than about where that step happens to fall on the wire.
	const steps = await sentByStep(r.proc, model);
	assert.deepEqual(codesOf(steps, "X+ 200 mm/s (1/1)"), [
		"G90",
		"G1 X100 Y100 F12000",
		"M400",
		"G4 P500",
		'M956 P20.0 S1508 A2 F"ring_Xp0.csv"',
		"G1 X160 Y100 F12000",
		"M400",
		"G4 P731",
	]);
	assert.deepEqual(codesOf(steps, "X- 200 mm/s (1/1)"), [
		"G90",
		"G1 X160 Y100 F12000",
		"M400",
		"G4 P500",
		'M956 P20.0 S1508 A2 F"ring_Xm0.csv"',
		"G1 X100 Y100 F12000",
		"M400",
		"G4 P731",
	]);
});

test("`preview` is the same sequence the board will hear — a preview that lied would be worse than none", async () => {
	const model = modelWith();
	const r = planProcedure(ringPlan({ repeats: 2 }), freshPre(), config(), NOW, RATE, NO_SHAPER);
	assert.equal(r.ok, true);
	if (!r.ok) return;
	assert.deepEqual(r.proc.preview, await sentBy(r.proc, model));
	assert.equal(r.proc.preview[r.proc.preview.length - 1], 'M593 P"none"', "the restore is part of what the run will do");
});

test("the steps chain: each one starts where the last left the carriage", async () => {
	const model = modelWith({ axes: [axis("X", true, 120), axis("Y", true, 140)] });
	const r = planProcedure(ringPlan({ repeats: 2 }), freshPre({ axes: [axis("X", true, 120), axis("Y", true, 140)] }), config(), NOW, RATE, NO_SHAPER);
	assert.equal(r.ok, true);
	if (!r.ok) return;
	// Every step carries the position the carriage must ALREADY be at, and the
	// run refuses on a mismatch — so a run that reaches `done` against a board
	// that only ever moves where it is told is the proof that the chain holds.
	const fake = fakeBoard(model);
	const events = await drain(r.proc.run(fake.conn, () => model, testClock()));
	// The leading bare "step" is the shaper statement: it records nothing, so no
	// "capture" follows it.
	assert.deepEqual(kinds(events), ["step", "step", "capture", "step", "capture", "step", "capture", "step", "capture", "done", "restored"]);
	assert.deepEqual(fake.sent.filter((c) => c.startsWith("G1")), [
		"G1 X100 Y100 F12000", "G1 X160 Y100 F12000", // out from where the OM said we were
		"G1 X160 Y100 F12000", "G1 X100 Y100 F12000", // and back
		"G1 X100 Y100 F12000", "G1 X160 Y100 F12000",
		"G1 X160 Y100 F12000", "G1 X100 Y100 F12000",
	]);
});

test("step labels name the shaper, then the axis, direction, speed and repeat", () => {
	const r = planProcedure(ringPlan({ repeats: 3 }), freshPre(), config(), NOW, RATE, NO_SHAPER);
	assert.equal(r.ok, true);
	if (!r.ok) return;
	assert.deepEqual(r.proc.steps.map((s) => s.label), [
		// Step 0 says what the whole run is recorded through, in the same words
		// the progress strip will show while it goes out.
		"shaper none",
		"X+ 200 mm/s (1/3)",
		"X- 200 mm/s (1/3)",
		"X+ 200 mm/s (2/3)",
		"X- 200 mm/s (2/3)",
		"X+ 200 mm/s (3/3)",
		"X- 200 mm/s (3/3)",
	]);
});

test("the procedure keeps the Preconditions it was planned from", () => {
	const pre = freshPre();
	const r = planProcedure(ringPlan(), pre, config(), NOW, RATE, NO_SHAPER);
	assert.equal(r.ok, true);
	if (!r.ok) return;
	assert.equal(r.proc.pre, pre);
});

// --- restore (I2) -----------------------------------------------------------
//
// Observed on the wire, not read off a field: the restore is `#`-private now,
// and "what does the board hear last?" is the question that actually matters.

const RESTORES: ReadonlyArray<{ name: string; prior: Shaping; want: string }> = [
	{ name: "no shaper: shaping is switched off", prior: NO_SHAPER, want: 'M593 P"none"' },
	{ name: "a named shaper is reinstated exactly", prior: EI2_PRIOR, want: 'M593 P"ei2" F52 S0.075' },
	{
		name: "a custom shaper is restored impulse for impulse",
		prior: { type: "custom", frequency: 40, damping: 0.1, amplitudes: [0.335, 0.2641, 0.2242, 0.1767], delays: [0, 0.00972, 0.0278, 0.03752] },
		want: 'M593 P"custom" H0.3350:0.2641:0.2242 T0.00972:0.02780:0.03752',
	},
	{
		name: "a shaper this build has never heard of is restored from its reported train",
		prior: { type: "zvddddd", frequency: 40, damping: 0.1, amplitudes: [0.335, 0.2641, 0.2242, 0.1767], delays: [0, 0.00972, 0.0278, 0.03752] },
		want: 'M593 P"custom" H0.3350:0.2641:0.2242 T0.00972:0.02780:0.03752',
	},
	{
		name: "a shaper reporting no usable train restores to off rather than to a guess",
		prior: { type: "custom", frequency: 40, damping: 0.1, amplitudes: [], delays: [] },
		want: 'M593 P"none"',
	},
];

for (const row of RESTORES) {
	test(`restore — ${row.name}`, async () => {
		const model = modelWith({ shaping: row.prior });
		const r = planProcedure(ringPlan({ repeats: 1 }), freshPre({ shaping: row.prior }), config(), NOW, RATE, row.prior);
		assert.equal(r.ok, true);
		if (!r.ok) return;
		const sent = await sentBy(r.proc, model);
		assert.equal(sent[sent.length - 1], row.want, "the last thing the board hears");
		assert.deepEqual(
			sent.filter((c) => c.startsWith("M593")),
			['M593 P"none"', row.want],
			"and the only two M593s a ring sends: the baseline it measures through, then the operator's own back",
		);
	});
}

// --- verify plan ------------------------------------------------------------

const EI2_SPEC: ShaperSpec = { type: "ei2", F: hz(52), S: 0.075 };

test("a verify plan prepends the shaper as step 0 and leaves the ring untouched", async () => {
	const model = modelWith({ shaping: EI2_PRIOR });
	const verify: VerifyPlan = { kind: "verify", spec: EI2_SPEC, ring: ringPlan({ repeats: 1, namePrefix: "ver" }) };
	const r = planProcedure(verify, freshPre({ shaping: EI2_PRIOR }), config(), NOW, RATE, EI2_PRIOR);
	assert.equal(r.ok, true);
	if (!r.ok) return;
	assert.equal(r.proc.steps.length, 3);
	assert.equal(r.proc.steps[0]?.expectFile, undefined);
	assert.equal(r.proc.steps[0]?.label, "shaper ei2");
	assert.deepEqual(r.proc.steps.map((st) => st.expectFile), [undefined, "ver_Xp0.csv", "ver_Xm0.csv"]);
	const sent = await sentBy(r.proc, model);
	assert.deepEqual(sent[0], 'M593 P"ei2" F52 S0.075', "step 0 is the candidate, sent before anything moves");
	assert.equal(sent[1], "G90", "and the ring follows unchanged");
});

test("a verify plan's restore is still the PRIOR shaper, never the one under test", async () => {
	const verify: VerifyPlan = { kind: "verify", spec: EI2_SPEC, ring: ringPlan({ repeats: 1 }) };

	const offModel = modelWith({ shaping: NO_SHAPER });
	const off = planProcedure(verify, freshPre({ shaping: NO_SHAPER }), config(), NOW, RATE, NO_SHAPER);
	assert.equal(off.ok, true);
	if (!off.ok) return;
	const offSent = await sentBy(off.proc, offModel);
	assert.equal(offSent[offSent.length - 1], 'M593 P"none"');

	const priorModel = modelWith({ shaping: EI2_PRIOR });
	const prior = planProcedure(verify, freshPre({ shaping: EI2_PRIOR }), config(), NOW, RATE, EI2_PRIOR);
	assert.equal(prior.ok, true);
	if (!prior.ok) return;
	const priorSent = await sentBy(prior.proc, priorModel);
	assert.equal(priorSent[priorSent.length - 1], 'M593 P"ei2" F52 S0.075');
});

test("a verify plan is refused for the same reasons its ring would be", () => {
	const verify: VerifyPlan = { kind: "verify", spec: EI2_SPEC, ring: ringPlan({ start: { x: mm(220), y: mm(100) } }) };
	const r = planProcedure(verify, freshPre(), config(), NOW, RATE, NO_SHAPER);
	assert.equal(r.ok, false);
	if (r.ok) return;
	assert.deepEqual(r.refusal, { kind: "outside-envelope", point: { x: 280, y: 100 } });
});

// --- sweep plan -------------------------------------------------------------

const sweepPlan = (over: Partial<SweepPlan> = {}): SweepPlan => ({
	kind: "sweep",
	start: { x: mm(100), y: mm(100) },
	distMm: mm(60),
	speeds: [mmPerS(100), mmPerS(200)],
	namePrefix: "sweep",
	...over,
});

// A sweep's captures are named `<prefix>_<axis>_<speed>.csv`, NOT with the
// ring's direction-and-repeat suffix, and the difference is load-bearing rather
// than cosmetic: `shaping/captures.ts speedFamilies` collects exactly that shape
// into the family the Sweep card draws a heat map from. Named the ring's way, a
// live sweep would leave files nothing on the screen could collect.
test("a sweep names its captures by speed, so the Sweep card can collect them", () => {
	const r = planProcedure(sweepPlan(), freshPre(), config(), NOW, RATE, NO_SHAPER);
	assert.equal(r.ok, true);
	if (!r.ok) return;
	// The leading `undefined` and "shaper none" are step 0, which records
	// nothing: a sweep reads FORCED response and must not be measured through a
	// notch (#53).
	assert.deepEqual(r.proc.steps.map((s) => s.expectFile), [
		undefined,
		"sweep_X_100.csv",
		"sweep_Y_100.csv",
		"sweep_X_200.csv",
		"sweep_Y_200.csv",
	]);
	assert.deepEqual(r.proc.steps.map((s) => s.label), [
		"shaper none",
		"X+ 100 mm/s",
		"Y+ 100 mm/s",
		"X+ 200 mm/s",
		"Y+ 200 mm/s",
	]);
});

// Half the speed is a longer move and so a LONGER recording — 1875 samples
// against the ring's 1508 for the same 60 mm — while the dwell is the same 731
// ms, because what has to follow the move is the ring-down and that does not
// depend on how fast the carriage got there. A single configured sample count
// could not have said both.
test("a sweep's speed is a different feed rate on the same geometry", async () => {
	const model = modelWith();
	const r = planProcedure(sweepPlan({ speeds: [mmPerS(100)] }), freshPre(), config(), NOW, RATE, NO_SHAPER);
	assert.equal(r.ok, true);
	if (!r.ok) return;
	const steps = await sentByStep(r.proc, model);
	assert.deepEqual(codesOf(steps, "X+ 100 mm/s"), [
		"G90",
		"G1 X100 Y100 F6000",
		"M400",
		"G4 P500",
		'M956 P20.0 S1875 A2 F"sweep_X_100.csv"',
		"G1 X160 Y100 F6000",
		"M400",
		"G4 P731",
	]);
	assert.deepEqual(codesOf(steps, "Y+ 100 mm/s"), [
		"G90",
		"G1 X100 Y100 F6000",
		"M400",
		"G4 P500",
		'M956 P20.0 S1875 A2 F"sweep_Y_100.csv"',
		"G1 X100 Y160 F6000",
		"M400",
		"G4 P731",
	]);
});

test("a sweep is refused when its Y corner leaves the box, naming that corner", () => {
	const r = planProcedure(sweepPlan({ start: { x: mm(100), y: mm(220) } }), freshPre({ axes: [axis("X", true, 100), axis("Y", true, 220)] }), config(), NOW, RATE, NO_SHAPER);
	assert.equal(r.ok, false);
	if (r.ok) return;
	assert.deepEqual(r.refusal, { kind: "outside-envelope", point: { x: 100, y: 280 } });
});

// --- I1: there is no other way to get either type ---------------------------

test("read is the ONLY static producer of a Preconditions", () => {
	// The compile-time half of I1 cannot be asserted at runtime: TypeScript's
	// `private constructor` and the `#`-private brand are both erased. What a
	// test CAN pin is the surface — a second factory added beside `read` shows
	// up here, and whoever added it has to justify it.
	const statics = Object.getOwnPropertyNames(Preconditions).filter((k) => !["length", "name", "prototype"].includes(k));
	assert.deepEqual(statics, ["read"]);
});

test("planProcedure IS Procedure's only static, not a second route to one", () => {
	const statics = Object.getOwnPropertyNames(Procedure).filter((k) => !["length", "name", "prototype"].includes(k));
	assert.deepEqual(statics, ["plan"]);
	assert.equal(planProcedure, (Procedure as unknown as { plan: unknown }).plan);
});
