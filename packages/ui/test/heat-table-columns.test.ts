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

/** nth-child index -> declared px width, for `.heat-table` column rules. */
function columnWidths(css: string): Map<number, number> {
	const widths = new Map<number, number>();
	const rule = /\.heat-table th:nth-child\((\d+)\)[^{]*\{([^}]*)\}/g;
	for (const [, index, body] of css.matchAll(rule)) {
		const width = /(?:^|[;{\s])width:\s*(\d+)px/.exec(body!);
		assert.ok(width, `.heat-table column ${index} rule declares no px width`);
		widths.set(Number(index), Number(width[1]));
	}
	return widths;
}

/** The last `--heat-table-w` declared in a stretch of CSS. */
function declaredTableWidth(css: string): number {
	const all = [...css.matchAll(/--heat-table-w:\s*(\d+)px/g)];
	assert.ok(all.length > 0, "no --heat-table-w declaration");
	return Number(all[all.length - 1]![1]);
}

const COLUMN_COUNT = [...cardTsx.matchAll(/<th scope="col">/g)].length;
const base = withoutMediaBlocks(appCss);
const narrow = mediaBlock(appCss, "max-width: 900px");

test("the card renders the six columns the stylesheet is written for", () => {
	// Guards the arithmetic below: with a different count, the sums are checking
	// a table that no longer exists.
	assert.equal(COLUMN_COUNT, 6);
});

test("every column has a declared width — table-layout:fixed has no fallback", () => {
	const widths = columnWidths(base);
	assert.deepEqual(
		[...widths.keys()].sort((a, b) => a - b),
		Array.from({ length: COLUMN_COUNT }, (_, i) => i + 1),
	);
});

test("the base column widths sum to --heat-table-w", () => {
	const widths = columnWidths(base);
	const sum = [...widths.values()].reduce((a, b) => a + b, 0);
	assert.equal(sum, declaredTableWidth(base));
});

test("the narrow-viewport block names no column the table does not have", () => {
	// THE regression. The stale block addressed nth-child(2)…(5) of a
	// five-column table, which is in range and therefore not caught here —
	// so this pairs with the sum check below, which is what actually caught it.
	for (const index of columnWidths(narrow).keys()) {
		assert.ok(index >= 1 && index <= COLUMN_COUNT, `narrow block sets column ${index} of ${COLUMN_COUNT}`);
	}
});

test("the narrow-viewport widths sum to the --heat-table-w it restates", () => {
	const widths = columnWidths(base);
	for (const [index, width] of columnWidths(narrow)) widths.set(index, width);
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

test("the Filament column keeps room for the picker's own min-width", () => {
	// .heat-fil declares min-width: 88px. A column narrower than that plus its
	// gutters does not squeeze the picker, it overflows the cell.
	const pickerMin = Number(/\.heat-fil\s*\{[^}]*min-width:\s*(\d+)px/.exec(appCss)?.[1]);
	assert.ok(Number.isFinite(pickerMin), "could not read .heat-fil min-width");

	const filamentRule = /\.heat-table th:nth-child\(2\)[^{]*\{([^}]*)\}/g;
	for (const css of [base, narrow]) {
		const body = [...css.matchAll(filamentRule)].at(-1)?.[1];
		if (body === undefined) continue;
		const width = Number(/width:\s*(\d+)px/.exec(body)?.[1]);
		const padLeft = Number(/padding-left:\s*(\d+)px/.exec(body)?.[1] ?? 0);
		const padRight = Number(/padding-right:\s*(\d+)px/.exec(body)?.[1] ?? 0);
		assert.ok(
			width - padLeft - padRight >= pickerMin,
			`Filament column leaves ${width - padLeft - padRight}px for an ${pickerMin}px picker`,
		);
	}
});

test("the Deselect row wraps, like the Tools card's identical row", () => {
	// Same three controls in both cards. Unwrapped, its minimum is their sum
	// (322px) rather than the widest of them (150px) — a floor on the whole
	// card that nothing about the row needs.
	const rule = /\.heat-deselect\s*\{([^}]*)\}/.exec(appCss);
	assert.ok(rule, "no .heat-deselect rule");
	assert.match(rule[1]!, /flex-wrap:\s*wrap/);
});
