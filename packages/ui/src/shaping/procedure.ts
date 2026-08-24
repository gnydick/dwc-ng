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
import { DECAY_FLOOR, FIT_DEFAULTS } from "./engine/fit.ts";
import { hz, mm, seconds, type Hz, type Mm, type MmPerS, type MmPerS2, type Seconds } from "./engine/units.ts";
import { accelerometerOf, inside, planarPosition, Preconditions, type Point, type Refusal } from "./preconditions.ts";
import { ACCEL_DIR } from "./captures.ts";

/** A `Preconditions` read longer ago than this is refused as `stale`. One
 *  status poll is 1 s at the connector's slowest cadence; two is the window in
 *  which the model still describes the machine in front of the operator. */
const STALE_MS = 2000;

/** Held still after the positioning move so its own ringing has died before the
 *  capture is armed. Seven time constants of the slowest mode this machine has
 *  shown (18 Hz at zeta 0.127, tau = 70 ms). */
const SETTLE_MS = 500;

/** M956's A parameter: arm at the start of the next move's DECELERATION, which
 *  is the instant the ring-down begins. */
const TRIGGER_ON_DECELERATION = 2;

/** Where RRF puts an M956 capture: the F parameter is a bare file name and the
 *  firmware chooses the directory (reference/duet-gcode.md, M956). Exported so
 *  the card that offers "import an existing capture" reads the same place the
 *  run writes to, rather than spelling the path a second time. */
export const CAPTURE_DIR = ACCEL_DIR;

/** How far the carriage may be from where a step expects it. Tight enough that
 *  a skipped step or a nudge shows up, loose enough to survive the rounding
 *  between what G1 asked for and what the model reports back. */
const POSITION_TOLERANCE_MM = 0.05;

/** How often to look for a capture file. The BUDGET is not here: it is derived
 *  per capture from the recording that capture will make (`captureTiming`),
 *  because a fixed budget is a false failure the moment a recording outlasts
 *  it. */
const CAPTURE_POLL_MS = 250;

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
 * A plan describes MOTION and nothing about the recording.
 *
 * There is deliberately no `samples` here and no way to add one from outside:
 * how many accelerometer samples a pass needs is a consequence of how long that
 * pass takes and how long its ring-down lasts, both of which this file already
 * knows. A configured sample count is the same number stated twice — once as a
 * setting and once as a physical fact — and on 2026-08-23 they disagreed by 8×
 * across a speed sweep, so a 25 mm/s pass recorded 1.09 s of a 4.0 s move.
 * `captureTiming` is the one producer, and there is no field for a caller to
 * contradict it with.
 */
export type RingPlan = {
	readonly kind: "ring";
	readonly axis: "X" | "Y";
	readonly start: Point;
	readonly distMm: Mm;
	readonly speed: MmPerS;
	readonly repeats: number;
	readonly namePrefix: string;
};

export type SweepPlan = {
	readonly kind: "sweep";
	readonly start: Point;
	readonly distMm: Mm;
	readonly speeds: readonly MmPerS[];
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
	/**
	 * The capture this step produces, if it produces one — the file name AND how
	 * long to wait for it, together in one optional field.
	 *
	 * One field rather than two, because "a step that records" and "a step that
	 * does not" are the only two states either half of this can be in. A separate
	 * `expectFile?` and `budgetMs?` would let a step say it records without
	 * saying for how long, and the answer that would then be reached for is a
	 * constant — which is the bug this whole module was rewritten to delete.
	 */
	readonly capture?: CaptureExpectation;
	readonly label: string;
	readonly expectPosition: Point;
};

/** What a recording step is waiting for: the name M956 will write and the
 *  budget derived from that same recording's length. */
type CaptureExpectation = {
	readonly file: string;
	readonly budgetMs: number;
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
			Object.freeze(s.capture === undefined ? { label: s.label } : { label: s.label, expectFile: s.capture.file }),
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

				const watch = step.capture === undefined
					? null
					: await beginWatch(conn, om(), this.pre.accel, step.capture);
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
	static plan(plan: Plan, pre: Preconditions, cfg: ShapingConfig, now: number, rate: SampleRate): PlanResult {
		// First, because it is about the REQUEST and needs no machine to answer:
		// a plan that measures nothing is refused before the reading is even
		// consulted. This is also what keeps `plan` total — a zero speed would
		// divide by nothing on the way to a capture length, and a zero-length
		// move produces no file at all, so neither may reach the arithmetic.
		if (!measurable(plan)) return { ok: false, refusal: { kind: "not-measurable" } };

		if (now - pre.readAt > STALE_MS) return { ok: false, refusal: { kind: "stale" } };

		// The box the reading was taken against must still be the box in
		// config. A user who redrew the envelope between the read and the plan
		// has invalidated the reading, and "stale" is exactly what that is.
		if (cfg.envelope === null) return { ok: false, refusal: { kind: "no-envelope" } };
		if (!sameEnvelope(cfg.envelope, pre.envelope)) return { ok: false, refusal: { kind: "stale" } };

		// The PLAN's own points only. The carriage's current position is not
		// re-checked here: `Preconditions.read` refuses a head outside the box, so
		// holding a `Preconditions` is already the proof — and a rectangle is
		// convex, so a segment with both ends inside it never leaves it.
		for (const point of visitedPoints(plan)) {
			if (!inside(point, pre.envelope)) {
				return { ok: false, refusal: { kind: "outside-envelope", point: { x: point.x, y: point.y } } };
			}
		}

		// The recording, LAST, because it is the only refusal that needs the
		// machine's acceleration and the board's sampling rate rather than the
		// geometry. A pass whose capture cannot be expressed as an M956 is refused
		// here rather than sent and rejected mid-run, which would leave the
		// carriage parked halfway through a plan with a shaper still applied.
		const timed = timedPasses(plan, pre, rate);
		if (!timed.ok) return { ok: false, refusal: timed.refusal };

		return { ok: true, proc: new Procedure(now, stepsFor(plan, pre, timed.passes), restoreFor(pre.priorShaping), pre) };
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
 * Does this leg take an expressible amount of time?
 *
 * `distMm / speed` is the cruise term of every move and the only place the
 * arithmetic can leave the number line: both are finite and positive by the
 * checks beside this one, but a speed small enough — and `parseShapingDefaults`
 * accepts any positive finite number — overflows the quotient to Infinity, and
 * `seconds()` refuses to mint that. This is what keeps `plan` TOTAL: it is the
 * one input that would otherwise throw out of it rather than refuse.
 */
const timeable = (dist: number, speed: number): boolean => Number.isFinite(Math.abs(dist) / speed);

/**
 * Does this plan describe a run the machine could actually measure?
 *
 * A zero-length excitation move is the case that matters: measured against
 * mock-duet on 2026-08-22, a capture armed before one produces NO FILE, so a
 * run built from it would move, wait out its whole capture budget and fail —
 * ten seconds after the point at which the answer was already knowable.
 *
 * The sample count is NOT among the things checked here, because it is no
 * longer among the things a plan can say: `captureTiming` derives it from this
 * very motion, so a plan with a measurable move has a positive sample count by
 * construction. What a derived count can still be is too LARGE for the board,
 * and that is `capture-too-long` — decided in `plan`, where the machine's
 * acceleration and the board's rate are in hand. `cmd.accelCapture` still
 * throws on a bad count, which is right for a builder; between the two, nothing
 * a caller of `plan` can ask for reaches the throw.
 */
function measurable(plan: Plan): boolean {
	switch (plan.kind) {
		case "ring":
			return Number.isFinite(plan.distMm) && plan.distMm !== 0
				&& positiveFinite(plan.speed)
				&& timeable(plan.distMm, plan.speed)
				&& wholeAtLeastOne(plan.repeats);
		case "sweep":
			return Number.isFinite(plan.distMm) && plan.distMm !== 0
				&& plan.speeds.length > 0
				&& plan.speeds.every((s) => positiveFinite(s) && timeable(plan.distMm, s));
		case "verify":
			return measurable(plan.ring);
		default: {
			const unhandled: never = plan;
			throw new Error(`unknown plan kind: ${String((unhandled as { kind: unknown }).kind)}`);
		}
	}
}

// --- geometry ---------------------------------------------------------------

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
const ringCaptureName = (prefix: string, axis: "X" | "Y", dir: "p" | "m", index: number): string =>
	`${prefix}_${axis}${dir}${index}.csv`;

/**
 * `<prefix>_X_100.csv` — axis, then the speed that leg was driven at.
 *
 * A DIFFERENT convention from a ring's, deliberately. A sweep is one move at
 * many speeds, and `shaping/captures.ts speedFamilies` collects exactly
 * `<prefix>_<axis>_<speed>.csv` into the family the Sweep card draws its heat
 * map from. Named any other way a live sweep would leave files nothing on this
 * screen could collect — a run that worked and a result that was unreachable.
 *
 * The speed goes in as written and that family regex recognises whole numbers
 * only, so the ladder that builds a sweep's speeds (shaping/runPlan.ts) is what
 * keeps them whole and distinct. Two speeds that rounded together would be two
 * captures under one name, which is one capture.
 */
const sweepCaptureName = (prefix: string, axis: "X" | "Y", speed: MmPerS): string =>
	`${prefix}_${axis}_${speed}.csv`;

const xy = (p: Point): ReadonlyArray<{ axis: "X" | "Y"; mm: Mm }> => [
	{ axis: "X", mm: p.x },
	{ axis: "Y", mm: p.y },
];

/**
 * One measured pass, as GEOMETRY: where the carriage must already be, where the
 * positioning move puts it, and the excitation leg the accelerometer records.
 *
 * The single producer of a plan's shape. `stepsFor` turns a pass into the
 * commands that perform it; `plannedSegments` turns the same pass into the
 * polyline the Capture card's map draws. So the picture an operator approves and
 * the moves an armed confirm sends are two renderings of ONE derivation rather
 * than two arithmetics that agree today.
 *
 * Not a hypothetical: the map exists so the operator can see the moves before
 * arming them, and a map computed from its own reading of the plan would be a
 * drawing of a run that might not be the one about to happen — worse than no map.
 */
type Pass = {
	readonly at: Point;
	readonly from: Point;
	readonly to: Point;
	readonly speed: MmPerS;
	readonly file: string;
	readonly label: string;
};

/**
 * How far the excitation leg travels, off the very points the G1 will name.
 *
 * Not `plan.distMm`: a pass's legs are `from` and `to`, and the recording has to
 * cover the move that will actually be COMMANDED. Both are axis-aligned by
 * construction (`along` carries the other coordinate through unchanged), so one
 * of these terms is always zero and the sum is the length.
 */
const passDistance = (p: Pass): Mm => mm(Math.abs(p.to.x - p.from.x) + Math.abs(p.to.y - p.from.y));

// --- how long a pass records ------------------------------------------------

/**
 * The board's accelerometer sampling rate, as the board itself reported it.
 *
 * @invariant sample-rate-came-from-the-board
 * @rung 7  branded type — the brand is `unique symbol`-keyed and unexported, so
 *          a plain number is not assignable to `SampleRate` and the only two
 *          producers are in this file: `sampleRateFrom`, which parses an M955
 *          report, and `readSampleRate`, which asks the board for one. There is
 *          no default and no fallback constant to reach for, so a procedure
 *          cannot be planned against an assumed rate — `Procedure.plan` takes
 *          one as an argument and will not compile without it. The universal
 *          `x as unknown as T` escape is not counted against this rung
 * @why `samples / rate` is the whole recording. M955's S parameter PERSISTS on
 *      the board (reference/duet-gcode.md, M955 notes: "These configuration
 *      settings persist until they are changed"), so the rate in force is
 *      whatever somebody last set — 1375 Hz on Gabe's toolboard, but nothing in
 *      this UI put it there. A constant here would silently mis-size every
 *      capture on any machine configured differently, and the error is
 *      proportional: at half the assumed rate every recording is twice as long
 *      as planned and the dwell derived from it covers half of it
 */
declare const __sampleRate: unique symbol;
export type SampleRate = Hz & { readonly [__sampleRate]: true };

/**
 * The rate out of an M955 report, or null when the reply is not one.
 *
 * RRF answers `M955 P<addr>` with a sentence — observed shape (mock-duet's
 * `reportAccelerometer`, itself modelled on the 3.6 firmware's own wording):
 * `Accelerometer 20:0 type LIS3DH with orientation 41 samples at 1344Hz with
 * 10-bit resolution`. Only the rate is taken, and it is taken by the UNIT
 * rather than by position in the sentence, because the rest of that string is
 * the firmware's to reword.
 *
 * Null, never a guess. A reply this cannot read is an unknown rate, and an
 * unknown rate is a refusal (`no-sample-rate`) rather than an assumption.
 */
export function sampleRateFrom(reply: string): SampleRate | null {
	const m = /(\d+(?:\.\d+)?)\s*Hz/i.exec(reply);
	if (m === null) return null;
	const value = Number(m[1]);
	return Number.isFinite(value) && value > 0 ? (hz(value) as SampleRate) : null;
}

/**
 * Ask the board what its accelerometer is configured for.
 *
 * `cmd.accelConfig` sends P and nothing else, which REPORTS rather than sets
 * (reference/duet-gcode.md, M955 notes) — so calling this cannot change the
 * configuration it is reading. It lives in this file because `sendCode` does:
 * shaping talks to the machine here or nowhere (test/shaping-motion-fence).
 *
 * A rejected request or an unreadable reply is null, and the caller refuses.
 */
export async function readSampleRate(conn: Pick<ConnectorWrites, "sendCode">, addr: AccelAddr): Promise<SampleRate | null> {
	try {
		return sampleRateFrom(await conn.sendCode(cmd.accelConfig(addr)));
	} catch {
		return null;
	}
}

/**
 * The mode whose ring-down a capture has to outlast, when one is known.
 *
 * `f` in Hz and `zeta` dimensionless — the two numbers `fitDecay` returns, so a
 * measured mode is one of these without conversion.
 */
export type RingMode = {
	readonly f: Hz;
	readonly zeta: number;
};

/**
 * How long the accelerometer is running before the move it was armed for
 * begins: the gap between M956 being executed and the G1 actually starting.
 *
 * MEASURED, not assumed. Across the first real UI run
 * (tools/accel/runs/ui-first-run-2026-08-23) the first sample whose |X| leaves
 * the noise floor sits at 0.090 s (t0_ring_Xp0), 0.086 s (t0_sweep_X_200) and
 * 0.105 s (t0_sweep_X_25) into the record. 0.12 s is the largest of those with
 * margin, and it is deliberately an OVER-estimate: a lead-in longer than the
 * truth only adds samples to the head of the record, where there is nothing to
 * lose. Under-estimating it would cut the tail, which is the part the fit reads.
 *
 * That the record begins at the move at all is a firmware observation rather
 * than a reading of the docs: M956 A2 documents arming at the start of
 * DECELERATION, and RRF 3.6.3 was seen delivering the whole move for A2 exactly
 * as for A1 (see shaping/engine/capture.ts and mock-duet's executeM956). The
 * arithmetic here follows the firmware, not the wiki.
 */
const LEAD_IN_S = 0.12;

/**
 * Margin on the computed ring-down before it is recorded.
 *
 * `f` and `zeta` reaching this are estimates — either the fit's, which carries
 * a few per cent of frequency error by construction (engine/fit.ts MIN_CYCLES),
 * or a shaper's tuning. A quarter more recording is a fraction of a second on a
 * typical pass and removes the case where a slightly optimistic zeta ends the
 * record inside the ring it was supposed to capture.
 */
const RING_MARGIN = 1.25;

/**
 * Fixed cost in a capture's wait budget: the board's own file write, the
 * listing round-trips, and the download — everything that does not scale with
 * the recording. This is the OLD flat budget, kept as the floor it always
 * really was rather than as the whole answer.
 */
const CAPTURE_OVERHEAD_MS = 10_000;

/**
 * How many multiples of the recording the budget allows on top of that.
 *
 * Two: one for the recording itself, which cannot be hurried, and one for the
 * write and transfer, which grow with it — a capture is one CSV row per sample.
 */
const CAPTURE_WRITE_FACTOR = 2;

/**
 * The most samples one M956 may ask for.
 *
 * RRF's own M956 documentation states no bound on S (reference/duet-gcode.md,
 * M956), and reference/dwc's InputShaping plugin simply hard-codes `S1000`
 * (RecordMotionProfileDialog.vue:555), so neither is the source. The bound is
 * the wire format: the sample count crosses CAN as a 16-bit field, which is the
 * same reading mock-duet's own `MAX_SAMPLES` already takes
 * (packages/mock-duet/src/accelerometer.ts). The two are deliberately
 * independent — the mock models the BOARD's refusal and this models what the UI
 * will ask for — and this one is the lower-or-equal of the pair, so the UI
 * refuses before the board has to.
 *
 * At 1375 Hz this is 47 s of continuous recording, which no plan a person would
 * arm gets near; what it catches is the ladder that ran away — a 25 mm/s pass
 * over a 1 m axis is 40 s and 55,000 samples, and one more halving is over.
 *
 * @invariant no-m956-over-the-boards-limit
 * @rung 6  choke-point — every M956 this app can send is built by `captureStep`,
 *          which is reached only from `stepsFor`, which is reached only from the
 *          private constructor `Procedure.plan` calls; `plan` runs
 *          `timedPasses` first and returns `capture-too-long` for any pass over
 *          this bound, so a `Procedure` carrying an oversized capture is not one
 *          that can be built. Nothing outside this file can reach a
 *          `GcodeCommand` of a procedure to send one itself: the codes are
 *          `#`-private and `preview` hands out plain strings `sendCode` refuses
 * @why the alternative is finding out mid-run. The board rejects the M956, the
 *      G1 that follows it still executes, and the run ends with the carriage
 *      somewhere unplanned and the lab's shaper still applied — a refusal that
 *      arrives after the machine has moved is not a refusal
 * @debt the NUMBER is a reading of the wire format, not a measurement: RRF's
 *       source is not vendored here and its M956 docs state no bound. Promote by
 *       walking a real toolboard up until it refuses and pinning the value that
 *       came back, or by citing the firmware's own field width. Until then the
 *       claim is only that the UI refuses before the board does, which holds for
 *       any true bound at or below this one
 */
export const MAX_CAPTURE_SAMPLES = 65535;

/**
 * The lengths of one recording, in seconds — everything that does not depend on
 * the board's sampling rate.
 *
 * Split from {@link CaptureTiming} on purpose. The Capture card states how long
 * each pass will record BEFORE any run has happened, and at that point nothing
 * has asked the board for its rate; the honest thing for it to show is the part
 * it actually knows. There is no nominal rate in this file for it to reach for.
 */
export type CaptureWindow = {
	/** The excitation move, start to stop. */
	readonly moveS: Seconds;
	/** Recording that must follow the stop, for the fit to have a ring-down. */
	readonly ringS: Seconds;
	/** The whole record: lead-in, move, ring-down. */
	readonly captureS: Seconds;
};

/**
 * The recording a pass needs, as a whole: seconds, samples, the dwell that
 * keeps the carriage still for them, and the budget the file is waited for in.
 *
 * @invariant one-capture-timing
 * @rung 8  illegal state unrepresentable — the sample count, the dwell and the
 *          wait budget are three consequences of one recording and are produced
 *          by one function from one argument, so "the dwell disagrees with the
 *          capture length" is not a state this type can hold. `dwellMs` is
 *          derived from `samples`, not recomputed from `captureS`, so the
 *          rounding that turns seconds into a whole M956 S cannot leave the
 *          dwell a sample short. There is no other producer and no field to set
 *          by hand: `Pass` carries no sample count, `RingPlan`/`SweepPlan` carry
 *          none, and `ShapingDefaults` no longer has one
 * @why the constant this replaced was 1500 ms of dwell beside a free-floating
 *      `samples` setting, and on 2026-08-23 a sweep recorded 7.5 s against it —
 *      every following pass landed inside the previous pass's file. The two
 *      numbers had no way to know about each other, and neither knew about the
 *      move
 */
export type CaptureTiming = CaptureWindow & {
	/** The rate the seconds were turned into samples at. */
	readonly rate: Hz;
	/** M956's S. */
	readonly samples: number;
	/** G4 P after the excitation move — long enough that the carriage is not
	 *  what ends the recording. */
	readonly dwellMs: number;
	/** How long `awaitCapture` may wait for this capture's file. */
	readonly budgetMs: number;
};

/**
 * How long a `dist` move at `speed` takes under `accel`, start to stop.
 *
 * Trapezoid when there is room to reach `speed` — ramp up, cruise, ramp down,
 * which is `dist/speed + speed/accel` — and a triangle when there is not, where
 * the move never gets there and takes `2*sqrt(dist/accel)`. RRF's own planner
 * does more than this (jerk, junction deviation, input shaping's own extension),
 * all of which make the real move LONGER, so this is a lower bound and the
 * margins above sit on top of it.
 *
 * `accel` is `move.travelAcceleration` as the board reported it; there is no
 * fallback, which is why `plan` refuses `no-acceleration` when the model has
 * none.
 */
export function moveSeconds(dist: Mm, speed: MmPerS, accel: MmPerS2): Seconds {
	const d = Math.abs(dist);
	const rampD = (speed * speed) / accel;
	return seconds(d >= rampD ? d / speed + speed / accel : 2 * Math.sqrt(d / accel));
}

/**
 * How much recording must follow the stop.
 *
 * The bounds are the FITTER's, not new numbers. `decayWindow` opens its
 * analysis region `FIT_DEFAULTS.leadS` after the stop and reads at most
 * `FIT_DEFAULTS.windowS` of it, and it returns null — `short-window`, no fit at
 * all — unless at least `FIT_DEFAULTS.minWindowS` of samples are there. So
 * `leadS + minWindowS` is the least recording that can produce a fit and
 * `leadS + windowS` is the most that will ever be read. Recording outside that
 * band is either unusable or ignored, whatever the arithmetic says.
 *
 * Inside the band the length is the mode's own: the decay to
 * {@link DECAY_FLOOR}, the level the fit describes the ring down to, takes
 * `ln(1/0.15) / (2*pi*f*zeta)` seconds.
 *
 * WHEN THE MODE IS UNKNOWN — which is every first measurement, since f and zeta
 * are what the run is being made to find out — this returns the top of the
 * band. Not a guessed damping: the fitter's whole window is the most that could
 * ever be looked at, so recording it is the one choice that cannot be too short
 * for any machine, and it costs 0.45 s of recording per pass against the best
 * case. Assuming a damping instead would be assuming a machine, and the
 * lightest the fitter accepts (zeta 0.005, engine/fit.ts) would ask for 6 s of
 * ring-down at 10 Hz — far more than the window that would read it.
 */
export function ringSeconds(mode: RingMode | null): Seconds {
	const shortest = FIT_DEFAULTS.leadS + FIT_DEFAULTS.minWindowS;
	const longest = FIT_DEFAULTS.leadS + FIT_DEFAULTS.windowS;
	if (mode === null || !(mode.f > 0) || !(mode.zeta > 0)) return seconds(longest);
	const decay = (Math.log(1 / DECAY_FLOOR) / (2 * Math.PI * mode.f * mode.zeta)) * RING_MARGIN;
	return seconds(Math.min(longest, Math.max(shortest, decay)));
}

/** The seconds of one pass's recording. Pure: numbers in, numbers out. */
export function captureWindow(dist: Mm, speed: MmPerS, accel: MmPerS2, mode: RingMode | null): CaptureWindow {
	const moveS = moveSeconds(dist, speed, accel);
	const ringS = ringSeconds(mode);
	return { moveS, ringS, captureS: seconds(LEAD_IN_S + moveS + ringS) };
}

/**
 * The same recording in samples, plus the two waits that must cover it.
 *
 * The DWELL is computed from `samples`, not from `captureS`: `samples` is what
 * M956 is actually given, so `samples / rate` is what the board actually
 * records, and a dwell derived from anything else can be a rounding short. It
 * subtracts the move but NOT the lead-in — the conservative reading, since a
 * record that began later than we think ends later too, and the lead-in is the
 * one term measured off a handful of files rather than derived. That costs
 * about 0.12 s of standing still per pass and removes the whole class of "the
 * next move started while the sensor was recording".
 *
 * The BUDGET covers the same recording twice over — once because the file
 * cannot exist before the recording ends, once for the write and the transfer,
 * which grow with it — on top of the fixed overhead that was the old flat 10 s.
 */
export function captureTiming(w: CaptureWindow, rate: SampleRate): CaptureTiming {
	const samples = Math.max(1, Math.ceil(w.captureS * rate));
	const recordS = samples / rate;
	return {
		...w,
		rate,
		samples,
		dwellMs: Math.ceil(Math.max(0, recordS - w.moveS) * 1000),
		budgetMs: CAPTURE_OVERHEAD_MS + Math.ceil(recordS * 1000 * CAPTURE_WRITE_FACTOR),
	};
}

/**
 * The mode a plan already knows about, or null.
 *
 * A VERIFY plan carries the shaper under test, and a named shaper's F and S ARE
 * the mode it was built to cancel — the same f and zeta the fit produced. The
 * ring it leaves behind is at that frequency with that damping (a shaper
 * cancels amplitude, not decay rate), so its recording can be sized to it.
 *
 * A ring or a sweep is the measurement that FINDS f and zeta, so there is
 * nothing to know and this returns null. Deliberately not "the last fingerprint
 * we have": that would size a fresh measurement to a stale belief about the
 * machine, and the case where the belief is wrong is exactly the case the
 * measurement is being run to catch. The custom shaper form carries an impulse
 * train rather than an F/S pair and is null for the same reason.
 */
function modeOf(plan: Plan): RingMode | null {
	if (plan.kind !== "verify") return null;
	const spec = plan.spec;
	return spec.type === "custom" ? null : { f: spec.F, zeta: spec.S };
}

/** One pass and the recording it needs — produced together, so the codes that
 *  arm the capture and the codes that hold the carriage still for it cannot be
 *  built from two different ideas of how long it takes. */
type TimedPass = {
	readonly pass: Pass;
	readonly timing: CaptureTiming;
};

type TimedResult =
	| { readonly ok: true; readonly passes: readonly TimedPass[] }
	| { readonly ok: false; readonly refusal: Refusal };

/**
 * Every pass of a plan with its recording attached, or the refusal that stops
 * the run before it starts.
 *
 * The two refusals are the two facts the arithmetic cannot proceed without and
 * must not invent: an acceleration the board never reported, and a recording
 * longer than one M956 can ask for.
 */
function timedPasses(plan: Plan, pre: Preconditions, rate: SampleRate): TimedResult {
	const accel = pre.travelAccel;
	if (accel === null) return { ok: false, refusal: { kind: "no-acceleration" } };
	const mode = modeOf(plan);
	const out: TimedPass[] = [];
	for (const pass of passesFor(plan, pre.position)) {
		const timing = captureTiming(captureWindow(passDistance(pass), pass.speed, accel, mode), rate);
		if (timing.samples > MAX_CAPTURE_SAMPLES) {
			return { ok: false, refusal: { kind: "capture-too-long", samples: timing.samples, max: MAX_CAPTURE_SAMPLES } };
		}
		out.push({ pass, timing });
	}
	return { ok: true, passes: out };
}

/**
 * The longest recording any pass of these plans will make, for a card that
 * wants to say so before anything is armed.
 *
 * Seconds only, and that is the point: this is reached from the screen, which
 * has not asked the board for its sampling rate and must not pretend to know
 * it. It is the SAME `captureWindow` the run sizes its M956 with, over the same
 * `passesFor` the map draws, so the figure on the card is the figure the run
 * will use — one arithmetic, two readers.
 *
 * The longest rather than each, because a sweep's passes differ by the full
 * speed ratio and the number worth stating is the worst case. Null when there
 * is nothing to measure or the machine has not reported an acceleration.
 */
export function longestCapture(plans: readonly Plan[], origin: Point, accel: MmPerS2 | null): CaptureWindow | null {
	if (accel === null) return null;
	let longest: CaptureWindow | null = null;
	let where = origin;
	for (const plan of plans) {
		for (const pass of passesFor(plan, where)) {
			const w = captureWindow(passDistance(pass), pass.speed, accel, modeOf(plan));
			if (longest === null || w.captureS > longest.captureS) longest = w;
			where = pass.to;
		}
	}
	return longest;
}

function ringPasses(plan: RingPlan, origin: Point): Pass[] {
	const far = along(plan.start, plan.axis, plan.distMm);
	const passes: Pass[] = [];
	let where = origin;
	for (let i = 0; i < plan.repeats; i++) {
		// Out then back: the return leg is a capture in its own right AND is
		// what puts the carriage where the next repeat starts, so the run never
		// contains a move that is not being measured.
		for (const dir of RING_DIRECTIONS) {
			const from = dir === "p" ? plan.start : far;
			const to = dir === "p" ? far : plan.start;
			passes.push({
				at: where,
				from,
				to,
				speed: plan.speed,
				file: ringCaptureName(plan.namePrefix, plan.axis, dir, i),
				label: `${plan.axis}${dir === "p" ? "+" : "-"} ${plan.speed} mm/s (${i + 1}/${plan.repeats})`,
			});
			where = to;
		}
	}
	return passes;
}

function sweepPasses(plan: SweepPlan, origin: Point): Pass[] {
	const passes: Pass[] = [];
	let where = origin;
	for (const speed of plan.speeds) {
		for (const axis of PLANAR_AXES) {
			const to = along(plan.start, axis, plan.distMm);
			passes.push({
				at: where,
				from: plan.start,
				to,
				speed,
				file: sweepCaptureName(plan.namePrefix, axis, speed),
				label: `${axis}+ ${speed} mm/s`,
			});
			where = to;
		}
	}
	return passes;
}

/**
 * Every measured pass this plan makes, starting from `origin`.
 *
 * Total over the plan union with a `never` arm: a plan kind added without an
 * answer to "what does this do to the carriage" is a compile error rather than
 * a run that silently measures nothing.
 */
function passesFor(plan: Plan, origin: Point): readonly Pass[] {
	switch (plan.kind) {
		case "ring":
			return ringPasses(plan, origin);
		case "sweep":
			return sweepPasses(plan, origin);
		case "verify":
			// The shaper is applied by a step that does not move, so a verify run
			// traces exactly its ring.
			return ringPasses(plan.ring, origin);
		default: {
			const unhandled: never = plan;
			throw new Error(`unknown plan kind: ${String((unhandled as { kind: unknown }).kind)}`);
		}
	}
}

/**
 * One leg of a run, for the Capture card's XY map and for the file names it
 * states before arming.
 *
 * A UNION rather than a flag plus an optional name: the positioning leg is how
 * the carriage gets to the start and produces nothing, the capture leg is the
 * one the accelerometer is armed for and produces exactly one file. "Recorded,
 * but no file" and "a travel leg with a file name" are not states either half
 * of this feature can be in, so they are not states this type can say.
 *
 * The file name comes off the same `Pass` the M956 does — there is no second
 * spelling of a capture's name anywhere in the app, which is what lets the card
 * promise `t0_ring_Xp0.csv … t0_ring_Ym2.csv` and be right.
 */
export type PlannedSegment =
	| { readonly kind: "travel"; readonly from: Point; readonly to: Point; readonly label: string }
	| { readonly kind: "capture"; readonly from: Point; readonly to: Point; readonly label: string; readonly file: string };

/**
 * The polyline the carriage will trace, in send order, for a WHOLE armed run.
 *
 * A run is a LIST of plans — a measure run is a ring on X and a ring on Y — and
 * each plan starts wherever the one before left the carriage, so the chaining
 * belongs here rather than in a caller that would have to know a ring ends where
 * it began. Pass a one-element array for a single plan.
 *
 * Zero-length positioning legs are omitted. `captureStep` still emits that G1
 * (the firmware ignores a move to where it already is), but a segment with two
 * identical ends draws nothing and would still be counted in "N moves".
 *
 * PURE, and node-tested for its geometry: numbers in, numbers out, no clock, no
 * model, no machine. Derived from `passesFor`, which is what `stepsFor` builds
 * the commands from, so the map cannot draw a run different from the one that
 * would be sent.
 */
export function plannedSegments(plans: readonly Plan[], origin: Point): readonly PlannedSegment[] {
	const out: PlannedSegment[] = [];
	let where = origin;
	for (const plan of plans) {
		for (const pass of passesFor(plan, where)) {
			if (!samePoint(pass.at, pass.from)) {
				out.push({ kind: "travel", from: pass.at, to: pass.from, label: `travel to ${at(pass.from)}` });
			}
			out.push({ kind: "capture", from: pass.from, to: pass.to, label: pass.label, file: pass.file });
			where = pass.to;
		}
	}
	return out;
}

const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;

/**
 * One capture: position, settle, arm, excite, hold still for the recording.
 *
 * The order is the contract — the arm has to be queued before the move that
 * triggers it, and the wait has to be between the positioning move and the
 * arm, or the capture records the wrong ring. Both moves run at the plan's
 * speed; there is no separate travel feed to be a second number that means
 * "how fast the lab moves".
 *
 * The M956's sample count and the G4 that follows it come from ONE
 * `CaptureTiming`, and so does the budget the run loop waits for the file in.
 * That is the fix this whole module was reshaped for: those three used to be a
 * setting, a constant and another constant, and nothing related any of them to
 * the move between them.
 */
function captureStep(pass: Pass, addr: AccelAddr, timing: CaptureTiming): Step {
	const feed = feedOf(pass.speed);
	return {
		codes: [
			cmd.absolute(),
			cmd.moveTo(xy(pass.from), feed),
			cmd.waitMoves(),
			cmd.dwell(SETTLE_MS),
			cmd.accelCapture(addr, timing.samples, TRIGGER_ON_DECELERATION, pass.file),
			cmd.moveTo(xy(pass.to), feed),
			cmd.waitMoves(),
			cmd.dwell(timing.dwellMs),
		],
		capture: { file: pass.file, budgetMs: timing.budgetMs },
		label: pass.label,
		expectPosition: pass.at,
	};
}

/**
 * The commands, from the same passes the map draws and the timings `plan`
 * already accepted.
 *
 * It takes the timed passes rather than re-deriving them, so there is no second
 * call to `passesFor` that could be handed a different origin, and no second
 * `captureTiming` that could be handed a different rate.
 *
 * A verify plan prepends one step that does not move: it applies the candidate
 * shaper, so the ring that follows is measured with it live. Everything else is
 * the pass list, one capture step each.
 */
function stepsFor(plan: Plan, pre: Preconditions, timed: readonly TimedPass[]): readonly Step[] {
	const captures = timed.map((t) => captureStep(t.pass, pre.accel, t.timing));
	if (plan.kind !== "verify") return captures;
	return [
		{
			codes: [cmd.inputShaping(plan.spec)],
			label: `shaper ${plan.spec.type}`,
			expectPosition: pre.position,
		},
		...captures,
	];
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
	/** How long this capture may take to appear — carried on the watch rather
	 *  than passed alongside it, so `awaitCapture` cannot be called with a
	 *  budget belonging to a different capture, or with none. */
	readonly budgetMs: number;
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
async function beginWatch(conn: RunConnector, om: ObjectModel, accel: AccelAddr, expect: CaptureExpectation): Promise<CaptureWatch> {
	const before = await listCaptures(conn);
	return {
		file: expect.file,
		path: `${CAPTURE_DIR}/${expect.file}`,
		existedBefore: before === null || before.has(expect.file),
		runsBefore: accelerometerOf(om, accel)?.runs ?? null,
		accel,
		budgetMs: expect.budgetMs,
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
 *
 * The budget comes off the WATCH, which got it from the same `CaptureTiming`
 * that sized the M956. A flat budget was a false failure waiting for a longer
 * recording: at 5,700 samples the file legitimately cannot exist for 4.2 s, and
 * "no capture appeared" would have been reported for a run that was working.
 */
async function awaitCapture(conn: RunConnector, om: () => ObjectModel, watch: CaptureWatch, clock: Clock): Promise<CaptureOutcome> {
	const deadline = clock.now() + watch.budgetMs;
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
					: `no capture named ${watch.file} appeared in ${CAPTURE_DIR} within ${(watch.budgetMs / 1000).toFixed(1)} s`,
			};
		}
		await clock.sleep(CAPTURE_POLL_MS);
	}
}
