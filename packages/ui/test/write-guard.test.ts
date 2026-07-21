import { test } from "node:test";
import assert from "node:assert/strict";
import { guardWrites, isEmergencyStop, RealWriteBlockedError } from "../src/dev/writeGuard.ts";
import type { Connector } from "../src/connector/types.ts";

/** Records what actually reached the "board". */
function fakeConnector() {
	const seen: string[] = [];
	const inner = {
		status: "connected",
		connect: async () => { seen.push("connect"); },
		disconnect: async () => { seen.push("disconnect"); },
		sendCode: async (code: string) => { seen.push(`sendCode:${code}`); return "ok"; },
		upload: async (path: string) => { seen.push(`upload:${path}`); },
		download: async (path: string) => { seen.push(`download:${path}`); return "text"; },
		list: async (dir: string) => { seen.push(`list:${dir}`); return []; },
		getFileInfo: async (path: string) => { seen.push(`fileInfo:${path}`); return {} as never; },
		getThumbnail: async (path: string) => { seen.push(`thumb:${path}`); return new Uint8Array(); },
		mkdir: async (path: string) => { seen.push(`mkdir:${path}`); },
		move: async (from: string, to: string) => { seen.push(`move:${from}->${to}`); },
		remove: async (path: string) => { seen.push(`remove:${path}`); },
	} as unknown as Connector;
	return { inner, seen };
}

const guard = (opts: { real: boolean; armed: boolean }) => {
	const { inner, seen } = fakeConnector();
	return { c: guardWrites(inner, { isReal: () => opts.real, isArmed: () => opts.armed }), seen };
};

test("mock backend: writes pass straight through", async () => {
	const { c, seen } = guard({ real: false, armed: false });
	await c.sendCode("G28");
	await c.upload("0:/sys/config.g", "M83");
	assert.deepEqual(seen, ["sendCode:G28", "upload:0:/sys/config.g"]);
});

test("real + unarmed: sendCode is blocked and never reaches the board", async () => {
	const { c, seen } = guard({ real: true, armed: false });
	await assert.rejects(() => c.sendCode('M32 "benchy.gcode"'), RealWriteBlockedError);
	assert.deepEqual(seen, [], "nothing reached the board");
});

test("real + unarmed: upload is blocked", async () => {
	const { c, seen } = guard({ real: true, armed: false });
	await assert.rejects(() => c.upload("0:/sys/dwc-ng-config.json", "{}"), RealWriteBlockedError);
	assert.deepEqual(seen, []);
});

test("real + unarmed: reads still work — the guard only stops mutations", async () => {
	const { c, seen } = guard({ real: true, armed: false });
	await c.download("0:/sys/config.g");
	await c.list("0:/macros");
	await c.getFileInfo("0:/gcodes/a.gcode");
	await c.getThumbnail("0:/gcodes/a.gcode", 0);
	await c.connect();
	assert.deepEqual(seen, [
		"download:0:/sys/config.g", "list:0:/macros",
		"fileInfo:0:/gcodes/a.gcode", "thumb:0:/gcodes/a.gcode", "connect",
	]);
});

test("real + armed: writes are allowed through", async () => {
	const { c, seen } = guard({ real: true, armed: true });
	await c.sendCode("G28");
	await c.upload("0:/sys/config.g", "M83");
	assert.deepEqual(seen, ["sendCode:G28", "upload:0:/sys/config.g"]);
});

test("real + unarmed: M112 always passes — never block an e-stop", async () => {
	const { c, seen } = guard({ real: true, armed: false });
	await c.sendCode("M112");
	assert.deepEqual(seen, ["sendCode:M112"]);
});

test("isEmergencyStop matches only a bare M112", () => {
	assert.equal(isEmergencyStop("M112"), true);
	assert.equal(isEmergencyStop("  m112  "), true);
	assert.equal(isEmergencyStop("M112 ; halt"), true);
	// must not be a smuggling route for other commands
	assert.equal(isEmergencyStop("M112\nG1 X10"), false);
	assert.equal(isEmergencyStop("M999"), false);
	assert.equal(isEmergencyStop("G28"), false);
});

// The STOP button sends halt-and-reset as ONE payload so the reset can't be
// stranded by the halt (reference/dwc/.../EmergencyBtn.vue:2 does the same).
// The guard has to recognise that exact pair, or it fails closed on the real
// board in the default unarmed state — blocking the one code it must never block.
test("isEmergencyStop matches the M112+M999 halt-and-reset pair", () => {
	assert.equal(isEmergencyStop("M112\nM999"), true);
	assert.equal(isEmergencyStop("m112\r\nm999"), true);
	assert.equal(isEmergencyStop("  M112  \n  M999  "), true);
	assert.equal(isEmergencyStop("M112 ; halt\nM999 ; reset"), true);
});

test("isEmergencyStop still refuses anything smuggled alongside the pair", () => {
	assert.equal(isEmergencyStop("M112\nM999\nG28"), false);
	assert.equal(isEmergencyStop("M112\nG28\nM999"), false);
	// order matters: a reset is not an e-stop, whichever side it sits on
	assert.equal(isEmergencyStop("M999\nM112"), false);
	assert.equal(isEmergencyStop("M999\nM999"), false);
	assert.equal(isEmergencyStop("M112\nM112"), false);
});

test("real + unarmed: the M112+M999 pair passes — the STOP button must work", async () => {
	const { c, seen } = guard({ real: true, armed: false });
	await c.sendCode("M112\nM999");
	assert.deepEqual(seen, ["sendCode:M112\nM999"]);
});

// Destructive file operations are exactly what the guard exists for. A delete
// that reaches the real board cannot be undone, and these three were added to
// the Connector interface AFTER the guard was written — the failure mode is
// that new mutations silently default to unguarded.
test("real + unarmed: destructive file operations are blocked", async () => {
	const { c, seen } = guard({ real: true, armed: false });
	await assert.rejects(() => c.remove("0:/gcodes/a.gcode"), RealWriteBlockedError);
	await assert.rejects(() => c.move("0:/gcodes/a.gcode", "0:/gcodes/b.gcode"), RealWriteBlockedError);
	await assert.rejects(() => c.mkdir("0:/gcodes/parts"), RealWriteBlockedError);
	assert.deepEqual(seen, [], "nothing reached the board");
});

test("real + armed: destructive file operations pass through", async () => {
	const { c, seen } = guard({ real: true, armed: true });
	await c.remove("0:/gcodes/a.gcode", true);
	await c.move("0:/gcodes/a.gcode", "0:/gcodes/b.gcode");
	await c.mkdir("0:/gcodes/parts");
	assert.deepEqual(seen, [
		"remove:0:/gcodes/a.gcode", "move:0:/gcodes/a.gcode->0:/gcodes/b.gcode", "mkdir:0:/gcodes/parts",
	]);
});

// Guarding must not silently drop arguments: a recursive delete that arrives
// as non-recursive would fail confusingly, and one that arrives recursive when
// it shouldn't would take the whole directory.
test("the guard forwards file-operation arguments unchanged", async () => {
	const calls: unknown[][] = [];
	const inner = {
		status: "connected",
		remove: async (...args: unknown[]) => { calls.push(["remove", ...args]); },
		move: async (...args: unknown[]) => { calls.push(["move", ...args]); },
	} as unknown as Connector;
	const c = guardWrites(inner, { isReal: () => false, isArmed: () => false });

	await c.remove("0:/gcodes/batch", true);
	await c.move("0:/a", "0:/b", true);

	assert.deepEqual(calls, [["remove", "0:/gcodes/batch", true], ["move", "0:/a", "0:/b", true]]);
});
