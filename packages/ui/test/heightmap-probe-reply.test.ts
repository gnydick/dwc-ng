import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProbeReply, heightmapValue } from "../src/heightmap/probeReply.ts";

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
	assert.equal(heightmapValue(3.0, 2.5), 0.5);
	assert.equal(heightmapValue(2.0, 2.5), -0.5);
	// Negative trigger height (the toolchanger, triggerHeight -13): same rule.
	assert.equal(heightmapValue(-13.5, -13), -0.5); // descended further -> low -> negative
	assert.ok(Math.abs(heightmapValue(-12.999, -13) - 0.001) < 1e-9); // the real probe: high
	// On-reference reads exactly zero whatever the trigger height.
	assert.equal(heightmapValue(-13, -13), 0);
	assert.equal(heightmapValue(2.5, 2.5), 0);
});
