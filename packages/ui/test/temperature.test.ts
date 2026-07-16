import { test } from "node:test";
import assert from "node:assert/strict";
import { TemperatureBuffer } from "../src/om/temperature.ts";

/**
 * The buffer is the pure, testable core of the temperature chart: it
 * accumulates per-heater samples over time, caps to a ring, and emits
 * uPlot-ready aligned data ([xs, ...series]). The Solid wiring that feeds it
 * from the object model is verified live.
 */

test("accumulates samples into uPlot-aligned data [xs, ...series]", () => {
	const buf = new TemperatureBuffer(100);
	buf.push(1, [23.5, 60.0]);
	buf.push(2, [24.0, 61.5]);

	const [xs, bed, hotend] = buf.snapshot();
	assert.deepEqual(xs, [1, 2]);
	assert.deepEqual(bed, [23.5, 24.0]);
	assert.deepEqual(hotend, [60.0, 61.5]);
});

test("caps at maxPoints, dropping the oldest samples (ring buffer)", () => {
	const buf = new TemperatureBuffer(3);
	for (let t = 1; t <= 5; t++) buf.push(t, [t * 10]);

	const [xs, series] = buf.snapshot();
	assert.deepEqual(xs, [3, 4, 5], "only the newest 3 timestamps survive");
	assert.deepEqual(series, [30, 40, 50]);
	assert.equal(buf.length, 3);
});

test("preserves nulls for an absent heater", () => {
	const buf = new TemperatureBuffer(10);
	buf.push(1, [23.5, null]);
	const [, , second] = buf.snapshot();
	assert.deepEqual(second, [null]);
});

test("resets cleanly when the heater count changes", () => {
	const buf = new TemperatureBuffer(10);
	buf.push(1, [20]);
	buf.push(2, [21]);
	// a second heater appears — old single-series history can't be aligned
	buf.push(3, [22, 50]);

	const [xs, a, b] = buf.snapshot();
	assert.deepEqual(xs, [3], "history restarts at the shape change");
	assert.deepEqual(a, [22]);
	assert.deepEqual(b, [50]);
});

test("snapshot returns copies, not live internals", () => {
	const buf = new TemperatureBuffer(10);
	buf.push(1, [20]);
	const first = buf.snapshot();
	buf.push(2, [21]);
	assert.deepEqual(first[0], [1], "an earlier snapshot is not mutated by later pushes");
});
