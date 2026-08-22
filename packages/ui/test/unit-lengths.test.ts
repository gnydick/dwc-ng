import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * THE invariant behind "cards never need resizing after a scale change":
 * every length that occupies layout space is n × var(--u). A pixel literal in
 * a layout-space property is a fixed term in some card's floor, and that floor
 * then drifts with scale. So px is a build error here, not a style nit.
 *
 * Exempt: properties that never occupy layout space. Anything else that must
 * stay in screen px (pointer physics, breakpoints) says so on the line with
 * `px-ok: <reason>`, and every such line is printed so the allowlist is
 * visible, not silent.
 *
 * BASELINE is the debt ratchet: it is the number of violations on the day the
 * lint landed, and each migration task lowers it. It may never go up.
 */
const BASELINE = 726; // set to the measured count in Step 3

const SRC = fileURLToPath(new URL("../src", import.meta.url));

const EXEMPT_PROPS = [
	"border-radius",
	"box-shadow",
	"outline",
	"outline-offset",
	"text-shadow",
	"filter",
	"backdrop-filter",
];

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (/\.(css|ts|tsx)$/.test(name)) out.push(p);
	}
	return out;
}

const stripBlockComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "));

export interface Hit { file: string; line: number; text: string }

/** Every `<number>px` token that is not exempt. Pure over file text so it can be unit-tested. */
export function findPxHits(file: string, raw: string): { hits: Hit[]; allowed: Hit[] } {
	const hits: Hit[] = [];
	const allowed: Hit[] = [];
	const isCss = file.endsWith(".css");
	const lines = raw.split("\n");
	// Comments are blanked line-preservingly so reported line numbers are real.
	const scan = stripBlockComments(raw).split("\n");
	for (let i = 0; i < scan.length; i++) {
		const line = scan[i]!;
		if (!/\d(\.\d+)?px\b/.test(line)) continue;
		const original = lines[i]!;
		if (/px-ok:/.test(original)) { allowed.push({ file, line: i + 1, text: original.trim() }); continue; }
		if (/^\s*@media\b/.test(line)) continue;
		if (file.endsWith("index.css") && /^\s*--u:\s*[\d.]+px;/.test(line)) continue;
		if (isCss) {
			const prop = /^\s*(?:--[\w-]+|[a-z-]+)\s*:/.exec(line)?.[0].replace(/[:\s]/g, "");
			if (prop && EXEMPT_PROPS.includes(prop)) continue;
		} else {
			// TS/TSX: the property name is the nearest `name:` or `"name":` before the px.
			const before = line.slice(0, line.search(/\d(\.\d+)?px\b/));
			const prop = /([a-zA-Z-]+)"?\s*:\s*[^:]*$/.exec(before)?.[1]
				?.replace(/([A-Z])/g, c => "-" + c.toLowerCase());
			if (prop && EXEMPT_PROPS.includes(prop)) continue;
		}
		hits.push({ file, line: i + 1, text: original.trim() });
	}
	return { hits, allowed };
}

test("findPxHits: exempt properties, px-ok markers and @media preludes are not hits", () => {
	const css = [
		"a {",
		"	border-radius: 6px;",
		"}",
		"b {",
		"	box-shadow: inset 0 0 0 1px red;",
		"}",
		"@media (max-width: 600px) {",
		"	c {",
		"		width: 1px;",
		"	}",
		"}",
		"d {",
		"	width: 4px; /* px-ok: test */",
		"}",
		"e {",
		"	padding: 3px;",
		"}",
	].join("\n");
	const r = findPxHits("x.css", css);
	assert.deepEqual(r.hits.map(h => h.line), [9, 16]); // the `c` rule inside @media is a hit; the prelude line is not
	assert.equal(r.allowed.length, 1);
});

test("findPxHits: a blanked comment keeps line numbers", () => {
	const r = findPxHits("x.css", "/* 1px\n2px */\nf { gap: 8px; }");
	assert.deepEqual(r.hits.map(h => h.line), [3]);
});

test(`layout-space px literals do not exceed the ratchet baseline (${BASELINE})`, () => {
	const hits: Hit[] = [];
	const allowed: Hit[] = [];
	for (const f of walk(SRC)) {
		const r = findPxHits(f, readFileSync(f, "utf8"));
		hits.push(...r.hits);
		allowed.push(...r.allowed);
	}
	console.log(`px hits: ${hits.length} (baseline ${BASELINE}); px-ok allowlist: ${allowed.length}`);
	for (const a of allowed) console.log(`  px-ok  ${a.file}:${a.line}  ${a.text}`);
	const sample = hits.slice(0, 25).map(h => `  ${h.file}:${h.line}  ${h.text}`).join("\n");
	assert.ok(hits.length <= BASELINE,
		`${hits.length} layout-space px literals, baseline is ${BASELINE}. First ones:\n${sample}`);
});
