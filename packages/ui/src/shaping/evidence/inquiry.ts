/**
 * What a finding leaves you needing to know, and what would tell you.
 *
 * The half of issue #68 that a caveat alone does not deliver. A caveat states
 * a FACT about a measurement — "nothing in this sweep drove X at 38 Hz". That
 * is necessary and it is not enough, because the operator's actual question is
 * "so what do I do?", and leaving them to derive the answer is exactly the
 * position they were in before this layer existed. Gabe, 2026-08-23: *"the tool
 * should walk through all of that stuff, have the flow for how to interpret
 * this stuff."*
 *
 * The distinction that makes this worth a module. A REMEDY is a sentence; a
 * QUESTION is a thing that is currently unanswerable and a named act that would
 * answer it. The second composes into a walk and the first does not — you
 * cannot order a list of prose remedies by which to do first, but you can order
 * questions by which one the others depend on.
 *
 * @invariant every-caveat-has-an-inquiry
 * @rung 7  totality — `inquiryFor` switches on the caveat union with a `never`
 *          arm and no default. A finding added without saying what question it
 *          raises stops compilation, which is the point: a finding that leaves
 *          the operator nowhere to go is the failure this module exists to
 *          prevent, and it must not be possible to add one by accident
 * @why the screen already said what to DO next (#37) and now says what the
 *      readings MEAN. Neither one connects the two, and the gap between them is
 *      where the 2026-08-23 wrong conclusion was reached: the sweep's black band
 *      was a fact, the fingerprint was a fact, and nothing said "these two do
 *      not contradict each other, and here is the measurement that would settle
 *      it"
 */
import type { Caveat } from "./caveat.ts";
import type { ShapingStep } from "../steps.ts";

/**
 * What would answer the question.
 *
 * Three arms, because the three have genuinely different consequences for the
 * operator and collapsing them is how a tool tells someone to do something it
 * could have done for them — or worse, something it cannot do at all.
 */
export type Answer =
	/**
	 * A step on this screen, possibly needing a setting changed first.
	 *
	 * `adjust` is the load-bearing field. "Build a sweep" is the wrong
	 * instruction when the sweep the operator would build is the one that
	 * already failed to answer the question; the ladder has to change too, and
	 * the sentence has to say so in the same breath.
	 */
	| { readonly kind: "step"; readonly step: ShapingStep; readonly adjust: string | null }
	/** Nothing on this screen answers it — the act is at the machine. */
	| { readonly kind: "machine"; readonly how: string }
	/**
	 * The tool cannot answer it yet and no act by the operator changes that.
	 *
	 * An honest arm, not a failure one. "We cannot tell you, and here is what
	 * would" is a legitimate finding and often the most useful sentence on the
	 * screen; what it must never do is masquerade as something the operator has
	 * neglected to do.
	 */
	| { readonly kind: "not-yet"; readonly blocked: string };

export type Inquiry = {
	/** The thing that is currently unanswerable, phrased as a question. */
	readonly question: string;
	readonly answer: Answer;
};

/**
 * The question each finding raises, and what would settle it.
 *
 * Written as questions rather than as imperatives on purpose. "Run a sweep at
 * 8 mm/s" is an instruction the operator must take on trust; "are these
 * resonances, or motor ripple? — a sweep whose ladder reaches 5-15 mm/s would
 * say" tells them what they are buying with the run, which is what lets them
 * judge whether it is worth doing and recognise the answer when it arrives.
 */
export function inquiryFor(c: Caveat): Inquiry {
	switch (c.kind) {
		case "forcing-band-excludes-mode":
			return {
				question: `Is ${c.axis} at ${c.modeHz.toFixed(1)} Hz really there? Nothing has driven it yet.`,
				answer: {
					kind: "step",
					step: "sweep",
					// Naming the speed IS the answer. A sweep at the ladder that
					// produced this finding would come back just as black, and
					// the operator would read the second black band as
					// confirmation rather than as the same non-answer twice.
					adjust: `set the sweep ladder to reach about ${c.needMmPerS.toFixed(1)} mm/s — the current one starts too fast to excite it`,
				},
			};
		case "rows-not-analysed":
			return {
				question: `What happened at the ${c.rows - c.analysed} speed${c.rows - c.analysed === 1 ? "" : "s"} that produced nothing?`,
				answer: {
					kind: "step",
					step: "sweep",
					adjust: "lengthen the move or raise the slowest speeds, so each pass records some constant-velocity travel",
				},
			};
		case "mode-on-forcing-locus":
			return {
				question: `Is ${c.axis} at ${c.modeHz.toFixed(1)} Hz a resonance at all, or just the motors?`,
				answer: {
					kind: "machine",
					// Deliberately NOT a step: no shaper moves motor ripple, and
					// offering a shaping act here would be the tool leading
					// somebody into the exact wrong action.
					how: "shaping cannot move it — try motor current, microstepping, or the mechanics, then measure again",
				},
			};
		case "mode-locus-unknown":
			return {
				question: "Are these modes resonances, or the motors' own ripple?",
				answer: {
					kind: "step",
					step: "sweep",
					adjust: null,
				},
			};
		case "direction-spread":
			return {
				question: `Why does ${c.axis} ring differently at the two ends of its travel?`,
				answer: {
					kind: "machine",
					how: "the ring-down happens at the opposite end each way, so this is usually the machine, not the measurement — check belt tension and rail support across the axis",
				},
			};
		case "fits-at-damping-cap":
			return {
				question: `Is ${c.axis} really this damped, or is the excitation too weak to see it?`,
				answer: {
					kind: "step",
					step: "measure",
					adjust: "raise the speed or the distance so the stop excites a longer ring",
				},
			};
		case "few-fits":
			return {
				question: `Would ${c.axis} come back the same if measured again?`,
				answer: { kind: "step", step: "measure", adjust: "more repeats would tighten the median" },
			};
		case "axes-agree":
			return {
				question: "Was a shaper running when this was measured?",
				answer: {
					kind: "machine",
					// The one finding whose answer is a thing to go and READ
					// rather than a thing to run, because the evidence is
					// already on the board.
					how: "send M593 with no parameters to see what is active; if a shaper is on, turn it off with M593 P\"none\" and measure again",
				},
			};
		case "predicted-not-measured":
			return {
				question: "Does the top-ranked shaper actually help on this machine?",
				answer: { kind: "step", step: "verify", adjust: null },
			};
		case "inherited":
			// The question is the SOURCE's question, unchanged. Restating it in
			// the ranking's own words would be a second phrasing of one
			// question, and the operator would not know they were the same.
			return inquiryFor(c.caveat);
		default: {
			const unhandled: never = c;
			throw new Error(`unknown caveat: ${String((unhandled as { kind: unknown }).kind)}`);
		}
	}
}
