/**
 * What building a speed sweep is doing right now.
 *
 * Its own module, and not beside `BatchState` in compose/services.ts, for a
 * layering reason: `shaping/copy.ts` writes this union's sentences with a
 * `never` arm, and a copy table that imported a compose/ module would invert
 * the direction every other shaping type runs in (`Refusal` from
 * preconditions.ts, `StepStatus` from steps.ts). The state lives with the
 * feature; the service owns the SIGNAL and the card owns the buttons.
 *
 * Separate from `BatchState` rather than a sixth arm of it, because the two
 * runs answer different questions and can be in flight together: fitting a
 * batch produces a FINGERPRINT — a frequency and a damping ratio a shaper is
 * tuned from — and a sweep produces a PICTURE of which peaks follow speed.
 * Sharing one state would let a sweep's progress overwrite a fingerprint's
 * summary on the card the operator is reading it from.
 */
import { analysedRows, type SweepMatrix } from "./engine/sweep.ts";

export type SweepState =
	| { readonly kind: "idle" }
	| { readonly kind: "loading"; readonly done: number; readonly total: number; readonly file: string }
	/** Downloads finished, the worker is transforming. One FFT per row, so this
	 *  is where a nine-capture sweep spends its time. */
	| { readonly kind: "computing"; readonly total: number }
	| {
		readonly kind: "built";
		readonly tool: number;
		readonly family: string;
		/** Rows in the matrix, and how many of them the transform could use. A
		 *  capture whose record holds too little constant-velocity motion yields
		 *  nothing, and a sweep that quietly drew it as silence would read as
		 *  "the machine is quiet at 10 mm/s" (engine/sweep.ts `analysedRows`). */
		readonly rows: number;
		readonly analysed: number;
	}
	| { readonly kind: "saving"; readonly tool: number }
	| { readonly kind: "saved"; readonly tool: number }
	| { readonly kind: "failed"; readonly why: string };

/**
 * What a sweep BUILD is doing — the raw phase, before the sentence the card
 * shows is derived from it.
 *
 * Its `built` arm carries only what the build itself knows: the tool it ran
 * for and the family of captures it read. Everything else `SweepState`'s
 * `built` arm states is a fact about the MATRIX, and the matrix lives in the
 * results store; counting its rows into this signal would make a second copy
 * of that fact, in a place the store cannot reach when the first one changes.
 */
export type SweepPhase =
	| Exclude<SweepState, { readonly kind: "built" }>
	| { readonly kind: "built"; readonly tool: number; readonly family: string };

/**
 * The sentence the Sweep card shows, derived from the phase AND from the very
 * matrix the card's Save button is gated on.
 *
 * This function exists because those two were separate signals, and they
 * disagreed. `load()` emptied the results store for any tool with no file on
 * the card, which is every tool before its first save; the phase signal was
 * not touched, so the card went on reading "t0_sweep_X: 8 of 8 speeds, held
 * for T0" over a store that no longer had the matrix, while Save — gated on
 * that matrix — went disabled and stayed disabled. The visible half was the
 * wrong one (GitHub #100).
 *
 * @invariant the-sentence-and-the-save-gate-are-one-value
 * @rung 8  derived, not stored — `built` is the only arm that claims a matrix
 *          is held, and it is UNREACHABLE unless the `held` argument is a
 *          matrix. `held` is the same accessor the Save button's `disabled`
 *          reads (`svc.sweepHeld()`, compose/services.ts), so "the card says a
 *          sweep is held" and "Save is enabled" are two readings of one value
 *          rather than two states that have to be kept in step. There is no
 *          spelling for the disagreement: to write it, a caller would have to
 *          pass a matrix here and a different one to the button
 * @why the failure this replaces was invisible as lost work and visible as a
 *      dead control, which is the worst arrangement of the two: the operator
 *      was told the sweep existed by the only line on the card that talks, and
 *      was refused by the only button that acts
 */
export function sweepSentence(phase: SweepPhase, tool: number, held: SweepMatrix | null): SweepState {
	if (phase.kind !== "built") return phase;
	// Two collapses to `idle`, and both are the same rule: the `built`
	// sentence is about the tool on screen, so it may not be said when there
	// is no matrix for that tool — whether because there never was one, or
	// because the build was for a different head and the picker has moved.
	if (held === null || phase.tool !== tool) return { kind: "idle" };
	return { kind: "built", tool, family: phase.family, rows: held.speeds.length, analysed: analysedRows(held) };
}
