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

	// Declared as `calc(29 * var(--u))` — n × the global unit. The track grows
	// with scale, but the floor below is about the BASE face and size, so it is
	// checked at the default --u (4px).
	const token = /--dro-val-w:\s*calc\(([\d.]+)\s*\*\s*var\(--u\)\)/.exec(appCss);
	assert.ok(token, "no --dro-val-w token");
	// "-99999.99mm" measures 99px at .dro-val's face and size.
	const px = Number(token[1]) * 4;
	assert.ok(px >= 99, `value track ${px}px cannot hold a full reading`);
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
	// Declared as `calc(N * var(--u))` — n × the global unit, same convention as
	// --dro-val-w above. Checked at the default --u (4px).
	const token = /--fil-value-w:\s*calc\(([\d.]+)\s*\*\s*var\(--u\)\)/.exec(appCss);
	assert.ok(token, "no --fil-value-w token");
	const px = Number(token[1]) * 4;
	// 148: the pair's width after its boxes were trimmed to bring this card's
	// minimum (512) onto the Tools card's (500) — they sit side by side.
	assert.ok(px >= 148, `value track ${px}px is under the feed pair's 148px`);

	assert.match(ruleBody(".filament-list"), /grid-template-columns:[^;]*var\(--fil-value-w\)/);
	assert.match(ruleBody(".filament-row .filament-pick"), /max-width:\s*(\d+px|calc\([\d.]+\s*\*\s*var\(--u\)\))/);
});

/**
 * The temperature card's floor is arithmetic over the legend, because the
 * legend sits BESIDE the plot: the row's real minimum is the taller of the two,
 * not the plot's. It used to declare only the plot's 120px while the legend
 * stood 149px, so the card could be dragged 29px into its own legend.
 *
 * Three things have to stay wired for that arithmetic to be true, and none of
 * them is visible from the others:
 *   1. the floor multiplies --legend-rows by --legend-row-h,
 *   2. the ROWS are sized by that same --legend-row-h (a row that picks its own
 *      height makes the floor a guess again),
 *   3. the component supplies --legend-rows from the series count.
 */
const chartTsx = readFileSync(
	fileURLToPath(new URL("../src/charts/TemperatureChart.tsx", import.meta.url)), "utf8");

test("the temp chart's floor covers the legend, not just the plot", () => {
	const floor = /\.temp-chart\s*\{([^}]*)\}/.exec(appCss);
	assert.ok(floor, "no .temp-chart rule");
	const body = floor[1]!;
	assert.match(body, /min-height:\s*max\(/, "floor must be a max() — the row's taller child wins");
	assert.match(body, /var\(--legend-rows/, "floor does not account for the legend's row count");
	assert.match(body, /var\(--legend-row-h\)/, "floor does not use the row height the rows are drawn at");
});

test("legend rows are sized by the token the floor computes from", () => {
	const row = /\.temp-chart-legend \.u-legend tr\s*\{([^}]*)\}/.exec(appCss);
	assert.ok(row, "no legend row rule");
	assert.match(row[1]!, /(^|[;{\s])height:\s*var\(--legend-row-h\)/,
		"rows must take --legend-row-h, or the floor's arithmetic describes nothing");
});

test("the chart component supplies --legend-rows from its series count", () => {
	assert.match(chartTsx, /"--legend-rows":\s*String\(props\.series\.length\)/,
		"without this the floor falls back to a fixed guess for every machine");
});

/**
 * AN AUTO MARGIN IS SLACK, NOT CONTENT — and contentRowSpan no longer has to
 * know that, because there is no longer one to discount.
 *
 * getComputedStyle resolves `margin: auto` to its USED value, so when
 * .card-head took `margin-bottom: auto` to push card contents to the bottom,
 * contentRowSpan began adding each card's own free space to its own content
 * sum — 333px of it on the sensors card. The reported minimum then equalled the
 * card's current height and cards would grow but never shrink back. A
 * `--absorbs-slack: 1` marker beside the margin bought that back by hand; this
 * test used to assert the pairing.
 *
 * #128 deleted the margin instead (card content is anchored to the TOP, slack
 * accumulates below it), so the marker had nothing left to mark and went with
 * it. contentRowSpan now sums margins unconditionally, which is correct exactly
 * as long as no direct child of a body carries a vertical auto margin —
 * test/panel-anchoring.test.ts is what holds that, and this assertion is the
 * measurement half of the same pairing, kept here so the two halves cannot be
 * deleted independently.
 */
test("contentRowSpan sums margins unconditionally, and no slack marker survives", () => {
	// The rule was deleted outright, so there may be no block at all — which is
	// the strongest form of the assertion, not a scanner failure.
	const heads = [...appCss.matchAll(/(^|[,}])\s*\.panel-body > \.card-head\s*\{([^}]*)\}/g)];
	for (const m of heads) {
		assert.doesNotMatch(m[2]!, /margin-bottom:\s*auto/,
			"the header must not absorb the card's free space above the body (#128)");
	}

	const canvas = readFileSync(
		fileURLToPath(new URL("../src/shell/panelCanvas.ts", import.meta.url)), "utf8");
	assert.doesNotMatch(canvas, /getPropertyValue\("--absorbs-slack"\)/,
		"a marker read here with nothing in the sheet setting it is a route back to the defect");
});

/**
 * #142 — THE MIRROR OF THE DEFECTS ABOVE: a slot that OVER-reports.
 *
 * Everything above this point stops content from lying that it is narrower than
 * it is. `.color-clash` lied the other way. It is the per-row advisory on the
 * Chart colours and Temperature Gradient cards ("close to Bed (ΔE 2.1)"), empty
 * in the ordinary session, and it was declared `flex: 0 0 calc(35 * var(--u))`
 * with `white-space: nowrap` — 140px of reserved width that a nowrap sentence
 * puts into the row's min-content whether or not there is a sentence to say. It
 * was 140 of the 360px those cards' bodies reported, so more than a third of
 * both cards' width stops was space for a message that is usually absent
 * (measured 2026-08-28: stops of 92 and 104 cells).
 *
 * The replacement keeps everything the fixed slot was bought for and pays for
 * none of it in min-content:
 *
 *   · the flex BASIS is still a fixed multiple of --u, so the box is the same
 *     width whether it is speaking or silent and nothing on the row moves as a
 *     message appears, changes length or clears;
 *   · `overflow-wrap: anywhere` is what actually removes it from the floor —
 *     plain wrapping would still contribute the longest WORD, and a heater
 *     called "Chamber" is 50px of it;
 *   · a wrapping slot that can grow a second line would move the card's ROW
 *     floor instead of its column floor, which is trading one defect for the
 *     other, so the height is reserved and is a whole number of its own lines
 *     (the `.env-status` discipline, one axis over);
 *   · and `min-width` is NOT zero: the slot keeps the width of its mark, so a
 *     clash that fires while the card sits at its floor is still visible rather
 *     than squeezed out of existence.
 *
 * Source assertions, like the rest of this file — there is no DOM here. The
 * measured stops are re-taken in the Card Lab and pinned in compose/defs.ts.
 */
const indexCss = stripComments(
	readFileSync(fileURLToPath(new URL("../src/index.css", import.meta.url)), "utf8"),
);

/** `calc(N * var(--u))`, `var(--ctl-h)` and bare `0` resolved to u-multiples. */
function uMultiple(value: string): number | null {
	const trimmed = value.trim();
	if (/^0$/.test(trimmed)) return 0;
	if (/^var\(--ctl-h\)$/.test(trimmed)) {
		const token = /--ctl-h:\s*calc\(([\d.]+)\s*\*\s*var\(--u\)\)/.exec(indexCss);
		return token ? Number(token[1]) : null;
	}
	const calc = /^calc\(([\d.]+)\s*\*\s*var\(--u\)\)$/.exec(trimmed);
	return calc ? Number(calc[1]) : null;
}

const decl = (body: string, prop: string): string | null => {
	const m = new RegExp(`(^|[;{\\s])${prop}:([^;]*)`).exec(body);
	return m ? m[2]!.trim() : null;
};

/**
 * The four properties that together take the slot out of the cards' min-content
 * without giving up what the fixed slot protected. Written over a rule body so
 * the red check below can run the same predicate against the DECLARATION IT
 * REPLACED and watch it fail — a source assertion that has never been shown to
 * fail is a sentence, not a check.
 */
function clashSlotFaults(body: string): string[] {
	const faults: string[] = [];
	if (/white-space:\s*nowrap/.test(body)) {
		faults.push("white-space: nowrap puts the whole sentence into the row's min-content");
	}
	if (!/overflow-wrap:\s*anywhere/.test(body)) {
		faults.push("no overflow-wrap: anywhere — the longest word still sets the card's floor");
	}
	const flex = decl(body, "flex");
	if (!flex || !/^0\s+[1-9]/.test(flex)) {
		faults.push(`flex must be 0 <shrink≥1> <basis> so the slot, and only the slot, gives: got ${flex}`);
	}
	const height = uMultiple(decl(body, "height") ?? "");
	const line = uMultiple(decl(body, "line-height") ?? "");
	if (height === null || line === null || line === 0) {
		faults.push("a wrapping slot must reserve an explicit height and line-height, or it moves the ROW floor");
	} else {
		const lines = height / line;
		if (!Number.isInteger(lines) || lines < 2) {
			faults.push(`reserved height must be a whole number of lines, at least 2: ${height}u / ${line}u`);
		}
	}
	const min = uMultiple(decl(body, "min-width") ?? "");
	if (min === null || min <= 0) {
		faults.push("min-width must be a positive u-multiple, or a clash fired at the card's floor is invisible");
	}
	return faults;
}

test(".color-clash is out of the cards' min-content and still says what it has to say", () => {
	assert.deepEqual(clashSlotFaults(ruleBody(".color-clash")), []);
});

test("red check — the declaration #142 replaced fails the same predicate", () => {
	// Verbatim shape of the pre-#142 rule: fixed slot, nowrap, no reserved
	// height, no floor for the mark.
	const before = `
		font-size: calc(3.25 * var(--u));
		flex: 0 0 calc(35 * var(--u));
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	`;
	const faults = clashSlotFaults(before);
	assert.ok(faults.length >= 4, `the old rule must fail this predicate; it reported: ${faults.join(" | ")}`);
});

/**
 * The mark is the half of Required behaviour 3 that CSS cannot hold: the slot
 * keeps a floor wide enough to draw it, and the body has to actually put the
 * state on the element for the floor to mean anything.
 */
test("the clash slot carries a state class, so a narrow card still shows that a clash fired", () => {
	const settings = readFileSync(
		fileURLToPath(new URL("../src/cards/SettingsCards.tsx", import.meta.url)), "utf8");
	const sites = [...settings.matchAll(/class=\{`?color-clash[^`"}]*/g)];
	assert.equal(sites.length, 2, "both colour cards' rows must set the slot's class reactively");
	for (const site of sites) {
		assert.match(site[0]!, /clash/, "the class must be derived from whether a clash fired");
	}
	assert.match(appCss, /\.color-clash\.speaking::before/,
		"the mark must be drawn from the state class, not from an element that is always there");
});
