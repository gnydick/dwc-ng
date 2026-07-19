import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSegmentAlpha, combineRGBA } from "../src/gcode/renderModes.ts";

test("static mode: every segment is opaque regardless of live index", () => {
	const layerIndex = new Uint16Array([0, 0, 1, 1]);
	const alpha = computeSegmentAlpha(4, layerIndex, -1, "static");
	for (let seg = 0; seg < 4; seg++) {
		assert.equal(alpha[seg * 2], 1.0);
		assert.equal(alpha[seg * 2 + 1], 1.0);
	}
});

test("progressive mode: segments up to and including liveSegmentIndex are opaque, rest translucent", () => {
	const layerIndex = new Uint16Array([0, 0, 0, 0]);
	const alpha = computeSegmentAlpha(4, layerIndex, 1, "progressive");
	assert.equal(alpha[0], 1.0); // segment 0
	assert.equal(alpha[2], 1.0); // segment 1 (== liveSegmentIndex)
	assert.ok(alpha[4]! < 1.0); // segment 2
	assert.ok(alpha[6]! < 1.0); // segment 3
});

test("progressive mode with liveSegmentIndex -1: everything translucent (nothing printed yet)", () => {
	const layerIndex = new Uint16Array([0, 0]);
	const alpha = computeSegmentAlpha(2, layerIndex, -1, "progressive");
	assert.ok(alpha[0]! < 1.0);
	assert.ok(alpha[2]! < 1.0);
});

test("layer-focus mode: only segments sharing the live segment's layer are opaque", () => {
	const layerIndex = new Uint16Array([0, 0, 1, 1, 2]);
	const alpha = computeSegmentAlpha(5, layerIndex, 2, "layer-focus"); // liveSegmentIndex=2 -> layer 1
	assert.ok(alpha[0]! < 1.0);   // layer 0
	assert.ok(alpha[2]! < 1.0);   // layer 0
	assert.equal(alpha[4], 1.0);  // layer 1
	assert.equal(alpha[6], 1.0);  // layer 1
	assert.ok(alpha[8]! < 1.0);   // layer 2
});

test("each segment's two vertices share the same alpha", () => {
	const layerIndex = new Uint16Array([0, 1]);
	const alpha = computeSegmentAlpha(2, layerIndex, 0, "progressive");
	assert.equal(alpha[0], alpha[1]);
	assert.equal(alpha[2], alpha[3]);
});

test("returned array length is segmentCount * 2 (1 alpha per vertex)", () => {
	const alpha = computeSegmentAlpha(3, new Uint16Array([0, 0, 0]), -1, "static");
	assert.equal(alpha.length, 6);
});

test("combineRGBA interleaves rgb triples with alpha into rgba quads, per vertex", () => {
	const rgb = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]); // 1 segment, 2 vertices
	const alpha = new Float32Array([0.9, 0.8]);
	const rgba = combineRGBA(rgb, alpha);
	assert.deepEqual(Array.from(rgba), Array.from(new Float32Array([0.1, 0.2, 0.3, 0.9, 0.4, 0.5, 0.6, 0.8])));
});

test("combineRGBA output length is segmentCount * 8 (2 vertices * 4 channels)", () => {
	const rgb = new Float32Array(12); // 2 segments
	const alpha = new Float32Array(4);
	const rgba = combineRGBA(rgb, alpha);
	assert.equal(rgba.length, 16);
});
