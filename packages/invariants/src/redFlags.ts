/**
 * Rung 4, and it says so. This finds the sentences people write INSTEAD of a
 * declaration — the phrases the design rule lists as obliging a promotion or a
 * filed row. It cannot find an invariant nobody wrote down at all; nothing can,
 * which is why the register's preamble states the limit rather than implying
 * completeness.
 *
 * A block that carries a real declaration is exempt: there the phrase is
 * describing filed debt, which is the outcome we want. Merely MENTIONING a tag
 * in prose does not exempt anything — otherwise silencing the lint would cost
 * one word.
 */
import { blocksOf, readRecords } from "./blocks.ts";
import { scanFiles } from "./scan.ts";
import type { Problem } from "./check.ts";

export const PHRASES: readonly string[] = [
	"by convention",
	"callers must",
	"caller must",
	"guaranteed by",
	"in practice",
	"should not",
	"must remember",
	"remember to",
	"hand-maintained",
	"kept beside",
];

/** True when this block is a real declaration rather than prose about one. */
function isDeclared(blockText: string): boolean {
	return (
		readRecords(blockText, "invariant", ["rung", "why", "debt"]).length > 0 ||
		readRecords(blockText, "broken", ["status", "what", "fix", "where"]).length > 0
	);
}

export function findRedFlags(rootDir: string): Problem[] {
	return scanFiles(rootDir, (text, file) => {
		const out: Problem[] = [];
		for (const block of blocksOf(text)) {
			if (isDeclared(block.text)) continue;
			const lower = block.text.toLowerCase();
			for (const phrase of PHRASES) {
				if (!lower.includes(phrase)) continue;
				out.push({
					file,
					line: block.startLine,
					message: `"${phrase}" without a declaration — promote it, or file it as debt`,
				});
			}
		}
		return out;
	});
}
