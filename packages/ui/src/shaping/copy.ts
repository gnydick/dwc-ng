/**
 * The words a `Refusal` is shown in.
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
import type { Fingerprint } from "./engine/fit.ts";
import type { Refusal } from "./preconditions.ts";

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
			// No payload to name the offending field with, so it names all four
			// and the condition they share. The Capture card renders this beside
			// the very inputs it is talking about.
			return "nothing to measure — distance, speed, repeats and samples must all be above zero";
		default: {
			const unhandled: never = r;
			throw new Error(`unknown refusal: ${String((unhandled as { kind: unknown }).kind)}`);
		}
	}
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
