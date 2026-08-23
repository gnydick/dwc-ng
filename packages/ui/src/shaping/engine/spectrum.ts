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
 * Envelope of `x` band-passed to centre·(1±rel): magnitude of the analytic
 * signal built by keeping only positive frequencies in the band.
 */
export function bandEnvelope(x: Float64Array, rate: Hz, centre: Hz, rel = 0.25): Float64Array {
	return bandAnalytic(x, rate, centre, rel).env;
}

/** Analytic signal of the band-passed input: envelope and unwrapped phase (rad). */
export function bandAnalytic(x: Float64Array, rate: Hz, centre: Hz, rel = 0.25): { env: Float64Array; phase: Float64Array; real: Float64Array } {
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
		const keep = k > 0 && k < m / 2 && f >= lo && f <= hi;
		if (!keep) {
			re[k] = 0;
			im[k] = 0;
		} else {
			re[k] = re[k]! * 2;
			im[k] = im[k]! * 2;
		}
	}
	ifft(re, im);
	const env = new Float64Array(n);
	const phase = new Float64Array(n);
	const real = new Float64Array(n);
	let prev = 0;
	let acc = 0;
	for (let i = 0; i < n; i++) {
		env[i] = Math.hypot(re[i]!, im[i]!);
		real[i] = re[i]!;
		const ph = Math.atan2(im[i]!, re[i]!);
		if (i > 0) {
			let d = ph - prev;
			while (d > Math.PI) d -= 2 * Math.PI;
			while (d < -Math.PI) d += 2 * Math.PI;
			acc += d;
		}
		prev = ph;
		phase[i] = acc;
	}
	return { env, phase, real };
}
