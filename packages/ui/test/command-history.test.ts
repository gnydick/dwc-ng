import { test } from "node:test";
import assert from "node:assert/strict";
import { pushCommand, parseHistory, serializeHistory, loadCommandHistory, saveCommandHistory, capHistory, COMMAND_LIMIT } from "../src/om/commandHistory.ts";
import { openMachineStore } from "../src/config/machineStore.ts";
import type { IdentifiedMachine } from "../src/config/machineId.ts";
import { withLocalStorage } from "./helpers/localStorage.ts";

const MACHINE_A: IdentifiedMachine = { kind: "board", uniqueId: "MACHINE-A" };
const MACHINE_B: IdentifiedMachine = { kind: "board", uniqueId: "MACHINE-B" };

test("pushCommand appends oldest to newest", () => {
	let h: string[] = [];
	h = pushCommand(h, "G28");
	h = pushCommand(h, "M114");
	assert.deepEqual(h, ["G28", "M114"]);
});

test("pushCommand trims and ignores blank input", () => {
	assert.deepEqual(pushCommand([], "  M114  "), ["M114"]);
	assert.deepEqual(pushCommand(["G28"], ""), ["G28"]);
	assert.deepEqual(pushCommand(["G28"], "   "), ["G28"]);
});

test("pushCommand collapses an immediate duplicate but keeps a non-consecutive repeat", () => {
	assert.deepEqual(pushCommand(["M114"], "M114"), ["M114"]);
	// A, B, A — the second A is not consecutive, so recall can reach both
	let h = pushCommand(pushCommand(pushCommand([], "M114"), "G28"), "M114");
	assert.deepEqual(h, ["M114", "G28", "M114"]);
});

test("pushCommand caps to the newest `limit`", () => {
	let h: string[] = [];
	for (let i = 0; i < COMMAND_LIMIT + 5; i++) h = pushCommand(h, `G${i}`);
	assert.equal(h.length, COMMAND_LIMIT);
	assert.equal(h[0], "G5"); // oldest five dropped
	assert.equal(h[h.length - 1], `G${COMMAND_LIMIT + 4}`);
});

test("parseHistory is tolerant of anything unexpected", () => {
	assert.deepEqual(parseHistory(null), []);
	assert.deepEqual(parseHistory(""), []);
	assert.deepEqual(parseHistory("not json"), []);
	assert.deepEqual(parseHistory('{"not":"an array"}'), []);
	assert.deepEqual(parseHistory('["G28", 42, null, "M114"]'), ["G28", "M114"]); // non-strings dropped
});

test("serialize/parse round-trips and serialize caps", () => {
	const h = ["G28", "M114", "G1 X10"];
	assert.deepEqual(parseHistory(serializeHistory(h)), h);
	const big = Array.from({ length: COMMAND_LIMIT + 10 }, (_v, i) => `G${i}`);
	assert.equal(parseHistory(serializeHistory(big)).length, COMMAND_LIMIT);
});

test("capHistory keeps the newest `limit`, same shape as consoleLog's capLines", () => {
	const big = Array.from({ length: COMMAND_LIMIT + 10 }, (_v, i) => `G${i}`);
	const capped = capHistory(big);
	assert.equal(capped.length, COMMAND_LIMIT);
	assert.equal(capped[0], "G10", "oldest ten dropped");
	assert.equal(capped.at(-1), `G${COMMAND_LIMIT + 9}`);
});

test("capHistory leaves a short history untouched", () => {
	const h = ["G28", "M114"];
	assert.deepEqual(capHistory(h, 10), h);
});

test("command history does not cross machines", () => {
	withLocalStorage(() => {
		const a = openMachineStore(MACHINE_A);
		const b = openMachineStore(MACHINE_B);
		saveCommandHistory(a, ["G28", "M114"]);
		assert.deepEqual(loadCommandHistory(b), [], "machine B never saw these commands");
		assert.deepEqual(loadCommandHistory(a), ["G28", "M114"]);
	});
});
