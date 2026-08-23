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
