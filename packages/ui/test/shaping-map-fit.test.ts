/**
 * The Capture map FITS ITS STAGE — at every envelope aspect ratio, not just the
 * landscape ones somebody happened to own.
 *
 * The defect this pins (GIT_112, reported 2026-08-27 at a 400 x 400 envelope):
 * the envelope rect's bottom edge was cut off, so the concentric pair the
 * drawing is meant to be — envelope outside, capture ring inside — stopped
 * being concentric. MEASURED in headless Chromium at `--u: 4px`, before the
 * fix:
 *
 *   square 400 x 400   stage 232.00 x 184.00   svg 220.00 x 220.00
 *                      envelope margins  top 17.79  bottom -30.21
 *   portrait 200 x 400 stage 232.00 x 184.00   svg 219.98 x 397.41
 *                      envelope margins  top 27.30  bottom -198.11
 *   landscape 499.6 x 301                      svg 219.98 x 141.91
 *                      envelope margins  top 17.79  bottom  47.88
 *
 * Note the landscape row: it never clipped, but it was never CONCENTRIC either.
 * The drawing sat high in the stage and the empty band below it read as
 * deliberate. So "is it inside the box" is the wrong question and would have
 * passed on all three; the question is whether the margins MATCH.
 *
 * Cause, from those numbers rather than from reading the CSS: an absolutely
 * positioned `<svg>` with `width: auto; height: auto` and all four insets is a
 * replaced element with an intrinsic RATIO and no intrinsic size. Chromium
 * takes its width from the left/right insets and then derives its height from
 * that ratio — the top and bottom insets are simply not inputs. So the SVG box
 * was as tall as the viewBox told it to be, and `overflow: hidden` took the
 * rest.
 *
 * The invariant now: the viewBox has the SVG viewport's aspect ratio, so
 * `preserveAspectRatio="xMidYMid meet"` letterboxes by zero and the viewBox
 * maps ONTO the viewport. Held at rung 6 (sole route) by `MAP_STAGE` in
 * charts/mapData.ts being the only source of both numbers: the stage element
 * gets its size from `MAP_STAGE_STYLE` and nowhere else, and the aspect the fit
 * uses is not a parameter, so no call site can pass a different one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
	MAP_STAGE, MAP_STAGE_STYLE, VIEWPORT_ASPECT,
	mapView, type Box, type MapSegment, type MapView,
} from "../src/charts/mapData.ts";

const path = (rel: string): string =>
	new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const CSS = readFileSync(path("../src/app.css"), "utf8");
const CARD = readFileSync(path("../src/cards/ShapingCards.tsx"), "utf8");

/** The default global unit, in screen pixels (src/index.css `:root { --u: 4px }`).
 *  Only a scale factor here: every assertion below is a RATIO or a comparison
 *  between two lengths in the same units, so the answers do not depend on it. */
const U = 4;
/** The SVG viewport: the stage's content box, which `.shp-map` fills. */
const VIEWPORT = {
	w: (MAP_STAGE.w - 2 * MAP_STAGE.pad) * U,
	h: (MAP_STAGE.h - 2 * MAP_STAGE.pad) * U,
};

const seg = (kind: "travel" | "capture", x1: number, y1: number, x2: number, y2: number): MapSegment =>
	({ kind, from: { x: x1, y: y1 }, to: { x: x2, y: y2 }, label: `${kind}` });

/** A capture ring inset from the envelope — the "inner square" of the pair. */
function ring(env: Box, inset: number): MapSegment[] {
	const x0 = env.x[0] + inset, x1 = env.x[1] - inset;
	const y0 = env.y[0] + inset, y1 = env.y[1] - inset;
	return [
		seg("capture", x0, y0, x1, y0),
		seg("capture", x1, y0, x1, y1),
		seg("capture", x1, y1, x0, y1),
		seg("capture", x0, y1, x0, y0),
	];
}

type Rect = { x: number; y: number; w: number; h: number };

/**
 * Where a projected rectangle lands in the viewport, through the very
 * `xMidYMid meet` the browser applies: uniform scale, remainder split evenly.
 * Coordinates are viewport-relative, so 0..VIEWPORT.w / 0..VIEWPORT.h is
 * exactly the visible area.
 */
function onScreen(view: MapView, r: Rect): Rect {
	const [vx, vy, vw, vh] = view.viewBox.split(" ").map(Number) as [number, number, number, number];
	const s = Math.min(VIEWPORT.w / vw, VIEWPORT.h / vh);
	const ox = (VIEWPORT.w - vw * s) / 2;
	const oy = (VIEWPORT.h - vh * s) / 2;
	return { x: (r.x - vx) * s + ox, y: (r.y - vy) * s + oy, w: r.w * s, h: r.h * s };
}

/** Every drawn thing, as rectangles in projected user units: the envelope, and
 *  each leg's own bounding box (a leg outside the envelope is drawn and must be
 *  visible — it is how the operator sees WHY a plan was refused). */
function drawn(view: MapView): Rect[] {
	const out: Rect[] = [view.box];
	for (const l of view.legs) {
		out.push({
			x: Math.min(l.x1, l.x2), y: Math.min(l.y1, l.y2),
			w: Math.abs(l.x2 - l.x1), h: Math.abs(l.y2 - l.y1),
		});
	}
	return out;
}

const ENVELOPES: readonly (readonly [string, Box])[] = [
	["square 400 x 400", { x: [0, 400], y: [0, 400] }],
	["portrait 200 x 400", { x: [0, 200], y: [0, 400] }],
	["landscape 499.6 x 301", { x: [0, 499.6], y: [0, 301] }],
	["wide 600 x 120", { x: [0, 600], y: [0, 120] }],
	["offset square 50..250", { x: [50, 250], y: [50, 250] }],
];

/**
 * THE fix, stated as arithmetic. Before it, a 400 x 400 envelope produced a
 * viewBox of aspect 1.0 for a viewport of aspect 55/43 = 1.279…, and the
 * mismatch is what the browser resolved by growing the SVG box past the stage.
 */
test("the viewBox has the viewport's aspect ratio, at every envelope aspect", () => {
	for (const [name, env] of ENVELOPES) {
		const view = mapView(env, ring(env, 40));
		const [, , vw, vh] = view.viewBox.split(" ").map(Number) as [number, number, number, number];
		assert.ok(
			Math.abs(vw / vh - VIEWPORT_ASPECT) < 1e-9,
			`${name}: viewBox aspect ${vw / vh} != viewport aspect ${VIEWPORT_ASPECT} (${view.viewBox})`,
		);
	}
});

/**
 * The acceptance criterion in the owner's own words: "it's supposed to look
 * like a square within a square … we don't see a fully concentric pair". Equal
 * margins, not merely "inside the box" — the landscape row above was inside the
 * box and still wrong.
 */
test("the envelope is concentric with the stage's visible area, at every envelope aspect", () => {
	for (const [name, env] of ENVELOPES) {
		const view = mapView(env, ring(env, 40));
		const r = onScreen(view, view.box);
		const left = r.x, right = VIEWPORT.w - (r.x + r.w);
		const top = r.y, bottom = VIEWPORT.h - (r.y + r.h);
		assert.ok(Math.abs(left - right) < 0.01, `${name}: left ${left} vs right ${right}`);
		assert.ok(Math.abs(top - bottom) < 0.01, `${name}: top ${top} vs bottom ${bottom}`);
		assert.ok(left >= 0 && top >= 0, `${name}: envelope outside the stage (left ${left}, top ${top})`);
	}
});

test("nothing drawn is clipped, at every envelope aspect", () => {
	for (const [name, env] of ENVELOPES) {
		const view = mapView(env, ring(env, 40));
		for (const r of drawn(view).map(d => onScreen(view, d))) {
			assert.ok(r.x >= -0.01, `${name}: clipped left (${r.x})`);
			assert.ok(r.y >= -0.01, `${name}: clipped top (${r.y})`);
			assert.ok(r.x + r.w <= VIEWPORT.w + 0.01, `${name}: clipped right (${r.x + r.w} > ${VIEWPORT.w})`);
			assert.ok(r.y + r.h <= VIEWPORT.h + 0.01, `${name}: clipped bottom (${r.y + r.h} > ${VIEWPORT.h})`);
		}
	}
});

/**
 * Fitting must NOT be achieved by cropping to the envelope. A plan that leaves
 * the box is refused before it can run, and this drawing is what the operator
 * reads to understand why — so the leg going out stays visible, and the
 * envelope is then legitimately off-centre because the drawing is not.
 */
test("a leg outside the envelope stays fully visible, and is what pushes the drawing off-centre", () => {
	const env: Box = { x: [0, 400], y: [0, 400] };
	const view = mapView(env, [seg("capture", 200, 200, 700, 200)]);
	for (const r of drawn(view).map(d => onScreen(view, d))) {
		assert.ok(r.x >= -0.01 && r.x + r.w <= VIEWPORT.w + 0.01, `clipped in x: ${JSON.stringify(r)}`);
		assert.ok(r.y >= -0.01 && r.y + r.h <= VIEWPORT.h + 0.01, `clipped in y: ${JSON.stringify(r)}`);
	}
	// The escaping leg runs right, so the envelope must sit LEFT of centre —
	// proof the fit grew around everything drawn rather than around the box.
	const b = onScreen(view, view.box);
	assert.ok(b.x < VIEWPORT.w - (b.x + b.w), `envelope not pushed left: ${JSON.stringify(b)}`);
});

/**
 * On-screen line weight is the same at every aspect ratio. `stroke` is in user
 * units and the viewBox maps onto a viewport of FIXED width, so stroke over
 * viewBox width is the constant that matters — off the envelope's own span it
 * would thin out on exactly the square and portrait envelopes the fit shrinks.
 */
test("the drawn line weight does not depend on the envelope's aspect ratio", () => {
	const widths = ENVELOPES.map(([, env]) => {
		const view = mapView(env, ring(env, 40));
		const [, , vw] = view.viewBox.split(" ").map(Number) as [number, number, number, number];
		return view.stroke * (VIEWPORT.w / vw);
	});
	for (const w of widths) assert.ok(Math.abs(w - widths[0]!) < 1e-9, `stroke widths differ: ${widths}`);
});

/**
 * The other half of the invariant, and the half that lives in CSS: the SVG
 * viewport IS the stage's content box. `width: 100%; height: 100%` on an
 * in-flow block child has no replaced-element rule to get wrong, which the old
 * `position: absolute; inset: …; width: auto; height: auto` demonstrably did.
 */
test("the map fills the stage's content box, with no absolute-positioning rule to resolve", () => {
	const rule = /\.shp-map\s*\{([^}]*)\}/.exec(CSS);
	assert.ok(rule, ".shp-map rule not found");
	const body = rule[1]!;
	assert.match(body, /width:\s*100%/, body);
	assert.match(body, /height:\s*100%/, body);
	assert.doesNotMatch(body, /position:\s*absolute/, body);
	assert.doesNotMatch(body, /inset:/, body);
});

/**
 * And the sole-route half: the stage's dimensions come from MAP_STAGE, not from
 * a second copy in the stylesheet. Declared in both places they would
 * eventually disagree, and the symptom would be this bug again.
 */
test("the stage's size has exactly one source", () => {
	const rule = /\.shp-map-stage\s*\{([^}]*)\}/.exec(CSS.replace(/\/\*[\s\S]*?\*\//g, ""));
	assert.ok(rule, ".shp-map-stage rule not found");
	const body = rule[1]!;
	assert.doesNotMatch(body, /(^|[\s;])width:/, body);
	assert.doesNotMatch(body, /(^|[\s;])height:/, body);
	assert.doesNotMatch(body, /(^|[\s;])padding:/, body);
	assert.match(body, /box-sizing:\s*border-box/, body);
	assert.match(CARD, /class="shp-map-stage"\s+style=\{MAP_STAGE_STYLE\}/);
	assert.equal(MAP_STAGE_STYLE.width, `calc(${MAP_STAGE.w} * var(--u))`);
	assert.equal(MAP_STAGE_STYLE.height, `calc(${MAP_STAGE.h} * var(--u))`);
	assert.equal(MAP_STAGE_STYLE.padding, `calc(${MAP_STAGE.pad} * var(--u))`);
});

/**
 * The stage stays a FIXED box. The fix must not have been bought by letting the
 * stage follow the card: this stage holds an SVG whose every leg is a DOM
 * child, and a card-width stage moved 9 of them on a resize where this one
 * moves none (app.css, and the layout audit's drift check).
 */
test("the stage is a fixed box, not one that grows with the card", () => {
	assert.ok(MAP_STAGE.w > 0 && MAP_STAGE.h > 0);
	assert.doesNotMatch(MAP_STAGE_STYLE.width, /%|100vw|auto/);
	assert.doesNotMatch(MAP_STAGE_STYLE.height, /%|100vh|auto/);
	const rule = /\.shp-map-stage\s*\{([^}]*)\}/.exec(CSS.replace(/\/\*[\s\S]*?\*\//g, ""));
	assert.match(rule![1]!, /flex:\s*0\s+0\s+auto/, "the stage must not flex with the card");
});
