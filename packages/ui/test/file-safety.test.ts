import { test } from "node:test";
import assert from "node:assert/strict";
import { protectedReason, PROTECTED_BASENAMES } from "../src/files/safety.ts";

/**
 * These are data-loss guards, not machine-logic verdicts: they say nothing
 * about what the machine may do, only that some deletions are unrecoverable
 * enough to deserve a deliberate act. The firmware remains the authority on
 * behaviour.
 */

test("config.g is protected — losing it leaves an unconfigured machine", () => {
	assert.ok(protectedReason("0:/sys/config.g") !== null);
});

test("the UI's own config is protected", () => {
	assert.ok(protectedReason("0:/sys/dwc-ng-config.json") !== null);
});

test("protection is by exact basename, case-insensitively", () => {
	// RRF's filesystem is case-insensitive, so CONFIG.G is the same file.
	assert.ok(protectedReason("0:/sys/CONFIG.G") !== null);
	assert.ok(protectedReason("0:/sys/Config.g") !== null);
});

test("a file that merely contains a protected name is not protected", () => {
	assert.equal(protectedReason("0:/sys/config.g.bak"), null);
	assert.equal(protectedReason("0:/sys/old-config.g"), null);
	assert.equal(protectedReason("0:/gcodes/config.gcode"), null);
});

test("ordinary job and macro files are not protected", () => {
	assert.equal(protectedReason("0:/gcodes/benchy.gcode"), null);
	assert.equal(protectedReason("0:/macros/preheat-pla.g"), null);
});

test("every protected basename gives a reason a human can act on", () => {
	for (const name of Object.keys(PROTECTED_BASENAMES)) {
		const reason = protectedReason(`0:/sys/${name}`);
		assert.ok(reason !== null, `${name} should be protected`);
		assert.ok(reason.length > 10, `${name}'s reason should explain the consequence`);
	}
});
