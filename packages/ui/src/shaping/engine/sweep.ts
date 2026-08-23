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
