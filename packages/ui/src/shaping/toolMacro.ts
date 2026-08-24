/**
 * The per-tool post-select macro: where it lives, and which line in it is the
 * shaper.
 *
 * RepRapFirmware runs `tpost<N>.g` after a tool is picked up, which is where a
 * per-tool `M593` belongs — one shaper per carriage, applied by the firmware
 * every time that carriage is selected. The status card reads it to show what
 * the machine will do on the next toolchange; task G2's Apply card rewrites the
 * same line in the same file.
 *
 * Both halves are pure and live here rather than at either call site, because
 * "which line is the shaper" is exactly the question a reader and a writer must
 * not answer differently: a reader that ignored a commented-out `;M593` while
 * the writer replaced it would show one line and edit another.
 */

/** The one spelling of the path. Two callers, one string. */
export const toolMacroPath = (tool: number): string => `0:/sys/tpost${tool}.g`;

/**
 * The ACTIVE `M593` line, verbatim, or null.
 *
 * "Active" is doing real work here. A tuning macro accumulates commented-out
 * attempts — `;M593 P"zvd" F52 S0.1` above the live one is the normal shape of
 * a file somebody has been iterating in — and a comment is not what the
 * firmware will run. RRF's comment character is `;`, and a line whose first
 * non-blank character is one is a comment in its entirety.
 *
 * The LAST match wins, for the same reason the firmware ends up with it: the
 * file is executed top to bottom, so a second `M593` overrides the first.
 */
export function findShapingLine(text: string): string | null {
	let found: string | null = null;
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (line.startsWith(";")) continue;
		// Word-boundary anchored at the start: `M5931` is a different code, and
		// a bare `M593` with no parameters is a REPORT rather than a setting —
		// still the active shaping line as far as reading the file goes, but it
		// is matched deliberately rather than by accident.
		if (/^M593\b/i.test(line)) found = line;
	}
	return found;
}

/**
 * The same file with its shaping line replaced, or the line appended if it had
 * none.
 *
 * The exact counterpart of `findShapingLine`, and here beside it for the reason
 * the file header already gives: "which line is the shaper" must have ONE
 * answer. A reader that skipped a commented-out `;M593` while a writer replaced
 * it would show the operator one line and edit another.
 *
 * Three things it preserves, each because losing it damages a file somebody
 * hand-wrote:
 *
 *  - the line's INDENTATION, since `tpost` macros are often written inside
 *    `if` blocks and a de-indented line changes which branch it belongs to;
 *  - the file's LINE ENDINGS, because these files are edited on Windows as
 *    often as not and rewriting CRLF as LF turns a one-line change into a
 *    whole-file diff (and the reverse leaves a file RRF still runs but nobody
 *    can review);
 *  - every OTHER line verbatim, comments included — a tuning macro's
 *    commented-out attempts are its history.
 *
 * @invariant one-answer-to-which-line-is-the-shaper
 * @rung 6  choke-point — `findShapingLine` and this share the "last
 *          non-comment M593 wins" rule in one module, and it is the only route
 *          by which the UI edits a tool macro. A second writer elsewhere could
 *          still disagree; there is none, and a test pins the pair against the
 *          same fixtures
 */
export function replaceShapingLine(text: string, line: string): string {
	const crlf = text.includes("\r\n");
	const rows = text.split(/\r?\n/);
	// The LAST active one, matching the reader exactly — the firmware runs the
	// file top to bottom, so a later M593 is the one that takes effect.
	let target = -1;
	for (let i = 0; i < rows.length; i++) {
		const t = rows[i]!.trim();
		if (t.startsWith(";")) continue;
		if (/^M593\b/i.test(t)) target = i;
	}
	if (target < 0) {
		// No shaping line to replace. Append rather than prepend: appending puts
		// it last, which is what makes it the active one under the very rule
		// this module reads by.
		const out = [...rows];
		// A file that already ends in a newline splits to a trailing "", and
		// writing into that slot keeps exactly one terminator rather than two.
		if (out.length > 0 && out[out.length - 1] === "") out[out.length - 1] = line;
		else out.push(line);
		out.push("");
		return out.join(crlf ? "\r\n" : "\n");
	}
	const indent = /^\s*/.exec(rows[target]!)?.[0] ?? "";
	rows[target] = `${indent}${line}`;
	return rows.join(crlf ? "\r\n" : "\n");
}
