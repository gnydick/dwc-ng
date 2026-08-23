import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCapture, detectStop } from "../src/shaping/engine/capture.ts";
import { amplitudeSpectrum, peakHz } from "../src/shaping/engine/spectrum.ts";
import { fitDecay, aggregate, isMode } from "../src/shaping/engine/fit.ts";
import { hz, seconds } from "../src/shaping/engine/units.ts";

const fx = (n: string): string => readFileSync(new URL(`./fixtures/shaping/${n}`, import.meta.url), "utf8");

/** Deterministic LCG noise so the test is repeatable. */
function noise(n: number, sigma: number, seed = 1): Float64Array {
	let s = seed >>> 0;
	const out = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		// Box–Muller on two LCG draws
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		const u1 = (s + 1) / 4294967297;
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		const u2 = (s + 1) / 4294967297;
		out[i] = sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
	}
	return out;
}

function synthDecay(f: number, zeta: number, amp: number, rate = 1344, tStop = 0.03): Float64Array {
	const n = Math.round(1.1 * rate);
	const x = noise(n, 0.01);
	const wn = 2 * Math.PI * f;
	const wd = wn * Math.sqrt(1 - zeta * zeta);
	for (let i = 0; i < n; i++) {
		const t = i / rate - tStop;
		if (t >= 0) x[i]! += amp * Math.exp(-zeta * wn * t) * Math.cos(wd * t);
	}
	return x;
}

test("amplitudeSpectrum of a pure sine peaks at its frequency with its amplitude", () => {
	const rate = 1344;
	const x = new Float64Array(2048);
	for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * 100 * i) / rate);
	const { freqs, amps } = amplitudeSpectrum(x, hz(rate));
	let k = 0;
	for (let i = 1; i < amps.length; i++) if (amps[i]! > amps[k]!) k = i;
	assert.ok(Math.abs(freqs[k]! - 100) < 1, `peak at ${freqs[k]}`);
	assert.ok(Math.abs(amps[k]! - 0.3) < 0.03, `amplitude ${amps[k]}`);
});

test("peakHz resolves a short burst to within 0.5 Hz", () => {
	const x = synthDecay(38, 0.1, 0.5);
	const seg = x.subarray(Math.round(0.04 * 1344), Math.round(0.64 * 1344));
	assert.ok(Math.abs(peakHz(seg, hz(1344), 5, 150) - 38) < 0.5);
});

for (const [f, zeta, amp] of [
	[14, 0.05, 0.3],
	[38, 0.1, 0.5],
	[55, 0.15, 0.2],
	[90, 0.03, 0.4],
] as const) {
	test(`fitDecay recovers ${f} Hz / zeta ${zeta} from a noisy synthetic decay`, () => {
		const r = fitDecay(synthDecay(f, zeta, amp), hz(1344), seconds(0.03));
		assert.ok(isMode(r), `no fit: ${JSON.stringify(r)}`);
		// A ring that dies in ~2 cycles (zeta 0.15) is located only to ~5 %;
		// lighter damping resolves to 2 %. Documented limit of the estimator.
		const fTol = zeta >= 0.15 ? 0.06 : 0.02;
		assert.ok(Math.abs(r.f - f) / f < fTol, `f ${r.f}`);
		assert.ok(Math.abs(r.zeta - zeta) / zeta < 0.25, `zeta ${r.zeta}`);
	});
}

test("fitDecay on noise alone reports below-floor, not a number", () => {
	const r = fitDecay(noise(1500, 0.005), hz(1344), seconds(0.03));
	assert.ok(!isMode(r) && r.reason === "below-floor");
});

test("fitDecay reproduces the prototype's X fingerprint from a real capture", () => {
	const r = parseCapture(fx("ring1_Xp0.csv"));
	assert.ok(r.ok);
	const tStop = detectStop(r.capture.x, r.capture.rate);
	assert.ok(tStop !== null);
	const fit = fitDecay(r.capture.x, r.capture.rate, tStop);
	assert.ok(isMode(fit), JSON.stringify(fit));
	assert.ok(Math.abs(fit.f - 18.1) < 0.5, `X f ${fit.f}`); // prototype 18.1
	assert.ok(Math.abs(fit.zeta - 0.127) < 0.03, `X zeta ${fit.zeta}`); // prototype 0.125
});

test("fitDecay reproduces the prototype's Y fingerprint from a real capture", () => {
	const r = parseCapture(fx("ring1_Yp0.csv"));
	assert.ok(r.ok);
	const tStop = detectStop(r.capture.y, r.capture.rate);
	assert.ok(tStop !== null);
	const fit = fitDecay(r.capture.y, r.capture.rate, tStop);
	assert.ok(isMode(fit), JSON.stringify(fit));
	assert.ok(Math.abs(fit.f - 51.7) < 1, `Y f ${fit.f}`); // prototype 51.7
	assert.ok(Math.abs(fit.zeta - 0.087) < 0.03, `Y zeta ${fit.zeta}`); // prototype 0.087
});

test("aggregate takes per-axis medians and reports spread and count", () => {
	const m = (f: number, zeta: number) => fitDecay(synthDecay(f, zeta, 0.3), hz(1344), seconds(0.03));
	const fp = aggregate([
		{ axis: "X", fit: m(18, 0.12) },
		{ axis: "X", fit: m(18.4, 0.13) },
		{ axis: "X", fit: m(17.8, 0.11) },
		{ axis: "Y", fit: { reason: "below-floor" } },
	]);
	assert.ok(fp.X && Math.abs(fp.X.f - 18) < 0.6 && fp.n.X === 3 && fp.spreadHz.X < 1);
	assert.equal(fp.Y, null);
	assert.equal(fp.n.Y, 0);
});
