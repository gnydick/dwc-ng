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

/** Approaching: within this far BELOW the setpoint, the key's border glows. */
export const NEAR_BELOW_C = 10;
/** Running warm: this far ABOVE the setpoint, the glow turns orange. */
export const OVER_WARM_C = 5;
/** Running hot: this far above, it turns red. */
export const OVER_HOT_C = 10;

/**
 * Where the reading sits relative to the setpoint of the mode being drawn.
 *
 * The window is deliberately asymmetric. Ten degrees of approach is generous
 * because coming up to temperature is the expected, uninteresting case and a
 * tight band would leave the glow flicking on and off as a heater settles.
 * Five degrees of overshoot is tight because overshoot is the case worth
 * looking at.
 *
 * Purely a display: it changes how an already-confirmed key is painted and
 * nothing else. No control is gated on it, no command changes, and the
 * firmware remains the only authority on whether a temperature is safe or good
 * enough to print at — an over-temperature that matters is a heater FAULT, and
 * the firmware raises that itself.
 */
export type ThermalMark =
	/** Still climbing (or cooling) toward it — solid, no glow. */
	| "far"
	/** Within reach of the setpoint — accent glow. */
	| "near"
	/** Over by more than OVER_WARM_C — orange glow. */
	| "warm"
	/** Over by more than OVER_HOT_C — red glow. */
	| "hot";

export function thermalMark(current: number, target: number | null): ThermalMark {
	// Off has no setpoint; a non-positive one asks for NO HEAT rather than for
	// 0 °C. A heater cannot cool below the room, so neither is something to
	// arrive at or to overshoot — the mode alone is the whole story.
	if (target === null || (Number.isFinite(target) && target <= 0)) return "near";
	if (!Number.isFinite(current) || !Number.isFinite(target)) return "far";
	const delta = current - target;
	// Ordered hottest-first: the bands are nested, so the widest test last.
	if (delta > OVER_HOT_C) return "hot";
	if (delta > OVER_WARM_C) return "warm";
	return delta >= -NEAR_BELOW_C ? "near" : "far";
}
