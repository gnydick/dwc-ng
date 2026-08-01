/**
 * A media query adds NO specificity. So a narrow-viewport rule written earlier
 * in the file is simply overridden by a same-specificity desktop rule that
 * appears later — source order decides, and nothing warns.
 *
 * Measured cost: the palette's bottom sheet sat at x=383 on a 390px viewport,
 * off-screen and not hit-testable, because `left: calc(100% + 8px)` from a
 * later unqualified rule won. Every desktop-width measurement is above the
 * breakpoint, so the whole class reads as "fine on the dev server, broken on
 * the printer" — four wrong diagnoses deep before the cause was found.
 *
 * This is the rung-4 mechanism for ui/narrow-rules-come-after-desktop, which
 * before it was held by a comment.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CSS = new URL("../src/app.css", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

interface Occurrence {
	readonly selector: string;
	/** Byte offset of the rule (or of its enclosing media block). */
	readonly at: number;
	readonly line: number;
}

/**
 * Split a stylesheet into unqualified rules and max-width-media rules, keeping
 * each one's position. Deliberately a brace scanner rather than a real parser:
 * no dependency may be added, and the question is only "which came first".
 */
function scan(text: string): { plain: Occurrence[]; narrow: Occurrence[] } {
	const plain: Occurrence[] = [];
	const narrow: Occurrence[] = [];
	const lineAt = (index: number): number => text.slice(0, index).split("\n").length;

	// Strip comments first so a selector mentioned in prose is not a rule.
	const stripped = text.replace(/\/\*[\s\S]*?\*\//g, match => " ".repeat(match.length));

	let i = 0;
	while (i < stripped.length) {
		const open = stripped.indexOf("{", i);
		if (open === -1) break;
		const prelude = stripped.slice(i, open).trim();

		if (prelude.startsWith("@media")) {
			// Find the matching close brace, then scan the block's own rules.
			let depth = 1;
			let j = open + 1;
			while (j < stripped.length && depth > 0) {
				if (stripped[j] === "{") depth++;
				else if (stripped[j] === "}") depth--;
				j++;
			}
			const isNarrow = /max-width/.test(prelude);
			const inner = stripped.slice(open + 1, j - 1);
			// Offsets inside `inner` map back by (open + 1).
			for (const rule of inner.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
				for (const sel of rule[1]!.split(",")) {
					const name = sel.trim();
					if (name === "" || name.startsWith("@")) continue;
					const at = open + 1 + rule.index;
					(isNarrow ? narrow : plain).push({ selector: name, at, line: lineAt(at) });
				}
			}
			i = j;
			continue;
		}

		// A plain rule: prelude { … }
		const close = stripped.indexOf("}", open);
		if (close === -1) break;
		for (const sel of prelude.split(",")) {
			const name = sel.trim();
			if (name === "" || name.startsWith("@")) continue;
			plain.push({ selector: name, at: i, line: lineAt(open) });
		}
		i = close + 1;
	}
	return { plain, narrow };
}

test("every narrow-viewport rule comes after the desktop rule it must override", () => {
	const text = readFileSync(CSS, "utf8");
	const { plain, narrow } = scan(text);

	// The LAST unqualified declaration is the one that wins on source order, so
	// that is what a narrow rule has to come after.
	const lastPlain = new Map<string, Occurrence>();
	for (const rule of plain) {
		const prior = lastPlain.get(rule.selector);
		if (prior === undefined || rule.at > prior.at) lastPlain.set(rule.selector, rule);
	}

	const losers: string[] = [];
	for (const rule of narrow) {
		const desktop = lastPlain.get(rule.selector);
		if (desktop === undefined) continue; // nothing to be overridden by
		if (rule.at < desktop.at) {
			losers.push(
				`${rule.selector}: narrow rule at line ${rule.line} is overridden by the same-specificity ` +
					`rule at line ${desktop.line} — a media query adds no specificity, so source order decides`,
			);
		}
	}

	assert.deepEqual(
		losers,
		[],
		"move the max-width block BELOW the desktop rules it overrides (see ui/narrow-rules-come-after-desktop)",
	);
});

test("the scanner can actually see a violation — red check on a synthetic sheet", () => {
	const bad = "@media (max-width: 900px) {\n\t.x { left: 0; }\n}\n.x { left: 10px; }\n";
	const { plain, narrow } = scan(bad);
	assert.equal(narrow.some(r => r.selector === ".x"), true, "narrow rule not seen");
	assert.equal(plain.some(r => r.selector === ".x"), true, "desktop rule not seen");
	const desktop = plain.find(r => r.selector === ".x")!;
	const media = narrow.find(r => r.selector === ".x")!;
	assert.ok(media.at < desktop.at, "the scanner must rank the media rule earlier here");
});
