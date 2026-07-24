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
