/**
 * Full steps per millimetre, read off the machine — the one number the sweep
 * chart's "is this forced or is it ringing" line is drawn from.
 *
 * THE PHYSICS, because getting its direction wrong is what the chart exists to
 * prevent. A stepper's torque ripple is strongest once per FULL step, so a move
 * at `v` mm/s excites `v × fullStepsPerMm` Hz — a frequency that FOLLOWS the
 * speed. A structural mode rings at its own natural frequency and does not care
 * how fast the carriage is going, so it sits at ONE frequency at every speed.
 * Input shaping cancels the second and cannot touch the first
 * (engine/sweep.ts:1-3 is the authority).
 *
 * So this number decides where the "forced" locus is drawn, and a wrong one
 * draws a confident lie: a ridge that really is motor ripple would sit off the
 * line and read as a mode worth shaping, and shaping cannot move it.
 *
 * @invariant full-step-rate-is-measured-or-absent
 * @rung 7  illegal state unrepresentable — the result is a discriminated union,
 *          not a number with a sentinel. There is no `0`, no `NaN` and no
 *          default to fall through to: a caller that wants `perMm` must first
 *          narrow on `known`, and the arm that has no number carries the
 *          sentence saying why instead. Nothing can call `sweepMatrix` with a
 *          fabricated rate because there is no fabricated rate to pass
 * @why RRF reports `stepsPerMm` and `microstepping.value` per axis and the
 *      quotient is exact (Gabe's X: 80 ÷ 16 = 5 full steps/mm, so 100 mm/s
 *      excites 500 Hz). A board or firmware that omits either has to say so on
 *      the card — the alternative, defaulting to some common value, produces a
 *      plot that looks right and is not
 */
import type { Axis as OmAxis } from "../om/types.ts";
import type { Axis } from "./engine/fit.ts";

export type FullStep =
	| {
			readonly known: true;
			/** Full motor steps per mm of carriage travel. */
			readonly perMm: number;
			/** Where it came from, in the numbers the board reported. */
			readonly from: string;
	  }
	| { readonly known: false; readonly why: string };

/** A positive finite number off the wire, or null. The object model's axis
 *  entries are passed through unconformed (om/types.ts `om-entry-shape-gate`
 *  gates the SUBTREE, not each element), so these two fields are as untrusted
 *  as any other JSON. */
const positive = (v: unknown): number | null =>
	typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;

/**
 * The full-step rate of one axis, or the reason there is not one.
 *
 * Reads the two fields RRF publishes and DIVIDES rather than storing a third:
 * `stepsPerMm` is the microstepped rate M92 sets and `microstepping.value` is
 * M350's multiplier, so the full-step rate is their quotient and can never
 * disagree with either.
 */
export function fullStepPerMm(axes: readonly OmAxis[], letter: Axis): FullStep {
	const axis = axes.find(a => a.letter === letter);
	if (axis === undefined) {
		return { known: false, why: `this machine reports no ${letter} axis, so its full-step rate is unknown` };
	}
	const steps = positive(axis.stepsPerMm);
	const micro = positive(axis.microstepping?.value);
	if (steps === null || micro === null) {
		// Named separately from "no axis": one is a machine without that axis and
		// the other is a firmware that did not send the field, and only the second
		// is worth reporting to Duet3D.
		return {
			known: false,
			why: `${letter} did not report both steps/mm and microstepping, so the full-step rate cannot be derived`,
		};
	}
	return {
		known: true,
		perMm: steps / micro,
		from: `${letter}: ${steps} steps/mm ÷ ${micro}× microstepping`,
	};
}
