// Speed × frequency picture of constant-velocity moves, so the user can see
// forced vibration (lines that follow speed, e.g. the full-step rate) apart
// from ringing (fixed frequencies). Shaping can only touch the latter.

import { LEAD_IN_S, type Capture } from "./capture.ts";
import { amplitudeSpectrum } from "./spectrum.ts";
import { hz, type Hz, type MmPerS, type Seconds } from "./units.ts";

export type SweepRow = { readonly speed: MmPerS; readonly capture: Capture; readonly moveS: Seconds; readonly axis?: 0 | 1 | 2 };

export type SweepMatrix = {
	readonly speeds: readonly MmPerS[];
	/** Bin centres, 1 Hz apart from 0 to maxHz. */
	readonly freqs: Float64Array;
	/** speeds.length × freqs.length amplitudes in g (row-major). */
	readonly amps: Float64Array;
	/** Full-step excitation frequency per speed: speed × fullStepsPerMm. */
	readonly fullStepHz: readonly Hz[];
	readonly maxHz: number;
};

/**
 * The samples of a constant-velocity capture that are actually cruise:
 * 10 %..90 % of the move, offset to where the move IS, and clipped to the
 * record.
 *
 * ANCHORED TO THE MOVE, NOT TO SAMPLE 0. The record starts when `M956`
 * executes; the carriage does not start until the `G1` behind it does, and the
 * gap between the two is {@link LEAD_IN_S}. A head margin measured from the
 * first sample is therefore a margin into the wrong thing. The old
 * `0.1 * moveS` cleared that gap only while `0.1 * moveS > LEAD_IN_S` — moves
 * longer than 1.2 s, which is `distMm / 1.2` in speed: 50 mm/s at the 60 mm
 * default (config/types.ts `shaping.defaults.distMm`), ~83 mm/s if someone
 * configures 100 mm. Everything ABOVE that opened its window before the
 * carriage moved and then ran straight through the acceleration ramp, diluting
 * the cruise spectrum with silence and contaminating it with a broadband
 * transient — at exactly the speeds whose forcing frequencies the chart is read
 * for, and for five of the eight rows of the standard ladder.
 *
 * Measured on tools/accel/runs/ui-first-run-2026-08-23 (60 mm, 6000 mm/s^2,
 * first motion 0.090-0.108 s across the ladder):
 *
 *   speed   old window     first motion   real cruise
 *   200     0.030..0.270   0.091          0.124..0.358
 *   149     0.040..0.363   0.096          0.121..0.474
 *   110     0.054..0.491   0.097          0.115..0.624
 *    82     0.074..0.659   0.097          0.110..0.815
 *
 * At 200 mm/s that is 0.094 s of the 0.240 s window — 39 % of it — spent on
 * silence and ramp, with a further 0.088 s of real cruise left unread past the
 * far end.
 *
 * THE TWO ENDS TAKE THE CORRECTION DIFFERENTLY, and that is the point.
 * `LEAD_IN_S` is an over-estimate on purpose, and an over-estimate is safe in
 * one direction only. Added to `from` it pushes the head LATER, away from the
 * silence and the ramp — the safe way. Added to `to` it would push the tail
 * later, INTO the deceleration: at 200 mm/s `0.12 + 0.9 * 0.3` = 0.390 s
 * against a decel that begins at 0.358 s, which is the same contamination
 * merely moved to the other end of the window. So `to` stays measured from
 * sample 0, where the lead-in it does not carry is already acting as its
 * margin.
 *
 * WHY A CONSTANT AND NOT A MEASUREMENT. First motion is findable in the data —
 * {@link detectStop} runs the same boxcar the other way — but not robustly. At
 * the settings this repo already trusts (0.25 g over 12 ms) it finds the start
 * in 12 of the 16 sweep captures and misses both 25 mm/s and both 34 mm/s
 * passes, because the ramp lasts `speed / accel` (4 ms at 25 mm/s over
 * 6000 mm/s^2) and a 0.61 g pulse that short averages to 0.21 g inside a 12 ms
 * window. Loosening to 0.10 g over 6 ms finds all 16 — and the same settings on
 * the older `test/fixtures/shaping/baseline_X_*` captures fire at 0.005 s,
 * 0.012 s and 0.028 s, which is the noise floor and not the carriage. Both
 * failure modes are silent, and one of them is this very bug with a confident
 * number behind it. The threshold that separates them is tuned to one board's
 * noise floor and its reliability turns on an acceleration this function is
 * never given, whereas the lead-in is queue and request latency — a property of
 * the transport, not of the move — and it measured 0.072-0.105 s across all 16
 * captures at every threshold that found it at all. A number that stable is
 * better stated once, in the file that owns how `M956` records, than re-derived
 * per file by a detector that can be wrong without saying so.
 *
 * A later head can push a short row under `sweepMatrix`'s 64-sample floor. That
 * is not silent: the row comes back all-zero, {@link analysedRows} counts it
 * out, and `sweepCaveats` raises `rows-not-analysed` (evidence/findings.ts). No
 * row of the standard ladder loses its window to this change — the thinnest,
 * 200 mm/s, goes from 331 samples to 166 — and the sweep regression test pins
 * that.
 */
export function cruiseWindow(capture: Capture, moveS: Seconds): { from: number; to: number } {
	const rate = capture.rate;
	const from = Math.round((LEAD_IN_S + 0.1 * moveS) * rate);
	const to = Math.round(Math.min(0.9 * moveS, capture.durationS - 0.05) * rate);
	return { from, to };
}

/**
 * How far past the full-step locus the plot should reach.
 *
 * Fifteen per cent. The locus is the thing the chart is read AGAINST — a ridge
 * lying along it is motor ripple and a stripe crossing it is a mode — so a
 * plot that stops exactly where the line does gives the eye nothing to judge
 * the top of the line by, and a ridge that continues past the last row cannot
 * be told from one that stops there.
 */
const LOCUS_HEADROOM = 1.15;

/**
 * The highest frequency worth plotting for these captures.
 *
 * Two ceilings, and the lower one wins:
 *
 *  - the LOCUS plus headroom, because past that there is nothing the chart is
 *    for. A fixed 700 Hz made a slow ladder unreadable — the 5-15 mm/s pass
 *    the coverage finding asks for forces only 25-75 Hz at 5 full steps/mm,
 *    which is a sliver at the left of an otherwise empty plot.
 *  - NYQUIST, because a bin above half the sampling rate holds nothing and
 *    never can. The captures on Gabe's board sample at 1377 Hz, so everything
 *    above ~688 Hz was structurally black and read as "the machine is quiet
 *    there" rather than "the instrument cannot look".
 *
 * Rounded up to 25 Hz so the axis lands on readable numbers.
 */
export function plotCeiling(rows: ReadonlyArray<SweepRow>, fullStepsPerMm: number): number {
	const rates = rows.map((r) => Number(r.capture.rate)).filter((n) => Number.isFinite(n) && n > 0);
	const speeds = rows.map((r) => Number(r.speed)).filter((n) => Number.isFinite(n) && n > 0);
	// Nothing to derive from: keep the historical width rather than inventing
	// a narrow plot around no data.
	if (rates.length === 0 || speeds.length === 0 || !(fullStepsPerMm > 0)) return 700;
	const nyquist = Math.floor(Math.min(...rates) / 2);
	const wanted = Math.ceil((Math.max(...speeds) * fullStepsPerMm * LOCUS_HEADROOM) / 25) * 25;
	// At least a readable band even for a very slow ladder.
	return Math.max(25, Math.min(wanted, nyquist));
}

export function sweepMatrix(rows: ReadonlyArray<SweepRow>, fullStepsPerMm: number, maxHz?: number): SweepMatrix {
	const sorted = [...rows].sort((a, b) => a.speed - b.speed);
	const ceiling = maxHz ?? plotCeiling(rows, fullStepsPerMm);
	const nBins = ceiling + 1;
	const freqs = new Float64Array(nBins);
	for (let i = 0; i < nBins; i++) freqs[i] = i;
	const amps = new Float64Array(sorted.length * nBins);
	sorted.forEach((row, r) => {
		const { from, to } = cruiseWindow(row.capture, row.moveS);
		const axis = row.axis ?? 0;
		const data = axis === 0 ? row.capture.x : axis === 1 ? row.capture.y : row.capture.z;
		if (to - from < 64) return;
		const { freqs: f, amps: a } = amplitudeSpectrum(data.subarray(from, to), row.capture.rate, 2);
		for (let k = 0; k < f.length; k++) {
			const bin = Math.round(f[k]!);
			if (bin >= nBins) break;
			const idx = r * nBins + bin;
			if (a[k]! > amps[idx]!) amps[idx] = a[k]!;
		}
	});
	return {
		speeds: sorted.map((r) => r.speed),
		freqs,
		amps,
		fullStepHz: sorted.map((r) => hz(r.speed * fullStepsPerMm)),
		maxHz: ceiling,
	};
}

/**
 * How many of a matrix's rows the transform actually produced a spectrum for.
 *
 * `sweepMatrix` above SKIPS a row whose cruise window holds fewer than 64
 * samples, leaving it all zeros — a real capture is never exactly zero in every
 * bin, so an all-zero row means "not analysed" and nothing else. Derived from
 * the matrix rather than reported alongside it, because a count carried beside
 * the numbers is a count that can come to disagree with them.
 *
 * The case is real: a 1500-sample capture at 1379 Hz records 1.09 s, while a
 * 100 mm move at 10 mm/s takes 10 s — so the record ends inside the move's
 * first tenth and there is no cruise window in it at all. A sweep that painted
 * that row as ground would read as "the machine is silent at 10 mm/s".
 */
export function analysedRows(matrix: SweepMatrix): number {
	const nBins = matrix.freqs.length;
	let n = 0;
	for (let r = 0; r < matrix.speeds.length; r++) {
		const base = r * nBins;
		for (let k = 0; k < nBins; k++) {
			if (matrix.amps[base + k] !== 0) {
				n++;
				break;
			}
		}
	}
	return n;
}
