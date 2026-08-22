import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The Tools & heaters table is `table-layout: fixed` with per-column pixel
 * widths and `min-width: var(--heat-table-w)`. Three separate things therefore
 * have to agree, and nothing in CSS makes them:
 *
 *   1. how many <th> the component renders,
 *   2. which nth-child indices the stylesheet gives widths to,
 *   3. whether those widths sum to the --heat-table-w in scope.
 *
 * They stopped agreeing. The narrow-viewport block was written against the
 * FIVE-column table; Filament arrived later as column 2 and slid every index
 * one to the left, so below 900px Filament took the width meant for Active
 * (under the picker's own min-width, so it overflowed its cell) and Current
 * took the width meant for Set. --heat-table-w was never restated. The card's
 * minimum went UP under the rules meant to shrink it — 598 -> 656 — which made
 * it the only card that would not narrow in portrait, while every desktop-width
 * measurement said it was fine.
 *
 * The failure was silent in both directions: valid CSS, and invisible above the
 * breakpoint. So it is checked here rather than left to be noticed.
 */

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

const here = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const appCss = stripComments(here("../src/app.css"));
const cardTsx = here("../src/cards/ToolsHeatersCard.tsx");

/** The block a `@media (<condition>) {` opens, by brace matching. */
function mediaBlock(css: string, condition: string): string {
	const at = css.indexOf(`@media (${condition})`);
	assert.notEqual(at, -1, `no @media (${condition}) block in app.css`);
	const open = css.indexOf("{", at);
	let depth = 0;
	for (let i = open; i < css.length; i++) {
		if (css[i] === "{") depth++;
		else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
	}
	throw new Error(`unterminated @media (${condition}) block`);
}

/** Everything outside every @media block — the base cascade. */
function withoutMediaBlocks(css: string): string {
	let out = "";
	for (let i = 0; i < css.length; ) {
		const at = css.indexOf("@media", i);
		if (at === -1) return out + css.slice(i);
		out += css.slice(i, at);
		const open = css.indexOf("{", at);
		let depth = 0;
		let j = open;
		for (; j < css.length; j++) {
			if (css[j] === "{") depth++;
			else if (css[j] === "}" && --depth === 0) break;
		}
		i = j + 1;
	}
	return out;
}

// Tokens are declared as `calc(N * var(--u))`; N × the default --u (4px) is the
// px-equivalent these tests reason about — comparable to the pre-scaling literals.
const BASE_U = 4;

/** role -> declared px-equivalent width, resolving var(--tool-col-*) against :root. */
function columnWidths(css: string): Map<string, number> {
	const tokens = new Map<string, number>();
	for (const [, role, mult] of css.matchAll(/--tool-col-([a-z]+):\s*calc\(([\d.]+)\s*\*\s*var\(--u\)\)/g)) {
		// LAST wins, matching the cascade — the narrow block overrides.
		tokens.set(role!, Number(mult) * BASE_U);
	}
	const widths = new Map<string, number>();
	const rule = /\.heat-table \.col-([a-z]+)\s*\{([^}]*)\}/g;
	for (const [, role, body] of css.matchAll(rule)) {
		const direct = /(?:^|[;{\s])width:\s*(\d+)px/.exec(body!);
		if (direct) { widths.set(role!, Number(direct[1])); continue; }
		const ref = /width:\s*var\(--tool-col-([a-z]+)\)/.exec(body!);
		assert.ok(ref, `.heat-table .col-${role} declares no width`);
		const resolved = tokens.get(ref[1]!);
		assert.ok(resolved !== undefined, `--tool-col-${ref[1]} is never declared`);
		widths.set(role!, resolved);
	}
	return widths;
}

/** The last `--heat-table-w` declared in a stretch of CSS. */
function declaredTableWidth(css: string): number {
	const all = [...css.matchAll(/--heat-table-w:\s*calc\(([\d.]+)\s*\*\s*var\(--u\)\)/g)];
	assert.ok(all.length > 0, "no --heat-table-w declaration");
	return Number(all[all.length - 1]![1]) * BASE_U;
}

const COLUMN_ROLES = ["heater", "active", "standby", "current", "set"] as const;
const base = withoutMediaBlocks(appCss);
const narrow = mediaBlock(appCss, "max-width: 900px");

test("every column the component renders has a role class with a width", () => {
	// Welded to the markup: a <th> without a col- class, or a col- class the
	// markup never uses, fails here rather than silently inheriting a width.
	const inMarkup = [...cardTsx.matchAll(/<th scope="col" class="col-([a-z]+)"/g)].map(m => m[1]!);
	assert.deepEqual([...inMarkup].sort(), [...COLUMN_ROLES].sort());
	const widths = columnWidths(base);
	for (const role of COLUMN_ROLES) assert.ok(widths.has(role), `no width for col-${role}`);
	// Reverse direction: a stray `.heat-table .col-foo { width: … }` rule with
	// no matching rendered column would pass every check above unnoticed. The
	// CSS role set and the markup role set must be exactly equal, not just
	// markup-subset-of-CSS.
	assert.deepEqual([...widths.keys()].sort(), [...COLUMN_ROLES].sort());
});

test("the base column widths sum to --heat-table-w", () => {
	const widths = columnWidths(base);
	const sum = [...widths.values()].reduce((a, b) => a + b, 0);
	assert.equal(sum, declaredTableWidth(base));
});

/**
 * THE regression this whole file exists for. A media query written for the
 * FIVE-column table kept its nth-child indices when Filament was inserted as
 * column 2, so every index slid one to the left: Filament took the width meant
 * for Active (under the picker's own min-width, so it overflowed) and Current
 * took the width meant for Set. The card's minimum went UP under rules meant to
 * shrink it, and it was the one card that would not narrow in portrait.
 *
 * A positional selector cannot be made safe - it is correct only for as long as
 * nobody inserts a column. A named role class travels WITH its column, so
 * inserting one shifts nothing.
 */
test("no load-bearing layout property is carried by a positional selector", () => {
	// ANY element, not just th|td. The first version of this guard was scoped to
	// table cells because that is where the bug was found, so it passed while
	// `.heat-rows > .heater-ctl > .temp-field:nth-of-type(1) { grid-column: 2 }`
	// sat two hundred lines below in the same stylesheet — the identical defect
	// on a grid instead of a table. A selector's damage does not depend on the
	// element it names.
	//
	// Every :nth-* form, not just nth-child/nth-of-type: :nth-last-child counts
	// from the other end, which is no more stable under an insertion.
	const positional = /([^{}]*:nth-(?:child|last-child|of-type|last-of-type)\([^)]*\)[^{}]*)\{([^}]*)\}/g;
	// LOAD-BEARING = decides where a box sits or how big it is, so inserting or
	// removing a sibling silently moves or resizes a LATER one and the stylesheet
	// still parses. That is the whole regression class:
	//   · sizing        width / min-width / max-width / flex-basis
	//   · placement     grid-column* / grid-row* / grid-area / order
	//   · offsets       left / right / top / bottom
	// Deliberately NOT listed: padding, margin, colour, border, background,
	// text-align. A stale one of those is a cosmetic wart on one cell — visible,
	// local, and not capable of sliding a column under its neighbour. Adding them
	// would make the guard fire on rules that are correct by intent (zebra
	// striping, first-row padding) and it would then be silenced rather than
	// obeyed.
	const loadBearing =
		/(^|[;{\s])(width|min-width|max-width|flex-basis|grid-column|grid-column-start|grid-column-end|grid-row|grid-row-start|grid-row-end|grid-area|order|left|right|top|bottom)\s*:/;
	const offenders: string[] = [];
	for (const [, selector, body] of appCss.matchAll(positional)) {
		if (loadBearing.test(body!)) {
			offenders.push(`${selector!.trim().replace(/\s+/g, " ")} { ${body!.trim()} }`);
		}
	}
	assert.deepEqual(offenders, [], "these rules take a size or a position from a sibling index, not from a role");
});

test("the narrow-viewport widths sum to the --heat-table-w it restates", () => {
	// The narrow block overrides only the TOKEN (`.heat-table { --tool-col-current:
	// calc(14.5 * var(--u)); }`), not the `.col-current` rule — that rule now
	// carries only padding-right in this block, so it has no width of its own to
	// hand columnWidths(narrow). Resolve the real cascade instead: base widths,
	// with any token the narrow block redeclares taking precedence.
	const widths = columnWidths(base);
	for (const [, role, mult] of narrow.matchAll(/--tool-col-([a-z]+):\s*calc\(([\d.]+)\s*\*\s*var\(--u\)\)/g)) {
		widths.set(role!, Number(mult) * BASE_U);
	}
	const sum = [...widths.values()].reduce((a, b) => a + b, 0);
	assert.equal(sum, declaredTableWidth(narrow));
});

test("the narrow-viewport table is NARROWER than the base — the point of the block", () => {
	// It was 58px wider. A block that widens the card at the width where space
	// is scarcest is worse than no block, and reads as a card that ignores its
	// own minimum.
	assert.ok(
		declaredTableWidth(narrow) < declaredTableWidth(base),
		`narrow ${declaredTableWidth(narrow)}px is not below base ${declaredTableWidth(base)}px`,
	);
});

test("the Deselect row does NOT wrap — content inside a card must not move", () => {
	// Reversed the same day it was added. Wrapping dropped this card's floor
	// from 322 to 150, but a row that re-flows makes the card "fit" at any
	// width by rearranging itself, which is the one thing a card must not do
	// (Gabe, 2026-07-30: "not let content move at all — that's the point of the
	// cards"). It costs nothing here: the table beside it declares 598.
	const rule = /\.heat-deselect\s*\{([^}]*)\}/.exec(appCss);
	assert.ok(rule, "no .heat-deselect rule");
	assert.match(rule[1]!, /flex-wrap:\s*nowrap/);
});

/**
 * Regression class (e). Tools and Tools & heaters are the same table with
 * columns removed, but their widths were two sets of numbers that happened to
 * match - and they stopped matching at a different density, where one card's
 * rows were driven by --ctl-h and the other's by a control that had opted out
 * of it. Agreement has to be structural: ONE declaration, subtracted from.
 */
test("tool column widths come from tokens, not from literals", () => {
	const widths = columnWidths(base);
	assert.ok(widths.size > 0, "no column rules found");
	const literal = /\.heat-table \.col-([a-z]+)\s*\{[^}]*width:\s*\d+px/g;
	const offenders = [...base.matchAll(literal)].map(m => m[1]!);
	assert.deepEqual(offenders, [], "these columns hard-code a width instead of naming a token");
});

test("every tool column token has exactly one BASE declaration", () => {
	// Scoped to the BASE cascade, not the whole file. A viewport or density
	// block may legitimately OVERRIDE a token — that is what naming it is for —
	// but there must be exactly one place the default is set, or "one
	// declaration" is a claim rather than a fact.
	for (const role of COLUMN_ROLES) {
		// `calc(40 * var(--u))` — n × the global unit. Still exactly one
		// declaration; it just is not a bare length.
		const decl = new RegExp(`--tool-col-${role}:\\s*calc\\([\\d.]+\\s*\\*\\s*var\\(--u\\)\\)`, "g");
		const hits = [...base.matchAll(decl)];
		assert.equal(hits.length, 1, `--tool-col-${role} declared ${hits.length} times in the base cascade, expected 1`);
	}
});
