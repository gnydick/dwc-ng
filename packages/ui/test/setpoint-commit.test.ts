import { test } from "node:test";
import assert from "node:assert/strict";
import {
	commitPhase, clickSendsSetpoint, staysArmed, thermalMark, NEAR_BELOW_C, OVER_ABOVE_C,
} from "../src/control/setpointCommit.ts";
import { cmd } from "../src/control/commands.ts";
import { readFileSync } from "node:fs";

// --- what a press sends ------------------------------------------------------
//
// The safety property: NO single press can switch a heater on. The first press
// on a mode key always writes the setpoint, whatever the field says.

test("an unarmed key writes the setpoint — always, even when nothing changed", () => {
	assert.equal(clickSendsSetpoint(false), true);
});

test("an armed key switches the profile", () => {
	assert.equal(clickSendsSetpoint(true), false);
});

/**
 * The regression this whole model exists for: a heater sitting at 200° with a
 * matching field used to activate on ONE press, because the field matching was
 * treated as "nothing to write, so act". A stray click switched a hot end on.
 */
test("a field that already matches the machine does NOT shortcut to activation", () => {
	const field = 205, reported = 205;
	assert.equal(commitPhase(field, reported, false), "applied", "nothing to write…");
	assert.equal(clickSendsSetpoint(false), true, "…but the press still writes, not activates");
});

test("two presses, end to end: setpoint then profile", () => {
	let armed = false;
	assert.equal(cmd.toolActiveSetpoint(0, 205), "M568 P0 S205");
	assert.equal(clickSendsSetpoint(armed), true);

	armed = true; // press 1 landed
	assert.equal(clickSendsSetpoint(armed), false);
	assert.equal(cmd.toolActive(0), "M568 P0 A2");
});

// --- how long the arming lasts ----------------------------------------------

test("arming survives while the value stands and the mode is not current", () => {
	assert.equal(staysArmed("applied", false), true);
});

test("arming drops once the machine is IN the mode — nothing left to switch to", () => {
	assert.equal(staysArmed("current", true), false);
	assert.equal(staysArmed("applied", true), false);
});

test("arming drops when the field is edited again — the new value must be written first", () => {
	assert.equal(staysArmed("pending", false), false);
});

// --- the pending dot ---------------------------------------------------------

test("an edited field is pending", () => {
	assert.equal(commitPhase(205, 190, false), "pending");
	assert.equal(commitPhase(205, 190, true), "pending", "pending outranks being the current mode");
});

test("a matching field is applied, or current when it is already the mode", () => {
	assert.equal(commitPhase(205, 205, false), "applied");
	assert.equal(commitPhase(205, 205, true), "current");
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
	assert.equal(commitPhase(typed, 205, false), "applied");
});

test("the machine moving AWAY from the field re-arms pending", () => {
	assert.equal(commitPhase(205, 205, false), "applied");
	assert.equal(commitPhase(205, 240, false), "pending", "a macro changed it — there is something to write again");
});

// --- where the reading sits -------------------------------------------------

test("a heater still climbing is far — solid, but no glow yet", () => {
	assert.equal(thermalMark(24, 205), "far");
	assert.equal(thermalMark(205 - NEAR_BELOW_C - 0.1, 205), "far");
});

test("the approach window is generous: NEAR_BELOW_C under counts as near", () => {
	assert.equal(thermalMark(205 - NEAR_BELOW_C, 205), "near", "inclusive at the edge");
	assert.equal(thermalMark(205, 205), "near");
});

/** Asymmetric on purpose: approaching is expected, overshooting is worth a look. */
test("overshoot is tight, and only past OVER_ABOVE_C", () => {
	assert.equal(thermalMark(205 + OVER_ABOVE_C, 205), "near", "exactly at the margin is not yet over");
	assert.equal(thermalMark(205 + OVER_ABOVE_C + 0.1, 205), "over");
	assert.ok(OVER_ABOVE_C < NEAR_BELOW_C, "running hot must be flagged sooner than running cool");
});

/**
 * A standby of 0 means "no heat", not "0 °C". A heater cannot cool below the
 * room, so comparing the reading against zero left a tool parked in standby
 * stuck on the not-there-yet rung for as long as it was on — and would have
 * called a cooling hot end an overshoot the whole way down.
 */
test("a non-positive setpoint asks for no heat: never far, never over", () => {
	assert.equal(thermalMark(22.5, 0), "near", "at room temperature with a 0 standby IS arrived");
	assert.equal(thermalMark(180, 0), "near", "still cooling, but nothing more is being asked of it");
	assert.equal(thermalMark(22.5, -273.15), "near", "RRF unset sentinel is not a target either");
});

/** Off has nothing to reach, so its key must not sit forever un-glowed. */
test("a null target is near; an unknown reading is far, never over", () => {
	assert.equal(thermalMark(24, null), "near");
	assert.equal(thermalMark(Number.NaN, 205), "far", "a heater the model lacks must not claim anything");
	assert.equal(thermalMark(205, Number.NaN), "far");
});

// --- the display the multiplexing depends on ---------------------------------

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");

/**
 * `at-target` has to be applied through classList, NOT through the `class`
 * prop. Both write the same attribute, and a reactive `class` re-assignment
 * overwrites the whole string — which silently unset is-engaged every time a
 * heater arrived, so the key went bright and stopped showing it was the
 * current mode at the same instant.
 */
test("at-target travels by classList and the stylesheet reads it", () => {
	const btn = read("../src/control/GcodeButton.tsx");
	assert.match(btn, /classList=\{\{[\s\S]*?"at-target": props\.atTarget === true/,
		"at-target must be a classList entry, not part of the class string");

	const css = read("../src/app.css");
	assert.ok(css.includes(".mode-key.is-engaged.at-target"),
		"arrival must add something on top of the confirmed (solid) state");
});

/**
 * Two presses are only safe while the key SHOWS which one it is on. Every rung
 * of that ladder needs a rule, or the operator is guessing.
 */
test("every state of the mode key is drawn", () => {
	const css = read("../src/app.css");
	for (const selector of [
		".mode-key.is-applied:not(.is-engaged)",   // armed: next press activates
		".gcode-btn.is-pending",                   // an unwritten edit
		".gcode-btn.is-engaged",                   // confirmed: solid
		".mode-key.is-engaged.at-target",          // …and the reading arrived
		".is-sent.ack-mode .gcode-ack",            // the press that switched mode
	]) {
		assert.ok(css.includes(selector), `${selector} has no rule — that rung is invisible`);
	}
});

/** A computed `class` on a GcodeButton is the exact shape of that bug. */
test("no card hands GcodeButton a reactive class", () => {
	for (const file of ["../src/cards/ControlCards.tsx", "../src/cards/ToolsHeatersCard.tsx"]) {
		// Only GcodeButton usages: a computed class on a plain <span> is fine —
		// nothing else is writing that element's class attribute.
		for (const [usage] of read(file).matchAll(/<GcodeButton[\s\S]*?\/>/g)) {
			assert.equal(/\sclass=\{/.exec(usage), null,
				`${file}: a GcodeButton takes a computed class — put the varying part in its own prop:\n${usage.slice(0, 200)}`);
		}
	}
});
