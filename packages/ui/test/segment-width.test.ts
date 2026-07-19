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
