// Fit the free ring-down after a stop: one dominant mode's frequency and
// damping ratio, in real units.
//
// @invariant fingerprint-from-fit-only
// @rung 7  sole-constructor type — `Mode` carries a brand that only this
//          module's fitDecay writes, and `Fingerprint` is produced only by
//          aggregate(); the shaper ranking takes a Fingerprint, so it can
//          never be handed a frequency somebody typed in. Custom user input
//          enters through the shaper spec, never through a Fingerprint
// @why M593's F and S are exactly what the plugin guesses; the ranking is
//      only as honest as the provenance of the numbers it ranks against

import { bandAnalytic, peakHz } from "./spectrum.ts";
import { g, type G, type Hz, type Seconds } from "./units.ts";

declare const modeBrand: unique symbol;

export type Mode = {
	readonly f: Hz;
	readonly zeta: number;
	readonly peakG: G;
	readonly cyclesFit: number;
	readonly [modeBrand]: true;
};

export type NoFit = {
	readonly reason: "short-window" | "below-floor" | "short-decay" | "damping-out-of-range";
	readonly f?: Hz;
	readonly peakG?: G;
};

export function isMode(r: Mode | NoFit): r is Mode {
	return "zeta" in r;
}

export type FitOptions = {
	/** Highest ring frequency considered (Hz). Default 150: above that it is motor ripple, not ringing. */
	readonly fmax?: number;
	/** Minimum post-stop peak (g) for there to be any ringing to fit. Default 0.02. */
	readonly floorG?: number;
	/** Analysis window after the stop (s). Default 0.6. */
	readonly windowS?: number;
};

export function fitDecay(axis: Float64Array, rate: Hz, tStop: Seconds, opts: FitOptions = {}): Mode | NoFit {
	const fmax = opts.fmax ?? 150;
	const floorG = opts.floorG ?? 0.02;
	const windowS = opts.windowS ?? 0.6;
	const i0 = Math.round((tStop + 0.01) * rate);
	const i1 = Math.min(axis.length, i0 + Math.round(windowS * rate));
	if (i1 - i0 < Math.round(0.15 * rate)) return { reason: "short-window" };
	const seg = axis.slice(i0, i1);
	let mean = 0;
	for (let i = 0; i < seg.length; i++) mean += seg[i]!;
	mean /= seg.length;
	for (let i = 0; i < seg.length; i++) seg[i] = seg[i]! - mean;

	// "Is there ringing?" is a time-domain question — a fast decay averages
	// to almost nothing in a 0.6 s spectrum.
	const head = Math.max(1, Math.round(0.1 * rate));
	let tpk = 0;
	for (let i = 0; i < head && i < seg.length; i++) tpk = Math.max(tpk, Math.abs(seg[i]!));
	if (tpk < floorG) return { reason: "below-floor", peakG: g(tpk) };

	const fPeak = peakHz(seg, rate, 5, fmax);
	const { env } = bandAnalytic(seg, rate, fPeak);
	let ipk = 0;
	for (let i = 1; i < head && i < env.length; i++) if (env[i]! > env[ipk]!) ipk = i;
	const lvl = env[ipk]!;
	// Fit ln(env) from the peak until the envelope falls to 15 % of it.
	let iend = env.length;
	for (let i = ipk; i < env.length; i++) {
		if (env[i]! < 0.15 * lvl) {
			iend = i;
			break;
		}
	}
	const minSamples = Math.round((2 * rate) / fPeak); // at least two cycles
	if (iend - ipk < minSamples) return { reason: "short-decay", f: fPeak, peakG: g(lvl) };
	// Damping from the log-slope of the band-limited envelope over the decay.
	// This is the prototype's estimator (tools/accel/shaping.py), which matched
	// the machine within 0.5 Hz / 0.03 zeta over 12 captures. Known limit: a
	// ring that dies in ~2 cycles (zeta ≳ 0.15) is located only to ~5 % in
	// frequency — far inside any EI shaper's band, but reported as cyclesFit.
	const cnt = iend - ipk;
	let sx = 0;
	let sy = 0;
	let sxx = 0;
	let sxy = 0;
	for (let i = ipk; i < iend; i++) {
		const t = (i - ipk) / rate;
		const y = Math.log(env[i]! + 1e-9);
		sx += t;
		sy += y;
		sxx += t * t;
		sxy += t * y;
	}
	const slope = (cnt * sxy - sx * sy) / (cnt * sxx - sx * sx);
	const f0 = fPeak;
	const zeta = -slope / (2 * Math.PI * f0);
	if (!(zeta >= 0.005 && zeta <= 0.5)) return { reason: "damping-out-of-range", f: f0, peakG: g(lvl) };
	return { f: f0, zeta, peakG: g(lvl), cyclesFit: (cnt * f0) / rate } as Mode;
}

export type Axis = "X" | "Y";

export type Fingerprint = {
	readonly X: Mode | null;
	readonly Y: Mode | null;
	readonly n: { readonly X: number; readonly Y: number };
	readonly spreadHz: { readonly X: number; readonly Y: number };
};

function median(v: number[]): number {
	const s = [...v].sort((a, b) => a - b);
	return s[s.length >> 1]!;
}

/** Per-axis medians over the successful fits; `null` where nothing fitted. */
export function aggregate(fits: ReadonlyArray<{ axis: Axis; fit: Mode | NoFit }>): Fingerprint {
	const per = (axis: Axis): { mode: Mode | null; n: number; spread: number } => {
		const ok = fits.filter((x) => x.axis === axis && isMode(x.fit)).map((x) => x.fit as Mode);
		if (ok.length === 0) return { mode: null, n: 0, spread: 0 };
		const fs = ok.map((m) => m.f as number);
		const mode = {
			f: median(fs) as Hz,
			zeta: median(ok.map((m) => m.zeta)),
			peakG: median(ok.map((m) => m.peakG as number)) as G,
			cyclesFit: median(ok.map((m) => m.cyclesFit)),
		} as Mode;
		return { mode, n: ok.length, spread: Math.max(...fs) - Math.min(...fs) };
	};
	const x = per("X");
	const y = per("Y");
	return { X: x.mode, Y: y.mode, n: { X: x.n, Y: y.n }, spreadHz: { X: x.spread, Y: y.spread } };
}
