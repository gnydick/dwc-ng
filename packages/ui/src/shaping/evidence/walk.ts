/**
 * The flow: where you are, what you know, and what the next question is.
 *
 * This is the "walk through all of that stuff" half of issue #68, and it is
 * deliberately NOT built out of findings alone. A findings-only thread is
 * silent on a machine that has measured nothing — no data, no caveats, nothing
 * to say — which is precisely the moment an operator most needs leading. The
 * walk is therefore built from the STAGES first and the findings second: every
 * stage has a question it exists to answer, whether or not it has been run.
 *
 * Two kinds of line, and the difference is the whole design:
 *
 *  - what is KNOWN, stated as the fact it is;
 *  - what is OPEN, stated as a question with the act that would settle it.
 *
 * Ordered by the workflow, because the questions genuinely depend on each
 * other: "which shaper?" is not worth asking while "are these modes real?" is
 * unanswered, and a tool that offered both at once would be handing the
 * operator the same choice they already could not make.
 *
 * @invariant the-walk-is-never-empty
 * @rung 7  totality — every `ShapingStep` has a row in `STEP_QUESTION` (a
 *          `Record` over the closed union, so a step added without one is a
 *          compile error) and every stage contributes either a known line or an
 *          open question. A tool with nothing measured therefore still walks:
 *          five open questions and the first one live
 * @why the previous thread was a fold over caveats, and on a freshly wiped
 *      machine it rendered the em dash — the screen said "Next: Measure" and
 *      then nothing about why, which is the state this campaign exists to fix
 */
import type { Caveat } from "./caveat.ts";
import type { Evidence } from "./evidence.ts";
import { type Inquiry, inquiryFor } from "./inquiry.ts";
import { severityOf } from "./caveat.ts";
import type { ShapingStep, WorkflowProducts } from "../steps.ts";
import type { ToolResults } from "../results.ts";

/**
 * What each step would TELL you — the reason to run it, not the act.
 *
 * Phrased as the operator's question rather than as the tool's label, because
 * "Sweep" names a button and "are these resonances, or the motors' own ripple?"
 * names the thing they are actually trying to find out. The second is what lets
 * somebody decide whether the run is worth the time, and recognise the answer
 * when it arrives.
 */
const STEP_QUESTION: Record<ShapingStep, string> = {
	measure: "What frequencies does this tool ring at?",
	sweep: "Are those frequencies resonances, or the motors' own ripple?",
	rank: "Which shaper would suppress them?",
	verify: "Does that shaper actually help on this machine?",
	apply: "Is it installed for this tool?",
};

/** The act that answers a stage's own question is that stage. */
const stageInquiry = (step: ShapingStep): Inquiry => ({
	question: STEP_QUESTION[step],
	answer: { kind: "step", step, adjust: null },
});

export type WalkLine =
	/** Established, and the numbers that establish it. */
	| { readonly kind: "known"; readonly step: ShapingStep; readonly text: string }
	/** Not established, with the question and what would settle it. */
	| { readonly kind: "open"; readonly step: ShapingStep; readonly inquiry: Inquiry; readonly caveat: Caveat | null };

export type Walk = {
	readonly lines: readonly WalkLine[];
	/**
	 * The one question to answer now.
	 *
	 * Reference-identical to its line in `lines`, the same guarantee
	 * `nextStep` gives for the step it names: a prominent question that was
	 * not one of the listed ones is how the two come to disagree.
	 */
	readonly next: Extract<WalkLine, { kind: "open" }> | null;
};

const hz1 = (v: number): string => v.toFixed(1);

/**
 * What the tool can say about where this session has got to.
 *
 * Takes the results as well as the products because a KNOWN line has to carry
 * its numbers — "T0 rings at 38.0 and 42.4 Hz" is a fact the operator can check
 * against the card, where "a fingerprint exists" is the tool talking about
 * itself.
 */
export function walkThrough(r: ToolResults, p: WorkflowProducts): Walk {
	const lines: WalkLine[] = [];

	const stage = (
		step: ShapingStep,
		e: Evidence<unknown>,
		known: () => string,
	): void => {
		if (e.state !== "held") {
			// Absent, running, failed and superseded all mean the same thing to
			// somebody trying to decide what to do: this is not settled. What
			// differs is the sentence beside the button, which `stepNoteText`
			// already owns — the walk must not grow a second copy of it.
			lines.push({ kind: "open", step, inquiry: stageInquiry(step), caveat: null });
			return;
		}
		lines.push({ kind: "known", step, text: known() });
		// Its own findings become further questions, worst first, so a stage
		// that RAN but cannot be trusted does not read as finished.
		const worst = [...e.caveats].sort(
			(a, b) => Number(severityOf(b) === "disqualifying") - Number(severityOf(a) === "disqualifying"),
		);
		for (const c of worst) lines.push({ kind: "open", step, inquiry: inquiryFor(c), caveat: c });
	};

	stage("measure", p.fingerprint, () => {
		const x = r.fingerprint?.X;
		const y = r.fingerprint?.Y;
		const both = [x === undefined || x === null ? null : `X ${hz1(Number(x.f))} Hz`, y === undefined || y === null ? null : `Y ${hz1(Number(y.f))} Hz`]
			.filter((s): s is string => s !== null)
			.join(", ");
		return `T${r.tool} rings at ${both || "no fitted mode"}, from ${r.captures.length} captures`;
	});

	stage("sweep", p.sweep, () => {
		const speeds = r.sweep === null ? [] : r.sweep.speeds.map(Number);
		const forced = r.sweep === null ? [] : r.sweep.fullStepHz.map(Number);
		return speeds.length === 0
			? "a sweep is on the card"
			: `swept ${speeds.length} speeds, ${Math.min(...speeds)}-${Math.max(...speeds)} mm/s, forcing ${hz1(Math.min(...forced))}-${hz1(Math.max(...forced))} Hz`;
	});

	stage("rank", p.candidates, () => `${r.candidates.length} shapers ranked against that fingerprint`);
	stage("verify", p.verified, () => `${r.verified.length} measured on the machine`);
	stage("apply", p.applied, () => "a shaper is installed for this tool");

	// The FIRST open question, not the worst. The walk is ordered by the
	// workflow, and answering a later question while an earlier one stands is
	// how somebody ends up ranking against a fingerprint nothing has checked.
	const next = lines.find((l): l is Extract<WalkLine, { kind: "open" }> => l.kind === "open") ?? null;
	return { lines, next };
}
