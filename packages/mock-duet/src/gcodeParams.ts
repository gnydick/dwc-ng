/**
 * Parameter extraction for one G-code line.
 *
 * @invariant one-parameter-reader
 * @rung 6  choke-point — every parameter any code handler reads comes from
 *          `readParams`. The handlers receive a `Params` and have no access to
 *          the raw line, so a second, subtly different `P(\d+)` regex has
 *          nowhere to be written; adding an accessor here changes one grammar
 *          for every code at once
 * @why RRF's parameter grammar has real corners — a quoted string may contain
 *      a letter that looks like another parameter, `P20.0` is an ADDRESS and
 *      not the number 20.0, and `H0.4:0.3` is a list. The accelerometer codes
 *      needed all three, and re-deriving them beside the ones in the main
 *      dispatch is exactly how the mock ends up speaking two dialects
 * @debt promotion to 7 is a parsed `Line` type produced only by this module,
 *       with the raw string unreachable from a handler's signature. Today a
 *       handler could still be handed the string, because the dispatch in
 *       gcode.ts holds it in scope; splitting the dispatch table out so each
 *       handler is a `(machine, params) => string` function closes that.
 */

export interface Params {
	/** A signed decimal, e.g. `S1500` or `F-12.5`. */
	num(letter: string): number | null;
	/** The raw token, e.g. `P20.0` -> "20.0" — an address, not a number. */
	raw(letter: string): string | null;
	/** A colon-separated list of numbers, e.g. `H0.4:0.3`. Null if any part is not a number. */
	numbers(letter: string): number[] | null;
	/** The string belonging to ONE letter, e.g. `P"hi"` in M291. */
	quoted(letter: string): string | null;
	/** The first quoted string anywhere on the line (M32, M118, M550). */
	anyQuoted(): string | null;
	/** An RRF array literal of strings, e.g. `K{"Yes","No"}`. */
	strings(letter: string): string[] | null;
}

/**
 * `word` is the command itself ("M956"); numeric and list parameters are
 * looked for AFTER it, so the digits in the command name are never read as a
 * parameter value. Quoted forms search the whole line — a quote cannot occur
 * inside the word.
 */
export function readParams(code: string, word: string): Params {
	const tail = code.slice(word.length);
	return {
		num(letter) {
			const match = new RegExp(`(?:^|\\s)${letter}(-?\\d+(?:\\.\\d+)?)`, "i").exec(tail);
			return match ? parseFloat(match[1]!) : null;
		},
		raw(letter) {
			const match = new RegExp(`(?:^|\\s)${letter}([^\\s"]+)`, "i").exec(tail);
			return match ? match[1]! : null;
		},
		numbers(letter) {
			const match = new RegExp(`(?:^|\\s)${letter}([-\\d.:]+)`, "i").exec(tail);
			if (match === null) return null;
			const parts = match[1]!.split(":").map(Number);
			return parts.every(n => Number.isFinite(n)) ? parts : null;
		},
		quoted(letter) {
			return new RegExp(`(?:^|\\s)${letter}"([^"]*)"`, "i").exec(code)?.[1] ?? null;
		},
		anyQuoted() {
			return /"([^"]*)"/.exec(code)?.[1] ?? null;
		},
		strings(letter) {
			const body = new RegExp(`(?:^|\\s)${letter}\\{([^}]*)\\}`, "i").exec(code)?.[1];
			if (body === undefined) return null;
			return [...body.matchAll(/"([^"]*)"/g)].map(m => m[1]!);
		},
	};
}
