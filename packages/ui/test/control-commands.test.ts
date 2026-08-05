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

test("tool setpoints: one letter each, mode untouched", () => {
	assert.equal(cmd.toolActiveSetpoint(0, 205), "M568 P0 S205");
	assert.equal(cmd.toolStandbySetpoint(0, 140), "M568 P0 R140");
	assert.equal(cmd.toolActiveSetpoint(2, 0), "M568 P2 S0");
});

test("a setpoint commit carries NO mode and NO other setpoint", () => {
	// Each Set writes exactly the field it sits beside. RRF keeps an
	// unspecified parameter at its previous value, so S alone cannot disturb R
	// — which is what makes per-field commits safe rather than lossy.
	const activeForm = cmd.toolActiveSetpoint(1, 205);
	const standbyForm = cmd.toolStandbySetpoint(1, 140);
	assert.equal(/A\d/.test(activeForm), false, `setpoint must not carry a mode: ${activeForm}`);
	assert.equal(/A\d/.test(standbyForm), false, `setpoint must not carry a mode: ${standbyForm}`);
	assert.equal(/R-?\d/.test(activeForm), false, "the active commit must not write standby");
	assert.equal(/S-?\d/.test(standbyForm), false, "the standby commit must not write active");
});

test("tool mode: A-only, carries no temperature", () => {
	assert.equal(cmd.toolActive(0), "M568 P0 A2");
	assert.equal(cmd.toolStandby(1), "M568 P1 A1");
	assert.equal(cmd.toolOff(3), "M568 P3 A0");
	for (const form of [cmd.toolActive(0), cmd.toolStandby(0), cmd.toolOff(0)]) {
		assert.equal(/[SR]-?\d/.test(form), false, `mode command must not carry a setpoint: ${form}`);
	}
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

// Mesh bed compensation. DWC has no named-file support to copy, so these P
// forms follow reference/duet-gcode.md G29 and the risk is entirely ours.
test("mesh commands: bare forms match what DWC sends", () => {
	assert.equal(cmd.probeMesh(), "G29");
	assert.equal(cmd.clearMesh(), "G29 S2");
	// No M561 builder: this machine levels by moving leadscrews, never by a bed
	// plane fit, so there is nothing for it to clear. See commands.ts.
	assert.equal("clearBedTransform" in cmd, false);
	// No argument = no P at all, NOT P"heightmap.csv": the bare form is the one
	// verified on the board, so the default path must keep sending it.
	assert.equal(cmd.loadHeightmap(), "G29 S1");
});

test("mesh P parameter is a bare filename, never a path", () => {
	// G29's P names a file WITHIN /sys. Sending the full path could resolve
	// somewhere unintended, so callers' paths reduce to the last segment.
	assert.equal(cmd.loadHeightmap("0:/sys/pei-heightmap.csv"), 'G29 S1 P"pei-heightmap.csv"');
	assert.equal(cmd.saveHeightmapAs("0:/sys/backup.csv"), 'G29 S3 P"backup.csv"');
	// Already-bare names pass through unchanged.
	assert.equal(cmd.saveHeightmapAs("plain.csv"), 'G29 S3 P"plain.csv"');
});

test("mesh filenames are quoted — real height maps have spaces in them", () => {
	// Gabe's machine carries "Textured pei heightmap.csv" and friends; unquoted
	// these would split into extra G-code parameters.
	assert.equal(
		cmd.loadHeightmap("0:/sys/Textured pei heightmap.csv"),
		'G29 S1 P"Textured pei heightmap.csv"',
	);
	// And the same doubling-escape as every other quoted parameter.
	assert.equal(cmd.saveHeightmapAs('odd"name.csv'), 'G29 S3 P"odd""name.csv"');
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

// Doubling escapes " and ', which is the whole of RRF's quoting rule — and it
// cannot escape a NEWLINE, because a newline ends the G-code line rather than
// sitting inside the string. So a control character in a quoted parameter is
// not a value to escape, it is a value that must not reach a command.
//
// Reachable today only through messagebox/ack.ts: MessageBoxPrompt seeds its
// input signal straight from box.default (the board's M291 F"..." string), so
// an unedited answer bypasses the DOM's own newline stripping. RRF cannot put
// a newline in that field, but that is RRF's guarantee, not this repo's.
test("gcodeQuote refuses a control character rather than escaping it", () => {
	assert.throws(() => gcodeQuote("ok\nM112"), /control character/);
	assert.throws(() => gcodeQuote("a\rb"), /control character/);
	assert.throws(() => gcodeQuote("a\u0000b"), /control character/);
	// A space is 0x20 and ordinary — height-map names carry them routinely.
	assert.equal(gcodeQuote("Textured pei.csv"), '"Textured pei.csv"');
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

// A filename carrying a quote closes the parameter early and the rest is parsed
// as further G-code. runMacro escaped it correctly; print, simulate and
// loadFilament hand-wrote their own `"${x}"` and did NOT — found 2026-08-01 by
// the compiler, when command assembly was moved behind a tagged template that
// accepts only proven-safe pieces. RRF escapes an embedded quote by DOUBLING.
const NASTY = '0:/gcodes/a"b.gcode';

test("print quotes its path through gcodeQuote", () => {
	assert.equal(cmd.print(NASTY), 'M32 "0:/gcodes/a""b.gcode"');
});

test("simulate quotes its path through gcodeQuote", () => {
	assert.equal(cmd.simulate(NASTY), 'M37 P"0:/gcodes/a""b.gcode"');
});

test("loadFilament quotes the filament name", () => {
	assert.equal(cmd.loadFilament('a"b'), 'M701 S"a""b"\nM703');
});

test("an axis letter keeps its CASE — AxisLetter has A and a as separate axes", () => {
	assert.equal(cmd.homeAxis("a"), "G28 a");
	assert.equal(cmd.homeAxis("X"), "G28 X");
});

test("anything that is not one letter is refused, not spliced into a command", () => {
	assert.throws(() => cmd.homeAxis(""), /not an axis letter/);
	assert.throws(() => cmd.releaseAxis("X Y"), /not an axis letter/);
	assert.throws(() => cmd.homeAxis('X\nM112'), /not an axis letter/);
});
