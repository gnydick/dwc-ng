import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProbeReply, heightmapValue , type StopHeight, type MapValue } from "../src/heightmap/probeReply.ts";
/** A stop height as the machine would have reported it. The brand exists to
 *  stop a raw number reaching the MAP; authoring one here is the test's job. */
const stopAt = (mm: number) => mm as StopHeight;


test("reads the stop height from a G30 reply", () => {
	assert.deepEqual(parseProbeReply("Stopped at height 2.456 mm"), { stopHeight: 2.456 });
});

test("tolerates surrounding text and whitespace", () => {
	assert.deepEqual(
		parseProbeReply("  Stopped at height -0.042 mm\n"),
		{ stopHeight: -0.042 },
	);
});

test("a reply that reports no trigger yields null", () => {
	// The caller must be able to tell "probe failed" from "probed 0.000".
	assert.equal(parseProbeReply("Error: Probe already triggered at start of probing move"), null);
	assert.equal(parseProbeReply(""), null);
	assert.equal(parseProbeReply("ok"), null);
});

test("zero is a real height, not a failure", () => {
	assert.deepEqual(parseProbeReply("Stopped at height 0.000 mm"), { stopHeight: 0 });
});

test("heightmapValue: stop minus trigger; a high spot reads positive for either trigger sign", () => {
	// Positive trigger height (a conventional probe): a spot 0.5 high stops higher.
	assert.equal(heightmapValue(stopAt(3.0), 2.5), 0.5);
	assert.equal(heightmapValue(stopAt(2.0), 2.5), -0.5);
	// Negative trigger height (the toolchanger, triggerHeight -13): same rule.
	assert.equal(heightmapValue(stopAt(-13.5), -13), -0.5); // descended further -> low -> negative
	assert.ok(Math.abs(heightmapValue(stopAt(-12.999), -13) - 0.001) < 1e-9); // the real probe: high
	// On-reference reads exactly zero whatever the trigger height.
	assert.equal(heightmapValue(stopAt(-13), -13), 0);
	assert.equal(heightmapValue(stopAt(2.5), 2.5), 0);
});

// The whole point of the pair of brands: the two quantities are both mm, both
// numbers, and were set on adjacent lines. Storing the raw one put a ~13mm
// error into every re-probed cell. The assertions below are COMPILE-time — each
// expect-error directive is itself the test, and the build fails if the brand
// stops rejecting. (This comment deliberately does not open a line with the
// directive's name: tsc reads that as a directive wherever it appears, which is
// exactly the trap this repo's own @invariant scanner had to be taught about.)
test("a raw stop height cannot be stored as a map value", () => {
	const raw = stopAt(-12.999);
	const derived = heightmapValue(raw, -13);
	// @ts-expect-error a StopHeight is not a MapValue — this is the actual bug
	const wrong: MapValue = raw;
	void wrong;
	// @ts-expect-error and a plain number is neither
	const alsoWrong: MapValue = -12.999;
	void alsoWrong;
	// The derived value is fine, and still reads as a number for display.
	assert.ok(Math.abs(derived - 0.001) < 1e-9);
	assert.equal(typeof derived, "number");
});
