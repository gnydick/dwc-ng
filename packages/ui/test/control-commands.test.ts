import { test } from "node:test";
import assert from "node:assert/strict";
import { cmd } from "../src/control/commands.ts";

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
