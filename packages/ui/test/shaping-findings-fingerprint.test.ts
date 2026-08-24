/**
 * What a fingerprint can say about its own trustworthiness.
 *
 * The three numbers here are the ones worked out by hand on 2026-08-23: X
 * spreads 4.48 Hz one way against 0.23 Hz the other; seven of ten Y captures
 * refused short of the two cycles a fit needs, against a ζ cap of 0.1510; the
 * median that survived rests on three captures.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprintCaveats } from "../src/shaping/evidence/findings.ts";
import { type Fingerprint, MAX_FIT_ZETA, type Mode } from "../src/shaping/engine/fit.ts";
import type { CaptureRecord } from "../src/shaping/results.ts";
import { g, hz, seconds } from "../src/shaping/engine/units.ts";

const mode = (f: number): Mode => ({ f: hz(f), zeta: 0.05, peakG: g(0.1), cyclesFit: 4 } as Mode);

const fit = (axis: "X" | "Y", dir: "+" | "-", rep: number, f: number): CaptureRecord =>
	({ file: `${axis}${dir}${rep}.csv`, axis, dir, rep, fit: mode(f), tStop: seconds(0.5) });

const refused = (axis: "X" | "Y", dir: "+" | "-", rep: number): CaptureRecord =>
	({
		file: `${axis}${dir}${rep}.csv`,
		axis,
		dir,
		rep,
		fit: { reason: "damping-out-of-range", f: hz(41.5), cyclesFit: 1.9 },
		tStop: seconds(0.5),
	});

test("the two-cycle cap is exactly ln(1/0.15)/4pi", () => {
	// Pinned because the sentence quotes it: if the floor or the cycle count
	// ever moves, the copy must move with it rather than quoting a stale number.
	assert.ok(Math.abs(MAX_FIT_ZETA - 0.1510) < 0.0001, `cap is ${MAX_FIT_ZETA}`);
});

test("a direction that spreads across the robustness band is called out", () => {
	// X plus spreads 4.48 Hz on an 18.14 Hz mode (24.7 %); minus spreads 0.23
	// (1.3 %). The rule is 10 % — the same ±10 % the Candidates card ranks over.
	const caps = [
		fit("X", "+", 0, 16.0), fit("X", "+", 1, 18.14), fit("X", "+", 2, 20.48),
		fit("X", "-", 0, 18.03), fit("X", "-", 1, 18.14), fit("X", "-", 2, 18.26),
	];
	const fp: Fingerprint = { X: mode(18.14), Y: null, n: { X: 6, Y: 0 }, spreadHz: { X: 4.48, Y: 0 } };
	const c = fingerprintCaveats(fp, caps, null).find((x) => x.kind === "direction-spread");
	assert.ok(c !== undefined && c.kind === "direction-spread", "the asymmetry must be reported");
	assert.equal(c.axis, "X");
	assert.ok(Math.abs(c.plusHz - 4.48) < 0.01, `plus ${c.plusHz}`);
	assert.ok(Math.abs(c.minusHz - 0.23) < 0.01, `minus ${c.minusHz}`);
});

test("a symmetric axis says nothing", () => {
	const caps = [
		fit("X", "+", 0, 18.03), fit("X", "+", 1, 18.14),
		fit("X", "-", 0, 18.10), fit("X", "-", 1, 18.20),
	];
	const fp: Fingerprint = { X: mode(18.14), Y: null, n: { X: 4, Y: 0 }, spreadHz: { X: 0.17, Y: 0 } };
	assert.equal(fingerprintCaveats(fp, caps, null).filter((c) => c.kind === "direction-spread").length, 0);
});

/** Three fits and seven refusals on Y, as the real run produced. */
const SEVEN_OF_TEN: CaptureRecord[] = [
	fit("Y", "+", 0, 41.5), fit("Y", "+", 1, 41.5), fit("Y", "+", 2, 41.5),
	...[0, 1, 2, 3].map((i) => refused("Y", "+", 3 + i)),
	...[0, 1, 2].map((i) => refused("Y", "-", i)),
];
const FP_Y: Fingerprint = { X: null, Y: mode(41.5), n: { X: 0, Y: 3 }, spreadHz: { X: 0, Y: 0.1 } };

test("refusals clustered on the damping cap are reported as arithmetic", () => {
	const c = fingerprintCaveats(FP_Y, SEVEN_OF_TEN, null).find((x) => x.kind === "fits-refused");
	assert.ok(c !== undefined && c.kind === "fits-refused");
	assert.equal(c.axis, "Y");
	assert.equal(c.refused, 7);
	assert.equal(c.of, 10);
	assert.ok(Math.abs(c.cap - MAX_FIT_ZETA) < 1e-9, "the cap must be the fitter's own constant");
	// The MEASURED quantity, not a back-computed zeta.
	assert.ok(c.cyclesFit !== null && Math.abs(c.cyclesFit - 1.9) < 1e-9, `cycles ${c.cyclesFit}`);
});

test("refusals and a thin median are two findings, not one", () => {
	// They used to be conflated: `few-fits` fired on `n < attempted / 2`, which
	// both missed the case at exactly half AND said "the median is thin" when
	// what had actually happened was "seven captures were refused". Three fits
	// IS a median; the seven refusals beside it are their own story.
	const cs = fingerprintCaveats(FP_Y, SEVEN_OF_TEN, null);
	assert.equal(cs.filter((c) => c.kind === "few-fits").length, 0, "three is a median");
	const refused = cs.find((c) => c.kind === "fits-refused");
	assert.ok(refused !== undefined && refused.kind === "fits-refused");
	assert.equal(refused.refused, 7);
	assert.equal(refused.of, 10);
});

test("with no sweep, the locus question is answered as unasked", () => {
	// Silence would read as "checked, and fine" — the distinction the whole
	// layer exists to keep.
	const fp: Fingerprint = { X: mode(38.7), Y: null, n: { X: 5, Y: 0 }, spreadHz: { X: 0.2, Y: 0 } };
	assert.ok(fingerprintCaveats(fp, [], null).some((c) => c.kind === "mode-locus-unknown"));
});

test("with no modes at all there is nothing to say about a missing sweep", () => {
	const empty: Fingerprint = { X: null, Y: null, n: { X: 0, Y: 0 }, spreadHz: { X: 0, Y: 0 } };
	assert.equal(fingerprintCaveats(empty, [], null).length, 0);
});
