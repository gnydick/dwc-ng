// Speed × frequency picture of constant-velocity moves, so the user can see
// forced vibration (lines that follow speed, e.g. the full-step rate) apart
// from ringing (fixed frequencies). Shaping can only touch the latter.

import type { Capture } from "./capture.ts";
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

/** Cruise window of a constant-velocity capture: 10 %..90 % of the move, inside the record. */
export function cruiseWindow(capture: Capture, moveS: Seconds): { from: number; to: number } {
	const rate = capture.rate;
	const from = Math.round(0.1 * moveS * rate);
	const to = Math.round(Math.min(0.9 * moveS, capture.durationS - 0.05) * rate);
	return { from, to };
}

export function sweepMatrix(rows: ReadonlyArray<SweepRow>, fullStepsPerMm: number, maxHz = 700): SweepMatrix {
	const sorted = [...rows].sort((a, b) => a.speed - b.speed);
	const nBins = maxHz + 1;
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
		maxHz,
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
