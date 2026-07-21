import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProbeReply } from "../src/heightmap/probeReply.ts";

test("reads the trigger height from a G30 reply", () => {
	assert.deepEqual(parseProbeReply("Stopped at height 2.456 mm"), { triggerHeight: 2.456 });
});

test("tolerates surrounding text and whitespace", () => {
	assert.deepEqual(
		parseProbeReply("  Stopped at height -0.042 mm\n"),
		{ triggerHeight: -0.042 },
	);
});

test("a reply that reports no trigger yields null", () => {
	// The caller must be able to tell "probe failed" from "probed 0.000".
	assert.equal(parseProbeReply("Error: Probe already triggered at start of probing move"), null);
	assert.equal(parseProbeReply(""), null);
	assert.equal(parseProbeReply("ok"), null);
});

test("zero is a real height, not a failure", () => {
	assert.deepEqual(parseProbeReply("Stopped at height 0.000 mm"), { triggerHeight: 0 });
});
