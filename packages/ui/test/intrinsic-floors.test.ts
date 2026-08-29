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
 * #144 — THE OTHER END OF THE SAME PRINCIPLE.
 *
 * Everything above stops content lying that it is NARROWER than it is. This
 * stops a field growing without any limit at all.
 *
 * Gabe, 2026-08-28: "'camera url' and 'bed probing' cards have a common
 * problem. their text input field grows infinitely if the card is stretched
 * sideways, there should be some reasonable limit to use for display". He is
 * right that it is one problem, and it is narrower than one problem: it is ONE
 * declaration. `.field input[type="text"], .field input[type="number"]` sets
 * `flex: 1` (= `1 1 0%`), so every such input takes all the free space in its
 * row. The line directly below caps NUMBER inputs at 22.5u. Text inputs were
 * never given a cap, and there were thirteen of them across four cards —
 * measured on the mock at the coded spans: Axis roles 7 x 516px, Camera URL
 * 497px, Bed probing 429px, Sensor names 4 x ~512px, every one of them growing
 * linearly with the card to over 1500px at colSpan 420.
 *
 * The assertion below is deliberately NOT "the text rule has a max-width". That
 * would pin the thirteen symptoms and say nothing about the fourteenth field
 * someone adds next month. It is the RULE SHAPE: a `.field` input that can GROW
 * must also say where it stops. A new uncapped growing field fails the suite
 * rather than being discovered by an operator dragging a card.
 *
 * WHAT THE SCANNER CAN AND CANNOT SEE, stated because the first version of this
 * file overstated it, and in three separate ways.
 *
 *   1. Its filter looked for the word `input` beside `.field` in a selector, so
 *      an input styled by CLASS alone was outside its field of view entirely.
 *      `.pin-cmd`, `.om-filter` and `.shp-run-name` are growing text inputs
 *      with no ceiling and it could never have seen any of them. The scan now
 *      reads every class the app actually puts on an <input> or <textarea>
 *      (out of the TSX, because a stylesheet cannot tell an input's class from
 *      a div's) and a selector whose rightmost compound is made of those
 *      classes is an input rule.
 *   2. It read ONE rule body, so a `max-width: none` written under a capped
 *      rule would have gone on reporting the cap. Same-selector rules are now
 *      merged in source order and the LAST declaration is the one read.
 *   3. `max-width: none` was a pass — it is not null, so the "declares no
 *      max-width" arm did not fire, and the u-multiple arm was only reached for
 *      rules that grow. A max-width that is not a length in --u is now a fault
 *      on any input rule, growing or not, because that is exactly the shape a
 *      cap is removed in.
 *
 * A comma list is also split before any of this: it is shorthand for several
 * rules, and treating it as one is how `.field input[type="number"]`'s 22.5u
 * cap came to satisfy a check about `.field input[type="text"]`.
 *
 * The twelve growing inputs OUTSIDE `.field` are counted, not fixed. Capping
 * them is a change to the console, the OM inspector, the Card Studio, the file
 * browser and the Shaping Lab that nobody has asked for, so they are held at a
 * committed number that cannot rise silently and are named on the declaration
 * in app.css so they can be worked through deliberately.
 */

/** Every class name app.css writes a rule for. */
const CSS_CLASSES = new Set([...appCss.matchAll(/\.([a-z][a-z0-9-]*)/g)].map(m => m[1]!));

const indexCss = stripComments(
	readFileSync(fileURLToPath(new URL("../src/index.css", import.meta.url)), "utf8"),
);

/**
 * `calc(N * var(--u))`, bare `0`, and any `var(--token)` whose own definition in
 * index.css or app.css is a u-multiple. Anything else is null.
 *
 * The token arm is not decoration. #138 turns this rule's `min-width` into
 * `var(--field-input-w)`; a matcher that only understood the literal calc form
 * would silently find nothing to compare the cap against the moment that
 * landed, and the cap-below-floor check would stop firing while still passing.
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
 * Last, not first, because these bodies are CASCADES: cascadeFor() below
 * concatenates every rule written with the same selector, in source order, and
 * the later declaration is the one the browser uses. Reading the first is how a
 * `max-width: none` written under a capped rule would go on reporting the cap
 * that no longer applies.
 */
function decl(body: string, prop: string): string | null {
	const all = [...body.matchAll(new RegExp(`(?:^|[;{\\s])${prop}:([^;}]*)`, "g"))];
	return all.length === 0 ? null : all[all.length - 1]![1]!.trim();
}

/**
 * Does this rule body let the element GROW? `flex-grow: n` directly, or the
 * grow component of the `flex` shorthand — `flex: 1` is `1 1 0%`, which is the
 * form the defect was written in, so reading only `flex-grow` would have missed
 * every instance of it.
 */
function growsBy(body: string): number {
	const explicit = decl(body, "flex-grow");
	if (explicit !== null) return Number(explicit) || 0;
	const short = decl(body, "flex");
	if (short === null) return 0;
	if (/^none$/.test(short)) return 0;
	if (/^auto$/.test(short)) return 1;
	const first = /^([\d.]+)/.exec(short);
	return first ? Number(first[1]) : 0;
}

interface Rule { readonly selector: string; readonly body: string }

/** Every rule in app.css, SPLIT so one entry is one selector. */
const ALL_RULES: Rule[] = [...appCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
	.flatMap(m => m[1]!.split(",").map(s => ({ selector: s.trim(), body: m[2]! })))
	.filter(r => r.selector !== "");

/** Every class the app actually puts on an <input> or a <textarea>. */
function inputClasses(): Set<string> {
	const dir = new URL("../src/", import.meta.url);
	const found = new Set<string>();
	for (const rel of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
		if (!rel.endsWith(".tsx")) continue;
		const text = readFileSync(new URL(rel.replaceAll("\\", "/"), dir), "utf8");
		for (const tag of text.matchAll(/<(?:input|textarea)\b/g)) {
			const rest = text.slice(tag.index!, tag.index! + 800);
			const end = rest.search(/\/>|>/);
			const open = rest.slice(0, end === -1 ? undefined : end);
			for (const c of open.matchAll(/class=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
				for (const t of (c[1] ?? c[2] ?? "").matchAll(/[A-Za-z][A-Za-z0-9_-]*/g)) {
					if (CSS_CLASSES.has(t[0]!)) found.add(t[0]!);
				}
			}
		}
	}
	return found;
}

const INPUT_CLASSES = inputClasses();

/** Does this one selector target an input? Either it names the element, or its
 *  rightmost compound is made only of classes the markup puts on inputs. */
function targetsInput(selector: string): boolean {
	if (/\b(?:input|textarea)\b/.test(selector)) return true;
	const last = selector.split(/[\s>+~]+/).filter(s => s !== "").pop() ?? "";
	if (!/^(?:\.[a-z][a-z0-9-]*)+$/.test(last)) return false;
	return [...last.matchAll(/\.([a-z][a-z0-9-]*)/g)].every(m => INPUT_CLASSES.has(m[1]!));
}

/** Every selector in app.css that styles an input, with its body. */
function inputRules(): Rule[] {
	return ALL_RULES.filter(r => targetsInput(r.selector));
}

/** The selectors that reach a `.field` input — what this invariant FAILS on. */
const isFieldInput = (selector: string): boolean => /\.field\b/.test(selector) && targetsInput(selector);

/**
 * One selector's declarations plus those of every LATER rule written with the
 * SAME selector, so a cap removed further down the sheet is seen.
 *
 * Identical selectors only — a full cascade needs specificity and the DOM, and
 * approximating it here would report faults that do not exist. What it closes
 * is the shape that actually occurs in this sheet: the same selector written
 * twice, the second time to override.
 */
function cascadeFor(rule: Rule): string {
	const start = ALL_RULES.indexOf(rule);
	// A rule the red checks construct is not in the sheet and has no cascade —
	// it is exactly its own body. Without this, `indexOf` returning -1 merges
	// the WHOLE sheet into the fixture and the red checks quietly stop testing
	// what they name.
	if (start === -1) return rule.body;
	return ALL_RULES.filter((r, i) => i >= start && r.selector === rule.selector).map(r => r.body).join(";");
}

/** The predicate itself, so the red checks below can run it over bodies that
 *  must fail it. A source assertion never shown to fail is a sentence. */
function unboundedGrowth(rules: readonly Rule[]): string[] {
	const faults: string[] = [];
	for (const rule of rules) {
		const body = cascadeFor(rule);
		// A cap that is not a length in this sheet's own unit is not a cap. This
		// is checked whether or not the rule grows, because `max-width: none`
		// written under a capped rule is exactly how a cap gets removed.
		const declared = decl(body, "max-width");
		if (declared !== null && uMultiple(declared) === null) {
			faults.push(`${rule.selector} declares max-width: ${declared}, which is not a length in --u — "none", "100%" and "unset" are not ceilings`);
			continue;
		}
		if (growsBy(body) <= 0) continue;
		if (declared === null) {
			faults.push(`${rule.selector} can grow (flex-grow ${growsBy(body)}) and declares no max-width`);
			continue;
		}
		// Required behaviour 5: the cap may never fall under the floor. Both are
		// u-multiples, so this is arithmetic on the source and holds at EVERY
		// scale step at once — `max-width < min-width` is a silently broken box.
		const maxU = uMultiple(declared)!;
		const minU = uMultiple(decl(body, "min-width"));
		if (minU !== null && maxU < minU) {
			faults.push(`${rule.selector} caps at ${maxU}u below its own ${minU}u floor`);
		}
	}
	return faults;
}

test("a .field input that can grow declares where it stops", () => {
	const rules = inputRules().filter(r => isFieldInput(r.selector));
	// The scanner must not pass by matching nothing.
	assert.ok(rules.length >= 4, `only ${rules.length} .field input rules found — has the sheet changed shape?`);
	assert.ok(rules.some(r => growsBy(r.body) > 0), "no growing .field input rule found — the scanner is reading nothing");
	assert.deepEqual(unboundedGrowth(rules), []);
});

/**
 * THE SCAN REACHES INPUTS STYLED BY CLASS ALONE, held at a COUNT rather than
 * fixed — see the note at the top of this section for why capping them is not
 * this branch's to do.
 */
const UNCAPPED_NON_FIELD_INPUTS = 11;

test("no NEW uncapped growing input appears outside .field", () => {
	const outside = inputRules().filter(r => !isFieldInput(r.selector));
	assert.ok(outside.length > 0, "the scan sees no non-.field input rules at all — it has stopped reading the sheet");
	const uncapped = outside.filter(r => growsBy(cascadeFor(r)) > 0 && decl(cascadeFor(r), "max-width") === null);
	assert.ok(uncapped.length <= UNCAPPED_NON_FIELD_INPUTS,
		`${uncapped.length} uncapped growing inputs outside .field, up from ${UNCAPPED_NON_FIELD_INPUTS}. ` +
			"Cap the new one, or move it under the .field vocabulary:\n  " +
			uncapped.map(r => r.selector).join("\n  "));
	// And the number must not be stale in the other direction either: a count
	// nobody can reach is a count nobody notices going wrong.
	assert.ok(uncapped.length >= UNCAPPED_NON_FIELD_INPUTS,
		`only ${uncapped.length} uncapped inputs found against a committed ${UNCAPPED_NON_FIELD_INPUTS} — ` +
			"either some were capped (lower the number and say which) or the scanner stopped seeing them");
});

test("red check — the declaration #144 replaced fails the same predicate", () => {
	// Verbatim shape of the pre-#144 rule: grows, floors, never caps.
	const before: Rule[] = [{
		selector: '.field input[type="text"]',
		body: `
			flex: 1;
			width: calc(24 * var(--u));
			min-width: calc(24 * var(--u));
		`,
	}];
	const faults = unboundedGrowth(before);
	assert.equal(faults.length, 1, `the old rule must fail this predicate; it reported: ${faults.join(" | ")}`);
	assert.match(faults[0]!, /no max-width/);
});

test("red check — a cap under the floor is a fault, not a pass", () => {
	const broken: Rule[] = [{
		selector: ".field input.pretend",
		body: `
			flex: 1;
			min-width: calc(24 * var(--u));
			max-width: calc(12 * var(--u));
		`,
	}];
	assert.match(unboundedGrowth(broken)[0] ?? "", /below its own 24u floor/);
});

test("red check — max-width: none is not a ceiling", () => {
	const broken: Rule[] = [{
		selector: ".field input.pretend",
		body: `
			flex: 1;
			min-width: calc(24 * var(--u));
			max-width: none;
		`,
	}];
	assert.match(unboundedGrowth(broken)[0] ?? "", /not a length in --u/);
});

test("red check — the floor may be a token, and the cap is still compared to it", () => {
	// #138 replaces this rule's literal min-width with `var(--field-input-w)`.
	// A matcher that only knew the calc form would find nothing to compare and
	// pass silently, which is the failure mode this arm exists to prevent.
	assert.equal(uMultiple("var(--ctl-h)"), 7.5, "a token defined in index.css must resolve");
	const broken: Rule[] = [{
		selector: ".field input.pretend",
		body: "flex: 1; min-width: var(--ctl-h); max-width: calc(1 * var(--u));",
	}];
	assert.match(unboundedGrowth(broken)[0] ?? "", /below its own 7.5u floor/,
		"a floor written as a token must still be compared against the cap");
});

/**
 * THE SCANNER SEES THE CLASS-ONLY INPUTS, stated as something that would be
 * FALSE if the widening had not happened. The three below are the ones the old
 * filter could not reach, and each is a growing text input.
 */
test("the scan reaches inputs styled by class alone", () => {
	const seen = new Set(inputRules().map(r => r.selector));
	for (const sel of [".om-filter", ".pin-cmd", ".shp-run-name"]) {
		assert.ok(seen.has(sel), `${sel} is a text input and the scan does not see it`);
	}
	// And it does not sweep in every rule in the sheet by accident.
	assert.ok(inputRules().length < ALL_RULES.length / 4,
		`${inputRules().length} of ${ALL_RULES.length} rules read as input rules — the filter is too loose to mean anything`);
});
