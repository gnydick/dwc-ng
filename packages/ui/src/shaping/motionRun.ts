/**
 * What the machine is doing on this screen's behalf, right now.
 *
 * Its own module, beside `sweepRun.ts` and for the same layering reason: the
 * copy table (`shaping/copy.ts`) writes this union's sentences with a `never`
 * arm, and a state union that lived in `compose/services.ts` would invert the
 * direction every other shaping type runs in. The service owns the SIGNAL and
 * the slot; the Capture card owns the buttons; this owns the vocabulary.
 *
 * SEPARATE FROM `SweepState`, deliberately, and the distinction is not a
 * technicality. `SweepState` is a TRANSFORM over captures that already exist —
 * download, FFT, draw, save — and it can be entered on a machine that is
 * switched off. This is MOTION: a carriage crossing a box at 200 mm/s with
 * nobody's hand on the jog wheel. They are also sequential rather than
 * alternative — a live sweep run ENDS by leaving files on the card, and the
 * Sweep card's `buildSweep` is what turns those into a picture — so collapsing
 * them into one union would make "the machine is moving" and "the browser is
 * doing arithmetic" indistinguishable states of one thing, on the one screen
 * where that difference is the whole point.
 *
 * Nothing here decides anything, and nothing here talks to a machine. Every
 * value is a report of something `Procedure.run` already did.
 */
import type { Refusal } from "./preconditions.ts";
import type { RunKind } from "./runPlan.ts";

/**
 * How a run stopped.
 *
 * Four arms, and none of them collapses into another.
 *
 *  - `cancelled` is not a failure: the operator pressing Cancel is a deliberate
 *    act, and reporting it as a fault teaches them to distrust the word.
 *  - `refused` is not a failure either — the planner declined and NOTHING was
 *    sent, which is the machinery working. It carries the `Refusal` itself
 *    rather than a sentence, so the one copy table writes those words wherever
 *    they are shown.
 *  - `failed` carries the run's OWN sentence, which is how the two capture
 *    diagnoses survive to the screen: "the board finished a capture but the
 *    file never appeared" and "no capture appeared at all" are different jobs
 *    for the operator, and summarising either into "failed" throws away the
 *    only thing that tells them apart.
 */
export type MotionOutcome =
	| { readonly kind: "done" }
	| { readonly kind: "failed"; readonly why: string }
	| { readonly kind: "cancelled" }
	| { readonly kind: "refused"; readonly refusal: Refusal };

/**
 * Every state the screen's one motion slot can be in.
 *
 * Three facts ride on the terminal state and none is optional:
 *
 *  - `captured` of `expected`, because a run that stopped on its ninth capture
 *    still produced eight real ones, and a report saying only "failed" would
 *    throw away a measurement that is on the card;
 *  - `touched`, whether anything at all was sent to the machine. A refusal
 *    sends nothing, and a report that discussed the machine's shaper after a
 *    refusal would be describing a run that never happened;
 *  - `restored`, because a run changes `M593` on a verify pass and puts it back
 *    from a `finally`. Whether that last send landed is a fact about the
 *    machine the operator prints with next, and it is exactly what a "done"
 *    that did not mention it would hide.
 */
export type MotionState =
	| { readonly kind: "idle" }
	/** Reading the machine and planning — before anything has been sent. */
	| { readonly kind: "planning"; readonly run: RunKind }
	| {
		readonly kind: "running";
		readonly run: RunKind;
		/** 1-based, over the WHOLE run: all its plans, all their steps. */
		readonly step: number;
		readonly steps: number;
		readonly label: string;
		readonly captured: number;
		readonly expected: number;
	}
	/** Steps finished; the shaper is being put back. */
	| { readonly kind: "restoring"; readonly run: RunKind; readonly captured: number; readonly expected: number }
	/** The machine is done and the browser is fitting what it recorded. */
	| { readonly kind: "fitting"; readonly run: RunKind; readonly done: number; readonly total: number }
	| {
		readonly kind: "ended";
		readonly run: RunKind;
		readonly outcome: MotionOutcome;
		readonly captured: number;
		readonly expected: number;
		readonly touched: boolean;
		readonly restored: boolean;
	};

/**
 * Is the machine, or the browser on its behalf, still busy?
 *
 * ONE predicate, because three things read it — the run button's disabled
 * state, the status card's `busy` input, and the slot claim that makes a second
 * run unrepresentable — and three spellings of "is it running" is how a second
 * run gets started while the first is mid-move.
 */
export function motionBusy(state: MotionState): boolean {
	switch (state.kind) {
		case "planning":
		case "running":
		case "restoring":
		case "fitting":
			return true;
		case "idle":
		case "ended":
			return false;
		default: {
			const unhandled: never = state;
			throw new Error(`unknown motion state: ${String((unhandled as { kind: unknown }).kind)}`);
		}
	}
}

/**
 * The progress bar's fill, 0…1, and the step counts beside it.
 *
 * Pure, and it answers for EVERY state — including the ones with no progress to
 * report — because the bar is a reserved slot on a card that is watched while
 * the machine works. A bar that appeared when a run started would move
 * everything under it at the moment the operator is looking hardest.
 */
export function motionProgress(state: MotionState): { readonly fraction: number; readonly step: number; readonly steps: number } {
	switch (state.kind) {
		case "running":
			// The FILL is clamped and the COUNT is not, deliberately. A fraction
			// above 1 has no meaning — it is a bar drawn past the end of its own
			// track, on a card the operator watches while the machine moves, and
			// positional stability there outranks everything. But clamping the
			// numbers too would hide the disagreement that produced it: when
			// `totalStepsOf` fell out of step with what `stepsFor` actually
			// sends, this read "6 of 4", and that sentence is what made the bug
			// findable. So the bar stays inside its track and the text still
			// says 6 of 4.
			return { fraction: state.steps === 0 ? 0 : Math.min(1, state.step / state.steps), step: state.step, steps: state.steps };
		case "restoring":
			return { fraction: 1, step: state.expected, steps: state.expected };
		case "fitting":
			return { fraction: state.total === 0 ? 0 : state.done / state.total, step: state.done, steps: state.total };
		case "ended":
			// A run that ended badly shows the progress it actually made rather
			// than a full bar or an empty one: "stopped at 8 of 12" is the fact,
			// and either extreme would be a different claim.
			return {
				fraction: state.expected === 0 ? 0 : state.captured / state.expected,
				step: state.captured,
				steps: state.expected,
			};
		case "idle":
		case "planning":
			return { fraction: 0, step: 0, steps: 0 };
		default: {
			const unhandled: never = state;
			throw new Error(`unknown motion state: ${String((unhandled as { kind: unknown }).kind)}`);
		}
	}
}

/**
 * Did this end in a way the operator has to act on?
 *
 * Used only to colour the sentence — the WORDS come from the copy table, so the
 * colour and the text cannot describe different states. A run that finished
 * every capture but could not put the shaper back counts: the machine is not as
 * it was found, whatever the captures did.
 */
export function motionBad(state: MotionState): boolean {
	if (state.kind !== "ended") return false;
	if (state.outcome.kind === "failed" || state.outcome.kind === "refused") return true;
	return state.touched && !state.restored;
}
