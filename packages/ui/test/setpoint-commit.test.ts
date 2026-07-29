import { test } from "node:test";
import assert from "node:assert/strict";
import { commitPhase, clickSendsSetpoint, atTarget, AT_TARGET_C } from "../src/control/setpointCommit.ts";
import { readFileSync } from "node:fs";
import { cmd } from "../src/control/commands.ts";

test("an edited field is pending — the click will write the setpoint", () => {
	assert.equal(commitPhase(205, 190, false), "pending");
	assert.equal(commitPhase(205, 190, true), "pending", "pending outranks being the current mode");
	assert.equal(clickSendsSetpoint(commitPhase(205, 190, false)), true);
});

test("a matching field is applied — the click will set the mode", () => {
	assert.equal(commitPhase(205, 205, false), "applied");
	assert.equal(clickSendsSetpoint(commitPhase(205, 205, false)), false);
});

test("matching AND already the current mode is `current` — nothing to do", () => {
	assert.equal(commitPhase(205, 205, true), "current");
	assert.equal(clickSendsSetpoint(commitPhase(205, 205, true)), false);
});

test("zero is a real setpoint, not an empty field", () => {
	assert.equal(commitPhase(0, 0, false), "applied");
	assert.equal(commitPhase(0, 60, false), "pending");
});

test("an emptied field is pending, never sendable as NaN", () => {
	// <input type=number> yields NaN from Number(""), and NaN !== NaN would
	// read as pending anyway — this pins it so a refactor cannot make an
	// empty box look 'applied' and send `S NaN`.
	assert.equal(commitPhase(Number.NaN, 205, false), "pending");
	assert.equal(commitPhase(Number.POSITIVE_INFINITY, 205, false), "pending");
});

/**
 * The whole point of comparing against the MACHINE's reported value rather
 * than a local "have I typed" flag: another client or a macro moving the
 * setpoint must clear pending by itself.
 */
test("the machine catching up to the field clears pending without a keystroke", () => {
	const typed = 205;
	assert.equal(commitPhase(typed, 190, false), "pending");
	// …poll arrives, machine now reports 205 …
	assert.equal(commitPhase(typed, 205, false), "applied");
});

test("the machine moving AWAY from the field re-arms pending", () => {
	assert.equal(commitPhase(205, 205, false), "applied");
	assert.equal(commitPhase(205, 240, false), "pending", "a macro changed it — there is something to send again");
});

/**
 * The two clicks, end to end. This is the contract the button multiplexes on,
 * so it is asserted against the real command builders rather than described.
 */
test("two clicks: setpoint first, then mode", () => {
	const tool = 0;
	const field = 205;
	let reported = 190;

	const first = clickSendsSetpoint(commitPhase(field, reported, false));
	assert.equal(first, true);
	assert.equal(cmd.toolActiveSetpoint(tool, field), "M568 P0 S205");

	// The machine acknowledges the setpoint.
	reported = 205;
	const second = clickSendsSetpoint(commitPhase(field, reported, false));
	assert.equal(second, false);
	assert.equal(cmd.toolActive(tool), "M568 P0 A2");
});

test("an unedited field goes straight to the mode on one click", () => {
	assert.equal(clickSendsSetpoint(commitPhase(205, 205, false)), false);
	assert.equal(cmd.toolActive(1), "M568 P1 A2");
});

test("arrival is symmetric and inclusive at the threshold", () => {
	assert.equal(atTarget(205, 205), true);
	assert.equal(atTarget(205 - AT_TARGET_C, 205), true, "cooling side");
	assert.equal(atTarget(205 + AT_TARGET_C, 205), true, "overshoot side");
	assert.equal(atTarget(205 - AT_TARGET_C - 0.1, 205), false);
	assert.equal(atTarget(205 + AT_TARGET_C + 0.1, 205), false);
});

test("a heater climbing to its setpoint has NOT arrived", () => {
	assert.equal(atTarget(24, 205), false);
	assert.equal(atTarget(180, 205), false);
});

/** Off has nothing to reach, so its key must not sit forever un-brightened. */
test("a null target counts as arrived; an unknown reading does not", () => {
	assert.equal(atTarget(24, null), true);
	assert.equal(atTarget(Number.NaN, 205), false, "a heater the model lacks must not claim arrival");
	assert.equal(atTarget(205, Number.NaN), false);
});

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");

/**
 * `at-target` has to be applied through classList, NOT through the `class`
 * prop. Both write the same attribute, and a reactive `class` re-assignment
 * overwrites the whole string — which silently unset is-engaged every time a
 * heater arrived, so the key went bright and stopped showing it was the
 * current mode at the same instant. This pins the prop→classList→stylesheet
 * chain that makes the three-level scheme work.
 */
test("at-target travels by classList and the stylesheet reads it", () => {
	const btn = read("../src/control/GcodeButton.tsx");
	assert.match(btn, /classList=\{\{[\s\S]*?"at-target": props\.atTarget === true/,
		"at-target must be a classList entry, not part of the class string");

	const css = read("../src/app.css");
	assert.ok(css.includes(".mode-key.is-engaged:not(.at-target)"),
		"the mid state (engaged, not yet arrived) must still have a rule");
});

/** A computed `class` on a GcodeButton is the exact shape of that bug. */
test("no card hands GcodeButton a reactive class", () => {
	for (const file of ["../src/cards/ControlCards.tsx", "../src/cards/ToolsHeatersCard.tsx"]) {
		// Only GcodeButton usages: a computed class on a plain <span> is fine —
		// nothing else is writing that element's class attribute.
		for (const [usage] of read(file).matchAll(/<GcodeButton[\s\S]*?\/>/g)) {
			const dynamic = /\sclass=\{/.exec(usage);
			assert.equal(dynamic, null,
				`${file}: a GcodeButton takes a computed class — put the varying part in its own prop:\n${usage.slice(0, 200)}`);
		}
	}
});
