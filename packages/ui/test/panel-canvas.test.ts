import { test } from "node:test";
import assert from "node:assert/strict";
import {
	GRID_COLS, clampRect, rectsOverlap, collidesWithAny, hasCollisions, inBounds,
	tryMove, tryResize, defaultCanvas, parseStoredCanvas, serializeCanvas, mergeCanvas,
} from "../src/shell/panelCanvas.ts";

const rect = (col: number, row: number, colSpan: number, rowSpan: number) => ({ col, row, colSpan, rowSpan });

test("clampRect clamps span/position into bounds and falls back to safe values on non-finite input", () => {
	assert.deepEqual(clampRect(rect(0, 0, 1, 1)), rect(0, 0, 1, 1));
	assert.deepEqual(clampRect(rect(GRID_COLS - 4, 0, 10, 1)), rect(GRID_COLS - 10, 0, 10, 1), "col pulled back so col+colSpan stays <= GRID_COLS");
	assert.deepEqual(clampRect(rect(0, 0, GRID_COLS + 6, 1)), rect(0, 0, GRID_COLS, 1), "colSpan clamped to GRID_COLS");
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
	assert.equal(tryMove(state, "a", GRID_COLS - 2, 0), null, "col + colSpan > GRID_COLS, out of bounds");
	assert.equal(tryMove(state, "a", 0, -3), null, "negative row rejected outright, not clamped");
	assert.equal(tryMove(state, "ghost", 0, 0), null, "unknown id");
});

test("tryMove rounds fractional candidates and falls back to the panel's current position on non-finite input", () => {
	const state = { a: rect(0, 0, 4, 4) };
	assert.deepEqual(tryMove(state, "a", 5.4, 5.6), rect(5, 6, 4, 4), "fractional pixel-delta math rounds to whole cells");
	assert.deepEqual(tryMove(state, "a", Number.NaN, 2), rect(0, 2, 4, 4), "non-finite col falls back to the panel's current col");
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
	assert.deepEqual(tryResize(state, "a", GRID_COLS + 6, 4), rect(0, 0, GRID_COLS, 4), "colSpan can't exceed GRID_COLS even with open space");
});

test("defaultCanvas orders by the defaults array and clamps each rect", () => {
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: 4, rowSpan: 4 }, { id: "b", col: GRID_COLS + 6, row: 0, colSpan: 4, rowSpan: 4 }];
	const canvas = defaultCanvas(defaults);
	assert.deepEqual(canvas.a, rect(0, 0, 4, 4));
	assert.deepEqual(canvas.b, rect(GRID_COLS - 4, 0, 4, 4), "out-of-bounds default col gets clamped");
});

test("parseStoredCanvas tolerates missing or corrupt storage", () => {
	assert.equal(parseStoredCanvas(null), null);
	assert.equal(parseStoredCanvas(""), null);
	assert.equal(parseStoredCanvas("{not json"), null);
});

test("parseStoredCanvas migrates a legacy unwrapped canvas: columns doubled AND rows regranulated", () => {
	// Rows moved from a 30px pitch (24px row + 6px gap) to 4px, so an edge at
	// row r lands at round(r * 30 / 4).
	const legacy = JSON.stringify({ a: rect(2, 3, 4, 5), b: { not: "a rect" } });
	assert.deepEqual(parseStoredCanvas(legacy), { a: rect(4, 23, 8, 37), b: { not: "a rect" } });
});

/**
 * The grid's whole contract is that panels never overlap. Migration converts
 * edge-wise for exactly this reason: scaling row and rowSpan independently
 * would round each to its own nearest cell, so two panels that were touching
 * could round INTO each other. This asserts the property directly.
 */
test("row migration never turns adjacent panels into overlapping ones", () => {
	// A sits directly on top of B, sharing an edge, at every odd span where
	// naive independent rounding is most likely to drift.
	for (let span = 1; span <= 12; span++) {
		const stored = JSON.stringify({ v: 2, state: {
			a: rect(0, 0, 4, span),
			b: rect(0, span, 4, span),
		} });
		const out = parseStoredCanvas(stored) as Record<string, { row: number; rowSpan: number }>;
		assert.equal(
			out.a!.row + out.a!.rowSpan,
			out.b!.row,
			`span ${span}: B must start exactly where A ends - no gap, no overlap`,
		);
	}
});

test("parseStoredCanvas does not re-migrate a canvas already carrying the current version envelope", () => {
	const current = JSON.stringify({ v: 3, state: { a: rect(2, 3, 4, 5) } });
	assert.deepEqual(parseStoredCanvas(current), { a: rect(2, 3, 4, 5) });
});

test("a v2 envelope still gets the row regranulation, but not the column doubling", () => {
	const v2 = JSON.stringify({ v: 2, state: { a: rect(2, 3, 4, 5) } });
	assert.deepEqual(parseStoredCanvas(v2), { a: rect(2, 23, 4, 37) });
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
	const stored = { a: rect(0, 3, GRID_COLS + 6, 2) };
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

test("mergeCanvas KEEPS a stored layout whose rects overlap (audit residual closed)", () => {
	// Hidden cards (visibleWhen false) release their cells, so a visible
	// card resized into that space stores a legal overlap. The old verdict
	// treated this as corruption and reset the ENTIRE layout on every
	// mount — the "card sizes not remembered" bug.
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: 4, rowSpan: 4 }, { id: "b", col: 10, row: 0, colSpan: 4, rowSpan: 4 }];
	const stored = { a: rect(0, 0, 4, 4), b: rect(1, 1, 4, 4) }; // b overlaps a (b may be hidden)
	assert.deepEqual(mergeCanvas(stored, defaults), { a: rect(0, 0, 4, 4), b: rect(1, 1, 4, 4) });
});

test("serializeCanvas round-trips through parseStoredCanvas and mergeCanvas", () => {
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: 4, rowSpan: 4 }];
	const canvas = defaultCanvas(defaults);
	assert.deepEqual(mergeCanvas(parseStoredCanvas(serializeCanvas(canvas)), defaults), canvas);
});

// Every screen's layout is asserted in composition.test.ts against its
// composed screen — the per-view defaults files the old per-view tests
// checked were deleted in the A3–A6 conversions.

// ---- audit H6: slot adoption obeys the collision contract like a drag ----

test("ensureSlot never persists an overlap - a colliding adoption is re-placed", async () => {
	const { createPanelCanvas, findFreePosition } = await import("../src/shell/panelCanvas.ts");
	const canvas = createPanelCanvas("dwc-ng.canvas.test-h6", [
		{ id: "a", ...rect(0, 0, 12, 40) },
	]);
	// Adopt a slot whose requested rect sits exactly on top of "a" - the
	// divergent-tiers case that used to persist an overlap and cost the
	// user their whole stored layout at the next mount.
	canvas.ensureSlot("b", rect(0, 0, 12, 40));
	const style = canvas.styleFor("b");
	assert.notDeepEqual(style, {}, "the slot was adopted");
	assert.deepEqual(
		{ col: style["grid-column"], row: style["grid-row"] },
		{ col: `${12 + 1} / span 12`, row: `${0 + 1} / span 40` },
		"re-placed to the first free spot (beside the occupant), never onto it",
	);
	// A non-colliding adoption keeps its requested rect exactly.
	canvas.ensureSlot("c", rect(24, 0, 12, 40));
	assert.equal(canvas.styleFor("c")["grid-column"], `${24 + 1} / span 12`);
	assert.equal(canvas.styleFor("c")["grid-row"], `${0 + 1} / span 40`);
	void findFreePosition;
});

// ---- resolveMove: a blocked diagonal component slides instead of freezing ----

test("resolveMove: the pointer's own cell wins when valid (jump preserved)", async () => {
	const { resolveMove } = await import("../src/shell/panelCanvas.ts");
	const state = { a: rect(0, 0, 4, 4), wall: rect(0, 8, 48, 4) };
	// Target far beyond the full-width wall - the old hop-over still works.
	assert.deepEqual(resolveMove(state, "a", 0, 20), rect(0, 20, 4, 4));
});

test("resolveMove: a diagonal against the grid edge keeps its free component", async () => {
	const { resolveMove } = await import("../src/shell/panelCanvas.ts");
	const state = { a: rect(0, 5, 4, 4) };
	// Pointer pulls left (impossible, already at col 0) and down (fine):
	// the old tryMove rejected this outright and the card froze.
	assert.deepEqual(resolveMove(state, "a", -3, 15), rect(0, 15, 4, 4), "clamped to the edge, still moving down");
});

test("resolveMove: a diagonal against another card slides along it", async () => {
	const { resolveMove } = await import("../src/shell/panelCanvas.ts");
	const state = { a: rect(0, 0, 4, 10), b: rect(4, 0, 4, 10) };
	// a drags right (into b) and down: right stops at contact, down proceeds.
	assert.deepEqual(resolveMove(state, "a", 2, 6), rect(0, 6, 4, 10), "blocked axis stays, free axis tracks");
	// Once past b's bottom edge, the horizontal component resumes: the card
	// slides AROUND the corner in one resolution.
	assert.deepEqual(resolveMove(state, "a", 2, 10), rect(2, 10, 4, 10), "corner cleared, both axes land");
});

test("resolveMove: fully pinned means null, exactly like a rejected tryMove", async () => {
	const { resolveMove } = await import("../src/shell/panelCanvas.ts");
	const state = { a: rect(0, 0, 4, 4), right: rect(4, 0, 4, 4), below: rect(0, 4, 4, 4) };
	assert.equal(resolveMove(state, "a", 2, 2), null, "no axis can move; caller keeps the panel put");
	assert.equal(resolveMove(state, "ghost", 1, 1), null, "unknown id");
});

test("resolveMove: never expresses an overlap or an out-of-bounds rect", async () => {
	const { resolveMove, collidesWithAny, inBounds } = await import("../src/shell/panelCanvas.ts");
	const state = { a: rect(10, 10, 6, 6), b: rect(20, 4, 6, 20), c: rect(4, 20, 20, 4) };
	// Sweep a grid of drag targets; every resolution must be valid.
	for (let col = -8; col <= 52; col += 4) {
		for (let row = -4; row <= 40; row += 4) {
			const landed = resolveMove(state, "a", col, row);
			if (landed !== null) {
				assert.ok(inBounds(landed), `in bounds at target (${col},${row})`);
				assert.ok(!collidesWithAny(state, "a", landed), `collision-free at target (${col},${row})`);
			}
		}
	}
});

// ---- hiding a card remembers its position (and slides down if taken) ----

test("slideDownToFree keeps the column and drops the row until it fits", async () => {
	const { slideDownToFree } = await import("../src/shell/panelCanvas.ts");
	// Nothing in the way — returns the preferred rect unchanged.
	assert.deepEqual(slideDownToFree([], rect(12, 3, 12, 40)), rect(12, 3, 12, 40));
	// A blocker on the preferred spot: same column, next free row below it.
	const blocker = rect(12, 0, 12, 40); // rows 0..39 in column 12
	const placed = slideDownToFree([blocker], rect(12, 0, 12, 40));
	assert.equal(placed.col, 12, "column is preserved — never hops sideways");
	assert.equal(placed.row, 40, "slid straight down to just below the blocker");
});

const posOf = (canvas: { styleFor: (id: string) => Record<string, string> }, id: string) => {
	const s = canvas.styleFor(id);
	return { col: parseInt(s["grid-column"]!) - 1, row: parseInt(s["grid-row"]!) - 1 };
};

test("hiding a card then showing it restores its exact position", async () => {
	const { createPanelCanvas } = await import("../src/shell/panelCanvas.ts");
	const canvas = createPanelCanvas("dwc-ng.canvas.test-hide-restore", [
		{ id: "a", ...rect(0, 0, 12, 40) },
		{ id: "b", ...rect(12, 0, 12, 40) },
	]);
	canvas.removeSlot("b"); // hide
	assert.deepEqual(canvas.styleFor("b"), {}, "hidden — no slot rendered");
	// Show it with a DIFFERENT requested rect — the remembered spot must win.
	canvas.ensureSlot("b", rect(0, 100, 12, 40));
	assert.deepEqual(posOf(canvas, "b"), { col: 12, row: 0 }, "back where it was, not the requested rect");
});

test("showing a hidden card slides DOWN when its old spot is now taken", async () => {
	const { createPanelCanvas } = await import("../src/shell/panelCanvas.ts");
	const canvas = createPanelCanvas("dwc-ng.canvas.test-hide-slide", [
		{ id: "a", ...rect(0, 0, 12, 40) },
	]);
	canvas.removeSlot("a"); // hide a (remembered at 0,0 spanning rows 0..39)
	canvas.ensureSlot("blocker", rect(0, 0, 12, 40)); // something takes 0,0
	canvas.ensureSlot("a", rect(0, 0, 12, 40)); // show a again
	const p = posOf(canvas, "a");
	assert.equal(p.col, 0, "same column");
	assert.equal(p.row, 40, "slid straight down below the 40-tall blocker");
});

test("a remembered position survives a reload (persisted, card off the screen)", async () => {
	class MemStore {
		private m = new Map<string, string>();
		getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
		setItem(k: string, v: string) { this.m.set(k, String(v)); }
		removeItem(k: string) { this.m.delete(k); }
	}
	(globalThis as { localStorage?: unknown }).localStorage = new MemStore();
	try {
		const { createPanelCanvas } = await import("../src/shell/panelCanvas.ts");
		const key = "dwc-ng.canvas.test-parked-persist";
		const c1 = createPanelCanvas(key, [
			{ id: "a", ...rect(0, 0, 12, 40) },
			{ id: "b", ...rect(12, 0, 12, 40) },
		]);
		c1.removeSlot("b"); // hide — remembered rect persists to localStorage
		// "Reload": a fresh controller from the same key, with b NOT in defaults
		// (it's hidden, so it isn't in the composition any more).
		const c2 = createPanelCanvas(key, [{ id: "a", ...rect(0, 0, 12, 40) }]);
		c2.ensureSlot("b", rect(0, 200, 12, 40)); // show b again
		assert.deepEqual(posOf(c2, "b"), { col: 12, row: 0 }, "restored from the persisted parked store");
	} finally {
		delete (globalThis as { localStorage?: unknown }).localStorage;
	}
});
