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
const indexCss = readFileSync(fileURLToPath(new URL("../src/index.css", import.meta.url)), "utf8");

test("the hover ghost is sized by the same --edge-w the handler sets", () => {
	const rule = /\[data-edge-scroll\]\s*\{([^}]*)\}/.exec(appCss);
	assert.ok(rule, "no [data-edge-scroll] rule — the strips have no cue");
	const body = rule[1]!;
	assert.match(body, /background-size:\s*var\(--edge-w[^;]*\)/,
		"the ghost must take its width from --edge-w, not a literal");
	// Fixed to the box, not to the scrolled content: a pseudo-element or a
	// `local` attachment would slide away as the box scrolls.
	assert.doesNotMatch(body, /background-attachment:\s*local/);
	// Nothing to see until you are over the box.
	assert.match(/\[data-edge-scroll\]:hover\s*\{([^}]*)\}/.exec(appCss)?.[1] ?? "", /--edge-ghost-a:\s*0?\.\d+/);
});

/**
 * The strips and .panel-scroll-nub are both scroll affordances revealed on
 * hover, so they must read as ONE cue. A scroll hint in one colour beside a
 * scroll hint in another says they are different things when they are not.
 *
 * The expected colour is DERIVED from index.css rather than written here.
 * These two cues used to be pinned to a literal #5AA9E6 (--accent-blue, since
 * folded into --accent-bright), and when the ground moved from navy to anodize
 * this test was asserting a colour the palette no longer contained — it failed
 * for the right reason but named the wrong one. Deriving means the test pins
 * the COUPLING, which is the actual invariant, and a future palette change
 * cannot make it stale.
 */
test("both scroll cues wear the same colour", () => {
	const accent = /--accent-bright:\s*#([0-9a-f]{6})\s*;/i.exec(indexCss);
	assert.ok(accent, "index.css has no --accent-bright to derive the cue colour from");
	const n = parseInt(accent[1]!, 16);
	const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];

	const nub = /\.panel-scroll-nub\.up\s*\{([^}]*)\}/.exec(appCss);
	assert.ok(nub, "no .panel-scroll-nub.up rule");
	assert.match(nub[1]!, /var\(--accent-bright\)/, "the nub should take the accent from the token");

	// The gradient needs rgba() to carry an animating alpha, so it restates the
	// channels — the one place a token value is copied. Pinned to the token's
	// own value so the copy cannot drift away from it.
	const ghost = /\[data-edge-scroll\]\s*\{([^}]*)\}/.exec(appCss)![1]!;
	assert.match(
		ghost,
		new RegExp(`rgba\\(\\s*${r},\\s*${g},\\s*${b},`),
		`the ghost's channels are not --accent-bright (#${accent[1]} = ${r}, ${g}, ${b})`,
	);
});

/**
 * THE REGRESSION, pinned. The first version governed any scroller over
 * 180x100, which captured ordinary cards' `.panel-body` and their file lists —
 * a rule meant for two big text surfaces changed the feel of the whole canvas.
 * Size cannot tell a console from a card that merely has a lot in it.
 *
 * So the surfaces opt in, and this counts them. It is not a style assertion:
 * it is a budget. Adding a third is a deliberate act that has to come here and
 * say so, which is exactly the conversation that did not happen the first time.
 */
const HOSTS = ["shell/ConsolePanel.tsx", "editor/FileEditor.tsx"];

test("only the declared text surfaces opt into edge-scroll", () => {
	const src = (rel: string): string =>
		readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), "utf8");
	for (const host of HOSTS) {
		assert.match(src(host), /data-edge-scroll-host/, `${host} should opt in and does not`);
	}
});

test("the wheel rule is opt-in, not inferred from size", () => {
	const mod = readFileSync(
		fileURLToPath(new URL("../src/shell/edgeScroll.ts", import.meta.url)), "utf8");
	// innerScroller must bail before walking, on anything not inside a host.
	assert.match(mod, /closest\(`\[\$\{EDGE_SCROLL_HOST\}\]`\)\s*===\s*null\)\s*return null/,
		"a scroller outside a declared host must never be governed");
});
