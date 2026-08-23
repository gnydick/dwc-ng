/**
 * The shaping/accelerometer G-code builders — exact emitted strings.
 *
 * Forms verified against reference/duet-gcode.md (M955, M956, M593, M400, G4,
 * G90, G1) and reference/dwc's InputShaping plugin, never from memory. The
 * RRF 3.6 custom form is the one that matters most: H is the individual
 * amplitude of each impulse EXCEPT THE LAST (the firmware sets the last to
 * 1 - sum), and T is the cumulative delay of each impulse EXCEPT THE FIRST
 * (whose delay is zero), in seconds. Getting either wrong is a silently
 * different shaper on the machine.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cmd, accelAddr } from "../src/control/commands.ts";
import { impulses, type ShaperSpec } from "../src/shaping/engine/shapers.ts";
import { hz, seconds, mm } from "../src/shaping/engine/units.ts";

const TOOLBOARD = accelAddr(20, 0);

const CUSTOM: ShaperSpec = {
	type: "custom",
	H: [0.335, 0.2641, 0.2242],
	T: [seconds(0.00972), seconds(0.0278), seconds(0.03752)],
};

test("M955 configures the accelerometer by board.device address", () => {
	assert.equal(cmd.accelConfig(TOOLBOARD), "M955 P20.0");
});

test("M956 collects samples: P then S then A then the quoted file", () => {
	assert.equal(cmd.accelCapture(TOOLBOARD, 1500, 2, "ring_Xp0.csv"), 'M956 P20.0 S1500 A2 F"ring_Xp0.csv"');
});

test("M593 named shaper: quoted type, %g frequency and damping", () => {
	assert.equal(cmd.inputShaping({ type: "ei2", F: hz(52), S: 0.075 }), 'M593 P"ei2" F52 S0.075');
});

test("M593 custom: H at 4dp, T at 5dp, colon-separated", () => {
	assert.equal(
		cmd.inputShaping(CUSTOM),
		'M593 P"custom" H0.3350:0.2641:0.2242 T0.00972:0.02780:0.03752',
	);
});

test("M593 custom lists carry exactly (n-1) entries for n impulses", () => {
	const n = impulses(CUSTOM).A.length;
	const emitted = cmd.inputShaping(CUSTOM);
	const h = /H([\d.:]+)/.exec(emitted)?.[1]?.split(":") ?? [];
	const t = /T([\d.:]+)/.exec(emitted)?.[1]?.split(":") ?? [];
	assert.equal(n, 4, "the fixture is a four-impulse shaper");
	assert.equal(h.length, n - 1, `H must omit the last impulse: ${emitted}`);
	assert.equal(t.length, n - 1, `T must omit the first impulse: ${emitted}`);
});

test("M593 off and query", () => {
	assert.equal(cmd.shapingOff(), 'M593 P"none"');
	assert.equal(cmd.queryShaping(), "M593");
});

test("motion primitives", () => {
	assert.equal(cmd.waitMoves(), "M400");
	assert.equal(cmd.dwell(500), "G4 P500");
	assert.equal(cmd.absolute(), "G90");
	assert.equal(cmd.moveTo([{ axis: "X", mm: mm(180) }, { axis: "Y", mm: mm(120) }], 12000), "G1 X180 Y120 F12000");
});

test("moveTo refuses a move with no axes and a repeated axis", () => {
	assert.throws(() => cmd.moveTo([], 12000), /axis/i);
	assert.throws(() => cmd.moveTo([{ axis: "X", mm: mm(1) }, { axis: "X", mm: mm(2) }], 600), /X/);
});

test("the mainboard's own accelerometer is the bare P0 form, as dwc emits it", () => {
	// reference/dwc RecordMotionProfileDialog.vue:273-277 maps canAddress 0 to
	// "0" and everything else to `${canAddress}.0`; the wiki says "Use P0 for an
	// accelerometer connected locally". dwc + the board win over the bb.nn form.
	assert.equal(cmd.accelConfig(accelAddr(0, 0)), "M955 P0");
	assert.equal(cmd.accelConfig(accelAddr(0, 1)), "M955 P0.1");
	assert.equal(cmd.accelConfig(accelAddr(121, 0)), "M955 P121.0");
});

test("accelAddr refuses a nonsense address", () => {
	assert.throws(() => accelAddr(1.5, 0), /board/i);
	assert.throws(() => accelAddr(-1, 0), /board/i);
	assert.throws(() => accelAddr(20, -1), /device/i);
});
