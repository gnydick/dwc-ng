/**
 * The plan a shaping run executes, and the only object that can hold one.
 *
 * A `Plan` is what the operator asked for: a ring, a speed sweep, or a verify
 * pass with a candidate shaper applied. A `Procedure` is what the machine will
 * actually be sent — a fixed list of steps, each carrying the position the
 * carriage must already be at, plus the restore that puts the machine's shaper
 * back the way it was found. Turning the first into the second is the one
 * place every refusal is decided.
 *
 * No position-set command appears here or anywhere under `src/shaping/`: the
 * carriage's whereabouts are read from the object model and the plan is
 * refused when they do not match, never corrected by telling the firmware
 * where it is. Every G-code string comes from a `cmd.*` builder in
 * control/commands.ts; this file formats none of its own.
 */

import type { GcodeCommand } from "@dwc-ng/connector";
import { cmd, type AccelAddr } from "../control/commands.ts";
import type { Envelope, ShapingConfig } from "../config/types.ts";
import type { Shaping } from "../om/types.ts";
import { SHAPER_TYPES, type ShaperSpec, type ShaperType } from "./engine/shapers.ts";
import { hz, mm, seconds, type Mm, type MmPerS } from "./engine/units.ts";
import { Preconditions, type Point, type Refusal } from "./preconditions.ts";

/** A `Preconditions` read longer ago than this is refused as `stale`. One
 *  status poll is 1 s at the connector's slowest cadence; two is the window in
 *  which the model still describes the machine in front of the operator. */
const STALE_MS = 2000;

/** Held still after the positioning move so its own ringing has died before the
 *  capture is armed. Seven time constants of the slowest mode this machine has
 *  shown (18 Hz at zeta 0.127, tau = 70 ms). */
const SETTLE_MS = 500;

/** Held still after the excitation move while the accelerometer records the
 *  ring-down. This is not the completion signal — the run loop waits for the
 *  capture FILE before sending the next step — so a capture longer than this
 *  is still recorded intact; the dwell only keeps the carriage from being the
 *  thing that ends the recording. */
const RINGDOWN_MS = 1500;

/** M956's A parameter: arm at the start of the next move's DECELERATION, which
 *  is the instant the ring-down begins. */
const TRIGGER_ON_DECELERATION = 2;

export type RingPlan = {
	readonly kind: "ring";
	readonly axis: "X" | "Y";
	readonly start: Point;
	readonly distMm: Mm;
	readonly speed: MmPerS;
	readonly repeats: number;
	readonly samples: number;
	readonly namePrefix: string;
};

export type SweepPlan = {
	readonly kind: "sweep";
	readonly start: Point;
	readonly distMm: Mm;
	readonly speeds: readonly MmPerS[];
	readonly samples: number;
	readonly namePrefix: string;
};

export type VerifyPlan = {
	readonly kind: "verify";
	readonly spec: ShaperSpec;
	readonly ring: RingPlan;
};

export type Plan = RingPlan | SweepPlan | VerifyPlan;

/**
 * One indivisible thing to send.
 *
 * `expectPosition` is where the carriage must ALREADY be when the step starts
 * — the run loop compares it against a fresh model read and fails the run on a
 * mismatch. It is not a target and nothing moves the machine to it.
 */
export type Step = {
	readonly codes: readonly GcodeCommand[];
	/** The capture this step produces, if it produces one. */
	readonly expectFile?: string;
	readonly label: string;
	readonly expectPosition: Point;
};

export type PlanResult =
	| { readonly ok: true; readonly proc: Procedure }
	| { readonly ok: false; readonly refusal: Refusal };

/**
 * A planned run: steps, restore, and the reading they were planned from.
 *
 * @invariant shaping-motion-only-via-procedure
 * @rung 7  sole-constructor type — the constructor is `private` and the class
 *          carries a `#`-private field, so neither `new Procedure(...)` nor
 *          `{steps, restore, pre} as Procedure` compiles outside this file;
 *          the `#` name is what makes the class nominal, since every other
 *          member is public and would match structurally. The only static is
 *          `plan`, and `planProcedure` is that same function object under the
 *          name the rest of the codebase calls it — one route, two names, not
 *          two routes. `plan` takes a `Preconditions`, which is itself
 *          obtainable only from a fresh object-model read, so a run cannot
 *          exist that was not gated on idle, homed, sensor-present and
 *          inside-the-box. The universal `x as unknown as T` escape is not
 *          counted against this rung
 * @why this is the feature's whole safety story. The lab sends 200 mm/s moves
 *      with nobody watching the axis, and the difference between a capture and
 *      a crash into the frame is whether those four facts were true at the
 *      moment of planning. A second way to build a run is a second place to
 *      forget one of them
 */
export class Procedure {
	/** When `plan` built this. Private so the class is nominal; the accessor is
	 *  the one reader, and the value is what makes `restore` datable to plan
	 *  time rather than to run time. */
	readonly #plannedAt: number;

	readonly steps: readonly Step[];
	/**
	 * The commands that put the shaper back as it was found.
	 *
	 * @invariant restore-is-structural
	 * @rung 7  sole-constructor type — this is a `readonly` field of a class
	 *          whose only constructor is private and whose only producer is
	 *          `plan`, which always computes it from `pre.priorShaping`. There
	 *          is no setter, no optional argument and no code path that yields
	 *          a Procedure with an empty or absent restore, so "was a restore
	 *          computed?" is not a question a run can be in the wrong answer
	 *          to. What the field holds is fixed at plan time: recomputing it
	 *          later is not a thing the type offers
	 * @why the machine's prior shaper is knowable only BEFORE the run changes
	 *      it. A restore derived from live state after a verify pass would
	 *      faithfully re-apply the candidate under test and leave the operator
	 *      believing the machine was back to baseline — a wrong belief about a
	 *      setting that changes every subsequent print
	 */
	readonly restore: readonly GcodeCommand[];
	/** The reading this was planned from — the run loop re-checks positions
	 *  against it rather than against anything it reads for itself. */
	readonly pre: Preconditions;

	private constructor(plannedAt: number, steps: readonly Step[], restore: readonly GcodeCommand[], pre: Preconditions) {
		this.#plannedAt = plannedAt;
		this.steps = steps;
		this.restore = restore;
		this.pre = pre;
	}

	get plannedAt(): number {
		return this.#plannedAt;
	}

	/**
	 * The sole producer. Exported below as `planProcedure`; it is a static
	 * because TypeScript's `private` constructor is reachable only from inside
	 * the class body, and a module-level function would have to be handed a
	 * seam to bypass.
	 */
	static plan(plan: Plan, pre: Preconditions, cfg: ShapingConfig, now: number): PlanResult {
		if (now - pre.readAt > STALE_MS) return { ok: false, refusal: { kind: "stale" } };

		// The box the reading was taken against must still be the box in
		// config. A user who redrew the envelope between the read and the plan
		// has invalidated the reading, and "stale" is exactly what that is.
		if (cfg.envelope === null) return { ok: false, refusal: { kind: "no-envelope" } };
		if (!sameEnvelope(cfg.envelope, pre.envelope)) return { ok: false, refusal: { kind: "stale" } };

		// The carriage's current position leads the list: the first step's
		// opening move starts from there, and the envelope is a rectangle, so
		// a segment with both ends inside it never leaves it.
		for (const point of [pre.position, ...visitedPoints(plan)]) {
			if (!inside(point, pre.envelope)) {
				return { ok: false, refusal: { kind: "outside-envelope", point: { x: point.x, y: point.y } } };
			}
		}

		return { ok: true, proc: new Procedure(now, stepsFor(plan, pre), restoreFor(pre.priorShaping), pre) };
	}
}

/**
 * The sole producer of a `Procedure`, under the name the plan and the cards
 * use. Identical to `Procedure.plan` — the same function object, not a wrapper
 * that could drift from it.
 */
export const planProcedure = Procedure.plan;

// --- geometry ---------------------------------------------------------------

const inside = (p: Point, e: Envelope): boolean =>
	p.x >= e.x[0] && p.x <= e.x[1] && p.y >= e.y[0] && p.y <= e.y[1];

const sameEnvelope = (a: Envelope, b: Envelope): boolean =>
	a.x[0] === b.x[0] && a.x[1] === b.x[1] && a.y[0] === b.y[0] && a.y[1] === b.y[1];

/** `from`, displaced along one axis. The other coordinate is carried through
 *  unchanged, which is what keeps every commanded move axis-aligned. */
const along = (from: Point, axis: "X" | "Y", dist: Mm): Point =>
	axis === "X" ? { x: mm(from.x + dist), y: from.y } : { x: from.x, y: mm(from.y + dist) };

/**
 * Every point the machine will be commanded to. Moves between them are
 * straight lines and the envelope is convex, so containing these contains the
 * whole path.
 */
function visitedPoints(plan: Plan): readonly Point[] {
	switch (plan.kind) {
		case "ring":
			return [plan.start, along(plan.start, plan.axis, plan.distMm)];
		case "sweep":
			// A sweep exercises both axes from a shared origin, so its extent is
			// the two corners of an L, never the diagonal one.
			return [plan.start, along(plan.start, "X", plan.distMm), along(plan.start, "Y", plan.distMm)];
		case "verify":
			return visitedPoints(plan.ring);
		default: {
			const unhandled: never = plan;
			throw new Error(`unknown plan kind: ${String((unhandled as { kind: unknown }).kind)}`);
		}
	}
}

// --- steps ------------------------------------------------------------------

/** RRF's F is always mm/min; the lab thinks in mm/s, as accelerometer work
 *  does. One conversion, here. */
const feedOf = (speed: MmPerS): number => speed * 60;

/** `<prefix>_Xp0.csv` — axis, direction, repeat. One producer, so the name the
 *  procedure waits for and the name M956 writes cannot be spelled apart. */
const captureName = (prefix: string, axis: "X" | "Y", dir: "p" | "m", index: number): string =>
	`${prefix}_${axis}${dir}${index}.csv`;

const xy = (p: Point): ReadonlyArray<{ axis: "X" | "Y"; mm: Mm }> => [
	{ axis: "X", mm: p.x },
	{ axis: "Y", mm: p.y },
];

/**
 * One capture: position, settle, arm, excite, settle.
 *
 * The order is the contract — the arm has to be queued before the move that
 * triggers it, and the wait has to be between the positioning move and the
 * arm, or the capture records the wrong ring. Both moves run at the plan's
 * speed; there is no separate travel feed to be a second number that means
 * "how fast the lab moves".
 */
function captureStep(args: {
	at: Point;
	from: Point;
	to: Point;
	speed: MmPerS;
	addr: AccelAddr;
	samples: number;
	file: string;
	label: string;
}): Step {
	const feed = feedOf(args.speed);
	return {
		codes: [
			cmd.absolute(),
			cmd.moveTo(xy(args.from), feed),
			cmd.waitMoves(),
			cmd.dwell(SETTLE_MS),
			cmd.accelCapture(args.addr, args.samples, TRIGGER_ON_DECELERATION, args.file),
			cmd.moveTo(xy(args.to), feed),
			cmd.waitMoves(),
			cmd.dwell(RINGDOWN_MS),
		],
		expectFile: args.file,
		label: args.label,
		expectPosition: args.at,
	};
}

function ringSteps(plan: RingPlan, pre: Preconditions, origin: Point): Step[] {
	const far = along(plan.start, plan.axis, plan.distMm);
	const steps: Step[] = [];
	let at = origin;
	for (let i = 0; i < plan.repeats; i++) {
		// Out then back: the return leg is a capture in its own right AND is
		// what puts the carriage where the next repeat starts, so the run never
		// contains a move that is not being measured.
		for (const dir of ["p", "m"] as const) {
			const from = dir === "p" ? plan.start : far;
			const to = dir === "p" ? far : plan.start;
			steps.push(captureStep({
				at,
				from,
				to,
				speed: plan.speed,
				addr: pre.accel,
				samples: plan.samples,
				file: captureName(plan.namePrefix, plan.axis, dir, i),
				label: `${plan.axis}${dir === "p" ? "+" : "-"} ${plan.speed} mm/s (${i + 1}/${plan.repeats})`,
			}));
			at = to;
		}
	}
	return steps;
}

function sweepSteps(plan: SweepPlan, pre: Preconditions): Step[] {
	const steps: Step[] = [];
	let at = pre.position;
	plan.speeds.forEach((speed, i) => {
		for (const axis of ["X", "Y"] as const) {
			const to = along(plan.start, axis, plan.distMm);
			steps.push(captureStep({
				at,
				from: plan.start,
				to,
				speed,
				addr: pre.accel,
				samples: plan.samples,
				file: captureName(plan.namePrefix, axis, "p", i),
				label: `${axis}+ ${speed} mm/s`,
			}));
			at = to;
		}
	});
	return steps;
}

function stepsFor(plan: Plan, pre: Preconditions): readonly Step[] {
	switch (plan.kind) {
		case "ring":
			return ringSteps(plan, pre, pre.position);
		case "sweep":
			return sweepSteps(plan, pre);
		case "verify":
			return [
				{
					codes: [cmd.inputShaping(plan.spec)],
					label: `shaper ${plan.spec.type}`,
					expectPosition: pre.position,
				},
				...ringSteps(plan.ring, pre, pre.position),
			];
		default: {
			const unhandled: never = plan;
			throw new Error(`unknown plan kind: ${String((unhandled as { kind: unknown }).kind)}`);
		}
	}
}

// --- restore ----------------------------------------------------------------

/**
 * The commands that put the shaper back to what the object model reported
 * before the run.
 *
 * Three cases, in order of fidelity. A shaper this build knows by name is
 * restored by name, so the board's own F/S round-trip exactly. Anything else —
 * `custom`, or a name from a firmware newer than this UI — is restored from
 * the impulse train the board itself reported, which reproduces it whatever it
 * was called. Only a shaper that reports no usable train falls back to
 * switching shaping off, because there is nothing to put back and leaving the
 * lab's own shaper in place would be worse than a clean disable.
 */
function restoreFor(prior: Shaping): readonly GcodeCommand[] {
	if (prior.type === "none") return [cmd.shapingOff()];
	if (isNamedShaper(prior.type) && Number.isFinite(prior.frequency) && prior.frequency > 0 && Number.isFinite(prior.damping)) {
		return [cmd.inputShaping({ type: prior.type, F: hz(prior.frequency), S: prior.damping })];
	}
	return [customFrom(prior) ?? cmd.shapingOff()];
}

const isNamedShaper = (type: string): type is ShaperType => (SHAPER_TYPES as readonly string[]).includes(type);

/**
 * Rebuild M593's custom form from the train the board reported.
 *
 * The object model carries every impulse: `amplitudes` sums to 1 and `delays`
 * starts at 0. M593's H and T are the complements of exactly those two facts —
 * H omits the last amplitude (the firmware derives it) and T omits the first
 * delay (it is zero) — so the spec is the reported train with one entry
 * dropped off each end, and `cmd.inputShaping` re-derives what it dropped.
 * A train that does not satisfy the builder's own rules yields null rather
 * than a half-formed command.
 */
function customFrom(prior: Shaping): GcodeCommand | null {
	const n = prior.amplitudes.length;
	if (n < 2 || prior.delays.length !== n) return null;
	if (!prior.amplitudes.every(Number.isFinite) || !prior.delays.every(Number.isFinite)) return null;
	try {
		return cmd.inputShaping({
			type: "custom",
			H: prior.amplitudes.slice(0, -1),
			T: prior.delays.slice(1).map(seconds),
		});
	} catch {
		return null;
	}
}
