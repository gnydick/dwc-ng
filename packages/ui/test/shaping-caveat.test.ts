/**
 * Every caveat has a sentence, and the sentence carries the numbers the
 * operator needs in order to act on it.
 *
 * Exhaustiveness is a COMPILE-time property (`caveatText` has a `never` arm and
 * no default). What this file proves is what a compiler cannot: that each
 * sentence actually mentions its own payload, so a reason cannot be answered
 * with a generic apology and still pass.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { caveatText } from "../src/shaping/copy.ts";
import { type Caveat, severityOf } from "../src/shaping/evidence/caveat.ts";
import { hz } from "../src/shaping/engine/units.ts";

const EVERY: readonly Caveat[] = [
	{ kind: "forcing-band-excludes-mode", axis: "X", modeHz: hz(38.7), bandHz: [hz(125), hz(1000)], needMmPerS: 7.74 },
	{ kind: "rows-not-analysed", analysed: 7, rows: 8 },
	{ kind: "mode-on-forcing-locus", axis: "X", modeHz: hz(125), speedMmPerS: 25 },
	{ kind: "mode-locus-unknown" },
	{ kind: "direction-spread", axis: "X", plusHz: hz(4.48), minusHz: hz(0.23), modeHz: hz(18.14) },
	{ kind: "fits-at-damping-cap", axis: "Y", refused: 7, of: 10, cyclesFit: 1.9, cap: 0.1510 },
	{ kind: "few-fits", axis: "Y", n: 3, of: 10 },
	{ kind: "predicted-not-measured", n: 12 },
	{ kind: "inherited", from: "fingerprint", caveat: { kind: "few-fits", axis: "Y", n: 3, of: 10 } },
];

test("every caveat kind has a sentence that leaks no placeholder", () => {
	const seen = new Set<string>();
	for (const c of EVERY) {
		seen.add(c.kind);
		const text = caveatText(c);
		assert.ok(text.length > 0, `${c.kind} has no copy`);
		assert.ok(!/\bundefined\b|\bNaN\b|\[object/.test(text), `${c.kind} leaked a value: ${text}`);
		assert.ok(text.length > c.kind.length, `${c.kind} is a token, not a sentence: ${text}`);
	}
	assert.equal(seen.size, EVERY.length, "EVERY must hold one of each kind, no duplicates");
});

test("the sentences carry their own numbers", () => {
	assert.match(caveatText(EVERY[0]!), /38\.7/);
	assert.match(caveatText(EVERY[0]!), /125/);
	assert.match(caveatText(EVERY[0]!), /1000/);
	// The remedy is the whole point of this one: it must name the speed that
	// WOULD have driven the mode, not merely report that nothing did.
	assert.match(caveatText(EVERY[0]!), /7\.7/);
	// Names how many are MISSING against the total, which is the number the
	// operator acts on — "7 of 8 analysed" would read as a success report.
	assert.match(caveatText(EVERY[1]!), /1 of 8/);
	assert.match(caveatText(EVERY[4]!), /4\.48/);
	assert.match(caveatText(EVERY[4]!), /0\.23/);
	// Arithmetic, not noise — the cap has to appear beside the measurement.
	assert.match(caveatText(EVERY[5]!), /1\.9/);
	assert.match(caveatText(EVERY[5]!), /0\.151/);
});

test("only the ones shaping cannot act on are disqualifying", () => {
	assert.equal(severityOf(EVERY[2]!), "disqualifying", "a mode on the forcing locus is motor ripple");
	assert.equal(severityOf(EVERY[0]!), "advisory");
	assert.equal(severityOf(EVERY[5]!), "advisory");
});

test("an inherited caveat keeps the severity of the one it wraps", () => {
	const inner: Caveat = { kind: "mode-on-forcing-locus", axis: "X", modeHz: hz(125), speedMmPerS: 25 };
	assert.equal(severityOf({ kind: "inherited", from: "fingerprint", caveat: inner }), "disqualifying");
	assert.equal(severityOf(EVERY[8]!), "advisory");
});

test("an inherited caveat names where it came from and still says the inner sentence", () => {
	const outer = EVERY[8]!;
	assert.equal(outer.kind, "inherited");
	const text = caveatText(outer);
	assert.match(text, /fingerprint/);
	assert.ok(
		text.includes(caveatText(outer.caveat)),
		"the inner sentence must survive intact, not be replaced by a pointer to it",
	);
});
