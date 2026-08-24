/**
 * An unmeasured axis is not an axis with no mode.
 *
 * Gabe ran the first real Verify on 2026-08-24 and the card told him the
 * shaper "excites 54 Hz on Y (0.051 g) that the unshaped machine does not".
 * It does not. His BASELINE had no Y mode at all (`n.Y === 0`, every Y capture
 * refused), so the only known mode was X at 38.83 Hz, and a perfectly ordinary
 * Y ring at 54 Hz was 39 % away from it and got reported as an artefact. His Y
 * really rings near 50 Hz; 54 against that is 8 %, inside the 15 % tolerance,
 * and nothing would have been said.
 *
 * Same shape as the `spreadOf([])` bug: absence of measurement read as
 * measurement of absence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { newPeaks } from "../src/shaping/engine/artefact.ts";
import { verifiedCaveats } from "../src/shaping/evidence/findings.ts";
import { caveatText } from "../src/shaping/copy.ts";
import { severityOf } from "../src/shaping/evidence/caveat.ts";
import type { Fingerprint, Mode } from "../src/shaping/engine/fit.ts";
import { g, hz } from "../src/shaping/engine/units.ts";

const mode = (f: number, peak = 0.2): Mode =>
	({ f: hz(f), zeta: 0.1, peakG: g(peak), cyclesFit: 3 } as Mode);

/** Gabe's board as it stood: 14 X fits, zero Y. */
const NO_Y: Fingerprint = { X: mode(38.83), Y: null, n: { X: 14, Y: 0 }, spreadHz: { X: 0.6, Y: 0 } };
/** The same machine with Y measured, which is what it actually does. */
const BOTH: Fingerprint = { X: mode(38.83), Y: mode(50.05), n: { X: 14, Y: 10 }, spreadHz: { X: 0.6, Y: 0.5 } };
/** The verify run: Y rang at 54 Hz, just over the 0.05 g floor. */
const VERIFIED: Fingerprint = { X: mode(38.9, 0.02), Y: mode(54, 0.051), n: { X: 5, Y: 5 }, spreadHz: { X: 0, Y: 0 } };

test("a Y ring is NOT an artefact when the baseline never measured Y", () => {
	const r = newPeaks(NO_Y, VERIFIED);
	assert.deepEqual(r.artefacts, [], "nothing may be claimed about an axis with no baseline");
	assert.deepEqual(r.unjudged, ["Y"], "and the fact that it could not be judged must survive");
});

test("with Y measured, 54 Hz against 50 Hz is not an artefact either", () => {
	// 7.9 % apart, inside the 15 % tolerance. This is what the operator would
	// have been told if the baseline had fitted.
	const r = newPeaks(BOTH, VERIFIED);
	assert.deepEqual(r.artefacts, []);
	assert.deepEqual(r.unjudged, []);
});

test("a genuine artefact is still caught", () => {
	// The 2026-08-22 observation: a 38 Hz ring on a machine whose modes are
	// 18 and 52. Well outside tolerance of its own axis's baseline.
	const base: Fingerprint = { X: mode(18.14), Y: mode(51.68), n: { X: 6, Y: 6 }, spreadHz: { X: 0.5, Y: 1.2 } };
	const bad: Fingerprint = { X: mode(38.0, 0.25), Y: mode(52.0, 0.1), n: { X: 3, Y: 3 }, spreadHz: { X: 0, Y: 0 } };
	const r = newPeaks(base, bad);
	assert.equal(r.artefacts.length, 1);
	assert.equal(r.artefacts[0]!.axis, "X");
	assert.deepEqual(r.unjudged, []);
});

test("unjudged is advisory and artefact is disqualifying", () => {
	const cs = verifiedCaveats(
		[{ spec: null, artefacts: [], unjudged: ["Y"] }],
		() => 'M593 P"zvddd" F39 S0.05',
	);
	assert.equal(cs.length, 1);
	assert.equal(cs[0]!.kind, "verify-unjudged");
	// Advisory: it is a gap in the evidence, not a proven fault.
	assert.equal(severityOf(cs[0]!), "advisory");

	const bad = verifiedCaveats(
		[{ spec: null, artefacts: [{ axis: "X", hz: hz(38), peakG: 0.25 }], unjudged: [] }],
		() => 'M593 P"zvdd" F17.5 S0.2',
	);
	// Disqualifying: the shaper itself is the source, and no F or S tunes it
	// away.
	assert.equal(severityOf(bad[0]!), "disqualifying");
});

test("the unjudged sentence says why, and what would fix it", () => {
	const cs = verifiedCaveats([{ spec: null, artefacts: [], unjudged: ["Y"] }], () => "M593 P\"zvddd\" F39 S0.05");
	const text = caveatText(cs[0]!);
	assert.match(text, /baseline has no mode/i);
	assert.match(text, /measure again/i);
	// And it must NOT read as a clean result.
	assert.doesNotMatch(text, /no new peaks/i);
});

test("the artefact sentence says the shaper is the source", () => {
	const cs = verifiedCaveats(
		[{ spec: null, artefacts: [{ axis: "Y", hz: hz(54), peakG: 0.051 }], unjudged: [] }],
		() => 'M593 P"ei2" F51.5 S0.05',
	);
	const text = caveatText(cs[0]!);
	assert.match(text, /54/);
	assert.match(text, /0\.051/);
	// The actionable part: tuning this shaper cannot help, because its own
	// impulse spacing is the cause.
	assert.match(text, /another candidate|no tuning/i);
});
