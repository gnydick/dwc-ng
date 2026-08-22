import { test } from "node:test";
import assert from "node:assert/strict";
import {
	AXIS_PASS_LABEL, CHILD_COUNT_CHANGED, EMPTY_BODY_ROWS, judgeAxis, judgeDrift, judgeFloor,
	judgeScaleInvariance,
} from "../src/dev/layoutAudit.ts";

/**
 * Invariant A. A card's reported minimum along an axis must not depend on its
 * own used size along that axis. CSS defines min-content as the size at a
 * ZERO-sized containing block, so the actual container is not an input by
 * construction; a reported minimum that moves with the card is Chromium's
 * "hysteresis" defect. Observed as rowStop 180 against a span of 180.
 */
test("judgeAxis: a minimum that never moves is stable", () => {
	const v = judgeAxis("row", [
		{ size: 720, reported: 88 },
		{ size: 400, reported: 88 },
		{ size: 200, reported: 88 },
	]);
	assert.equal(v.stable, true);
	assert.equal(v.spread, 0);
});

test("judgeAxis: a minimum that tracks the card is the toolpath defect", () => {
	// Exactly the shape measured on 2026-07-30: reported == current span.
	const v = judgeAxis("row", [
		{ size: 720, reported: 180 },
		{ size: 400, reported: 100 },
		{ size: 200, reported: 50 },
	]);
	assert.equal(v.stable, false);
	assert.equal(v.spread, 130);
});

test("judgeAxis: one pixel of jitter is not a violation", () => {
	// Sub-pixel rounding at fractional row units must not cry wolf.
	const v = judgeAxis("row", [
		{ size: 720, reported: 88 },
		{ size: 400, reported: 89 },
	]);
	assert.equal(v.stable, true);
	assert.equal(v.spread, 1);
});

test("judgeAxis: fewer than two probes cannot judge anything", () => {
	assert.equal(judgeAxis("row", [{ size: 720, reported: 88 }]).stable, true);
	assert.equal(judgeAxis("row", []).stable, true);
});

/**
 * Invariant B, per-archetype policy: no descendant changes position when the
 * container resizes along the OTHER axis. Killing flex-wrap is what makes this
 * hold; a wrapping row is what breaks it.
 */
test("judgeDrift: identical positions are stable", () => {
	const a = [{ id: "0", main: 10, cross: 20 }, { id: "1", main: 10, cross: 60 }];
	assert.deepEqual(judgeDrift(a, a), { stable: true, moved: [] });
});

test("judgeDrift: a child that wrapped to a new line is reported by id", () => {
	const before = [{ id: "0", main: 10, cross: 20 }, { id: "1", main: 10, cross: 60 }];
	const after = [{ id: "0", main: 10, cross: 20 }, { id: "1", main: 44, cross: 20 }];
	const v = judgeDrift(before, after);
	assert.equal(v.stable, false);
	assert.deepEqual(v.moved, ["1"]);
});

test("judgeDrift: a differing child count is a violation, not a crash", () => {
	const before = [{ id: "0", main: 10, cross: 20 }];
	const after = [{ id: "0", main: 10, cross: 20 }, { id: "1", main: 10, cross: 60 }];
	const v = judgeDrift(before, after);
	assert.equal(v.stable, false);
	// The sentinel comes FROM the module the panel imports it from, so the two
	// cannot drift apart into a string that renders as a moved child id.
	assert.deepEqual(v.moved, [CHILD_COUNT_CHANGED]);
});

/**
 * THE CHECK INVARIANT A CANNOT MAKE. Every number below is a real measurement
 * taken in Chrome on 2026-07-30 against this worktree at the default pitch
 * (--row-unit: 4px), driven through the Card Lab bench.
 *
 * The four fixtures marked BROKEN are the four cards the floor table records as
 * defective, and A reported "ok" on every one of them. If judgeFloor stops
 * separating these two groups, it has stopped being a check.
 */
test("judgeFloor: the four known-broken cards report a body worth nothing", () => {
	// temperatures 17/17, gcode-viewer 17/17, camera 17/17 — measured. job-files
	// and system-files share .fb and measure the same 17 against a 17-row
	// header-and-chrome floor.
	for (const [card, rowStop, chromeStop] of [
		["temperatures", 17, 17], ["gcode-viewer", 17, 17],
		["job-files", 17, 17], ["system-files", 17, 17],
	] as const) {
		const v = judgeFloor(rowStop, chromeStop);
		assert.equal(v.bodyCounted, false, `${card} should be flagged`);
		assert.equal(v.bodyStop, 0);
	}
});

test("judgeFloor: a card whose body IS in its floor passes", () => {
	// Measured the same afternoon, same sweep: position 103 against a 19-row
	// chrome floor, tools-heaters 87/19, homing 87/17, sensors 69/17.
	for (const [card, rowStop, chromeStop] of [
		["position", 103, 19], ["tools-heaters", 87, 19],
		["homing", 87, 17], ["sensors", 69, 17],
	] as const) {
		const v = judgeFloor(rowStop, chromeStop);
		assert.equal(v.bodyCounted, true, `${card} should pass`);
		assert.ok(v.bodyStop > 0);
	}
});

test("judgeFloor: a genuinely small card is not a false positive", () => {
	// The tightest real cards measured: atx 22/17 and layers 22/17 are five rows
	// of body — small, but a row of buttons genuinely is small. console 28/19 is
	// nine. The threshold has to sit below these and above zero, which is the
	// whole reason it is 2 and not "any difference".
	assert.equal(judgeFloor(22, 17).bodyCounted, true);
	assert.equal(judgeFloor(28, 19).bodyCounted, true);
});

test("judgeFloor: the threshold is a rounding allowance, not a grace period", () => {
	// rowStop and chromeStop are each a ceil() over the pitch, so subtracting
	// them can be off by one either way. Two rows of slack absorbs that; three
	// would start hiding a card whose body is one short line.
	assert.equal(EMPTY_BODY_ROWS, 2);
	assert.equal(judgeFloor(19, 17).bodyCounted, false); // 2 rows: still nothing
	assert.equal(judgeFloor(20, 17).bodyCounted, true);  // 3 rows: something
});

test("judgeFloor: a chrome floor above the reported floor cannot read as a pass", () => {
	// Hiding the body's children can only ever REMOVE height, so chromeStop
	// above rowStop means the measurement disagreed with itself. It must land on
	// the loud side, not the quiet one.
	assert.equal(judgeFloor(17, 21).bodyCounted, false);
});

/**
 * The verdict wording is the fix, not a nicety: "ok" is what made a green row
 * over a broken card readable as "this layout is sound". Welded here so it
 * cannot regress to a bare token.
 */
test("a passed axis check is labelled with what it established, never 'ok'", () => {
	for (const label of Object.values(AXIS_PASS_LABEL)) {
		assert.notEqual(label.toLowerCase(), "ok");
		assert.match(label, /unchanged by (height|width)/);
	}
});

/**
 * THE SCALE INVARIANT AS AN ASSERTION. A card's floor in STORED grid cells
 * must be the same number at every UI scale, within one cell for the ceil()
 * a non-integer --u introduces. Two cells apart is a real dependency: some
 * element in the card still contains a layout-space pixel the px lint could
 * not see.
 */
test("judgeScaleInvariance: floors equal within one cell pass; two cells fail", () => {
	assert.equal(judgeScaleInvariance({ rows: 53, cols: 156 }, { rows: 54, cols: 156 }).ok, true);
	assert.equal(judgeScaleInvariance({ rows: 53, cols: 156 }, { rows: 55, cols: 156 }).ok, false);
	const r = judgeScaleInvariance({ rows: 53, cols: 156 }, { rows: 53, cols: 160 });
	assert.equal(r.ok, false);
	assert.equal(r.colDelta, 4);
});
