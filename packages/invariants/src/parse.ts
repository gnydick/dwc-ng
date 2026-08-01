/**
 * Extracts @invariant blocks. Deliberately dumb: it reports what is written,
 * including what is missing, and rules on nothing. Every validation rule lives
 * in check.ts so there is exactly one place to read them.
 *
 * Only block comments are scanned, so a string literal containing the tag text
 * is not a declaration. .ts, .tsx and .css all use the same comment form, which
 * is why one scanner covers every file type we care about.
 */
export interface RawDeclaration {
	readonly slug: string;
	readonly rung: string | undefined;
	readonly why: string | undefined;
	readonly debt: string | undefined;
	readonly file: string;
	readonly line: number;
}

const BLOCK = /\/\*[\s\S]*?\*\//g;
const TAG = /^@(invariant|rung|why|debt)\b\s*(.*)$/;

/** Strip a leading " * " (or "*") that block-comment lines conventionally carry. */
function stripGutter(line: string): string {
	return line.replace(/^\s*\*?\s?/, "").trimEnd();
}

export function parseDeclarations(text: string, file: string): RawDeclaration[] {
	const out: RawDeclaration[] = [];
	for (const block of text.matchAll(BLOCK)) {
		const startLine = text.slice(0, block.index).split("\n").length;
		// Drop the "/*" and "*/" delimiters before anything else. CSS writes the
		// first tag on the SAME line as the opener, so a gutter-stripper alone
		// never sees it; neither delimiter spans a newline, so line numbers hold.
		const lines = block[0].slice(2, -2).split("\n");

		let slug: string | null = null;
		let fields: Record<string, string> = {};
		let current: string | null = null;
		let line = 0;

		const flush = (): void => {
			if (slug !== null) {
				out.push({ slug, rung: fields["rung"], why: fields["why"], debt: fields["debt"], file, line });
			}
			slug = null;
			fields = {};
			current = null;
		};

		for (let i = 0; i < lines.length; i++) {
			const body = stripGutter(lines[i]!);
			const tag = TAG.exec(body);
			if (tag !== null) {
				const name = tag[1]!;
				const value = tag[2]!.trim();
				if (name === "invariant") {
					flush(); // a second @invariant ends the first
					slug = value;
					line = startLine + i;
					current = null;
				} else if (slug !== null) {
					fields[name] = value;
					current = name;
				}
			} else if (current !== null && slug !== null && body !== "") {
				// A continuation line: append, collapsing the indent to one space.
				fields[current] = `${fields[current] ?? ""} ${body.trim()}`.trim();
			}
		}
		flush();
	}
	return out;
}
