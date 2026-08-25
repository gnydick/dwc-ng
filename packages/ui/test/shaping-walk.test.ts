/**
 * The walk: where the session has got to, and the next question.
 *
 * The case that motivated it is the FIRST one below. The thread it replaced
 * was a fold over caveats, so a machine that had measured nothing produced no
 * caveats and the card said nothing at all — Gabe wiped his shaping data on
 * 2026-08-24 and the screen offered "Next: Measure" and silence about why.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { walkThrough } from "../src/shaping/evidence/walk.ts";
import { inquiryText } from "../src/shaping/copy.ts";
import { held, type Provenance } from "../src/shaping/evidence/evidence.ts";
import type { Caveat } from "../src/shaping/evidence/caveat.ts";
import type { WorkflowProducts } from "../src/shaping/steps.ts";
import { emptyResults, type ToolResults } from "../src/shaping/results.ts";
import type { Fingerprint, Mode } from "../src/shaping/engine/fit.ts";
import { g, hz } from "../src/shaping/engine/units.ts";
import { measuredUnder } from "./helpers/shaping.ts";

const PROV: Provenance = { kind: "unknown", why: "not recorded" };
const mode = (f: number): Mode => ({ f: hz(f), zeta: 0.1, peakG: g(0.2), cyclesFit: 3 } as Mode);

const NOTHING: WorkflowProducts = {
	fingerprint: { state: "absent" },
	sweep: { state: "absent" },
	candidates: { state: "absent" },
	verified: { state: "absent" },
	applied: { state: "absent" },
};

const open = (w: ReturnType<typeof walkThrough>) => w.lines.filter((l) => l.kind === "open");
const known = (w: ReturnType<typeof walkThrough>) => w.lines.filter((l) => l.kind === "known");

test("a tool that has measured nothing still walks", () => {
	// THE BUG THIS EXISTS FOR. A caveat-only thread was empty here.
	const w = walkThrough(emptyResults(0), NOTHING);
	assert.equal(w.lines.length, 5, "one line per stage, always");
	assert.equal(open(w).length, 5);
	assert.ok(w.next !== null, "there is always something to answer");
	assert.equal(w.next.step, "measure");
	assert.match(inquiryText(w.next.inquiry), /frequencies/i);
	assert.match(inquiryText(w.next.inquiry), /Run Measure/);
});

test("the live question is one of the listed ones, by reference", () => {
	// Same guarantee nextStep gives for the step it names: a prominent question
	// the list does not contain is how the two come to disagree.
	const w = walkThrough(emptyResults(0), NOTHING);
	assert.ok(w.lines.includes(w.next!));
});

test("a known stage states its numbers so they can be checked", () => {
	const fp: Fingerprint = { X: mode(38.66), Y: mode(50.05), n: { X: 20, Y: 10 }, spreadHz: { X: 0.65, Y: 8.91 } };
	const r: ToolResults = { ...emptyResults(0), measurement: { fingerprint: fp, provenance: measuredUnder(), captures: new Array(40).fill(null).map((_, i) => ({ file: `c${i}.csv`, axis: "X" as const, dir: "+" as const, rep: i, fit: mode(38.66), tStop: null })) } };
	const p: WorkflowProducts = { ...NOTHING, fingerprint: held(fp, PROV, []) };
	const w = walkThrough(r, p);
	const first = known(w)[0];
	assert.ok(first !== undefined && first.kind === "known");
	assert.match(first.text, /38\.7|38\.66/);
	assert.match(first.text, /40 captures/);
	// #57 requirement 4: the line says what the numbers are a measurement OF.
	// The date alone here — the acceleration and the shaper are what the
	// superseded line and the armed confirm say, and six numbers on a line
	// whose job is to report a finding would drown the finding.
	assert.match(first.text, /measured 2026-08-23/);
	// The next question has moved on to the stage that has not been done.
	assert.equal(w.next?.step, "sweep");
});

test("a hand-gathered fingerprint says so on the line the operator reads it from", () => {
	// The difference #57 exists for, at the place a person actually meets it:
	// the same clean numbers, and the line does not claim they were measured.
	const fp: Fingerprint = { X: mode(38.66), Y: mode(50.05), n: { X: 2, Y: 2 }, spreadHz: { X: 0.65, Y: 8.91 } };
	const r: ToolResults = {
		...emptyResults(0),
		measurement: { fingerprint: fp, provenance: { kind: "assembled", n: 12 }, captures: [] },
	};
	const w = walkThrough(r, { ...NOTHING, fingerprint: held(fp, { kind: "assembled", n: 12 }, []) });
	const first = known(w)[0];
	assert.ok(first !== undefined && first.kind === "known");
	assert.match(first.text, /gathered by hand/);
	assert.doesNotMatch(first.text, /measured 20/);
});

test("a stage that RAN but is caveated does not read as finished", () => {
	const fp: Fingerprint = { X: mode(38.66), Y: null, n: { X: 20, Y: 0 }, spreadHz: { X: 0.65, Y: 0 } };
	const caveat: Caveat = { kind: "one-direction-only", axis: "Y", dir: "-", n: 10, refused: 10 };
	const p: WorkflowProducts = { ...NOTHING, fingerprint: held(fp, PROV, [caveat]) };
	const w = walkThrough({ ...emptyResults(0), measurement: { fingerprint: fp, captures: [], provenance: measuredUnder() } }, p);
	// It contributes a known line AND its finding as an open question, and the
	// finding comes before the next stage's question.
	assert.equal(w.next?.step, "measure", "its own finding outranks the stage after it");
	assert.match(inquiryText(w.next!.inquiry), /other end of its travel/);
});

test("a disqualifying finding is asked before an advisory one on the same stage", () => {
	const fp: Fingerprint = { X: mode(38.66), Y: null, n: { X: 20, Y: 0 }, spreadHz: { X: 0.65, Y: 0 } };
	const advisory: Caveat = { kind: "few-fits", axis: "X", n: 2, of: 20 };
	const bad: Caveat = { kind: "mode-on-forcing-locus", axis: "X", modeHz: hz(38.66), speedMmPerS: 7.7 };
	const p: WorkflowProducts = { ...NOTHING, fingerprint: held(fp, PROV, [advisory, bad]) };
	const w = walkThrough({ ...emptyResults(0), measurement: { fingerprint: fp, captures: [], provenance: measuredUnder() } }, p);
	assert.match(inquiryText(w.next!.inquiry), /resonance at all|motors/i);
});

test("the walk is ordered by the workflow, not by severity across stages", () => {
	// A note about the ranking while the fingerprint under it is questionable
	// points at the wrong thing.
	const fp: Fingerprint = { X: mode(38.66), Y: null, n: { X: 20, Y: 0 }, spreadHz: { X: 0.65, Y: 0 } };
	const p: WorkflowProducts = {
		...NOTHING,
		fingerprint: held(fp, PROV, [{ kind: "few-fits", axis: "X", n: 2, of: 20 }]),
		candidates: held([{}, {}], PROV, [{ kind: "predicted-not-measured", n: 2 }]),
	};
	const w = walkThrough({ ...emptyResults(0), measurement: { fingerprint: fp, captures: [], provenance: measuredUnder() }, candidates: [] as never[] }, p);
	assert.equal(w.next?.step, "measure");
});

test("every stage question is a question and every answer names an act", () => {
	const w = walkThrough(emptyResults(0), NOTHING);
	for (const l of open(w)) {
		assert.match(l.inquiry.question, /\?$/, `not a question: ${l.inquiry.question}`);
		const text = inquiryText(l.inquiry);
		assert.ok(!/\bundefined\b|\bNaN\b/.test(text), text);
		assert.match(text, /Run |Send |Nothing on this screen|check |try /i, `no act named: ${text}`);
	}
});
