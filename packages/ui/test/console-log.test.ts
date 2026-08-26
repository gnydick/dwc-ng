import { test } from "node:test";
import assert from "node:assert/strict";
import { appendCapped, capLines, loadConsole, parseConsole, saveConsole, serializeConsole, classifyReply, CONSOLE_LIMIT, type ConsoleLine } from "../src/om/consoleLog.ts";
import { openMachineStore } from "../src/config/machineStore.ts";
import type { IdentifiedMachine } from "../src/config/machineId.ts";
import { withLocalStorage } from "./helpers/localStorage.ts";

const MACHINE_A: IdentifiedMachine = { kind: "board", uniqueId: "MACHINE-A" };
const MACHINE_B: IdentifiedMachine = { kind: "board", uniqueId: "MACHINE-B" };

const line = (n: number) => ({ receivedAt: 1000 + n, text: `msg ${n}` });

test("capLines keeps the most recent lines", () => {
	const lines = Array.from({ length: 10 }, (_, i) => line(i));
	const capped = capLines(lines, 3);
	assert.deepEqual(capped.map(l => l.text), ["msg 7", "msg 8", "msg 9"]);
});

test("capLines leaves a short log untouched", () => {
	const lines = [line(1), line(2)];
	assert.deepEqual(capLines(lines, 10), lines);
});

test("parseConsole tolerates missing or corrupt storage", () => {
	assert.deepEqual(parseConsole(null), []);
	assert.deepEqual(parseConsole(""), []);
	assert.deepEqual(parseConsole("{not json"), []);
	assert.deepEqual(parseConsole('"a string"'), []);
	assert.deepEqual(parseConsole("{}"), []);
});

test("parseConsole drops malformed entries but keeps good ones", () => {
	const raw = JSON.stringify([
		{ receivedAt: 1, text: "good" },
		{ receivedAt: "nope", text: "bad ts" },
		{ text: "no ts" },
		{ receivedAt: 2 },
		null,
		{ receivedAt: 3, text: "also good" },
	]);
	assert.deepEqual(parseConsole(raw).map(l => l.text), ["good", "also good"]);
});

test("serialize -> parse round-trips and caps", () => {
	const lines = Array.from({ length: CONSOLE_LIMIT + 50 }, (_, i) => line(i));
	const restored = parseConsole(serializeConsole(lines));
	assert.equal(restored.length, CONSOLE_LIMIT, "never grow storage without bound");
	assert.equal(restored.at(-1)!.text, `msg ${CONSOLE_LIMIT + 49}`, "keeps the newest");
});

test("classifyReply reflects the firmware-authored prefix", () => {
	assert.equal(classifyReply("Error: Heater 0 fault"), "error");
	assert.equal(classifyReply("Warning: motor phase disconnected"), "warning");
	assert.equal(classifyReply("ok"), "normal");
	assert.equal(classifyReply("X:0.0 Y:0.0 Z:0.0"), "normal");
	assert.equal(classifyReply(""), "normal");
});

test("classifyReply is exact — a mention of an error is not an error line", () => {
	// Only the RRF prefix (capitalised, with the colon-space) counts. A reply
	// that merely talks about errors, or lower-cases it, stays normal.
	assert.equal(classifyReply("No errors found"), "normal");
	assert.equal(classifyReply("error: lowercase is not the RRF prefix"), "normal");
	assert.equal(classifyReply("Errors: 0"), "normal");
});

// appendCapped is the only sanctioned way to grow the live log — om/store.ts no
// longer applies the bound itself. It mutates in place because the live console
// is a Solid store array written through produce().
test("appendCapped evicts the oldest and never exceeds the bound", () => {
	const lines: ConsoleLine[] = [];
	for (let i = 0; i < CONSOLE_LIMIT + 25; i++) appendCapped(lines, line(i));
	assert.equal(lines.length, CONSOLE_LIMIT, "bounded however many arrive");
	assert.equal(lines.at(-1)!.text, `msg ${CONSOLE_LIMIT + 24}`, "keeps the newest");
	assert.equal(lines[0]!.text, `msg 25`, "drops the oldest, in order");
});

test("appendCapped mutates in place — produce() hands it a draft to write", () => {
	const lines: ConsoleLine[] = [];
	const same = lines;
	appendCapped(lines, line(1));
	assert.equal(same.length, 1, "the caller's array is the one that grew");
});

test("console lines do not cross machines", () => {
	withLocalStorage(() => {
		const a = openMachineStore(MACHINE_A);
		const b = openMachineStore(MACHINE_B);
		saveConsole(a, [{ receivedAt: 1, text: "A's reply" }]);
		assert.deepEqual(loadConsole(b), [], "machine B never talked to this board");
		assert.equal(loadConsole(a).length, 1);
	});
});
