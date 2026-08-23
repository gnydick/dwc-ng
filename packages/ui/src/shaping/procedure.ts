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

import type { ConnectorReads, ConnectorWrites, GcodeCommand } from "@dwc-ng/connector";
import { cmd, type AccelAddr } from "../control/commands.ts";
import type { Envelope, ShapingConfig } from "../config/types.ts";
import type { ObjectModel, Shaping } from "../om/types.ts";
import { SHAPER_TYPES, type ShaperSpec, type ShaperType } from "./engine/shapers.ts";
import { hz, mm, seconds, type Mm, type MmPerS } from "./engine/units.ts";
import { accelerometerOf, planarPosition, Preconditions, type Point, type Refusal } from "./preconditions.ts";

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

/** Where RRF puts an M956 capture: the F parameter is a bare file name and the
 *  firmware chooses the directory (reference/duet-gcode.md, M956). Exported so
 *  the card that offers "import an existing capture" reads the same place the
 *  run writes to, rather than spelling the path a second time. */
export const CAPTURE_DIR = "0:/sys/accelerometer";

/** How far the carriage may be from where a step expects it. Tight enough that
 *  a skipped step or a nudge shows up, loose enough to survive the rounding
 *  between what G1 asked for and what the model reports back. */
const POSITION_TOLERANCE_MM = 0.05;

/** Capture retrieval: how often to look, and for how long. The budget covers a
 *  long move plus the board's own write; past it the capture is not coming. */
const CAPTURE_POLL_MS = 250;
const CAPTURE_BUDGET_MS = 10_000;

/**
 * Out and back. A ring's return leg is a capture in its own right AND is what
 * puts the carriage where the next repeat starts, so a repeat is two captures
 * and there is no unmeasured move inside a run.
 */
const RING_DIRECTIONS = ["p", "m"] as const;

/**
 * The planar axes a fingerprint is built from. A measure run is one ring plan
 * per axis; a sweep exercises both from a shared origin.
 */
export const PLANAR_AXES = ["X", "Y"] as const;

/**
 * How many captures a measure run produces, at the configured repeats.
 *
 * Exported because the status card promises the number in its primary action
 * ("Measure T0 — 12 captures") and the Capture card states the same run in
 * words. One producer for all three, so the count an operator consents to and
 * the number of capture steps `plan` builds cannot be two arithmetics that
 * drift — the whole point of the button naming a figure is that it is the real
 * one.
 */
export function measureCaptureCount(repeats: number): number {
	return repeats * RING_DIRECTIONS.length * PLANAR_AXES.length;
}

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
type Step = {
	readonly codes: readonly GcodeCommand[];
	/** The capture this step produces, if it produces one. */
	readonly expectFile?: string;
	readonly label: string;
	readonly expectPosition: Point;
};

/**
 * A step as the CARDS see it: what it is called and what it will leave behind,
 * and deliberately not the commands that do it.
 *
 * This is the whole of the projection, because it is the whole of what the
 * screen needs. The progress strip names steps and counts them; the capture
 * card draws its map from `plannedSegments(plan)` — from the PLAN, which the
 * card built and already holds — so positions are not needed here, and the
 * G-code is behind `preview` as plain strings that no `sendCode` will accept.
 */
export type StepView = {
	readonly label: string;
	/** The capture this step will produce, when it produces one. */
	readonly expectFile?: string;
};

/**
 * What a run tells its watcher.
 *
 * `restored` is the last thing a run that was followed to the end emits. A run
 * the consumer abandons stops wherever it was and the restore still goes out —
 * it just has nobody left to tell.
 *
 * `done` and `failed` are not exclusive: a run can finish every step and THEN
 * fail to put the shaper back. Those are two separate facts about the machine
 * and are reported as two events rather than collapsed into one verdict.
 */
export type ProcEvent =
	| { readonly kind: "step"; readonly index: number; readonly label: string }
	| { readonly kind: "capture"; readonly file: string; readonly csv: string }
	| { readonly kind: "restored" }
	| { readonly kind: "done" }
	| { readonly kind: "failed"; readonly error: string };

/**
 * Everything a run needs from a connector and nothing else — a slice of the
 * real interfaces rather than a shape of its own, so the app hands `run` its
 * connector directly and there is no adapter in between to drift.
 */
export type RunConnector = Pick<ConnectorReads, "list" | "download"> & Pick<ConnectorWrites, "sendCode">;

/**
 * Seams, all optional. `sleep`/`now` exist so the capture budget can be
 * exercised in a test without the suite sleeping for ten seconds; `signal` is
 * for the operator's Cancel, which has to interrupt a poll rather than wait
 * one out. None of them can skip the restore.
 */
export type RunOptions = {
	readonly signal?: AbortSignal;
	readonly sleep?: (ms: number) => Promise<void>;
	readonly now?: () => number;
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
 *          inside-the-box. The commands themselves live in `#steps` and
 *          `#restore`, whose names are unwritable outside this file, so no
 *          caller anywhere can obtain a `GcodeCommand` belonging to a
 *          procedure — the cards get `steps`, a projection carrying labels and
 *          capture names, and `preview`, plain `string`s that `sendCode` does
 *          not accept. `run` is therefore the only route from a plan to the
 *          machine, and the only two things it sends are those two private
 *          fields, both built by `plan`: no corrective move, no re-plan, no
 *          second command source, so what reaches the machine is exactly what
 *          the refusals were evaluated against. The universal
 *          `x as unknown as T` escape is not counted against this rung
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

	/**
	 * The steps, and the commands inside them. `#`-private, and that is the
	 * mechanism rather than a style choice: these are already-branded
	 * `GcodeCommand`s, so anything that could read them could send them, and
	 * sending them outside `run` would skip the restore. Outside this file the
	 * name cannot even be written. What the cards get instead is `steps`, a
	 * projection with no codes in it.
	 */
	readonly #steps: readonly Step[];

	/**
	 * The commands that put the shaper back as it was found.
	 *
	 * @invariant restore-is-structural
	 * @rung 7  sole-constructor type — this is a `#`-private field of a class
	 *          whose only constructor is private and whose only producer is
	 *          `plan`, which always computes it from `pre.priorShaping`. There
	 *          is no setter, no optional argument and no code path that yields
	 *          a Procedure with an empty or absent restore, so "was a restore
	 *          computed?" is not a question a run can be in the wrong answer
	 *          to. What the field holds is fixed at plan time: recomputing it
	 *          later is not a thing the type offers. `run` sends it from a
	 *          `finally`, and sends it BEFORE yielding `restored`, so the
	 *          three ways a run can end early — a thrown send, a refused
	 *          position check, and a consumer that abandons the generator with
	 *          `break` or `.return()` — all put the shaper back; the last of
	 *          those works because the awaits complete before execution
	 *          suspends at that yield, whether or not anyone is still reading.
	 *          Nothing outside this file can reach these commands to send them
	 *          itself and skip the `finally`: `preview` renders them as plain
	 *          strings for display and `sendCode` will not take one
	 * @why the machine's prior shaper is knowable only BEFORE the run changes
	 *      it. A restore derived from live state after a verify pass would
	 *      faithfully re-apply the candidate under test and leave the operator
	 *      believing the machine was back to baseline — a wrong belief about a
	 *      setting that changes every subsequent print
	 */
	readonly #restore: readonly GcodeCommand[];

	/** The reading this was planned from — the run loop re-checks positions
	 *  against it rather than against anything it reads for itself. Carries no
	 *  commands, so it is handed out whole. */
	readonly pre: Preconditions;

	// Both projections are built ONCE, here, and handed out as the same frozen
	// arrays every time. Not an optimisation: a getter that allocated per read
	// would hand a Solid <For> a new array on every render and rebuild the
	// progress strip's rows on each poll. A procedure is immutable, so a value
	// derived at construction cannot drift from what it was derived from.
	readonly #stepViews: readonly StepView[];
	readonly #preview: readonly string[];

	private constructor(plannedAt: number, steps: readonly Step[], restore: readonly GcodeCommand[], pre: Preconditions) {
		this.#plannedAt = plannedAt;
		this.#steps = steps;
		this.#restore = restore;
		this.pre = pre;
		this.#stepViews = Object.freeze(steps.map((s) =>
			Object.freeze(s.expectFile === undefined ? { label: s.label } : { label: s.label, expectFile: s.expectFile }),
		));
		this.#preview = Object.freeze([...steps.flatMap((s) => s.codes.map(String)), ...restore.map(String)]);
	}

	get plannedAt(): number {
		return this.#plannedAt;
	}

	/** What the run will do, for the screen: one entry per step, in order.
	 *  `steps.length` is the count a progress strip needs; the array position
	 *  is the `index` a `step` event reports. */
	get steps(): readonly StepView[] {
		return this.#stepViews;
	}

	/**
	 * Every command this run will send, in order, restore last — as PLAIN
	 * STRINGS, for a card that shows the operator what it is about to do
	 * before an armed confirm ("controls wear their G-code").
	 *
	 * Deliberately unbranded. A display value that could be fed back to
	 * `sendCode` would be the same hole as a public `#steps` wearing a
	 * different hat; a `string` is not a `GcodeCommand` and will not compile
	 * there.
	 */
	get preview(): readonly string[] {
		return this.#preview;
	}

	/**
	 * Send the steps, retrieve each capture, and put the shaper back.
	 *
	 * Three things this deliberately does NOT do. It does not correct a
	 * position: a carriage that is not where the plan expects ends the run,
	 * because moving it there would be this UI deciding where the machine
	 * ought to be. It does not assume a capture happened: the file has to turn
	 * up, and when it is overwriting a file of the same name the board's own
	 * run counter has to tick as well, since a name alone cannot tell
	 * yesterday's capture from today's. And it does not treat a rejected
	 * request inside a capture step as a failure by itself — a long move can
	 * outlive the HTTP timeout while the board carries on perfectly well, so
	 * the evidence decides and the rejection is reported only if no capture
	 * ever arrives.
	 *
	 * `om` is called fresh before every step rather than captured once: the
	 * whole point of the check is to see what the machine is doing NOW.
	 */
	async *run(conn: RunConnector, om: () => ObjectModel, opts: RunOptions = {}): AsyncGenerator<ProcEvent, void, void> {
		const clock: Clock = { sleep: opts.sleep ?? realSleep, now: opts.now ?? Date.now, signal: opts.signal };
		try {
			for (const [index, step] of this.#steps.entries()) {
				if (opts.signal?.aborted === true) return;

				const where = `step ${index + 1} of ${this.#steps.length} (${step.label})`;
				const mismatch = positionMismatch(om(), step.expectPosition);
				if (mismatch !== null) {
					yield { kind: "failed", error: `${where}: ${mismatch}` };
					return;
				}

				yield { kind: "step", index, label: step.label };

				const watch = step.expectFile === undefined
					? null
					: await beginWatch(conn, om(), this.pre.accel, step.expectFile);
				const rejected = await sendAll(conn, step.codes);

				if (watch === null) {
					if (rejected === null) continue;
					yield { kind: "failed", error: `${where}: ${describe(rejected.failed)}` };
					return;
				}

				const outcome = await awaitCapture(conn, om, watch, clock);
				if (outcome.ok) {
					yield { kind: "capture", file: watch.file, csv: outcome.csv };
					continue;
				}
				if (outcome.cancelled) return;
				const because = rejected === null ? outcome.reason : `${describe(rejected.failed)} — ${outcome.reason}`;
				yield { kind: "failed", error: `${where}: ${because}` };
				return;
			}
			yield { kind: "done" };
		} catch (err) {
			yield { kind: "failed", error: describe(err) };
		} finally {
			// The restore is SENT before the event is yielded, so a consumer that
			// walked away — a `break`, a `.return()` — still gets the machine put
			// back: these awaits have all completed by the time execution
			// suspends at the yield, whether or not anyone is still listening.
			// Nothing here consults `signal`, because a cancelled run is exactly
			// the case that must still be undone.
			const problem = await sendAll(conn, this.#restore);
			if (problem === null) yield { kind: "restored" };
			else yield { kind: "failed", error: `restore failed: ${describe(problem.failed)}` };
		}
	}

	/**
	 * The sole producer. Exported below as `planProcedure`; it is a static
	 * because TypeScript's `private` constructor is reachable only from inside
	 * the class body, and a module-level function would have to be handed a
	 * seam to bypass.
	 */
	static plan(plan: Plan, pre: Preconditions, cfg: ShapingConfig, now: number): PlanResult {
		// First, because it is about the REQUEST and needs no machine to answer:
		// a plan that measures nothing is refused before the reading is even
		// consulted. This is also what keeps `plan` total — the G-code builders
		// throw on a bad sample count, and nothing may throw out of here.
		if (!measurable(plan)) return { ok: false, refusal: { kind: "not-measurable" } };

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

// --- is there anything to measure? ------------------------------------------

const positiveFinite = (v: number): boolean => Number.isFinite(v) && v > 0;
const wholeAtLeastOne = (v: number): boolean => Number.isInteger(v) && v >= 1;

/**
 * Does this plan describe a run the machine could actually measure?
 *
 * A zero-length excitation move is the case that matters: measured against
 * mock-duet on 2026-08-22, a capture armed before one produces NO FILE, so a
 * run built from it would move, wait out its whole capture budget and fail —
 * ten seconds after the point at which the answer was already knowable.
 *
 * The sample-count rule restates `cmd.accelCapture`'s own bound rather than
 * replacing it. The builder still throws, which is right for a builder; this
 * exists so the throw is not how a caller of `plan` finds out. If the two ever
 * disagree the builder wins, because it is the one that decides what a legal
 * M956 looks like.
 */
function measurable(plan: Plan): boolean {
	switch (plan.kind) {
		case "ring":
			return Number.isFinite(plan.distMm) && plan.distMm !== 0
				&& positiveFinite(plan.speed)
				&& wholeAtLeastOne(plan.repeats)
				&& wholeAtLeastOne(plan.samples);
		case "sweep":
			return Number.isFinite(plan.distMm) && plan.distMm !== 0
				&& plan.speeds.length > 0
				&& plan.speeds.every((s) => positiveFinite(s))
				&& wholeAtLeastOne(plan.samples);
		case "verify":
			return measurable(plan.ring);
		default: {
			const unhandled: never = plan;
			throw new Error(`unknown plan kind: ${String((unhandled as { kind: unknown }).kind)}`);
		}
	}
}

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
		for (const dir of RING_DIRECTIONS) {
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
		for (const axis of PLANAR_AXES) {
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

// --- running ----------------------------------------------------------------

type Clock = { readonly sleep: (ms: number) => Promise<void>; readonly now: () => number; readonly signal?: AbortSignal };

const realSleep = (ms: number): Promise<void> => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

const describe = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const at = (p: { readonly x: number; readonly y: number }): string => `X${p.x.toFixed(2)} Y${p.y.toFixed(2)}`;

/**
 * Send commands in order, stopping at the first refusal.
 *
 * Returns the rejection rather than throwing it, because both callers have to
 * keep going: the step loop turns it into a `failed` event, and the restore
 * has to be able to report a broken link without the throw escaping the
 * generator's `finally` and replacing whatever went wrong first.
 */
async function sendAll(conn: RunConnector, codes: readonly GcodeCommand[]): Promise<{ readonly failed: unknown } | null> {
	for (const code of codes) {
		try {
			await conn.sendCode(code);
		} catch (err) {
			return { failed: err };
		}
	}
	return null;
}

/**
 * Is the carriage where this step needs it to be? Returns the sentence to put
 * in the failure, or null when it is.
 *
 * Reads through the SAME `planarPosition` the preconditions did, so "where is
 * X" has one answer. An axis that has stopped reporting a homed position is a
 * mismatch too: an unknown position is not a matching one.
 */
function positionMismatch(om: ObjectModel, expect: Point): string | null {
	const x = planarPosition(om, "X");
	const y = planarPosition(om, "Y");
	if (x === null || y === null) return "the machine is no longer reporting a homed X/Y position";
	if (Math.abs(x - expect.x) > POSITION_TOLERANCE_MM || Math.abs(y - expect.y) > POSITION_TOLERANCE_MM) {
		return `the carriage is at ${at({ x, y })} but this step starts at ${at(expect)}`;
	}
	return null;
}

type CaptureWatch = {
	readonly file: string;
	readonly path: string;
	readonly existedBefore: boolean;
	readonly runsBefore: number | null;
	readonly accel: AccelAddr;
};

type CaptureOutcome =
	| { readonly ok: true; readonly csv: string }
	| { readonly ok: false; readonly cancelled: true }
	| { readonly ok: false; readonly cancelled: false; readonly reason: string };

/**
 * What the accelerometer directory and the board's run counter looked like
 * before the step went out.
 *
 * A listing we could not read counts as "the name was already there", which is
 * the strict reading: it forces the run counter to tick before any file is
 * accepted, so a failed pre-list can never turn a stale capture into a fresh
 * one.
 */
async function beginWatch(conn: RunConnector, om: ObjectModel, accel: AccelAddr, file: string): Promise<CaptureWatch> {
	const before = await listCaptures(conn);
	return {
		file,
		path: `${CAPTURE_DIR}/${file}`,
		existedBefore: before === null || before.has(file),
		runsBefore: accelerometerOf(om, accel)?.runs ?? null,
		accel,
	};
}

/** The file names in the capture directory, or null when the listing failed —
 *  a directory we could not read is not an empty directory. */
async function listCaptures(conn: RunConnector): Promise<Set<string> | null> {
	try {
		const entries = await conn.list(CAPTURE_DIR);
		return new Set(entries.filter((e) => e.type === "f").map((e) => e.name));
	} catch {
		return null;
	}
}

/**
 * Wait for the board to produce the capture, then fetch it.
 *
 * Two pieces of evidence, because neither is sufficient alone. The FILE is
 * what we need — it carries the samples — but M956 overwrites, so a file of
 * the right name may be last week's. The board's RUN COUNTER says a capture
 * completed but not which one, and it is the only signal available when the
 * request that armed the capture timed out. So a pre-existing name has to be
 * accompanied by a tick, and a name that was not there before speaks for
 * itself.
 */
async function awaitCapture(conn: RunConnector, om: () => ObjectModel, watch: CaptureWatch, clock: Clock): Promise<CaptureOutcome> {
	const deadline = clock.now() + CAPTURE_BUDGET_MS;
	let sawRun = false;
	for (;;) {
		if (clock.signal?.aborted === true) return { ok: false, cancelled: true };

		const names = await listCaptures(conn);
		const runsNow = accelerometerOf(om(), watch.accel)?.runs ?? null;
		const ticked = watch.runsBefore !== null && runsNow !== null && runsNow > watch.runsBefore;
		sawRun ||= ticked;

		if (names !== null && names.has(watch.file) && (!watch.existedBefore || ticked)) {
			return { ok: true, csv: await conn.download(watch.path) };
		}

		if (clock.now() >= deadline) {
			// The two diagnoses are genuinely different jobs for the operator:
			// one is a board that captured and could not write, the other is a
			// board that never captured at all.
			return {
				ok: false,
				cancelled: false,
				reason: sawRun
					? `the board finished a capture but ${watch.file} never appeared in ${CAPTURE_DIR}`
					: `no capture named ${watch.file} appeared in ${CAPTURE_DIR} within ${CAPTURE_BUDGET_MS / 1000} s`,
			};
		}
		await clock.sleep(CAPTURE_POLL_MS);
	}
}
