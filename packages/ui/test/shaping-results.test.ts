/**
 * The per-tool results file: its path, its parse boundary, and the store that
 * is the only thing that reads or writes it (spec I7).
 *
 * The file lives on the SD card next to config.g, which means it is
 * hand-editable and therefore hostile input. What comes back is not "a
 * ToolResults that was saved" but "text" — so these tests care as much about
 * what parseResults REFUSES as about what it round-trips.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ConnectorReads, ConnectorWrites } from "@dwc-ng/connector";
import { unwrap } from "solid-js/store";
import { RESULTS_PATH, emptyResults, parseResults, serializeResults, type ToolResults } from "../src/shaping/results.ts";
import { createShapingStore, verifyAnalysis } from "../src/shaping/store.ts";
import { candidateFor } from "../src/shaping/engine/rank.ts";
import { aggregate, type Fingerprint } from "../src/shaping/engine/fit.ts";
import { hz, mmPerS, seconds } from "../src/shaping/engine/units.ts";
import type { SweepMatrix } from "../src/shaping/engine/sweep.ts";
import { modeForTest, prototypeFingerprint } from "./helpers/shaping.ts";

function sweepFixture(): SweepMatrix {
	return {
		speeds: [mmPerS(100), mmPerS(200)],
		freqs: Float64Array.from([0, 1, 2]),
		amps: Float64Array.from([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]),
		fullStepHz: [hz(500), hz(1000)],
		maxHz: 2,
	};
}

/** The shape a real tool ends a tuning session with: fits, sweep, ranking, one verify. */
function fullResults(tool = 0): ToolResults {
	const fp = prototypeFingerprint();
	const verifyFp: Fingerprint = aggregate([
		{ axis: "X", fit: { reason: "below-floor" } },
		{ axis: "Y", fit: modeForTest(51.6, 0.075, 0.028) },
	]);
	const best = candidateFor({ type: "ei2", F: hz(52), S: 0.075 }, fp);
	const custom = candidateFor({ type: "custom", H: [0.335, 0.2641, 0.2242], T: [seconds(0.00972), seconds(0.0278), seconds(0.03752)] }, fp);
	return {
		tool,
		fingerprint: fp,
		captures: [
			{ file: "0:/sys/accelerometer/ring_Xp0.csv", axis: "X", dir: "+", rep: 0, fit: fp.X!, tStop: seconds(0.312) },
			{ file: "0:/sys/accelerometer/ring_Xm0.csv", axis: "X", dir: "-", rep: 0, fit: { reason: "below-floor" }, tStop: null },
		],
		sweep: sweepFixture(),
		candidates: [best, custom],
		verified: [verifyAnalysis(fp, best, verifyFp)],
		applied: { type: "ei2", F: hz(52), S: 0.075 },
	};
}

test("RESULTS_PATH names one file per tool under 0:/sys/dwc-ng/shaping", () => {
	assert.equal(RESULTS_PATH(0), "0:/sys/dwc-ng/shaping/tool0.json");
	assert.equal(RESULTS_PATH(3), "0:/sys/dwc-ng/shaping/tool3.json");
});

test("a full results set survives serialize → parse unchanged", () => {
	const original = fullResults(2);
	const parsed = parseResults(serializeResults(original));
	assert.notEqual(parsed, null);
	assert.deepEqual(parsed, original);
});

test("an empty results set round-trips too", () => {
	const parsed = parseResults(serializeResults(emptyResults(1)));
	assert.deepEqual(parsed, emptyResults(1));
});

test("malformed JSON is null, never a throw", () => {
	for (const text of ["", "   ", "not json", "{", "[1,2,3]", "null", '"a string"', "42"]) {
		assert.equal(parseResults(text), null, `parseResults(${JSON.stringify(text)})`);
	}
});

test("well-formed JSON with mis-typed fields is refused whole", () => {
	const good = JSON.parse(serializeResults(fullResults(0))) as Record<string, unknown>;
	const broken: Array<[string, unknown]> = [
		["tool", "0"],
		["tool", -1],
		["tool", 1.5],
		["captures", "many"],
		["captures", [{ file: 7, axis: "X", dir: "+", rep: 0, fit: { reason: "below-floor" }, tStop: null }]],
		["captures", [{ file: "a.csv", axis: "Z", dir: "+", rep: 0, fit: { reason: "below-floor" }, tStop: null }]],
		["fingerprint", { X: { f: "eighteen", zeta: 0.1, peakG: 0.05, cyclesFit: 3 }, Y: null, n: { X: 1, Y: 0 }, spreadHz: { X: 0, Y: 0 } }],
		["fingerprint", { X: { f: 18, zeta: 9, peakG: 0.05, cyclesFit: 3 }, Y: null, n: { X: 1, Y: 0 }, spreadHz: { X: 0, Y: 0 } }],
		["sweep", { speeds: [100], freqs: [0, 1], amps: [0.1], fullStepHz: [500], maxHz: 1 }],
		["candidates", [{ type: "ei9", F: 52, S: 0.075 }]],
		["candidates", [{ type: "custom", H: [0.9, 0.9], T: [0.01, 0.02] }]],
		["applied", { type: "ei2", F: 52 }],
		["verified", [{ spec: { type: "ei2", F: 52, S: 0.075 } }]],
	];
	for (const [key, value] of broken) {
		assert.equal(parseResults(JSON.stringify({ ...good, [key]: value })), null, `${key} = ${JSON.stringify(value)}`);
	}
});

test("a file from another build — wrong or missing version — is refused", () => {
	const good = JSON.parse(serializeResults(fullResults(0))) as Record<string, unknown>;
	assert.equal(parseResults(JSON.stringify({ ...good, version: 99 })), null);
	assert.equal(parseResults(JSON.stringify({ ...good, version: undefined })), null);
});

test("unknown fields are dropped, not carried, and the prototype is unreachable", () => {
	const good = JSON.parse(serializeResults(fullResults(0))) as Record<string, unknown>;
	const withExtras = JSON.stringify({ ...good, notAField: { deep: true }, ["__proto__"]: { polluted: "yes" } });
	const parsed = parseResults(withExtras);
	assert.notEqual(parsed, null);
	assert.deepEqual(parsed, fullResults(0));
	assert.equal(Object.hasOwn(parsed as object, "notAField"), false);
	const probe = {} as Record<string, unknown>;
	const leaked = probe.polluted;
	if (leaked !== undefined) delete (Object.prototype as Record<string, unknown>).polluted;
	assert.equal(leaked, undefined, "Object.prototype gained a key from the results file");
});

test("scores in the file are re-derived, never trusted", () => {
	// Hand-edit a candidate's residual to a lie; the parse recomputes it from
	// the spec against the fingerprint, so the lie cannot reach the ranking.
	const good = JSON.parse(serializeResults(fullResults(0))) as Record<string, unknown>;
	const lie = { ...good, candidates: [{ type: "ei2", F: 52, S: 0.075, residual: { X: 0, Y: 0 }, worstRobust: 0 }] };
	const parsed = parseResults(JSON.stringify(lie));
	assert.notEqual(parsed, null);
	const c = parsed!.candidates[0]!;
	assert.ok(c.worstRobust > 0.1, `recomputed worstRobust ${c.worstRobust}`);
});

/** A connector whose file system is a Map — nothing else of ConnectorReads is reached. */
function fakeConn(): ConnectorReads & Pick<ConnectorWrites, "upload"> & { files: Map<string, string> } {
	const files = new Map<string, string>();
	return {
		files,
		download: async (path: string) => {
			const text = files.get(path);
			if (text === undefined) throw new Error(`${path}: not found`);
			return text;
		},
		list: async () => [],
		getFileInfo: async () => {
			throw new Error("not used");
		},
		getThumbnail: async () => {
			throw new Error("not used");
		},
		upload: async (path: string, content: Uint8Array | string) => {
			files.set(path, typeof content === "string" ? content : new TextDecoder().decode(content));
		},
	};
}

test("save writes RESULTS_PATH and load brings the same results back", async () => {
	const conn = fakeConn();
	const store = createShapingStore(conn);
	const results = fullResults(1);
	store.setFingerprint(1, results.fingerprint);
	for (const c of results.captures) store.addCapture(1, c);
	store.setSweep(1, results.sweep);
	store.setCandidates(1, results.candidates);
	for (const v of results.verified) store.addVerified(1, v);
	store.setApplied(1, results.applied);
	assert.deepEqual(unwrap(store.results[1]!), results);

	await store.save(1);
	assert.ok(conn.files.has(RESULTS_PATH(1)), `wrote ${[...conn.files.keys()].join(", ")}`);

	const reloaded = createShapingStore(conn);
	await reloaded.load(1);
	assert.deepEqual(unwrap(reloaded.results[1]!), results);
	assert.equal(reloaded.error(), "");
});

test("loading a tool with no file on the card is empty, not an error state", async () => {
	const store = createShapingStore(fakeConn());
	await store.load(4);
	assert.deepEqual(unwrap(store.results[4]!), emptyResults(4));
	assert.equal(store.error(), "");
});

test("loading a corrupt file says so and leaves the tool empty", async () => {
	const conn = fakeConn();
	conn.files.set(RESULTS_PATH(0), "{ this is not json");
	const store = createShapingStore(conn);
	await store.load(0);
	assert.deepEqual(unwrap(store.results[0]!), emptyResults(0));
	assert.match(store.error(), /tool0\.json/);
});

test("verifyAnalysis is the only way to a VerifiedCandidate, and measures against the baseline", () => {
	const fp = prototypeFingerprint();
	const cand = candidateFor({ type: "ei2", F: hz(52), S: 0.075 }, fp);
	const verifyFp = aggregate([
		{ axis: "X", fit: { reason: "below-floor" } },
		{ axis: "Y", fit: modeForTest(51.6, 0.075, 0.028) },
	]);
	const v = verifyAnalysis(fp, cand, verifyFp);
	assert.equal(v.spec, cand.spec);
	assert.equal(v.measured.X, 0, "an axis that no longer rings measures zero, not undefined");
	assert.ok(Math.abs(v.measured.Y! - 0.028 / 0.103) < 0.05, `Y ${v.measured.Y}`);
	assert.deepEqual(v.artefacts, [], "51.6 Hz was already in the baseline");
	assert.equal(v.fingerprint, verifyFp);
});

test("verifyAnalysis flags a mode the unshaped machine never had", () => {
	const fp = prototypeFingerprint();
	const cand = candidateFor({ type: "zvdd", F: hz(17.5), S: 0.1 }, fp);
	// modeForTest's amp is the raw signal amplitude; the fitted envelope peak
	// lands near half of it, so 0.25 g of ring is what clears newPeaks' 0.05 g
	// floor. The Y amp stays below that floor deliberately — a 51.6 Hz mode is
	// in the baseline and must not be reported as new either way.
	const verifyFp = aggregate([
		{ axis: "X", fit: modeForTest(38.0, 0.09, 0.25) },
		{ axis: "Y", fit: modeForTest(51.6, 0.075, 0.03) },
	]);
	const v = verifyAnalysis(fp, cand, verifyFp);
	assert.equal(v.artefacts.length, 1);
	assert.equal(v.artefacts[0]!.axis, "X");
	assert.ok(Math.abs(v.artefacts[0]!.hz - 38) < 1.5, `artefact at ${v.artefacts[0]!.hz} Hz`);
});
