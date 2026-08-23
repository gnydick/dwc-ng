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
import type { Accelerometer, ObjectModel, Shaping } from "../om/types.ts";
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
	| { readonly kind: "outside-envelope"; readonly point: { readonly x: number; readonly y: number } }
	| { readonly kind: "stale" }
	/** The plan describes no measurable run: a zero-length excitation move, a
	 *  zero feed, no repeats, or no samples. Measured against mock-duet on
	 *  2026-08-22: a capture armed before a ZERO-LENGTH move produces no file
	 *  at all, so a run built from one would sit out its whole capture budget
	 *  and then fail. Refusing before anything moves is the cheaper answer. */
	| { readonly kind: "not-measurable" };

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
	/** The box from config, present by construction: `read` refuses without it. */
	readonly envelope: Envelope;

	private constructor(
		readAt: number,
		position: Point,
		accel: AccelAddr,
		travelAccel: MmPerS2 | null,
		priorShaping: Shaping,
		envelope: Envelope,
	) {
		this.#readAt = readAt;
		this.position = position;
		this.accel = accel;
		this.travelAccel = travelAccel;
		this.priorShaping = priorShaping;
		this.envelope = envelope;
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

		return {
			ok: true,
			pre: new Preconditions(now, { x, y }, accel, travelAcceleration(om), om.move.shaping, envelope),
		};
	}
}

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
 * The accelerometer at this address, or null when that board has none.
 *
 * Exported for the same reason as `planarPosition`: the run loop watches
 * `runs` on the SAME sensor `read` insisted was present, and a second board
 * lookup could pick a different one.
 *
 * The address is `board.device` (or the bare `0` the mainboard answers to), so
 * the board half is what selects the entry in `boards`. Matching on
 * `canAddress` rather than the array index is the point: the index is the
 * order the firmware happens to report boards in, and addressing a capture at
 * the wrong board produces a real-looking file from the wrong sensor.
 */
export function accelerometerOf(om: ObjectModel, accel: AccelAddr): Accelerometer | null {
	const boardAddress = Number(String(accel).split(".")[0]);
	if (!Number.isInteger(boardAddress)) return null;
	const board = om.boards.find((b) => b !== null && (b.canAddress ?? 0) === boardAddress);
	return board?.accelerometer ?? null;
}

/** Parse, don't trust: the declared type says `number | null`, but the live
 *  d99fn patch route never meets `conformModelKey`, so the declaration is a
 *  claim the store does not enforce. Widened back to `unknown` and re-checked,
 *  the same second parse om/speeds.ts makes for the same reason. */
function travelAcceleration(om: ObjectModel): MmPerS2 | null {
	const raw: unknown = om.move.travelAcceleration;
	return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? mmPerS2(raw) : null;
}
