/**
 * Scale for the speed-factor slider.
 *
 * The range is always 0 .. 2x the machine's current speed factor, which puts
 * the handle exactly mid-bar: drag right to double, left to stop. The scale
 * therefore re-centres itself after every change — the control gives fine
 * resolution around wherever the machine actually is, instead of spending most
 * of its length on speeds nobody uses.
 */

/**
 * Floor for the top of the scale. Without it a machine sitting at 0% (or a
 * model that has not reported yet) would produce a zero-width range: every stop
 * on top of every other, and no way to drag back off it.
 */
export const MIN_SCALE_MAX = 50;

/** Fractions of the scale carrying a snap stop. */
const STOP_FRACTIONS = [0, 0.25, 0.5, 0.75, 1] as const;

export interface SpeedScale {
	/** Top of the slider's range, in percent. */
	max: number;
	/** Snap targets, in percent, ascending. The middle one is the current speed. */
	stops: number[];
}

export function speedScale(currentPct: number): SpeedScale {
	// Anything not a usable positive number (NaN before the first poll, a
	// negative from a malformed model) falls back to the firmware default.
	const safe = Number.isFinite(currentPct) && currentPct > 0 ? currentPct : 100;
	const max = Math.max(MIN_SCALE_MAX, Math.round(safe * 2));
	return { max, stops: STOP_FRACTIONS.map(f => Math.round(max * f)) };
}
