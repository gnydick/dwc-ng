/**
 * Reading tagged records out of block comments, once. Both @invariant and
 * @broken need exactly this, and duplicating it at the second call site is the
 * tripwire the design rule names — so it lives here and has no second copy.
 *
 * Only block comments are scanned, so a string literal containing tag text is
 * not a record. .ts, .tsx and .css share the comment form, which is why one
 * reader covers every file type.
 */
const BLOCK = /\/\*[\s\S]*?\*\//g;

/**
 * A lead tag introduces a record only when followed by a single token. Anything
 * with whitespace in it is prose about the tag, not a use of it. Deliberately
 * looser than the id rules in check.ts/broken.ts: a single malformed token like
 * `Path_Escape` IS an attempted declaration and must be REPORTED as invalid,
 * not silently skipped — only multi-word text is treated as prose.
 */
const SLUGGISH = /^\S+$/;

export interface TagRecord {
	/** The value on the lead tag's own line — the slug. */
	readonly lead: string;
	/** Every other recognised tag, continuations already joined. */
	readonly fields: Readonly<Record<string, string>>;
	/** 1-based line of the lead tag. */
	readonly line: number;
}

/** Strip a leading " * " (or "*") that block-comment lines conventionally carry. */
function stripGutter(line: string): string {
	return line.replace(/^\s*\*?\s?/, "").trimEnd();
}

/**
 * Every record in `text` whose lead tag is `leadTag`. A second lead tag ends
 * the previous record, so one comment may carry several.
 */
export interface RawBlock {
	/** The block's full text, delimiters included. */
	readonly text: string;
	/** 1-based line the block starts on. */
	readonly startLine: number;
}

/** Every block comment in `text`. The one place the comment shape is known. */
export function blocksOf(text: string): RawBlock[] {
	return [...text.matchAll(BLOCK)].map(m => ({
		text: m[0],
		startLine: text.slice(0, m.index).split("\n").length,
	}));
}

export function readRecords(text: string, leadTag: string, fieldTags: readonly string[]): TagRecord[] {
	const tag = new RegExp(`^@(${[leadTag, ...fieldTags].join("|")})\\b\\s*(.*)$`);
	const out: TagRecord[] = [];

	for (const { text: blockText, startLine } of blocksOf(text)) {
		// Drop the "/*" and "*/" delimiters before anything else. CSS writes the
		// first tag on the SAME line as the opener, so a gutter-stripper alone
		// never sees it; neither delimiter spans a newline, so line numbers hold.
		const lines = blockText.slice(2, -2).split("\n");

		let lead: string | null = null;
		let fields: Record<string, string> = {};
		let current: string | null = null;
		let line = 0;

		const flush = (): void => {
			if (lead !== null) out.push({ lead, fields, line });
			lead = null;
			fields = {};
			current = null;
		};

		for (let i = 0; i < lines.length; i++) {
			const body = stripGutter(lines[i]!);
			const matched = tag.exec(body);
			if (matched !== null) {
				const name = matched[1]!;
				const value = matched[2]!.trim();
				if (name === leadTag && !SLUGGISH.test(value)) {
					// Prose that merely MENTIONS the tag at the start of a wrapped
					// line — this file's own header does it. A declaration's lead is
					// one token; several words is someone writing about the tag, and
					// treating that as a record made this tool reject itself.
					if (current !== null && lead !== null) fields[current] = `${fields[current] ?? ""} ${body}`.trim();
				} else if (name === leadTag) {
					flush();
					lead = value;
					line = startLine + i;
					current = null;
				} else if (lead !== null) {
					fields[name] = value;
					current = name;
				}
			} else if (current !== null && lead !== null && body !== "") {
				// A continuation line: append, collapsing the indent to one space.
				fields[current] = `${fields[current] ?? ""} ${body.trim()}`.trim();
			}
		}
		flush();
	}
	return out;
}
