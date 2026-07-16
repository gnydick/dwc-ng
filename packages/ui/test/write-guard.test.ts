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
