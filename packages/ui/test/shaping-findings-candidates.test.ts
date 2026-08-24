/**
 * Candidates are arithmetic over a fingerprint, and they inherit its problems.
 *
 * This is the arm that stops Apply presenting a clean button over dirty
 * evidence: on this machine the top-ranked candidate previously introduced a
 * 38 Hz mode, and no amount of better ranking would have caught it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { candidateCaveats } from "../src/shaping/evidence/findings.ts";
import { caveatText } from "../src/shaping/copy.ts";
import { type Caveat, severityOf } from "../src/shaping/evidence/caveat.ts";
import { type Evidence, held, type Provenance } from "../src/shaping/evidence/evidence.ts";
import { hz } from "../src/shaping/engine/units.ts";

const MEASURED: Provenance = { kind: "measured", at: "2026-08-23T09:14:02", tool: 0 };
const FEW: Caveat = { kind: "few-fits", axis: "Y", n: 3, of: 10 };
const RIPPLE: Caveat = { kind: "mode-on-forcing-locus", axis: "X", modeHz: hz(125), speedMmPerS: 25 };
const CANDS: readonly unknown[] = [{}, {}, {}];

test("candidates always say they are predictions until something is verified", () => {
	const cs = candidateCaveats(CANDS, held(null, MEASURED, []), 0);
	const c = cs.find((x) => x.kind === "predicted-not-measured");
	assert.ok(c !== undefined && c.kind === "predicted-not-measured");
	assert.equal(c.n, 3);
});

test("once a candidate has been verified the prediction caveat drops", () => {
	const cs = candidateCaveats(CANDS, held(null, MEASURED, []), 1);
	assert.equal(cs.filter((c) => c.kind === "predicted-not-measured").length, 0);
});

test("a caveated fingerprint makes every candidate caveated, with the reason", () => {
	const cs = candidateCaveats(CANDS, held(null, MEASURED, [FEW]), 1);
	const inherited = cs.find((c) => c.kind === "inherited");
	assert.ok(inherited !== undefined && inherited.kind === "inherited", "the fingerprint's problem must reach the ranking");
	assert.equal(inherited.from, "fingerprint");
	assert.deepEqual(inherited.caveat, FEW);
	// The sentence has to carry the ORIGINAL reason, not merely a pointer to
	// it: "see the fingerprint" is the kind of note an operator skips.
	const text = caveatText(inherited);
	assert.match(text, /fingerprint/);
	assert.ok(text.includes(caveatText(FEW)), "the inner sentence must survive intact");
});

test("a disqualifying fingerprint caveat still disqualifies the ranking", () => {
	// The whole point of inheritance: ranking against motor ripple is
	// arithmetic against a mode that is not there.
	const cs = candidateCaveats(CANDS, held(null, MEASURED, [RIPPLE]), 1);
	const inherited = cs.find((c) => c.kind === "inherited");
	assert.ok(inherited !== undefined);
	assert.equal(severityOf(inherited), "disqualifying");
});

test("a fingerprint that is not held contributes nothing to inherit", () => {
	const absent: Evidence<unknown> = { state: "absent" };
	assert.equal(candidateCaveats(CANDS, absent, 1).filter((c) => c.kind === "inherited").length, 0);
});

test("an empty ranking says nothing at all", () => {
	assert.equal(candidateCaveats([], held(null, MEASURED, [FEW]), 0).length, 0);
});
