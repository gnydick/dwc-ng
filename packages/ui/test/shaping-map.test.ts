/**
 * The Capture card's XY map: the projection, and the caption under it.
 *
 * The one thing worth pinning hardest is the FLIP. SVG's y grows downward and a
 * printer's grows away from the operator, so a map drawn straight through is a
 * mirror image of the machine in front of them — on the one card whose job is
 * to say where the head is about to go. It is also the kind of defect that
 * looks fine on a symmetric bed and is wrong on every real one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { mapPoint, mapSummary, mapView, type MapSegment } from "../src/charts/mapData.ts";

const BOX = { x: [50, 250] as const, y: [50, 250] as const };
const seg = (kind: "travel" | "capture", x1: number, y1: number, x2: number, y2: number): MapSegment =>
	({ kind, from: { x: x1, y: y1 }, to: { x: x2, y: y2 }, label: `${kind} ${x1},${y1}->${x2},${y2}` });

test("the projection flips Y about the envelope's own midline, so the box maps onto itself", () => {
	assert.deepEqual(mapPoint(BOX, { x: 120, y: 50 }), { x: 120, y: 250 });
	assert.deepEqual(mapPoint(BOX, { x: 120, y: 250 }), { x: 120, y: 50 });
	// The middle is fixed, which is what "about its own midline" means.
	assert.deepEqual(mapPoint(BOX, { x: 120, y: 150 }), { x: 120, y: 150 });
	// X is untouched: only one axis disagrees between the two coordinate systems.
	assert.deepEqual(mapPoint(BOX, { x: 60, y: 150 }), { x: 60, y: 150 });
});

test("the flip is its own function, and the legs go through it", () => {
	// The carriage marker is projected separately from the legs so that moving a
	// dot does not rebuild the polyline. That only stays correct while both use
	// THIS function — a second y arithmetic would put the dot off its own line.
	const view = mapView(BOX, [seg("capture", 120, 60, 180, 60)]);
	const a = mapPoint(BOX, { x: 120, y: 60 });
	assert.deepEqual([view.legs[0]!.x1, view.legs[0]!.y1], [a.x, a.y]);
});

test("an asymmetric bed is not silently symmetric", () => {
	// 0..100 has midline 50: the front of the bed (y=0) must land at the BOTTOM
	// of the drawing, i.e. the largest projected y.
	const low = { x: [0, 100] as const, y: [0, 100] as const };
	assert.equal(mapPoint(low, { x: 0, y: 0 }).y, 100);
	const offset = { x: [0, 100] as const, y: [200, 300] as const };
	assert.equal(mapPoint(offset, { x: 0, y: 200 }).y, 300);
	assert.equal(mapPoint(offset, { x: 0, y: 300 }).y, 200);
});

test("the box is the envelope, in projected coordinates", () => {
	const view = mapView(BOX, []);
	assert.deepEqual(view.box, { x: 50, y: 50, w: 200, h: 200 });
});

test("the view fits everything drawn, including a leg that leaves the box", () => {
	// A plan outside the envelope is refused before it can run, but the map is
	// what the operator looks at to understand WHY — so the line has to be
	// visible going out rather than clipped away at the edge.
	const view = mapView(BOX, [seg("capture", 120, 150, 400, 150)]);
	const [minX, , w] = view.viewBox.split(" ").map(Number);
	assert.ok(minX! < 50, view.viewBox);
	assert.ok(minX! + w! > 400, view.viewBox);
});

test("stroke and marker are user units, so the drawing scales with its own box", () => {
	const small = mapView({ x: [0, 100], y: [0, 100] }, []);
	const large = mapView({ x: [0, 400], y: [0, 400] }, []);
	assert.ok(large.stroke > small.stroke);
	assert.equal(large.stroke / small.stroke, large.marker / small.marker);
});

test("a degenerate box still produces a viewBox with area", () => {
	// `asRange` refuses lo >= hi so this cannot come from config, but a zero-size
	// viewBox renders as nothing at all, which is the worst possible failure for
	// a drawing whose job is to be looked at.
	const view = mapView({ x: [10, 10], y: [10, 10] }, []);
	const [, , w, h] = view.viewBox.split(" ").map(Number);
	assert.ok(w! > 0 && h! > 0, view.viewBox);
});

test("the caption counts what is recorded apart from what is only travelled", () => {
	const segs = [seg("travel", 0, 0, 100, 0), seg("capture", 100, 0, 160, 0), seg("capture", 160, 0, 100, 0)];
	assert.equal(mapSummary(segs), "2 recorded passes · 120 mm measured · 100 mm positioning");
});

test("one pass is not '1 passes', and no plan says so plainly", () => {
	assert.equal(mapSummary([seg("capture", 0, 0, 60, 0)]), "1 recorded pass · 60 mm measured · 0 mm positioning");
	assert.equal(mapSummary([]), "no moves planned");
	assert.equal(mapSummary([seg("travel", 0, 0, 60, 0)]), "no moves planned");
});
