/**
 * Fit the free ring-down after a stop: one dominant mode's frequency and
 * damping ratio, in real units.
 *
 * @invariant fingerprint-from-fit-only
 * @rung 7  sole-constructor type — `Mode` carries a brand that only this
 *          module's fitDecay writes, and `Fingerprint` is produced only by
 *          aggregate(); the shaper ranking takes a Fingerprint, so it can
 *          never be handed a frequency somebody typed in. Custom user input
 *          enters through the shaper spec, never through a Fingerprint
 * @why M593's F and S are exactly what the plugin guesses; the ranking is
 *      only as honest as the provenance of the numbers it ranks against
 *
 * @invariant one-envelope-and-it-is-fitted
 * @rung 8  illegal state unrepresentable — a ring-down's envelope is not
 *          stored as samples anywhere. It is `modeEnvelope()`: three numbers
 *          (peakG, f, zeta) evaluated as peakG·exp(-2π·f·zeta·t), with zeta
 *          bounded below by 0.005 on every route that mints a Mode
 *          (fitDecay, aggregate, reviveMode). The envelope is therefore
 *          strictly decreasing for every t by arithmetic, and there is no
 *          second producer to disagree with it — `spectrum.ts` deliberately
 *          exports no function that returns a measured envelope
 * @why measured 2026-08-23: an FFT band mask is zero-phase with a sinc
 *      kernel ~1/(2·rel·f) long, so its magnitude RISES for 20-50 ms after
 *      an abrupt ring onset before settling, then overshoots. Fed a pure
 *      decaying sinusoid — whose envelope cannot rise — the old estimator
 *      read 0.35× truth at the stop, 1.00× at 60 ms and 1.52× at 120 ms
 *      (18 Hz, zeta 0.127). Anchoring peakG and the 15 % floor on the argmax
 *      of that curve put the anchor wherever the artefact happened to peak,
 *      which is why ring1_Xp1 was rejected and its five siblings were not.
 *      Padding the input with run-in does not fix it: with a silent run-in
 *      the rise is still 46 ms, and on real captures the run-in only lets
 *      the deceleration bleed through the band instead. Against synthetic
 *      ground truth (4 ring phases × 3 noise seeds, decel pulse present) the
 *      old pipeline was 8-39 % out on zeta and 16-63 % LOW on peakG; the fit
 *      below is 1-9 % on zeta and 1-6 % on peakG over the same grid
 */

import { peakHz } from "./spectrum.ts";
import { g, type G, hz, type Hz, type Seconds } from "./units.ts";

declare const modeBrand: unique symbol;

export type Mode = {
	readonly f: Hz;
	readonly zeta: number;
	/** Ring amplitude at the first sample of the analysis region. */
	readonly peakG: G;
	readonly cyclesFit: number;
	readonly [modeBrand]: true;
};

export type NoFit = {
	readonly reason: "short-window" | "below-floor" | "short-decay" | "damping-out-of-range";
	readonly f?: Hz;
	readonly peakG?: G;
	/** How short "short-decay" actually was, so a near-miss reads as one. */
	readonly cyclesFit?: number;
};

export function isMode(r: Mode | NoFit): r is Mode {
	return "zeta" in r;
}

/**
 * Envelope level that ends the observable decay: the fit describes the ring
 * from its amplitude down to 15 % of it.
 */
export const DECAY_FLOOR = 0.15;

/**
 * Cycles of decay required between the ring amplitude and DECAY_FLOOR.
 *
 * Not a taste call. `f` is the spectral peak, and the rectangular-window peak
 * of a damped burst is biased by the damping. Measured against synthetic
 * ground truth at 18 and 51.5 Hz (mean |error| over 4 ring phases × 3 noise
 * seeds), frequency error runs 0.1-0.2 % at zeta 0.03, 0.7-2.5 % at 0.10,
 * 2.8-6.8 % at 0.15 and 5.1-9.2 % at 0.18, then collapses (10-22 % at 0.28+).
 * Two cycles puts the cut at zeta {@link MAX_FIT_ZETA}, i.e. exactly where
 * frequency error crosses ~5 % — about the width a shaper absorbs. Above it
 * the engine reports the near-miss rather than a number it cannot stand
 * behind.
 */
export const MIN_CYCLES = 2;

/**
 * The damping ratio at which the decay to DECAY_FLOOR takes exactly
 * MIN_CYCLES: ln(1/0.15)/(2π·2) = 0.1510.
 *
 * cyclesFit is ln(1/DECAY_FLOOR)/(2π·zeta), so the cycle rule IS a cap on
 * zeta — derived, not counted from samples, which is what used to make it a
 * coin flip. Margin on Gabe's machine (2026-08-23): X fits at zeta 0.110 →
 * 2.74 cycles, 37 % of headroom in zeta before rejection; Y at 0.034 → 8.9
 * cycles.
 */
export const MAX_FIT_ZETA = Math.log(1 / DECAY_FLOOR) / (2 * Math.PI * MIN_CYCLES);

export type FitOptions = {
	/** Highest ring frequency considered (Hz). Default 150: above that it is motor ripple, not ringing. */
	readonly fmax?: number;
	/** Minimum post-stop peak (g) for there to be any ringing to fit. Default 0.02. */
	readonly floorG?: number;
	/** Analysis window after the stop (s). Default 0.6. */
	readonly windowS?: number;
};

/**
 * Least-squares fit of A·e^(-αt)·cos(2πf·t + φ) to `y`, with f held at the
 * measured peak frequency.
 *
 * A and φ enter the model linearly, so for each trial α the best pair is a
 * 2×2 solve and never needs searching; only α is scanned. Holding f fixed is
 * a deliberate choice, not a simplification: freeing it improved synthetic
 * frequency accuracy by ≤1 % but tripled the spread across the six real X
 * repeats (CV 0.9 % → 2.4 %), because that axis carries a second component
 * inside the same band. It also makes cos/sin precomputable, so each trial α
 * costs one pass of multiplies with no transcendentals.
 */
function fitDampedSinusoid(y: Float64Array, rate: number, f: number): { alpha: number; amp: number } {
	const n0 = y.length;
	const cosT = new Float64Array(n0);
	const sinT = new Float64Array(n0);
	const w = (2 * Math.PI * f) / rate;
	for (let i = 0; i < n0; i++) {
		cosT[i] = Math.cos(w * i);
		sinT[i] = Math.sin(w * i);
	}
	// Energy the best (A, φ) explains at this α over the first n samples.
	// Maximising it minimises the squared residual, since ‖y‖² is fixed.
	const solve = (alpha: number, n: number): { amp: number; energy: number } => {
		const r = Math.exp(-alpha / rate);
		const r2 = r * r;
		let e = 1;
		let e2 = 1;
		let cc = 0;
		let ss = 0;
		let cs = 0;
		let yc = 0;
		let ys = 0;
		for (let i = 0; i < n; i++) {
			const c = cosT[i]!;
			const s = sinT[i]!;
			cc += e2 * c * c;
			ss += e2 * s * s;
			cs += e2 * c * s;
			yc += y[i]! * e * c;
			ys += y[i]! * e * s;
			e *= r;
			e2 *= r2;
		}
		const det = cc * ss - cs * cs;
		if (!(det > 1e-18)) return { amp: 0, energy: -Infinity };
		const a = (yc * ss - ys * cs) / det;
		const b = (ys * cc - yc * cs) / det;
		return { amp: Math.hypot(a, b), energy: a * yc + b * ys };
	};
	const best = (n: number): { alpha: number; amp: number; energy: number } => {
		let out = { alpha: 0, amp: 0, energy: -Infinity };
		// 121 log-spaced dampings over 0.001..1 (6 % apart) bracket the
		// optimum; the pattern search then polishes it to ~1e-4 relative.
		for (let k = 0; k <= 120; k++) {
			const alpha = 2 * Math.PI * f * 0.001 * Math.pow(1000, k / 120);
			const t = solve(alpha, n);
			if (t.energy > out.energy) out = { alpha, amp: t.amp, energy: t.energy };
		}
		let step = out.alpha * 0.3;
		for (let i = 0; i < 60; i++) {
			for (const d of [step, -step]) {
				const alpha = out.alpha + d;
				if (alpha <= 0) continue;
				const t = solve(alpha, n);
				if (t.energy > out.energy) out = { alpha, amp: t.amp, energy: t.energy };
			}
			step *= 0.85;
		}
		return out;
	};
	// The window is 0.6 s but the ring is over in a fraction of it; fitting
	// the dead tail as well lets noise flatten the slope. Shrink the fit to
	// the span the fit itself says the decay occupies — never below three
	// cycles, and only ever downwards, so the loop cannot cycle.
	let n = n0;
	let out = best(n);
	for (let i = 0; i < 4; i++) {
		if (!(out.alpha > 0)) break;
		const want = Math.round((Math.log(1 / DECAY_FLOOR) / out.alpha) * rate);
		const next = Math.max(Math.ceil((3 * rate) / f), Math.min(n, want));
		if (next >= n) break;
		n = next;
		out = best(n);
	}
	return { alpha: out.alpha, amp: out.amp };
}

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

	const f0 = peakHz(seg, rate, 5, fmax);
	const { alpha, amp } = fitDampedSinusoid(seg, rate, f0);
	const peak = g(amp);
	const zeta = alpha / (2 * Math.PI * f0);
	if (!(zeta >= 0.005 && zeta <= 0.5)) return { reason: "damping-out-of-range", f: f0, peakG: peak };
	// Cycles of decay from the ring amplitude down to DECAY_FLOOR, capped by
	// what the analysis window can actually show.
	const cyclesFit = f0 * Math.min(Math.log(1 / DECAY_FLOOR) / alpha, seg.length / rate);
	if (cyclesFit < MIN_CYCLES) return { reason: "short-decay", f: f0, peakG: peak, cyclesFit };
	return { f: f0, zeta, peakG: peak, cyclesFit } as Mode;
}

/**
 * The mode's envelope, sampled at `rate` from the first sample of the
 * analysis region — the engine's only envelope, and the one the decay chart
 * must draw so that the picture and the fit cannot disagree.
 *
 * Strictly decreasing for every mode that can exist: zeta ≥ 0.005 on every
 * route that mints one, so the per-sample ratio below is < 1.
 */
export function modeEnvelope(m: Mode, rate: Hz, n: number): Float64Array {
	const out = new Float64Array(n);
	const r = Math.exp((-2 * Math.PI * m.f * m.zeta) / rate);
	let v = m.peakG as number;
	for (let i = 0; i < n; i++) {
		out[i] = v;
		v *= r;
	}
	return out;
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

/**
 * The deserialization arm of the Mode producer. A Mode fitted in an earlier
 * session and written to the SD card comes back through HERE — validated field
 * by field against the same acceptance band `fitDecay` applies — rather than
 * being cast at the read site. Keeping it in this module is the point: the
 * brand stays unwritable everywhere else, so `Mode` still has exactly one
 * module that can mint one.
 *
 * Note honestly what this does and does not buy. It restores "a Mode is a
 * plausible measurement in the units the fitter produces"; it does not restore
 * "this number came off an accelerometer", because a hand-edited card file
 * cannot be told from a real one. That is the same trust the config overlay
 * gets, and the reason a Fingerprint read from the card is only ever used to
 * RANK, never to move.
 */
export function reviveMode(raw: unknown): Mode | null {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
	const v = raw as Record<string, unknown>;
	const { f, zeta, peakG, cyclesFit } = v;
	if (typeof f !== "number" || typeof zeta !== "number" || typeof peakG !== "number" || typeof cyclesFit !== "number") return null;
	if (![f, zeta, peakG, cyclesFit].every((n) => Number.isFinite(n))) return null;
	if (!(f > 0 && f <= 2000)) return null;
	// The band fitDecay itself accepts; outside it the fitter would have
	// returned "damping-out-of-range" instead of a Mode.
	if (!(zeta >= 0.005 && zeta <= 0.5)) return null;
	if (!(peakG >= 0) || !(cyclesFit > 0)) return null;
	return { f: hz(f), zeta, peakG: g(peakG), cyclesFit } as Mode;
}

/** Same boundary for a whole Fingerprint: one bad mode refuses the lot. */
export function reviveFingerprint(raw: unknown): Fingerprint | null {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
	const v = raw as Record<string, unknown>;
	// `undefined` means "present but not a Mode" and refuses the whole
	// fingerprint; a JSON null is a legitimate "this axis did not fit".
	const axis = (key: Axis): Mode | null | undefined => {
		if (v[key] === null) return null;
		return reviveMode(v[key]) ?? undefined;
	};
	const X = axis("X");
	const Y = axis("Y");
	if (X === undefined || Y === undefined) return null;
	const pair = (raw2: unknown, ok: (n: number) => boolean): { X: number; Y: number } | null => {
		if (typeof raw2 !== "object" || raw2 === null || Array.isArray(raw2)) return null;
		const o = raw2 as Record<string, unknown>;
		if (typeof o.X !== "number" || typeof o.Y !== "number") return null;
		if (!ok(o.X) || !ok(o.Y)) return null;
		return { X: o.X, Y: o.Y };
	};
	const n = pair(v.n, (x) => Number.isInteger(x) && x >= 0);
	const spreadHz = pair(v.spreadHz, (x) => Number.isFinite(x) && x >= 0);
	if (n === null || spreadHz === null) return null;
	return { X, Y, n, spreadHz };
}
