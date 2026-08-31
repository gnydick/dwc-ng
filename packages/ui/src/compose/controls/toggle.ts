/**
 * Toggle state — the ONE pipeline from an OM read to on/off/unknown (the
 * formatReadoutValue precedent: renderer and tests both import it; there is
 * no second truthiness site).
 *
 * Total by construction, and the mapping is deliberately documented rather
 * than clever:
 *
 * - `undefined`/`null` → **unknown** (not yet polled, or the selector reads
 *   nothing on this machine);
 * - objects/arrays → **unknown** (a toggle binds a LEAF, not a subtree);
 * - non-finite numbers → **unknown** (absence, the readout rule — a broken
 *   numeric leaf must render indeterminate, never claim a state on garbage);
 * - any other leaf → JS truthiness: `false`, `0`, `""` are **off**,
 *   everything else **on**.
 *
 * Consequence worth authoring around: bind numeric/boolean leaves
 * (`fans[0].requestedValue`, `state.atxPower`) — a STATUS STRING like "off"
 * is truthy and therefore the wrong binding for a toggle.
 *
 * "unknown" is why the toggle can be state-honest with no internal latch:
 * the board is the sole authority, and with no reported state there is no
 * alternative a press could truthfully send — the renderer is inert and
 * reserved-indeterminate until the poll delivers a leaf.
 */
export type ToggleState = "on" | "off" | "unknown";

export function toggleStateOf(value: unknown): ToggleState {
	if (value === undefined || value === null) return "unknown";
	if (typeof value === "object") return "unknown";
	if (typeof value === "number" && !Number.isFinite(value)) return "unknown";
	return value ? "on" : "off";
}
