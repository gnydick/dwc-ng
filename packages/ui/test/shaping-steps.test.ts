/**
 * `nextStep`: which of the five things to do now, and how each of the five
 * reads while you are not doing it.
 *
 * Node-testable without a DOM, which is the reason the pick lives in a pure
 * module at all: "why is the primary button pointing there" has to be
 * answerable without looking at the card. What these prove that a compiler
 * cannot is the ORDER — done is skipped, runnable beats blocked, registry
 * order breaks ties — and the identity that makes the region and the list one
 * answer rather than two.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Have, productsOf } from "./helpers/shaping.ts";
import {
	nextStep,
	SHAPING_STEPS,
	type ShapingStep,
	type StepInputs,
	type StepSpec,
	type StepStatus,
} from "../src/shaping/steps.ts";
import { allDoneAction, stepActionText, stepStatusText, type StepScope } from "../src/shaping/copy.ts";
import { CARD_DEFS } from "../src/compose/defs.ts";
import { measurePlans, plannedCaptureCount } from "../src/shaping/runPlan.ts";

/**
 * The machine and the card at their best: nothing refuses, every card is on
 * the screen and offering, and nothing has been done yet. Every case below is
 * this minus one thing, so a failure names the thing rather than the fixture.
 */
type Over = Partial<Omit<StepInputs, "products">> & Have;

/**
 * The machine and the card at their best: nothing refuses, every card is on
 * the screen and offering, and nothing has been done yet. Every case below is
 * this minus one thing, so a failure names the thing rather than the fixture.
 *
 * The product flags are a shorthand for SOUND evidence (helpers/shaping.ts
 * `productsOf`). Cases about what limits a product live in
 * shaping-steps-evidence.test.ts, which builds the states directly.
 */
const build = (o: Over = {}): StepInputs => ({
	refusal: o.refusal ?? null,
	present: o.present ?? true,
	offered: o.offered ?? true,
	busy: o.busy ?? false,
	products: productsOf(o),
});

/** Uniform inputs for every step. */
const all = (over: Over = {}) => (): StepInputs => build(over);

/** Per-step inputs: the base for everyone, overridden for named steps. */
const per = (base: Over, over: Partial<Record<ShapingStep, Over>>) =>
	(spec: StepSpec): StepInputs => build({ ...base, ...(over[spec.step] ?? {}) });

const ORDER: readonly ShapingStep[] = ["measure", "sweep", "rank", "verify", "apply"];

const statuses = (inputsFor: (s: StepSpec) => StepInputs): Record<string, StepStatus> =>
	Object.fromEntries(nextStep(inputsFor).steps.map(s => [s.spec.step, s.status]));

/* ------------------------------------------------------ the registry itself */

test("the registry is the whole union, in the order the work is done", () => {
	assert.deepEqual(SHAPING_STEPS.map(s => s.step), ORDER);
	// nextStep builds `byStep` by mapping SHAPING_STEPS. That record is only
	// total if the registry covers the union, which a readonly array cannot say
	// in the type — so it is said here.
	const wf = nextStep(all());
	for (const step of ORDER) assert.ok(wf.byStep[step] !== undefined, `${step} has no state`);
	assert.equal(Object.keys(wf.byStep).length, ORDER.length);
});

test("every step names a real card, and names it the way that card is titled", () => {
	// `owner` is the sentence's word and `ownerCard` is the lookup; they have to
	// be the same card. steps.ts cannot import the registry (it is pure and
	// node-testable on purpose), so the agreement is pinned here.
	for (const spec of SHAPING_STEPS) {
		const def = CARD_DEFS[spec.ownerCard];
		assert.ok(def !== undefined, `${spec.step} names an unregistered card ${spec.ownerCard}`);
		assert.equal(def.title, spec.owner, `${spec.step}: owner "${spec.owner}" is not ${spec.ownerCard}'s title`);
	}
});

/* ------------------------------------------------------------- what is next */

test("with nothing done and nothing in the way, the first step is next", () => {
	const wf = nextStep(all());
	assert.equal(wf.next?.spec.step, "measure");
	assert.equal(wf.next?.status, "next");
});

test("the pick is the very object the list renders, not an equal copy", () => {
	// This is the invariant: the prominent button and the row it corresponds to
	// hold ONE readiness. A structural clone would satisfy deepEqual and still
	// let the two drift the moment either is recomputed.
	const wf = nextStep(all());
	assert.ok(wf.steps.includes(wf.next!), "next is not one of the steps");
	assert.equal(wf.next, wf.byStep[wf.next!.spec.step]);
});

test("a done step is skipped even though its button stays live", () => {
	// Gabe's machine today: T0 has a fingerprint saved. Measure is done, so the
	// next thing is the next UNDONE step, not a re-measure — but the row must
	// still be runnable, because re-measuring is a thing people do.
	const wf = nextStep(all({ fingerprint: true }));
	assert.equal(wf.byStep.measure.done, true);
	assert.equal(wf.byStep.measure.status, "done");
	assert.equal(wf.byStep.measure.readiness.enabled, true, "a done step must stay re-runnable");
	assert.equal(wf.next?.spec.step, "sweep");
});

test("a runnable step later in the order beats a blocked one earlier", () => {
	// Sweep cannot run (its card is not on the screen); Rank can. The region
	// points at what can actually be done, not at the first thing that is stuck.
	const wf = nextStep(per(
		{ fingerprint: true },
		{ sweep: { present: false, offered: false } },
	));
	assert.equal(wf.byStep.sweep.status, "off-screen");
	assert.equal(wf.next?.spec.step, "rank");
});

test("when nothing is runnable, the first blocked step is shown WITH its reason", () => {
	const wf = nextStep(all({ refusal: { kind: "no-envelope" }, present: false, offered: false }));
	assert.equal(wf.next?.spec.step, "measure");
	assert.equal(wf.next?.readiness.enabled, false);
	assert.equal(wf.next?.readiness.note, "set the motion envelope in Settings › Input shaping");
	assert.equal(wf.next?.status, "next", "the region's step is still the next one, blocked or not");
});

test("all blocked: the reason shown is the FIRST step's, not the loudest", () => {
	const wf = nextStep(per(
		{ present: false, offered: false },
		// A machine reason on a later step must not outrank an earlier step.
		{ verify: { refusal: { kind: "not-homed", axes: "XY" }, present: false, offered: false } },
	));
	assert.equal(wf.next?.spec.step, "measure");
	assert.equal(wf.next?.readiness.note, "add the Capture card to this screen");
});

test("all done: there is no next step, and the region says so instead of emptying", () => {
	const wf = nextStep(all({
		fingerprint: true, sweep: true, candidates: true,
		verified: true, applied: true,
	}));
	assert.equal(wf.next, null);
	for (const s of wf.steps) assert.equal(s.status, "done", `${s.spec.step} should read done`);
	const done = allDoneAction(3);
	assert.match(done.label, /T3/);
	assert.ok(done.note.length > 0, "the slot must still be filled");
});

test("a step running is neither blocked nor available", () => {
	const wf = nextStep(per({ fingerprint: true }, { rank: { busy: true } }));
	assert.equal(wf.byStep.rank.status, "busy");
	assert.equal(wf.byStep.rank.readiness.note, "working…");
	// It is still the pick — it is what is happening — but the button is off.
	assert.equal(wf.next?.spec.step, "sweep");
});

/* ------------------------------------------------------------ the five (and
   two) states, as the list renders them */

test("today's real screen: everything present, only rank actually offered", () => {
	// The state on main before the missing cards land, and the defect this
	// ticket exists for: measure/sweep/verify/apply are "not yet", not "no
	// card" and not silently broken.
	const wf = nextStep(per({}, {
		measure: { offered: false },
		sweep: { offered: false },
		verify: { offered: false },
		apply: { offered: false },
	}));
	assert.deepEqual(statuses(per({}, {
		measure: { offered: false },
		sweep: { offered: false },
		verify: { offered: false },
		apply: { offered: false },
	})), {
		measure: "next",
		sweep: "not-built",
		// Verify and Apply are blocked by their INPUTS, which is upstream of
		// whose card would run them — there is nothing ranked and nothing to
		// apply, and sending the operator to a card would be the wrong errand.
		rank: "blocked",
		verify: "blocked",
		apply: "blocked",
	});
	assert.equal(wf.next?.readiness.note, "the Capture card cannot run this yet");
});

test("off-screen and not-built are different states with different sentences", () => {
	const off = nextStep(per({}, { measure: { present: false, offered: false } })).byStep.measure;
	const unbuilt = nextStep(per({}, { measure: { present: true, offered: false } })).byStep.measure;
	assert.equal(off.status, "off-screen");
	assert.equal(unbuilt.status, "not-built");
	assert.notEqual(off.readiness.note, unbuilt.readiness.note);
	assert.notEqual(stepStatusText(off.status), stepStatusText(unbuilt.status));
});

test("more than one step can be runnable, and only one of them is next", () => {
	// Measure and Sweep are both available the moment their cards can run them.
	// Calling both "next" would put two primary answers on one card.
	const s = statuses(all());
	assert.equal(s.measure, "next");
	assert.equal(s.sweep, "ready");
});

test("every state a step can reach has a chip, and no two chips are the same width class", () => {
	const seen = new Set<StepStatus>();
	const inputs: Array<(spec: StepSpec) => StepInputs> = [
		all(),
		all({ fingerprint: true, sweep: true, candidates: true, verified: true, applied: true }),
		all({ refusal: { kind: "no-envelope" } }),
		all({ present: false, offered: false }),
		all({ offered: false }),
		per({ fingerprint: true }, { rank: { busy: true } }),
	];
	for (const f of inputs) for (const st of nextStep(f).steps) seen.add(st.status);
	// All seven reachable from six input sets; a state nothing can produce would
	// be dead copy, and one with no chip would render blank.
	assert.equal(seen.size, 7, `only reached ${[...seen].join(", ")}`);
	for (const st of seen) {
		const chip = stepStatusText(st);
		assert.ok(chip.length > 0, `${st} has no chip`);
		// The chip slot is a declared width sized against the longest word; a
		// longer one would be ellipsed, which is how the source chips broke.
		assert.ok(chip.length <= 7, `chip "${chip}" is wider than the slot was sized for`);
	}
});

/* ------------------------------------------------- what the action promises */

const spec = (step: ShapingStep): StepSpec => SHAPING_STEPS.find(s => s.step === step)!;

test("the primary action names the run's real size, from the plans themselves", () => {
	// Not a restated formula: the number is counted off the very plans an armed
	// confirm would execute, so the figure the operator consents to and the
	// number of capture steps that get built cannot be two arithmetics.
	const plans = measurePlans({ distMm: 60, speedMmS: 200, repeats: 3 }, { x: [50, 250], y: [50, 250] }, "t0_ring");
	// Three repeats is what ships: out and back, on each of two axes.
	assert.equal(plannedCaptureCount(plans), 12);
	const scope: StepScope = { kind: "captures", n: plannedCaptureCount(plans) };
	assert.equal(stepActionText(spec("measure"), 0, scope), "Measure T0 — 12 captures");
});

test("one of anything is not '1 captures'", () => {
	assert.equal(stepActionText(spec("measure"), 1, { kind: "captures", n: 1 }), "Measure T1 — 1 capture");
	assert.equal(stepActionText(spec("rank"), 1, { kind: "shapers", n: 1 }), "Rank T1 — 1 shaper");
});

test("with no number to give, it says less rather than inventing one", () => {
	// The live case: there is no speed list until the Sweep card builds one, so
	// a count here would be a figure this screen made up.
	assert.equal(stepActionText(spec("sweep"), 0, { kind: "unknown" }), "Sweep T0");
	assert.doesNotMatch(
		stepActionText(spec("sweep"), 0, { kind: "unknown" }),
		/capture|shaper|speed|\d+ /,
		"no invented count",
	);
});

test("a shaper-shaped action names the shaper", () => {
	assert.equal(stepActionText(spec("apply"), 2, { kind: "shaper", name: "EI2 52.0 Hz" }), "Apply T2 — EI2 52.0 Hz");
});
