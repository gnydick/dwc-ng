/**
 * The decay chart's data, derived — never asserted — from one fitted capture.
 *
 * Four things go on the chart and all four come from the same place:
 *
 *  - the raw accelerometer trace of the axis that moved;
 *  - the stop `detectStop` found, as a vertical marker;
 *  - the band-limited RING the fit was taken over, band-passed about the very
 *    frequency the fit reports;
 *  - the fitted envelope, `peakG · e^{−2πfζt}`, laid over that ring.
 *
 * Nothing here is a second measurement. The envelope is `modeEnvelope()` of the
 * Mode printed beside it (`engine/fit.ts`, invariant
 * `one-envelope-and-it-is-fitted`), so the curve on screen is not a curve that
 * agrees with the number — it IS the number, plotted. There is no measured
 * envelope in the engine for this module to reach for and no way to compute a
 * second one: `spectrum.ts` exports a band-passed signal and nothing that
 * returns an amplitude over time.
 *
 * The band trace and the envelope also start at the same sample, because the
 * region both are taken over comes from `decayWindow` (invariant
 * `one-decay-window`) rather than from this module's own arithmetic on tStop.
 * `modeEnvelope`'s sample 0 is the first sample of that region by definition,
 * so the two line up by construction.
 *
 * Until 2026-08-23 the third series was an FFT band-mask ENVELOPE and the
 * fourth was the exponential the fit implied — two curves that could disagree,
 * and did: the mask's magnitude rises for tens of milliseconds after an abrupt
 * ring onset, so the drawn "envelope" peaked wherever the artefact happened to
 * peak. GIT_33 deleted that measurement. Drawing the band-limited signal in its
 * place keeps the operator's evidence — you can still see the ring the fit was
 * taken from — without a second producer of an amplitude.
 *
 * Pure and JSX-free by design (the plan's data/JSX split): node:test cannot
 * import a `.tsx`, and everything worth asserting about this chart is a number
 * or a sentence, not a DOM.
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
 */
import type { AlignedData } from "../om/temperature.ts";
import {
	DECAY_FLOOR, decaySegment, decayWindow, FIT_DEFAULTS, isMode, MIN_CYCLES, modeEnvelope,
	type Mode, type NoFit,
} from "../shaping/engine/fit.ts";
import { bandPass } from "../shaping/engine/spectrum.ts";
import type { FitResult } from "../shaping/worker.ts";

/** How much ring-down the fit had, against how much it needs. */
export type DecayCycles = {
	/**
	 * Cycles the ring takes to fall from its amplitude to DECAY_FLOOR.
	 *
	 * Since GIT_33 this is `cyclesFit` — the identity ln(1/0.15)/(2πζ) the
	 * fitter itself applies — not a count of samples between two noisy indices.
	 * A capture the fitter DECLINED as short-decay reports the same figure, so
	 * the card can say how nearly it made it.
	 */
	readonly sustained: number;
	/** Cycles the fitter requires before it will report a damping ratio. */
	readonly needed: number;
};

export type DecayView = {
	/**
	 * `[t, raw, band, envelope]`, in seconds and g. Always four arrays of the
	 * same length: a series with nothing to say is all-null rather than short,
	 * so the chart's series count — and therefore its legend and its height —
	 * does not depend on whether the capture fitted.
	 */
	readonly data: AlignedData;
	/** Seconds at which the last acceleration pulse ended; null if none was found. */
	readonly stopS: number | null;
	/** The analysed window in seconds, or null when there was nothing to analyse. */
	readonly window: { readonly fromS: number; readonly toS: number } | null;
	/** The span the fitted envelope covers, in seconds: the region's start
	 *  through to DECAY_FLOOR, clipped to the window. Null without a Mode. */
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
 * Total over `Mode | NoFit`, and every branch quotes the fitter's own constants
 * rather than a literal — the sentence "the fit needs 2 cycles" is only true
 * while it is the fitter's own 2.
 *
 * The `short-decay` branch is the one that earns this function. It is a NEAR
 * MISS by construction: `cyclesFit` is ln(1/0.15)/(2πζ), so a rejection at 1.9
 * cycles means ζ came out a few per cent past MAX_FIT_ZETA, not that the
 * capture is junk — and the NoFit carries the frequency, the peak and the cycle
 * count it did reach. Saying so is the difference between an operator lowering
 * the speed and repeating the run, and one concluding the machine is broken.
 *
 * On Gabe's own baseline run that branch is now unreachable: since GIT_33 all
 * twelve ring1 captures fit, the worst X margin being 2.502 cycles against the
 * 2 required. It stays because a stiffer axis or a harder move can still ring
 * itself out inside two cycles, and the union is closed.
 */
export function fitNote(fit: Mode | NoFit, cycles: DecayCycles | null, stopFound = true): string {
	// `detectStop` finding nothing and the window being too short both reach
	// the fitter as `short-window`, and they are not the same news: the first
	// is "this axis never accelerated" — what you get switching to the axis
	// that stood still during the move — and the second is "capture for
	// longer". The card knows which happened; the fitter, given only samples,
	// does not.
	if (!stopFound) return "No stop was detected on this axis: nothing here accelerated hard enough to ring.";
	const pct = Math.round(DECAY_FLOOR * 100);
	if (isMode(fit)) {
		return `Fitted over ${fit.cyclesFit.toFixed(2)} cycles, from the ring amplitude down to ${pct} % of it.`;
	}
	const measured = `The fit did measure ${(fit.f ?? 0).toFixed(1)} Hz at ${g3(fit.peakG ?? 0)} g.`;
	switch (fit.reason) {
		case "short-window":
			return `Under ${FIT_DEFAULTS.minWindowS} s of samples follow the stop — no ring-down to analyse. Capture for longer.`;
		case "below-floor":
			return `Peak ${g3(fit.peakG ?? 0)} g after the stop, under the ${FIT_DEFAULTS.floorG} g floor: this axis did not ring.`;
		case "short-decay": {
			const had = cycles === null ? `under ${MIN_CYCLES}` : cycles.sustained.toFixed(2);
			return `Near miss: the ring reaches ${pct} % of peak in ${had} cycles and a ζ needs ${MIN_CYCLES}. ${measured}`;
		}
		case "damping-out-of-range":
			return `The fitted decay put ζ outside 0.005–0.5, which is not a decaying ring. ${measured}`;
	}
}

/**
 * `cyclesFit` off either arm of the union, or null where there is none.
 *
 * A Mode always carries it; a `short-decay` NoFit carries it precisely so the
 * near miss can be quoted; the other refusals never got far enough to have one.
 */
function cyclesOf(fit: Mode | NoFit): number | null {
	if (isMode(fit)) return fit.cyclesFit;
	return fit.cyclesFit ?? null;
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
	const band = nulls(n);
	const envelope = nulls(n);
	const durationS = n / rate;

	const stopS = capture.tStop === null ? null : (capture.tStop as number);
	const w = capture.tStop === null ? null : decayWindow(samples, capture.rate, capture.tStop);
	if (w === null) {
		// Nothing was analysed, so there is no ring to frame: show the lot.
		return {
			data: [t, raw, band, envelope],
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

	const span = w.i1 - w.i0;
	const fit = capture.fit;
	const f = fit.f;

	// The ring the fit was taken over, isolated from broadband noise. Not an
	// amplitude — a signal that swings through zero, which is why the fitted
	// envelope drawn on top of it reads as an envelope. The band is centred on
	// the frequency the fit REPORTS, so there is no second choice of centre to
	// disagree with the one the fit used, and it runs over the fitter's own
	// mean-removed segment rather than a raw slice.
	if (f !== undefined) {
		const ring = bandPass(decaySegment(samples, w), capture.rate, f);
		for (let i = 0; i < span && w.i0 + i < n; i++) band[w.i0 + i] = ring[i]!;
	}

	// The envelope. `modeEnvelope` IS the fit — three numbers evaluated, not a
	// measurement — and its sample 0 is w.i0 by definition.
	if (isMode(fit)) {
		const env = modeEnvelope(fit, capture.rate, span);
		for (let i = 0; i < span && w.i0 + i < n; i++) envelope[w.i0 + i] = env[i]!;
	}

	const sustained = cyclesOf(fit);
	const cycles: DecayCycles | null = sustained === null ? null : { sustained, needed: MIN_CYCLES };

	return {
		data: [t, raw, band, envelope],
		stopS,
		window: { fromS: w.i0 / rate, toS: w.i1 / rate },
		// Where the envelope crosses DECAY_FLOOR, which is cyclesFit periods
		// after the region opens — the span the reported ζ is a statement about.
		decay: !isMode(fit)
			? null
			: { fromS: w.i0 / rate, toS: Math.min(w.i1 / rate, w.i0 / rate + fit.cyclesFit / (fit.f as number)) },
		cycles,
		note: fitNote(fit, cycles, true),
		durationS,
		// A little before the stop, so the decel pulse the marker names is in
		// frame, through to the end of the window the envelope covers.
		xRange: [Math.max(0, (stopS ?? w.i0 / rate) - LEAD_IN_S), Math.min(durationS, w.i1 / rate)],
		yRange: yWindow(amplitude(samples, w.i0, w.i1)),
	};
}
