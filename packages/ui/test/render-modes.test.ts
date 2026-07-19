import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSegmentColors } from "../src/gcode/renderModes.ts";

// Round-tripped through Float32Array so comparisons against `colors`
// (also a Float32Array) are exact — 0.85 etc. aren't exactly representable
// in binary floating point, so comparing against plain float64 literals
// would fail even when the underlying values are "the same" number.
const BRIGHT = Array.from(new Float32Array([0.85, 0.55, 0.25]));
const DIM = Array.from(new Float32Array([0.18, 0.2, 0.24]));

test("static mode: every segment is bright regardless of live index", () => {
	const layerIndex = new Uint16Array([0, 0, 1, 1]);
	const colors = computeSegmentColors(4, layerIndex, -1, "static");
	for (let seg = 0; seg < 4; seg++) {
		assert.deepEqual(Array.from(colors.slice(seg * 6, seg * 6 + 3)), BRIGHT);
	}
});

test("progressive mode: segments up to and including liveSegmentIndex are bright, rest dim", () => {
	const layerIndex = new Uint16Array([0, 0, 0, 0]);
	const colors = computeSegmentColors(4, layerIndex, 1, "progressive");
	assert.deepEqual(Array.from(colors.slice(0, 3)), BRIGHT);   // segment 0
	assert.deepEqual(Array.from(colors.slice(6, 9)), BRIGHT);   // segment 1 (== liveSegmentIndex)
	assert.deepEqual(Array.from(colors.slice(12, 15)), DIM);    // segment 2
	assert.deepEqual(Array.from(colors.slice(18, 21)), DIM);    // segment 3
});

test("progressive mode with liveSegmentIndex -1: everything dim (nothing printed yet)", () => {
	const layerIndex = new Uint16Array([0, 0]);
	const colors = computeSegmentColors(2, layerIndex, -1, "progressive");
	assert.deepEqual(Array.from(colors.slice(0, 3)), DIM);
	assert.deepEqual(Array.from(colors.slice(6, 9)), DIM);
});

test("layer-focus mode: only segments sharing the live segment's layer are bright", () => {
	const layerIndex = new Uint16Array([0, 0, 1, 1, 2]);
	const colors = computeSegmentColors(5, layerIndex, 2, "layer-focus"); // liveSegmentIndex=2 -> layer 1
	assert.deepEqual(Array.from(colors.slice(0, 3)), DIM);    // layer 0
	assert.deepEqual(Array.from(colors.slice(6, 9)), DIM);    // layer 0
	assert.deepEqual(Array.from(colors.slice(12, 15)), BRIGHT); // layer 1
	assert.deepEqual(Array.from(colors.slice(18, 21)), BRIGHT); // layer 1
	assert.deepEqual(Array.from(colors.slice(24, 27)), DIM);  // layer 2
});

test("each segment's two vertices share the same color", () => {
	const layerIndex = new Uint16Array([0, 1]);
	const colors = computeSegmentColors(2, layerIndex, 0, "progressive");
	assert.deepEqual(Array.from(colors.slice(0, 3)), Array.from(colors.slice(3, 6)));
	assert.deepEqual(Array.from(colors.slice(6, 9)), Array.from(colors.slice(9, 12)));
});

test("returned array length is segmentCount * 6 (2 vertices * 3 channels)", () => {
	const colors = computeSegmentColors(3, new Uint16Array([0, 0, 0]), -1, "static");
	assert.equal(colors.length, 18);
});
