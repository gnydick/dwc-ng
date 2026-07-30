import { test } from "node:test";
import assert from "node:assert/strict";
import {
	GRID_COLS, clampRect, rectsOverlap, collidesWithAny, hasCollisions, inBounds,
	tryMove, tryResize, defaultCanvas, parseStoredCanvas, serializeCanvas, mergeCanvas,
	clampToStop, growToDefaults, reflow,
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

test("parseStoredCanvas migrates a legacy unwrapped canvas through EVERY later migration", () => {
	// Rows moved from a 30px pitch (24px row + 6px gap) to 4px, so an edge at
	// row r lands at round(r * 30 / 4). Columns doubled (24 -> 48) and then went
	// from a 52px pitch to 4px, another x13: col 2 -> 4 -> 52.
	const legacy = JSON.stringify({ a: rect(2, 3, 4, 5), b: { not: "a rect" } });
	assert.deepEqual(parseStoredCanvas(legacy), { a: rect(52, 23, 104, 37), b: { not: "a rect" } });
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
	const current = JSON.stringify({ v: 4, state: { a: rect(2, 3, 4, 5) } });
	assert.deepEqual(parseStoredCanvas(current), { a: rect(2, 3, 4, 5) });
});

/**
 * 52 is exactly 13 new cells, so col and colSpan scale independently and
 * adjacency survives by arithmetic — no rounding, so no pair of touching cards
 * can round into each other the way the ROW migration had to guard against.
 */
test("a v3 envelope gets the column regranulation and nothing else", () => {
	const v3 = JSON.stringify({ v: 3, state: { a: rect(2, 3, 4, 5), b: rect(6, 3, 4, 5) } });
	// a ended at col 6, where b began. It still does: 26 + 52 === 78.
	assert.deepEqual(parseStoredCanvas(v3), { a: rect(26, 3, 52, 5), b: rect(78, 3, 52, 5) });
});

test("a v2 envelope gets both regranulations, but not the column doubling", () => {
	const v2 = JSON.stringify({ v: 2, state: { a: rect(2, 3, 4, 5) } });
	assert.deepEqual(parseStoredCanvas(v2), { a: rect(26, 23, 52, 37) });
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
	// rowSpan stays at or above the coded default (4) so this stays a pure
	// clamp test: a smaller stored rowSpan would additionally trip
	// growToDefaults and confuse which rule produced the result.
	const stored = { a: rect(0, 3, GRID_COLS + 6, 4) };
	assert.deepEqual(mergeCanvas(stored, defaults).a, rect(0, 3, GRID_COLS, 4), "row/col kept, oversized colSpan clamped to GRID_COLS");
});

test("mergeCanvas drops a stored id no longer in defaults and defaults a new id missing from storage", () => {
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: 4, rowSpan: 4 }, { id: "b", col: 10, row: 0, colSpan: 4, rowSpan: 4 }];
	const stored = { a: rect(1, 1, 4, 4), ghost: rect(0, 0, 1, 1) };
	const merged = mergeCanvas(stored, defaults);
	assert.deepEqual(Object.keys(merged).sort(), ["a", "b"]);
	assert.deepEqual(merged.a, rect(1, 1, 4, 4));
	assert.deepEqual(merged.b, rect(10, 0, 4, 4), "b missing from storage, uses its own coded default");
});

test("a newly-added default card is placed clear of the stored layout, not on top of it", () => {
	// The bug this pins (2026-07-29): two colour cards added to Settings took
	// their coded row, which a saved canvas already had occupied, so they
	// rendered UNDERNEATH an existing card — invisible, with Reset Layout the
	// only way to reach them. Coded positions are chosen against the coded
	// layout; a stored layout is a different world.
	const defaults = [
		{ id: "old", col: 0, row: 0, colSpan: 12, rowSpan: 40 },
		{ id: "new", col: 0, row: 0, colSpan: 12, rowSpan: 20 }, // coded to the SAME spot
	];
	// The user dragged "old" down to row 10; "new" has never been seen here.
	const merged = mergeCanvas({ old: rect(0, 10, 12, 40) }, defaults);
	assert.deepEqual(merged.old, rect(0, 10, 12, 40), "an existing card must not be moved to make room");
	assert.equal(rectsOverlap(merged.new!, merged.old!), false, "the new card must not land on an occupied cell");
	assert.equal(merged.new!.col, 0, "slideDownToFree keeps the coded column");
});

test("two cards added at once are placed against each other, not just against storage", () => {
	// Both are new and both are coded to col 0 row 0. Placing them
	// independently would stack them on each other.
	const defaults = [
		{ id: "kept", col: 0, row: 0, colSpan: 24, rowSpan: 10 },
		{ id: "newA", col: 0, row: 0, colSpan: 12, rowSpan: 20 },
		{ id: "newB", col: 12, row: 0, colSpan: 12, rowSpan: 20 },
	];
	const merged = mergeCanvas({ kept: rect(0, 0, 24, 10) }, defaults);
	assert.equal(rectsOverlap(merged.newA!, merged.newB!), false, "the two newcomers must not overlap each other");
	assert.equal(rectsOverlap(merged.newA!, merged.kept!), false);
	assert.equal(rectsOverlap(merged.newB!, merged.kept!), false);
	assert.equal(merged.newA!.col, 0, "each keeps its coded column so a designed pair stays side by side");
	assert.equal(merged.newB!.col, 12);
});

test("adding a card does not reflow the cards the user already placed", () => {
	// A newcomer is not a redesign of the screen. reflow() is reserved for a
	// card whose SPAN grew, which genuinely invalidates its neighbours.
	const defaults = [
		{ id: "a", col: 0, row: 0, colSpan: 12, rowSpan: 10 },
		{ id: "b", col: 0, row: 0, colSpan: 12, rowSpan: 10 },
		{ id: "fresh", col: 0, row: 0, colSpan: 12, rowSpan: 10 },
	];
	// a and b are stored overlapping (legal — one may be hidden).
	const stored = { a: rect(0, 0, 12, 10), b: rect(1, 1, 12, 10) };
	const merged = mergeCanvas(stored, defaults);
	assert.deepEqual(merged.a, rect(0, 0, 12, 10), "stored overlap must survive a card being added");
	assert.deepEqual(merged.b, rect(1, 1, 12, 10));
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

// --- growToDefaults: a STORED size is the operator's, in BOTH directions ---

test("growToDefaults keeps a stored span SMALLER than the coded default", () => {
	// This used to adopt the coded 103 via Math.max, so a card could never be
	// made shorter than its default across a reload: shrink it, reload, and it
	// sprang back — growing was remembered, shrinking was not (reported
	// 2026-07-30, Tools & heaters held at rowSpan 77 against a coded 110).
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: 12, rowSpan: 103 }];
	const { state, grew } = growToDefaults({ a: rect(3, 95, 12, 95) }, defaults);
	assert.deepEqual(state.a, rect(3, 95, 12, 95), "stored span kept, col/row untouched");
	assert.equal(grew, false, "adopting nothing means there is nothing to reflow around");
});

test("growToDefaults keeps a user-enlarged span and reports no growth", () => {
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: 12, rowSpan: 40 }];
	const { state, grew } = growToDefaults({ a: rect(0, 0, 24, 90) }, defaults);
	assert.deepEqual(state.a, rect(0, 0, 24, 90), "bigger stored spans win");
	assert.equal(grew, false, "nothing grew, so no reflow may be triggered");
});

test("growToDefaults takes BOTH axes from storage, smaller or larger", () => {
	// Mixed: narrower than the coded default on one axis, taller on the other.
	// Both are the operator's, so both survive.
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: 20, rowSpan: 10 }];
	const { state } = growToDefaults({ a: rect(0, 0, 8, 50) }, defaults);
	assert.deepEqual(state.a, rect(0, 0, 8, 50), "stored wins on both axes");
});

test("growToDefaults defaults unknown/invalid stored entries and drops stale ids", () => {
	const defaults = [
		{ id: "a", col: 1, row: 2, colSpan: 4, rowSpan: 4 },
		{ id: "b", col: 9, row: 0, colSpan: 4, rowSpan: 4 },
	];
	const { state, grew } = growToDefaults({ a: "junk", ghost: rect(0, 0, 1, 1) }, defaults);
	assert.deepEqual(Object.keys(state).sort(), ["a", "b"]);
	assert.deepEqual(state.a, rect(1, 2, 4, 4));
	// A card placed at its coded default was never sized by this browser at
	// all. Counting that as growth would make ADDING a card to a screen reflow
	// every card already on it.
	assert.equal(grew, false, "falling back to a default is placement, not growth");
});

test("growToDefaults clamps a span grown past the grid", () => {
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: GRID_COLS, rowSpan: 4 }];
	const { state } = growToDefaults({ a: rect(40, 0, 4, 4) }, defaults);
	assert.equal(state.a!.col + state.a!.colSpan <= GRID_COLS, true, "clampRect pulls col back into bounds");
});

// --- reflow: push right or down, whichever is fewer grid cells ---

test("reflow pushes a flush neighbour DOWN when down is fewer cells (the 2026-07-24 case)", () => {
	// position grew 95 -> 103 with the card below sitting flush at row 190:
	// down = (95+103)-190 = 8 cells, right = (0+24)-0 = 24 cells. Down wins.
	const out = reflow({ pos: rect(0, 95, 24, 103), below: rect(0, 190, 24, 40) });
	assert.deepEqual(out.pos, rect(0, 95, 24, 103), "the grown card never moves");
	assert.deepEqual(out.below, rect(0, 198, 24, 40), "pushed down by exactly the penetration");
});

test("reflow pushes a side neighbour RIGHT when right is fewer cells", () => {
	// a grew 8 -> 12 wide: right = (0+12)-8 = 4 cells, down = (0+40)-0 = 40.
	const out = reflow({ a: rect(0, 0, 12, 40), b: rect(8, 0, 6, 40) });
	assert.deepEqual(out.a, rect(0, 0, 12, 40));
	assert.deepEqual(out.b, rect(12, 0, 6, 40), "slid right to a's edge");
});

test("reflow falls back to DOWN when the push right would leave the grid", () => {
	const out = reflow({ a: rect(0, 0, GRID_COLS, 20), b: rect(0, 10, GRID_COLS, 20) });
	assert.deepEqual(out.b, rect(0, 20, GRID_COLS, 20), "no room to the right of a full-width card");
	assert.equal(hasCollisions(out), false);
});

test("reflow cascades into a third card", () => {
	const out = reflow({ a: rect(0, 0, 24, 60), b: rect(0, 40, 24, 40), c: rect(0, 80, 24, 40) });
	assert.equal(hasCollisions(out), false, "every displacement resolved, not just the first");
	assert.equal(out.b!.row >= 60 || out.b!.col >= 24, true, "b cleared a");
});

test("reflow leaves an already-clean layout exactly as it found it", () => {
	const clean = { a: rect(0, 0, 24, 40), b: rect(24, 0, 24, 40), c: rect(0, 40, 48, 20) };
	assert.deepEqual(reflow(clean), clean);
});

test("reflow is idempotent and always terminates collision-free", () => {
	const messy = {
		a: rect(0, 0, 20, 50), b: rect(5, 10, 20, 50),
		c: rect(10, 20, 20, 50), d: rect(2, 5, 30, 30),
	};
	const once = reflow(messy);
	// The red check: this line fails outright if reflow is ever stubbed to a
	// no-op or the push loop stops early.
	assert.equal(hasCollisions(once), false, "four mutually overlapping cards all resolved");
	assert.deepEqual(reflow(once), once, "running it on its own output changes nothing");
});

test("reflow is deterministic regardless of key insertion order", () => {
	const a = rect(0, 0, 20, 50), b = rect(5, 10, 20, 50), c = rect(10, 20, 20, 50);
	assert.deepEqual(reflow({ a, b, c }), reflow({ c, b, a }));
});

// --- the gate: reflow runs only when a span actually grew ---

test("mergeCanvas returns a stored arrangement exactly as it was", () => {
	// The counterpart: nothing is adopted from the coded sizes, so nothing is
	// displaced either. A reload gives back the screen the operator arranged,
	// not a re-packed approximation of it.
	const defaults = [
		{ id: "a", col: 0, row: 0, colSpan: 24, rowSpan: 103 },
		{ id: "b", col: 0, row: 95, colSpan: 24, rowSpan: 40 },
	];
	const merged = mergeCanvas({ a: rect(0, 0, 24, 95), b: rect(0, 95, 24, 40) }, defaults);
	assert.deepEqual(merged.a, rect(0, 0, 24, 95), "stored span kept");
	assert.deepEqual(merged.b, rect(0, 95, 24, 40), "neighbour not pushed");
	assert.equal(hasCollisions(merged), false);
});

test("mergeCanvas still KEEPS a legal overlap when nothing grew (hidden-card guard)", () => {
	// Same fixture as the audit-residual test above: every stored span equals
	// its default, so grew is false and the hidden-card overlap must survive.
	const defaults = [
		{ id: "a", col: 0, row: 0, colSpan: 4, rowSpan: 4 },
		{ id: "b", col: 10, row: 0, colSpan: 4, rowSpan: 4 },
	];
	const stored = { a: rect(0, 0, 4, 4), b: rect(1, 1, 4, 4) };
	assert.deepEqual(mergeCanvas(stored, defaults), stored);
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

// --- content-fit hard stop (the gold limit) ----------------------------------
// clampToStop is the pure half of the resize physics: the card's content fit is
// a WALL — the edge stops there and cannot be pulled through, on either axis.
// The DOM-measuring halves (contentRowSpan / contentColSpan) need a real
// element, so they are exercised live in the browser, not here.
const MIN = 20; // stand-in content-fit minimum, in cells

test("clampToStop passes a card larger than its content straight through", () => {
	assert.deepEqual(clampToStop(MIN + 5, MIN), { span: MIN + 5, atLimit: false });
});

test("clampToStop at exactly the content fit is not yet at the limit (boundary is >=)", () => {
	assert.deepEqual(clampToStop(MIN, MIN), { span: MIN, atLimit: false },
		"resting exactly on the fit is not the same as being pushed against it");
});

/**
 * The whole point of the change from a detent: however hard you pull, the span
 * never goes below the fit. The old version released after five cells.
 */
test("clampToStop never yields, at any distance past the fit", () => {
	for (const past of [1, 2, 5, 6, 20, 500]) {
		assert.deepEqual(clampToStop(MIN - past, MIN), { span: MIN, atLimit: true },
			`pulled ${past} cells past the fit`);
	}
});

test("clampToStop reports atLimit only while being pushed below the fit", () => {
	for (const raw of [MIN, MIN + 1, MIN + 40]) {
		assert.equal(clampToStop(raw, MIN).atLimit, false, `raw=${raw} is at or above the fit`);
	}
	assert.equal(clampToStop(MIN - 1, MIN).atLimit, true);
});

/** Stateless: the same input gives the same answer whatever came before it. */
test("clampToStop has no memory across frames", () => {
	const deep = clampToStop(MIN - 100, MIN);
	assert.deepEqual(clampToStop(MIN + 3, MIN), { span: MIN + 3, atLimit: false },
		"a card dragged hard against the stop still grows normally afterwards");
	assert.deepEqual(deep, clampToStop(MIN - 100, MIN));
});

test("clampToStop is span-agnostic — the same wall serves rows and columns", () => {
	assert.deepEqual(clampToStop(3, 40), { span: 40, atLimit: true });
	assert.deepEqual(clampToStop(300, 40), { span: 300, atLimit: false });
});
