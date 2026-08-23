import { test } from "node:test";
import assert from "node:assert/strict";
import { impulses, zv, convolve, SHAPER_TYPES, type ShaperSpec } from "../src/shaping/engine/shapers.ts";
import { residual, robust } from "../src/shaping/engine/residual.ts";
import { hz, seconds } from "../src/shaping/engine/units.ts";
import { modeForTest } from "./helpers/shaping.ts";

const M40 = modeForTest(40, 0.1);

for (const type of SHAPER_TYPES) {
	test(`${type}: impulses are sane (sum 1, positive, increasing times)`, () => {
		const { A, T } = impulses({ type, F: hz(40), S: 0.1 });
		let sum = 0;
		for (const a of A) {
			assert.ok(a > 0, `amplitude ${a}`);
			sum += a;
		}
		assert.ok(Math.abs(sum - 1) < 1e-9);
		assert.equal(T[0], 0);
		for (let i = 1; i < T.length; i++) assert.ok(T[i]! > T[i - 1]!);
	});

	test(`${type}: tuned residual is small; detuned is worse`, () => {
		const imp = impulses({ type, F: hz(40), S: 0.1 });
		const r0 = residual(imp, M40);
		// RRF orders MZV's amplitudes the reverse of Klipper's; at zeta 0.1
		// that leaves ~16 % at exact tuning. Modelled as the firmware does it.
		assert.ok(r0 < (type === "mzv" ? 0.2 : 0.06), `${type} tuned ${r0}`);
		const r1 = residual(imp, modeForTest(type === "ei3" ? 80 : 60, 0.1));
		assert.ok(r1 > r0, `${type} detuned ${r1} vs ${r0}`);
	});
}

test("band width ordering: ei3 > zvdd > zvd", () => {
	const band = (type: ShaperSpec["type"] & string): number => {
		const imp = impulses({ type: type as "zvd", F: hz(40), S: 0.1 });
		let n = 0;
		for (let f = 20; f < 60; f += 0.5) if (residual(imp, modeForTest(f, 0.1)) < 0.1) n++;
		return n;
	};
	assert.ok(band("ei3") > band("zvdd") && band("zvdd") > band("zvd"));
});

test("custom spec passes H/T through and completes the last amplitude", () => {
	const { A, T } = impulses({ type: "custom", H: [0.335, 0.2641, 0.2242], T: [seconds(0.00972), seconds(0.0278), seconds(0.03752)] });
	assert.equal(A.length, 4);
	assert.ok(Math.abs(A[3]! - (1 - 0.335 - 0.2641 - 0.2242)) < 1e-9);
	assert.deepEqual(Array.from(T), [0, 0.00972, 0.0278, 0.03752]);
});

test("custom spec refuses amplitudes summing to 1 or more, or non-increasing delays", () => {
	assert.throws(() => impulses({ type: "custom", H: [0.6, 0.5], T: [seconds(0.01), seconds(0.02)] }));
	assert.throws(() => impulses({ type: "custom", H: [0.3, 0.3], T: [seconds(0.02), seconds(0.01)] }));
});

test("zv ⊗ zv of the prototype modes nulls both within 1 % and has 4 impulses at the prototype's times", () => {
	const x = modeForTest(18.1, 0.127);
	const y = modeForTest(51.6, 0.075);
	const imp = convolve(zv(x.f, x.zeta), zv(y.f, y.zeta));
	assert.equal(imp.A.length, 4);
	// times are the half damped periods and their sum (prototype: 9.7, 27.8, 37.5 ms)
	const half = (m: typeof x): number => 0.5 / (m.f * Math.sqrt(1 - m.zeta * m.zeta));
	assert.ok(Math.abs(imp.T[1]! - half(y)) < 1e-9 && Math.abs(imp.T[2]! - half(x)) < 1e-9 && Math.abs(imp.T[3]! - half(x) - half(y)) < 1e-9);
	assert.ok(Math.abs(imp.T[3]! * 1000 - 37.5) < 1, `duration ${imp.T[3]! * 1000} ms`);
	assert.ok(residual(imp, x) < 0.01 && residual(imp, y) < 0.01);
});

test("robust is the worst residual over ±10 % of the mode frequency", () => {
	const imp = impulses({ type: "zvd", F: hz(40), S: 0.1 });
	const r = robust(imp, M40);
	assert.ok(r >= residual(imp, M40));
	const at = (scale: number) => residual(imp, { ...M40, f: (M40.f * scale) as typeof M40.f } as typeof M40);
	assert.ok(Math.abs(r - Math.max(at(0.9), at(0.95), at(1), at(1.05), at(1.1))) < 1e-12);
});
