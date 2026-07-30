import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Cards are sized from their content: panelCanvas.contentColSpan() measures the
 * body's min-content width and that becomes the card's stop. The whole scheme
 * rests on content telling the truth about how narrow it can go, and CSS offers
 * two easy ways to lie:
 *
 *   · `min-width: 0` on a flex or grid container — reports zero, needs more.
 *     The card's stop lands INSIDE its own content and the content is clipped,
 *     with nothing anywhere saying so.
 *   · `contain: inline-size` — removes the element's content from its own
 *     intrinsic size entirely. Legitimate for a canvas or a uPlot root, which
 *     would otherwise report their current pixels as a minimum forever, but it
 *     silences the element, so a floor has to be declared explicitly alongside.
 *
 * Both have shipped. `.filament-feed-fields` declared `min-width: 0` while
 * needing 159px inside a 140px track: the Extruders card shrank 71px over its
 * own footer (reported 2026-07-30). `.temp-chart-plot` needed the containment
 * but had no floor until one was added.
 *
 * These are source assertions, not renders — there is no DOM here. They cannot
 * prove a floor is CORRECT; they stop the two known ways of removing one
 * silently. The value is that the next person to reach for `min-width: 0` in
 * one of these places has to say why.
 */

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
const appCss = stripComments(
	readFileSync(fileURLToPath(new URL("../src/app.css", import.meta.url)), "utf8"),
);

/** The declaration block of the LAST rule whose selector list contains `sel`. */
function ruleBody(sel: string): string {
	const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const found = [...appCss.matchAll(new RegExp(`(^|[,}])\\s*${escaped}\\s*\\{([^}]*)\\}`, "g"))];
	assert.ok(found.length > 0, `no rule for ${sel}`);
	return found[found.length - 1]![2]!;
}

/**
 * Containers whose intrinsic width IS the card's stop. Each holds controls of a
 * declared size, so its min-content is a real number the card must respect —
 * there is no reflow available to any of them that would make zero honest.
 */
const MUST_NOT_ZERO = [
	".filament-feed-fields", // Feed distance + rate: 48 + "mm" + 70 + "F" = 159
	".heat-deselect", // Deselect + P + decode
	".coupler-stack", // Lock + Unlock
];

for (const sel of MUST_NOT_ZERO) {
	test(`${sel} declares no min-width: 0 — it would under-report the card's stop`, () => {
		assert.doesNotMatch(ruleBody(sel), /min-width:\s*0/);
	});
}

/**
 * The inverse: an element that IS contained has been silenced deliberately, so
 * something must put a floor back. Without one the card shrinks to nothing.
 */
test("every contain: inline-size element declares an explicit min-width", () => {
	const contained = [...appCss.matchAll(/([^{}]+)\{([^}]*contain:\s*inline-size[^}]*)\}/g)];
	assert.ok(contained.length > 0, "no contain: inline-size in app.css — has the chart changed?");
	for (const [, selector, body] of contained) {
		const sel = selector!.trim();
		// The floor may sit on this rule or on the element's base rule.
		const hasFloor = /min-width:\s*[^0]/.test(body!) || /min-width:\s*[^0]/.test(ruleBody(sel));
		assert.ok(hasFloor, `${sel} is contained but declares no min-width — it can shrink to nothing`);
	}
});

/**
 * The other half of the same discipline: a LIVE readout must not sit in an
 * elastic track. `1fr` grows with the card, so the digits slide across it as it
 * is resized (the DRO's value track measured 264px narrow and 744px wide), and
 * `max-content` re-sizes the track as the reading crosses a digit or picks up a
 * minus sign — which moves every other row with it. Fixed track, tabular
 * figures, slack after the last column.
 */
test("the DRO value track is fixed — a live reading cannot be in 1fr", () => {
	const tracks = /grid-template-columns:([^;]*)/.exec(ruleBody(".dro-list"));
	assert.ok(tracks, ".dro-list declares no track list");
	assert.doesNotMatch(tracks[1]!, /\bfr\b|\d+fr/);
	assert.match(tracks[1]!, /var\(--dro-val-w\)/);

	const token = /--dro-val-w:\s*(\d+)px/.exec(appCss);
	assert.ok(token, "no --dro-val-w token");
	// "-99999.99mm" measures 99px at .dro-val's face and size.
	assert.ok(Number(token[1]) >= 99, `value track ${token[1]}px cannot hold a full reading`);
});

test("the DRO rows share ONE track list via subgrid", () => {
	// Per-row grids sized the axis track to that row's own label, so seven rows
	// had seven different column positions.
	assert.match(ruleBody(".dro-row"), /grid-template-columns:\s*subgrid/);
	// The gutter belongs to the parent: a gap restated on the subgrid silently
	// overrides the inherited one and shifts the tracks (see .feed-field).
	assert.doesNotMatch(ruleBody(".dro-row"), /(^|[;{\s])(gap|column-gap):/);
});

/**
 * The Extruders value column holds the filament picker AND the footer's feed
 * pair (148px). A minmax() minimum is a literal — it does not rise to fit content — so
 * this track has to be at least as wide as the wider occupant, and the picker
 * needs its own ceiling or it fills the whole thing.
 */
test("the Extruders value track is fixed and clears its widest occupant", () => {
	const token = /--fil-value-w:\s*(\d+)px/.exec(appCss);
	assert.ok(token, "no --fil-value-w token");
	// 148: the pair's width after its boxes were trimmed to bring this card's
	// minimum (512) onto the Tools card's (500) — they sit side by side.
	assert.ok(Number(token[1]) >= 148, `value track ${token[1]}px is under the feed pair's 148px`);

	assert.match(ruleBody(".filament-list"), /grid-template-columns:[^;]*var\(--fil-value-w\)/);
	assert.match(ruleBody(".filament-row .filament-pick"), /max-width:\s*\d+px/);
});
