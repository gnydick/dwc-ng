import { test } from "node:test";
import assert from "node:assert/strict";
import {
	GRID_COLS, clampRect, rectsOverlap, collidesWithAny, hasCollisions, inBounds,
	tryMove, tryResize, defaultCanvas, parseStoredCanvas, serializeCanvas, mergeCanvas,
	applyDetent, DETENT_BREAKAWAY_ROWS, type DetentState,
} from "../src/shell/panelCanvas.ts";
import { MACHINE_PANEL_DEFAULTS } from "../src/views/machine.panelDefaults.ts";
import { JOBS_PANEL_DEFAULTS } from "../src/views/jobs.panelDefaults.ts";
import { MACROS_PANEL_DEFAULTS } from "../src/views/macros.panelDefaults.ts";
import { SYSTEM_PANEL_DEFAULTS } from "../src/views/system.panelDefaults.ts";
import { CONTROL_PANEL_DEFAULTS } from "../src/views/control.panelDefaults.ts";
import { SETTINGS_PANEL_DEFAULTS } from "../src/views/settings.panelDefaults.ts";
import { BED_PANEL_DEFAULTS } from "../src/views/bed.panelDefaults.ts";
import { ACTIVITY_PANEL_DEFAULTS } from "../src/views/activity.panelDefaults.ts";

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

test("Machine view's default panel layout is collision-free", () => {
	assert.equal(hasCollisions(defaultCanvas(MACHINE_PANEL_DEFAULTS)), false);
});

test("Jobs view's default panel layout is collision-free", () => {
	assert.equal(hasCollisions(defaultCanvas(JOBS_PANEL_DEFAULTS)), false);
});

test("Macros view's default panel layout is collision-free", () => {
	assert.equal(hasCollisions(defaultCanvas(MACROS_PANEL_DEFAULTS)), false);
});

test("System view's default panel layout is collision-free", () => {
	assert.equal(hasCollisions(defaultCanvas(SYSTEM_PANEL_DEFAULTS)), false);
});

test("Control view's default panel layout is collision-free", () => {
	assert.equal(hasCollisions(defaultCanvas(CONTROL_PANEL_DEFAULTS)), false);
});

test("Settings view's default panel layout is collision-free", () => {
	assert.equal(hasCollisions(defaultCanvas(SETTINGS_PANEL_DEFAULTS)), false);
});

// --- the resize detent at a card's exact content fit ---

const armed = (): DetentState => ({ broken: false });

test("above the minimum the detent does nothing", () => {
	assert.deepEqual(applyDetent(40, 20, armed()), { span: 40, state: { broken: false }, held: false });
});

// The invariant: the visible cue (driven by `held`) is on IFF the detent is
// engaged — the frame resisting the pointer at the exact fit. These pin both
// halves so neither past bug can return: the cue flashing when it shouldn't,
// or the cue vanishing when the detent is genuinely holding.
test("held is false at rest — sitting at or above the minimum is not 'engaged'", () => {
	// At rest a re-fit card sits exactly at its minimum. Merely being at min must
	// NOT light the cue (this was the old at-min border's spurious flash).
	assert.equal(applyDetent(20, 20, armed()).held, false, "exactly at min, not resisting");
	assert.equal(applyDetent(40, 20, armed()).held, false, "well above min");
});

test("held is false during a width-only resize of an at-min card", () => {
	// A width-only drag leaves the row span unchanged (deltaRowSpan ~ 0), so the
	// raw span never dips below min. The cue must stay dark — the original bug
	// was it lighting because span happened to equal min.
	const min = 20;
	assert.equal(applyDetent(min, min, armed()).held, false);
});

test("held is true only while the edge is resisting below the fit", () => {
	const min = 20;
	for (let past = 1; past < DETENT_BREAKAWAY_ROWS; past++) {
		assert.equal(applyDetent(min - past, min, armed()).held, true, `${past} rows into the detent`);
	}
});

test("held goes false once the detent breaks away and while released", () => {
	const min = 20;
	const atRelease = applyDetent(min - DETENT_BREAKAWAY_ROWS, min, armed());
	assert.equal(atRelease.held, false, "the frame it breaks away, it is no longer holding");
	const released = applyDetent(min - DETENT_BREAKAWAY_ROWS - 2, min, atRelease.state);
	assert.equal(released.held, false, "released and tracking the pointer, not holding");
});

test("the bottom edge sticks at the exact minimum while the pointer keeps moving", () => {
	const min = 20;
	for (let past = 0; past < DETENT_BREAKAWAY_ROWS; past++) {
		const out = applyDetent(min - past, min, armed());
		assert.equal(out.span, min, `still ${past} rows into the detent`);
		assert.equal(out.state.broken, false);
	}
});

test("pulling a little further releases it, and the release does not jump", () => {
	const min = 20;
	// The frame it breaks away, the span must still be exactly the minimum -
	// otherwise the card snaps down by the breakaway distance the instant it lets go.
	const atRelease = applyDetent(min - DETENT_BREAKAWAY_ROWS, min, armed());
	assert.equal(atRelease.span, min);
	assert.equal(atRelease.state.broken, true);

	// And from there it tracks the pointer again, one row per row.
	const next = applyDetent(min - DETENT_BREAKAWAY_ROWS - 1, min, atRelease.state);
	assert.equal(next.span, min - 1);
	assert.equal(applyDetent(min - DETENT_BREAKAWAY_ROWS - 4, min, next.state).span, min - 4);
});

test("the span never jumps by more than a row across a whole drag through the detent", () => {
	// Sweep the pointer down through the detent and back up, asserting continuity.
	const min = 20;
	let state = armed();
	let previous: number | null = null;
	const sweep = [...Array(40).keys()].map(i => 30 - i).concat([...Array(40).keys()].map(i => -9 + i));
	for (const rawSpan of sweep) {
		const out = applyDetent(rawSpan, min, state);
		state = out.state;
		if (previous !== null) {
			assert.ok(
				Math.abs(out.span - previous) <= 1,
				`span jumped from ${previous} to ${out.span} at rawSpan ${rawSpan}`,
			);
		}
		previous = out.span;
	}
});

test("it re-arms on the way back up so the detent is felt in both directions", () => {
	const min = 20;
	const broken = applyDetent(min - DETENT_BREAKAWAY_ROWS - 3, min, { broken: true });
	assert.equal(broken.state.broken, true);
	const back = applyDetent(min - DETENT_BREAKAWAY_ROWS, min, broken.state);
	assert.equal(back.span, min);
	assert.equal(back.state.broken, false, "re-armed, so shrinking again must catch at the minimum");
});

test("Bed view's default panel layout is collision-free", () => {
	assert.equal(hasCollisions(defaultCanvas(BED_PANEL_DEFAULTS)), false);
});

test("Activity view's default panel layout is collision-free", () => {
	// This view had no such test until the Objects card was added to it, while
	// every other view had one — the gap was the point at which a bad placement
	// would have shipped unnoticed.
	assert.equal(hasCollisions(defaultCanvas(ACTIVITY_PANEL_DEFAULTS)), false);
});
