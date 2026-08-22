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
const BASELINE = 429; // set to the measured count in Step 3

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
	let scan = stripBlockComments(raw);
	// For TS/TSX, also blank // comments but not :// in URLs (limitation: /path//file incorrectly blanks).
	if (!isCss) {
		scan = scan.replace(/(?<!:)\/\/.*$/gm, m => m.replace(/./g, " "));
	}
	const scanLines = scan.split("\n");
	for (let i = 0; i < scanLines.length; i++) {
		const line = scanLines[i]!;
		if (!/\d(\.\d+)?px\b/.test(line)) continue;
		const original = lines[i]!;
		if (/px-ok:/.test(original)) { allowed.push({ file, line: i + 1, text: original.trim() }); continue; }
		if (/^\s*@media\b/.test(line)) continue;
		if (file.endsWith("index.css") && /^\s*--u:\s*[\d.]+px;/.test(line)) continue;

		let isHit = false;
		if (isCss) {
			// CSS: split on ; and check each declaration separately.
			// A line is a hit if ANY non-exempt declaration contains px.
			const declarations = line.split(";");
			for (const decl of declarations) {
				if (!/\d(\.\d+)?px\b/.test(decl)) continue;
				const prop = /(?:--[\w-]+|[a-z-]+)\s*:/.exec(decl)?.[0].replace(/[:\s]/g, "");
				if (prop && EXEMPT_PROPS.includes(prop)) continue;
				isHit = true;
				break;
			}
		} else {
			// TS/TSX: check each px occurrence independently.
			// The property name is the nearest `name:` or `"name":` BEFORE each px.
			const pxMatches = [...line.matchAll(/\d(\.\d+)?px\b/g)];
			for (const match of pxMatches) {
				const before = line.slice(0, match.index);
				const prop = /([a-zA-Z-]+)"?\s*:\s*[^:]*$/.exec(before)?.[1]
					?.replace(/([A-Z])/g, c => "-" + c.toLowerCase());
				if (prop && EXEMPT_PROPS.includes(prop)) continue;
				isHit = true;
				break;
			}
		}
		if (isHit) {
			hits.push({ file, line: i + 1, text: original.trim() });
		}
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

test("findPxHits: CSS with multiple declarations is a hit if ANY is not exempt", () => {
	// border-radius is exempt, but padding is not — line is a hit
	const r = findPxHits("x.css", "x { border-radius: 5px; padding: 6px 10px; }");
	assert.equal(r.hits.length, 1);
	assert.ok(r.hits[0]!.text.includes("padding"));
});

test("findPxHits: CSS with all-exempt declarations is not a hit", () => {
	// Both border-radius and box-shadow are exempt — line is not a hit
	const r = findPxHits("x.css", "y { border-radius: 5px; box-shadow: 0 0 0 1px red; }");
	assert.equal(r.hits.length, 0);
});

test("findPxHits: TS // comments are blanked and not counted", () => {
	// The comment "// was 36px" is not a px hit
	const r = findPxHits("x.ts", "const a = 1; // was 36px");
	assert.equal(r.hits.length, 0);
});

test("findPxHits: in TS, each px is judged by its own property", () => {
	// boxShadow (first 1px) is exempt; padding (8px) is not — line is a hit
	const r = findPxHits("x.ts", '{ boxShadow: "0 0 0 1px red", padding: "8px" }');
	assert.equal(r.hits.length, 1);
	assert.ok(r.hits[0]!.text.includes("padding"));
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
