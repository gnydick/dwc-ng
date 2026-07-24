import { test } from "node:test";
import assert from "node:assert/strict";
import { speedScale, speedStepUp, speedStepDown, MIN_SCALE_MAX } from "../src/control/speedScale.ts";

/**
 * The slider's scale is always 0 .. 2x the machine's current speed factor, so
 * the handle sits mid-bar: drag right to double, left to zero. The stops are
 * quarters of that scale.
 */

test("the scale runs from zero to twice the current speed", () => {
	assert.equal(speedScale(100).max, 200);
	assert.equal(speedScale(75).max, 150);
	assert.equal(speedScale(120).max, 240);
});

test("the current value always lands exactly mid-scale", () => {
	for (const current of [40, 75, 100, 137, 250]) {
		const { max } = speedScale(current);
		assert.equal(max / 2, current, `current ${current} should sit at half of ${max}`);
	}
});

test("stops are quarters of the scale", () => {
	assert.deepEqual(speedScale(100).stops, [0, 50, 100, 150, 200]);
	assert.deepEqual(speedScale(50).stops, [0, 25, 50, 75, 100]);
});

test("the middle stop is always the current speed", () => {
	for (const current of [30, 100, 180]) {
		const { stops } = speedScale(current);
		assert.equal(stops[2], current);
	}
});

// --- the degenerate cases, where a naive 2x collapses the control ---

test("a current of zero does not collapse the scale to nothing", () => {
	// 2 x 0 = 0 would leave a zero-width range with every stop on top of every
	// other — and no way to drag back up off it.
	const { max, stops } = speedScale(0);
	assert.ok(max >= MIN_SCALE_MAX, `max ${max} must stay usable`);
	assert.equal(new Set(stops).size, stops.length, "stops must stay distinct");
});

test("a tiny current still leaves a usable scale", () => {
	const { max, stops } = speedScale(1);
	assert.ok(max >= MIN_SCALE_MAX);
	assert.equal(new Set(stops).size, stops.length);
});

test("nonsense input falls back to a sane scale rather than NaN", () => {
	for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -50]) {
		const { max, stops } = speedScale(bad);
		assert.ok(Number.isFinite(max) && max >= MIN_SCALE_MAX, `max for ${bad}`);
		assert.ok(stops.every(Number.isFinite), `stops for ${bad}`);
	}
});

test("stops are whole percents — M220 takes a number, not a fraction", () => {
	const { stops } = speedScale(137);
	assert.ok(stops.every(s => Number.isInteger(s)), JSON.stringify(stops));
});

test("stops ascend", () => {
	const { stops } = speedScale(83);
	for (let i = 1; i < stops.length; i++) {
		assert.ok(stops[i]! > stops[i - 1]!, `stop ${i} must exceed its predecessor`);
	}
});

test("snap-to-5: up rounds to the next multiple of 5, down to the previous", () => {
	// The exact example: from 103%, + lands on 105 and − on 100.
	assert.equal(speedStepUp(103), 105);
	assert.equal(speedStepDown(103), 100);
	// On the grid already, it moves a whole step.
	assert.equal(speedStepUp(100), 105);
	assert.equal(speedStepDown(100), 95);
	assert.equal(speedStepUp(105), 110);
	assert.equal(speedStepDown(105), 100);
	// Never below zero.
	assert.equal(speedStepDown(3), 0);
	assert.equal(speedStepDown(0), 0);
});
