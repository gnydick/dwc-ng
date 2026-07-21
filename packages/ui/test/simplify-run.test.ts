import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveAreas, simplifyIndices, maxDeviationMm } from "../src/gcode/simplifyRun.ts";

/** Build a flat polyline from [x,y] pairs (z = 0). */
const poly = (pts: Array<[number, number]>): Float32Array =>
	Float32Array.from(pts.flatMap(([x, y]) => [x, y, 0]));

/** Points on a circular arc of radius r, `n` samples spanning `sweepDeg`. */
function arc(r: number, n: number, sweepDeg = 90): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	for (let i = 0; i < n; i++) {
		const t = (i / (n - 1)) * (sweepDeg * Math.PI / 180);
		out.push([r * Math.cos(t), r * Math.sin(t)]);
	}
	return out;
}

test("effectiveAreas: endpoints are infinite, collinear interior points are zero", () => {
	const areas = effectiveAreas(poly([[0, 0], [1, 0], [2, 0], [3, 0]]));
	assert.equal(areas.length, 4);
	assert.equal(areas[0], Infinity, "first point is never removable");
	assert.equal(areas[3], Infinity, "last point is never removable");
	assert.equal(areas[1], 0);
	assert.equal(areas[2], 0);
});

test("effectiveAreas ranks a bigger deviation as more important", () => {
	//         (1,2) big spike            (1,0.1) small wobble
	const big = effectiveAreas(poly([[0, 0], [1, 2], [2, 0]]))[1]!;
	const small = effectiveAreas(poly([[0, 0], [1, 0.1], [2, 0]]))[1]!;
	assert.ok(big > small, `expected ${big} > ${small}`);
});

test("a perfectly straight run collapses to its endpoints", () => {
	const pts = poly([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]);
	assert.deepEqual([...simplifyIndices(pts, 0.001)], [0, 4]);
});

test("simplifyIndices always keeps the endpoints and stays ordered", () => {
	const pts = poly(arc(50, 40));
	const kept = simplifyIndices(pts, 0.05);
	assert.equal(kept[0], 0);
	assert.equal(kept.at(-1), 39);
	for (let i = 1; i < kept.length; i++) assert.ok(kept[i]! > kept[i - 1]!, "indices ascend");
});

test("a real curve is NOT flattened to a single chord (the 5° faceting bug)", () => {
	// 90° arc, r=50 — the case that collapsed into one straight box before.
	const pts = poly(arc(50, 60));
	const kept = simplifyIndices(pts, 0.05);
	assert.ok(kept.length > 2, `a 90° arc must keep interior points, got ${kept.length}`);
});

test("DEVIATION BOUND: output never deviates more than the tolerance (the acceptance test)", () => {
	// This is the guarantee we actually care about, asserted on the OUTPUT —
	// so it stays valid whichever simplifier produces it.
	for (const tol of [0.01, 0.05, 0.2]) {
		for (const pts of [poly(arc(50, 80)), poly(arc(5, 80)), poly(arc(200, 120, 30))]) {
			const kept = simplifyIndices(pts, tol);
			const dev = maxDeviationMm(pts, kept);
			assert.ok(dev <= tol + 1e-6, `tol ${tol}: deviation ${dev} exceeded bound`);
		}
	}
});

test("a looser tolerance keeps strictly fewer points (the ghost/opaque knob)", () => {
	const pts = poly(arc(50, 200));
	const tight = simplifyIndices(pts, 0.02).length;
	const loose = simplifyIndices(pts, 0.5).length;
	assert.ok(loose < tight, `loose ${loose} should keep fewer than tight ${tight}`);
});

test("maxDeviationMm measures the chord error it claims to", () => {
	// Midpoint 1mm off the line between (0,0) and (2,0); dropping it costs 1mm.
	const pts = poly([[0, 0], [1, 1], [2, 0]]);
	assert.ok(Math.abs(maxDeviationMm(pts, Uint32Array.from([0, 2])) - 1) < 1e-6);
	assert.equal(maxDeviationMm(pts, Uint32Array.from([0, 1, 2])), 0, "keeping every point is lossless");
});
