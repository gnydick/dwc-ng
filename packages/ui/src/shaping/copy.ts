/**
 * The words the Shaping screen says: a `Refusal`, a step's state, and what the
 * primary action is about to do.
 *
 * Separated from the cards for two reasons. It is a pure function over a closed
 * union, so node can test every variant without a DOM; and it is ONE table, so
 * the Capture card's inline refusal and the status card's disabled-button
 * reason cannot say different things about the same machine state.
 *
 * @invariant every-refusal-has-copy
 * @rung 7  totality — `refusalText` switches on the discriminant with a `never`
 *          arm and no default, so a variant added to `Refusal` stops
 *          compilation here until someone has written its sentence. That is not
 *          hypothetical: work item C added `not-measurable` after this table was
 *          specified, and the `never` arm is what turned a missing row into a
 *          compile error rather than a button that renders the empty string
 * @why a control disabled with no reason is worse than a control that is not
 *      there — the operator cannot tell a refusal from a bug, and the whole
 *      point of returning `Refusal` as DATA rather than a boolean was that the
 *      reason survives to the screen
 *
 * Nothing here decides anything. Each sentence restates a verdict the procedure
 * already reached (shaping/preconditions.ts, shaping/procedure.ts); the UI adds
 * no gate of its own, because the firmware and the planner are the authorities
 * on whether the machine may move.
 */
import { ACCEL_DIR } from "./captures.ts";
import type { Fingerprint } from "./engine/fit.ts";
import type { Caveat } from "./evidence/caveat.ts";
import type { Refusal } from "./preconditions.ts";
import type { Supersede } from "./evidence/evidence.ts";
import type { StepBlock, StepNeed, StepSpec, StepStatus } from "./steps.ts";
import type { MotionOutcome, MotionState } from "./motionRun.ts";
import type { RunKind } from "./runPlan.ts";
import type { SweepState } from "./sweepRun.ts";

/**
 * "X" -> "X"; "XY" -> "X and Y". The refusal carries the letters that failed
 * rather than a sentence, so this is where they become one.
 */
function axisList(axes: string): string {
	const letters = [...axes];
	if (letters.length <= 1) return axes;
	return `${letters.slice(0, -1).join(", ")} and ${letters[letters.length - 1]!}`;
}

/**
 * One sentence per refusal, in the operator's vocabulary and in the imperative
 * where there is something to do about it.
 *
 * A note on `stale`, which is the one variant that is NOT the operator's
 * problem. `planProcedure` returns it when the reading a plan was built from is
 * older than two seconds, or when the envelope was redrawn between the read and
 * the plan. Both are fixed by reading again, which the caller can simply do —
 * so a card should re-read and re-plan rather than print this at somebody. The
 * sentence exists because the union is closed and every arm must be
 * answerable, and because a re-read that ALSO comes back stale (a machine that
 * started moving in between) is a real thing to say out loud.
 *
 * The status card cannot reach it at all: its gate calls `Preconditions.read`,
 * which is a fresh read by construction and has no stale arm to return.
 */
export function refusalText(r: Refusal): string {
	switch (r.kind) {
		case "not-idle":
			return `machine is busy (${r.status})`;
		case "not-homed":
			return `home ${axisList(r.axes)} first`;
		case "no-accelerometer":
			// The empty address is the one case that does not come from a reading:
			// it is a tool with no `accelByTool` entry at all, so there is no
			// sensor to have failed to find. Naming an address that was never
			// chosen would send the operator looking for hardware.
			return r.addr === ""
				? "no accelerometer chosen for this tool — pick one in Settings › Input shaping"
				: `no accelerometer at ${r.addr} — check Settings › Input shaping`;
		case "no-envelope":
			return "set the motion envelope in Settings › Input shaping";
		case "outside-envelope":
			return `test would leave the envelope at X${r.point.x.toFixed(1)} Y${r.point.y.toFixed(1)}`;
		case "stale":
			return "the machine moved while this was being set up — try again";
		case "not-measurable":
			// No payload to name the offending field with, so it names all three
			// and the condition they share. The Capture card renders this beside
			// the very inputs it is talking about. Samples are no longer among
			// them: the tool derives the recording from the motion.
			return "nothing to measure — distance, speed and repeats must all be above zero";
		case "no-acceleration":
			// The remedy is a machine one, so the sentence names the setting
			// rather than the object-model key it is read from.
			return "the machine is not reporting a travel acceleration — set one with M204 and try again";
		case "no-sample-rate":
			return "the accelerometer did not report a sampling rate — check the board's M955 configuration";
		case "capture-too-long":
			// Both numbers, because the ratio is what says how much slower the
			// run is than the board can record — and the remedy follows from it.
			return `this run would record ${r.samples} samples per pass and the board accepts ${r.max} — shorten the move or raise the speed`;
		default: {
			const unhandled: never = r;
			throw new Error(`unknown refusal: ${String((unhandled as { kind: unknown }).kind)}`);
		}
	}
}

/* ---------------------------------------------------- the workflow's words */

/**
 * What a step is waiting for, as the one sentence beside its button.
 *
 * These used to be assembled in steps.ts while the refusal sentences lived
 * here, which was a @debt on that module: two places to look for the screen's
 * words. They are here now, and the promotion bought more than tidiness —
 * `StepBlock` is a closed union, so this switch has a `never` arm and a block
 * kind added without a sentence is a compile error, the same rung
 * `refusalText` sits at.
 *
 * `none` is a sentence too. An available step SAYS it is available rather than
 * saying nothing, because the slot beside every button has to be the same
 * height whichever state it is in — this card is watched while the machine
 * works, and a note appearing must not move the rows under it.
 */
export function stepNoteText(b: StepBlock, caveats: readonly Caveat[] = []): string {
	switch (b.kind) {
		case "none":
			// An available step whose evidence has STATED LIMITS does not read as
			// clean. Saying "ready" over a caveated fingerprint is precisely the
			// confident wrong action this layer exists to prevent, and it is why
			// this arm takes the caveats rather than being a constant.
			return caveats.length === 0 ? "ready" : caveatText(caveats[0]!);
		case "unusable":
			return caveatText(b.caveat);
		case "superseded":
			return supersedeText(b.cause);
		case "run-failed":
			return b.why;
		case "machine":
			return refusalText(b.refusal);
		case "input":
			return NEED_NOTE[b.need];
		case "off-screen":
			// The card is not on the screen at all, and the remedy is to put it
			// there — so the sentence is the imperative, not a description.
			return `add the ${b.owner} card to this screen`;
		case "not-built":
			// The card IS there and still cannot do it. Today that means the run
			// control has not been written yet; it stops being said the moment
			// that card calls `offer`. Distinguishing this from the line above
			// is the whole reason this union exists: one sentence for both is
			// what made a missing feature read as a broken one.
			return `the ${b.owner} card cannot run this yet`;
		case "busy":
			return "working…";
		default: {
			const unhandled: never = b;
			throw new Error(`unknown step block: ${String((unhandled as { kind: unknown }).kind)}`);
		}
	}
}

/**
 * What changed under a measurement, and therefore what to do about it.
 *
 * Each sentence says WHY the change matters rather than only that it happened:
 * "the tool changed" is a fact the operator already knows, and "carriage mass
 * is what moves the frequency" is the reason it invalidates the reading.
 */
export function supersedeText(s: Supersede): string {
	switch (s.kind) {
		case "tool-changed":
			return `this was measured on T${s.was} and T${s.now} is selected now — carriage mass is what moves the frequency, so measure again`;
		case "shaper-changed":
			return `the shaper changed from ${s.was} to ${s.now} since this was measured — a baseline taken through a shaper describes the suppressed machine, not this one`;
		case "accel-changed":
			return `this was measured at ${s.was.toFixed(0)} mm/s² and the machine is set to ${s.now.toFixed(0)} now — acceleration decides which mode dominates`;
		default: {
			const unhandled: never = s;
			throw new Error(`unknown supersede cause: ${String((unhandled as { kind: unknown }).kind)}`);
		}
	}
}

/**
 * Why the fitter turned a capture away, in the operator's terms.
 *
 * Total over `NoFit["reason"]` with a `never` arm: a fitter that learns a new
 * way to refuse cannot ship without a sentence explaining it, which is the
 * exact hole that let ten `short-decay` refusals pass unmentioned.
 */
function refusalReasonText(c: Extract<Caveat, { kind: "fits-refused" }>): string {
	switch (c.reason) {
		case "damping-out-of-range":
			// The one with a checkable number behind it.
			return `the ring died in ${c.cyclesFit === null ? "under two" : c.cyclesFit.toFixed(1)} cycles, short of the two a fit needs; that is the ζ ${c.cap.toFixed(4)} ceiling, arithmetic rather than noise`;
		case "short-decay":
			return `the ring did not last long enough to fit${c.cyclesFit === null ? "" : ` (${c.cyclesFit.toFixed(1)} cycles)`}, so a faster or longer move would excite it harder`;
		case "short-window":
			return "the recording ended before the ring did, so raise the sample count or shorten the move";
		case "below-floor":
			return "nothing rang above the noise floor, so the stop was too gentle to excite this axis";
		default: {
			const unhandled: never = c.reason;
			throw new Error(`unknown no-fit reason: ${String(unhandled)}`);
		}
	}
}

const NEED_NOTE: Record<StepNeed, string> = {
	fingerprint: "nothing measured yet",
	candidates: "nothing ranked yet",
	recommendation: "nothing to apply yet",
};

/**
 * The chip on a step's row: three or four characters that say which of the
 * seven states it is in, so the list can be read down without reading every
 * sentence.
 *
 * Every one of these is at most seven characters, and the slot they share is
 * sized against the longest — the mistake the source chips made was sizing a
 * fixed-width chip against the SHORTEST string it could hold and ellipsing the
 * rest.
 */
export function stepStatusText(s: StepStatus): string {
	switch (s) {
		case "done":
			return "done";
		case "next":
			return "next";
		case "ready":
			return "ready";
		case "blocked":
			return "blocked";
		case "off-screen":
			return "no card";
		case "not-built":
			return "not yet";
		case "busy":
			return "working";
		default: {
			const unhandled: never = s;
			throw new Error(`unknown step status: ${String(unhandled)}`);
		}
	}
}

/**
 * How big the thing the primary action would do actually is.
 *
 * `unknown` is not a failure arm and is not decoration either: the sweep has
 * no speed list to count until the card that builds one exists, and a button
 * reading "Sweep T0 — 9 speeds" against a plan nobody has written would be a
 * number this screen invented. Saying less is the honest answer, and it is why
 * this is a union rather than an optional count that would default to zero.
 */
export type StepScope =
	| { readonly kind: "captures"; readonly n: number }
	| { readonly kind: "shapers"; readonly n: number }
	| { readonly kind: "shaper"; readonly name: string }
	| { readonly kind: "unknown" };

/**
 * What the primary action will DO, named with the numbers the plan carries.
 *
 * "Measure T0 — 12 captures" rather than "Measure": the operator is about to
 * hand the machine twelve high-speed passes with nobody's hand on the jog
 * wheel, and the count is the difference between a button and an informed
 * consent. Every number here comes from the thing that would build the plan —
 * the configured repeats, the shaper table, the candidate on the card — never
 * from a constant written beside the sentence.
 */
export function stepActionText(spec: StepSpec, tool: number, scope: StepScope): string {
	const what = `${spec.label} T${tool}`;
	switch (scope.kind) {
		case "captures":
			return `${what} — ${scope.n} ${scope.n === 1 ? "capture" : "captures"}`;
		case "shapers":
			return `${what} — ${scope.n} ${scope.n === 1 ? "shaper" : "shapers"}`;
		case "shaper":
			return `${what} — ${scope.name}`;
		case "unknown":
			return what;
		default: {
			const unhandled: never = scope;
			throw new Error(`unknown step scope: ${String((unhandled as { kind: unknown }).kind)}`);
		}
	}
}

/**
 * The primary action when there is no next step, which happens exactly once
 * per tool: every step's product is on the card.
 *
 * It still fills the slot — a region that empties when the work finishes moves
 * everything under it on the one poll where the operator is looking hardest.
 */
export function allDoneAction(tool: number): { readonly label: string; readonly note: string } {
	return {
		label: `T${tool} is tuned`,
		note: "every step is done — any of them can be run again below",
	};
}

/**
 * What a batch fingerprint run came to, in the sentence the Decay card shows.
 *
 * Here rather than in the card, and tested, because of the one clause that
 * carries weight: **how many of how many contributed**. `aggregate` takes the
 * median of the fits that SUCCEEDED, so a capture the fitter declined is
 * absent from the numbers and present in the file — and a fingerprint from 11
 * of 12 looks exactly like one from 12 of 12 unless this says which it is.
 *
 * That case WAS real on Gabe's own baseline run: the band-mask estimator
 * declined `ring1_Xp1.csv` as `short-decay` while its five identical siblings
 * passed. GIT_33 replaced the estimator and all twelve now fit, so his first
 * fingerprint is a complete one. The clause stays because the reason it was
 * needed has not gone anywhere — a capture that ran short, a tool bumped
 * mid-run, an axis that did not ring — and a partial fingerprint still has to
 * read as one.
 *
 * The remainder clause appears only when there IS a remainder. A complete
 * aggregate that mentions captures it excluded reads as a partial one — the
 * same confusion inverted.
 */
export function batchSummaryText(contributed: number, total: number, fingerprint: Fingerprint): string {
	const axis = (name: "X" | "Y"): string => {
		const mode = fingerprint[name];
		return mode === null ? `${name} —` : `${name} ${mode.f.toFixed(1)} Hz ζ ${mode.zeta.toFixed(3)}`;
	};
	const missed = total - contributed;
	const rest = missed === 0
		? ""
		: ` ${missed === 1 ? "One capture" : `${missed} captures`} did not fit and ${missed === 1 ? "is" : "are"} excluded from the medians.`;
	return `Fitted ${contributed} of ${total} captures — ${axis("X")} · ${axis("Y")}.${rest}`;
}

/**
 * What the sweep card says while a sweep is being built, and afterwards.
 *
 * A `never` arm and no default, exactly like `refusalText`: a state added to
 * `SweepState` stops compilation here until someone has written its sentence,
 * because a card whose status line silently renders "" is indistinguishable
 * from one that is broken.
 *
 * The idle sentence is where the PHYSICS is stated, and its direction is the
 * one thing on this card that must not be got wrong. Forced vibration FOLLOWS
 * the speed — the motors' full-step rate is speed × steps/mm — so it draws a
 * ridge that climbs as the carriage goes faster, and no shaper can move it.
 * Ringing sits at ONE frequency whatever the speed and draws a vertical stripe,
 * and that is the only thing shaping can cancel.
 */
export function sweepStateText(state: SweepState): string {
	switch (state.kind) {
		case "idle":
			return "Pick a run and build its heat map. A ridge that climbs with speed is the motors' full-step rate — speed × steps/mm — and no shaper can move it. A stripe at one frequency whatever the speed is a structural mode, which is what shaping cancels.";
		case "loading":
			return `Reading ${state.done + 1} of ${state.total}: ${state.file}`;
		case "computing":
			return `Transforming ${state.total} captures — one spectrum per speed.`;
		case "built": {
			const missed = state.rows - state.analysed;
			const rest = missed === 0
				? ""
				: ` ${missed === 1 ? "One capture holds" : `${missed} captures hold`} too little constant-velocity motion to transform and ${missed === 1 ? "is" : "are"} drawn empty.`;
			return `${state.family}: ${state.analysed} of ${state.rows} speeds, held for T${state.tool}.${rest} Nothing is written to the card until you save it.`;
		}
		case "saving":
			return `Writing T${state.tool}'s results…`;
		case "saved":
			return `Saved. T${state.tool}'s results file now carries this sweep.`;
		case "failed":
			return state.why;
		default: {
			const unhandled: never = state;
			throw new Error(`unknown sweep state: ${String(unhandled)}`);
		}
	}
}

/**
 * Which of the three collections the Decay card's list is showing.
 *
 * Three genuinely different things rather than one list with tags: what a
 * tool's results file records, what the board's SD card holds, and what the
 * operator dragged in this session.
 */
export type CaptureSource = "tool" | "board" | "imported";

/**
 * What a source chip reads.
 *
 * The tool source NAMES ITS TOOL — `T0`, not `Tool`. Reported by Gabe,
 * 2026-08-23: a tool row says `ring1_Xp0.csv` with nothing on it saying whose
 * session it belongs to, and on a four-head machine that is the one fact the
 * list was missing. On the CHIP rather than in a per-row column, for two
 * reasons: every row under this chip belongs to the same tool, so a column
 * would repeat one word twelve times; and a seventh column would push the
 * captures table — already the widest thing on the card — past the width the
 * screen gives it. The chip is a declared 22u whatever it says, so naming the
 * tool moves nothing beside it.
 *
 * A `never` arm and no default, like `refusalText`: a fourth source stops
 * compilation here until someone has named it.
 */
export function captureSourceLabel(source: CaptureSource, tool: number): string {
	switch (source) {
		case "tool":
			return `T${tool}`;
		case "board":
			return "Board";
		case "imported":
			return "Imported";
		default: {
			const unhandled: never = source;
			throw new Error(`unknown capture source: ${String(unhandled)}`);
		}
	}
}

/* ------------------------------------------------- what the machine is doing */

/** What a run is called, in the operator's words rather than the union's. */
export function runKindText(kind: RunKind): string {
	switch (kind) {
		case "measure":
			return "Measure";
		case "sweep":
			return "Sweep";
		default: {
			const unhandled: never = kind;
			throw new Error(`unknown run kind: ${String(unhandled)}`);
		}
	}
}

/** "8 of 12 captures", singular where it has to be. */
const captureTally = (captured: number, expected: number): string =>
	`${captured} of ${expected} ${expected === 1 ? "capture" : "captures"}`;

/**
 * What a finished run left behind, in one clause.
 *
 * The restore clause is not decoration and is not conditional on the run having
 * gone well: `Procedure.run` sends the restore from a `finally`, so it happens
 * on a cancel and on a failure too, and whether it LANDED is a fact about the
 * machine the operator prints with next. A "done" that did not mention it is a
 * report that hides the one thing the operator cannot see for themselves.
 */
const restoreClause = (restored: boolean): string =>
	restored
		? " The machine's shaper is back as it was found."
		: " THE SHAPER WAS NOT PUT BACK — check M593 before printing.";

function outcomeText(outcome: MotionOutcome, captured: number, expected: number): string {
	switch (outcome.kind) {
		case "done":
			return `Ran ${captureTally(captured, expected)}.`;
		case "cancelled":
			return `Cancelled after ${captureTally(captured, expected)}.`;
		case "refused":
			// The planner's own words, unchanged: one refusal, one sentence,
			// wherever it is shown.
			return `Refused — ${refusalText(outcome.refusal)}.`;
		case "failed":
			// The reason comes from the run itself — including the two the capture
			// wait tells apart: a board that finished a capture and could not write
			// the file, and a board that never captured at all. Those are different
			// jobs for the operator, so the sentence is passed through whole rather
			// than summarised into "failed".
			return `Stopped after ${captureTally(captured, expected)}: ${outcome.why}`;
		default: {
			const unhandled: never = outcome;
			throw new Error(`unknown motion outcome: ${String((unhandled as { kind: unknown }).kind)}`);
		}
	}
}

/**
 * The one sentence under the Capture card's progress bar.
 *
 * A `never` arm and no default, exactly like `refusalText`: a state added to
 * `MotionState` stops compilation here until somebody has written its sentence,
 * because a status line that silently renders "" is indistinguishable from a
 * card that is broken.
 *
 * The idle sentence is where the CONSENT is stated. This is the first control
 * in this UI that drives the carriage for its own reasons rather than because
 * somebody pressed a jog button, and the operator is about to hand it a series
 * of full-speed passes with nobody watching the axis — so the resting state of
 * this line says what will happen and what will not, rather than saying nothing.
 */
export function motionStateText(state: MotionState): string {
	switch (state.kind) {
		case "idle":
			return "Nothing is running. Arming shows the exact moves; the machine is read again the moment you confirm, and any step whose carriage is not where the plan expects ends the run rather than being corrected.";
		case "planning":
			return `${runKindText(state.run)}: reading the machine…`;
		case "running":
			return `${runKindText(state.run)} step ${state.step} of ${state.steps}: ${state.label} · ${captureTally(state.captured, state.expected)} recorded`;
		case "restoring":
			return `Putting the machine's shaper back — ${captureTally(state.captured, state.expected)} recorded.`;
		case "fitting":
			return `Fitting ${state.done + 1} of ${state.total} — one ring-down per capture.`;
		case "ended":
			// The restore clause appears only when something was actually sent. A
			// refusal reaches the machine with nothing, and a report discussing
			// the machine's shaper after one would describe a run that never
			// happened.
			return `${runKindText(state.run)}: ${outcomeText(state.outcome, state.captured, state.expected)}${state.touched ? restoreClause(state.restored) : ""}`;
		default: {
			const unhandled: never = state;
			throw new Error(`unknown motion state: ${String((unhandled as { kind: unknown }).kind)}`);
		}
	}
}

/**
 * What an armed confirm is about to do, stated with the numbers the PLAN
 * carries.
 *
 * Every figure comes from the plans themselves — the capture count from
 * `plannedCaptureCount`, the move from the settings that built them — so the
 * sentence an operator consents against cannot describe a different run from
 * the one that would be sent. Escape is named because `createArmed` guarantees
 * it, and a two-step control whose way out is invisible is a two-step control
 * with no way out.
 */
export function armedRunText(kind: RunKind, captures: number, distMm: number, speedMmS: number, first: string, last: string): string {
	return `Confirm ${runKindText(kind).toLowerCase()}: ${captures} ${captures === 1 ? "capture" : "captures"}, ${distMm} mm at ${speedMmS} mm/s, writing ${first} … ${last} to ${ACCEL_DIR}. Escape cancels.`;
}

/* ------------------------------------------- what the readings actually mean */

/** One decimal, the resolution the fitter and the 1 Hz sweep bins can justify. */
const hzText = (v: number): string => v.toFixed(1);

/**
 * Two decimals, for a SPREAD rather than a frequency.
 *
 * A spread is a small difference and one decimal destroys it in the direction
 * that matters: 0.23 Hz becomes "0.2", and a 0.04 Hz spread becomes "0.0",
 * which reads as exactly zero. The whole finding is the contrast between one
 * end that moves and one that does not, so the end that does not has to be
 * legible as small-but-measured rather than as nothing.
 */
const spreadText = (v: number): string => v.toFixed(2);

/**
 * One sentence per caveat, in the operator's vocabulary, citing the numbers it
 * was derived from.
 *
 * Here rather than in a module of its own for the reason the file header
 * already gives: ONE table, so the sweep card's inline note and the status
 * card's thread cannot say different things about the same measurement.
 *
 * Every sentence states the FACT and, where there is one, the remedy. Where
 * there is no remedy the sentence says what the number is good for instead,
 * because "we cannot tell you, and here is what would" is a legitimate finding
 * and often the most useful one.
 */
export function caveatText(c: Caveat): string {
	switch (c.kind) {
		case "forcing-band-excludes-mode":
			// Both ends of the band AND the speed that would fix it. The band
			// alone reads as a complaint; the speed makes it an instruction.
			return `nothing in this sweep drove ${c.axis} at ${hzText(c.modeHz)} Hz — the ladder forces ${hzText(c.bandHz[0])}–${hzText(c.bandHz[1])} Hz, so this band is black whether or not the mode is real; a pass near ${c.needMmPerS.toFixed(1)} mm/s would bracket it`;
		case "rows-not-analysed":
			return `${c.rows - c.analysed} of ${c.rows} speeds held too little constant-velocity motion to transform — those rows are missing, not quiet`;
		case "mode-on-forcing-locus":
			return `${c.axis} at ${hzText(c.modeHz)} Hz is exactly what the motors force at ${c.speedMmPerS.toFixed(0)} mm/s, so this is likely torque ripple rather than a resonance — shaping cannot move it; current, microstepping and the mechanics can`;
		case "mode-locus-unknown":
			// Silence here would read as "checked, and fine".
			return "no sweep on this tool, so whether these modes are resonances or motor ripple has not been checked — build one to find out";
		case "direction-spread":
			return `${c.axis} reads differently at the two ends of the move: ${spreadText(c.plusHz)} Hz of spread in the plus direction against ${spreadText(c.minusHz)} Hz in the minus, on a ${hzText(c.modeHz)} Hz mode — one end alone consumes the ±10 % the ranking is scored over`;
		case "fits-refused":
			return `${c.refused} of ${c.of} ${c.axis} captures were refused — ${refusalReasonText(c)}`;
		case "one-direction-only":
			// Names the direction that WORKED, not the one that failed: the
			// operator's question is "what have I actually measured?".
			return `${c.axis} rests entirely on ${c.dir === "+" ? "plus" : "minus"}-direction moves — the other ${c.refused} were refused, and the ring-down happens at the opposite end of the axis each way, so this describes one end of the travel`;
		case "axes-agree":
			// Names BOTH readings, because the tool genuinely cannot tell them
			// apart yet and picking one would be the invented verdict this layer
			// exists to prevent. The remedy is the measurement that would settle
			// it, not a guess.
			return `X and Y came back ${(c.apartFraction * 100).toFixed(1)} % apart (${c.xHz.toFixed(1)} and ${c.yHz.toFixed(1)} Hz) — two axes of one machine normally ring at clearly different frequencies, so this is either a shared frame mode or a shaper that was active and suppressed both; nothing recorded here says which`;
		case "few-fits":
			return `${c.axis} rests on ${c.n} of ${c.of} captures — a median over that few moves with any one of them`;
		case "predicted-not-measured":
			return `these ${c.n} are arithmetic over the fingerprint, not measurements — verify one on the machine before trusting the order`;
		case "inherited":
			return `from the ${c.from} these were ranked from: ${caveatText(c.caveat)}`;
		default: {
			const unhandled: never = c;
			throw new Error(`unknown caveat: ${String((unhandled as { kind: unknown }).kind)}`);
		}
	}
}
