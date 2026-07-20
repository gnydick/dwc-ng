import { test } from "node:test";
import assert from "node:assert/strict";
import { computeHueColors, colorModeAvailable } from "../src/gcode/hueColors.ts";
import { FEATURE_TYPE_COLORS } from "../src/gcode/featureTypes.ts";
import type { ParsedToolpath } from "../src/gcode/parseGcode.ts";

function makeToolpath(overrides: Partial<ParsedToolpath> & { segmentCount: number }): ParsedToolpath {
	const n = overrides.segmentCount;
	const layerCount = overrides.layerCount ?? 1;
	return {
		positions: new Float32Array(n * 6),
		layerIndex: overrides.layerIndex ?? new Uint16Array(n),
		byteOffset: new Float64Array(n),
		extruding: new Uint8Array(n).fill(1),
		segmentCount: n,
		layerCount,
		deltaE: new Float32Array(n),
		speed: overrides.speed ?? new Float32Array(n),
		featureType: overrides.featureType ?? new Uint8Array(n),
		layerHeights: overrides.layerHeights ?? new Float32Array(layerCount),
		layerTimeMinutes: overrides.layerTimeMinutes ?? new Float32Array(layerCount).fill(NaN),
	};
}

// The forked LineMaterial's fragment shader ends in Three.js's standard
// linear->sRGB output conversion, so every color reaching it must already
// be linear — writeSegment converts from FEATURE_TYPE_COLORS' sRGB values
// via the sRGB EOTF before writing. Mirrored here rather than imported so
// this test independently verifies the conversion actually happens.
function srgbToLinear(c: number): number {
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

test("feature-type mode colors each segment by its FEATURE_TYPE_COLORS entry, converted from sRGB to linear", () => {
	const toolpath = makeToolpath({ segmentCount: 2, featureType: new Uint8Array([1, 2]) });
	const colors = computeHueColors(toolpath, "feature-type");
	const expected1 = new Float32Array(FEATURE_TYPE_COLORS[1]!.map(srgbToLinear));
	const expected2 = new Float32Array(FEATURE_TYPE_COLORS[2]!.map(srgbToLinear));
	assert.deepEqual(Array.from(colors.slice(0, 3)), Array.from(expected1));
	assert.deepEqual(Array.from(colors.slice(6, 9)), Array.from(expected2));
});

test("speed mode: slowest and fastest segments (normalized per file) get visibly different colors", () => {
	const toolpath = makeToolpath({ segmentCount: 2, speed: new Float32Array([1000, 3000]) });
	const colors = computeHueColors(toolpath, "speed");
	const slow = Array.from(colors.slice(0, 3));
	const fast = Array.from(colors.slice(6, 9));
	assert.notDeepEqual(slow, fast);
});

test("layer-time mode falls back to a neutral color when data is unavailable", () => {
	const toolpath = makeToolpath({ segmentCount: 1, layerTimeMinutes: new Float32Array([NaN]) });
	assert.equal(colorModeAvailable(toolpath, "layer-time"), false);
	const colors = computeHueColors(toolpath, "layer-time");
	assert.deepEqual(Array.from(colors.slice(0, 3)), Array.from(colors.slice(3, 6))); // still duplicated per vertex
});

test("colorModeAvailable: speed and feature-type are always available", () => {
	const toolpath = makeToolpath({ segmentCount: 1 });
	assert.equal(colorModeAvailable(toolpath, "speed"), true);
	assert.equal(colorModeAvailable(toolpath, "feature-type"), true);
});

test("colorModeAvailable: layer-time is true when at least one layer has real data", () => {
	const toolpath = makeToolpath({ segmentCount: 1, layerCount: 2, layerTimeMinutes: new Float32Array([NaN, 5]) });
	assert.equal(colorModeAvailable(toolpath, "layer-time"), true);
});

test("each segment's two vertices share the same color", () => {
	const toolpath = makeToolpath({ segmentCount: 2, featureType: new Uint8Array([1, 1]) });
	const colors = computeHueColors(toolpath, "feature-type");
	assert.deepEqual(Array.from(colors.slice(0, 3)), Array.from(colors.slice(3, 6)));
});

test("returned array length is segmentCount * 6 (2 vertices * 3 channels)", () => {
	const toolpath = makeToolpath({ segmentCount: 3 });
	const colors = computeHueColors(toolpath, "speed");
	assert.equal(colors.length, 18);
});
