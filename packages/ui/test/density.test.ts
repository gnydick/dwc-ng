import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PITCHES, DEFAULT_PITCH, parsePitch } from "../src/shell/density.ts";

/**
 * Comments are stripped before any of this file's structural assertions run.
 * These stylesheets document their own density rules in prose, so a comment
 * saying there is no [data-pitch="127"] block reads, to a naive scan, exactly
 * like the block it is promising does not exist.
 */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

const indexCss = stripComments(readFileSync(fileURLToPath(new URL("../src/index.css", import.meta.url)), "utf8"));
const appCss = stripComments(readFileSync(fileURLToPath(new URL("../src/app.css", import.meta.url)), "utf8"));

test("parsePitch tolerates missing or unknown storage", () => {
	assert.equal(parsePitch(null), DEFAULT_PITCH);
	assert.equal(parsePitch(""), DEFAULT_PITCH);
	assert.equal(parsePitch("0.50"), DEFAULT_PITCH); // the label, not the id
	assert.equal(parsePitch("tiny"), DEFAULT_PITCH);
	assert.equal(parsePitch("__proto__"), DEFAULT_PITCH);
});

test("parsePitch accepts every shipped pitch id", () => {
	for (const p of PITCHES) assert.equal(parsePitch(p.id), p.id);
});

test("pitch ids are unique — two entries claiming one id would make the control ambiguous", () => {
	assert.equal(new Set(PITCHES.map(p => p.id)).size, PITCHES.length);
});

/**
 * The load-bearing property: the default pitch is the ABSENCE of an override.
 * A [data-pitch="127"] block would be a second copy of the baseline spacing,
 * free to drift from the :root values that actually define it.
 */
test("the default pitch has no CSS override block", () => {
	assert.equal(PITCHES[0]!.id, DEFAULT_PITCH);
	assert.ok(!indexCss.includes(`[data-pitch="${DEFAULT_PITCH}"]`),
		`index.css must not define a [data-pitch="${DEFAULT_PITCH}"] block — the baseline is :root`);
});

test("every non-default pitch has a CSS override block", () => {
	for (const p of PITCHES.slice(1)) {
		assert.ok(indexCss.includes(`[data-pitch="${p.id}"]`), `index.css has no block for pitch ${p.id}`);
	}
});

/**
 * Every --sp-* token app.css SPENDS must be declared on :root, or that rule
 * silently collapses to nothing at the baseline. Catches a typo'd token name,
 * which CSS itself reports as neither an error nor a warning.
 */
test("every spacing token app.css uses is declared in the :root baseline", () => {
	const used = new Set([...appCss.matchAll(/var\((--sp-[a-z-]+)\)/g)].map(m => m[1]!));
	const declared = new Set([...indexCss.matchAll(/(--sp-[a-z-]+):/g)].map(m => m[1]!));
	assert.ok(used.size > 0, "expected app.css to reference spacing tokens");
	for (const token of used) assert.ok(declared.has(token), `${token} is used but never declared`);
});

/**
 * Each override block may only RE-declare baseline tokens. A token introduced
 * only at a tighter pitch has no baseline value, so 1.27 would render it as an
 * empty custom property — a broken rule at the default density.
 */
test("no pitch override introduces a token the baseline lacks", () => {
	const rootBlock = indexCss.slice(indexCss.indexOf(":root {"), indexCss.indexOf('[data-pitch="'));
	const declared = new Set([...rootBlock.matchAll(/(--[a-z-]+):/g)].map(m => m[1]!));
	for (const p of PITCHES.slice(1)) {
		const start = indexCss.indexOf(`[data-pitch="${p.id}"]`);
		const block = indexCss.slice(start, indexCss.indexOf("}", start));
		for (const m of block.matchAll(/(--[a-z-]+):/g)) {
			assert.ok(declared.has(m[1]!), `pitch ${p.id} sets ${m[1]} which the baseline never declares`);
		}
	}
});

/**
 * Density buys rows from air, never from targets. The control you use to
 * escape a density you dislike must not shrink along with it.
 */
test("the pitch control and the resize grip carry no density token", () => {
	for (const selector of [".pitch-opt {", ".panel-resize-grip {", ".estop {"]) {
		const start = appCss.indexOf(selector);
		assert.ok(start >= 0, `${selector} not found in app.css`);
		const block = appCss.slice(start, appCss.indexOf("}", start));
		assert.ok(!block.includes("var(--sp-"), `${selector} must not scale with density`);
	}
});

/**
 * The canvas row unit scales with the pitch (shell/panelCanvas.ts rowUnitPx).
 *
 * Density used to shrink only the spacing INSIDE a card, leaving its box the
 * height it had at 1.27 — so every card's content pulled away from its bottom
 * edge and the whole layout had to be re-dragged by hand. Scaling the drawn
 * unit fixes that without touching a single stored rect.
 */
test("every pitch declares --row-unit, and the default equals the stored unit", async () => {
	const { ROW_UNIT_PX } = await import("../src/shell/panelCanvas.ts");
	// The default pitch is the ABSENCE of an override, so :root's value is what
	// it renders at — and it must equal the unit geometry is stored in, or the
	// canvas would not render as it always has at the default.
	const root = /:root\s*\{[^}]*--row-unit:\s*([\d.]+)px/.exec(indexCss);
	assert.ok(root, ":root declares no --row-unit");
	assert.equal(Number(root[1]), ROW_UNIT_PX);

	for (const p of PITCHES) {
		if (p.id === DEFAULT_PITCH) continue;
		const start = indexCss.indexOf(`[data-pitch="${p.id}"]`);
		const block = indexCss.slice(start, indexCss.indexOf("}", start));
		assert.match(block, /--row-unit:\s*[\d.]+px/, `pitch ${p.id} declares no --row-unit`);
	}
});

test("--row-unit never grows as the pitch tightens", () => {
	// PITCHES is loosest-first. A tighter pitch that drew TALLER rows would
	// expand the layout it is supposed to condense.
	const unitOf = (id: string): number => {
		if (id === DEFAULT_PITCH) return Number(/:root\s*\{[^}]*--row-unit:\s*([\d.]+)px/.exec(indexCss)![1]);
		const start = indexCss.indexOf(`[data-pitch="${id}"]`);
		return Number(/--row-unit:\s*([\d.]+)px/.exec(indexCss.slice(start, indexCss.indexOf("}", start)))![1]);
	};
	const units = PITCHES.map(p => unitOf(p.id));
	for (let i = 1; i < units.length; i++) {
		assert.ok(units[i]! <= units[i - 1]!, `pitch ${PITCHES[i]!.id} draws taller rows than ${PITCHES[i - 1]!.id}`);
	}
	// And the floor is a real floor: --ctl-h stops shrinking at 20px, so a unit
	// that kept falling would shorten cards whose controls had stopped.
	assert.ok(units[units.length - 1]! > 0);
});

/**
 * The row-granularity migration converts canvases saved on the old 30px grid.
 * It must use the FROZEN stored unit: with the live one, the same old layout
 * would migrate to different numbers depending on which pitch the browser
 * happened to be on the first time it loaded.
 */
test("the row-granularity migration does not use the density-scaled unit", () => {
	const src = readFileSync(fileURLToPath(new URL("../src/shell/panelCanvas.ts", import.meta.url)), "utf8");
	const start = src.indexOf("function migrateRowGranularity");
	assert.ok(start > 0, "migrateRowGranularity not found");
	const body = src.slice(start, src.indexOf("\n}", start));
	assert.ok(body.includes("ROW_UNIT_PX"), "migration should convert against the stored unit");
	assert.ok(!body.includes("rowUnitPx("), "migration must not depend on the current pitch");
});
