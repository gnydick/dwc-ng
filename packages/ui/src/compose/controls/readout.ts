/**
 * Readout value formatting — the ONE pipeline from an OM read to display
 * text (the renderer and its tests both import it; there is no second
 * format site).
 *
 * Total by construction: every input has a defined string rendering and
 * nothing here can throw. `decimals` reaches this function only through
 * compileControlSpec, which admits integers 0–8 — the range in which
 * Number.prototype.toFixed is defined for every finite number — so the
 * formatted branch cannot fault at render time.
 *
 * Absence (undefined/null), non-finite numbers, and non-leaf values (a
 * selector that landed on an object or array — a readout binds a VALUE)
 * all render as the placeholder: the readout keeps its reserved box and
 * its unit, and the layout cannot collapse whatever the machine reports.
 */
export const READOUT_PLACEHOLDER = "—";

export function formatReadoutValue(value: unknown, decimals: number | undefined): string {
	if (value === undefined || value === null) return READOUT_PLACEHOLDER;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) return READOUT_PLACEHOLDER;
		return decimals === undefined ? String(value) : value.toFixed(decimals);
	}
	if (typeof value === "string" || typeof value === "boolean") return String(value);
	return READOUT_PLACEHOLDER;
}
