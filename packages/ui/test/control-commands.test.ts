import { test } from "node:test";
import assert from "node:assert/strict";
import { cmd, gcodeQuote } from "../src/control/commands.ts";

/**
 * The command builders are the whole 1:1-with-G-code contract in one place:
 * each control's behavior IS the string it produces. Exact strings verified
 * against the vendored DWC (reference/dwc) — never invented from memory.
 */

test("homing", () => {
	assert.equal(cmd.homeAll(), "G28");
	assert.equal(cmd.homeAxis("C"), "G28 C");
});

test("tool selection", () => {
	assert.equal(cmd.selectTool(2), "T2");
	assert.equal(cmd.deselectTool(), "T-1");
});

test("tool heater: convenience compound sets temp AND state in one M568", () => {
	assert.equal(cmd.toolActive(0, 210), "M568 P0 S210 A2");
	assert.equal(cmd.toolStandby(1, 160), "M568 P1 R160 A1");
	assert.equal(cmd.toolOff(3), "M568 P3 A0");
});

test("bed heater: on sets temp, off uses the sub-absolute-zero sentinel", () => {
	assert.equal(cmd.bedActive(0, 60), "M140 P0 S60");
	assert.equal(cmd.bedOff(0), "M140 P0 S-273.15");
});

test("jog is DWC's push/relative-move/pop bundle — plain G1, no H flag", () => {
	assert.equal(cmd.jog("X", 10, 6000), "M120\nG91\nG1 X10 F6000\nM121");
	assert.equal(cmd.jog("Y", -0.1, 1200), "M120\nG91\nG1 Y-0.1 F1200\nM121");
});

test("extrude bundle sets relative extrusion", () => {
	assert.equal(cmd.extrude(5, 300), "M83\nG1 E5 F300");
	assert.equal(cmd.extrude(-2, 300), "M83\nG1 E-2 F300");
});

test("fan speed is 0..1 from a percentage", () => {
	assert.equal(cmd.fan(2, 100), "M106 P2 S1.00");
	assert.equal(cmd.fan(0, 50), "M106 P0 S0.50");
});

test("tuning factors and babystep", () => {
	assert.equal(cmd.speedFactor(120), "M220 S120");
	assert.equal(cmd.flowFactor(95), "M221 S95");
	assert.equal(cmd.babystep(0.05), "M290 R1 Z0.05");
	assert.equal(cmd.babystep(-0.05), "M290 R1 Z-0.05");
});

test("coupler lock/unlock run the real macros", () => {
	assert.equal(cmd.couplerLock(), 'M98 P"/macros/tool_lock"');
	assert.equal(cmd.couplerUnlock(), 'M98 P"/macros/tool_unlock"');
});

// M562 P<heater> clears a heater fault. The parameter is the HEATER INDEX, not
// a tool number — on a toolchanger those differ, and resetting the wrong one
// leaves a genuinely faulted heater armed while clearing a healthy one.
test("reset heater fault", () => {
	assert.equal(cmd.resetHeaterFault(0), "M562 P0");
	assert.equal(cmd.resetHeaterFault(3), "M562 P3");
});

// M84 releases the steppers. Bare M84 releases every motor; with axis letters
// it releases only those, which is what a toolchanger wants when freeing one
// carriage without dropping the gantry.
test("release motors", () => {
	assert.equal(cmd.releaseAllMotors(), "M84");
	assert.equal(cmd.releaseAxis("U"), "M84 U");
	assert.equal(cmd.releaseAxis("X"), "M84 X");
});

// ATX power. M80 on / M81 off, verified against reference/dwc
// ATXPanel.vue:51 rather than from memory.
test("ATX power", () => {
	assert.equal(cmd.atxPower(true), "M80");
	assert.equal(cmd.atxPower(false), "M81");
});

// M37 P"<file>" starts a simulation of that file (reference/dwc
// JobFileList.vue:353). The path is quoted exactly like M32's.
test("simulate a job file", () => {
	assert.equal(cmd.simulate("0:/gcodes/benchy.gcode"), 'M37 P"0:/gcodes/benchy.gcode"');
});

test("print (start / reprint) a job file", () => {
	assert.equal(cmd.print("0:/gcodes/benchy.gcode"), 'M32 "0:/gcodes/benchy.gcode"');
});

test("firmware update: bare M997 for the main board, B<canAddress> for expansion", () => {
	assert.equal(cmd.updateFirmware(0), "M997"); // main board (CAN 0)
	assert.equal(cmd.updateFirmware(1), "M997 B1"); // EXP3HC
	assert.equal(cmd.updateFirmware(23), "M997 B23"); // a TOOL1LC
});

// RRF's T-command P parameter is a BITMASK over the tool-change macros
// (1 tfree | 2 tpre | 4 tpost), verified against reference/dwc
// store/machine/settings.ts:309 — not a tool number, and not a boolean.
// P0 suppresses all three, which is how you move a toolchanger whose change
// macro would otherwise drive a broken axis.
test("tool select/deselect carry the macro bitmask when asked", () => {
	assert.equal(cmd.selectTool(2), "T2");
	assert.equal(cmd.deselectTool(), "T-1");
	assert.equal(cmd.selectTool(2, 0), "T2 P0");
	assert.equal(cmd.deselectTool(0), "T-1 P0");
	assert.equal(cmd.deselectTool(7), "T-1 P7");
	// 0 must not be treated as absent — that is the whole point of the feature.
	assert.notEqual(cmd.deselectTool(0), cmd.deselectTool());
});

// Filament load/unload. Forms verified against reference/dwc
// FilamentDialog.vue:94-103 — NOT from memory.
//
// M701/M702 act on the CURRENTLY SELECTED tool, so the tool is selected first
// when it isn't already current. P0 suppresses the filament's load/unload
// macros the same way it does for a tool change. M703 applies the newly loaded
// filament's own config and is part of the load, not a separate action.
test("unload filament", () => {
	assert.equal(cmd.unloadFilament(), "M702");
	assert.equal(cmd.unloadFilament({ runMacros: false }), "M702 P0");
	assert.equal(cmd.unloadFilament({ selectTool: 2 }), "T2\nM702");
	assert.equal(cmd.unloadFilament({ selectTool: 0, runMacros: false }), "T0\nM702 P0");
});

test("load filament", () => {
	assert.equal(cmd.loadFilament("PLA"), 'M701 S"PLA"\nM703');
	assert.equal(cmd.loadFilament("PETG", { runMacros: false }), 'M701 P0 S"PETG"\nM703');
	assert.equal(cmd.loadFilament("PLA", { selectTool: 3 }), 'T3\nM701 S"PLA"\nM703');
});

test("a filament name is quoted, so spaces in it survive", () => {
	// "Prusament PLA Galaxy Black" is a perfectly ordinary directory name.
	assert.equal(cmd.loadFilament("Prusament PLA"), 'M701 S"Prusament PLA"\nM703');
});

test("selecting tool 0 is not mistaken for 'no tool'", () => {
	// A falsy check on the tool number would drop the T0 line entirely and send
	// the load to whatever tool happened to be selected.
	assert.match(cmd.loadFilament("PLA", { selectTool: 0 }), /^T0\n/);
});

// M486 per-object cancel. Forms verified against reference/dwc
// GCodeViewer.vue:915 — P cancels, U un-cancels, both by object INDEX.
//
// Indexed explicitly rather than using M486 C ("cancel the current object"),
// because the object you clicked is not necessarily the one being printed when
// the command arrives.
test("cancel and resume a build object", () => {
	assert.equal(cmd.cancelObject(0), "M486 P0");
	assert.equal(cmd.cancelObject(7), "M486 P7");
	assert.equal(cmd.resumeObject(0), "M486 U0");
	assert.equal(cmd.resumeObject(7), "M486 U7");
});

test("object 0 is a real object, not an absent one", () => {
	// A falsy check on the index would silently address the wrong object.
	assert.notEqual(cmd.cancelObject(0), cmd.cancelObject(1));
	assert.match(cmd.cancelObject(0), /0$/);
});

// Job control + macros (audit M3: these were raw literals in components).
// Forms verified against reference/duet-gcode.md (M24/M25/M0, M98, G29).
test("job control forms", () => {
	assert.equal(cmd.resumePrint(), "M24");
	assert.equal(cmd.pausePrint(), "M25");
	assert.equal(cmd.cancelPrint(), "M0");
	assert.equal(cmd.loadHeightmap(), "G29 S1");
});

test("runMacro quotes the path; embedded quotes escape by doubling", () => {
	assert.equal(cmd.runMacro("/macros/park.g"), 'M98 P"/macros/park.g"');
	// The bug class the quoting kills: a filename carrying a quote used to
	// interpolate raw and malform the command.
	assert.equal(cmd.runMacro('odd"name.g'), 'M98 P"odd""name.g"');
	assert.equal(cmd.runMacro("it's.g"), "M98 P\"it''s.g\"");
});

test("gcodeQuote is the one quoting authority (ack.ts imports it)", () => {
	assert.equal(gcodeQuote('say "hi"'), '"say ""hi"""');
	assert.equal(gcodeQuote("a'b"), "\"a''b\"");
});

test("the coupler macros derive from runMacro (no second M98 form)", () => {
	assert.equal(cmd.couplerLock(), cmd.runMacro("/macros/tool_lock"));
	assert.equal(cmd.couplerUnlock(), cmd.runMacro("/macros/tool_unlock"));
});

// Babystep zero (reference/duet-gcode.md M290: "M290 R0 S0 ; clear babystepping").
test("babystepZero clears the accumulated offset with the reference's exact form", () => {
	assert.equal(cmd.babystepZero(), "M290 R0 S0");
	assert.equal(cmd.babystep(0.02), "M290 R1 Z0.02", "the relative step form is unchanged");
	assert.equal(cmd.babystep(-0.02), "M290 R1 Z-0.02");
});
