// Spectral primitives for the shaping engine: an in-place radix-2 FFT and the
// three views the fitter needs. Zero dependencies by policy; the inputs are
// ~1.5k samples, so a textbook O(n log n) is ample.

import { hz, type Hz } from "./units.ts";

function nextPow2(n: number): number {
	let p = 1;
	while (p < n) p <<= 1;
	return p;
}

/** In-place iterative radix-2 FFT. `re.length` must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
	const n = re.length;
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			const tr = re[i]!;
			re[i] = re[j]!;
			re[j] = tr;
			const ti = im[i]!;
			im[i] = im[j]!;
			im[j] = ti;
		}
	}
	for (let len = 2; len <= n; len <<= 1) {
		const ang = (-2 * Math.PI) / len;
		const wr = Math.cos(ang);
		const wi = Math.sin(ang);
		for (let i = 0; i < n; i += len) {
			let cr = 1;
			let ci = 0;
			for (let k = 0; k < len / 2; k++) {
				const a = i + k;
				const b = i + k + len / 2;
				const xr = re[b]! * cr - im[b]! * ci;
				const xi = re[b]! * ci + im[b]! * cr;
				re[b] = re[a]! - xr;
				im[b] = im[a]! - xi;
				re[a] = re[a]! + xr;
				im[a] = im[a]! + xi;
				const ncr = cr * wr - ci * wi;
				ci = cr * wi + ci * wr;
				cr = ncr;
			}
		}
	}
}

/** Inverse FFT in place (conjugate trick), normalised by n. */
export function ifft(re: Float64Array, im: Float64Array): void {
	for (let i = 0; i < im.length; i++) im[i] = -im[i]!;
	fft(re, im);
	const n = re.length;
	for (let i = 0; i < n; i++) {
		re[i] = re[i]! / n;
		im[i] = -im[i]! / n;
	}
}

function hann(n: number): Float64Array {
	const w = new Float64Array(n);
	for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
	return w;
}

/**
 * Single-sided amplitude spectrum in the input's units (a sine of amplitude A
 * reads ~A at its frequency). Mean removed, Hann windowed, zero-padded.
 */
export function amplitudeSpectrum(x: Float64Array, rate: Hz, padFactor = 1): { freqs: Float64Array; amps: Float64Array } {
	const n = x.length;
	const m = nextPow2(n * padFactor);
	const w = hann(n);
	let mean = 0;
	for (let i = 0; i < n; i++) mean += x[i]!;
	mean /= n;
	let wsum = 0;
	const re = new Float64Array(m);
	const im = new Float64Array(m);
	for (let i = 0; i < n; i++) {
		re[i] = (x[i]! - mean) * w[i]!;
		wsum += w[i]!;
	}
	fft(re, im);
	const half = m / 2;
	const freqs = new Float64Array(half);
	const amps = new Float64Array(half);
	for (let k = 0; k < half; k++) {
		freqs[k] = (k * rate) / m;
		amps[k] = (2 * Math.hypot(re[k]!, im[k]!)) / wsum;
	}
	return { freqs, amps };
}

/**
 * Frequency of the strongest component in [minHz, maxHz].
 *
 * Rectangular window and 8× zero padding: the decay sits at the START of the
 * window, where a Hann taper would erase it, and 0.6 s windows need the
 * padding to resolve to ~0.2 Hz.
 */
export function peakHz(x: Float64Array, rate: Hz, minHz: number, maxHz: number): Hz {
	const n = x.length;
	const m = nextPow2(n * 8);
	let mean = 0;
	for (let i = 0; i < n; i++) mean += x[i]!;
	mean /= n;
	const re = new Float64Array(m);
	const im = new Float64Array(m);
	for (let i = 0; i < n; i++) re[i] = x[i]! - mean;
	fft(re, im);
	let best = -1;
	let bestK = 0;
	for (let k = 0; k < m / 2; k++) {
		const f = (k * rate) / m;
		if (f < minHz || f > maxHz) continue;
		const a = Math.hypot(re[k]!, im[k]!);
		if (a > best) {
			best = a;
			bestK = k;
		}
	}
	return hz((bestK * rate) / m);
}

/**
 * `x` band-passed to centre·(1±rel): the band-limited SIGNAL, not an envelope.
 *
 * @invariant one-envelope-and-it-is-fitted
 * @rung 8  illegal state unrepresentable — the engine has no function that
 *          returns a measured envelope, so no consumer can obtain one. The
 *          only envelope in the system is `modeEnvelope()` in fit.ts, which
 *          is `peakG·exp(-2π·f·zeta·t)` derived from a fitted Mode and is
 *          therefore monotonically decreasing for every t by arithmetic
 * @why an ideal band mask is a zero-phase filter with a sinc impulse
 *      response ~1/(2·rel·f) long. A ring-down starts abruptly at the stop,
 *      so the mask has no signal on the left half of its kernel and its
 *      magnitude RISES for tens of milliseconds before settling — measured
 *      2026-08-23 on a pure decaying sinusoid whose envelope cannot rise:
 *      reading/truth ran 0.35 → 1.00 → 1.52 for 18 Hz ζ 0.127 at rel 0.25.
 *      Padding the input with run-in does not help (a zero run-in leaves the
 *      rise at 46 ms); on real captures it only replaces the rise with
 *      deceleration bleeding through the band. A measured envelope of a
 *      ring-down is not recoverable near the stop, so the engine does not
 *      offer one — see docs in fit.ts
 */
export function bandPass(x: Float64Array, rate: Hz, centre: Hz, rel = 0.25): Float64Array {
	const n = x.length;
	const m = nextPow2(n);
	let mean = 0;
	for (let i = 0; i < n; i++) mean += x[i]!;
	mean /= n;
	const re = new Float64Array(m);
	const im = new Float64Array(m);
	for (let i = 0; i < n; i++) re[i] = x[i]! - mean;
	fft(re, im);
	const lo = centre * (1 - rel);
	const hi = centre * (1 + rel);
	for (let k = 0; k < m; k++) {
		const f = (k * rate) / m;
		const mirror = ((m - k) % m) * rate / m;
		const keep = k > 0 && ((f >= lo && f <= hi) || (mirror >= lo && mirror <= hi));
		if (!keep) {
			re[k] = 0;
			im[k] = 0;
		}
	}
	ifft(re, im);
	return re.slice(0, n);
}
