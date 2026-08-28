/**
 * @invariant a-selection-is-one-of-this-tools-own-results (shaping/selection.ts)
 *
 * Gabe, 2026-08-27: "tap means use this spec". Before GIT_108 the tap set an
 * index the Verify card honoured and the Apply card did not — tap row 3, the
 * verify run measured row 3, and the Apply card still offered row 1 to write
 * into `tpost<N>.g`. Two cards answering "which spec are we acting on" for
 * themselves.
 *
 * These tests drive the REAL service factory and the REAL resolver, never a
 * reimplementation of either: the value asserted here is the same object both
 * card bodies read.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "solid-js";
import { readFileSync } from "node:fs";
// The real factory, imported where it now lives (#126): the registry entry
// `SERVICES.shaping` reads a slot the Lab's chunk fills at load time, and a
// test that never loads that chunk has nothing to read. Constructing the
// factory directly is the same object the registry hands a card.
import { shapingService } from "../src/compose/shapingService.ts";
import { candidateFor, type Candidate } from "../src/shaping/engine/rank.ts";
import { aggregate, type Fingerprint } from "../src/shaping/engine/fit.ts";
import { hz, seconds } from "../src/shaping/engine/units.ts";
import { verifyAnalysis, type VerifiedCandidate } from "../src/shaping/store.ts";
import { emptyResults, type ToolResults } from "../src/shaping/results.ts";
import { parseResults, serializeResults } from "../src/shaping/resultsCodec.ts";
import { recommendation, selectionOf, specKey } from "../src/shaping/selection.ts";
import { measuredUnder, modeForTest, prototypeFingerprint, stubShapingBase } from "./helpers/shaping.ts";

const FP: Fingerprint = prototypeFingerprint();

/** Three ranked shapers in a fixed order, so "the third one" is a thing a test
 *  can name and the regression has a row 0 to be wrong about. */
const THREE: readonly Candidate[] = [
	candidateFor({ type: "zvd", F: hz(18.1), S: 0.05 }, FP),
	candidateFor({ type: "mzv", F: hz(35), S: 0.1 }, FP),
	candidateFor({ type: "ei2", F: hz(52), S: 0.075 }, FP),
];

/** A verify run that left a quarter of the Y ring and introduced nothing —
 *  clean, so `recommendation` prefers it over anything merely predicted. */
function cleanVerify(spec: Parameters<typeof candidateFor>[0]): VerifiedCandidate {
	const after: Fingerprint = aggregate([
		{ axis: "X", fit: { reason: "below-floor" } },
		{ axis: "Y", fit: modeForTest(51.6, 0.075, 0.028) },
	]);
	return verifyAnalysis(FP, candidateFor(spec, FP), after);
}

const withResults = (over: Partial<ToolResults>): ToolResults => ({ ...emptyResults(0), ...over });

/** Block and line comments out, so a source assertion is about the code and
 *  not about the prose explaining what the code no longer does. */
const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/[^\n]*/g, "$1");

/* ------------------------------------------------ the regression, end to end */

test("tapping the third candidate is the spec the acting cards get — through the real service", () => {
	createRoot(dispose => {
		const svc = shapingService(stubShapingBase());
		svc.store.setCandidates(svc.tool(), THREE);

		svc.select(THREE[2]!.spec);

		const got = svc.selection();
		assert.notEqual(got, null, "three ranked candidates and a tap must select something");
		assert.equal(
			specKey(got!.spec),
			specKey(THREE[2]!.spec),
			"the tapped spec, not the ranking's own top row — this is the GIT_108 defect",
		);
		assert.notEqual(specKey(got!.spec), specKey(THREE[0]!.spec));
		dispose();
	});
});

test("both readers read ONE value: the cards ask the service and derive nothing themselves", () => {
	// Comments stripped first: this asserts about the CODE, and the card's own
	// prose explains the very call it must no longer make.
	const card = stripComments(readFileSync(new URL("../src/cards/ShapingCards.tsx", import.meta.url), "utf8"));
	// The private answer is gone from the card file: `recommendation` lives in
	// shaping/selection.ts, where it is the DEFAULT selection rather than the
	// Apply card's second opinion.
	assert.equal(/\brecommendation\(/.test(card), false, "the Apply card must not compute its own answer");
	assert.equal(/candidateIndex/.test(card), false, "the selection is an identity, not a row index");
	// Twice: the verify run's request, and the Apply card's line.
	assert.equal(card.match(/svc\.selection\(\)/g)?.length, 2, "exactly the two acting cards read the selection");
});

/* ------------------------------------------------------- the default, and why */

test("with nothing tapped the selection is recommendation()'s answer — including a verified spec absent from candidates", () => {
	// The trap that decided the design: an index into `candidates` could not
	// have expressed this default at all.
	const verified = cleanVerify({ type: "ei3", F: hz(49), S: 0.15 });
	const r = withResults({ candidates: THREE, verified: [verified] });
	assert.equal(
		THREE.some(c => specKey(c.spec) === specKey(verified.spec)),
		false,
		"the fixture only means something if the verified spec is NOT one of the ranked rows",
	);

	const got = selectionOf(r, null);
	assert.equal(specKey(got!.spec), specKey(verified.spec));
	assert.equal(got!.basis, "verified");
	assert.equal(specKey(recommendation(r)!.spec), specKey(got!.spec), "the default IS the recommendation");
});

test("nothing ranked and nothing verified selects nothing at all", () => {
	assert.equal(selectionOf(emptyResults(0), null), null);
});

test("with nothing verified the default is the ranking's top row, labelled predicted", () => {
	const got = selectionOf(withResults({ candidates: THREE }), null);
	assert.equal(specKey(got!.spec), specKey(THREE[0]!.spec));
	assert.equal(got!.basis, "predicted");
});

/* ----------------------------------------------------------------- the basis */

test("a tap that departs from the recommendation is labelled an override; tapping it is not", () => {
	const verified = cleanVerify({ type: "ei3", F: hz(49), S: 0.15 });
	const r = withResults({ candidates: THREE, verified: [verified] });

	assert.equal(selectionOf(r, specKey(THREE[1]!.spec))!.basis, "override");
	assert.equal(selectionOf(r, specKey(verified.spec))!.basis, "verified", "tapping the recommendation is not a departure from it");
	assert.equal(selectionOf(withResults({ candidates: THREE }), specKey(THREE[0]!.spec))!.basis, "predicted");
});

/* ----------------------------------------------- requirement 5: best evidence */

test("a tapped spec that was verified carries the verify run's own numbers, not only the prediction", () => {
	const spec = THREE[2]!.spec;
	const verified = cleanVerify(spec);
	const r = withResults({ candidates: THREE, verified: [verified] });

	const got = selectionOf(r, specKey(spec))!;
	assert.notEqual(got.verified, null, "the verify run for the tapped spec must come with it");
	assert.equal(got.verified!.measured.Y! > 0, true, "and it is the measured ratio, not a residual");
	assert.notEqual(got.candidate, null, "the prediction is still there for the cards that want both");

	// A spec nobody has verified says so by having no verify run, rather than
	// by borrowing another row's.
	const other = selectionOf(r, specKey(THREE[1]!.spec))!;
	assert.equal(other.verified, null);
	assert.notEqual(other.candidate, null);
});

test("the Apply card reads the verify run BEFORE the prediction", () => {
	const card = readFileSync(new URL("../src/cards/ShapingCards.tsx", import.meta.url), "utf8");
	const verifiedAt = card.indexOf("<Match when={made().verified}>");
	const predictedAt = card.indexOf("<Match when={made().candidate}>");
	assert.ok(verifiedAt > 0 && predictedAt > 0, "the Result row must offer both");
	assert.ok(verifiedAt < predictedAt, "measured numbers outrank predicted ones for the same spec");
});

/* ------------------------------------------------------------ the tool switch */

test("a key made against one tool's results selects the OTHER tool's own default", () => {
	const t0 = withResults({ candidates: THREE });
	const t1: ToolResults = { ...emptyResults(1), candidates: [candidateFor({ type: "zvdd", F: hz(17.5), S: 0.2 }, FP)] };

	const stale = specKey(THREE[2]!.spec);
	assert.equal(specKey(selectionOf(t0, stale)!.spec), stale, "the fixture's key must mean something on T0");

	const got = selectionOf(t1, stale)!;
	assert.equal(specKey(got.spec), specKey(t1.candidates[0]!.spec), "a stale key resolves to nothing, so the default stands");
	assert.equal(got.basis, "predicted");
});

test("svc.setTool drops the tap as well as the arm", () => {
	createRoot(dispose => {
		const svc = shapingService(stubShapingBase());
		svc.store.setCandidates(svc.tool(), THREE);
		svc.select(THREE[2]!.spec);
		assert.notEqual(svc.specPick(), null);

		svc.setTool(svc.tool() + 1);

		assert.equal(svc.specPick(), null, "a tap belongs to the head it was made on");
		dispose();
	});
});

/* ----------------------------------------------------------------- the key */

test("specKey is the identity of the line, and survives the results file", () => {
	const same = specKey({ type: "ei2", F: hz(52), S: 0.075 });
	assert.equal(specKey({ type: "ei2", F: hz(52), S: 0.075 }), same);
	assert.notEqual(specKey({ type: "ei2", F: hz(52), S: 0.1 }), same);
	assert.notEqual(specKey({ type: "ei2", F: hz(52.5), S: 0.075 }), same);
	assert.notEqual(specKey({ type: "ei3", F: hz(52), S: 0.075 }), same);

	// A tap made against the ranking must still name the spec after the file
	// has been written and read back — the two halves of a session.
	const custom = { type: "custom", H: [0.335, 0.2641, 0.2242], T: [seconds(0.00972), seconds(0.0278), seconds(0.03752)] } as const;
	// With the measurement, because the codec re-scores every candidate against
	// the fingerprint on the way back in rather than trusting the file's numbers.
	const written = withResults({
		measurement: { fingerprint: FP, captures: [], provenance: measuredUnder() },
		candidates: [...THREE, candidateFor(custom, FP)],
	});
	const read = parseResults(serializeResults(written))!;
	assert.notEqual(read, null);
	assert.deepEqual(read.candidates.map(c => specKey(c.spec)), written.candidates.map(c => specKey(c.spec)));
});
