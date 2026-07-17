import { test } from "node:test";
import assert from "node:assert/strict";
import {
	GRID_COLS, clampRect, rectsOverlap, collidesWithAny, hasCollisions, inBounds,
	tryMove, tryResize, settle, defaultCanvas, parseStoredCanvas, serializeCanvas, mergeCanvas,
} from "../src/shell/panelCanvas.ts";

const rect = (col: number, row: number, colSpan: number, rowSpan: number) => ({ col, row, colSpan, rowSpan });

test("clampRect clamps span/position into bounds and falls back to safe values on non-finite input", () => {
	assert.deepEqual(clampRect(rect(0, 0, 1, 1)), rect(0, 0, 1, 1));
	assert.deepEqual(clampRect(rect(20, 0, 10, 1)), rect(14, 0, 10, 1), "col pulled back so col+colSpan stays <= GRID_COLS");
	assert.deepEqual(clampRect(rect(0, 0, 30, 1)), rect(0, 0, GRID_COLS, 1), "colSpan clamped to GRID_COLS");
	assert.deepEqual(clampRect(rect(-5, -5, 1, 1)), rect(0, 0, 1, 1), "negative col/row clamp to 0");
	assert.deepEqual(clampRect(rect(0, 0, 0, 0)), rect(0, 0, 1, 1), "span below 1 clamps to 1");
	assert.deepEqual(clampRect({ col: Number.NaN, row: Number.NaN, colSpan: Number.NaN, rowSpan: Number.NaN }), rect(0, 0, 1, 1));
});

test("rectsOverlap detects overlap and touching-but-not-overlapping edges", () => {
	assert.equal(rectsOverlap(rect(0, 0, 2, 2), rect(1, 1, 2, 2)), true);
	assert.equal(rectsOverlap(rect(0, 0, 2, 2), rect(2, 0, 2, 2)), false, "touching edge, not overlapping");
	assert.equal(rectsOverlap(rect(0, 0, 2, 2), rect(0, 2, 2, 2)), false, "touching edge vertically");
	assert.equal(rectsOverlap(rect(0, 0, 5, 5), rect(1, 1, 1, 1)), true, "fully contained counts as overlap");
});

test("collidesWithAny ignores the panel's own id and checks every other panel", () => {
	const state = { a: rect(0, 0, 2, 2), b: rect(5, 5, 2, 2) };
	assert.equal(collidesWithAny(state, "a", rect(0, 0, 2, 2)), false, "a against its own unchanged rect, excluded");
	assert.equal(collidesWithAny(state, "a", rect(5, 5, 2, 2)), true, "a's candidate collides with b");
	assert.equal(collidesWithAny(state, "c", rect(0, 0, 2, 2)), true, "a new id c colliding with existing a");
});

test("hasCollisions scans every pair", () => {
	assert.equal(hasCollisions({ a: rect(0, 0, 2, 2), b: rect(5, 5, 2, 2) }), false);
	assert.equal(hasCollisions({ a: rect(0, 0, 2, 2), b: rect(1, 1, 2, 2) }), true);
	assert.equal(hasCollisions({}), false);
	assert.equal(hasCollisions({ a: rect(0, 0, 2, 2) }), false);
});

test("inBounds rejects negative col/row and columns past GRID_COLS", () => {
	assert.equal(inBounds(rect(0, 0, GRID_COLS, 1)), true);
	assert.equal(inBounds(rect(1, 0, GRID_COLS, 1)), false, "1 + 24 > GRID_COLS");
	assert.equal(inBounds(rect(-1, 0, 1, 1)), false);
	assert.equal(inBounds(rect(0, -1, 1, 1)), false);
	assert.equal(inBounds(rect(0, 1000, 1, 1)), true, "rows are unbounded above");
});

test("tryMove commits only when the target is in bounds and collision-free", () => {
	const state = { a: rect(0, 0, 4, 4), b: rect(10, 10, 4, 4) };
	assert.deepEqual(tryMove(state, "a", 5, 5), rect(5, 5, 4, 4), "free space, keeps a's own span");
	assert.equal(tryMove(state, "a", 10, 10), null, "would collide with b");
	assert.equal(tryMove(state, "a", 22, 0), null, "22 + 4 > GRID_COLS, out of bounds");
	assert.equal(tryMove(state, "a", 0, -3), null, "negative row rejected outright, not clamped");
	assert.equal(tryMove(state, "ghost", 0, 0), null, "unknown id");
});

test("tryResize grows one cell at a time and stops at the first collision", () => {
	const state = { a: rect(0, 0, 4, 4), blockerRight: rect(10, 0, 4, 4), blockerBelow: rect(0, 10, 4, 4) };
	assert.deepEqual(tryResize(state, "a", 8, 4), rect(0, 0, 8, 4), "grows freely up to the desired span");
	assert.deepEqual(tryResize(state, "a", 20, 4), rect(0, 0, 10, 4), "stopped by blockerRight at col 10");
	assert.deepEqual(tryResize(state, "a", 4, 20), rect(0, 0, 4, 10), "stopped by blockerBelow at row 10");
	assert.deepEqual(tryResize(state, "a", 1, 1), rect(0, 0, 1, 1), "shrinking is always safe, never blocked");
});

test("tryResize stops at the grid's column boundary when nothing else blocks it", () => {
	// No other panel in this state, so growth is limited purely by GRID_COLS,
	// not by a collision — isolates the boundary check from the collision check.
	const state = { a: rect(0, 0, 4, 4) };
	assert.deepEqual(tryResize(state, "a", 30, 4), rect(0, 0, GRID_COLS, 4), "colSpan can't exceed GRID_COLS even with open space");
});

test("settle rises then drifts left, processed in (row, col) order, only against already-settled panels", () => {
	// b sits directly below a with a gap; moving a away should let b rise into the freed space.
	const state = { a: rect(0, 10, 4, 4), b: rect(0, 20, 4, 4) };
	const settled = settle(state);
	assert.deepEqual(settled.a, rect(0, 0, 4, 4), "a rises to the top, nothing above it");
	assert.deepEqual(settled.b, rect(0, 4, 4, 4), "b rises to rest just below settled a, not through it");
});

test("settle drifts left after rising, stopping against an already-settled neighbor", () => {
	const state = { a: rect(0, 0, 4, 4), b: rect(10, 0, 4, 4) };
	const settled = settle(state);
	assert.deepEqual(settled.a, rect(0, 0, 4, 4));
	assert.deepEqual(settled.b, rect(4, 0, 4, 4), "b drifts left to rest against a, not through it");
});

test("defaultCanvas orders by the defaults array and clamps each rect", () => {
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: 4, rowSpan: 4 }, { id: "b", col: 30, row: 0, colSpan: 4, rowSpan: 4 }];
	const canvas = defaultCanvas(defaults);
	assert.deepEqual(canvas.a, rect(0, 0, 4, 4));
	assert.deepEqual(canvas.b, rect(20, 0, 4, 4), "out-of-bounds default col gets clamped");
});

test("parseStoredCanvas tolerates missing or corrupt storage", () => {
	assert.equal(parseStoredCanvas(null), null);
	assert.equal(parseStoredCanvas(""), null);
	assert.equal(parseStoredCanvas("{not json"), null);
});

test("mergeCanvas falls back to defaults when storage is corrupt, empty, or the wrong shape", () => {
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: 4, rowSpan: 4 }];
	assert.deepEqual(mergeCanvas(null, defaults), defaultCanvas(defaults));
	assert.deepEqual(mergeCanvas("a string", defaults), defaultCanvas(defaults));
	assert.deepEqual(mergeCanvas(42, defaults), defaultCanvas(defaults));
});

test("mergeCanvas keeps a valid stored rect for a known id, clamped", () => {
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: 4, rowSpan: 4 }];
	// col: 0 isolates the "colSpan itself exceeds GRID_COLS" clamp path from the
	// "col+colSpan exceeds GRID_COLS" repositioning path (clampRect always clamps
	// colSpan to GRID_COLS first, then pulls col back to fit — with col already
	// at 0 there's nothing left to reposition, so this purely exercises the span clamp).
	const stored = { a: rect(0, 3, 30, 2) };
	assert.deepEqual(mergeCanvas(stored, defaults).a, rect(0, 3, GRID_COLS, 2), "row/col kept, oversized colSpan clamped to GRID_COLS");
});

test("mergeCanvas drops a stored id no longer in defaults and defaults a new id missing from storage", () => {
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: 4, rowSpan: 4 }, { id: "b", col: 10, row: 0, colSpan: 4, rowSpan: 4 }];
	const stored = { a: rect(1, 1, 4, 4), ghost: rect(0, 0, 1, 1) };
	const merged = mergeCanvas(stored, defaults);
	assert.deepEqual(Object.keys(merged).sort(), ["a", "b"]);
	assert.deepEqual(merged.a, rect(1, 1, 4, 4));
	assert.deepEqual(merged.b, rect(10, 0, 4, 4), "b missing from storage, uses its own coded default");
});

test("mergeCanvas discards the whole stored layout, not just the offending panel, if the merged result collides", () => {
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: 4, rowSpan: 4 }, { id: "b", col: 10, row: 0, colSpan: 4, rowSpan: 4 }];
	const stored = { a: rect(0, 0, 4, 4), b: rect(1, 1, 4, 4) }; // b now overlaps a
	assert.deepEqual(mergeCanvas(stored, defaults), defaultCanvas(defaults));
});

test("serializeCanvas round-trips through parseStoredCanvas and mergeCanvas", () => {
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: 4, rowSpan: 4 }];
	const canvas = defaultCanvas(defaults);
	assert.deepEqual(mergeCanvas(parseStoredCanvas(serializeCanvas(canvas)), defaults), canvas);
});
