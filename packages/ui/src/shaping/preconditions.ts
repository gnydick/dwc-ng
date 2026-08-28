/**
 * Everything the Shaping Lab must be true about the machine BEFORE it plans a
 * move, read once, as data.
 *
 * The lab drives the carriage the full length of a user-declared box at
 * printing speeds with nobody's hand on the jog wheel. Every reason it might
 * decline is decided here, up front, and returned as a `Refusal` — a value the
 * cards render as a disabled button with a sentence. Nothing downstream asks
 * the machine a second question, so there is no window between "we checked"
 * and "we moved" that a card could widen by forgetting a check.
 *
 * Position and homed state are READ from the object model. This feature never
 * asserts a position onto the machine: no position-set command appears
 * anywhere under `src/shaping/`, which the motion-fence test pins.
 */

import type { AccelAddr } from "../control/commands.ts";
import type { Envelope, ShapingConfig } from "../config/types.ts";
import type { ObjectModel, Shaping } from "../om/types.ts";
// The one definition lives in its own module so the EAGER Settings card can
// reach it without dragging this file onto the critical path (#126). Re-
// exported here because `read` below is its main caller and the run loop
// reads it as part of this module's surface.
import { accelerometerOf } from "./accelPresence.ts";
import { mm, mmPerS2, type Mm, type MmPerS2 } from "./engine/units.ts";

/**
 * Why the lab will not move the machine.
 *
 * A closed union, so the copy table that renders these (shaping/copy.ts) is
 * exhaustive by compilation rather than by someone remembering to extend it.
 * Each variant carries the fact the operator needs in order to fix it: WHICH
 * status, WHICH axes, WHICH address, WHICH point.
 */
export type Refusal =
	| { readonly kind: "not-idle"; readonly status: string }
	| { readonly kind: "not-homed"; readonly axes: string }
	| { readonly kind: "no-accelerometer"; readonly addr: string }
	| { readonly kind: "no-envelope" }
	/** The carriage is PARKED outside the box. `point` is where the head IS —
	 *  read from the object model, not planned — and the remedy is to move the
	 *  machine. Distinct from `plan-leaves-envelope` because the two facts have
	 *  nothing in common but the rectangle test: one is answered by jogging the
	 *  head in, the other by shortening the move or redrawing the box. Reported
	 *  by Gabe on a deployed build, 2026-08-24: parked by hand at X-26.7 Y207.1,
	 *  he was told the "test would leave the envelope" when nothing was going to
	 *  leave anywhere and no plan existed yet (#49). */
	| { readonly kind: "head-outside-envelope"; readonly point: { readonly x: number; readonly y: number } }
	/** A point the PLAN would visit is outside the box. `point` is the offending
	 *  planned coordinate — a corner the machine has not been to. */
	| { readonly kind: "plan-leaves-envelope"; readonly point: { readonly x: number; readonly y: number } }
	| { readonly kind: "stale" }
	/** The plan describes no measurable run: a zero-length excitation move, a
	 *  zero feed, or no repeats. Measured against mock-duet on 2026-08-22: a
	 *  capture armed before a ZERO-LENGTH move produces no file at all, so a run
	 *  built from one would sit out its whole capture budget and then fail.
	 *  Refusing before anything moves is the cheaper answer. */
	| { readonly kind: "not-measurable" }
	/** `move.travelAcceleration` is absent from the object model, so how long
	 *  the excitation move takes cannot be computed — and how long the capture
	 *  must record is a function of exactly that. Refused rather than assumed:
	 *  an invented acceleration makes the recording confidently the wrong
	 *  length, which is the failure GIT_63 exists to remove. */
	| { readonly kind: "no-acceleration" }
	/** The board never answered `M955 P<addr>` with a sampling rate, so
	 *  `samples / rate` — the whole length of the recording — is unknown. */
	| { readonly kind: "no-sample-rate" }
	/** A pass needs more accelerometer samples than one M956 can ask for. The
	 *  cause is always a slow move over a long distance: recording time is
	 *  distance ÷ speed, so halving the speed doubles the file. */
	| { readonly kind: "capture-too-long"; readonly samples: number; readonly max: number }
	/** The object model did not report which head is on the carriage as a whole
	 *  number. Refused rather than assumed, because both halves of #51 are
	 *  built on that number: what the run must pick up, and what it must put
	 *  back. A guess would make a run that changes tools unable to undo itself,
	 *  and a fingerprint filed against a head nobody can name. */
	| { readonly kind: "tool-unknown" }
	/** The run is for a tool this machine does not have. RRF answers `T9` on a
	 *  four-head machine by running `tfree` for the OLD tool and then selecting
	 *  nothing (reference/duet-gcode.md, T: "Selecting a non-existent tool just
	 *  does Steps 1-2"), so the machine ends up holding no tool at all and the
	 *  run records a bare carriage under the name of a head. */
	| { readonly kind: "no-such-tool"; readonly tool: number };

/** An XY point in the user coordinates G90 + G1 speak. */
export type Point = { readonly x: Mm; readonly y: Mm };

export type ReadResult =
	| { readonly ok: true; readonly pre: Preconditions }
	| { readonly ok: false; readonly refusal: Refusal };

/**
 * A snapshot of the machine that a `Procedure` may be planned from.
 *
 * @invariant preconditions-are-a-fresh-read
 * @rung 7  sole-constructor type — the constructor is `private` and the class
 *          carries a `#`-private field, so `new Preconditions(...)` is a
 *          compile error outside this file AND an object literal is not
 *          assignable to the type (a `#` name makes the class nominal, which a
 *          `private constructor` alone would not — the fields are all public
 *          and would otherwise match structurally). `read` is the only static,
 *          so holding one of these IS the proof that an object model was
 *          examined and found idle, homed, accelerometer-bearing and
 *          envelope-bearing. The one universal escape, `x as unknown as
 *          Preconditions`, is not counted against this rung
 * @why the checks and the move must not be separable. A card that could
 *      assemble its own guard object would be free to omit the homed test,
 *      and an unhomed axis under a 200 mm/s G1 is a crash into the frame at
 *      full current — the failure this whole feature is built around
 */
export class Preconditions {
	/** The clock reading of the model this was built from. Private so that the
	 *  class is nominal; exposed read-only through `readAt`. */
	readonly #readAt: number;

	readonly position: Point;
	readonly accel: AccelAddr;
	/**
	 * `move.travelAcceleration` as the board reported it, or null when it did
	 * not. Null rather than a fallback: a shaping run reasons about how much of
	 * its move is spent at constant velocity, and an invented acceleration
	 * would make that arithmetic confident and wrong.
	 *
	 * The lean `Move` interface declares it nullable for exactly this reason
	 * (om/types.ts, citing reference/objectmodel/src/move/index.ts:55), so this
	 * is a straight read — but it is still PARSED, because the live d99fn patch
	 * route does not pass through `conformModelKey` and the declared type is
	 * therefore a claim the store does not enforce. Same second parse, and the
	 * same reason, as om/speeds.ts.
	 */
	readonly travelAccel: MmPerS2 | null;
	/** `move.shaping` at read time — what `restore` must put back. */
	readonly priorShaping: Shaping;
	/**
	 * `state.currentTool` at read time: the head ON THE CARRIAGE, `-1` for
	 * none. An integer by construction — `read` refuses `tool-unknown`
	 * otherwise — so the two things #51 needs it for are never a guess: the
	 * change the run must make, and the change it must undo.
	 */
	readonly mountedTool: number;
	/**
	 * The tool numbers this machine reports, from `tools[].number` rather than
	 * from the array index. M563 lets a configuration define tools 17, 29 and
	 * 48 (reference/duet-gcode.md, T), so the index is not the number and a
	 * run planned against the index would send a `T` for a head that is not
	 * there.
	 */
	readonly toolNumbers: readonly number[];
	/** The box from config, present by construction: `read` refuses without it. */
	readonly envelope: Envelope;

	private constructor(
		readAt: number,
		position: Point,
		accel: AccelAddr,
		travelAccel: MmPerS2 | null,
		priorShaping: Shaping,
		envelope: Envelope,
		mountedTool: number,
		toolNumbers: readonly number[],
	) {
		this.#readAt = readAt;
		this.position = position;
		this.accel = accel;
		this.travelAccel = travelAccel;
		this.priorShaping = priorShaping;
		this.envelope = envelope;
		this.mountedTool = mountedTool;
		this.toolNumbers = toolNumbers;
	}

	/** When this was read, in the caller's clock. `planProcedure` refuses one
	 *  older than a poll cycle. */
	get readAt(): number {
		return this.#readAt;
	}

	/**
	 * The sole producer. Order of refusals is the order an operator can act on
	 * them: stop the machine, home it, wire the sensor, draw the box.
	 */
	static read(om: ObjectModel, cfg: ShapingConfig, accel: AccelAddr, now: number): ReadResult {
		const status = om.state.status;
		if (status !== "idle") return { ok: false, refusal: { kind: "not-idle", status } };

		// FIRST among the machine facts, because it is the one the whole of #51
		// hangs on and it costs nothing: a run that cannot say which head is on
		// the carriage can neither attribute what it measures nor undo the
		// change it is about to make.
		const mountedTool = mountedToolOf(om);
		if (mountedTool === null) return { ok: false, refusal: { kind: "tool-unknown" } };

		// One read per axis, and the SAME read decides both the refusal and the
		// planned-from position — there is no second lookup that could disagree
		// with the one that passed the test.
		const x = planarPosition(om, "X");
		const y = planarPosition(om, "Y");
		if (x === null || y === null) {
			const axes = `${x === null ? "X" : ""}${y === null ? "Y" : ""}`;
			return { ok: false, refusal: { kind: "not-homed", axes } };
		}

		if (accelerometerOf(om, accel) === null) {
			return { ok: false, refusal: { kind: "no-accelerometer", addr: String(accel) } };
		}

		const envelope = cfg.envelope;
		if (envelope === null) return { ok: false, refusal: { kind: "no-envelope" } };

		// The carriage's own whereabouts, LAST, because it is the one refusal an
		// operator fixes by moving the machine rather than by changing a setting.
		//
		// It lives here rather than in `planProcedure` — which is where it used to
		// be — so that holding a `Preconditions` IS the proof the carriage is in
		// the box. Every run starts by moving FROM wherever the head is parked, so
		// a head outside the box cannot be the start of any plan; deciding that at
		// plan time meant the screen's shared gate (compose/services.ts, a bare
		// `read`) could not see it, and the Capture card offered an enabled Run
		// button that refused the moment it was confirmed. Observed against
		// mock-duet, 2026-08-23: parked at X180 Y150.5 with the box redrawn to
		// 200-300, the button was live and the refusal arrived only on confirm.
		if (!inside({ x, y }, envelope)) {
			return { ok: false, refusal: { kind: "head-outside-envelope", point: { x, y } } };
		}

		return {
			ok: true,
			pre: new Preconditions(
				now, { x, y }, accel, travelAcceleration(om), om.move.shaping, envelope, mountedTool, toolNumbersOf(om),
			),
		};
	}
}

/**
 * Is this point in the box?
 *
 * Exported because `planProcedure` asks the same question of the points a PLAN
 * visits, and one rectangle test is one answer. Half-open would be a different
 * box; inclusive is what the operator drew.
 */
export const inside = (p: { readonly x: number; readonly y: number }, e: Envelope): boolean =>
	p.x >= e.x[0] && p.x <= e.x[1] && p.y >= e.y[0] && p.y <= e.y[1];

/**
 * The user position of a planar axis, or null when there is no move to plan
 * from — the axis is missing, not homed, or reports no position.
 *
 * Exported because `Procedure.run` re-checks the carriage against every step's
 * expected position and MUST agree with what `read` accepted. Two spellings of
 * "where is X" would let a run start from a position the plan would have
 * refused.
 *
 * All three collapse to one answer deliberately. "Homed but no position" is
 * not a state a G1 target can be computed against, and its remedy is the same
 * as an unhomed axis: home it. Splitting them would add a refusal an operator
 * could do nothing different about.
 */
export function planarPosition(om: ObjectModel, letter: "X" | "Y"): Mm | null {
	const axis = om.move.axes.find((a) => a.letter === letter);
	if (axis === undefined || !axis.homed) return null;
	const p = axis.userPosition;
	return typeof p === "number" && Number.isFinite(p) ? mm(p) : null;
}

/**
 * Parse, don't trust: the declared type says `number | null`, but the live
 * d99fn patch route never meets `conformModelKey`, so the declaration is a
 * claim the store does not enforce. Widened back to `unknown` and re-checked,
 * the same second parse om/speeds.ts makes for the same reason.
 *
 * Exported because the Capture card states how long each pass will record
 * before anything is armed, and that arithmetic needs the same acceleration the
 * run will be planned against. One reading of `move.travelAcceleration`, so the
 * figure on the screen and the figure in the M956 cannot come from two
 * different ideas of what the board reported.
 */
export function travelAcceleration(om: ObjectModel): MmPerS2 | null {
	const raw: unknown = om.move.travelAcceleration;
	return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? mmPerS2(raw) : null;
}

/**
 * Which head is on the carriage, or null when the machine did not say.
 *
 * Parse, don't trust — the same second parse `travelAcceleration` makes and for
 * the same reason: the live d99fn patch route never meets `conformModelKey`, so
 * the declared `currentTool: number` is a claim the store does not enforce.
 * `-1` is RRF's own spelling of "no tool" and is a perfectly good answer here;
 * a string, a NaN or a fraction is not, and there is no safe stand-in for it.
 */
function mountedToolOf(om: ObjectModel): number | null {
	const raw: unknown = om.state.currentTool;
	return typeof raw === "number" && Number.isInteger(raw) ? raw : null;
}

/** The tool numbers the machine reports, from each tool's own `number`. */
function toolNumbersOf(om: ObjectModel): readonly number[] {
	const out: number[] = [];
	for (const tool of om.tools) {
		const n: unknown = tool?.number;
		if (typeof n === "number" && Number.isInteger(n) && n >= 0) out.push(n);
	}
	return out;
}

// Declared, never exported, no runtime value: the brand lives in the type
// system, which is where the guarantee is needed.
declare const runPriorBrand: unique symbol;

/**
 * What the machine was holding when the RUN opened, and the head the run is
 * for — the one value every leg of that run restores to.
 *
 * @invariant a-runs-prior-state-is-minted-once-from-its-opening-reading
 * @rung 6  choke-point — `RunPrior` carries `runPriorBrand`, a `unique symbol`
 *          declared here and never exported, so the type cannot be written as
 *          an object literal anywhere else and `runPriorOf` is the only
 *          expression in the program that produces one. `Procedure.plan`
 *          requires one, and a mid-run `Preconditions` is no longer a
 *          well-typed thing to pass it: before this, `runPrior` was a bare
 *          `Shaping`, so leg 2's fresh reading compiled perfectly in the slot
 *          that must hold leg 1's. What is NOT enforced is arity — nothing
 *          stops a caller minting a second one inside the loop — so the
 *          remaining discipline is that `runMotion` calls this once, above its
 *          loop, from a reading taken before any code went out
 * @why every leg re-reads the machine to be AUTHORISED, and the run's own codes
 *      have been changing what those readings say. On the shaper this was
 *      already a live bug (runner.ts): leg 1 states `none`, the poll catches
 *      up, leg 2 reads `none` back as the thing to restore, and the operator's
 *      shaper is silently gone. The mounted tool has exactly the same shape and
 *      a worse ending — leg 2 would read the tool leg 1 PICKED UP as the tool
 *      to put back, so the machine would be left holding the measured head and
 *      the restore would report success
 * @debt arity is convention, not construction: `runPriorOf` can be called
 *       twice. Promote by making the run itself the producer — a run handle
 *       minted from the opening reading that hands out procedures — so a second
 *       prior has no expression rather than merely no call site
 */
export type RunPrior = {
	/** `move.shaping` before the run sent anything. */
	readonly shaping: Shaping;
	/** The head on the carriage before the run sent anything; `-1` for none. */
	readonly mountedTool: number;
	/** The head this run is FOR — what it must pick up and what its captures
	 *  are filed against. */
	readonly tool: number;
	readonly [runPriorBrand]: true;
};

/**
 * The only expression in the program that produces a `RunPrior`.
 *
 * Takes a `Preconditions` rather than loose fields, so the state it records is
 * a reading that passed every refusal rather than a bag a caller assembled.
 */
export function runPriorOf(pre: Preconditions, tool: number): RunPrior {
	return { shaping: pre.priorShaping, mountedTool: pre.mountedTool, tool } as RunPrior;
}
