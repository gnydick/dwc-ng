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
import { cmd, accelAddr, parseAccelAddr } from "../src/control/commands.ts";
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

test("M956 collects samples: P then S then A then the quoted file, and the move behind it", () => {
	assert.equal(
		cmd.captureMove(TOOLBOARD, 1500, 2, "ring_Xp0.csv", [{ axis: "X", mm: mm(160) }, { axis: "Y", mm: mm(100) }], 12000),
		'M956 P20.0 S1500 A2 F"ring_Xp0.csv"\nG1 X160 Y100 F12000',
	);
});

// #43. The arm is not a command this module can produce on its own: there is
// no builder that emits an M956 and stops, so the only M956 the app can send
// is one with the move that consumes it on the line below. RRF documents no
// way to cancel a pending capture (reference/duet-gcode.md, M956), so an arm
// that lost its move would sit on the board and record whatever the operator
// did next — and the way to not have that state is to have no request boundary
// where the second half can be refused.
test("no builder can emit an M956 without the move that consumes it", () => {
	const emitted = Object.entries(cmd)
		.filter(([, build]) => typeof build === "function")
		.map(([name, build]) => {
			try {
				// Every builder's own arguments are wrong for every other builder,
				// so most of these throw; the ones that do not are what is checked.
				return [name, String((build as (...a: unknown[]) => string)(TOOLBOARD, 1500, 2, "ring_Xp0.csv", [{ axis: "X", mm: mm(160) }], 12000))] as const;
			} catch {
				return [name, ""] as const;
			}
		});
	for (const [name, text] of emitted) {
		if (!/\bM956\b/.test(text)) continue;
		assert.match(text, /^M956 [^\n]*\nG1 /, `${name} emitted a bare arm: ${JSON.stringify(text)}`);
	}
	assert.ok(emitted.some(([, text]) => /\bM956\b/.test(text)), "no builder emitted an M956 at all — the check would pass vacuously");
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

/**
 * The config overlay stores an accelerometer as a plain string, so something
 * has to turn it back into an address the builders accept. That parse is the
 * only other way to obtain the brand, which makes its red cases worth as much
 * as accelAddr's own: a config a person hand-edited on the SD card must not be
 * able to aim a capture at a board nobody chose.
 */
test("parseAccelAddr round-trips a stored address through the sole constructor", () => {
	assert.equal(parseAccelAddr("20.0"), accelAddr(20, 0));
	assert.equal(parseAccelAddr("20.1"), accelAddr(20, 1));
	// The mainboard's bare spelling comes out of accelAddr, not out of the input.
	assert.equal(parseAccelAddr("0.0"), "0");
	assert.equal(parseAccelAddr("0.1"), "0.1");
});

test("parseAccelAddr refuses anything that is not board.device", () => {
	for (const bad of ["", "20", "20.", ".0", "20.0.1", "a.0", "20.b", " 20.0", "20.0 ", "-1.0", "20.-1", "1e2.0"]) {
		assert.equal(parseAccelAddr(bad), null, `parseAccelAddr(${JSON.stringify(bad)}) should be null`);
	}
	// Padding is not a different address: the digits are parsed as numbers and
	// the address is re-derived from them, so this is the same toolboard.
	assert.equal(parseAccelAddr("020.0000"), accelAddr(20, 0));
});

test("parseAccelAddr refuses an address outside the CAN range rather than throwing", () => {
	// accelAddr throws for these; the parse boundary's whole job is to have a
	// null answer instead, because its input is untrusted config.
	assert.equal(parseAccelAddr("127.0"), null);
	assert.equal(parseAccelAddr("999.0"), null);
});

test("accelAddr refuses a nonsense address", () => {
	assert.throws(() => accelAddr(1.5, 0), /board/i);
	assert.throws(() => accelAddr(-1, 0), /board/i);
	assert.throws(() => accelAddr(20, -1), /device/i);
});
