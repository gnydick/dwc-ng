import { test } from "node:test";
import assert from "node:assert/strict";
import { computeOpaqueRange, computeGhostRanges } from "../src/gcode/renderModes.ts";

test("static mode: opaque range covers every segment regardless of live index", () => {
	const layerIndex = new Uint16Array([0, 0, 1, 1]);
	const range = computeOpaqueRange(4, layerIndex, -1, "static");
	assert.deepEqual(range, { start: 0, end: 4 });
});

test("progressive mode: opaque range is [0, liveSegmentIndex]", () => {
	const layerIndex = new Uint16Array([0, 0, 0, 0]);
	const range = computeOpaqueRange(4, layerIndex, 1, "progressive");
	assert.deepEqual(range, { start: 0, end: 2 });
});

test("progressive mode with liveSegmentIndex -1: opaque range is empty", () => {
	const layerIndex = new Uint16Array([0, 0]);
	const range = computeOpaqueRange(2, layerIndex, -1, "progressive");
	assert.deepEqual(range, { start: 0, end: 0 });
});

test("layer-focus mode: opaque range is exactly the live segment's (contiguous) layer", () => {
	const layerIndex = new Uint16Array([0, 0, 1, 1, 2]);
	const range = computeOpaqueRange(5, layerIndex, 2, "layer-focus"); // segment 2 -> layer 1
	assert.deepEqual(range, { start: 2, end: 4 });
});

test("layer-focus mode with liveSegmentIndex -1: opaque range is empty", () => {
	const layerIndex = new Uint16Array([0, 0, 1, 1]);
	const range = computeOpaqueRange(4, layerIndex, -1, "layer-focus");
	assert.deepEqual(range, { start: 0, end: 0 });
});

test("empty toolpath: opaque range is empty for every mode", () => {
	const layerIndex = new Uint16Array(0);
	for (const mode of ["progressive", "static", "layer-focus"] as const) {
		assert.deepEqual(computeOpaqueRange(0, layerIndex, -1, mode), { start: 0, end: 0 });
	}
});

test("ghost ranges, hidden mode: both before and after are empty regardless of opaque range", () => {
	const opaqueRange = { start: 2, end: 4 };
	const ghost = computeGhostRanges(6, opaqueRange, "hidden");
	assert.deepEqual(ghost, { before: { start: 2, end: 2 }, after: { start: 4, end: 4 } });
});

test("ghost ranges, show mode, progressive-style opaque range starting at 0: before is empty, after covers the whole rest of the model", () => {
	const opaqueRange = { start: 0, end: 3 };
	const ghost = computeGhostRanges(10, opaqueRange, "show");
	assert.deepEqual(ghost, { before: { start: 0, end: 0 }, after: { start: 3, end: 10 } });
});

test("ghost ranges, show mode, opaque range at the very end: after is empty", () => {
	const opaqueRange = { start: 0, end: 4 };
	const ghost = computeGhostRanges(4, opaqueRange, "show");
	assert.deepEqual(ghost.after, { start: 4, end: 4 });
});

test("ghost ranges, show mode, layer-focus-style opaque range in the middle: before and after cover everything else, unbounded", () => {
	const opaqueRange = { start: 5, end: 6 };
	const ghost = computeGhostRanges(10, opaqueRange, "show");
	assert.deepEqual(ghost.before, { start: 0, end: 5 });
	assert.deepEqual(ghost.after, { start: 6, end: 10 });
});
