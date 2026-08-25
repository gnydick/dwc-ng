/**
 * A measurement's identity: that it has one, that it survives the card, and
 * that it is compared against the machine in front of the operator.
 *
 * GitHub #57. Gabe, 2026-08-23, reading `tool0.json`: "is there some sort of
 * session there? because there's no notion of session for the UI." The file's
 * shape implied a coherent session — twelve captures, reps 0-2, both
 * directions, both axes — and its construction guaranteed none: `fitCaptures`
 * aggregated whatever the operator had ticked, and nothing recorded the tool,
 * the shaper, the acceleration, the speed or the distance the numbers came
 * from.
 *
 * These tests are about the three things that changed, and they are about
 * BEHAVIOUR rather than about field names:
 *
 *  1. a measured fingerprint carries its conditions across the SD card;
 *  2. conditions that no longer match the machine are DETECTED;
 *  3. a hand-gathered set stays usable and stops looking measured.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, type Fingerprint } from "../src/shaping/engine/fit.ts";
import { hz, mm, mmPerS, mmPerS2 } from "../src/shaping/engine/units.ts";
import {
	type Conditions,
	held,
	type MachineNow,
	type Provenance,
	supersededBy,
	verdictOf,
} from "../src/shaping/evidence/evidence.ts";
import { conditionsOf, measuredThrough, type RingPlan, type VerifyPlan } from "../src/shaping/procedure.ts";
import { productsFor } from "../src/shaping/evidence/products.ts";
import { emptyResults, type Measurement, type ToolResults } from "../src/shaping/results.ts";
import { parseResults, serializeResults } from "../src/shaping/resultsCodec.ts";
import { modeForTest, prototypeFingerprint } from "./helpers/shaping.ts";

/**
 * The prototype's real ring run, `tools/accel/runs/ring/ring1/ring.json`:
 * 60 mm at 200 mm/s from 120,120 on a machine set to 6000 mm/s², three repeats
 * per direction, shaping off. Real numbers rather than round ones, so a
 * comparison that accidentally compares a value with itself cannot pass on a
 * pair of zeroes.
 */
const RING1: Conditions = {
	shaper: null,
	accelMmPerS2: 6000,
	speedMmPerS: 200,
	distMm: 60,
	repeats: 3,
};

const MEASURED: Provenance = { kind: "measured", at: "2026-08-22T14:31:07", under: RING1 };

const measurementOf = (fingerprint: Fingerprint, provenance: Provenance): Measurement => ({
	fingerprint,
	captures: [
		{ file: "ring1_Xp0.csv", axis: "X", dir: "+", rep: 0, fit: fingerprint.X!, tStop: null },
		{ file: "ring1_Ym2.csv", axis: "Y", dir: "-", rep: 2, fit: fingerprint.Y!, tStop: null },
	],
	provenance,
});

const resultsWith = (provenance: Provenance, tool = 0): ToolResults => ({
	...emptyResults(tool),
	measurement: measurementOf(prototypeFingerprint(), provenance),
});

/** The machine the prototype run was taken on, still in front of you. */
const SAME_MACHINE: MachineNow = { tool: 0, accelMmPerS2: 6000 };

/* ------------------------------------------------------ 1. it survives the card */

test("a measured fingerprint carries its conditions through the SD card intact", () => {
	const original = resultsWith(MEASURED);
	const parsed = parseResults(serializeResults(original));

	assert.notEqual(parsed, null, "a file this build wrote must be one it can read");
	// The whole record, not a field-by-field spot check: if the round trip lost
	// or reordered anything in the identity, this is what says so.
	assert.deepEqual(parsed, original);

	// And the identity specifically, spelled out — because `deepEqual` passing
	// on two objects that both lost the provenance would be a green test over
	// the exact bug.
	const prov = parsed!.measurement!.provenance;
	assert.equal(prov.kind, "measured");
	if (prov.kind !== "measured") return;
	assert.equal(prov.at, "2026-08-22T14:31:07");
	assert.deepEqual(prov.under, RING1);
});

test("a fingerprint written with no origin at all is not a file this build reads", () => {
	// The state #57 exists to make unwritable, forged by hand at the one place
	// it still can be — a text file on a card the operator can edit.
	const original = resultsWith(MEASURED);
	const raw = JSON.parse(serializeResults(original)) as Record<string, unknown>;
	const measurement = { ...(raw.measurement as Record<string, unknown>) };
	delete measurement.provenance;
	assert.equal(parseResults(JSON.stringify({ ...raw, measurement })), null);
});

test("a version-2 file — a fingerprint and captures as loose keys — is refused, not adopted", () => {
	// What every board holding results is carrying today. It is refused rather
	// than read as `unknown`, because a permanently unattributable card is a
	// warning nobody reads and these numbers WERE measured through `M593
	// P"none"`; see RESULTS_VERSION's note.
	const fp = prototypeFingerprint();
	const v2 = JSON.stringify({
		version: 2,
		tool: 0,
		fingerprint: fp,
		captures: [],
		sweep: null,
		candidates: [],
		verified: [],
		applied: null,
	});
	assert.equal(parseResults(v2), null);

	// And the version stamp alone is enough, tested separately so the refusal
	// is not resting on the shape change: this body IS a version-3 body,
	// labelled 2. A build that read it would be reading a fingerprint whose
	// origin the writing build had no way to record.
	const relabelled = JSON.parse(serializeResults(resultsWith(MEASURED))) as Record<string, unknown>;
	assert.equal(parseResults(JSON.stringify({ ...relabelled, version: 2 })), null);
});

/* ------------------------------------------ 2. a changed condition is detected */

test("a fingerprint measured at another acceleration is superseded, and the sentence names both", () => {
	const r = resultsWith(MEASURED);
	// The machine is now set to 10 000 mm/s² — the operator raised M204 after
	// measuring, which is the ordinary way this happens.
	const now: MachineNow = { tool: 0, accelMmPerS2: 10000 };

	const cause = supersededBy(r.tool, r.measurement!.provenance, now);
	assert.deepEqual(cause, { kind: "accel-changed", was: 6000, now: 10000 });

	// And it reaches the product the operator would act on.
	const products = productsFor(r, now, () => "");
	assert.equal(products.fingerprint.state, "superseded");
	if (products.fingerprint.state !== "superseded") return;
	assert.deepEqual(products.fingerprint.cause, cause);
	// The value SURVIVES being superseded: the numbers are still worth showing,
	// what changed is whether they describe the machine in front of you.
	assert.deepEqual(products.fingerprint.value, r.measurement!.fingerprint);
});

test("an acceleration change does not un-write tpost0.g, and the applied card says so", () => {
	// How far the supersede REACHES. `applied` is what was written into
	// `tpost<N>.g`; raising M204 afterwards does not undo that, and a sweep
	// reads forced response across a speed ladder rather than a ring-down. Only
	// the measurement and the arithmetic derived from it go stale.
	const r: ToolResults = {
		...resultsWith(MEASURED),
		sweep: null,
		applied: { type: "ei2", F: hz(52), S: 0.075 },
	};
	const products = productsFor(r, { tool: 0, accelMmPerS2: 10000 }, () => "");
	assert.equal(products.fingerprint.state, "superseded");
	assert.equal(products.applied.state, "held", "a written shaper is still written");
});

test("a TOOL change supersedes the whole file, applied included — it is another head's file", () => {
	const r: ToolResults = { ...resultsWith(MEASURED), applied: { type: "ei2", F: hz(52), S: 0.075 } };
	const products = productsFor(r, { tool: 2, accelMmPerS2: 6000 }, () => "");
	assert.equal(products.fingerprint.state, "superseded");
	assert.equal(products.applied.state, "superseded", "tool0.json's applied is T0's tpost0.g");
});

test("an acceleration that has not moved does not supersede — a detector that fires on everything says nothing", () => {
	const r = resultsWith(MEASURED);
	assert.equal(supersededBy(r.tool, r.measurement!.provenance, SAME_MACHINE), null);
	// Float round-tripping through the object model and JSON must not read as a
	// change: 6000.0001 is the same M204 setting.
	assert.equal(supersededBy(r.tool, r.measurement!.provenance, { tool: 0, accelMmPerS2: 6000.0001 }), null);
	// Nor must a machine that has stopped reporting one. A missing reading is a
	// failure to say, not a change.
	assert.equal(supersededBy(r.tool, r.measurement!.provenance, { tool: 0, accelMmPerS2: null }), null);

	const products = productsFor(r, SAME_MACHINE, () => "");
	assert.equal(products.fingerprint.state, "held");
});

test("the tool outranks the acceleration: both changed, and the sentence is about the carriage", () => {
	const r = resultsWith(MEASURED, 0);
	const cause = supersededBy(r.tool, r.measurement!.provenance, { tool: 2, accelMmPerS2: 10000 });
	// Carriage mass moves the FREQUENCY a shaper is tuned to; acceleration
	// changes how hard the mode was struck. When both moved, the tool is the
	// one worth reading.
	assert.deepEqual(cause, { kind: "tool-changed", was: 0, now: 2 });
});

test("a hand-gathered set cannot be checked against an acceleration it never recorded", () => {
	// The honest consequence of `assembled` carrying no conditions: there is
	// nothing to compare, so nothing supersedes — and the verdict below is what
	// says the numbers cannot be checked.
	const r = resultsWith({ kind: "assembled", n: 12 });
	assert.equal(supersededBy(r.tool, r.measurement!.provenance, { tool: 0, accelMmPerS2: 10000 }), null);
});

/* -------------------------- 3. gathered by hand is usable, and is not measured */

test("a hand-assembled fingerprint is usable but unattributable, never sound", () => {
	const fp = prototypeFingerprint();
	// No caveats at all: the numbers are clean, and this is precisely the case
	// the old code called `sound`.
	const assembled = held(fp, { kind: "assembled", n: 12 }, []);
	assert.equal(assembled.state, "held");
	if (assembled.state !== "held") return;
	assert.equal(verdictOf(assembled), "unattributable");

	// The same clean numbers WITH conditions are sound. The two must not read
	// alike — that is #57's requirement 2 in one assertion.
	const measured = held(fp, MEASURED, []);
	if (measured.state !== "held") return;
	assert.equal(verdictOf(measured), "sound");
});

test("`loaded` is unattributable too, and a disqualifying caveat still outranks it", () => {
	const fp = prototypeFingerprint();
	const loaded = held(fp, { kind: "loaded", path: "0:/sys/other.json" }, []);
	if (loaded.state !== "held") return;
	assert.equal(verdictOf(loaded), "unattributable");

	// `unusable` first: there is something to go and fix, and a missing
	// provenance is not actionable.
	const ripple = held(fp, { kind: "assembled", n: 12 }, [
		{ kind: "mode-on-forcing-locus", axis: "X", modeHz: hz(125), speedMmPerS: 25 },
	]);
	if (ripple.state !== "held") return;
	assert.equal(verdictOf(ripple), "unusable");
});

test("an assembled fingerprint stays USABLE — the 259 prototype captures are the whole reason", () => {
	const r = resultsWith({ kind: "assembled", n: 12 });
	const products = productsFor(r, SAME_MACHINE, () => "");
	// Held, with its value reachable. Unattributable arms a control; it never
	// takes one away.
	assert.equal(products.fingerprint.state, "held");
	if (products.fingerprint.state !== "held") return;
	assert.equal(verdictOf(products.fingerprint), "unattributable");
	assert.deepEqual(products.fingerprint.value, r.measurement!.fingerprint);
});

test("a measured file reaches the screen as measured — nothing hands back `unknown` any more", () => {
	const r = resultsWith(MEASURED);
	const products = productsFor(r, SAME_MACHINE, () => "");
	assert.equal(products.fingerprint.state, "held");
	if (products.fingerprint.state !== "held") return;
	assert.equal(products.fingerprint.provenance.kind, "measured");
});

/* ------------------------------------------- what a run records, and from where */

test("a ring plan records shaping off; a verify plan records the shaper it installs", () => {
	const ring: RingPlan = {
		kind: "ring",
		axis: "X",
		start: { x: mm(120), y: mm(120) },
		distMm: mm(60),
		speed: mmPerS(200),
		repeats: 3,
		namePrefix: "ring1",
	};
	assert.deepEqual(conditionsOf(ring, mmPerS2(6000)), RING1);

	const verify: VerifyPlan = { kind: "verify", spec: { type: "ei2", F: hz(52), S: 0.075 }, ring };
	const under = conditionsOf(verify, mmPerS2(6000));
	assert.notEqual(under, null);
	// The SAME move, through a shaper — which is exactly what makes a verify
	// comparable to its baseline, and exactly what a file could not say before.
	assert.deepEqual(under, { ...RING1, shaper: { type: "ei2", F: 52, S: 0.075 } });

	// One producer for the label and the command: what is recorded is what is
	// sent. A second switch beside the recorder is how a file comes to say
	// "shaping off" over a run that really sent `M593 P"ei2"`.
	assert.equal(measuredThrough(ring), null);
	assert.deepEqual(measuredThrough(verify), verify.spec);
});

test("a sweep records no single condition, because it has none", () => {
	// Eight speeds in one plan: there is no `speedMmPerS` that describes it,
	// and its captures never reach `aggregate`. A plausible invented speed
	// would be worse than nothing — it can be compared, and it would agree.
	assert.equal(
		conditionsOf(
			{ kind: "sweep", start: { x: mm(90), y: mm(90) }, distMm: mm(60), speeds: [mmPerS(25), mmPerS(200)], namePrefix: "sw" },
			mmPerS2(6000),
		),
		null,
	);
});

test("the fingerprint a partial set aggregates to still carries an origin", () => {
	// A capture the fitter refused is in the file and out of the median. That
	// is unchanged by #57 — what is new is that the record says where the whole
	// batch came from, so "6 of 12 fitted" and "these were ticked by hand" are
	// two separate facts rather than one guess.
	const fp = aggregate([
		{ axis: "X", fit: modeForTest(18.1, 0.127, 0.05) },
		{ axis: "X", fit: { reason: "short-decay", f: hz(18), cyclesFit: 1.9 } },
		{ axis: "Y", fit: modeForTest(51.6, 0.075, 0.103) },
	]);
	const r: ToolResults = { ...emptyResults(0), measurement: { fingerprint: fp, captures: [], provenance: MEASURED } };
	const parsed = parseResults(serializeResults(r));
	assert.deepEqual(parsed, r);
	assert.equal(parsed!.measurement!.provenance.kind, "measured");
});
