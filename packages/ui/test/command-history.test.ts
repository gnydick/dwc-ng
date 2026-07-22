import { test } from "node:test";
import assert from "node:assert/strict";
import { pushCommand, parseHistory, serializeHistory, COMMAND_LIMIT } from "../src/om/commandHistory.ts";

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
