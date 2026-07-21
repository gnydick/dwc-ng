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

// The tolerance is a MILLIMETRE deviation bound, not an angle: what matters is
// how far the drawn chord strays from the real path, which is the guarantee the
// old per-step angle test could not make.
test("a bend whose chord error is within tolerance merges", () => {
	// Chord (0,0)→(20,0.05) passes 0.025mm from the corner at (10,0) — under 0.05.
	const positions = pos([
		[0, 0, 0, 10, 0, 0],
		[10, 0, 0, 20, 0.05, 0],
	]);
	const runs = mergeExtrudingRuns(positions, new Float32Array([0.4, 0.4]), new Uint8Array([1, 1]), new Uint16Array([0, 0]));
	assert.deepEqual(runs, [{ start: 0, end: 2 }]);
});

test("a bend whose chord error exceeds tolerance splits", () => {
	// Chord (0,0)→(20,0.4) passes 0.2mm from the corner at (10,0) — over 0.05.
	const positions = pos([
		[0, 0, 0, 10, 0, 0],
		[10, 0, 0, 20, 0.4, 0],
	]);
	const runs = mergeExtrudingRuns(positions, new Float32Array([0.4, 0.4]), new Uint8Array([1, 1]), new Uint16Array([0, 0]));
	assert.deepEqual(runs, [{ start: 0, end: 1 }, { start: 1, end: 2 }]);
});

test("a long gentle arc is NOT collapsed into one chord (the old faceting bug)", () => {
	// 40 steps around a 50mm radius: every consecutive turn is tiny, so the old
	// per-step angle test merged the lot and drew one straight box across the
	// whole arc. The mm bound must refuse that.
	const segs: number[][] = [];
	const r = 50, n = 40;
	for (let i = 0; i < n; i++) {
		const a = (i / n) * (Math.PI / 2), b = ((i + 1) / n) * (Math.PI / 2);
		segs.push([r * Math.cos(a), r * Math.sin(a), 0, r * Math.cos(b), r * Math.sin(b), 0]);
	}
	const runs = mergeExtrudingRuns(
		pos(segs), new Float32Array(n).fill(0.4), new Uint8Array(n).fill(1), new Uint16Array(n),
	);
	assert.ok(runs.length > 1, `a 90° arc must not collapse to one box, got ${runs.length}`);
});

test("empty toolpath yields no runs", () => {
	assert.deepEqual(mergeExtrudingRuns(new Float32Array(0), new Float32Array(0), new Uint8Array(0), new Uint16Array(0)), []);
});

test("all-travel toolpath yields no runs", () => {
	const positions = pos([[0, 0, 0, 1, 0, 0], [1, 0, 0, 2, 0, 0]]);
	assert.deepEqual(mergeExtrudingRuns(positions, new Float32Array([0.1, 0.1]), new Uint8Array([0, 0]), new Uint16Array([0, 0])), []);
});
