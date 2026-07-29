/**
 * What a tool's mode key does on its NEXT press, and how it looks right now.
 *
 * The rule is two presses, always (operator's spec, 2026-07-29):
 *
 *   press 1 — writes the SETPOINT beside it (M568 S/R) and arms the key
 *   press 2 — switches the tool to that profile (M568 A2/A1)
 *
 * The first press is deliberately unconditional. An earlier version let a
 * press go straight to the mode whenever the field already matched the
 * machine, which meant a heater sitting at 200° could be switched on by one
 * stray click on a key that looked idle. Writing a value the machine already
 * holds is a no-op on the board; turning a hot end on by accident is not. So
 * the harmless action is the one that can happen by accident, and the one that
 * heats the machine takes a deliberate second press.
 *
 * That makes the emitted G-code depend on state, which this project otherwise
 * refuses. It is admissible only because the state is not hidden: `armed`
 * drives the key's own colour, so the key always shows which of the two it
 * will send before you press it. If that display is ever dropped, this
 * multiplexing has to go with it.
 *
 * Arming is LOCAL, and deliberately so — it is a record of what you just did
 * on this key, not a claim about the machine.
 */

/** Off has no setpoint, so it never has anything but `applied`. */
export type CommitPhase =
	/** Field differs from the machine: there is an unwritten value here. */
	| "pending"
	/** Field matches the machine, and this is not the current mode. */
	| "applied"
	/** Field matches AND the machine is already in this mode. */
	| "current";

/**
 * `reported` is the machine's setpoint for this mode; `field` is what the
 * input beside the key holds. This drives the pending DOT only — it no longer
 * decides what a press sends, because a matching field must not be a shortcut
 * to switching the heater on.
 *
 * The comparison is against the machine's REPORTED setpoint, never a local
 * "have I typed" flag, so another client or a macro moving the setpoint clears
 * the dot by itself.
 */
export function commitPhase(field: number, reported: number, isCurrentMode: boolean): CommitPhase {
	// An emptied input is NaN, which would put NaN in a G-code word — it reads
	// as unwritten, which it is.
	if (!Number.isFinite(field)) return "pending";
	// Compared as numbers, not strings: "60" and "60.0" are the same setpoint,
	// and the machine reports whichever form it likes.
	if (field !== reported) return "pending";
	return isCurrentMode ? "current" : "applied";
}

/**
 * True when this press should write the setpoint rather than switch the mode.
 *
 * Depends ONLY on whether the key is armed. Not on the phase: that is exactly
 * the shortcut that allowed an accidental activation.
 */
export function clickSendsSetpoint(armed: boolean): boolean {
	return !armed;
}

/**
 * Should the arming survive into the next press?
 *
 * Dropped when the machine reaches this mode (there is nothing left to switch
 * to) and when the field is edited again (the new value has to be written
 * before it can be run). Anything else leaves it standing, including a reload
 * of the machine's own values underneath it.
 */
export function staysArmed(phase: CommitPhase, isCurrentMode: boolean): boolean {
	return !isCurrentMode && phase !== "pending";
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
