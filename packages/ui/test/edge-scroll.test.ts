import { test } from "node:test";
import assert from "node:assert/strict";
import {
	CENTER_FRACTION, EDGE_MIN_PX, EDGE_MAX_FRACTION,
	MIN_GOVERNED_H, MIN_GOVERNED_W,
	edgeWidth, overCenter, isGoverned, deltaPixels,
} from "../src/shell/edgeScroll.ts";

/**
 * The console and the editors are tall scrollers that fill most of their card,
 * so the wheel almost anywhere over one drove THAT box and the page would not
 * move — navigating past a console meant hunting for a few pixels of card that
 * were not the console. Only the left and right edges take the wheel now.
 *
 * These test the geometry, which is the whole rule. The listener that applies
 * it is thirty lines of DOM plumbing around these four functions.
 */

test("the centre band is the requested 70% of the width", () => {
	// 400px wide: 60px of edge each side, 280px centre.
	assert.equal(edgeWidth(400), 60);
	assert.equal(400 - 2 * edgeWidth(400), 400 * CENTER_FRACTION);

	assert.ok(overCenter(400, 200), "dead centre must scroll the page");
	assert.ok(!overCenter(400, 10), "hard left must scroll the box");
	assert.ok(!overCenter(400, 390), "hard right must scroll the box");
	assert.ok(overCenter(400, 60), "the boundary belongs to the centre");
	assert.ok(!overCenter(400, 59), "one px outside it does not");
});

/**
 * A 15% strip on a narrow card is a few pixels — not a target anyone can hit on
 * purpose, which would leave the box unscrollable.
 */
test("a narrow scroller still gets a hittable strip", () => {
	// 200px: 15% would be 30px, already above the floor.
	assert.equal(edgeWidth(200), 30);
	// 120px: 15% is 18px, below the floor, so the floor applies.
	assert.equal(edgeWidth(120), EDGE_MIN_PX);
	assert.ok(overCenter(120, 60), "the centre must survive the widened strip");
});

/**
 * ...but the centre must never vanish, or the page could not be scrolled from
 * over the box at all — the original complaint, inverted.
 */
test("the centre never disappears, however narrow the box", () => {
	for (const w of [10, 40, 60, 80, 100]) {
		// +0.5 for the rounding: a strip is whole pixels.
		assert.ok(edgeWidth(w) <= w * EDGE_MAX_FRACTION + 0.5,
			`edge ${edgeWidth(w)} of ${w} leaves no centre`);
		assert.ok(overCenter(w, w / 2), `no centre at width ${w}`);
	}
});

test("a zero or negative width has no strip rather than a NaN one", () => {
	assert.equal(edgeWidth(0), 0);
	assert.equal(edgeWidth(-5), 0);
});

/**
 * Small scrollers keep native behaviour. A dropdown or a 72px reply box is easy
 * to aim around already, and stealing its wheel would make it unusable.
 */
test("only large scrollers are governed", () => {
	assert.ok(isGoverned(MIN_GOVERNED_W, MIN_GOVERNED_H), "the threshold itself is governed");
	assert.ok(!isGoverned(MIN_GOVERNED_W - 1, MIN_GOVERNED_H), "too narrow");
	assert.ok(!isGoverned(MIN_GOVERNED_W, MIN_GOVERNED_H - 1), "too short");
	assert.ok(!isGoverned(300, 72), "the reply box stays native");
	assert.ok(isGoverned(600, 400), "a console is governed");
});

/**
 * Deltas arrive in lines on some mice. Redirecting the raw number would scroll
 * the page by three pixels per notch instead of a readable amount.
 */
test("line and page deltas become pixels", () => {
	assert.equal(deltaPixels(100, 0), 100, "pixel mode passes through");
	assert.equal(deltaPixels(3, 1), 48, "three lines is a normal notch");
	assert.equal(deltaPixels(-1, 2), -400, "a page is a screenful");
});

/**
 * The ghost must be drawn at exactly the width that responds. A literal in the
 * stylesheet would be a second opinion about where the strip is, and the two
 * would disagree the first time the geometry moved — lighting one area while a
 * different one took the wheel is worse than no cue at all.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const appCss = readFileSync(fileURLToPath(new URL("../src/app.css", import.meta.url)), "utf8");

test("the hover ghost is sized by the same --edge-w the handler sets", () => {
	const rule = /\[data-edge-scroll\]:hover\s*\{([^}]*)\}/.exec(appCss);
	assert.ok(rule, "no [data-edge-scroll]:hover rule — the strips have no cue");
	const body = rule[1]!;
	assert.match(body, /background-size:\s*var\(--edge-w[^;]*\)/,
		"the ghost must take its width from --edge-w, not a literal");
	// Fixed to the box, not to the scrolled content: a pseudo-element or a
	// `local` attachment would slide away as the box scrolls.
	assert.doesNotMatch(body, /background-attachment:\s*local/);
});
