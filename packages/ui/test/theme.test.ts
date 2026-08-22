import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { THEMES, DEFAULT_THEME, parseTheme, groundOf } from "../src/shell/theme.ts";

const read = (rel: string): string =>
	readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const indexCss = read("../src/index.css");
const themeCss = read("../src/theme-graphite.css");
const labCss = read("../src/dev/paletteLab.css");
const labTs = readFileSync(fileURLToPath(new URL("../src/dev/paletteLab.ts", import.meta.url)), "utf8");

test("parseTheme tolerates missing or unknown storage", () => {
	assert.equal(parseTheme(null), DEFAULT_THEME);
	assert.equal(parseTheme(""), DEFAULT_THEME);
	assert.equal(parseTheme("Vellum"), DEFAULT_THEME); // the label, not the id
	assert.equal(parseTheme("__proto__"), DEFAULT_THEME);
});

test("parseTheme accepts every shipped id, and ids are unique", () => {
	for (const t of THEMES) assert.equal(parseTheme(t.id), t.id);
	assert.equal(new Set(THEMES.map(t => t.id)).size, THEMES.length);
});

test("the default theme is the ABSENCE of a CSS override", () => {
	assert.ok(THEMES.some(t => t.id === DEFAULT_THEME));
	assert.ok(!indexCss.includes(`[data-theme=`));
	assert.ok(!themeCss.includes(`[data-theme="${DEFAULT_THEME}"]`));
});

test("every non-default theme has a shipped :root[data-theme] block that repaints the chrome", () => {
	for (const t of THEMES) {
		if (t.id === DEFAULT_THEME) continue;
		const start = themeCss.indexOf(`:root[data-theme="${t.id}"]`);
		assert.ok(start >= 0, `no block for ${t.id}`);
		const block = themeCss.slice(start, themeCss.indexOf("}", start));
		for (const token of ["--mask-900", "--mask-700", "--silk", "--accent", "--t-cold", "--face-hi"]) {
			assert.ok(block.includes(`${token}:`), `${t.id} does not set ${token}`);
		}
	}
});

test("each theme says which ground the chart palette is solved for", () => {
	assert.equal(DEFAULT_THEME, "vellum");
	assert.equal(groundOf(DEFAULT_THEME), "light");
	assert.equal(groundOf("graphite"), "dark");
	assert.equal(groundOf("garbage"), "light"); // unknown -> default
});

test("the shipped :root palette IS vellum, and graphite is the override", () => {
	const root = indexCss.slice(indexCss.indexOf(":root {"), indexCss.indexOf("}", indexCss.indexOf(":root {")));
	assert.ok(root.includes("--mask-700: #f2f5f9"), "index.css :root should carry the vellum card");
	const g = themeCss.slice(themeCss.indexOf(':root[data-theme="graphite"]'));
	assert.ok(g.includes("--mask-700: #1e2128"), "graphite block should carry the graphite card");
});

test("the dev lab's dark grounds restate the dark thermal ramp, since the shipped one is mixed for paper", () => {
	for (const id of ["navy", "green", "instrument"]) assert.ok(labCss.includes(`data-ground="${id}"`), id);
	assert.ok(/data-ground[^{]*\{[^}]*--t-cold:\s*#6e8ca8/.test(labCss), "no lab rule sets the dark --t-cold");
});

test("shipped themes are not also dev-only lab grounds", () => {
	for (const t of THEMES) {
		assert.ok(!labCss.includes(`data-ground="${t.id}"`), t.id);
		assert.ok(!labTs.includes(`id: "${t.id}"`), t.id);
	}
});
