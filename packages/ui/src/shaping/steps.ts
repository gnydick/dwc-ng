/**
 * The five things the Shaping screen does, whether each one can be done right
 * now, and which one to do next.
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
 *          enabled/disabled state AND of the sentence beside it AND of the
 *          reason-kind its chip renders, from one switch over one input
 *          record. A button cannot be enabled while showing a reason it is
 *          not, because all three come out of the same call: `enabled` is
 *          literally `block.kind === "none"`, evaluated here and nowhere else
 * @why the first version of this had the button's `disabled` on one expression
 *      and its caption on another; they agree until someone edits one of them,
 *      and the failure mode is a control that looks available and does nothing
 *
 * @invariant next-step-comes-from-the-readiness-it-shows
 * @rung 7  derive, don't duplicate — `nextStep` is the ONLY producer of a
 *          `Workflow`, it calls `stepReadiness` exactly once per step, and the
 *          step it names as next is one of the very objects in `steps` (same
 *          reference, not an equal copy). No expression anywhere else decides
 *          "which step is next", because the pick is an index INTO that array
 *          and the array is built once, here. A caller cannot compute
 *          readiness a second time and get a different answer, because it has
 *          no reason to compute it at all — the answer arrives attached
 * @why the status card now says "do this next" in a prominent button. A second
 *      expression choosing that step would be the same drift as the caption
 *      above, one level up, and its failure mode is worse: a primary action
 *      pointing at a step the list beside it shows as blocked
 */
import { stepNoteText } from "./copy.ts";
import type { CardId } from "../compose/defs.ts";
import type { Refusal } from "./preconditions.ts";

/**
 * The five, in the order they are done. A closed union so the step list, the
 * handler registry and the readiness table are indexed by one set rather than
 * by parallel strings.
 */
export type ShapingStep = "measure" | "sweep" | "rank" | "verify" | "apply";

/** What a step needs to have happened before it means anything. */
export type StepNeed = "fingerprint" | "candidates" | "recommendation";

/**
 * What a step leaves on the card once it has been done.
 *
 * Deliberately NOT the same list as `StepNeed`. Apply needs a recommendation,
 * which is derived from verified runs or from the ranking, and produces an
 * applied spec; verify needs candidates and produces verified runs. Collapsing
 * the two lists would make "is it done" and "can it start" one question, and
 * telling those apart is the whole job of this module.
 */
export type StepProduct = "fingerprint" | "sweep" | "candidates" | "verified" | "applied";

export interface StepSpec {
	readonly step: ShapingStep;
	readonly label: string;
	/** Does it drive the carriage? Only these are gated by the planner's refusal. */
	readonly moves: boolean;
	/** The card that carries it out, in the words on that card's header. */
	readonly owner: string;
	/**
	 * That card's registry id, so "is it on this screen?" is a lookup rather
	 * than a guess. `owner` must be that card's title; a test pins it, because
	 * importing the registry for the string would drag the whole card table
	 * into a module that is deliberately pure and node-testable.
	 */
	readonly ownerCard: CardId;
	readonly needs?: StepNeed;
	readonly produces: StepProduct;
}

export const SHAPING_STEPS: readonly StepSpec[] = [
	{ step: "measure", label: "Measure", moves: true, owner: "Capture", ownerCard: "shaping-capture", produces: "fingerprint" },
	{ step: "sweep", label: "Sweep", moves: true, owner: "Speed sweep", ownerCard: "shaping-sweep", produces: "sweep" },
	// No motion: ranking is arithmetic over a fingerprint already on the card,
	// so the status card's own service offers it and this card is its owner.
	{ step: "rank", label: "Rank", moves: false, owner: "Shaping", ownerCard: "shaping-status", needs: "fingerprint", produces: "candidates" },
	{ step: "verify", label: "Verify", moves: true, owner: "Verify", ownerCard: "shaping-verify", needs: "candidates", produces: "verified" },
	// No motion either: Apply sends M593 or writes tpostN.g. The write guard is
	// what stands in front of it, not the motion preconditions.
	{ step: "apply", label: "Apply", moves: false, owner: "Apply", ownerCard: "shaping-apply", needs: "recommendation", produces: "applied" },
];

export interface StepInputs {
	/** The planner's answer for the selected tool, or null when it would move. */
	readonly refusal: Refusal | null;
	/** Is the card that owns this step on this screen at all? */
	readonly present: boolean;
	/** Has a card on this screen offered to carry this step out? */
	readonly offered: boolean;
	readonly hasFingerprint: boolean;
	readonly hasSweep: boolean;
	readonly hasCandidates: boolean;
	readonly hasVerified: boolean;
	readonly hasRecommendation: boolean;
	readonly hasApplied: boolean;
	/** This step is already running. */
	readonly busy: boolean;
}

/**
 * Why a step cannot be taken, as DATA rather than as a sentence.
 *
 * A closed union for the same reason `Refusal` is one: the copy table that
 * renders it (copy.ts `stepNoteText`) is exhaustive by compilation, and the
 * chip beside the sentence is chosen from the same value the sentence is
 * written from — so a chip reading "no card" over a sentence about homing is
 * not a state anything can produce.
 *
 * `off-screen` and `not-built` are the distinction this module gained for. An
 * operator who removed the Capture card and a Capture card that has no run
 * control yet are two different problems with two different remedies, and one
 * sentence for both is what made a missing feature read as a broken one.
 */
export type StepBlock =
	| { readonly kind: "none" }
	| { readonly kind: "machine"; readonly refusal: Refusal }
	| { readonly kind: "input"; readonly need: StepNeed }
	| { readonly kind: "off-screen"; readonly owner: string }
	| { readonly kind: "not-built"; readonly owner: string }
	| { readonly kind: "busy" };

export interface StepReadiness {
	/** Derived here and only here: a step is enabled exactly when nothing
	 *  blocks it. Two fields, one expression, so they cannot disagree. */
	readonly enabled: boolean;
	readonly block: StepBlock;
	/** Always a sentence — an enabled step says so rather than saying nothing,
	 *  so the slot beside every button is the same height whatever it holds. */
	readonly note: string;
}

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
 * Is this step's product already on the card? Total over the product union, so
 * a step added without an answer to "how would I know it had been done" is a
 * compile error rather than a step that never reads as done.
 */
const produced = (product: StepProduct, i: StepInputs): boolean => {
	switch (product) {
		case "fingerprint":
			return i.hasFingerprint;
		case "sweep":
			return i.hasSweep;
		case "candidates":
			return i.hasCandidates;
		case "verified":
			return i.hasVerified;
		case "applied":
			return i.hasApplied;
		default: {
			const unhandled: never = product;
			throw new Error(`unknown step product: ${String(unhandled)}`);
		}
	}
};

/**
 * What stands between this step and being taken.
 *
 * Order matters and is the operator's, not the code's: what the MACHINE says
 * comes first, because "home X and Y first" is the thing to go and do; then
 * what this tool is missing; then whether the card that would do it is even on
 * the screen; then whether that card can do it yet. A step blocked four ways
 * shows the one that is furthest upstream.
 */
function blockOf(spec: StepSpec, inputs: StepInputs): StepBlock {
	if (spec.moves && inputs.refusal !== null) return { kind: "machine", refusal: inputs.refusal };
	if (spec.needs !== undefined && !met(spec.needs, inputs)) return { kind: "input", need: spec.needs };
	if (!inputs.present) return { kind: "off-screen", owner: spec.owner };
	if (!inputs.offered) return { kind: "not-built", owner: spec.owner };
	if (inputs.busy) return { kind: "busy" };
	return { kind: "none" };
}

/** Whether a step can be taken, why not, and the one sentence explaining it —
 *  all from one call, which is the invariant at the top of this file. */
export function stepReadiness(spec: StepSpec, inputs: StepInputs): StepReadiness {
	const block = blockOf(spec, inputs);
	return { enabled: block.kind === "none", block, note: stepNoteText(block) };
}

/**
 * How a step reads in the ordered list.
 *
 * Seven, where the screen's requirement named five, and the two extra are not
 * padding. `ready` exists because more than one step can be runnable at once —
 * Measure and Sweep both are, the moment their cards can run them — and only
 * one of those can be the next thing to do; calling both "next" would put two
 * primary answers on one card. `busy` exists because a step that is running is
 * neither blocked nor available, and a chip reading "blocked" over the
 * sentence "working…" would be a lie about a machine doing what was asked.
 */
export type StepStatus = "done" | "next" | "ready" | "blocked" | "off-screen" | "not-built" | "busy";

export interface StepState {
	readonly spec: StepSpec;
	readonly readiness: StepReadiness;
	/** Its product is on the card. Still re-runnable — `readiness` says so. */
	readonly done: boolean;
	readonly status: StepStatus;
}

export interface Workflow {
	/** The five, in registry order, each carrying the one readiness answer. */
	readonly steps: readonly StepState[];
	/** The same objects, by step. Total: every member of `ShapingStep` has an
	 *  entry, because `SHAPING_STEPS` covers the union (pinned by a test). */
	readonly byStep: Readonly<Record<ShapingStep, StepState>>;
	/**
	 * The one to act on now, or null when every step's product is already on
	 * the card — the only state in which there is genuinely nothing next.
	 *
	 * Reference-identical to its entry in `steps`, so the prominent button and
	 * the row it corresponds to cannot show different readiness.
	 */
	readonly next: StepState | null;
}

/**
 * Every step's state and which one to do next, from one pass.
 *
 * The pick, in the operator's order: the first step whose product is NOT
 * already on the card and which can be run right now; failing that, the first
 * one that is not done, whatever is blocking it, so the region shows a reason
 * rather than an empty space; failing that — everything done — nothing.
 *
 * A step that is done is skipped even when it is runnable. Re-measuring is a
 * thing an operator does and the button in the list stays live for it; it is
 * simply not what to do NEXT once it has been done.
 *
 * This returns the whole board rather than only the winner because choosing
 * the winner needs every step's readiness anyway: handing back just the pick
 * would force the caller to compute the other four a second time, which is
 * exactly the drift `step-readiness-has-one-answer` exists to prevent.
 */
export function nextStep(inputsFor: (spec: StepSpec) => StepInputs): Workflow {
	const rows = SHAPING_STEPS.map((spec) => {
		const inputs = inputsFor(spec);
		return { spec, readiness: stepReadiness(spec, inputs), done: produced(spec.produces, inputs) };
	});

	const pending = rows.filter((r) => !r.done);
	const pick = pending.find((r) => r.readiness.enabled) ?? pending[0] ?? null;

	const steps: readonly StepState[] = rows.map((r) => ({ ...r, status: statusOf(r, r === pick) }));
	// Not an unchecked assertion: `steps` is a 1:1 map over SHAPING_STEPS,
	// which covers `ShapingStep` — a fact a readonly array cannot state in the
	// type, so test/shaping-steps.test.ts states it instead.
	const byStep = Object.fromEntries(steps.map((s) => [s.spec.step, s])) as Record<ShapingStep, StepState>;
	const next = pick === null ? null : byStep[pick.spec.step];

	return { steps, byStep, next };
}

function statusOf(row: { readonly readiness: StepReadiness; readonly done: boolean }, isNext: boolean): StepStatus {
	if (row.done) return "done";
	if (isNext) return "next";
	if (row.readiness.enabled) return "ready";
	switch (row.readiness.block.kind) {
		case "off-screen":
			return "off-screen";
		case "not-built":
			return "not-built";
		case "busy":
			return "busy";
		case "machine":
		case "input":
			return "blocked";
		// Unreachable — `none` means enabled, which returned above. Named
		// rather than defaulted, so a new block kind is a compile error here as
		// well as in the copy table.
		case "none":
			return "ready";
		default: {
			const unhandled: never = row.readiness.block;
			throw new Error(`unknown step block: ${String((unhandled as { kind: unknown }).kind)}`);
		}
	}
}
