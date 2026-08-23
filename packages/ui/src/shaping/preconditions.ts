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
	| { readonly kind: "stale" };

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
	 * Read out of the open half of the model because the lean `Move` interface
	 * (om/types.ts) does not declare the field. Adding it there — interface,
	 * `emptyModel`, `conformModelKey` arm and an `om-conform` case — is the
	 * tidier home for it and belongs to whoever next touches that file.
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

		if (!hasAccelerometer(om, accel)) {
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
 * All three collapse to one answer deliberately. "Homed but no position" is
 * not a state a G1 target can be computed against, and its remedy is the same
 * as an unhomed axis: home it. Splitting them would add a refusal an operator
 * could do nothing different about.
 */
function planarPosition(om: ObjectModel, letter: "X" | "Y"): Mm | null {
	const axis = om.move.axes.find((a) => a.letter === letter);
	if (axis === undefined || !axis.homed) return null;
	const p = axis.userPosition;
	return typeof p === "number" && Number.isFinite(p) ? mm(p) : null;
}

/**
 * Does the board named by this address actually carry an accelerometer?
 *
 * The address is `board.device` (or the bare `0` the mainboard answers to), so
 * the board half is what selects the entry in `boards`. Matching on
 * `canAddress` rather than the array index is the point: the index is the
 * order the firmware happens to report boards in, and addressing a capture at
 * the wrong board produces a real-looking file from the wrong sensor.
 */
function hasAccelerometer(om: ObjectModel, accel: AccelAddr): boolean {
	const boardAddress = Number(String(accel).split(".")[0]);
	if (!Number.isInteger(boardAddress)) return false;
	return om.boards.some((b) => b !== null && (b.canAddress ?? 0) === boardAddress && Boolean(b.accelerometer));
}

/** Parse, don't trust: the field is not in the lean `Move` interface, so it
 *  arrives as `unknown` and leaves as a unit or as null. */
function travelAcceleration(om: ObjectModel): MmPerS2 | null {
	const raw = (om.move as unknown as Record<string, unknown>).travelAcceleration;
	return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? mmPerS2(raw) : null;
}
