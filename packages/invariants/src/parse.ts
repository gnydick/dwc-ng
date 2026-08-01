/**
 * Extracts @invariant blocks. Deliberately dumb: it reports what is written,
 * including what is missing, and rules on nothing. Every validation rule lives
 * in check.ts so there is exactly one place to read them.
 *
 * The reading itself lives in blocks.ts, shared with @broken — one comment
 * reader, no second copy.
 */
import { readRecords } from "./blocks.ts";

export interface RawDeclaration {
	readonly slug: string;
	readonly rung: string | undefined;
	readonly why: string | undefined;
	readonly debt: string | undefined;
	readonly file: string;
	readonly line: number;
}

export function parseDeclarations(text: string, file: string): RawDeclaration[] {
	return readRecords(text, "invariant", ["rung", "why", "debt"]).map(r => ({
		slug: r.lead,
		rung: r.fields["rung"],
		why: r.fields["why"],
		debt: r.fields["debt"],
		file,
		line: r.line,
	}));
}
