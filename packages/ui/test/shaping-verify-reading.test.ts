/**
 * What an operator reads when they press Verify.
 *
 * Gabe, 2026-08-24, having been handed a working Verify: *"what am I supposed
 * to read after clicking verify?"* — which was the right question, because the
 * answer was "not enough", and tracing it found a bug that would have cost him
 * his baseline.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { armedRunText, armedSaveText } from "../src/shaping/copy.ts";
import { defaultPrefix, runPlans, type RunRequest } from "../src/shaping/runPlan.ts";
import type { BatchPurpose } from "../src/compose/shapingService.ts";
import type { ShaperSpec } from "../src/shaping/engine/shapers.ts";
import type { Envelope, ShapingDefaults } from "../src/config/types.ts";
import type { Fingerprint, Mode } from "../src/shaping/engine/fit.ts";
import { cmd } from "../src/control/commands.ts";
import { g, hz } from "../src/shaping/engine/units.ts";

const SPEC: ShaperSpec = { type: "ei2", F: hz(51.5), S: 0.05 };
const DEFAULTS: ShapingDefaults = { distMm: 60, speedMmS: 200, repeats: 3 };
const ENV: Envelope = { x: [10, 320], y: [20, 260] };
const mode = (f: number): Mode => ({ f: hz(f), zeta: 0.1, peakG: g(0.2), cyclesFit: 3 } as Mode);
const BASELINE: Fingerprint = { X: mode(38.66), Y: mode(50.05), n: { X: 20, Y: 10 }, spreadHz: { X: 0.65, Y: 8.91 } };

test("a verify run does NOT write over the baseline's capture files", () => {
	// THE BUG. defaultPrefix used a ternary that said "sweep" or "ring", so
	// verify silently took the ring's name — and captures are written as
	// <prefix>_<axis><dir><rep>.csv. A verify would have overwritten the
	// tool's baseline captures file for file, on the card, with the ring of a
	// SHAPED machine. The baseline would have been unrecoverable and would
	// still have looked like a baseline.
	const ring = defaultPrefix("measure", 0);
	const ver = defaultPrefix("verify", 0);
	assert.notEqual(ver, ring, "a verify must not reuse the baseline's file names");
	assert.notEqual(ver, defaultPrefix("sweep", 0));

	// And through the planner, which is what actually names the files.
	const ringNames = runPlans({ kind: "measure" }, DEFAULTS, ENV, ring)
		.map(p => (p.kind === "ring" ? p.namePrefix : ""));
	const verNames = runPlans({ kind: "verify", spec: SPEC }, DEFAULTS, ENV, ver)
		.map(p => (p.kind === "verify" ? p.ring.namePrefix : ""));
	for (const v of verNames) assert.ok(!ringNames.includes(v), `${v} collides with a baseline plan`);
});

test("every run kind gets its own prefix", () => {
	const seen = new Set(["measure", "sweep", "verify"].map(k => defaultPrefix(k as never, 3)));
	assert.equal(seen.size, 3, "two runs sharing a prefix overwrite each other");
	for (const p of seen) assert.match(p, /^t3_/);
});

test("the verify confirm names the shaper it is about to install", () => {
	// The entire content of a verify. Everything else — distance, speed,
	// repeats — is identical to the baseline the operator already ran, so a
	// confirm without the shaper describes a run they cannot tell apart from
	// the one they just did.
	const req: RunRequest = { kind: "verify", spec: SPEC };
	const text = armedRunText(req, 12, 60, 200, "t0_verify_Xp0.csv", "t0_verify_Ym2.csv");
	assert.ok(text.includes(cmd.inputShaping(SPEC)), `no shaper named: ${text}`);
	// And says it is put back, because installing one is a change to the
	// machine the operator is consenting to.
	assert.match(text, /put back|restore/i);
	assert.match(text, /Escape cancels/);
});

test("a measure confirm is unchanged and does not mention a shaper", () => {
	const text = armedRunText({ kind: "measure" }, 12, 60, 200, "t0_ring_Xp0.csv", "t0_ring_Ym2.csv");
	assert.doesNotMatch(text, /M593/);
	assert.match(text, /12 captures/);
	assert.match(text, /60 mm at 200 mm\/s/);
});

test("the two run confirms cannot be mistaken for each other", () => {
	const a = armedRunText({ kind: "measure" }, 12, 60, 200, "a.csv", "b.csv");
	const b = armedRunText({ kind: "verify", spec: SPEC }, 12, 60, 200, "a.csv", "b.csv");
	assert.notEqual(a, b);
});

test("saving a verify says it does not touch the baseline", () => {
	// A baseline save REPLACES the fingerprint; a verify save ADDS a
	// comparison. Calling both "write T0's fingerprint" told the operator the
	// second would do the first.
	const verify: BatchPurpose = { kind: "verify", spec: SPEC, baseline: BASELINE };
	const text = armedSaveText(verify, 0, "0:/sys/dwc-ng/shaping/tool0.json");
	assert.ok(text.includes(cmd.inputShaping(SPEC)));
	assert.match(text, /baseline is not changed/i);
	assert.doesNotMatch(text, /write T0's fingerprint/);
});

test("saving a baseline still says exactly what it did", () => {
	const text = armedSaveText({ kind: "baseline" }, 0, "0:/sys/dwc-ng/shaping/tool0.json");
	assert.match(text, /T0's fingerprint/);
	assert.match(text, /0:\/sys\/dwc-ng\/shaping\/tool0\.json/);
});

test("the two save confirms cannot be mistaken for each other", () => {
	const a = armedSaveText({ kind: "baseline" }, 0, "p.json");
	const b = armedSaveText({ kind: "verify", spec: SPEC, baseline: BASELINE }, 0, "p.json");
	assert.notEqual(a, b);
});
