/**
 * The decay fit against the only ground truth there is: the twelve ring1
 * captures pulled off Gabe's board on 2026-08-22, plus synthetics whose
 * answer is known exactly.
 *
 * Why this file exists (GIT_33). Until 2026-08-23 the fit measured the ring
 * envelope with an FFT band mask and anchored peakG and the 15 % floor on the
 * argmax of that measurement. An ideal band mask is a zero-phase filter with
 * a sinc kernel roughly 1/(2·rel·f) long; a ring-down begins abruptly at the
 * stop, so the left half of that kernel sees nothing and the "envelope" RISES
 * for 20-50 ms before settling — and then overshoots. Fed a pure decaying
 * sinusoid, whose envelope cannot rise, the old estimator read 0.35× truth at
 * the stop, 1.00× at 60 ms and 1.52× at 120 ms. Where the argmax landed was
 * decided by noise, so ring1_Xp1 was rejected "short-decay" while its five
 * identical siblings were accepted.
 *
 * So the tests below are not a snapshot of today's numbers. Two of them state
 * the physics — a decaying sinusoid's envelope decays from the first sample,
 * and peakG is the ring amplitude — and those are the two that fail against
 * the old estimator. The per-capture table exists so a change to the fit has
 * to be argued rather than absorbed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detectStop, parseCapture } from "../src/shaping/engine/capture.ts";
import * as spectrum from "../src/shaping/engine/spectrum.ts";
import {
	aggregate,
	DECAY_FLOOR,
	fitDecay,
	isMode,
	MAX_FIT_ZETA,
	MIN_CYCLES,
	modeEnvelope,
	type Axis,
	type Mode,
	type NoFit,
} from "../src/shaping/engine/fit.ts";
import { hz, seconds } from "../src/shaping/engine/units.ts";

const NAMES = ["Xm0", "Xm1", "Xm2", "Xp0", "Xp1", "Xp2", "Ym0", "Ym1", "Ym2", "Yp0", "Yp1", "Yp2"] as const;

function ring1(name: string): { axis: Axis; fit: Mode | NoFit; rate: number } {
	const text = readFileSync(new URL(`./fixtures/shaping/ring1/ring1_${name}.csv`, import.meta.url), "utf8");
	const parsed = parseCapture(text);
	assert.ok(parsed.ok, `parseCapture rejected ring1_${name}.csv`);
	const axis = (name[0] as Axis);
	const data = axis === "X" ? parsed.capture.x : parsed.capture.y;
	const tStop = detectStop(data, parsed.capture.rate);
	assert.ok(tStop !== null, `no stop detected in ring1_${name}.csv`);
	return { axis, fit: fitDecay(data, parsed.capture.rate, tStop), rate: parsed.capture.rate };
}

/**
 * A pure decaying sinusoid: the one signal whose envelope is known in closed
 * form and provably cannot rise. `tStop` is 0.03 s and the fit starts 10 ms
 * later, so the amplitude it should report is amp·exp(-zeta·wn·0.01).
 */
function pureRing(f: number, zeta: number, amp: number, rate = 1379): Float64Array {
	const n = Math.round(1.1 * rate);
	const x = new Float64Array(n);
	const wn = 2 * Math.PI * f;
	const wd = wn * Math.sqrt(1 - zeta * zeta);
	for (let i = 0; i < n; i++) {
		const t = i / rate - 0.03;
		if (t >= 0) x[i] = amp * Math.exp(-zeta * wn * t) * Math.cos(wd * t);
	}
	return x;
}

const ringAmplitudeAtFitStart = (f: number, zeta: number, amp: number): number => amp * Math.exp(-zeta * 2 * Math.PI * f * 0.01);

// --- the physics ------------------------------------------------------------

test("peakG is the ring amplitude, not whatever a filter transient peaked at", () => {
	// The falsifying arm. Against the band-mask estimator these ratios came
	// out at 0.35-0.60, because its reading at the argmax is a filter
	// artefact rather than the ring. Nothing here depends on the current
	// implementation: `amp` is what the signal was built with.
	for (const [f, zeta, amp] of [
		[18, 0.05, 0.10],
		[18, 0.127, 0.10],
		[38, 0.1, 0.5],
		[51.5, 0.076, 0.12],
		[90, 0.03, 0.4],
	] as const) {
		const r = fitDecay(pureRing(f, zeta, amp), hz(1379), seconds(0.03));
		assert.ok(isMode(r), `${f} Hz / ${zeta} did not fit: ${JSON.stringify(r)}`);
		const truth = ringAmplitudeAtFitStart(f, zeta, amp);
		const ratio = (r.peakG as number) / truth;
		assert.ok(ratio > 0.9 && ratio < 1.1, `${f} Hz / zeta ${zeta}: peakG ${r.peakG} is ${ratio.toFixed(2)}x the ring amplitude ${truth.toFixed(4)}`);
	}
});

test("the reported envelope decays from the first sample of the analysis region", () => {
	// Both arms of the invariant `one-envelope-and-it-is-fitted`: every Mode
	// the twelve real captures produce, and every Mode a synthetic produces,
	// yields an envelope that is strictly decreasing everywhere. It cannot do
	// otherwise — it is peakG·exp(-2π·f·zeta·t) with zeta >= 0.005 — and that
	// is the point: there is no sampled envelope left to rise.
	const modes: Mode[] = [];
	for (const name of NAMES) {
		const { fit } = ring1(name);
		if (isMode(fit)) modes.push(fit);
	}
	const synth = fitDecay(pureRing(18, 0.127, 0.1), hz(1379), seconds(0.03));
	assert.ok(isMode(synth));
	modes.push(synth);
	assert.ok(modes.length === NAMES.length + 1, `expected 13 modes, got ${modes.length}`);
	for (const m of modes) {
		const env = modeEnvelope(m, hz(1379), 400);
		assert.equal(env[0], m.peakG as number, "the envelope starts at the ring amplitude");
		for (let i = 1; i < env.length; i++) {
			assert.ok(env[i]! < env[i - 1]!, `envelope rose at sample ${i} for ${m.f.toFixed(2)} Hz / zeta ${m.zeta.toFixed(4)}`);
		}
	}
});

test("the engine offers no measured envelope for anything to draw or fit", () => {
	// The choke point behind the invariant. A second producer of an envelope
	// is exactly how this bug got in, so the absence is asserted rather than
	// left to reviewers: spectrum.ts exports a band-passed SIGNAL and nothing
	// that returns a magnitude over time.
	const exported = Object.keys(spectrum).sort();
	assert.deepEqual(exported, ["amplitudeSpectrum", "bandPass", "fft", "ifft", "peakHz"]);
	// And what bandPass returns really is a signal: it swings through zero.
	const band = spectrum.bandPass(pureRing(18, 0.05, 0.1, 1379), hz(1379), hz(18));
	let neg = 0;
	let pos = 0;
	for (const v of band) {
		if (v < -0.005) neg++;
		if (v > 0.005) pos++;
	}
	assert.ok(neg > 20 && pos > 20, `bandPass looks like a magnitude, not a signal (${neg} below, ${pos} above)`);
});

// --- the acceptance rule and its margin -------------------------------------

test("cyclesFit is the decay span implied by zeta, so noise cannot pick the survivors", () => {
	// The old rule counted samples between a noisy argmax and a noisy floor
	// crossing. It is now an identity: reaching DECAY_FLOOR takes
	// ln(1/0.15)/(2π·zeta) cycles, whatever the frequency. The two-cycle
	// minimum is therefore a cap on zeta, and MAX_FIT_ZETA is where it bites.
	assert.ok(Math.abs(MAX_FIT_ZETA - 0.15097) < 1e-4, `MAX_FIT_ZETA ${MAX_FIT_ZETA}`);
	assert.equal(MIN_CYCLES, 2);
	assert.equal(DECAY_FLOOR, 0.15);
	for (const name of NAMES) {
		const { fit } = ring1(name);
		assert.ok(isMode(fit), `${name} did not fit`);
		const implied = Math.log(1 / DECAY_FLOOR) / (2 * Math.PI * fit.zeta);
		assert.ok(Math.abs(fit.cyclesFit - implied) < 1e-9, `${name}: cyclesFit ${fit.cyclesFit} != ${implied}`);
	}
});

test("the two-cycle cut sits at MAX_FIT_ZETA and reports the near-miss", () => {
	const below = fitDecay(pureRing(40, 0.14, 0.3), hz(1379), seconds(0.03));
	assert.ok(isMode(below), `zeta 0.14 should fit: ${JSON.stringify(below)}`);
	assert.ok(below.cyclesFit > MIN_CYCLES, `cyclesFit ${below.cyclesFit}`);

	const above = fitDecay(pureRing(40, 0.19, 0.3), hz(1379), seconds(0.03));
	assert.ok(!isMode(above) && above.reason === "short-decay", JSON.stringify(above));
	// Ticket #33 item 3: a rejection says how short it actually was, so a
	// near-miss reads as one rather than as a verdict.
	assert.ok(above.cyclesFit !== undefined, "short-decay must report cyclesFit");
	assert.ok(above.cyclesFit < MIN_CYCLES && above.cyclesFit > 1.3, `cyclesFit ${above.cyclesFit}`);
	assert.ok(above.f !== undefined && above.peakG !== undefined);
});

test("X margin on Gabe's machine: every capture clears two cycles with room in zeta", () => {
	// The ticket's original complaint was that all six X captures sat at
	// 2.14-2.20 cycles against a threshold of 2.0 — a 7-10 % margin decided
	// by noise. Anchored on the fit they sit at 2.50-3.25.
	const x = NAMES.filter((n) => n[0] === "X").map((n) => ring1(n).fit);
	assert.ok(x.every(isMode), "an X capture stopped fitting");
	const cycles = (x as Mode[]).map((m) => m.cyclesFit);
	const zetas = (x as Mode[]).map((m) => m.zeta);
	assert.ok(Math.min(...cycles) > 2.4, `worst X cyclesFit ${Math.min(...cycles).toFixed(3)}`);
	assert.ok(Math.max(...zetas) < 0.13, `worst X zeta ${Math.max(...zetas).toFixed(4)}`);
	// Headroom before the axis stops fitting at all, stated as a number so a
	// future change to the envelope or the floor has to move it visibly.
	const headroom = MAX_FIT_ZETA / Math.max(...zetas) - 1;
	assert.ok(headroom > 0.2, `only ${(headroom * 100).toFixed(0)} % of headroom in zeta`);
});

// --- the twelve captures ----------------------------------------------------

/**
 * Pinned 2026-08-23 from the captures in test/fixtures/shaping/ring1, which
 * came off the board on 2026-08-22. Frequency is unchanged from the prototype
 * (`tools/accel/runs/ring/ring1/fingerprint.json`) to the last digit, because
 * it is still the same zero-padded spectral peak. Damping and peak are NOT:
 * the prototype shares the band-mask envelope this ticket removed.
 */
const EXPECTED: Record<string, { f: number; zeta: number; peakG: number; cycles: number }> = {
	Xm0: { f: 18.012, zeta: 0.1044, peakG: 0.0983, cycles: 2.892 },
	Xm1: { f: 18.362, zeta: 0.1102, peakG: 0.1014, cycles: 2.739 },
	Xm2: { f: 18.127, zeta: 0.1052, peakG: 0.0995, cycles: 2.869 },
	Xp0: { f: 18.141, zeta: 0.1199, peakG: 0.1020, cycles: 2.519 },
	Xp1: { f: 17.844, zeta: 0.0930, peakG: 0.0929, cycles: 3.246 },
	Xp2: { f: 18.167, zeta: 0.1207, peakG: 0.1055, cycles: 2.502 },
	Ym0: { f: 51.510, zeta: 0.0322, peakG: 0.1220, cycles: 9.375 },
	Ym1: { f: 51.361, zeta: 0.0323, peakG: 0.1205, cycles: 9.348 },
	Ym2: { f: 52.574, zeta: 0.0344, peakG: 0.1150, cycles: 8.774 },
	Yp0: { f: 51.679, zeta: 0.0309, peakG: 0.1054, cycles: 9.771 },
	Yp1: { f: 51.829, zeta: 0.0346, peakG: 0.1207, cycles: 8.733 },
	Yp2: { f: 51.379, zeta: 0.0350, peakG: 0.1335, cycles: 8.617 },
};

for (const name of NAMES) {
	test(`ring1_${name} fits, and to the values pinned on 2026-08-23`, () => {
		const { fit } = ring1(name);
		assert.ok(isMode(fit), `ring1_${name} did not fit: ${JSON.stringify(fit)}`);
		const want = EXPECTED[name]!;
		assert.ok(Math.abs(fit.f - want.f) < 0.01, `f ${fit.f} vs ${want.f}`);
		assert.ok(Math.abs(fit.zeta - want.zeta) < 0.002, `zeta ${fit.zeta} vs ${want.zeta}`);
		assert.ok(Math.abs(fit.peakG - want.peakG) < 0.002, `peakG ${fit.peakG} vs ${want.peakG}`);
		assert.ok(Math.abs(fit.cyclesFit - want.cycles) < 0.05, `cyclesFit ${fit.cyclesFit} vs ${want.cycles}`);
	});
}

test("all twelve real captures fit — none is rejected, and none is close to being", () => {
	const fits = NAMES.map((n) => ring1(n));
	assert.equal(fits.filter((r) => isMode(r.fit)).length, 12, fits.map((r, i) => (isMode(r.fit) ? "" : `${NAMES[i]}:${(r.fit as NoFit).reason}`)).filter(Boolean).join(","));
	const fp = aggregate(fits.map((r) => ({ axis: r.axis, fit: r.fit })));
	assert.equal(fp.n.X, 6);
	assert.equal(fp.n.Y, 6);
	// Frequency medians still match the prototype's 18.1 / 51.6 Hz.
	assert.ok(Math.abs(fp.X!.f - 18.14) < 0.1, `X ${fp.X!.f}`);
	assert.ok(Math.abs(fp.Y!.f - 51.68) < 0.2, `Y ${fp.Y!.f}`);
	assert.ok(Math.abs(fp.X!.zeta - 0.110) < 0.005, `X zeta ${fp.X!.zeta}`);
	assert.ok(Math.abs(fp.Y!.zeta - 0.034) < 0.005, `Y zeta ${fp.Y!.zeta}`);
});

test("the six repeats of an axis agree, so which captures survive is not a coin flip", () => {
	// The ticket's real complaint. Six nominally identical moves per axis: if
	// the estimator is stable their spread is small, and no threshold can
	// separate them. Under the band-mask estimator X peakG scattered by 8 %
	// around a floor that decided acceptance.
	for (const axis of ["X", "Y"] as const) {
		const modes = NAMES.filter((n) => n[0] === axis).map((n) => ring1(n).fit).filter(isMode);
		assert.equal(modes.length, 6, `${axis}: only ${modes.length} of 6 fitted`);
		const cv = (v: number[]): number => {
			const m = v.reduce((a, b) => a + b, 0) / v.length;
			return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) / m;
		};
		assert.ok(cv(modes.map((m) => m.f as number)) < 0.015, `${axis} f CV ${cv(modes.map((m) => m.f as number))}`);
		assert.ok(cv(modes.map((m) => m.zeta)) < 0.12, `${axis} zeta CV ${cv(modes.map((m) => m.zeta))}`);
		assert.ok(cv(modes.map((m) => m.peakG as number)) < 0.09, `${axis} peakG CV ${cv(modes.map((m) => m.peakG as number))}`);
	}
});
