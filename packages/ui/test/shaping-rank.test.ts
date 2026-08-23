import { test } from "node:test";
import assert from "node:assert/strict";
import { rank, customCandidate } from "../src/shaping/engine/rank.ts";
import { newPeaks } from "../src/shaping/engine/artefact.ts";
import { hz, seconds } from "../src/shaping/engine/units.ts";
import { modeForTest, prototypeFingerprint } from "./helpers/shaping.ts";

test("rank on the prototype fingerprint: a zvddd near 17.5 Hz leads, and ei2 F52 reads ~43 % X / ~1 % Y", () => {
	const fp = prototypeFingerprint();
	const ranked = rank(fp);
	assert.ok(ranked.length > 100);
	const top = ranked[0]!;
	assert.equal(top.spec.type, "zvddd");
	assert.ok("F" in top.spec && Math.abs(top.spec.F - 17.5) <= 1, `top F ${JSON.stringify(top.spec)}`);
	assert.ok(top.worstRobust < 0.03);
	for (let i = 1; i < ranked.length; i++) {
		const a = ranked[i - 1]!;
		const b = ranked[i]!;
		assert.ok(Math.round(a.worstRobust * 1000) <= Math.round(b.worstRobust * 1000), "sorted by worst robust residual (3 dp), then duration");
	}
	const ei2 = ranked.find((c) => c.spec.type === "ei2" && "F" in c.spec && c.spec.F === 52 && c.spec.S === 0.1);
	assert.ok(ei2, "ei2 F52 S0.1 is in the grid");
	assert.ok(Math.abs(ei2.residual.X! - 0.43) < 0.08, `X ${ei2.residual.X}`);
	assert.ok(ei2.residual.Y! < 0.03, `Y ${ei2.residual.Y}`);
	assert.ok(Math.abs(ei2.durationS * 1000 - 29) < 2, `duration ${ei2.durationS}`);
});

test("customCandidate evaluates a user impulse train against the fingerprint", () => {
	const fp = prototypeFingerprint();
	const c = customCandidate({ type: "custom", H: [0.335, 0.2641, 0.2242], T: [seconds(0.00972), seconds(0.0278), seconds(0.03752)] }, fp);
	assert.equal(c.spec.type, "custom");
	assert.ok(c.residual.X! < 0.02 && c.residual.Y! < 0.02, JSON.stringify(c.residual));
	assert.ok(Math.abs(c.durationS * 1000 - 37.5) < 0.1);
});

test("newPeaks flags a 38 Hz ring that the unshaped machine did not have, and ignores the known 52 Hz one", () => {
	const base = prototypeFingerprint();
	const verified = { ...base, X: modeForTest(38.0, 0.13, 0.25), Y: modeForTest(52.0, 0.08, 0.1) };
	const art = newPeaks(base, verified);
	assert.equal(art.length, 1);
	assert.equal(art[0]!.axis, "X");
	assert.ok(Math.abs(art[0]!.hz - 38) < 1 && art[0]!.peakG > 0.05);
});

test("newPeaks ignores new peaks below the floor", () => {
	const base = prototypeFingerprint();
	const verified = { ...base, X: modeForTest(38.0, 0.13, 0.084) }; // fits, but its peak is ~0.03 g
	assert.ok(verified.X.peakG < 0.05);
	assert.equal(newPeaks(base, verified).length, 0);
});

test("rank uses the F step and S grid it was given", () => {
	const fp = { ...prototypeFingerprint(), Y: null, n: { X: 6, Y: 0 }, spreadHz: { X: 0.5, Y: 0 } };
	const ranked = rank(fp, { sValues: [0.1], fStepHz: 1 });
	const fs = new Set(ranked.map((c) => ("F" in c.spec ? c.spec.F : -1)));
	for (const f of fs) assert.equal(f, Math.round(f));
	assert.ok(ranked.every((c) => !("S" in c.spec) || c.spec.S === 0.1));
	assert.ok(ranked.every((c) => c.residual.Y === undefined));
	assert.ok(Math.min(...fs) >= Math.floor(0.7 * 18.1) && Math.max(...fs) <= Math.ceil(1.3 * 18.1) + 0.5, String(hz(Math.max(...fs))));
});
