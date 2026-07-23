import { test } from "node:test";
import assert from "node:assert/strict";
import { layerChartData, layerStats } from "../src/charts/layerData.ts";
import type { Layer } from "../src/om/types.ts";

const layer = (duration: number, height: number, filament: number[] = []): Layer =>
	({ duration, height, filament, fractionPrinted: 0, temperatures: [] });

test("plots layer number (1-indexed) against duration", () => {
	const [x, y] = layerChartData([layer(12, 0.2), layer(18, 0.4), layer(15, 0.6)]);
	assert.deepEqual(x, [1, 2, 3]);
	assert.deepEqual(y, [12, 18, 15]);
});

test("an empty layer list yields empty axes, not a throw", () => {
	const [x, y] = layerChartData([]);
	assert.deepEqual(x, []);
	assert.deepEqual(y, []);
});

test("a still-printing layer (duration 0) is dropped so it isn't a zero bar", () => {
	// RRF appends the current layer with duration 0 until it completes; charting
	// it draws a misleading zero-height bar next to real layers.
	const [x, y] = layerChartData([layer(12, 0.2), layer(18, 0.4), layer(0, 0.6)]);
	assert.deepEqual(x, [1, 2]);
	assert.deepEqual(y, [12, 18]);
});

test("only a trailing zero is dropped, not a genuine fast layer mid-run", () => {
	// A 0 in the middle would be odd, but if it appears it is real data — only
	// the LAST layer is the in-progress one.
	const [x, y] = layerChartData([layer(12, 0.2), layer(0, 0.4), layer(15, 0.6)]);
	assert.deepEqual(x, [1, 2, 3]);
	assert.deepEqual(y, [12, 0, 15]);
});

test("layerStats summarises completed layers", () => {
	const s = layerStats([layer(10, 0.2), layer(20, 0.4), layer(30, 0.6)]);
	assert.equal(s.count, 3);
	assert.equal(s.min, 10);
	assert.equal(s.max, 30);
	assert.equal(s.mean, 20);
	assert.equal(s.total, 60);
});

test("layerStats ignores a trailing in-progress layer", () => {
	const s = layerStats([layer(10, 0.2), layer(20, 0.4), layer(0, 0.6)]);
	assert.equal(s.count, 2, "the in-progress layer is not counted");
	assert.equal(s.mean, 15);
});

test("layerStats on no completed layers is all zeros, not NaN", () => {
	const s = layerStats([]);
	assert.deepEqual(s, { count: 0, min: 0, max: 0, mean: 0, total: 0 });
});

test("layerStats and layerChartData are total over an absent layers key", () => {
	// A wholesale job-subtree replacement from a board that doesn't report
	// `layers` deletes the key (OM rule: tolerate missing fields). Found live
	// 2026-07-23: the layers card's visibleWhen threw and wedged the shell.
	assert.deepEqual(layerStats(undefined), { count: 0, min: 0, max: 0, mean: 0, total: 0 });
	assert.deepEqual(layerChartData(undefined), [[], []]);
});
