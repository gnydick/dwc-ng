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
import { batchSummaryText, captureSourceLabel, refusalText } from "../src/shaping/copy.ts";
import { prototypeFingerprint } from "./helpers/shaping.ts";
import type { Refusal } from "../src/shaping/preconditions.ts";
import { SHAPING_STEPS, stepReadiness, type StepInputs } from "../src/shaping/steps.ts";
import { type Have, productsOf } from "./helpers/shaping.ts";
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
	{ kind: "head-outside-envelope", point: { x: mm(-26.7), y: mm(207.1) } },
	{ kind: "plan-leaves-envelope", point: { x: mm(340.25), y: mm(12) } },
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
	assert.equal(kinds.size, 8, "Refusal gained or lost a variant — add it to EVERY and to refusalText");
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
		"no accelerometer at 20.0 — check Settings › Input shaping",
	);
	// The empty address is a tool with no accelByTool entry: there is no sensor
	// that failed to answer, so naming one would send the operator to the wrong
	// place entirely.
	const unset = refusalText({ kind: "no-accelerometer", addr: "" });
	assert.match(unset, /Settings › Input shaping/);
	assert.doesNotMatch(unset, /\bat\s+—/, "must not read as an address that is blank");
});

test("no-envelope points at the setting that is missing", () => {
	assert.equal(refusalText({ kind: "no-envelope" }), "set the motion envelope in Settings › Input shaping");
});

test("plan-leaves-envelope names the planned point, rounded so it does not print float noise", () => {
	assert.equal(
		refusalText({ kind: "plan-leaves-envelope", point: { x: mm(340.25), y: mm(12) } }),
		"test would leave the envelope at X340.3 Y12.0 — shorten the move or redraw the envelope in Settings › Input shaping",
	);
});

/**
 * The bug this pair was split for (#49).
 *
 * One kind used to carry both facts, so one sentence had to serve both, and
 * the sentence it had was the PLAN's. Gabe parked the head by hand at
 * X-26.7 Y207.1 on a deployed build and was told the "test would leave the
 * envelope" — no test existed yet, nothing was going to leave anywhere, and
 * the remedy the sentence implied (shorten the move) would not have helped,
 * because the thing to move was the carriage.
 */
test("head-outside-envelope says where the head IS, and that moving it is the fix", () => {
	const text = refusalText({ kind: "head-outside-envelope", point: { x: mm(-26.7), y: mm(207.1) } });
	assert.match(text, /X-26\.7 Y207\.1/, "must carry the position it read");
	// The one thing it must not say: that a test or a run would leave anywhere.
	// Nothing is planned at the point this refusal is raised.
	assert.doesNotMatch(text, /\bwould leave\b/);
	assert.match(text, /parked/, "the coordinates describe the machine now, not a plan");
	assert.match(text, /move it/i, "the remedy is a move, and must be said");
});

test("the two envelope refusals do not say the same thing", () => {
	// Same point deliberately: if the sentences ever collapse back into one
	// table row, this is what catches it — the numbers cannot be what tells them
	// apart, because the numbers can legitimately be equal.
	const point = { x: mm(340.25), y: mm(12) };
	const head = refusalText({ kind: "head-outside-envelope", point });
	const plan = refusalText({ kind: "plan-leaves-envelope", point });
	assert.notEqual(head, plan, "one sentence cannot be right for both facts");
	// And they name different remedies, which is the whole reason for the split.
	assert.match(head, /move it/i);
	assert.match(plan, /shorten the move|redraw the envelope/);
	assert.doesNotMatch(plan, /move it into/i);
});

test("stale is said in a human's words, not the union's", () => {
	const text = refusalText({ kind: "stale" });
	assert.doesNotMatch(text, /stale/i, "'stale' is a programmer's word");
	assert.match(text, /again/, "it is fixed by trying again, and should say so");
});

test("not-measurable names the settings that have to change", () => {
	const text = refusalText({ kind: "not-measurable" });
	for (const field of ["distance", "speed", "repeats"]) {
		assert.match(text, new RegExp(field), `does not mention ${field}`);
	}
	// Samples are NOT among them any more: the recording is derived from the
	// motion, so there is no sample setting for an operator to go and change.
	assert.doesNotMatch(text, /samples/i);
});

// ---- step readiness -------------------------------------------------------

const READY: StepInputs = {
	refusal: null, present: true, offered: true, busy: false,
	products: productsOf({ fingerprint: true, sweep: true, candidates: true, verified: true, applied: true }),
};

/** READY with one product taken away. */
const without = (gone: keyof Have): StepInputs => ({
	...READY,
	products: productsOf({ fingerprint: true, sweep: true, candidates: true, verified: true, applied: true, [gone]: false }),
});
const spec = (step: string) => SHAPING_STEPS.find(s => s.step === step)!;

test("with everything in place, every step is enabled and says so", () => {
	for (const s of SHAPING_STEPS) {
		const r = stepReadiness(s, READY);
		assert.equal(r.enabled, true, `${s.step} should be enabled`);
		assert.equal(r.block.kind, "none");
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
		stepReadiness(spec("rank"), without("fingerprint")),
		{ enabled: false, caveats: [], block: { kind: "input", need: "fingerprint" }, note: "nothing measured yet" },
	);
	assert.deepEqual(
		stepReadiness(spec("verify"), without("candidates")),
		{ enabled: false, caveats: [], block: { kind: "input", need: "candidates" }, note: "nothing ranked yet" },
	);
	assert.deepEqual(
		stepReadiness(spec("apply"), { ...READY, products: productsOf({ fingerprint: true, sweep: true, applied: true }) }),
		{ enabled: false, caveats: [], block: { kind: "input", need: "recommendation" }, note: "nothing to apply yet" },
	);
});

test("the machine's answer outranks the tool's, because it is the one to go and fix", () => {
	// Verify is blocked BOTH ways. The operator can do something about an
	// unhomed axis; "nothing ranked yet" would send them to the wrong card.
	const both: StepInputs = { ...without("candidates"), refusal: { kind: "not-homed", axes: "XY" } };
	const r = stepReadiness(spec("verify"), both);
	assert.equal(r.enabled, false);
	assert.equal(r.block.kind, "machine");
	assert.equal(r.note, "home X and Y first");
});

test("a step whose card is not on the screen says to add it", () => {
	const r = stepReadiness(spec("measure"), { ...READY, present: false, offered: false });
	assert.equal(r.enabled, false);
	assert.equal(r.block.kind, "off-screen");
	assert.equal(r.note, "add the Capture card to this screen");
});

test("a card that IS on the screen and still cannot run the step says so instead", () => {
	// The distinction the whole ticket is about: an operator who removed the
	// Capture card and a Capture card with no run control yet are two different
	// problems, and one sentence for both made a missing feature read broken.
	const r = stepReadiness(spec("measure"), { ...READY, present: true, offered: false });
	assert.equal(r.enabled, false);
	assert.equal(r.block.kind, "not-built");
	assert.equal(r.note, "the Capture card cannot run this yet");
	assert.notEqual(r.note, stepReadiness(spec("measure"), { ...READY, present: false, offered: false }).note);
});

test("a step already running is disabled while it runs", () => {
	assert.deepEqual(
		stepReadiness(spec("rank"), { ...READY, busy: true }),
		{ enabled: false, caveats: [], block: { kind: "busy" }, note: "working…" },
	);
});

test("every step's note is one line of prose, whatever state it is in", () => {
	const states: StepInputs[] = [
		READY,
		{ ...READY, refusal: { kind: "no-envelope" } },
		{ ...READY, present: false, offered: false },
		{ ...READY, offered: false },
		{ ...READY, busy: true },
		{ ...READY, products: productsOf({ sweep: true, applied: true }) },
	];
	for (const s of SHAPING_STEPS) {
		for (const inputs of states) {
			const { note } = stepReadiness(s, inputs);
			assert.ok(note.length > 0, `${s.step} has an empty note`);
			assert.doesNotMatch(note, /\n/, `${s.step} note wraps a line: ${note}`);
		}
	}
});

/* ------------------------------------------------ the batch fingerprint line */

test("a partial aggregate says so — 11 of 12, with the one that did not fit named as excluded", () => {
	// The case Gabe's own board produces: `ring1_Xp1.csv` is declined as
	// short-decay, so his first real fingerprint is built from 11 captures.
	const fp = prototypeFingerprint();
	const line = batchSummaryText(11, 12, fp);
	assert.match(line, /^Fitted 11 of 12 captures/);
	assert.match(line, /One capture did not fit and is excluded from the medians\.$/);
	// Shape, not value: the helper's fingerprint is fitted from a synthetic
	// ring, so the exact frequency belongs to the fitter's own tests.
	assert.match(line, /X \d+\.\d Hz ζ 0\.\d{3}/);
	assert.match(line, /Y \d+\.\d Hz ζ 0\.\d{3}/);
});

test("a complete aggregate does not mention captures it excluded", () => {
	const line = batchSummaryText(12, 12, prototypeFingerprint());
	assert.match(line, /^Fitted 12 of 12 captures/);
	assert.ok(!line.includes("excluded"), line);
	assert.ok(line.endsWith("."), line);
});

test("more than one rejection reads as plural", () => {
	const line = batchSummaryText(9, 12, prototypeFingerprint());
	assert.match(line, /3 captures did not fit and are excluded/);
});

test("an axis that never fitted is an em dash, not a zero", () => {
	const fp = prototypeFingerprint();
	const line = batchSummaryText(6, 12, { ...fp, X: null, n: { X: 0, Y: 6 } });
	assert.match(line, /X — /);
	assert.ok(!line.includes("X 0.0 Hz"), line);
});

/* ------------------------------------------------ the Decay card's sources */

test("the tool source names its tool, so a row's head is on screen", () => {
	// Reported by Gabe, 2026-08-23: a tool-source row says `ring1_Xp0.csv` with
	// nothing saying whose session it belongs to. On a four-head machine that
	// is the fact the list was missing, and the chip is where it goes — every
	// row under it belongs to the same tool.
	assert.equal(captureSourceLabel("tool", 0), "T0");
	assert.equal(captureSourceLabel("tool", 3), "T3");
	assert.notEqual(captureSourceLabel("tool", 0), "Tool");
});

test("the other two sources are named for what they are, not for a tool", () => {
	assert.equal(captureSourceLabel("board", 2), "Board");
	assert.equal(captureSourceLabel("imported", 2), "Imported");
});
