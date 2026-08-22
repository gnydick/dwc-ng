import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SCALES, DEFAULT_SCALE, parseScale, legacyPitchToScale } from "../src/shell/scale.ts";

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
const indexCss = stripComments(readFileSync(fileURLToPath(new URL("../src/index.css", import.meta.url)), "utf8"));
const appCss = stripComments(readFileSync(fileURLToPath(new URL("../src/app.css", import.meta.url)), "utf8"));

const unitOf = (id: string): number => {
	if (id === DEFAULT_SCALE) return Number(/:root\s*\{[^}]*--u:\s*([\d.]+)px/.exec(indexCss)![1]);
	const start = indexCss.indexOf(`[data-scale="${id}"]`);
	assert.ok(start >= 0, `no [data-scale="${id}"] block`);
	return Number(/--u:\s*([\d.]+)px/.exec(indexCss.slice(start, indexCss.indexOf("}", start)))![1]);
};

test("parseScale tolerates missing or unknown storage", () => {
	assert.equal(parseScale(null), DEFAULT_SCALE);
	assert.equal(parseScale(""), DEFAULT_SCALE);
	assert.equal(parseScale("1.25"), DEFAULT_SCALE); // the label, not the id
	assert.equal(parseScale("__proto__"), DEFAULT_SCALE);
});

test("parseScale accepts every shipped id, and ids are unique", () => {
	for (const s of SCALES) assert.equal(parseScale(s.id), s.id);
	assert.equal(new Set(SCALES.map(s => s.id)).size, SCALES.length);
});

test("the default scale is the ABSENCE of a CSS override", () => {
	assert.ok(SCALES.some(s => s.id === DEFAULT_SCALE));
	assert.ok(!indexCss.includes(`[data-scale="${DEFAULT_SCALE}"]`));
});

test("every non-default scale declares --u, and :root's --u equals the stored unit", async () => {
	const { ROW_UNIT_PX, COL_UNIT_PX } = await import("../src/shell/panelCanvas.ts");
	assert.equal(unitOf(DEFAULT_SCALE), ROW_UNIT_PX);
	assert.equal(ROW_UNIT_PX, COL_UNIT_PX);
	for (const s of SCALES) if (s.id !== DEFAULT_SCALE) assert.ok(unitOf(s.id) > 0);
});

test("--u is strictly increasing in step order", () => {
	const units = SCALES.map(s => unitOf(s.id));
	for (let i = 1; i < units.length; i++) assert.ok(units[i]! > units[i - 1]!, `${SCALES[i]!.id} not larger than ${SCALES[i - 1]!.id}`);
});

test("--u equals factor × the default unit for every step", () => {
	const base = unitOf(DEFAULT_SCALE);
	for (const s of SCALES) assert.equal(unitOf(s.id), s.factor * base, s.id);
});

test("a scale override block sets ONLY --u", () => {
	for (const s of SCALES) {
		if (s.id === DEFAULT_SCALE) continue;
		const start = indexCss.indexOf(`[data-scale="${s.id}"]`);
		const block = indexCss.slice(start, indexCss.indexOf("}", start));
		const decls = [...block.matchAll(/(--[a-z-]+):/g)].map(m => m[1]);
		assert.deepEqual(decls, ["--u"], `${s.id} sets ${decls.join(",")}`);
	}
});

test("legacy density pitches map onto scale steps, unknown → null", () => {
	assert.equal(legacyPitchToScale("127"), "100");
	assert.equal(legacyPitchToScale("080"), "0875");
	assert.equal(legacyPitchToScale("050"), "075");
	assert.equal(legacyPitchToScale("040"), "075");
	assert.equal(legacyPitchToScale(null), null);
	assert.equal(legacyPitchToScale("bogus"), null);
});

test("the scale control, the resize grip and the e-stop do not scale", () => {
	// Covers not just the base rule but every descendant/pseudo rule too
	// (.estop small, .estop:hover, .scale-opt.active, …) — the ruling's intent
	// is the rendered hit target, and a scaled descendant defeats that just as
	// much as a scaled base rule would. `(?![\w-])` on the prefix excludes an
	// unrelated class that merely shares the prefix textually (.estop-failed
	// is NOT a descendant of .estop).
	const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
	const rules = [...appCss.matchAll(ruleRe)].map(([, sel, body]) => ({ sel: sel!.trim(), body: body! }));
	for (const prefix of ["scale-opt", "panel-resize-grip", "estop"]) {
		const ownSelector = new RegExp(`^\\.${prefix}(?![\\w-])`);
		const matches = rules.filter(r => r.sel.split(",").some(part => ownSelector.test(part.trim())));
		assert.ok(matches.length > 0, `no rule for .${prefix} found in app.css`);
		for (const { sel, body } of matches) {
			assert.ok(!body.includes("var(--u)") && !body.includes("var(--sp-") && !body.includes("var(--ctl-h)"),
				`${sel} must not scale — it is how you escape a scale you dislike`);
		}
	}
});

test("the row-granularity migration uses the frozen stored unit, never the drawn one", () => {
	const src = readFileSync(fileURLToPath(new URL("../src/shell/panelCanvas.ts", import.meta.url)), "utf8");
	const start = src.indexOf("function migrateRowGranularity");
	assert.ok(start > 0);
	const body = src.slice(start, src.indexOf("\n}", start));
	assert.ok(body.includes("ROW_UNIT_PX"));
	assert.ok(!body.includes("unitPx(") && !body.includes("rowUnitPx("));
});
