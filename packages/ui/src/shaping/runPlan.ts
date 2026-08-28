/**
 * What a Measure and a Sweep run ARE, as plans — the arithmetic that turns four
 * settings and a box into the list of `Plan`s one armed confirm executes.
 *
 * Pure and DOM-free, so node can check the geometry and the speed ladder
 * without a browser and without a machine. Nothing here decides whether the
 * machine may move: `Preconditions.read` and `planProcedure` are the
 * authorities, and every point this module chooses is handed to them to accept
 * or refuse like any other.
 *
 * WHY THE RUN IS CENTRED IN THE ENVELOPE. A ring needs a start and there are
 * only two honest places to get one: where the carriage happens to be, or the
 * box the operator drew. The first makes the same button do a different thing
 * every time — and it fails with `plan-leaves-envelope` whenever the head was
 * parked near an edge, which on a toolchanger is where it usually is. The
 * second is the same run every time, as far from the frame as the box allows,
 * and the one number it can fail on is a move longer than the box — which is a
 * refusal worth having, naming the corner that would have left it.
 *
 * @invariant a-run-is-planned-from-the-box-not-from-the-carriage
 * @rung 6  choke-point — `runPlans` is the only producer of a `Plan` for the
 *          Capture card, and it takes the envelope as an argument rather than
 *          reading config for itself, so the preview the operator approves and
 *          the plan the confirm builds are the same function of the same box.
 *          The one thing that could differ between them is the box itself, and
 *          `planProcedure` refuses `stale` when the envelope changed between
 *          the reading and the plan
 * @why the map on the card is a promise about where the carriage will go. A
 *      second arithmetic for "where does this run start" — one for the drawing,
 *      one for the moving — is a promise that can be broken silently
 */
import type { ShaperSpec } from "./engine/shapers.ts";
import type { Envelope, ShapingDefaults } from "../config/types.ts";
import { mm, mmPerS } from "./engine/units.ts";
import type { Point } from "./preconditions.ts";
import type { Plan, RingPlan, SweepPlan } from "./procedure.ts";
import { PLANAR_AXES, planStart } from "./procedure.ts";

/** The two runs this card owns. Verify is work item G's, on its own card. */
export type RunKind = "measure" | "sweep" | "verify";

/**
 * The runs an operator picks between on the Capture card.
 *
 * `verify` is deliberately NOT here. It is not a run you choose and then
 * configure — it is "re-measure with THAT shaper on", and which shaper is the
 * whole content of the request. It is offered from the Candidates and status
 * cards, where a candidate is selected, and reaches this module as a
 * `RunRequest` that cannot be built without one.
 */
export const RUN_KINDS: readonly RunKind[] = ["measure", "sweep"];

/**
 * A run, with whatever that run needs to be planned.
 *
 * A union rather than `(kind, spec?)`, because a verify with no shaper is not a
 * run that fails — it is a run that would silently re-measure the baseline and
 * file the result as a verification of something. There is no spelling for it
 * here: the spec lives in the verify arm and nowhere else.
 *
 * @invariant a-verify-run-names-the-shaper-it-installs
 * @rung 8  illegal state unrepresentable — `runPlans` takes this union, so a
 *          caller cannot ask for a verify without saying of what
 * @why a verify with no shaper is not a run that fails, it is a run that
 *      succeeds at the wrong thing: it re-measures the baseline and files the
 *      result as a verification of a candidate. The operator then reads a
 *      shaper as proved on hardware when nothing was installed for the
 *      measurement, which is the one claim this whole step exists to make
 */
export type RunRequest =
	| { readonly kind: "measure" }
	| { readonly kind: "sweep" }
	| { readonly kind: "verify"; readonly spec: ShaperSpec };

/**
 * How many speeds a sweep ladder holds.
 *
 * Eight because a sweep answers ONE question — does this peak move when the
 * carriage goes faster — and eight points spread over a 8:1 speed range put
 * roughly one every third of an octave, which is enough to tell a ridge that
 * climbs from a stripe that does not. Every point costs a settle, a move and a
 * ring-down on both axes, so sixteen captures is already a minute of machine
 * time; doubling the resolution would double that for a picture that answers
 * the same question.
 */
export const SWEEP_POINTS = 8;

/**
 * The speeds a sweep runs, from `top / SWEEP_POINTS` up to `top`, spaced
 * geometrically.
 *
 * Geometric rather than linear because the thing being looked for — the motors'
 * full-step rate, speed × steps/mm — is a straight line through the origin in
 * (speed, Hz), so equal RATIOS of speed give equal spacing along it. A linear
 * ladder spends half its captures in the top octave where the line has already
 * left the interesting band.
 *
 * WHOLE NUMBERS, DISTINCT, ASCENDING, and that is a contract rather than
 * tidiness: each speed becomes a capture file named `<prefix>_<axis>_<speed>.csv`
 * and `speedFamilies` only recognises whole numbers, so a fractional speed would
 * leave a file the Sweep card cannot collect and two speeds that rounded
 * together would be two captures under one name — which is one capture.
 *
 * Total: a top speed that is not a positive finite number yields an empty
 * ladder, which `planProcedure` refuses as `not-measurable` before anything
 * moves. It never throws and never invents a speed.
 */
export function sweepLadder(top: number, points: number = SWEEP_POINTS): readonly number[] {
	if (!Number.isFinite(top) || top <= 0) return [];
	const n = Math.max(1, Math.trunc(points));
	if (n === 1) return [Math.max(1, Math.round(top))];
	const low = top / n;
	const ratio = (top / low) ** (1 / (n - 1));
	const out: number[] = [];
	for (let i = 0; i < n; i++) {
		const speed = Math.round(low * ratio ** i);
		// Below 1 mm/s there is no whole number left to name the file with, and
		// a "0 mm/s" capture is a move that never happens.
		if (speed >= 1 && !out.includes(speed)) out.push(speed);
	}
	// The top speed is the one the operator actually set, so it is present even
	// when the rounding above happened to miss it.
	const topWhole = Math.max(1, Math.round(top));
	if (!out.includes(topWhole)) out.push(topWhole);
	return out.sort((a, b) => a - b);
}

/** The middle of a range. */
const midpoint = (range: readonly [number, number]): number => (range[0] + range[1]) / 2;

/**
 * The point a `dist`-long move along `axis` starts from if it is to be centred
 * on the box in that axis, with the other coordinate at the box's middle.
 *
 * A move longer than the box lands outside it, which is exactly what should
 * happen: `planProcedure` refuses it and names the corner, rather than this
 * module quietly shortening a run the operator asked for.
 */
function centredStart(env: Envelope, axis: "X" | "Y", dist: number): Point {
	const cx = midpoint(env.x);
	const cy = midpoint(env.y);
	return axis === "X"
		? { x: mm(cx - dist / 2), y: mm(cy) }
		: { x: mm(cx), y: mm(cy - dist / 2) };
}

/**
 * A measure run: one ring per planar axis, both centred on the box.
 *
 * Two plans rather than one, because a `Plan` describes one axis and a
 * fingerprint needs both. They run back to back, each from its own fresh
 * reading of the machine — see the runner — so the second is gated on the state
 * the first left behind rather than on a reading taken before either moved.
 *
 * The X ring and the Y ring cross at the middle of the box, which is what the
 * map draws: the operator sees a cross, and a cross is what the machine makes.
 */
export function measurePlans(defaults: ShapingDefaults, env: Envelope, prefix: string): readonly RingPlan[] {
	return PLANAR_AXES.map((axis): RingPlan => ({
		kind: "ring",
		axis,
		start: centredStart(env, axis, defaults.distMm),
		distMm: mm(defaults.distMm),
		speed: mmPerS(defaults.speedMmS),
		repeats: defaults.repeats,
		namePrefix: prefix,
	}));
}

/**
 * A sweep run: the same L on both axes, once per speed on the ladder.
 *
 * ONE plan, unlike a measure run, because `SweepPlan` already carries both axes
 * from a shared origin — that is what makes its two legs an L rather than two
 * independent moves, and the L's corner is where every leg starts.
 *
 * The corner sits half a move below the middle in BOTH axes, so each leg is
 * centred on its own axis and the whole L is centred on the box.
 */
export function sweepPlans(defaults: ShapingDefaults, env: Envelope, prefix: string): readonly SweepPlan[] {
	const dist = defaults.distMm;
	const start: Point = { x: mm(midpoint(env.x) - dist / 2), y: mm(midpoint(env.y) - dist / 2) };
	return [{
		kind: "sweep",
		start,
		distMm: mm(dist),
		speeds: sweepLadder(defaults.speedMmS).map(mmPerS),
		namePrefix: prefix,
	}];
}

/**
 * The plans one armed confirm executes, for either run.
 *
 * Total over `RunKind` with a `never` arm: a third run added without an answer
 * to "what does it plan" is a compile error, not a button that arms and does
 * nothing.
 */
export function runPlans(req: RunRequest, defaults: ShapingDefaults, env: Envelope, prefix: string): readonly Plan[] {
	switch (req.kind) {
		case "measure":
			return measurePlans(defaults, env, prefix);
		case "sweep":
			return sweepPlans(defaults, env, prefix);
		case "verify": {
			// The SAME ring the baseline was measured with, wrapped so the
			// procedure installs the shaper first. Same distance, same speed,
			// same repeats: a verify measured differently from its baseline is
			// a comparison of two things, and the ratio it produces would be
			// meaningless.
			const rings = measurePlans(defaults, env, prefix);
			return rings.map((ring) => {
				if (ring.kind !== "ring") throw new Error("a measure plan must be a ring");
				return { kind: "verify", spec: req.spec, ring } as const;
			});
		}
		default: {
			const unhandled: never = req;
			throw new Error(`unknown run kind: ${String((unhandled as { kind: unknown }).kind)}`);
		}
	}
}

/**
 * How many captures a set of plans will produce.
 *
 * Counted from the plans themselves rather than from the settings that built
 * them, so the number on the button is the number of files that will appear.
 * The status card's "Measure T0 — 12 captures" and this are the same arithmetic
 * for the same reason `measureCaptureCount` exists: a figure an operator gives
 * consent against has to be the real one.
 */
export function plannedCaptureCount(plans: readonly Plan[]): number {
	let n = 0;
	for (const plan of plans) {
		switch (plan.kind) {
			case "ring":
				n += plan.repeats * 2;
				break;
			case "sweep":
				n += plan.speeds.length * PLANAR_AXES.length;
				break;
			case "verify":
				n += plan.ring.repeats * 2;
				break;
			default: {
				const unhandled: never = plan;
				throw new Error(`unknown plan kind: ${String((unhandled as { kind: unknown }).kind)}`);
			}
		}
	}
	return n;
}

/** The most characters a run's name may carry into a capture file name. Long
 *  enough for `t0_ring_2026` and short enough that `<prefix>_X_100.csv` stays a
 *  name a person can read in a 60-row listing. */
export const MAX_PREFIX = 24;

/**
 * The operator's name for this run, reduced to what may appear in a file name.
 *
 * Everything outside `[A-Za-z0-9_-]` goes, because the prefix reaches the board
 * inside `M956 F"..."` and RRF resolves that against `0:/sys/accelerometer`. A
 * name carrying a slash would write somewhere else on the card and a name
 * carrying a quote would end the parameter early; neither is a thing an
 * operator means by typing it.
 *
 * A prefix that empties out falls back rather than failing: naming a run is a
 * convenience, and refusing to move because a name was all punctuation would be
 * a refusal about nothing.
 */
export function safePrefix(text: string, fallback: string): string {
	const kept = text.replace(/[^A-Za-z0-9_-]/g, "").slice(0, MAX_PREFIX);
	return kept === "" ? fallback : kept;
}

/** What a run is called when the operator has not renamed it: the tool it is
 *  about, then what it is. On a four-head machine the tool number in the name
 *  is the only thing that keeps T1's captures from overwriting T0's. */
export function defaultPrefix(kind: RunKind, tool: number): string {
	// Total over RunKind with a never arm, and it was NOT before: the old
	// ternary said "sweep" or "ring", so `verify` silently took the ring's
	// name. That is not a cosmetic default — captures are written as
	// `<prefix>_<axis><dir><rep>.csv`, so a verify run would have overwritten
	// the tool's BASELINE captures file for file, on the card, with the ring of
	// a shaped machine. The baseline would then have been unrecoverable and
	// would still have looked like a baseline.
	switch (kind) {
		case "sweep":
			return safePrefix(`t${tool}_sweep`, "sweep");
		case "verify":
			return safePrefix(`t${tool}_verify`, "verify");
		case "measure":
			return safePrefix(`t${tool}_ring`, "ring");
		default: {
			const unhandled: never = kind;
			throw new Error(`unknown run kind: ${String(unhandled)}`);
		}
	}
}

/**
 * Where the FIRST plan of a run starts.
 *
 * The Capture card draws its preview from this rather than from the carriage's
 * live position, and that is what makes the drawing stable: the polyline then
 * depends only on the settings and the box, so it is rebuilt when the operator
 * edits one and never on a poll. Where the carriage actually is is drawn as its
 * own marker — here is the plan, here is you — which is also the honest
 * separation, since the run re-reads the machine at confirm time anyway.
 *
 * Total over the plan union; null only for an empty run.
 */
export function runOrigin(plans: readonly Plan[]): Point | null {
	const first = plans[0];
	// `planStart` and not a switch of its own: the tool step commands an
	// approach to exactly this point (#51), and a second derivation of "where
	// does this run start" would let the map promise one place and the machine
	// go to another.
	return first === undefined ? null : planStart(first);
}

/** The first and last file a run will write, for the card to state before it
 *  arms. Both, because the pair says the convention AND the extent — one name
 *  alone leaves "and eleven more like it" to the imagination. */
export function captureNameRange(files: readonly string[]): { readonly first: string; readonly last: string } | null {
	if (files.length === 0) return null;
	return { first: files[0]!, last: files[files.length - 1]! };
}

/** The extent of a box, for the map's caption. */
export const envelopeText = (env: Envelope): string =>
	`X ${env.x[0]}–${env.x[1]} · Y ${env.y[0]}–${env.y[1]} mm`;
