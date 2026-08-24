/**
 * The finding that would have prevented the 2026-08-23 wrong conclusion.
 *
 * Gabe read the sweep heat map, saw black where the magenta fingerprint markers
 * stood, and concluded the fingerprint was garbage. It might be — but that
 * sweep could not have shown those modes. The ladder ran 25–200 mm/s; at 5 full
 * steps/mm the forcing band is 125–1000 Hz and the modes are at 38.7 and 41.5.
 * Nothing drove them.
 *
 * The arithmetic here is deterministic and does not depend on the fitter, so
 * these are exact-number assertions rather than characterisation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { forcingBand, fullStepsPerMmOf, sweepCaveats } from "../src/shaping/evidence/findings.ts";
import type { SweepMatrix } from "../src/shaping/engine/sweep.ts";
import type { Fingerprint, Mode } from "../src/shaping/engine/fit.ts";
import { g, hz, mmPerS } from "../src/shaping/engine/units.ts";

/** The real ladder, from tools/accel/runs/ui-first-run-2026-08-23/. */
const LADDER = [25, 34, 45, 61, 82, 110, 149, 200];
const PER_MM = 5;

/** A matrix with the real speeds; the amplitudes are what this finding is NOT
 *  about, so one non-zero bin per row keeps every row "analysed". */
const matrix = (speeds: readonly number[] = LADDER, perMm = PER_MM): SweepMatrix => {
	const maxHz = 700;
	const nBins = maxHz + 1;
	const freqs = new Float64Array(nBins);
	for (let i = 0; i < nBins; i++) freqs[i] = i;
	const amps = new Float64Array(speeds.length * nBins);
	for (let r = 0; r < speeds.length; r++) amps[r * nBins + 100] = 0.01;
	return {
		speeds: speeds.map(mmPerS),
		freqs,
		amps,
		fullStepHz: speeds.map((s) => hz(s * perMm)),
		maxHz,
	};
};

const mode = (f: number): Mode => ({ f: hz(f), zeta: 0.05, peakG: g(0.1), cyclesFit: 4 } as Mode);

const FP: Fingerprint = { X: mode(38.7), Y: mode(41.5), n: { X: 5, Y: 3 }, spreadHz: { X: 0.4, Y: 0.4 } };

test("the full-step rate is recovered from the matrix itself", () => {
	// No new plumbing: fullStepHz[i] / speeds[i] is the rate the matrix was
	// built with, so the finding cannot disagree with the chart's own locus.
	assert.equal(fullStepsPerMmOf(matrix()), 5);
});

test("the forcing band is the ladder's two ends times that rate", () => {
	const band = forcingBand(matrix());
	assert.ok(band !== null);
	assert.equal(band[0], 125);
	assert.equal(band[1], 1000);
});

test("both modes are reported as undriven, with the speed that would drive them", () => {
	const cs = sweepCaveats(matrix(), FP).filter((c) => c.kind === "forcing-band-excludes-mode");
	assert.equal(cs.length, 2, "one per mode outside the band");

	const x = cs.find((c) => c.axis === "X");
	assert.ok(x !== undefined && x.kind === "forcing-band-excludes-mode");
	assert.equal(x.modeHz, 38.7);
	assert.deepEqual([Number(x.bandHz[0]), Number(x.bandHz[1])], [125, 1000]);
	// 38.7 Hz / 5 full steps per mm.
	assert.ok(Math.abs(x.needMmPerS - 7.74) < 0.01, `needed ${x.needMmPerS}`);

	const y = cs.find((c) => c.axis === "Y");
	assert.ok(y !== undefined && y.kind === "forcing-band-excludes-mode");
	assert.ok(Math.abs(y.needMmPerS - 8.3) < 0.01, `needed ${y.needMmPerS}`);
});

test("a ladder that DOES bracket the modes says nothing", () => {
	// 5–15 mm/s at 5 steps/mm forces 25–75 Hz, which contains both modes.
	const cs = sweepCaveats(matrix([5, 8, 11, 15]), FP);
	assert.equal(cs.filter((c) => c.kind === "forcing-band-excludes-mode").length, 0);
});

test("a mode sitting ON the locus is reported as forced, not as missing", () => {
	// 125 Hz is exactly what 25 mm/s forces at 5 steps/mm.
	const onLocus: Fingerprint = { ...FP, X: mode(125), Y: null, n: { X: 5, Y: 0 }, spreadHz: { X: 0.4, Y: 0 } };
	const cs = sweepCaveats(matrix(), onLocus);
	assert.equal(cs.filter((c) => c.kind === "forcing-band-excludes-mode").length, 0);
	const forced = cs.find((c) => c.kind === "mode-on-forcing-locus");
	assert.ok(forced !== undefined && forced.kind === "mode-on-forcing-locus", "a mode on the locus must be called out");
	assert.equal(forced.speedMmPerS, 25);
});

test("rows the transform could not use are reported as missing, not quiet", () => {
	const m = matrix();
	// Blank row 3 entirely — that is what sweepMatrix leaves for a capture with
	// no cruise window in it.
	const nBins = m.freqs.length;
	m.amps[3 * nBins + 100] = 0;
	const c = sweepCaveats(m, FP).find((x) => x.kind === "rows-not-analysed");
	assert.ok(c !== undefined && c.kind === "rows-not-analysed");
	assert.equal(c.rows, 8);
	assert.equal(c.analysed, 7);
});

test("no fingerprint means no coverage claim either way", () => {
	assert.equal(sweepCaveats(matrix(), null).filter((c) => c.kind === "forcing-band-excludes-mode").length, 0);
});
