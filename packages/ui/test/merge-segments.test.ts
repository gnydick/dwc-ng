import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeExtrudingRuns } from "../src/gcode/mergeSegments.ts";

/** Build positions (6 floats/seg) from a list of [sx,sy,sz, ex,ey,ez]. */
function pos(segs: number[][]): Float32Array {
	return new Float32Array(segs.flat());
}

test("a straight run of collinear extruding segments merges into one run", () => {
	// three +X moves in a line, same layer, same width
	const positions = pos([
		[0, 0, 0, 1, 0, 0],
		[1, 0, 0, 2, 0, 0],
		[2, 0, 0, 3, 0, 0],
	]);
	const runs = mergeExtrudingRuns(positions, new Float32Array([0.4, 0.4, 0.4]), new Uint8Array([1, 1, 1]), new Uint16Array([0, 0, 0]));
	assert.deepEqual(runs, [{ start: 0, end: 3 }]);
});

test("a sharp corner ends the run", () => {
	const positions = pos([
		[0, 0, 0, 1, 0, 0], // +X
		[1, 0, 0, 1, 1, 0], // +Y (90°)
	]);
	const runs = mergeExtrudingRuns(positions, new Float32Array([0.4, 0.4]), new Uint8Array([1, 1]), new Uint16Array([0, 0]));
	assert.deepEqual(runs, [{ start: 0, end: 1 }, { start: 1, end: 2 }]);
});

test("a travel (non-extruding) move breaks a run and is not itself a run", () => {
	const positions = pos([
		[0, 0, 0, 1, 0, 0], // extrude
		[1, 0, 0, 2, 0, 0], // travel (collinear, but not extruding)
		[2, 0, 0, 3, 0, 0], // extrude
	]);
	const runs = mergeExtrudingRuns(positions, new Float32Array([0.4, 0.1, 0.4]), new Uint8Array([1, 0, 1]), new Uint16Array([0, 0, 0]));
	assert.deepEqual(runs, [{ start: 0, end: 1 }, { start: 2, end: 3 }]);
});

test("a layer change ends the run even when collinear", () => {
	const positions = pos([
		[0, 0, 0, 1, 0, 0],
		[1, 0, 1, 2, 0, 1], // same +X direction but next layer
	]);
	const runs = mergeExtrudingRuns(positions, new Float32Array([0.4, 0.4]), new Uint8Array([1, 1]), new Uint16Array([0, 1]));
	assert.deepEqual(runs, [{ start: 0, end: 1 }, { start: 1, end: 2 }]);
});

test("a large width jump ends the run", () => {
	const positions = pos([
		[0, 0, 0, 1, 0, 0],
		[1, 0, 0, 2, 0, 0],
	]);
	const runs = mergeExtrudingRuns(positions, new Float32Array([0.4, 1.0]), new Uint8Array([1, 1]), new Uint16Array([0, 0]));
	assert.deepEqual(runs, [{ start: 0, end: 1 }, { start: 1, end: 2 }]);
});

test("a near-straight bend within tolerance stays merged; beyond it splits", () => {
	// ~0.57° turn (within the ~1.1° tol) then ~2.9° turn (beyond it)
	const positions = pos([
		[0, 0, 0, 10, 0, 0],
		[10, 0, 0, 20, 0.1, 0], // atan(0.1/10) ≈ 0.57°
		[20, 0.1, 0, 30, 0.6, 0], // atan(0.5/10) ≈ 2.86° from previous
	]);
	const runs = mergeExtrudingRuns(positions, new Float32Array([0.4, 0.4, 0.4]), new Uint8Array([1, 1, 1]), new Uint16Array([0, 0, 0]));
	assert.deepEqual(runs, [{ start: 0, end: 2 }, { start: 2, end: 3 }]);
});

test("empty toolpath yields no runs", () => {
	assert.deepEqual(mergeExtrudingRuns(new Float32Array(0), new Float32Array(0), new Uint8Array(0), new Uint16Array(0)), []);
});

test("all-travel toolpath yields no runs", () => {
	const positions = pos([[0, 0, 0, 1, 0, 0], [1, 0, 0, 2, 0, 0]]);
	assert.deepEqual(mergeExtrudingRuns(positions, new Float32Array([0.1, 0.1]), new Uint8Array([0, 0]), new Uint16Array([0, 0])), []);
});
