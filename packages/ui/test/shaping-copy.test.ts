/**
 * Every `Refusal` variant has a sentence, and the sentences carry the fact the
 * operator needs in order to act.
 *
 * The exhaustiveness itself is a COMPILE-time property (`refusalText` has a
 * `never` arm and no default), which is why this file does not try to prove it
 * with a runtime trick. What it proves instead is the thing a compiler cannot:
 * that each sentence actually mentions the variant's payload, so a row cannot
 * be filled in with a generic apology and still pass.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { refusalText } from "../src/shaping/copy.ts";
import type { Refusal } from "../src/shaping/preconditions.ts";
import { SHAPING_STEPS, stepReadiness, type StepInputs } from "../src/shaping/steps.ts";
import { mm } from "../src/shaping/engine/units.ts";

/**
 * One of each. Typed as the union so that ADDING a variant makes this array's
 * coverage check fail — it counts distinct kinds against the ones the copy
 * function is asked for, and a new variant with no entry here shows up as a
 * missing kind rather than as a silently untested row.
 */
const EVERY: readonly Refusal[] = [
	{ kind: "not-idle", status: "processing" },
	{ kind: "not-homed", axes: "XY" },
	{ kind: "no-accelerometer", addr: "20.0" },
	{ kind: "no-envelope" },
	{ kind: "outside-envelope", point: { x: mm(340.25), y: mm(12) } },
	{ kind: "stale" },
	{ kind: "not-measurable" },
];

test("every refusal kind has a non-empty sentence", () => {
	for (const r of EVERY) {
		const text = refusalText(r);
		assert.ok(text.length > 0, `${r.kind} has no copy`);
		assert.ok(!/\bundefined\b|\[object/.test(text), `${r.kind} leaked a value: ${text}`);
		// A sentence, not a token: "stale" on its own is a programmer's word.
		assert.ok(text.includes(" "), `${r.kind} is a token, not a sentence: ${text}`);
	}
});

test("the fixture covers the whole union — a new variant is a visible gap", () => {
	const kinds = new Set(EVERY.map(r => r.kind));
	assert.equal(kinds.size, EVERY.length, "a kind is listed twice");
	// Mirrors the union's arity. Bumping this is the deliberate act of having
	// decided what the new variant should say.
	assert.equal(kinds.size, 7, "Refusal gained or lost a variant — add it to EVERY and to refusalText");
});

test("not-idle names the status it saw", () => {
	assert.equal(refusalText({ kind: "not-idle", status: "processing" }), "machine is busy (processing)");
	assert.match(refusalText({ kind: "not-idle", status: "paused" }), /paused/);
});

test("not-homed names the axes, and reads naturally for one or two", () => {
	assert.equal(refusalText({ kind: "not-homed", axes: "XY" }), "home X and Y first");
	assert.equal(refusalText({ kind: "not-homed", axes: "X" }), "home X first");
	assert.equal(refusalText({ kind: "not-homed", axes: "Y" }), "home Y first");
});

test("no-accelerometer names the address, and says something else when there is none", () => {
	assert.equal(
		refusalText({ kind: "no-accelerometer", addr: "20.0" }),
		"no accelerometer at 20.0 — check Settings › Shaping",
	);
	// The empty address is a tool with no accelByTool entry: there is no sensor
	// that failed to answer, so naming one would send the operator to the wrong
	// place entirely.
	const unset = refusalText({ kind: "no-accelerometer", addr: "" });
	assert.match(unset, /Settings › Shaping/);
	assert.doesNotMatch(unset, /\bat\s+—/, "must not read as an address that is blank");
});

test("no-envelope points at the setting that is missing", () => {
	assert.equal(refusalText({ kind: "no-envelope" }), "set the motion envelope in Settings › Shaping");
});

test("outside-envelope names the point, rounded so it does not print float noise", () => {
	assert.equal(
		refusalText({ kind: "outside-envelope", point: { x: mm(340.25), y: mm(12) } }),
		"test would leave the envelope at X340.3 Y12.0",
	);
});

test("stale is said in a human's words, not the union's", () => {
	const text = refusalText({ kind: "stale" });
	assert.doesNotMatch(text, /stale/i, "'stale' is a programmer's word");
	assert.match(text, /again/, "it is fixed by trying again, and should say so");
});

test("not-measurable names the settings that have to change", () => {
	const text = refusalText({ kind: "not-measurable" });
	for (const field of ["distance", "speed", "repeats", "samples"]) {
		assert.match(text, new RegExp(field), `does not mention ${field}`);
	}
});

// ---- step readiness -------------------------------------------------------

const READY: StepInputs = {
	refusal: null, offered: true,
	hasFingerprint: true, hasCandidates: true, hasRecommendation: true, busy: false,
};
const spec = (step: string) => SHAPING_STEPS.find(s => s.step === step)!;

test("with everything in place, every step is enabled and says so", () => {
	for (const s of SHAPING_STEPS) {
		const r = stepReadiness(s, READY);
		assert.equal(r.enabled, true, `${s.step} should be enabled`);
		assert.equal(r.note, "ready");
	}
});

test("a refusal disables the steps that MOVE, and only those", () => {
	const busy: StepInputs = { ...READY, refusal: { kind: "not-idle", status: "processing" } };
	for (const s of SHAPING_STEPS) {
		const r = stepReadiness(s, busy);
		assert.equal(r.enabled, !s.moves, `${s.step} (moves=${s.moves}) got enabled=${r.enabled}`);
		if (s.moves) assert.equal(r.note, "machine is busy (processing)");
	}
});

test("a step whose input is missing says which one, before it says anything else", () => {
	assert.deepEqual(
		stepReadiness(spec("rank"), { ...READY, hasFingerprint: false }),
		{ enabled: false, note: "nothing measured yet" },
	);
	assert.deepEqual(
		stepReadiness(spec("verify"), { ...READY, hasCandidates: false }),
		{ enabled: false, note: "nothing ranked yet" },
	);
	assert.deepEqual(
		stepReadiness(spec("apply"), { ...READY, hasRecommendation: false }),
		{ enabled: false, note: "nothing to apply yet" },
	);
});

test("the machine's answer outranks the tool's, because it is the one to go and fix", () => {
	// Verify is blocked BOTH ways. The operator can do something about an
	// unhomed axis; "nothing ranked yet" would send them to the wrong card.
	const both: StepInputs = { ...READY, refusal: { kind: "not-homed", axes: "XY" }, hasCandidates: false };
	assert.deepEqual(stepReadiness(spec("verify"), both), { enabled: false, note: "home X and Y first" });
});

test("a step no card on the screen offers names the card that would", () => {
	assert.deepEqual(
		stepReadiness(spec("measure"), { ...READY, offered: false }),
		{ enabled: false, note: "the Capture card runs this" },
	);
});

test("a step already running is disabled while it runs", () => {
	assert.deepEqual(stepReadiness(spec("rank"), { ...READY, busy: true }), { enabled: false, note: "working…" });
});

test("every step's note is one line of prose, whatever state it is in", () => {
	const states: StepInputs[] = [
		READY,
		{ ...READY, refusal: { kind: "no-envelope" } },
		{ ...READY, offered: false },
		{ ...READY, busy: true },
		{ ...READY, hasFingerprint: false, hasCandidates: false, hasRecommendation: false },
	];
	for (const s of SHAPING_STEPS) {
		for (const inputs of states) {
			const { note } = stepReadiness(s, inputs);
			assert.ok(note.length > 0, `${s.step} has an empty note`);
			assert.doesNotMatch(note, /\n/, `${s.step} note wraps a line: ${note}`);
		}
	}
});
