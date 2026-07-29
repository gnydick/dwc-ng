/**
 * What a tool's mode button does on its NEXT click, and how it looks right now.
 *
 * The tool cards give each mode (Active / Standby) one button that carries two
 * jobs, decided by whether the field beside it still matches the machine:
 *
 *   field edited, not yet sent  -> the click SENDS THE SETPOINT (M568 S/R)
 *   field matches the machine   -> the click SETS THE MODE     (M568 A2/A1)
 *
 * That is a control whose emitted G-code depends on state, which is normally
 * exactly what this project refuses. It is admissible here only because the
 * state is not hidden: `phase` drives the button's own colour and its pulsing
 * dot, so the button always shows which of the two it will send before you
 * press it. If that display is ever dropped, this multiplexing has to go with
 * it.
 *
 * The comparison is against the machine's REPORTED setpoint, never against a
 * local "have I typed since load" flag. A macro or another client changing the
 * setpoint underneath you must move the button to `applied` — a dirty flag
 * would keep insisting there was something to send when there no longer is.
 */

/** Off has no setpoint, so it never has anything but `applied`. */
export type CommitPhase =
	/** Field differs from the machine: the next click sends the setpoint. */
	| "pending"
	/** Field matches the machine, and this is not the current mode: the next
	 *  click sets the mode. */
	| "applied"
	/** Field matches AND the machine is already in this mode: nothing to do. */
	| "current";

/**
 * `reported` is the machine's setpoint for this mode; `field` is what the
 * input beside the button holds. Both non-finite values compare equal-ish:
 * a NaN field (an emptied input) is treated as pending, because sending it
 * would put NaN in a G-code word.
 */
export function commitPhase(field: number, reported: number, isCurrentMode: boolean): CommitPhase {
	if (!Number.isFinite(field)) return "pending";
	// Compared as numbers, not strings: "60" and "60.0" are the same setpoint,
	// and the machine reports whichever form it likes.
	if (field !== reported) return "pending";
	return isCurrentMode ? "current" : "applied";
}

/** True when this click should send the setpoint rather than the mode. */
export function clickSendsSetpoint(phase: CommitPhase): boolean {
	return phase === "pending";
}

/**
 * How close the reading has to be to the setpoint before the mode key lights
 * fully. Deliberately loose: a heater in steady state wanders by more than a
 * degree, and a threshold tight enough to flicker would make the brightening
 * read as noise rather than as arrival.
 */
export const AT_TARGET_C = 2;

/**
 * Has the heater ARRIVED at the mode it is in? Purely a display: it changes
 * how the engaged key is painted and nothing else — no control is gated on it,
 * no command changes, and the firmware remains the only authority on whether a
 * temperature is good enough to print at. `target` is the setpoint for the
 * mode being drawn; Off has none, so it arrives the moment it is the mode.
 */
export function atTarget(current: number, target: number | null): boolean {
	if (target === null) return true;
	if (!Number.isFinite(current) || !Number.isFinite(target)) return false;
	return Math.abs(current - target) <= AT_TARGET_C;
}
