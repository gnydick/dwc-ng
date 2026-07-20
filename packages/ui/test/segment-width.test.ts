import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSegmentWidths, TRAVEL_WIDTH_MM } from "../src/gcode/segmentWidth.ts";

test("travel segments get the fixed hairline width", () => {
	const positions = new Float32Array([0, 0, 0, 10, 0, 0]);
	const deltaE = new Float32Array([0]);
	const extruding = new Uint8Array([0]);
	const layerIndex = new Uint16Array([0]);
	const layerHeights = new Float32Array([0.2]);
	const widths = computeSegmentWidths(positions, deltaE, extruding, layerIndex, layerHeights, 1.75);
	assert.deepEqual(Array.from(widths), Array.from(new Float32Array([TRAVEL_WIDTH_MM])));
});

test("computes width from extrusion volume for an extruding segment", () => {
	const positions = new Float32Array([0, 0, 0, 10, 0, 0]); // 10mm segment
	const deltaE = new Float32Array([0.5]); // 0.5mm of 1.75mm filament
	const extruding = new Uint8Array([1]);
	const layerIndex = new Uint16Array([0]);
	const layerHeights = new Float32Array([0.2]); // 0.2mm layer height
	const widths = computeSegmentWidths(positions, deltaE, extruding, layerIndex, layerHeights, 1.75);
	const filamentArea = Math.PI * (1.75 / 2) ** 2;
	const expected = (filamentArea * 0.5) / (0.2 * 10);
	assert.ok(Math.abs(widths[0]! - expected) < 1e-6, `expected ~${expected}, got ${widths[0]}`);
});

test("zero-length segment falls back to the travel width instead of dividing by zero", () => {
	const positions = new Float32Array([5, 5, 0.2, 5, 5, 0.2]); // degenerate, no movement
	const deltaE = new Float32Array([0.1]);
	const extruding = new Uint8Array([1]);
	const layerIndex = new Uint16Array([0]);
	const layerHeights = new Float32Array([0.2]);
	const widths = computeSegmentWidths(positions, deltaE, extruding, layerIndex, layerHeights, 1.75);
	assert.deepEqual(Array.from(widths), Array.from(new Float32Array([TRAVEL_WIDTH_MM])));
	assert.ok(Number.isFinite(widths[0]));
});

test("missing/zero layerHeight falls back to a default rather than Infinity", () => {
	const positions = new Float32Array([0, 0, 0, 10, 0, 0]);
	const deltaE = new Float32Array([0.5]);
	const extruding = new Uint8Array([1]);
	const layerIndex = new Uint16Array([0]);
	const layerHeights = new Float32Array([0]); // missing/zero
	const widths = computeSegmentWidths(positions, deltaE, extruding, layerIndex, layerHeights, 1.75);
	assert.ok(Number.isFinite(widths[0]));
});

test("a very short segment (curve-tessellation-scale) reuses the previous stable width instead of dividing by a tiny length", () => {
	// Segment 0: a normal 10mm move establishing a stable ~0.45mm-ish width.
	// Segment 1: a 0.01mm move (shorter than MIN_SEGMENT_LENGTH_MM) with a
	// deltaE that, divided naively, would compute a wildly inflated width
	// (real rounding noise in short curve-tessellated E values does this).
	const positions = new Float32Array([
		0, 0, 0, 10, 0, 0, // segment 0: 10mm
		10, 0, 0, 10.01, 0, 0, // segment 1: 0.01mm
	]);
	const deltaE = new Float32Array([0.5, 0.01]);
	const extruding = new Uint8Array([1, 1]);
	const layerIndex = new Uint16Array([0, 0]);
	const layerHeights = new Float32Array([0.2]);
	const widths = computeSegmentWidths(positions, deltaE, extruding, layerIndex, layerHeights, 1.75);
	assert.equal(widths[1], widths[0], `short segment should inherit segment 0's width (${widths[0]}), got ${widths[1]}`);
});

test("a pathologically short FIRST segment falls back to the travel width, not an unstable division", () => {
	const positions = new Float32Array([0, 0, 0, 0.01, 0, 0]); // 0.01mm, shorter than MIN_SEGMENT_LENGTH_MM
	const deltaE = new Float32Array([0.05]); // would otherwise blow up: tiny length, real deltaE
	const extruding = new Uint8Array([1]);
	const layerIndex = new Uint16Array([0]);
	const layerHeights = new Float32Array([0.2]);
	const widths = computeSegmentWidths(positions, deltaE, extruding, layerIndex, layerHeights, 1.75);
	assert.ok(Math.abs(widths[0]! - TRAVEL_WIDTH_MM) < 1e-6, `expected ~${TRAVEL_WIDTH_MM}, got ${widths[0]}`);
});
