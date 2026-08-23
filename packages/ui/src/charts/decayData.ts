/**
 * The decay chart's data, derived — never asserted — from one fitted capture.
 *
 * Four things go on the chart and all four come from the same place:
 *
 *  - the raw accelerometer trace of the axis that moved;
 *  - the stop `detectStop` found, as a vertical marker;
 *  - the band-passed envelope the fitter measured;
 *  - the exponential those measurements imply, `peak · e^{−ζω(t − t_pk)}`.
 *
 * The envelope is NOT recomputed here. `engine/fit.ts` hands out the analysis
 * window it used (`decayWindow`, invariant `one-decay-window`) and this module
 * plots that, so the curve on screen is the curve the number beside it was
 * taken from. A second envelope, computed here with its own band or its own
 * peak index, is the defect this split exists to make unwritable: a chart
 * showing a clean ring-down next to the words "decayed too fast" would be
 * believed, and it would be the chart that was wrong.
 *
 * @invariant decay-view-comes-from-one-fitted-capture
 * @rung 7  sole-constructor input — `decaySeries` takes a `FitResult` and
 *          nothing else. A FitResult is minted only by the engine worker
 *          (shaping/worker.ts) from one CSV, and carries its axis, its
 *          samples, its stop and its verdict together, so there are no two
 *          arguments that could come from two captures
 * @why the whole point of the card is to let an operator see why a fit came
 *      out as it did, which requires that what is drawn and what is printed
 *      be the same measurement
 *
 * Pure and JSX-free by design (the plan's data/JSX split): node:test cannot
 * import a `.tsx`, and everything worth asserting about this chart is a number
 * or a sentence, not a DOM.
 */
import type { AlignedData } from "../om/temperature.ts";
import { decayWindow, FIT_DEFAULTS, isMode, type Mode, type NoFit } from "../shaping/engine/fit.ts";
import type { FitResult } from "../shaping/worker.ts";

/** Where the regression ran, and how much ring-down it had to work with. */
export type DecayCycles = {
	/** Cycles of ring-down between the envelope peak and 15 % of it. */
	readonly sustained: number;
	/** Cycles the fitter requires before it will report a damping ratio. */
	readonly needed: number;
};

export type DecayView = {
	/**
	 * `[t, raw, envelope, fitted]`, in seconds and g. Always four arrays of the
	 * same length: a series with nothing to say is all-null rather than short,
	 * so the chart's series count — and therefore its legend and its height —
	 * does not depend on whether the capture fitted.
	 */
	readonly data: AlignedData;
	/** Seconds at which the last acceleration pulse ended; null if none was found. */
	readonly stopS: number | null;
	/** The analysed window in seconds, or null when there was nothing to analyse. */
	readonly window: { readonly fromS: number; readonly toS: number } | null;
	/** The span the log-slope regression covered, in seconds. */
	readonly decay: { readonly fromS: number; readonly toS: number } | null;
	/** Ring-down measured against the two cycles the fit needs. */
	readonly cycles: DecayCycles | null;
	/**
	 * The seconds the chart opens on, `[from, to]`.
	 *
	 * NOT the whole capture, and this is the difference between a chart that
	 * shows the ring and one that does not. A ring-down is ~0.05 g and the
	 * acceleration pulses that bracket the move are ~1.5 g, so a y axis fitted
	 * to the whole trace draws the thing being measured as a flat line thirty
	 * times too small to read — measured in the Card Lab, 2026-08-23, before
	 * this existed. Cropping to the stop and the analysed window puts the ring
	 * at full height and keeps the decel pulse just in frame as the reference
	 * the marker is about.
	 */
	readonly xRange: readonly [number, number];
	/**
	 * The g the chart opens on, `[min, max]`.
	 *
	 * Fitted to the RING, not to the trace. Cropping x alone was not enough —
	 * the deceleration pulse ends at the stop, so any lead-in at all brings a
	 * 1.5 g spike into frame and an auto-fitted y axis draws the 0.05 g ring as
	 * a flat line again (measured in the Card Lab, 2026-08-23). The pulse is
	 * allowed to run off the top of the frame: that it was enormous is the one
	 * thing about it the operator already knows, and the marker says where.
	 */
	readonly yRange: readonly [number, number];
	/** One sentence about the verdict, in the operator's terms. Never empty. */
	readonly note: string;
	/** Seconds of capture; the chart's x extent. */
	readonly durationS: number;
};

/** Seconds of the move kept in frame before the stop, so the decel pulse the
 *  marker points at is visible rather than merely asserted. */
const LEAD_IN_S = 0.03;

/** Headroom above the largest sample in view, so the trace does not touch the
 *  frame. */
const Y_HEADROOM = 1.15;

/** The largest |sample| over a half-open index range, or 0 over an empty one. */
function amplitude(samples: Float64Array, from: number, to: number): number {
	let peak = 0;
	for (let i = Math.max(0, from); i < Math.min(samples.length, to); i++) {
		const v = Math.abs(samples[i]!);
		if (v > peak) peak = v;
	}
	return peak;
}

/** A symmetric y window around zero, never degenerate — a capture of exact
 *  zeros would otherwise give uPlot an empty scale. */
function yWindow(peak: number): readonly [number, number] {
	const half = peak > 0 ? peak * Y_HEADROOM : 1;
	return [-half, half];
}

const nulls = (n: number): Array<number | null> => new Array<number | null>(n).fill(null);

const g3 = (v: number): string => v.toFixed(3);

/**
 * Why the fit came out as it did, in one sentence.
 *
 * Total over `Mode | NoFit`, and every branch quotes FIT_DEFAULTS rather than
 * a literal — the sentence "the fit needs 2 cycles" is only true while it is
 * the fitter's own 2.
 *
 * The `short-decay` branch is the one that earns this function. It is the
 * verdict the real machine actually produces (ring1_Xp1.csv, 2026-08-22: the
 * envelope sustained 1.88 of the 2 cycles required), and a bare "decayed too
 * fast" invites the reading that the capture is junk. It is a near miss, the
 * NoFit carries the frequency and peak the envelope did measure, and saying so
 * is the difference between an operator repeating the run and an operator
 * concluding the machine is broken.
 */
export function fitNote(fit: Mode | NoFit, cycles: DecayCycles | null, stopFound = true): string {
	// `detectStop` finding nothing and the window being too short both reach
	// the fitter as `short-window`, and they are not the same news: the first
	// is "this axis never accelerated" — what you get switching to the axis
	// that stood still during the move — and the second is "capture for
	// longer". The card knows which happened; the fitter, given only samples,
	// does not.
	if (!stopFound) return "No stop was detected on this axis: nothing here accelerated hard enough to ring.";
	const pct = Math.round(FIT_DEFAULTS.decayTo * 100);
	if (isMode(fit)) {
		return `Fitted over ${fit.cyclesFit.toFixed(2)} cycles, from the envelope's peak down to ${pct} % of it.`;
	}
	const measured = `The envelope did measure ${(fit.f ?? 0).toFixed(1)} Hz at ${g3(fit.peakG ?? 0)} g.`;
	switch (fit.reason) {
		case "short-window":
			return `Under ${FIT_DEFAULTS.minWindowS} s of samples follow the stop — no ring-down to analyse. Capture for longer.`;
		case "below-floor":
			return `Peak ${g3(fit.peakG ?? 0)} g after the stop, under the ${FIT_DEFAULTS.floorG} g floor: this axis did not ring.`;
		case "short-decay": {
			const had = cycles === null ? `under ${FIT_DEFAULTS.minCycles}` : cycles.sustained.toFixed(2);
			return `Near miss: the ring reached ${pct} % of peak in ${had} cycles and a ζ needs ${FIT_DEFAULTS.minCycles}. ${measured}`;
		}
		case "damping-out-of-range":
			return `The envelope's log-slope put ζ outside 0.005–0.5, which is not a decaying ring. ${measured}`;
	}
}

/**
 * One fitted capture as four aligned series plus the marks around them.
 *
 * The plan wrote this as `decaySeries(capture, fit, tStop)`; it takes the one
 * value that carries all three instead, for the reason on `FitResult`.
 */
export function decaySeries(capture: FitResult): DecayView {
	const samples = capture.axis === "X" ? capture.x : capture.y;
	const rate = capture.rate as number;
	const n = samples.length;
	const t = new Array<number>(n);
	const raw = new Array<number | null>(n);
	for (let i = 0; i < n; i++) {
		t[i] = i / rate;
		raw[i] = samples[i]!;
	}
	const envelope = nulls(n);
	const fitted = nulls(n);
	const durationS = n / rate;

	const stopS = capture.tStop === null ? null : (capture.tStop as number);
	const w = capture.tStop === null ? null : decayWindow(samples, capture.rate, capture.tStop);
	if (w === null) {
		// Nothing was analysed, so there is no ring to frame: show the lot.
		return {
			data: [t, raw, envelope, fitted],
			stopS,
			window: null,
			decay: null,
			cycles: null,
			note: fitNote(capture.fit, null, stopS !== null),
			durationS,
			xRange: [0, durationS],
			yRange: yWindow(amplitude(samples, 0, n)),
		};
	}

	for (let i = 0; i < w.env.length && w.i0 + i < n; i++) envelope[w.i0 + i] = w.env[i]!;

	const peakIndex = w.i0 + w.ipk;
	const cycles: DecayCycles = {
		sustained: ((w.iend - w.ipk) * (w.fPeak as number)) / rate,
		needed: FIT_DEFAULTS.minCycles,
	};

	// The exponential the printed numbers imply, anchored at the envelope's
	// peak and drawn across the rest of the analysed window — past the end of
	// the regression on purpose, because how far the model keeps up with the
	// envelope after the fit stopped looking is exactly what an operator wants
	// to judge by eye.
	if (isMode(capture.fit)) {
		const decayRate = 2 * Math.PI * (capture.fit.f as number) * capture.fit.zeta;
		const peak = capture.fit.peakG as number;
		const tPeak = peakIndex / rate;
		for (let i = peakIndex; i < w.i0 + w.env.length && i < n; i++) {
			fitted[i] = peak * Math.exp(-decayRate * (i / rate - tPeak));
		}
	}

	return {
		data: [t, raw, envelope, fitted],
		stopS,
		window: { fromS: w.i0 / rate, toS: (w.i0 + w.env.length) / rate },
		decay: { fromS: peakIndex / rate, toS: (w.i0 + w.iend) / rate },
		cycles,
		note: fitNote(capture.fit, cycles, true),
		durationS,
		// A little before the stop, so the decel pulse the marker names is in
		// frame, through to the end of the window the envelope covers.
		xRange: [Math.max(0, (stopS ?? w.i0 / rate) - LEAD_IN_S), Math.min(durationS, (w.i0 + w.env.length) / rate)],
		yRange: yWindow(amplitude(samples, w.i0, w.i0 + w.env.length)),
	};
}
