/**
 * A baseline measures the MACHINE, not the machine's shaper.
 *
 * The regression is #53, and it reached real hardware. On 2026-08-23 Gabe's
 * first run through the UI produced a fingerprint that made no sense: X came
 * back 18.14 -> 14.94 Hz and Y 51.68 -> 14.83 Hz against the prototype's
 * numbers. The cause was not the fit. His `tpost<N>.g` had installed
 * `M593 P"ei2" F52 S0.034`, and a ring plan sent no `M593` of its own, so the
 * lab recorded the machine THROUGH the operator's own notch. The Y mode the
 * shaper is tuned to null was simply gone; on X the same shaper left enough
 * residual that a ~15 Hz component won instead. Both axes converging on ~15 Hz
 * is the signature of "both known modes suppressed".
 *
 * What makes it the worst bug this module has had is that it is SILENT and
 * SELF-REINFORCING: fingerprint the suppressed machine, rank candidates against
 * modes that are not there, apply one, measure again. Nothing downstream can
 * detect it, because a fingerprint of a shaped machine is shaped exactly like a
 * fingerprint of an unshaped one. Only the wire can tell you, so these tests
 * read the wire.
 *
 * They assert POSITION as well as presence. "The run sent an M593 P\"none\"
 * somewhere" is not the invariant — a disable that lands after the first M956
 * arms leaves the first capture shaped, which is the same bug with a passing
 * test over it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { planProcedure, type SweepPlan, type VerifyPlan } from "../src/shaping/procedure.ts";
import { RESULTS_VERSION } from "../src/shaping/results.ts";
import { parseResults } from "../src/shaping/resultsCodec.ts";
import { hz, mm, mmPerS } from "../src/shaping/engine/units.ts";
import type { ShaperSpec } from "../src/shaping/engine/shapers.ts";
import {
	EI2_PRIOR, NOW, RATE,
	config, freshPre, modelWith, ringPlan, sentBy, priorOf,
} from "./helpers/shapingMachine.ts";

/** The shaper Gabe's machine actually had installed when this bug bit. */
const SHAPED = { shaping: EI2_PRIOR } as const;

const SPEC: ShaperSpec = { type: "ei2", F: hz(52), S: 0.075 };

const sweepPlan = (): SweepPlan => ({
	kind: "sweep",
	start: { x: mm(100), y: mm(100) },
	distMm: mm(60),
	speeds: [mmPerS(100), mmPerS(200)],
	namePrefix: "sweep",
});

const verifyPlan = (): VerifyPlan => ({ kind: "verify", spec: SPEC, ring: ringPlan({ repeats: 1 }) });

/** Run a plan against a board that already has Gabe's shaper on, and report
 *  every code it heard. The model carries the prior shaper, so the restore is
 *  exercised too — the disable must not be what the machine is left in. */
async function wireOf(plan: Parameters<typeof planProcedure>[0]): Promise<string[]> {
	const model = modelWith(SHAPED);
	const r = planProcedure(plan, freshPre(SHAPED), config(), NOW, RATE, priorOf(EI2_PRIOR));
	assert.equal(r.ok, true, "the plan must be accepted — this suite is about what it SENDS");
	if (!r.ok) throw new Error("unreachable");
	return await sentBy(r.proc, model);
}

const OFF = 'M593 P"none"';

test("a ring baseline disables shaping before it records anything", async () => {
	const sent = await wireOf(ringPlan({ repeats: 1 }));
	assert.equal(sent[0], OFF, "the disable is the FIRST thing on the wire, before any move or arm");
});

test("a sweep disables shaping before it records anything", async () => {
	const sent = await wireOf(sweepPlan());
	assert.equal(
		sent[0],
		OFF,
		"a sweep reads FORCED response; a shaper attenuates the drive at its own notch, so a shaped sweep draws a black band where the machine is loudest",
	);
});

test("no capture is ever armed before the shaper has been stated", async () => {
	for (const [name, plan] of [["ring", ringPlan({ repeats: 2 })], ["sweep", sweepPlan()]] as const) {
		const sent = await wireOf(plan);
		const disabled = sent.indexOf(OFF);
		const firstArm = sent.findIndex((c) => c.startsWith("M956"));
		assert.notEqual(disabled, -1, `${name}: shaping is never disabled`);
		assert.notEqual(firstArm, -1, `${name}: nothing was ever armed`);
		assert.ok(disabled < firstArm, `${name}: M593 P"none" at ${disabled} must precede the first M956 at ${firstArm}`);
	}
});

test("a verify run installs its candidate and does NOT disable shaping", async () => {
	const sent = await wireOf(verifyPlan());
	assert.equal(
		sent[0],
		'M593 P"ei2" F52 S0.075',
		"verify's whole question is what is LEFT with this shaper live — it is the one run that must not be measured clean",
	);
	const firstArm = sent.findIndex((c) => c.startsWith("M956"));
	assert.equal(
		sent.slice(0, firstArm).includes(OFF),
		false,
		"a disable before verify's first capture would measure the unshaped machine and call the result a verification",
	);
});

test("the operator's own shaper is put back, so the disable is not what they are left with", async () => {
	const sent = await wireOf(ringPlan({ repeats: 1 }));
	assert.equal(
		sent[sent.length - 1],
		'M593 P"ei2" F52 S0.075',
		"the run must end on the shaper the board reported before it started, not on the lab's disable",
	);
});

test("the 2026-08-23 incident, end to end: a baseline on a shaped machine", async () => {
	const sent = await wireOf(ringPlan({ repeats: 1 }));
	const shaperLines = sent.filter((c) => c.startsWith("M593"));
	assert.deepEqual(
		shaperLines,
		[OFF, 'M593 P"ei2" F52 S0.075'],
		"exactly two M593s and in this order: off to measure, back to what the operator had. Before #53 there were ZERO, and the ei2 stayed live through every capture.",
	);
});

// --- what is already on the card --------------------------------------------

/**
 * The fix above guarantees every fingerprint this build MAKES is unshaped. It
 * says nothing about the one already sitting in `0:/sys/dwc-ng/shaping/tool0.json`,
 * which on Gabe's machine was written through the ei2 notch and looks perfect.
 *
 * `parseResults` already refuses a file whose version is not this build's, so
 * the bump IS the mechanism — there is no second code path to keep in step, and
 * no `measuredThrough` field that a hand-edited file could lie about.
 */
test("a results file from a build that could not guarantee an unshaped baseline is refused, not loaded", () => {
	const v1 = JSON.stringify({
		version: 1,
		tool: 0,
		fingerprint: { X: { f: 14.94, zeta: 0.05, peakG: 0.4, cyclesFit: 6 }, Y: { f: 14.83, zeta: 0.05, peakG: 0.4, cyclesFit: 6 }, n: { X: 10, Y: 10 }, spreadHz: { X: 0.6, Y: 0.6 } },
		captures: [],
		sweep: null,
		candidates: [],
		verified: [],
		applied: null,
	});
	assert.equal(
		parseResults(v1),
		null,
		"both axes at ~15 Hz is the signature of a baseline taken through a shaper — and it parses as a perfectly ordinary fingerprint, which is why the refusal cannot be left to a reader's judgement",
	);
	assert.ok(RESULTS_VERSION > 1, "the bump is the mechanism; reverting it silently re-admits every poisoned file");
});
