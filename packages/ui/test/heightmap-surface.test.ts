import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleGrid, sampleGridCubic, gridExtent, terrainColor, renderSurface } from "../src/heightmap/surface.ts";

const GRID = [
	[0, 10],
	[20, 30],
];

test("sampling an exact grid point returns that point", () => {
	assert.equal(sampleGrid(GRID, 0, 0), 0);
	assert.equal(sampleGrid(GRID, 1, 0), 10);
	assert.equal(sampleGrid(GRID, 0, 1), 20);
	assert.equal(sampleGrid(GRID, 1, 1), 30);
});

test("sampling between points interpolates both ways", () => {
	assert.equal(sampleGrid(GRID, 0.5, 0), 5, "along the columns");
	assert.equal(sampleGrid(GRID, 0, 0.5), 10, "along the rows");
	assert.equal(sampleGrid(GRID, 0.5, 0.5), 15, "the centre is the mean of four corners");
});

test("sampling outside the grid clamps rather than extrapolating", () => {
	// Extrapolating would invent bed shape beyond the probed area.
	assert.equal(sampleGrid(GRID, -5, -5), 0);
	assert.equal(sampleGrid(GRID, 99, 99), 30);
});

test("an empty grid samples to zero rather than throwing", () => {
	assert.equal(sampleGrid([], 0, 0), 0);
	assert.equal(sampleGrid([[]], 0, 0), 0);
});

test("extent is the largest absolute deviation, either sign", () => {
	assert.equal(gridExtent([[-0.105, 0.05]]), 0.105);
	assert.equal(gridExtent([[0.02, 0.15]]), 0.15);
});

test("an all-zero grid still yields a usable extent", () => {
	// Zero would make every colour a division by zero.
	assert.equal(gridExtent([[0, 0]]), 1);
});

test("the colour ramp is diverging: equal-and-opposite errors are equally strong", () => {
	const extent = 0.1;
	const below = terrainColor(-0.1, extent);
	const above = terrainColor(0.1, extent);
	const level = terrainColor(0, extent);
	assert.notDeepEqual(below, above, "sign must be visible");
	// Both extremes must be far from the neutral midpoint, and by a similar
	// amount — that is what "diverging" means.
	const dist = (a: typeof level, b: typeof level): number =>
		Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
	const dBelow = dist(below, level);
	const dAbove = dist(above, level);
	assert.ok(dBelow > 60 && dAbove > 60, `distances ${dBelow} / ${dAbove}`);
	assert.ok(Math.abs(dBelow - dAbove) / Math.max(dBelow, dAbove) < 0.45, "roughly balanced");
});

test("the ramp clamps beyond the extent instead of running off the scale", () => {
	assert.deepEqual(terrainColor(5, 0.1), terrainColor(0.1, 0.1));
	assert.deepEqual(terrainColor(-5, 0.1), terrainColor(-0.1, 0.1));
});

// --- orientation: the one that silently draws a wrong bed ---

test("the surface is flipped so row 0 renders at the BOTTOM", () => {
	// Grid row 0 is the lowest axis1 (front of the bed); screen y grows downward.
	// Getting this wrong draws the bed upside down and looks entirely plausible.
	const rows = [[0, 0], [100, 100]]; // row 0 = 0, row 1 = 100
	const px = renderSurface(rows, 2, 2, 100);
	const at = (x: number, y: number) => px[(y * 2 + x) * 4]!;
	const top = at(0, 0);
	const bottom = at(0, 1);
	assert.ok(top !== bottom, "the two rows must differ");
	// Row 1 (value 100, above plane) must be at the TOP of the image.
	const warmAtTop = terrainColor(100, 100).r;
	assert.equal(top, warmAtTop, "the high row belongs at the top");
});

test("the surface is not mirrored left-to-right", () => {
	const rows = [[0, 100]]; // col 0 = 0, col 1 = 100
	const px = renderSurface(rows, 2, 1, 100);
	const left = px[0]!;
	const right = px[4]!;
	assert.equal(right, terrainColor(100, 100).r, "the high column belongs on the right");
	assert.notEqual(left, right);
});

test("every rendered pixel is opaque", () => {
	const px = renderSurface(GRID, 4, 4, 30);
	for (let i = 3; i < px.length; i += 4) assert.equal(px[i], 255);
});

test("a degenerate size renders nothing rather than throwing", () => {
	assert.equal(renderSurface(GRID, 0, 0, 1).length, 0);
});

// --- bicubic sampling ---

test("bicubic passes exactly through every probe point", () => {
	// Interpolating, not approximating: a smoothed surface that shifted the
	// measured values would be drawing something the machine never reported.
	const rows = [[0, 0.1, -0.2], [0.05, -0.3, 0.2], [-0.1, 0.4, 0]];
	for (let r = 0; r < rows.length; r++) {
		for (let c = 0; c < rows[0]!.length; c++) {
			assert.ok(
				Math.abs(sampleGridCubic(rows, c, r) - rows[r]![c]!) < 1e-12,
				`(${r},${c}) must return its own value`,
			);
		}
	}
});

test("bicubic clamps outside the grid instead of extrapolating", () => {
	const rows = [[0, 1], [2, 3]];
	assert.equal(sampleGridCubic(rows, -5, -5), 0);
	assert.equal(sampleGridCubic(rows, 99, 99), 3);
});

test("bicubic is smoother than bilinear across a sample line", () => {
	// A ridge: bilinear puts a crease exactly at the middle column, so its slope
	// jumps there. Catmull-Rom carries a continuous slope across it.
	const rows = [[0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0]];
	// One-sided slopes: sampled STRICTLY either side of col 2, so neither
	// straddles the sample line (which was the flaw in the first version of
	// this test — both windows spanned it and measured the same thing).
	const slopeLeft = (f: (g: number[][], c: number, r: number) => number): number =>
		(f(rows, 1.99, 1) - f(rows, 1.97, 1)) / 0.02;
	const slopeRight = (f: (g: number[][], c: number, r: number) => number): number =>
		(f(rows, 2.03, 1) - f(rows, 2.01, 1)) / 0.02;
	const linJump = Math.abs(slopeRight(sampleGrid) - slopeLeft(sampleGrid));
	const cubJump = Math.abs(slopeRight(sampleGridCubic) - slopeLeft(sampleGridCubic));
	assert.ok(linJump > 0.5, `bilinear should crease at the ridge, jump was ${linJump}`);
	assert.ok(cubJump < linJump / 10, `cubic should not crease, jump was ${cubJump}`);
});
