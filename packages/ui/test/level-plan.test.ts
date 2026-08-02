import test from "node:test";
import assert from "node:assert/strict";
import { planLevel, DEFAULT_LEVEL_OPTIONS, type LevelReading, type LevelOptions } from "../src/bed/levelPlan.ts";

/** Gabe's machine: increasing the axis lowers that corner (to be confirmed on
 *  the supervised first run — the option exists precisely so it is not baked in). */
const OPTS: LevelOptions = { ...DEFAULT_LEVEL_OPTIONS, direction: 1 };

const r = (axis: "U" | "V" | "W", reading: number): LevelReading => ({ axis, reading });

test("readings already in agreement stop the loop", () => {
	const plan = planLevel([r("U", -12.99), r("V", -12.995), r("W", -13.0)], OPTS);
	assert.equal(plan.level, true);
	assert.deepEqual(plan.moves, []);
	assert.ok(plan.spread <= OPTS.tolerance);
});

test("a high corner is moved to lower it, not raised further", () => {
	// U reads highest (least negative), so U is the high corner.
	const plan = planLevel([r("U", -12.90), r("V", -13.00), r("W", -13.00)], OPTS);
	assert.equal(plan.level, false);
	const u = plan.moves.find(m => m.axis === "U")!;
	// direction +1 means increasing the axis lowers the corner, so a high corner
	// gets a POSITIVE move. Getting this backwards drives the bed into the probe.
	assert.ok(u.delta > 0, "high corner must move in the lowering direction");
	// The two low corners move the other way, by half as much each.
	assert.ok(plan.moves.find(m => m.axis === "V")!.delta < 0);
});

test("direction: -1 mirrors every move", () => {
	const readings = [r("U", -12.90), r("V", -13.00), r("W", -13.00)];
	const a = planLevel(readings, OPTS);
	const b = planLevel(readings, { ...OPTS, direction: -1 });
	for (const move of a.moves) {
		const mirrored = b.moves.find(m => m.axis === move.axis)!;
		assert.ok(Math.abs(mirrored.delta + move.delta) < 1e-12);
	}
});

test("the target is the readings' mean, so the bed moves as little as possible", () => {
	// Sum of corrections is zero about the mean: the bed tilts, it does not
	// translate. Translating would fight the Z datum for no reason.
	const plan = planLevel([r("U", -12.80), r("V", -13.00), r("W", -13.20)], OPTS);
	const total = plan.moves.reduce((s, m) => s + m.delta, 0);
	assert.ok(Math.abs(total) < 1e-9, `moves should cancel about the mean, got ${total}`);
	// The middle reading IS the mean here, so it should not move at all.
	assert.equal(plan.moves.find(m => m.axis === "V"), undefined);
});

test("under-relaxation: a step corrects less than the full error", () => {
	const plan = planLevel([r("U", -12.90), r("V", -13.00), r("W", -13.00)], OPTS);
	const u = plan.moves.find(m => m.axis === "U")!;
	const fullError = -12.9 - (-12.9 + -13 + -13) / 3;
	assert.ok(u.delta < fullError, "must not take the whole error in one step");
	assert.ok(Math.abs(u.delta - fullError * OPTS.relaxation) < 1e-9);
});

test("SAFETY: no single move may exceed maxStep, however wild the reading", () => {
	// A mis-seated probe or a missed tap can report a nonsense height. The clamp
	// is what stops that becoming a move that tilts the bed into the probe.
	const plan = planLevel([r("U", 40), r("V", -13.0), r("W", -13.0)], OPTS);
	for (const m of plan.moves) {
		assert.ok(Math.abs(m.delta) <= OPTS.maxStep, `${m.axis} moved ${m.delta}, over the cap`);
	}
	assert.equal(plan.clamped, true, "a clamped plan must say so — more iterations are needed");
	assert.equal(plan.level, false);
});

test("moves below one full motor step are dropped, not sent", () => {
	// 6400 steps/mm at 64x microstepping puts a full step at 10um; smaller
	// commands are executed by stiction in an unpredictable direction, so they
	// are not worth a traverse. Spread here exceeds tolerance, so it is NOT
	// simply the level case.
	const plan = planLevel([r("U", -12.9749), r("V", -13.0), r("W", -13.0251)], OPTS);
	assert.equal(plan.level, false, "spread is above tolerance");
	for (const m of plan.moves) assert.ok(Math.abs(m.delta) >= 0.001);
});

test("an empty probing round throws rather than reporting level", () => {
	// A round that produced no readings measured nothing; calling that "level"
	// would end the loop on a success it never observed.
	assert.throws(() => planLevel([], OPTS), /no readings/);
});

test("spread is reported even when level, so progress is visible", () => {
	const plan = planLevel([r("U", -12.995), r("V", -13.0), r("W", -13.0)], OPTS);
	assert.equal(plan.level, true);
	assert.ok(Math.abs(plan.spread - 0.005) < 1e-9);
});

// The cap is a property of this machine's probe, not of a call site. An option
// may LOWER it (a cautious caller asking for smaller steps is asking for more
// safety) and cannot raise it — a mis-seated probe reports readings in metres,
// and the correction is ~1:1 with the reading.
test("SAFETY: no option can raise the step limit above the machine's own", () => {
	const wild = planLevel([r("U", 40), r("V", -13.0), r("W", -13.0)], { ...OPTS, maxStep: 100 });
	for (const m of wild.moves) {
		assert.ok(Math.abs(m.delta) <= 0.5, `${m.axis} moved ${m.delta} with maxStep:100 — the ceiling did not hold`);
	}
	assert.ok(wild.clamped, "and the plan says it was shortened");
});

test("a caller may still ask for SMALLER steps", () => {
	const gentle = planLevel([r("U", 40), r("V", -13.0), r("W", -13.0)], { ...OPTS, maxStep: 0.05 });
	for (const m of gentle.moves) {
		assert.ok(Math.abs(m.delta) <= 0.05, `${m.axis} moved ${m.delta}, over the caller's own tighter cap`);
	}
});
