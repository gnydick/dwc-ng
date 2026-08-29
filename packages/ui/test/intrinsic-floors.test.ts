import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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
 * THE STACKED FIELD (#138) — two call sites, one declaration, and a floor that
 * survives the stack.
 *
 * Gabe asked for the label above the input on exactly two cards, and when the
 * question was put to him whether every label/input pair should stack he
 * answered: "no, just the two i asked to stack". `.field` is used by thirteen
 * rows across two files, so the ruling is only checkable if the opt-in is a
 * named modifier rather than a change to the shared rule — and only STAYS
 * checkable if something counts the call sites. That is what these assertions
 * are: the mechanical form of a decision, so a later well-meaning edit that
 * spreads the modifier is a failing test rather than something discovered on
 * the printer.
 *
 * The floor half is the older lesson. `app.css`'s comment above the input rule
 * records the 2026-08-21 scale sweep, where an input with `min-width: 0` fell
 * back to Chromium's font-metric `size=20` default — a width carrying a fixed
 * non-`u` component, so it does not scale with `--u` and made five cards fail
 * card-floor-scale-invariant on the column axis. Bed probing and Camera URL
 * were two of the five. Stacking hands the input the whole card width, which
 * makes it very easy to decide the explicit width is no longer needed; it is,
 * and this says so.
 */
const settingsTsx = readFileSync(
	fileURLToPath(new URL("../src/cards/SettingsCards.tsx", import.meta.url)), "utf8");

test("the stacked field is ONE declaration, not a per-card style", () => {
	const rules = cssRulesFor("field-stacked");
	assert.ok(rules.length > 0, "no .field-stacked rule in app.css — the modifier has no home");
	// The geometry is what must not be duplicated: exactly one rule may set the
	// direction, whatever else extends it.
	const directional = rules.filter(r => /flex-direction:/.test(r.body));
	assert.equal(directional.length, 1,
		`the stack direction is declared ${directional.length} times; two copies of a geometry drift`);
});

test("the stacked field opts IN at exactly the two cards Gabe named", () => {
	const hits = [...settingsTsx.matchAll(/class="field field-stacked"/g)];
	assert.equal(hits.length, 2, `field-stacked is on ${hits.length} rows in SettingsCards.tsx, not 2`);
	// Named, not merely counted: two hits in the wrong two cards is the same
	// number and a different app.
	for (const body of ["BedProbeBody", "CameraConfigBody"]) {
		const start = settingsTsx.indexOf(`export function ${body}(`);
		assert.ok(start > 0, `${body} not found`);
		const end = settingsTsx.indexOf("\nexport function ", start + 1);
		const src = settingsTsx.slice(start, end === -1 ? undefined : end);
		assert.match(src, /class="field field-stacked"/, `${body} does not carry the stacked modifier`);
	}
	// And nowhere else in the app.
	const systemTsx = readFileSync(
		fileURLToPath(new URL("../src/cards/SystemCards.tsx", import.meta.url)), "utf8");
	assert.doesNotMatch(systemTsx, /field-stacked/, "the modifier leaked out of Settings");
});

test("the stacked input keeps an explicit width floor", () => {
	// The floor may sit on the shared input rule or on the stacked override;
	// what must not happen is the override REMOVING it (width: auto with no
	// min-width hands the browser's size=20 default back to the card's floor).
	const shared = cssRulesFor("field").find(r => /input\[type="text"\]/.test(r.sel));
	assert.ok(shared, "no .field input[type=text] rule");
	assert.match(shared.body, /min-width:\s*var\(--field-input-w\)/,
		"the shared input rule lost its declared min-width");
	// And the token it points at is a multiple of the global unit, not a px
	// literal — a floor that does not scale is the defect this replaced.
	const token = /--field-input-w:\s*calc\([\d.]+\s*\*\s*var\(--u\)\)/.exec(appCss);
	assert.ok(token, "--field-input-w is not declared as n x --u");
	for (const r of cssRulesFor("field-stacked")) {
		assert.doesNotMatch(r.body, /(^|[;{\s])min-width:\s*0/,
			`${r.sel} zeroes the input's min-width — the card's floor becomes the browser's size=20 default`);
	}

	// A CEILING, IF ONE IS EVER DECLARED, MUST CLEAR THE FLOOR.
	//
	// This is carried here on purpose. #144 caps the same rule at 88u and
	// asserts the same property, but it reads min-width by matching
	// `calc(n * var(--u))` literally — and the floor is a token now, so once
	// both land its cap-vs-floor comparison silently finds nothing to compare
	// and stops firing. Reading the token's own value keeps the check alive
	// through that merge instead of leaving it to be noticed later.
	const maxDecl = /(^|[;{\s])max-width:([^;]*)/.exec(shared.body);
	if (maxDecl) {
		const cap = /calc\(\s*([\d.]+)\s*\*\s*var\(--u\)\s*\)/.exec(maxDecl[2]!);
		assert.ok(cap, `the input's max-width ${maxDecl[2]!.trim()} is not a calc(n * var(--u))`);
		const floor = Number(/--field-input-w:\s*calc\(([\d.]+)/.exec(appCss)![1]);
		assert.ok(Number(cap[1]) >= floor,
			`the input caps at ${cap[1]}u, under its own ${floor}u floor — a box with max-width below min-width`);
	}
});

/** Every rule whose selector list mentions `token` as a whole class name. */
function cssRulesFor(token: string): Array<{ sel: string; body: string }> {
	const re = new RegExp(`(^|[^-\w])\.${token}(?![-\w])`);
	return [...appCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
		.map(m => ({ sel: m[1]!.trim(), body: m[2]! }))
		.filter(r => re.test(r.sel));
}

/**
 * THE SHOCK-ABSORBER RULE, and why it is a source assertion rather than a fix.
 *
 * `.panel-body` is a flex COLUMN. A child with no flex declaration is
 * `flex: 0 1 auto` — shrink 1 — and CSS gives a flex item an automatic minimum
 * size of `min-content` ONLY while its overflow is `visible`. Declare
 * `overflow: hidden` and that automatic minimum becomes 0, so the child can be
 * squeezed to nothing before anything else in the card gives way. It is silent:
 * the box vanishes, the text with it, and the card looks merely "tight".
 *
 * `.shp-caveat` shipped that way and rendered at ZERO PIXELS at the Sweep
 * card's own registry size — its two declared lines were invisible on every
 * browser, not only after a resize (#136, measured 2026-08-28 headless: 32px at
 * rowSpan 200, 4px at 124, 0px at the coded pin 118).
 *
 * The second-order damage is the reason this is a rule and not a one-line fix.
 * contentRowSpan (shell/panelCanvas.ts) sums each child's RENDERED height, so a
 * child that shrinks with the card makes the card's own floor a function of the
 * card's own size — the `card-floor-independent-of-size` hysteresis
 * (dev/layoutAudit.ts). Measured on this card: rowStop 129 at rowSpan 200 and
 * 121 at rowSpan 118. A floor enforced from that measurement enforces a number
 * the shrink itself moved.
 *
 * The guard asked for is a floor, in either of the two forms that are honest
 * about which axis they defend:
 *   · `min-height` — correct in EVERY context, because it names the axis that
 *     collapses. Required for anything that is a flex ROW item, where
 *     `flex-shrink: 0` would wrongly freeze the INLINE axis (.fb-progress is
 *     `flex: 1` and must shrink; .shp-thread-why is `flex: 1 1 auto` with a
 *     declared `width: 0`).
 *   · `flex-shrink: 0` / `flex: 0 0 …` — for a row of a card body, where not
 *     shrinking on the block axis IS the intent and the siblings already say so
 *     (.shp-decay-filter, .shp-batch, .shp-sweep-bar).
 *
 * This cannot prove a floor is the RIGHT number; it stops a fixed-height
 * clipped box being written with no floor at all, which is the one thing that
 * was written four separate times before anybody measured it.
 */
const HEIGHT_DECL = /(^|[;{\s])height:\s*([^;]+)/;
const CLIPS = /(^|[;{\s])overflow(-y)?:\s*[^;]*hidden/;
const HAS_FLOOR = /flex-shrink:\s*0|flex:\s*0\s+0|(^|[;{\s])min-height:\s*(?!auto|0[;\s}])/;

/** Every `sel { … }` block in app.css, comments already stripped. */
const flatCssRules = (): Array<{ sel: string; body: string }> =>
	[...appCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1]!.trim(), body: m[2]! }));

test("a fixed-height clipped box declares a floor — it cannot be a card's shock absorber", () => {
	const clipped = flatCssRules().filter(r => HEIGHT_DECL.test(r.body) && CLIPS.test(r.body));
	// The assertion that makes this real: a scanner that matches nothing passes
	// everything. Same construction as the contain: inline-size guard above.
	assert.ok(clipped.length >= 10, `only ${clipped.length} fixed-height clipped rules found — has the scanner stopped matching?`);
	const unguarded = clipped.filter(r => !HAS_FLOOR.test(r.body)).map(r => r.sel);
	assert.deepEqual(unguarded, [],
		`these declare a fixed height and clip, but no min-height and no flex-shrink: 0 — ` +
		`in a flex column each one can be squeezed to zero and take the card's floor with it: ${unguarded.join(" · ")}`);
});

/**
 * The four rows of the Shaping cards that share this geometry, pinned BY NAME.
 * The general scan above catches a new rule; this catches a guard being dropped
 * from one of the four that are known to need it, which the general scan would
 * report as one line in a list nobody reads twice.
 */
for (const sel of [".shp-caveat", ".shp-sweep-note", ".shp-batch-note", ".shp-listing-note"]) {
	test(`${sel} still declares its floor`, () => {
		// The CASCADE, not one block: the three note rules share their geometry
		// and their `flex: 0 0 auto` in one rule, and .shp-sweep-note then
		// overrides only the height. Requiring each block to restate the floor
		// would be asking for the bound in two places, which is the drift this
		// file exists to stop.
		const owning = flatCssRules().filter(r => r.sel.split(",").some(s => s.trim() === sel));
		assert.ok(owning.some(r => HEIGHT_DECL.test(r.body)), `no rule declares a height for ${sel}`);
		assert.ok(owning.some(r => HAS_FLOOR.test(r.body)),
			`${sel} declares a height and clips, but nothing in its cascade declares a floor`);
	});
}

/**
 * #142 — THE MIRROR OF THE DEFECTS ABOVE: a slot that OVER-reports.
 *
 * Everything above this point stops content from lying that it is narrower than
 * it is. `.color-clash` lied the other way. It is the per-row advisory on the
 * Chart colours and Temperature Gradient cards ("close to Bed (ΔE 2.1)"), empty
 * in the ordinary session, and it was declared `flex: 0 0 calc(35 * var(--u))`
 * — a slot that CANNOT SHRINK, so its whole 140px basis went into the row's
 * min-content whether or not there was a sentence to say. It was 140 of the
 * 360px those cards' bodies reported (stops of 92 and 104 cells).
 *
 * WHICH PROPERTY DOES THE WORK WAS MEASURED, not reasoned about, and the answer
 * is not the one #142's first round wrote down. Driving the mock in Edge on
 * 2026-08-28 and forcing one declaration at a time against the Accelerometers
 * card's contentColSpan:
 *
 *   baseline                                   132 cells (518.8px)
 *   + white-space: nowrap on .accel-reply      132        (518.8)
 *   + overflow-wrap: normal on both slots      132        (518.8)
 *   + overflow: visible on both slots          132        (518.8)
 *   + flex-shrink 1 -> 0 on .accel-reply       198        (780.8)
 *   + min-width: auto on .accel-reply          119        (468.0)
 *
 * So a shrinkable flex item's contribution to its row's min-content is its
 * declared `min-width` and nothing else — the text properties do not enter into
 * it, and the earlier claim that "`overflow-wrap: anywhere` is what actually
 * removes it from the floor" is FALSE. Two things hold the floor:
 *
 *   · `flex-shrink` >= 1, so the slot gives instead of holding the row open at
 *     its basis. That is the whole of the original defect, and the only change
 *     above that moves the number by sixty-six cells; and
 *   · a declared, positive `min-width`, which is then EXACTLY what the slot
 *     costs the card. A reader can add these up.
 *
 * The rest of the discipline is still required, for reasons that are about
 * LEGIBILITY rather than about the floor, and the predicate below says so:
 *
 *   · the flex BASIS is a fixed multiple of --u, so the box is the same width
 *     whether it is speaking or silent and nothing on the row moves as a
 *     message appears, changes length or clears;
 *   · the height is reserved at a whole number of the slot's own lines — a slot
 *     that could grow a line would move the card's ROW floor instead, which is
 *     trading one defect for its mirror;
 *   · `overflow: hidden` with `overflow-wrap: anywhere` and no `nowrap`, so a
 *     message too long for the box wraps INTO the reserved lines rather than
 *     running off the end of one of them;
 *   · and `-webkit-line-clamp` at exactly the reserved line count, so the last
 *     reserved line ends in an ellipsis and a cut message says it was cut
 *     (Gabe, 2026-08-28: "put the ellipsis back"). `text-overflow: ellipsis`
 *     cannot do this job — it fires only beside `white-space: nowrap`, which is
 *     the one property these slots may not have.
 *
 * Source assertions, like the rest of this file — there is no DOM here. The
 * measured stops are re-taken in the Card Lab and pinned in compose/defs.ts.
 */
const indexCss = stripComments(
	readFileSync(fileURLToPath(new URL("../src/index.css", import.meta.url)), "utf8"),
);

/**
 * `calc(N * var(--u))`, bare `0`, and any `var(--token)` whose own definition in
 * index.css or app.css is a u-multiple. Anything else is null.
 *
 * The token arm is not decoration. #138 turns `.field input`'s `min-width` into
 * `var(--field-input-w)`; a matcher that only understood the literal calc form
 * would silently find nothing to compare against the moment that landed. This
 * function is written identically here and in #144's section of this file so
 * the two branches merge to ONE copy rather than to two near-duplicates.
 */
function uMultiple(value: string | null): number | null {
	if (value === null) return null;
	const trimmed = value.trim();
	if (/^0$/.test(trimmed)) return 0;
	const token = /^var\((--[a-z0-9-]+)\)$/.exec(trimmed);
	if (token !== null) {
		const def = new RegExp(`${token[1]}:\\s*calc\\(\\s*([\\d.]+)\\s*\\*\\s*var\\(--u\\)\\s*\\)`)
			.exec(indexCss + appCss);
		return def === null ? null : Number(def[1]);
	}
	const calc = /^calc\(\s*([\d.]+)\s*\*\s*var\(--u\)\s*\)$/.exec(trimmed);
	return calc ? Number(calc[1]) : null;
}

/**
 * The LAST declaration of `prop` in a body, or null if it is not declared.
 *
 * Last, not first, because these bodies are CASCADES: effectiveBody() below
 * concatenates every rule that applies to one rendered element, in source
 * order, and at equal specificity the later declaration is the one the browser
 * uses. Reading the first is how `.accel-reply`'s override of `.accel-status`'s
 * flex stayed invisible to this file.
 */
function decl(body: string, prop: string): string | null {
	const all = [...body.matchAll(new RegExp(`(?:^|[;{\\s])${prop}:([^;}]*)`, "g"))];
	return all.length === 0 ? null : all[all.length - 1]![1]!.trim();
}

interface CssRule {
	readonly selectors: readonly string[];
	readonly body: string;
	/** The at-rule this sits inside, if any — reported so a fault found only
	 *  inside a breakpoint block names the breakpoint. */
	readonly at: string | null;
}

/** Every declaration block in app.css, in source order, with its at-rule. */
function cssRules(css: string): CssRule[] {
	const rules: CssRule[] = [];
	const stack: string[] = [];
	let i = 0;
	let start = 0;
	while (i < css.length) {
		const ch = css[i];
		if (ch === "{") {
			const prelude = css.slice(start, i).trim();
			if (prelude.startsWith("@")) {
				stack.push(prelude);
				i += 1;
				start = i;
				continue;
			}
			const end = css.indexOf("}", i);
			if (end === -1) break;
			rules.push({
				selectors: prelude.split(",").map(s => s.trim()).filter(s => s !== ""),
				body: css.slice(i + 1, end),
				at: stack.length === 0 ? null : stack[stack.length - 1]!,
			});
			i = end + 1;
			start = i;
			continue;
		}
		if (ch === "}") {
			stack.pop();
			i += 1;
			start = i;
			continue;
		}
		i += 1;
	}
	return rules;
}

/** Every class name app.css writes a rule for. Used to tell a class token from
 *  an ordinary identifier when reading a `class=` expression out of TSX. */
const CSS_CLASSES = new Set([...appCss.matchAll(/\.([a-z][a-z0-9-]*)/g)].map(m => m[1]!));

/**
 * THE SLOTS, DERIVED FROM THE SHEET rather than listed in this file.
 *
 * #142's first round kept a `RESERVED_SLOTS` array here, and its own @debt said
 * exactly what that was: enumeration standing in for a sweep. An enumerated
 * list cannot be wrong about a slot it does not contain, which is precisely the
 * failure it had — `.accel-reply` overrides `.accel-status`'s flex and was
 * never checked.
 *
 * The mark rule is the ONE declaration in app.css that draws what a reserved
 * slot keeps at the card's floor, and every such slot's `min-width` exists to
 * hold that mark. A slot missing from it reserves width for something it does
 * not draw. So the mark rule's selector list IS the set of slots, and a fourth
 * slot cannot come into existence without joining it.
 */
function reservedSlotClasses(): string[] {
	const mark = cssRules(appCss).filter(r => r.selectors.some(s => s.endsWith(".speaking::before")));
	assert.equal(mark.length, 1,
		"the mark must be drawn by exactly ONE rule — two copies are two numbers that have to agree about how wide 'the mark' is");
	return mark[0]!.selectors.map(s => {
		const m = /^\.([a-z][a-z0-9-]*)\.speaking::before$/.exec(s);
		assert.ok(m !== null, `${s} is not of the form "<slot>.speaking::before"`);
		return m![1]!;
	});
}

interface SlotVariant {
	/** The class list this element actually renders with. */
	readonly classes: ReadonlySet<string>;
	/** Where it is written, for the failure message. */
	readonly where: string;
}

/**
 * Every class list the app actually renders a reserved slot with.
 *
 * This is the dimension an enumerated list of base classes could not have:
 * `.accel-status` and `.accel-status.accel-reply` are two different cascades,
 * and only the first was ever checked. Read out of the TSX, so a new co-class
 * arrives here by being WRITTEN rather than by someone remembering to add it.
 */
function slotVariants(): SlotVariant[] {
	const base = reservedSlotClasses();
	const dir = new URL("../src/", import.meta.url);
	const files = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter(f => f.endsWith(".tsx"));
	const found: SlotVariant[] = [];
	const seen = new Set<string>();
	for (const rel of files) {
		const text = readFileSync(new URL(rel.replaceAll("\\", "/"), dir), "utf8");
		// A reserved slot may not be built through classList: this reads the
		// STATIC class list, so a conditionally added class whose rule changed
		// the shape would be invisible to it. Refuse rather than under-report.
		for (const b of base) {
			assert.doesNotMatch(text, new RegExp(`classList=\\{\\{[^}]*${b}`),
				`${rel} adds ${b} through classList; this check reads static class lists only`);
		}
		for (const m of text.matchAll(/class=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
			const expr = m[1] ?? m[2] ?? "";
			const classes = new Set(
				[...expr.matchAll(/[A-Za-z][A-Za-z0-9_-]*/g)].map(t => t[0]!).filter(t => CSS_CLASSES.has(t)),
			);
			if (!base.some(b => classes.has(b))) continue;
			const key = [...classes].sort().join(".");
			if (seen.has(key)) continue;
			seen.add(key);
			found.push({ classes, where: `${rel}: class=${expr.slice(0, 60)}` });
		}
	}
	return found;
}

/**
 * Does this selector apply to an element carrying exactly these classes?
 *
 * Plain class compounds only. Anything with a combinator, an element name, an
 * attribute or a pseudo is conditional on something this file cannot see, and
 * is left OUT rather than guessed at — which is a known hole, recorded on the
 * declaration in app.css.
 */
function appliesTo(selector: string, classes: ReadonlySet<string>): boolean {
	if (!/^(?:\.[a-z][a-z0-9-]*)+$/.test(selector)) return false;
	return [...selector.matchAll(/\.([a-z][a-z0-9-]*)/g)].every(m => classes.has(m[1]!));
}

/** Every rule that applies to one rendered class list, concatenated in source
 *  order — the cascade, which is what the element actually gets. */
function effectiveBody(classes: ReadonlySet<string>): { body: string; from: string[] } {
	const from: string[] = [];
	const parts: string[] = [];
	for (const rule of cssRules(appCss)) {
		if (!rule.selectors.some(s => appliesTo(s, classes))) continue;
		parts.push(rule.body);
		from.push(rule.selectors.join(", ") + (rule.at === null ? "" : ` inside ${rule.at}`));
	}
	return { body: parts.join(";\n"), from };
}

/**
 * The shape a reserved slot must have. Written over a BODY so the red checks
 * below can run the same predicate over declarations that must fail it — a
 * source assertion that has never been shown to fail is a sentence.
 */
function slotFaults(body: string): string[] {
	const faults: string[] = [];

	// --- the column floor, which is these two declarations and nothing else
	const flex = decl(body, "flex");
	const shape = flex === null ? null : /^([\d.]+)\s+([\d.]+)\s+(.+)$/.exec(flex);
	if (shape === null) {
		faults.push(`flex must be "<grow> <shrink> <basis>" so the shrink factor is visible: got ${flex}`);
	} else {
		if (Number(shape[2]) < 1) {
			faults.push(`flex-shrink is ${shape[2]}: a slot that cannot shrink puts its whole ${shape[3]} basis into the card's min-content`);
		}
		if (uMultiple(shape[3]!) === null) {
			faults.push(`flex-basis ${shape[3]} is not a fixed u-multiple, so the box would size to whatever it is saying`);
		}
	}
	const min = uMultiple(decl(body, "min-width"));
	if (min === null || min <= 0) {
		faults.push("min-width must be a positive u-multiple: on a shrinkable slot that number IS its whole contribution to the card's floor");
	}

	// --- the row floor
	const height = uMultiple(decl(body, "height"));
	const line = uMultiple(decl(body, "line-height"));
	let lines: number | null = null;
	if (height === null || line === null || line === 0) {
		faults.push("a wrapping slot must reserve an explicit height and line-height, or it moves the ROW floor");
	} else {
		lines = height / line;
		if (!Number.isInteger(lines) || lines < 2) {
			faults.push(`reserved height must be a whole number of lines, at least 2: ${height}u / ${line}u`);
		}
	}

	// --- legibility inside the reserved box
	if (!/overflow:\s*hidden/.test(body)) {
		faults.push("overflow: hidden — the reserved box must clip what will not fit, not spill it across the row");
	}
	if (/white-space:\s*nowrap/.test(body)) {
		faults.push("white-space: nowrap — a message longer than the box runs off ONE line instead of wrapping into the reserved lines");
	}
	if (!/overflow-wrap:\s*anywhere/.test(body)) {
		faults.push('no overflow-wrap: anywhere — one long word ("board.device") overflows the box rather than breaking inside it');
	}
	const clamp = decl(body, "-webkit-line-clamp");
	const boxed = /display:\s*-webkit-box/.test(body) && /-webkit-box-orient:\s*vertical/.test(body);
	if (clamp === null || !boxed) {
		faults.push("no ellipsis: a WRAPPED box is ellipsed by display:-webkit-box + -webkit-box-orient:vertical + -webkit-line-clamp, never by text-overflow, which fires only beside the nowrap this slot may not have");
	} else if (lines !== null && Number(clamp) !== lines) {
		faults.push(`-webkit-line-clamp is ${clamp} but ${lines} lines are reserved: the ellipsis must land on the last line the slot actually has`);
	}
	return faults;
}

const SLOT_VARIANTS = slotVariants();

test("the reserved slots are derived from the sheet, and the derivation found something", () => {
	const base = reservedSlotClasses();
	assert.ok(base.length >= 2, `the mark rule names ${base.length} slot(s) — has it been split?`);
	for (const b of base) {
		assert.ok(SLOT_VARIANTS.some(v => v.classes.has(b)),
			`.${b} is declared a reserved slot but nothing renders it — a rule for an element that does not exist`);
	}
	// The whole reason the markup is read: at least one slot renders with a
	// SECOND class whose rule joins its cascade. A check that could only see
	// base classes would be exactly as blind as the list it replaced.
	assert.ok(SLOT_VARIANTS.some(v => v.classes.size > 1),
		"no multi-class reserved slot found — this check would then be no stronger than the list it replaced");
});

for (const variant of SLOT_VARIANTS) {
	const name = [...variant.classes].map(c => `.${c}`).join("");
	test(`reserved slot ${name} is out of the cards' min-content and still says what it has to say`, () => {
		const { body, from } = effectiveBody(variant.classes);
		assert.ok(from.length > 0, `${variant.where}: no rule in app.css applies to ${name}`);
		assert.deepEqual(slotFaults(body), [], `${variant.where}\ncascade: ${from.join(" | ")}`);
	});
}

test("red check — the declaration #142 replaced fails the same predicate", () => {
	// Verbatim shape of the pre-#142 rule: a slot that cannot shrink, no floor
	// for the mark, no reserved height, nowrap, and an ellipsis that worked only
	// BECAUSE of that nowrap.
	const before = `
		font-size: calc(3.25 * var(--u));
		flex: 0 0 calc(35 * var(--u));
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	`;
	const faults = slotFaults(before);
	assert.ok(faults.length >= 5, `the old rule must fail this predicate; it reported: ${faults.join(" | ")}`);
	assert.ok(faults.some(f => /flex-shrink is 0/.test(f)),
		"the shrink factor is the fault that was worth 66 cells, and it must be named as such");
});

/**
 * THE CASCADE IS ACTUALLY READ, stated as something that would be FALSE if it
 * were not.
 *
 * `.accel-reply` is applied together with `.accel-status` and overrides its
 * flex. #142's first round asserted over ONE rule body, so the value of `flex`
 * this element ships with was never the value the check looked at, and both
 * bypasses below passed a green suite.
 */
test("red check — an override on a co-class is what the predicate sees, not the base rule", () => {
	const reply = SLOT_VARIANTS.find(v => v.classes.has("accel-reply"));
	assert.ok(reply !== undefined, "the board-reply slot is missing from the markup");
	const merged = decl(effectiveBody(reply!.classes).body, "flex");
	const base = decl(ruleBody(".accel-status"), "flex");
	assert.notEqual(merged, base,
		"the reply's own flex must win over .accel-status's — if these are equal, the merge is not merging");
	assert.match(String(merged), /^1 1 /, "the reply is the one item on the row allowed to grow");

	// The two bypasses a per-rule read let through, each now shown to fail. Both
	// were measured on the mock: the first is inert on the floor but destroys
	// the wrap, the second cost 66 cells (132 -> 198).
	const body = effectiveBody(reply!.classes).body;
	assert.ok(slotFaults(`${body};white-space: nowrap;`).some(f => /nowrap/.test(f)),
		"a nowrap added on the co-class must be a fault");
	assert.ok(slotFaults(`${body};flex: 1 0 calc(80 * var(--u));`).some(f => /flex-shrink is 0/.test(f)),
		"an unshrinkable co-class must be a fault");
});

test("red check — a slot with no floor, and one whose ellipsis does not reach its last line", () => {
	const clash = SLOT_VARIANTS.find(v => v.classes.has("color-clash"));
	assert.ok(clash !== undefined, "the clash slot is missing from the markup");
	const good = effectiveBody(clash!.classes).body;
	assert.deepEqual(slotFaults(good), [], "the fixture these two checks are built from must itself be clean");
	assert.ok(slotFaults(`${good};min-width: 0;`).some(f => /min-width/.test(f)),
		"a slot that may shrink to nothing has no floor at all");
	assert.ok(slotFaults(`${good};-webkit-line-clamp: 1;`).some(f => /line-clamp is 1/.test(f)),
		"an ellipsis on line 1 of a 2-line box hides the second line without a cue");
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
