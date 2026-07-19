import { test } from "node:test";
import assert from "node:assert/strict";
import { findSegmentIndex } from "../src/gcode/findSegmentIndex.ts";

test("returns -1 for an empty toolpath", () => {
	assert.equal(findSegmentIndex(new Float64Array([]), 100), -1);
});

test("returns -1 when filePosition is before the first segment", () => {
	assert.equal(findSegmentIndex(new Float64Array([10, 20, 30]), 5), -1);
});

test("returns the last segment whose offset is <= filePosition", () => {
	const offsets = new Float64Array([10, 20, 30, 40]);
	assert.equal(findSegmentIndex(offsets, 25), 1);
	assert.equal(findSegmentIndex(offsets, 20), 1);
	assert.equal(findSegmentIndex(offsets, 39), 2);
});

test("returns the last index when filePosition is past the end", () => {
	const offsets = new Float64Array([10, 20, 30]);
	assert.equal(findSegmentIndex(offsets, 1000), 2);
});
