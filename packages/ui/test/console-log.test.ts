import { test } from "node:test";
import assert from "node:assert/strict";
import { capLines, parseConsole, serializeConsole, CONSOLE_LIMIT } from "../src/om/consoleLog.ts";

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
