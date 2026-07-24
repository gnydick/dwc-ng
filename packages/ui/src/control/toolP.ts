/**
 * RRF's tool-change macro bitmask, in one place.
 *
 * T<n> P<bitmask> selects which of the tool-change macros run: 1 tfree,
 * 2 tpre, 4 tpost. Omitting P entirely is NOT the same as P0 — no P lets the
 * firmware run all three, P0 suppresses them all — so the parse deliberately
 * returns undefined for an empty field rather than defaulting to a number.
 *
 * Both the Control view's Tools card and the Tools & heaters card offer this
 * field. They share this module so a P typed in one place can never be read
 * differently from the same digits typed in the other.
 */

/** The bitmask RRF accepts: 0…7. Anything else is "no P". */
const MAX_P = 7;

/**
 * Read the raw input. Blank, non-integer, or out of range all mean "send no P"
 * — the field never silently becomes a value the operator did not type.
 */
export function parseToolP(raw: string): number | undefined {
	const text = raw.trim();
	if (text === "") return undefined;
	const value = Number(text);
	return Number.isInteger(value) && value >= 0 && value <= MAX_P ? value : undefined;
}

/** Human reading of the bitmask, shown beside the field. */
export function describeToolP(p: number | undefined): string {
	if (p === undefined) return "all macros (no P sent)";
	if (p === 0) return "no macros";
	const parts: string[] = [];
	if (p & 1) parts.push("tfree");
	if (p & 2) parts.push("tpre");
	if (p & 4) parts.push("tpost");
	return parts.join(" · ");
}
