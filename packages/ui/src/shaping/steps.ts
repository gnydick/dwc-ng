/**
 * The five things the Shaping screen does, and whether each one can be done
 * right now.
 *
 * Pure and node-testable, which is the point: "why is this button grey" is the
 * question the status card exists to answer, and answering it in JSX would make
 * it checkable only by looking. Every sentence here restates a fact somebody
 * else established — the planner's refusal, the store's contents, which cards
 * the operator has on the screen. Nothing in this module decides whether the
 * machine may move.
 *
 * @invariant step-readiness-has-one-answer
 * @rung 6  choke-point — `stepReadiness` is the sole producer of a step's
 *          enabled/disabled state AND of the sentence beside it, from one
 *          switch over one input record. A button cannot be enabled while
 *          showing a reason it is not, because the two come out of the same
 *          call
 * @why the first version of this had the button's `disabled` on one expression
 *      and its caption on another; they agree until someone edits one of them,
 *      and the failure mode is a control that looks available and does nothing
 * @debt the note strings are assembled here while the refusal sentences live in
 *       copy.ts. Promote by moving these into copy.ts too, so there is one
 *       module anyone looking for the screen's words has to read.
 */
import { refusalText } from "./copy.ts";
import type { Refusal } from "./preconditions.ts";

/**
 * The five, in the order they are done. A closed union so the step list, the
 * handler registry and the readiness table are indexed by one set rather than
 * by parallel strings.
 */
export type ShapingStep = "measure" | "sweep" | "rank" | "verify" | "apply";

/** What a step needs to have happened before it means anything. */
type StepNeed = "fingerprint" | "candidates" | "recommendation";

export interface StepSpec {
	readonly step: ShapingStep;
	readonly label: string;
	/** Does it drive the carriage? Only these are gated by the planner's refusal. */
	readonly moves: boolean;
	/** The card that carries it out — named when that card is not on the screen. */
	readonly owner: string;
	readonly needs?: StepNeed;
}

export const SHAPING_STEPS: readonly StepSpec[] = [
	{ step: "measure", label: "Measure", moves: true, owner: "Capture" },
	{ step: "sweep", label: "Sweep", moves: true, owner: "Speed sweep" },
	// No motion: ranking is arithmetic over a fingerprint already on the card.
	{ step: "rank", label: "Rank", moves: false, owner: "Shaping", needs: "fingerprint" },
	{ step: "verify", label: "Verify", moves: true, owner: "Verify", needs: "candidates" },
	// No motion either: Apply sends M593 or writes tpostN.g. The write guard is
	// what stands in front of it, not the motion preconditions.
	{ step: "apply", label: "Apply", moves: false, owner: "Apply", needs: "recommendation" },
];

export interface StepInputs {
	/** The planner's answer for the selected tool, or null when it would move. */
	readonly refusal: Refusal | null;
	/** Has a card on this screen offered to carry this step out? */
	readonly offered: boolean;
	readonly hasFingerprint: boolean;
	readonly hasCandidates: boolean;
	readonly hasRecommendation: boolean;
	/** This step is already running. */
	readonly busy: boolean;
}

export interface StepReadiness {
	readonly enabled: boolean;
	/** Always a sentence — an enabled step says so rather than saying nothing,
	 *  so the slot beside every button is the same height whatever it holds. */
	readonly note: string;
}

const NEED_NOTE: Record<StepNeed, string> = {
	fingerprint: "nothing measured yet",
	candidates: "nothing ranked yet",
	recommendation: "nothing to apply yet",
};

const met = (need: StepNeed, i: StepInputs): boolean => {
	switch (need) {
		case "fingerprint":
			return i.hasFingerprint;
		case "candidates":
			return i.hasCandidates;
		case "recommendation":
			return i.hasRecommendation;
		default: {
			const unhandled: never = need;
			throw new Error(`unknown step need: ${String(unhandled)}`);
		}
	}
};

/**
 * Whether a step can be taken, and the one sentence explaining it.
 *
 * Order matters and is the operator's, not the code's: what the MACHINE says
 * comes first, because "home X and Y first" is the thing to go and do; then
 * what this tool is missing; then which card would carry it out. A step blocked
 * three ways shows the one that is furthest upstream.
 */
export function stepReadiness(spec: StepSpec, inputs: StepInputs): StepReadiness {
	if (spec.moves && inputs.refusal !== null) return { enabled: false, note: refusalText(inputs.refusal) };
	if (spec.needs !== undefined && !met(spec.needs, inputs)) return { enabled: false, note: NEED_NOTE[spec.needs] };
	if (!inputs.offered) return { enabled: false, note: `the ${spec.owner} card runs this` };
	if (inputs.busy) return { enabled: false, note: "working…" };
	return { enabled: true, note: "ready" };
}
