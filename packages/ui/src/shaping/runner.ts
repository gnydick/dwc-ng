/**
 * The Capture card's run: read the machine, plan, send, collect, restore, fit.
 *
 * Its own module rather than a closure inside the card body, for the reason
 * every pure half of this feature is its own module — this is the one function
 * in the UI that puts a moving machine and a browser in a loop together, and
 * it has to be readable end to end without a JSX file around it. It is also
 * DOM-free: it takes a connector, a model reader, an engine and a reporter, so
 * node can drive it against the same fake board the procedure tests use.
 *
 * It sends nothing itself. `Procedure.run` is the only route to the machine
 * (`shaping/procedure.ts`, `shaping-motion-only-via-procedure`) and its
 * commands are `#`-private, so this file cannot obtain a `GcodeCommand` to send
 * even if it tried. What it does is decide WHICH plans to run, in what order,
 * and what to say about what came back.
 *
 * @invariant every-leg-is-gated-on-its-own-fresh-reading
 * @rung 7  sole-constructor type, borrowed — a leg cannot be run without a
 *          `Procedure`, a `Procedure` cannot be built without a
 *          `Preconditions`, and a `Preconditions` cannot be built except by
 *          `read` over an object model taken at that moment. `runMotion` calls
 *          `read` inside the loop, once per plan, so the second ring of a
 *          measure run is gated on the machine as it is AFTER the first ring
 *          moved it — not on a reading taken before either. There is no way to
 *          express "plan both now, run both later": `planProcedure` refuses a
 *          reading older than two seconds as `stale`
 * @why a measure run is two rings that take a minute between them. A single
 *      reading at the top would authorise the second ring on the machine's
 *      state a minute ago — the exact window `Preconditions` exists to close,
 *      reopened by the loop that uses it
 *
 * @invariant the-state-to-restore-is-read-once-per-run
 * @rung 6  choke-point — `Procedure.plan` takes a `RunPrior`
 *          (shaping/preconditions.ts), a branded type whose only producer is
 *          `runPriorOf`; a mid-run `Preconditions` is no longer a well-typed
 *          thing to pass into that slot, which it was while the parameter was a
 *          bare `Shaping`. This file mints exactly one, from a reading taken
 *          ABOVE the loop, before any code has gone out. The two invariants
 *          above and here pull in opposite directions on purpose and both are
 *          right: what AUTHORISES a leg must be as fresh as possible, and what
 *          the run PUTS BACK must be as old as the run
 * @why every leg's reading takes the shaper AND the mounted tool from the
 *      polled object model, and the run's own codes change both. Leg 1 states
 *      its shaper and picks up its head; the poll catches up during leg 1's
 *      captures; leg 2's fresh reading returns both of those as the machine's
 *      "prior". Restoring to it leaves a baseline run with shaping switched
 *      off, a verify run with the unproven candidate still installed, and —
 *      since #51 — the measured head still on the carriage, all under a screen
 *      that says the machine is back as it was found
 * @debt the brand fixes WHICH reading may become a prior, not HOW MANY: nothing
 *       stops a second `runPriorOf` inside the loop. Promote by making the run
 *       itself the producer — a handle minted from the opening reading that
 *       hands out procedures — so a second prior has no expression rather than
 *       merely no call site
 */
import type { ConnectorReads, ConnectorWrites } from "@dwc-ng/connector";
import type { ShapingConfig } from "../config/types.ts";
import type { ObjectModel } from "../om/types.ts";
import type { AccelAddr } from "../control/commands.ts";
import { captureNameParts } from "./captures.ts";
import type { Axis, Mode, NoFit } from "./engine/fit.ts";
import type { Seconds } from "./engine/units.ts";
import type { MotionOutcome, MotionState } from "./motionRun.ts";
import { Preconditions, runPriorOf, type RunPrior } from "./preconditions.ts";
import { conditionsOf, planProcedure, readSampleRate, type Plan, type ProcEvent, type SampleRate } from "./procedure.ts";
import type { Conditions } from "./evidence/evidence.ts";
import type { CaptureRecord } from "./results.ts";
import { plannedCaptureCount, runPlans, type RunKind, type RunRequest } from "./runPlan.ts";

/** Everything a run needs from the outside world. A slice of the real
 *  interfaces, so the app hands over its connector directly. */
export type RunnerConnector = Pick<ConnectorReads, "list" | "download"> & Pick<ConnectorWrites, "sendCode">;

/** One capture, as it came off the board: the name M956 wrote and the bytes. */
export type RawCapture = { readonly file: string; readonly csv: string };

export type RunDeps = {
	readonly conn: RunnerConnector;
	/** Called FRESH before every reading and every step — the whole point of the
	 *  position check is to see what the machine is doing now. */
	readonly om: () => ObjectModel;
	readonly cfg: () => ShapingConfig;
	readonly accel: AccelAddr;
	/**
	 * The head this run is FOR — what it picks up, what it gives back, and what
	 * its captures are filed against.
	 *
	 * An argument rather than something derived here, because there is exactly
	 * one answer on the screen (`svc.tool()`, compose/services.ts) and every
	 * other thing this run is given is already derived from it: `accel` is
	 * `accelFor(tool)` and `prefix` is `t<n>_ring`. A second reading in here
	 * would be a second chance for the tool that was measured and the tool the
	 * sensor belongs to to disagree.
	 */
	readonly tool: number;
	readonly prefix: string;
	/** The one writer of the screen's motion slot (compose/services.ts). */
	readonly report: (state: MotionState) => void;
	readonly signal: AbortSignal;
	/** Test seams, forwarded to `Procedure.run` and used nowhere else. The
	 *  capture wait polls on a clock; without both halves a test would either
	 *  sleep for the real ten-second budget or never reach it. Neither can skip
	 *  the restore — the `finally` does not consult them. */
	readonly now?: () => number;
	readonly sleep?: (ms: number) => Promise<void>;
};

/** What a finished run leaves for the caller to do something with. */
export type RunResult = {
	readonly kind: RunKind;
	readonly captures: readonly RawCapture[];
	readonly outcome: MotionOutcome;
	/**
	 * The machine state these captures were taken under, for the fingerprint
	 * they will become. Null in exactly two cases, and neither of them ends in
	 * a fingerprint: a run refused before its first leg was ever planned (which
	 * captures nothing), and a sweep, whose captures are a family on the Sweep
	 * card and are never aggregated (`conditionsOf` says why).
	 *
	 * Taken from the FIRST leg that planned. A measure run is one ring per
	 * planar axis out of one `measurePlans` call, so both legs carry the same
	 * distance, speed and repeats by construction, and the acceleration is read
	 * once per leg from a machine that only this run is sending G-code to. What
	 * would make the two legs differ is the operator editing Settings mid-run —
	 * and the honest record of what these captures were taken under is what the
	 * run was ARMED with, not what the box said afterwards.
	 */
	readonly conditions: Conditions | null;
	/** Was anything sent to the machine at all? False for a refusal. */
	readonly touched: boolean;
	readonly restored: boolean;
};

/**
 * Run every plan of one kind, in order, each from its own fresh reading.
 *
 * Stops at the first leg that refuses or fails: a measure run whose X ring
 * ended with the carriage somewhere unexpected has no business starting the Y
 * ring, and a machine that went not-idle between the two is telling us
 * something. What has already been captured is kept and returned — eight good
 * captures are eight good captures, and discarding them because the ninth
 * failed would throw away a minute of machine time for tidiness.
 */
export async function runMotion(req: RunRequest, deps: RunDeps): Promise<RunResult> {
	const kind: RunKind = req.kind;
	const captures: RawCapture[] = [];
	/** Has ANYTHING been sent to the machine? A refusal sends nothing, and the
	 *  report must not discuss the machine's shaper after one. */
	let touched = false;
	let restored = false;
	let outcome: MotionOutcome = { kind: "done" };
	let expected = 0;
	let stepsDone = 0;
	let totalSteps = 0;
	/**
	 * What the first planned leg was taken under. See `RunResult.conditions`.
	 *
	 * Declared up here with the other tallies rather than beside the loop that
	 * fills it, because `finish` reads it and `finish` is called from the
	 * envelope refusal above the loop — a `let` further down is in its temporal
	 * dead zone there, which turns a clean "no envelope" refusal into a thrown
	 * ReferenceError.
	 */
	let conditions: Conditions | null = null;

	deps.report({ kind: "planning", run: kind });

	const envelope = deps.cfg().envelope;
	if (envelope === null) {
		// The refusal `Preconditions.read` would give, reached one step earlier
		// because a run cannot even be PLANNED without a box to centre it in.
		// Same variant, so the operator reads the same sentence either way.
		return finish({ kind: "refused", refusal: { kind: "no-envelope" } });
	}

	const plans = runPlans(req, deps.cfg().defaults, envelope, deps.prefix);
	expected = plannedCaptureCount(plans);

	/**
	 * What the machine was holding before this run sent anything — the shaper
	 * AND the head — minted ONCE, here, above the loop.
	 *
	 * Its own reading, taken before the first leg's, and that placement is the
	 * mechanism: every later reading is of a machine this run has been writing
	 * to, so there is no point inside the loop at which "what was here before?"
	 * can still be answered. A refusal here is the refusal the first leg would
	 * have given anyway, reached one step earlier and reported identically.
	 */
	const opening = Preconditions.read(deps.om(), deps.cfg(), deps.accel, Date.now());
	if (!opening.ok) return finish({ kind: "refused", refusal: opening.refusal });
	const runPrior: RunPrior = runPriorOf(opening.pre, deps.tool);

	totalSteps = totalStepsOf(plans, runPrior);

	/**
	 * The board's accelerometer sampling rate: ONE M955 per run, read the first
	 * time a leg is about to be planned and reused for the rest.
	 *
	 * The rate is what turns a capture's length in seconds into M956's S, and
	 * M955's S setting PERSISTS on the board, so what is in force is whatever
	 * somebody last configured rather than anything this UI chose. Once per run
	 * and not per leg because nothing can change it while the run holds the
	 * machine — a run is the only thing sending G-code — and emphatically not per
	 * POLL, because the screen's gate (compose/services.ts) calls
	 * `Preconditions.read` on every status cycle and RRF's HTTP server does not
	 * have the requests to spare.
	 *
	 * It is a REPORT and not a write: `cmd.accelConfig` sends P alone, which M955
	 * documents as asking rather than setting, so reading the rate cannot change
	 * it. It is nevertheless read AFTER the machine's own refusals, so a run that
	 * is refused — busy, unhomed, parked outside the box — still sends nothing at
	 * all.
	 */
	let rate: SampleRate | null = null;

	for (const plan of plans) {
		if (deps.signal.aborted) return finish({ kind: "cancelled" });

		// FRESH, per leg. See the invariant at the top of this file.
		const read = Preconditions.read(deps.om(), deps.cfg(), deps.accel, Date.now());
		if (!read.ok) return finish({ kind: "refused", refusal: read.refusal });

		if (rate === null) {
			rate = await readSampleRate(deps.conn, deps.accel);
			if (rate === null) return finish({ kind: "refused", refusal: { kind: "no-sample-rate" } });
		}

		const planned = planProcedure(plan, read.pre, deps.cfg(), Date.now(), rate, runPrior);
		if (!planned.ok) return finish({ kind: "refused", refusal: planned.refusal });

		// After the plan was ACCEPTED, so a refused run records nothing about a
		// state it never reached. A null acceleration records nothing rather
		// than a stand-in: `planProcedure` refuses `no-acceleration` before it
		// returns ok, so this branch is unreachable today — and if a future
		// plan kind makes it reachable, "no conditions" is the answer that
		// cannot be compared and mislead, while a zero is one that can.
		const planAccel = read.pre.travelAccel;
		if (conditions === null && planAccel !== null) conditions = conditionsOf(plan, planAccel);

		let failed: string | null = null;
		// `for await` and not `.next()` in a while loop: a `break` out of this
		// calls the generator's `return`, which runs the `finally` that sends the
		// restore. Driving the generator by hand is where that guarantee is lost.
		for await (const ev of planned.proc.run(deps.conn, deps.om, { signal: deps.signal, now: deps.now, sleep: deps.sleep })) {
			const problem = handle(ev);
			if (problem !== null) failed = problem;
		}
		if (failed !== null) return finish({ kind: "failed", why: failed });
		if (deps.signal.aborted) return finish({ kind: "cancelled" });
	}

	return finish({ kind: "done" });

	/** The ONE exit. Every return above goes through here, so no path can end a
	 *  run without reporting the tally, whether the machine was touched, and
	 *  whether the shaper went back. */
	function finish(how: MotionOutcome): RunResult {
		outcome = how;
		deps.report({
			kind: "ended",
			run: kind,
			outcome,
			captured: captures.length,
			expected,
			touched,
			restored,
		});
		return { kind, captures, outcome, conditions, touched, restored };
	}

	/** One event. Returns the failure sentence when this was one, else null. */
	function handle(ev: ProcEvent): string | null {
		switch (ev.kind) {
			case "step":
				touched = true;
				stepsDone += 1;
				deps.report({
					kind: "running",
					run: kind,
					step: stepsDone,
					steps: totalSteps,
					label: ev.label,
					captured: captures.length,
					expected,
				});
				return null;
			case "capture":
				captures.push({ file: ev.file, csv: ev.csv });
				deps.report({
					kind: "running",
					run: kind,
					step: stepsDone,
					steps: totalSteps,
					label: ev.file,
					captured: captures.length,
					expected,
				});
				return null;
			case "restored":
				restored = true;
				return null;
			case "done":
				deps.report({ kind: "restoring", run: kind, captured: captures.length, expected });
				return null;
			case "failed":
				// Reported as it arrives rather than only at the end: the run's own
				// sentence distinguishes a board that finished a capture and could
				// not write the file from one that never captured at all, and the
				// operator should see which the moment it is known.
				deps.report({ kind: "restoring", run: kind, captured: captures.length, expected });
				return ev.error;
			default: {
				const unhandled: never = ev;
				throw new Error(`unknown procedure event: ${String((unhandled as { kind: unknown }).kind)}`);
			}
		}
	}
}

/**
 * How many steps the whole run has, for the progress bar's denominator.
 *
 * Captures plus, on a verify run, the one step that applies the shaper. Derived
 * from `plannedCaptureCount` rather than counted a second way, so the bar's
 * denominator and the button's promise are the same arithmetic.
 */
function totalStepsOf(plans: readonly Plan[], prior: RunPrior): number {
	// EVERY plan prepends exactly one step, whatever the run: `stepsFor` states
	// the shaper before it records anything (#53), and a verify plan states its
	// candidate where a ring and a sweep state `none`. So the total is one per
	// leg on top of the captures — `plans.length`, not a constant, because a
	// measure run is two legs and a sweep is one.
	//
	// It used to read `plannedCaptureCount(plans)` alone, under a comment
	// saying neither run prepends a step. That stopped being true the moment a
	// baseline had to disable shaping, and the bar went to "6 of 4": nothing
	// clamps `state.step / state.steps` (motionRun.ts), so the fraction ran
	// past 1.
	//
	// #51 added a SECOND prepended step, and only sometimes: a leg picks the
	// tool up when the run's head is not the one on the carriage. The condition
	// is `runPrior`'s and not any leg's reading, which is exactly why it can be
	// counted up front — the prior is fixed for the whole run, so every leg
	// makes the same decision and the denominator is exact rather than a guess
	// that the bar would then run past.
	const perLeg = prior.tool === prior.mountedTool ? 1 : 2;
	return plans.length * perLeg + plannedCaptureCount(plans);
}

/**
 * Fit what a run recorded, and say how far it has got while it does.
 *
 * Every capture reaches the engine by the same route an imported CSV or a
 * browsed board file does — `parseCapture` → `detectStop` → `fitDecay` in the
 * worker — so a number produced here is one this UI computed from those bytes,
 * not something the run claimed about itself.
 *
 * Fitting happens AFTER the machine has finished rather than between steps: an
 * FFT in the middle of a run would hold the carriage still while the browser
 * thought, and the whole point of the ring-down dwell is that the machine's
 * timing is the one thing this loop must not add to.
 *
 * A file the fitter declines still gets a record carrying its `NoFit`.
 * `aggregate` takes the median of the fits that succeeded, so a rejected
 * capture is excluded from the numbers and present in the file — which is what
 * lets the batch summary say how many of how many contributed.
 */
export async function fitCapturesOf(
	captures: readonly RawCapture[],
	fit: (csv: string, axis: Axis) => Promise<{ readonly fit: Mode | NoFit; readonly tStop: Seconds | null }>,
	onProgress: (done: number, total: number) => void,
	remember?: (file: string, csv: string, result: Mode | NoFit) => void,
): Promise<readonly CaptureRecord[]> {
	const records: CaptureRecord[] = [];
	for (const [index, capture] of captures.entries()) {
		onProgress(index, captures.length);
		const parts = captureNameParts(capture.file);
		const result = await fit(capture.csv, parts.axis);
		records.push({
			file: capture.file,
			axis: parts.axis,
			dir: parts.dir,
			rep: parts.rep,
			fit: result.fit,
			tStop: result.tStop,
		});
		remember?.(capture.file, capture.csv, result.fit);
	}
	return records;
}
