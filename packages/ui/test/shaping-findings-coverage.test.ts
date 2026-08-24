/**
 * Coverage findings, all four written against the state Gabe's board was
 * actually in on 2026-08-24 — 40 captures where every `Y+` pass was refused
 * with `short-decay`, so the Y figure rested entirely on `Y-`, and two of the
 * ten survivors sat 7 Hz below the other eight.
 *
 * Nothing said any of it. The three bugs that let that happen are each pinned
 * below, because each was a DIFFERENT kind of mistake and a single regression
 * test would not have caught the other two.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprintCaveats } from "../src/shaping/evidence/findings.ts";
import { caveatText } from "../src/shaping/copy.ts";
import type { Fingerprint, Mode, NoFit } from "../src/shaping/engine/fit.ts";
import type { CaptureRecord } from "../src/shaping/results.ts";
import { g, hz, seconds } from "../src/shaping/engine/units.ts";

const mode = (f: number): Mode => ({ f: hz(f), zeta: 0.08, peakG: g(0.2), cyclesFit: 4 } as Mode);

const fit = (axis: "X" | "Y", dir: "+" | "-", rep: number, f: number): CaptureRecord =>
	({ file: `t0_ring_${axis}${dir}${rep}.csv`, axis, dir, rep, fit: mode(f), tStop: seconds(0.5) });

const no = (axis: "X" | "Y", dir: "+" | "-", rep: number, reason: NoFit["reason"], cyclesFit?: number): CaptureRecord =>
	({ file: `t0_ring_${axis}${dir}${rep}.csv`, axis, dir, rep, fit: { reason, cyclesFit }, tStop: seconds(0.5) });

/** The board's real Y: ten refusals on the plus side, ten fits on the minus. */
const REAL_Y: CaptureRecord[] = [
	...Array.from({ length: 10 }, (_, i) => no("Y", "+", i, "short-decay", 1.4)),
	...[42.66, 42.8, 49.49, 49.72, 49.96, 50.05, 50.33, 50.46, 50.65, 51.57].map((f, i) => fit("Y", "-", i, f)),
];
const FP_Y: Fingerprint = { X: null, Y: mode(50.05), n: { X: 0, Y: 10 }, spreadHz: { X: 0, Y: 8.91 } };

const kinds = (cs: readonly { kind: string }[]) => cs.map((c) => c.kind);

test("BUG 1: a direction with no fits is not a direction with zero spread", () => {
	// The worst of the three. spreadOf([]) returned 0, so the finding reported
	// "0.00 Hz of spread in the plus direction" for ten captures that produced
	// no measurement at all — a fabricated number, which is the one thing this
	// layer must never emit.
	const cs = fingerprintCaveats(FP_Y, REAL_Y, null);
	const spread = cs.find((c) => c.kind === "direction-spread");
	assert.equal(spread, undefined, "must not compare against a direction that fitted nothing");
});

test("BUG 2: an axis resting on one direction says so", () => {
	const cs = fingerprintCaveats(FP_Y, REAL_Y, null);
	const c = cs.find((x) => x.kind === "one-direction-only");
	assert.ok(c !== undefined && c.kind === "one-direction-only");
	assert.equal(c.axis, "Y");
	assert.equal(c.dir, "-");
	assert.equal(c.n, 10);
	// The ring-down happens at the opposite end of travel each way, so one
	// direction means one END of the axis has been characterised.
	assert.match(caveatText(c), /minus|end/i);
});

test("BUG 3: refusals are reported whatever reason they carry", () => {
	// fits-at-damping-cap only matched "damping-out-of-range". These ten were
	// "short-decay", so half the captures vanished silently.
	const cs = fingerprintCaveats(FP_Y, REAL_Y, null);
	const c = cs.find((x) => x.kind === "fits-refused");
	assert.ok(c !== undefined && c.kind === "fits-refused");
	assert.equal(c.refused, 10);
	assert.equal(c.of, 20);
	assert.equal(c.reason, "short-decay");
	assert.match(caveatText(c), /10 of 20/);
});

test("the damping cap keeps its own arithmetic sentence", () => {
	// Generalising the finding must not lose the one reason that has a
	// checkable number behind it: a ring that dies inside two cycles cannot be
	// fitted, and quoting the cap is what turns "noise" into arithmetic.
	const caps = [
		...Array.from({ length: 7 }, (_, i) => no("Y", "+", i, "damping-out-of-range", 1.9)),
		...[41.4, 41.5, 41.6].map((f, i) => fit("Y", "-", i, f)),
	];
	const fp: Fingerprint = { X: null, Y: mode(41.5), n: { X: 0, Y: 3 }, spreadHz: { X: 0, Y: 0.2 } };
	const c = fingerprintCaveats(fp, caps, null).find((x) => x.kind === "fits-refused");
	assert.ok(c !== undefined && c.kind === "fits-refused");
	assert.equal(c.reason, "damping-out-of-range");
	const text = caveatText(c);
	assert.match(text, /1\.9/, "the measured cycle count");
	assert.match(text, /0\.151/, "against the cap");
});

test("a clean axis in both directions says nothing at all", () => {
	// X on the same board: 20 fits, both directions, 0.65 Hz spread.
	const caps = [
		...[38.41, 38.52, 38.6, 38.66, 38.83].map((f, i) => fit("X", "+", i, f)),
		...[38.18, 38.52, 38.63, 38.69, 38.8].map((f, i) => fit("X", "-", i, f)),
	];
	const fp: Fingerprint = { X: mode(38.66), Y: null, n: { X: 10, Y: 0 }, spreadHz: { X: 0.65, Y: 0 } };
	assert.deepEqual(kinds(fingerprintCaveats(fp, caps, null)).filter((k) => k !== "mode-locus-unknown"), []);
});

test("few-fits is about the median being thin, not about refusals", () => {
	// Ten fits is a perfectly good median; the refusals beside it are what
	// fits-refused is for. Firing both on the same data said one thing twice.
	assert.equal(fingerprintCaveats(FP_Y, REAL_Y, null).filter((c) => c.kind === "few-fits").length, 0);
	const thin = [fit("X", "+", 0, 38.5), fit("X", "-", 0, 38.7)];
	const fp: Fingerprint = { X: mode(38.6), Y: null, n: { X: 2, Y: 0 }, spreadHz: { X: 0.2, Y: 0 } };
	const c = fingerprintCaveats(fp, thin, null).find((x) => x.kind === "few-fits");
	assert.ok(c !== undefined && c.kind === "few-fits", "a median over two is barely a median");
	assert.equal(c.n, 2);
});

test("both directions present and asymmetric still reports the spread", () => {
	// The original finding must survive the guard that fixed BUG 1.
	const caps = [
		...[16.0, 18.14, 20.48].map((f, i) => fit("X", "+", i, f)),
		...[18.03, 18.14, 18.26].map((f, i) => fit("X", "-", i, f)),
	];
	const fp: Fingerprint = { X: mode(18.14), Y: null, n: { X: 6, Y: 0 }, spreadHz: { X: 4.48, Y: 0 } };
	const c = fingerprintCaveats(fp, caps, null).find((x) => x.kind === "direction-spread");
	assert.ok(c !== undefined && c.kind === "direction-spread");
	assert.ok(Math.abs(c.plusHz - 4.48) < 0.01);
});
