/**
 * Reading what G32 says it did.
 *
 * ── CRITICAL: the height map is NOT an input here. ───────────────────────────
 * A leadscrew-geometry fit uses G32 tram data ONLY: the probe points bed.g
 * visits, the corrections RRF applied, and the before/after flatness it
 * reports. The height map is probed AFTER everything is trammed and re-homed,
 * which makes it a measurement of the bed SURFACE (warp, texture, the plate
 * itself) on an already-levelled machine — a different physical quantity from
 * gantry tilt, and downstream of the very correction we are trying to solve
 * for. Feeding it in would conflate surface topology with pivot geometry and
 * quietly corrupt the fit. Nothing in this module or its consumers may read
 * heightmap.csv.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @invariant tram-fit-never-reads-the-map
 * @rung 4  static analysis — test/tram-fence.test.ts walks src/bed and fails on
 *          any import naming heightmap, by file and line. It fences the bed/
 *          modules only, not their UI consumers: BedCards legitimately renders
 *          the map and the tram controls on one screen, and what must never
 *          happen is map data reaching the fit's INPUT
 * @why the map is probed AFTER tramming and re-homing, so it measures the bed
 *      SURFACE — warp, texture, the plate — on an already-levelled machine.
 *      That is a different physical quantity from gantry tilt and is downstream
 *      of the correction being solved for. Mixing them does not fail: it yields
 *      plausible pivot positions the operator would enter as M671, and every
 *      tram after that is wrong with nothing to point at
 * @debt an import scan sees the obvious route, not a value handed in at a call
 *       site. Promote by giving the fit a branded TramSample its parser is the
 *       sole producer of, so map-derived numbers have no way to be passed in at
 *       all and the walk becomes unnecessary.
 *
 * bed.g (via G30 ... S<n>) makes RRF report one summary line per tram, e.g.
 *
 *   Leadscrew adjustments made: 0.086 0.082 0.090, points used 3,
 *   (mean, deviation) before (0.086, 0.003) after (-0.000, 0.000)
 *
 * That single line carries everything a leadscrew-geometry fit needs: how far
 * each screw was driven, how many points the fit used, and the flatness before
 * and after. Captured over several trams it becomes an over-determined system
 * for where the pivots ACTUALLY are (M671), which is the point of keeping it.
 *
 * Parsing is deliberately strict and returns null rather than guessing. RRF
 * emits other shapes for the same command — manual-adjustment prompts on a
 * screw-levelled bed, delta calibration summaries, plain errors — and a
 * half-understood line silently entering a geometry fit is worse than no
 * sample at all.
 *
 * The number of adjustments is NOT assumed to be three: M671 accepts 2 to 4
 * pivot points, and this machine's count must come from the line itself.
 *
 * ── A sample is only usable well ABOVE one full motor step. ──────────────────
 * Measured on this machine: Z/U/V/W run 6400 steps/mm at 64x microstepping,
 * non-interpolated, so one FULL step is 10um. Every correction in the trams
 * captured on 2026-07-23 was a fraction of that (0.1 to 0.7 of a step), and
 * below a full step a loaded leadscrew does not move proportionally to command
 * — detent torque and stiction dominate, so the bed can move further than
 * asked, or not at all, with unpredictable sign. Residual scatter of ~5um, half
 * a full step, is consistent with that rather than with probe noise.
 *
 * The consequence for any geometry fit: corrections at this amplitude carry
 * ACTUATOR behaviour, not pivot geometry, and cannot confirm or refute M671.
 * Usable samples need differential motion of many full steps (~0.2mm = 20
 * steps), which means deliberate single-screw excitation — bounded by the
 * probe-damage limit, so predict the far-side lift before moving.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface TramStats {
	/** Mean height error across the probed points, mm. */
	mean: number;
	/** Spread of those errors, mm — the flatness figure. */
	deviation: number;
}

export interface TramResult {
	/** Per-leadscrew correction in mm, in the order M671 declares the pivots. */
	adjustments: number[];
	/** How many probe points the fit used. */
	pointsUsed: number;
	before: TramStats;
	after: TramStats;
}

/** A signed decimal, allowing RRF's "-0.000". */
const NUM = String.raw`-?\d+(?:\.\d+)?`;

/**
 * Number(), with negative zero folded to zero.
 *
 * RRF really does report a perfect result as "-0.000", and Number() turns that
 * into -0. It arithmetically equals 0, but it is NOT Object.is-equal to it, it
 * serializes through JSON as "-0", and it renders as "-0.000". A stored tram
 * sample must not carry a value that compares unequal to the zero it means.
 */
const num = (text: string): number => {
	const value = Number(text);
	return value === 0 ? 0 : value;
};

const LINE = new RegExp(
	String.raw`Leadscrew adjustments made:\s*(${NUM}(?:\s+${NUM})*)\s*,` +
		String.raw`\s*points used\s*(\d+)\s*,` +
		String.raw`\s*\(mean,\s*deviation\)` +
		String.raw`\s*before\s*\(\s*(${NUM})\s*,\s*(${NUM})\s*\)` +
		String.raw`\s*after\s*\(\s*(${NUM})\s*,\s*(${NUM})\s*\)`,
	"i",
);

export function parseTramReply(reply: string): TramResult | null {
	const m = LINE.exec(reply);
	if (m === null) return null;
	const adjustments = m[1]!.trim().split(/\s+/).map(num);
	// A pivot count outside M671's own 2..4 means the line was not what we think
	// it was; refuse it rather than feed a nonsense row into the fit.
	if (adjustments.length < 2 || adjustments.length > 4) return null;
	if (adjustments.some(v => !Number.isFinite(v))) return null;
	return {
		adjustments,
		pointsUsed: Number(m[2]),
		before: { mean: num(m[3]!), deviation: num(m[4]!) },
		after: { mean: num(m[5]!), deviation: num(m[6]!) },
	};
}

/**
 * How much a tram TILTED the bed, as opposed to simply raising it.
 *
 * This is the number that decides whether a sample is worth anything to a
 * geometry fit. Pivot positions only reveal themselves through DIFFERENTIAL
 * screw motion: if every screw moves the same distance the bed is translated,
 * not tilted, and the sample says nothing about where the screws are — however
 * large the adjustments were. Measured on Gabe's machine, a well-trammed bed
 * gave 0.086/0.082/0.090, a spread of 8µm, which is at probe-noise level.
 */
export function tiltSpan(result: TramResult): number {
	return Math.max(...result.adjustments) - Math.min(...result.adjustments);
}
