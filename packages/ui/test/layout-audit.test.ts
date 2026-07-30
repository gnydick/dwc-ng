import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeAxis, judgeDrift } from "../src/dev/layoutAudit.ts";

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
	assert.equal(judgeDrift(before, after).stable, false);
});
