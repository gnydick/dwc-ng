import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * THE invariant behind "cards never need resizing after a scale change":
 * every length that occupies layout space is n × var(--u). A pixel literal in
 * a layout-space property is a fixed term in some card's floor, and that floor
 * then drifts with scale. So px fails this suite, not a style nit.
 *
 * NOT build-failing, despite how the rule reads elsewhere: `pnpm build` is
 * `tsc -b && vite build` and never runs node:test. `pnpm test` is the gate, and
 * nothing in this repo yet runs `pnpm test` for you (no CI, no hook) — see the
 * @debt on the unit-lengths invariant in src/index.css.
 *
 * Absolute units, not just px: PX, vh, vw, rem, pt, in, cm, mm, pc all pin a
 * length to something other than --u. `em` is deliberately absent — it is
 * relative to the font size, which is itself written in u, so an em length
 * already follows the scale. A `${n}px` template in TSX counts too: it reaches
 * the DOM as a px length without ever appearing as `14px` in the source, which
 * is exactly how the SpeedSlider thumb offset went stale unseen.
 *
 * Exempt: properties that never occupy layout space. Anything else that must
 * stay in screen px (pointer physics, breakpoints, viewport-bound overlays)
 * says so on the line with `px-ok: <reason>`, and every such line is printed so
 * the allowlist is visible, not silent.
 *
 * BASELINE was the debt ratchet while the migration was in progress: it
 * started at the count of violations on the day the lint landed, and each
 * migration task lowered it. Task 8 (2026-08-21) drove it to zero and the
 * ratchet mechanism was retired in favour of the hard assertion below — a
 * literal now fails this suite the moment it lands, not just when someone
 * remembers to re-measure the baseline.
 */

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

/**
 * Units that pin a length to something other than --u.
 *
 * `em`/`%`/`ch` are absent on purpose: they are relative to the font size or
 * the parent box, both of which are already written in u, so they follow the
 * scale for free. `rem` is NOT — it is relative to the root font size, which
 * is not a scale token — so it is on the list.
 *
 * `PX` is here because CSS units are case-insensitive and `10PX` renders
 * identically to `10px`; a lint that only sees the lowercase spelling is one
 * shift key away from being bypassed by accident.
 */
const ABS_UNITS = "px|PX|vh|vw|rem|pt|in|cm|mm|pc";

/**
 * A length token: a number followed by one of those units, OR a closed
 * template hole followed by `px` (`` `${n}px` ``). The template form is the
 * one that is invisible to a naive search of the source — the string `14px`
 * never appears — and it is exactly how SpeedSlider's thumb offset kept
 * emitting a stale constant after the CSS beside it had moved to u.
 */
const TOKEN_SRC = `(?:\\d(?:\\.\\d+)?(?:${ABS_UNITS})|\\}px)\\b`;
const hasToken = (s: string): boolean => new RegExp(TOKEN_SRC).test(s);
const allTokens = (s: string): RegExpMatchArray[] => [...s.matchAll(new RegExp(TOKEN_SRC, "g"))];

export interface Hit { file: string; line: number; text: string }

/** Every absolute-unit token that is not exempt. Pure over file text so it can be unit-tested. */
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
	// Carries an unterminated CSS declaration's property name across lines. A
	// multi-line value list (e.g. a box-shadow list, one value per line) has its
	// `prop:` only on the FIRST line; every continuation line has no property of
	// its own, so without this the exempt guard falls through (prop undefined)
	// and each continuation line is miscounted as a hit. Updated on EVERY CSS
	// line (not just px-bearing ones), because the property usually sits on a
	// line with no px at all (`box-shadow:`) while the values needing judgement
	// are the continuation lines below it. Cleared whenever a line's trailing
	// fragment ends the declaration (`;`) or the rule (`}`).
	let pendingProp: string | undefined;
	for (let i = 0; i < scanLines.length; i++) {
		const line = scanLines[i]!;
		// The property pending INTO this line, frozen before this line's own
		// bookkeeping mutates `pendingProp` for the NEXT line.
		const incomingPendingProp = pendingProp;
		if (isCss) {
			const hasBrace = line.includes("{");
			const body = hasBrace ? line.slice(line.lastIndexOf("{") + 1) : line;
			const trimmedEnd = body.trimEnd();
			// A fully blank line — whitespace only, OR a block comment that was
			// blanked to spaces by stripBlockComments — is NOT a declaration
			// terminator. A comment (or blank line) sitting between "box-shadow:"
			// and its first value must leave pendingProp untouched; only an actual
			// `;`/`}` ends a declaration, and only a bare `{` with nothing after it
			// (a fresh rule opener) starts clean with nothing pending.
			const isBlank = body.trim() === "";
			if (trimmedEnd.endsWith(";") || trimmedEnd.endsWith("}")) {
				pendingProp = undefined;
			} else if (isBlank) {
				if (hasBrace) pendingProp = undefined;
				// else: blank/whitespace/comment-only line — leave pendingProp as is.
			} else {
				const declarations = body.split(";");
				const lastFrag = declarations[declarations.length - 1]!;
				const ownProp = /^\s*(--[\w-]+|[a-z-]+)\s*:/.exec(lastFrag)?.[1];
				pendingProp = ownProp ?? incomingPendingProp;
			}
		}
		if (!hasToken(line)) continue;
		const original = lines[i]!;
		if (/px-ok:/.test(original)) { allowed.push({ file, line: i + 1, text: original.trim() }); continue; }
		if (/^\s*@media\b/.test(line)) continue;
		if (file.endsWith("index.css") && /^\s*--u:\s*[\d.]+px;/.test(line)) continue;

		let isHit = false;
		if (isCss) {
			// CSS: strip any selector prefix first — a one-line rule like
			// `.foo:hover { box-shadow: …px…; }` otherwise leaves the selector
			// (with its own pseudo-class) in the first split fragment, and the
			// property regex below would match `foo:hover`'s "foo" as if it were
			// the declaration's property name instead of the real one.
			const body = line.includes("{") ? line.slice(line.lastIndexOf("{") + 1) : line;
			// Split on ; and check each declaration separately.
			// A line is a hit if ANY non-exempt declaration contains px.
			const declarations = body.split(";");
			for (let d = 0; d < declarations.length; d++) {
				const decl = declarations[d]!;
				if (!hasToken(decl)) continue;
				// Anchored to the declaration's start: on its own this still isn't
				// enough (a selector fragment with no property would just leave
				// `prop` undefined, and the `if (prop && …)` guard falls through to
				// a hit) — it's the selector-prefix strip above that actually fixes
				// the false positive; the anchor stops a stray `word:` mid-value
				// (e.g. inside a url() or a custom ident) from being misread as
				// the property.
				const ownProp = /^\s*(--[\w-]+|[a-z-]+)\s*:/.exec(decl)?.[1];
				// Only the FIRST fragment of a line can be a continuation of the
				// previous line's unterminated declaration — any later fragment
				// follows a `;` in THIS line, so it starts its own declaration.
				const prop = ownProp ?? (d === 0 ? incomingPendingProp : undefined);
				if (prop && EXEMPT_PROPS.includes(prop)) continue;
				isHit = true;
				break;
			}
		} else {
			// TS/TSX: check each token occurrence independently.
			// The property name is the nearest `name:` or `"name":` BEFORE it —
			// and a `${…}px` template hole is a token like any other, judged by
			// the same property, so `boxShadow: \`0 0 0 ${n}px red\`` stays exempt
			// while `width: \`${n}px\`` is a hit.
			const pxMatches = allTokens(line);
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

test("findPxHits: a one-line pseudo-class rule with only an exempt declaration is not a hit", () => {
	// Regression: the selector's OWN pseudo-class (`hover`) used to be misread as
	// the declaration's property name, so an otherwise-exempt box-shadow line
	// counted as a hit. `x:hover { … }` on one line must not trip on `x:hover`.
	const r = findPxHits("x.css", "x:hover { box-shadow: 0 0 0 1px red; }");
	assert.equal(r.hits.length, 0);
});

test("findPxHits: a one-line pseudo-class rule IS a hit when it also carries a real non-exempt px", () => {
	const r = findPxHits("x.css", "y:hover { box-shadow: 0 0 0 1px red; padding: 8px; }");
	assert.equal(r.hits.length, 1);
	assert.ok(r.hits[0]!.text.includes("padding"));
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

test("findPxHits: a `${n}px` template in TS is a hit", () => {
	// The string `14px` never appears in the source; the length still reaches
	// the DOM. This is the shape that let SpeedSlider's thumb offset go stale.
	const r = findPxHits("x.ts", "const s = `${x}px`;");
	assert.equal(r.hits.length, 1);
});

test("findPxHits: a `${n}px` template under an exempt property is not a hit", () => {
	const r = findPxHits("x.ts", "const s = { boxShadow: `0 0 0 ${n}px red` };");
	assert.equal(r.hits.length, 0);
});

test("findPxHits: vh is a layout-space token", () => {
	// Viewport units pin a length to the screen, not to --u — the same defect
	// as px, one step further removed.
	const r = findPxHits("x.css", ".a { height: 52vh; }");
	assert.equal(r.hits.length, 1);
});

test("findPxHits: uppercase PX is a hit", () => {
	// CSS units are case-insensitive; 10PX renders exactly like 10px.
	const r = findPxHits("x.css", ".a { width: 10PX; }");
	assert.equal(r.hits.length, 1);
});

test("findPxHits: the other absolute units are hits too", () => {
	for (const v of ["1rem", "12pt", "1in", "2cm", "10mm", "1pc", "80vw"]) {
		const r = findPxHits("x.css", `.a { width: ${v}; }`);
		assert.equal(r.hits.length, 1, `${v} should be a hit`);
	}
});

test("findPxHits: em and % are NOT hits — they already follow the scale", () => {
	const r = findPxHits("x.css", ".a { width: 50%; letter-spacing: 0.04em; }");
	assert.equal(r.hits.length, 0);
});

test("findPxHits: a multi-line box-shadow declaration carries its property across continuation lines", () => {
	// Every value line belongs to the box-shadow declaration opened above it,
	// even though none of the continuation lines has its own `prop:` — without
	// carrying pendingProp forward, each continuation line falls through the
	// exempt guard (prop undefined) and is miscounted as a hit.
	const css = ".a {\n\tbox-shadow:\n\t\t0 0 0 1px red,\n\t\t0 0 4px blue;\n}";
	const r = findPxHits("x.css", css);
	assert.equal(r.hits.length, 0);
});

test("findPxHits: the same multi-line shape under a non-exempt property IS a hit on the continuation line", () => {
	// padding is not exempt, so unlike the box-shadow fixture above, the
	// continuation lines ARE hits — every px-bearing line in the list, since
	// each one carries the same (non-exempt) pendingProp forward.
	const css = ".a {\n\tpadding:\n\t\t0 0 0 1px red,\n\t\t0 0 4px blue;\n}";
	const r = findPxHits("x.css", css);
	assert.deepEqual(r.hits.map(h => h.line), [3, 4]);
});

test("findPxHits: a blank line INSIDE a multi-line exempt declaration does not clear pendingProp", () => {
	// Regression (fix round 1): pendingProp used to be cleared whenever a
	// line's trimmed body was empty — which also fired on a bare blank line
	// sitting between "box-shadow:" and its first value, not just on a real
	// declaration/rule terminator. That dropped the carried property and
	// miscounted the value line below as a hit.
	const css = ".a {\n\tbox-shadow:\n\n\t\t0 0 4px red;\n}";
	const r = findPxHits("x.css", css);
	assert.equal(r.hits.length, 0);
});

test("findPxHits: a comment-only line INSIDE a multi-line exempt declaration does not clear pendingProp", () => {
	// Same regression, via a block comment: stripBlockComments blanks it to
	// spaces, which is indistinguishable from a blank line to the old check.
	const css = ".a {\n\tbox-shadow:\n\t/* comment */\n\t\t0 0 4px red;\n}";
	const r = findPxHits("x.css", css);
	assert.equal(r.hits.length, 0);
});

test("findPxHits: the same blank/comment-interrupted shape under a non-exempt property IS a hit on the value line", () => {
	const css = ".a {\n\tpadding:\n\t/* comment */\n\t\t0 0 4px red;\n}";
	const r = findPxHits("x.css", css);
	assert.deepEqual(r.hits.map(h => h.line), [4]);
});

test("layout-space px literals: zero", () => {
	const hits: Hit[] = [];
	const allowed: Hit[] = [];
	for (const f of walk(SRC)) {
		const r = findPxHits(f, readFileSync(f, "utf8"));
		hits.push(...r.hits);
		allowed.push(...r.allowed);
	}
	console.log(`px hits: ${hits.length}; px-ok allowlist: ${allowed.length}`);
	for (const a of allowed) console.log(`  px-ok  ${a.file}:${a.line}  ${a.text}`);
	const sample = hits.slice(0, 25).map(h => `  ${h.file}:${h.line}  ${h.text}`).join("\n");
	assert.equal(hits.length, 0, `${hits.length} layout-space px literals:\n${sample}`);
});
