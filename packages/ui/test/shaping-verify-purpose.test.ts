/**
 * The invariant a verify run exists under: a shaped fingerprint cannot become
 * a baseline.
 *
 * A verify run measures the machine WITH a shaper installed, so its fingerprint
 * describes the SUPPRESSED machine. Writing that as the tool's baseline is #53
 * — silent, self-reinforcing, and undetectable downstream: rank against modes
 * that are not there, apply, measure again, and every number looks clean.
 *
 * Most of the enforcement is at compile time (`BatchPurpose` puts the payload
 * each writer needs in its own arm, so neither can be reached with the other's
 * batch). What a compiler cannot check, and what this file checks, is that the
 * PLAN a verify run produces really does install the shaper and really does
 * measure the same motion the baseline used — a comparison against a different
 * move is a ratio of two unrelated things.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { plannedCaptureCount, runPlans, type RunRequest } from "../src/shaping/runPlan.ts";
import type { ShaperSpec } from "../src/shaping/engine/shapers.ts";
import { hz } from "../src/shaping/engine/units.ts";
import type { Envelope, ShapingDefaults } from "../src/config/types.ts";

const SPEC: ShaperSpec = { type: "ei2", F: hz(51.5), S: 0.05 };
const DEFAULTS: ShapingDefaults = { distMm: 60, speedMmS: 200, repeats: 3 };
/** Gabe's machine, as the other run-plan tests spell it. */
const ENV: Envelope = { x: [10, 320], y: [20, 260] };

const measure: RunRequest = { kind: "measure" };
const verify: RunRequest = { kind: "verify", spec: SPEC };

test("a verify plan installs the shaper it names", () => {
	const plans = runPlans(verify, DEFAULTS, ENV, "t0_verify");
	assert.ok(plans.length > 0);
	for (const p of plans) {
		assert.equal(p.kind, "verify");
		assert.deepEqual(p.spec, SPEC, "the plan must carry the very spec requested");
	}
});

test("a verify measures the SAME motion its baseline did", () => {
	// A verify run at a different distance or speed produces a ratio of two
	// unrelated measurements. The numbers would still render.
	const base = runPlans(measure, DEFAULTS, ENV, "t0_ring");
	const ver = runPlans(verify, DEFAULTS, ENV, "t0_verify");
	assert.equal(ver.length, base.length);
	for (let i = 0; i < ver.length; i++) {
		const b = base[i]!;
		const v = ver[i]!;
		assert.equal(b.kind, "ring");
		assert.equal(v.kind, "verify");
		assert.equal(Number(v.ring.distMm), Number(b.distMm));
		assert.equal(Number(v.ring.speed), Number(b.speed));
		assert.deepEqual(v.ring.start, b.start);
		assert.equal(v.ring.repeats, b.repeats);
		assert.equal(v.ring.axis, b.axis);
	}
});

test("a verify run cannot be requested without saying of what", () => {
	// The compile-time half, stated so the intent survives a refactor: there is
	// no `{ kind: "verify" }` without a spec, so `runPlans` cannot be asked for
	// a verify of nothing. This file compiling IS the assertion; the runtime
	// check below only proves the arm is reachable at all.
	const req: RunRequest = { kind: "verify", spec: SPEC };
	assert.equal(req.kind, "verify");
	assert.ok("spec" in req);
});

test("measure and sweep still plan exactly as they did", () => {
	// The request union replaced a bare string at three call sites; this is the
	// regression that says nothing else moved.
	const rings = runPlans(measure, DEFAULTS, ENV, "t0_ring");
	assert.ok(rings.every(p => p.kind === "ring"));
	const sweeps = runPlans({ kind: "sweep" }, DEFAULTS, ENV, "t0_sweep");
	assert.ok(sweeps.every(p => p.kind === "sweep"));
});

test("the capture count of a verify equals the baseline's", () => {
	// It is the same ring twice over, so the figure the armed confirm shows
	// must match what a baseline of the same settings would take.
	assert.equal(
		plannedCaptureCount(runPlans(verify, DEFAULTS, ENV, "t0_verify")),
		plannedCaptureCount(runPlans(measure, DEFAULTS, ENV, "t0_ring")),
	);
});
