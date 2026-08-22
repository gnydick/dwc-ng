import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	EDGE_ZONE_PX, EDGE_MAX_STEP_PX, edgeScrollStep, axisScrollStep, reservedReach,
	scrollFloorRows,
} from "../src/shell/panelCanvas.ts";

/**
 * THE REGRESSION, pinned (reported 2026-08-04: "cards resize near the edge of
 * the screen will fly off the edge or bottom, resizing 1000-2000 pixels in
 * < 1 second").
 *
 * startResize auto-scrolls its container while the pointer sits near the edge,
 * and the resulting scrollTop is an INPUT to the size it computes. So the loop
 * fed itself: scroll a fixed 18px, the card grows by that much, a taller card
 * makes a taller canvas, the taller canvas leaves room to scroll again — about
 * 1080 px/s at 60fps, with nothing bounding it.
 *
 * The step is now RAMPED by how far the pointer has actually pushed past the
 * zone boundary, so resting at the edge does nothing and the operator has to
 * mean it. These test the ramp, which is the whole rule; the rAF loop that
 * applies it is a dozen lines of DOM plumbing around this one function.
 */

test("the boundary of the zone does not scroll at all", () => {
	const edge = 800;
	// Exactly at the boundary: in the zone, but pushed zero distance into it.
	assert.equal(edgeScrollStep(edge - EDGE_ZONE_PX, edge), 0);
	// And everything short of it.
	assert.equal(edgeScrollStep(edge - EDGE_ZONE_PX - 1, edge), 0);
	assert.equal(edgeScrollStep(0, edge), 0);
});

test("the step ramps with how far the pointer pushes in", () => {
	const edge = 800;
	assert.equal(edgeScrollStep(edge - EDGE_ZONE_PX / 2, edge), EDGE_MAX_STEP_PX / 2);
	assert.equal(edgeScrollStep(edge, edge), EDGE_MAX_STEP_PX);
	// Monotonic across the zone, so the speed always tracks the gesture.
	let previous = -1;
	for (let d = 0; d <= EDGE_ZONE_PX; d++) {
		const step = edgeScrollStep(edge - EDGE_ZONE_PX + d, edge);
		assert.ok(step >= previous, `step fell at depth ${d}`);
		previous = step;
	}
});

/**
 * A pointer dragged off the bottom of the screen reports coordinates past the
 * edge. Unclamped, `depth` would keep climbing and the ramp would hand back an
 * ever-larger step — the runaway again, wearing the fix's clothes.
 */
test("past the edge is capped, not extrapolated", () => {
	const edge = 800;
	assert.equal(edgeScrollStep(edge + 1, edge), EDGE_MAX_STEP_PX);
	assert.equal(edgeScrollStep(edge + 10_000, edge), EDGE_MAX_STEP_PX);
});

test("a degenerate zone or a NaN pointer yields no scroll, never NaN", () => {
	assert.equal(edgeScrollStep(NaN, 800), 0);
	assert.equal(edgeScrollStep(800, NaN), 0);
	assert.equal(edgeScrollStep(800, 800, 0), 0);
	assert.equal(edgeScrollStep(800, 800, -5), 0);
});

/**
 * A BUDGET, not a style assertion. The whole complaint was a rate, so the rate
 * is what has to be held down — and the constant alone does not say what it
 * means until it is multiplied by a frame rate. Raising it is a deliberate act
 * that has to come here and say so.
 */
test("the fastest the edge can drive a resize stays well under the complaint", () => {
	const perSecondAt60fps = EDGE_MAX_STEP_PX * 60;
	assert.ok(perSecondAt60fps <= 200,
		`${perSecondAt60fps} px/s is not reined in (the report was 1000-2000px in under a second)`);
});

/**
 * SHRINKING NEEDS THE OTHER DIRECTION (reported 2026-08-05: "the shrink back
 * onto the page doesn't seem to scroll anywhere, the card just shrinks as far
 * as the mouse can reach").
 *
 * Auto-scroll was built to let a card grow past the viewport, so it watched the
 * bottom and right edges only. Dragging UP to shrink hits the top of the screen
 * and stops, which is the same limitation the feature exists to remove.
 */
test("both ends of an axis scroll, in opposite directions", () => {
	const top = 100, bottom = 700;
	assert.equal(axisScrollStep(bottom, top, bottom), EDGE_MAX_STEP_PX, "the far edge scrolls forward");
	assert.equal(axisScrollStep(top, top, bottom), -EDGE_MAX_STEP_PX, "the near edge scrolls back");
	assert.equal(axisScrollStep((top + bottom) / 2, top, bottom), 0, "the middle is still");
});

test("the two directions are the same ramp, mirrored", () => {
	const top = 100, bottom = 700;
	// Negating a zero step yields -0, which assert.equal treats as distinct from
	// 0. Adding 0 collapses it (IEEE754: -0 + 0 is +0); the two are the same
	// amount of scrolling, and only the sign of "no scroll at all" differs.
	const norm = (n: number): number => n + 0;
	for (let d = 0; d <= EDGE_ZONE_PX; d++) {
		assert.equal(
			norm(axisScrollStep(bottom - d, top, bottom)),
			norm(-axisScrollStep(top + d, top, bottom)),
			`the ramps disagree ${d}px in from each end`,
		);
	}
});

/**
 * A scroller shorter than two zones has both ends in range everywhere. Branching
 * would let one end win arbitrarily and jerk the view; cancelling degrades to
 * "barely moves", which is the honest answer for a box with nowhere to go.
 */
test("a scroller narrower than two zones cancels rather than picking a side", () => {
	const top = 0, bottom = EDGE_ZONE_PX; // half the width of one zone
	assert.equal(axisScrollStep((top + bottom) / 2, top, bottom), 0);
	assert.ok(Math.abs(axisScrollStep(bottom, top, bottom)) <= EDGE_MAX_STEP_PX);
	assert.ok(Math.abs(axisScrollStep(top, top, bottom)) <= EDGE_MAX_STEP_PX);
});

/**
 * THE SHRINK HALF, pinned (reported 2026-08-05: "when shrinking the card back
 * into the page, it exhibits the same super fast behavior").
 *
 * No auto-scroll runs while shrinking, so the speed came from somewhere else:
 * the browser clamps scrollTop to `scrollHeight - clientHeight`, and the resize
 * reads scrollTop to work out a size. A shorter card means a shorter canvas
 * means a clamped scroll position — measured, a card dropped 800px pulled
 * scrollTop 1700 -> 900 — and that displacement returns next frame as more
 * shrink. It COMPOUNDS, which is why it outran the growth path.
 *
 * The reach a drag reserves must therefore never fall, or the canvas gets
 * shorter mid-drag and hands the clamp something to do again.
 */
test("the reserved reach never falls, however far a card is shrunk", () => {
	const grown = { col: 0, row: 10, colSpan: 40, rowSpan: 200 };
	let reach = reservedReach(0, grown);
	assert.equal(reach, 210, "growing must extend the reservation");

	// Every step of a drag back up to a 1-row card.
	for (let rowSpan = 200; rowSpan >= 1; rowSpan--) {
		reach = reservedReach(reach, { ...grown, rowSpan });
		assert.equal(reach, 210, `reservation fell while shrinking to rowSpan ${rowSpan}`);
	}
});

test("the reach follows a card that moves further down, and ignores nonsense", () => {
	assert.equal(reservedReach(50, { col: 0, row: 100, colSpan: 4, rowSpan: 20 }), 120);
	assert.equal(reservedReach(50, { col: 0, row: NaN, colSpan: 4, rowSpan: 20 }), 50);
	assert.equal(reservedReach(50, { col: 0, row: 1, colSpan: 4, rowSpan: Infinity }), 50);
});

const canvasSrc = readFileSync(
	fileURLToPath(new URL("../src/shell/panelCanvas.ts", import.meta.url)), "utf8");

/**
 * The other half of the same defect: the loop scrolled scrollLeft but left it
 * out of the compensation, so sideways the view ran to the end of the canvas
 * while the card never changed width — the card appearing to fly off the edge.
 * A horizontal delta measured without it is measuring the wrong distance.
 */
test("the horizontal delta compensates for horizontal scrolling", () => {
	assert.match(canvasSrc, /originScrollLeft/,
		"startResize must snapshot scrollLeft to measure against");
	const tick = /const scrolledX[^\n]*\n/.exec(canvasSrc);
	assert.ok(tick, "no horizontal scroll compensation term");
	assert.match(tick[0], /scrollLeft/, "the horizontal term must read scrollLeft");
});

/**
 * The fixed per-frame step is what made it a runaway. If it comes back, the
 * ramp is decorative.
 */
/**
 * The reservation only works if it is actually INSTALLED and actually removed.
 * A spacer left behind would hold every canvas at the tallest anything was ever
 * dragged to, for the life of the page.
 */
test("startResize reserves the extent for the drag, and settles rather than dropping it", () => {
	const resize = canvasSrc.slice(canvasSrc.indexOf("const startResize"));
	assert.match(resize, /holdFloor\(canvasEl, scroller, reach \+ 1\)/,
		"the resize drag must reserve scroll extent, or a shrink clamps its own measurement");
	assert.match(resize, /reservedReach\(reach, next\)/,
		"the reservation must be updated from the previewed rect");
	// THE REGRESSION: removing the reservation outright is what made the view
	// jump on release. It has to recede, not vanish.
	assert.match(resize, /settleFloor\(unit\)/,
		"the drag must settle the floor on drop, not remove it");
	assert.doesNotMatch(resize, /floor\.el\.remove\(\)|spacer\.remove\(\)/,
		"removing the reservation at drop is exactly the jump this fixes");
});

/**
 * The floor is PHANTOM SPACE. Holding more than the view needs would leave the
 * canvas scrollable into emptiness for the rest of the session; holding less
 * would let the browser clamp and the view jump. It is exactly the scroll
 * position already on screen, rounded up to a whole row.
 */
test("the settled floor is exactly what the current view occupies", () => {
	// 300px viewport scrolled to 1700, 4px rows: the view's bottom edge is 2000px.
	assert.equal(scrollFloorRows(1700, 300, 4), 500);
	// A partial row rounds UP — rounding down would leave the last row short and
	// hand the clamp the very gap this exists to close.
	assert.equal(scrollFloorRows(1701, 300, 4), 501);
	assert.equal(scrollFloorRows(0, 300, 4), 75);
});

test("a degenerate scroller yields no floor rather than a NaN one", () => {
	assert.equal(scrollFloorRows(NaN, 300, 4), 0);
	assert.equal(scrollFloorRows(100, NaN, 4), 0);
	assert.equal(scrollFloorRows(100, 300, 0), 0);
	assert.equal(scrollFloorRows(-9999, 300, 4), 0, "a floor is never negative rows");
});

/**
 * The floor must be able to GO. A hidden cell that outlives its purpose pins the
 * canvas tall for the life of the page, which is the opposite failure: you could
 * never scroll back to a tidy bottom again.
 */
test("the floor is released once scrolling makes it redundant", () => {
	assert.match(canvasSrc, /const dropFloor = \(\)/, "there must be a way to let the floor go");
	assert.match(canvasSrc, /addEventListener\("scroll", onScroll/,
		"the floor must watch for the moment it stops holding anything up");
	assert.match(canvasSrc, /removeEventListener\("scroll", floor\.onScroll\)/,
		"the watcher must be detached with the floor, or it leaks per drag");
});

test("no unramped constant step survives in the resize loop", () => {
	assert.doesNotMatch(canvasSrc, /scrollTop \+= EDGE_[A-Z_]*STEP/,
		"the step must be ramped by edgeScrollStep, not applied flat");
	assert.doesNotMatch(canvasSrc, /scrollLeft \+= EDGE_[A-Z_]*STEP/,
		"the step must be ramped by edgeScrollStep, not applied flat");
	// Both ends of both axes, or one direction silently loses its scroll again.
	assert.match(canvasSrc, /scrollTop \+= axisScrollStep\(pointerY, box\.top, box\.bottom\)/);
	assert.match(canvasSrc, /scrollLeft \+= axisScrollStep\(pointerX, box\.left, box\.right\)/);
});
