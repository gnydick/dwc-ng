import { test } from "node:test";
import assert from "node:assert/strict";
import {
	pushCommand, parseHistory, serializeHistory, loadCommandHistory, saveCommandHistory, capHistory, COMMAND_LIMIT,
	createCommandHistoryState,
} from "../src/om/commandHistory.ts";
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

// --- createCommandHistoryState: the swap-safe IN-MEMORY buffer behind
// ConsolePanel's ↑/↓ recall (GIT_86 Defect 1a). The test above only proves
// the storage layer is scoped correctly — it holds the buffer itself
// constant and cannot fail on the actual defect (an editor's in-memory
// history surviving an identity change). These drive the swap through the
// buffer `bindMachine`/`push` actually mutate, the same object ConsolePanel
// holds for the life of the console card. -------------------------------

test("createCommandHistoryState: commands typed before identity resolves are DISCARDED, never folded into whichever machine answers first", () => {
	withLocalStorage(() => {
		const a = openMachineStore(MACHINE_A);
		saveCommandHistory(a, ["G28 (A's disk history)"]);

		const state = createCommandHistoryState();
		state.push("M114 (typed with no machine known)");
		assert.deepEqual(state.history, ["M114 (typed with no machine known)"], "kept in memory while unidentified");

		state.bindMachine(a); // identity resolves to A
		assert.deepEqual(
			state.history, ["G28 (A's disk history)"],
			"REPLACED by A's own history — the pre-identity command must not be folded in ahead of it",
		);
	});
});

test("createCommandHistoryState: a machine SWAP replaces the buffer — the outgoing machine's commands never reach the incoming machine's recall or storage", () => {
	withLocalStorage(() => {
		const a = openMachineStore(MACHINE_A);
		const b = openMachineStore(MACHINE_B);

		const state = createCommandHistoryState();
		state.bindMachine(a);
		state.push("M569 P0 S1 (typed for A)");
		assert.deepEqual(state.history, ["M569 P0 S1 (typed for A)"]);

		state.bindMachine(b); // the swap
		assert.deepEqual(
			state.history, [],
			"B starts clean — A's command must not sit at the top of B's ↑-recall, resendable with one keystroke",
		);

		state.push("G1 X10 (typed for B)");
		assert.deepEqual(loadCommandHistory(b), ["G1 X10 (typed for B)"], "B's own store got only B's command");
		assert.deepEqual(loadCommandHistory(a), ["M569 P0 S1 (typed for A)"], "A's store is untouched by the swap or by B's push");
	});
});

test("createCommandHistoryState: push persists through whichever machine was last BOUND, not a fresh re-resolve at write time", () => {
	// Models the send() race the original bug allowed: a command committed
	// against the OUTGOING machine's binding must still land under that
	// machine's own key even though `push` itself takes no MachineId param.
	withLocalStorage(() => {
		const a = openMachineStore(MACHINE_A);
		const state = createCommandHistoryState();
		state.bindMachine(a);
		state.push("G28");
		assert.deepEqual(loadCommandHistory(a), ["G28"]);
	});
});

test("createCommandHistoryState: re-binding to the SAME machine is a no-op — it does not re-read disk and lose an in-session push", () => {
	withLocalStorage(() => {
		const a = openMachineStore(MACHINE_A);
		const state = createCommandHistoryState();
		state.bindMachine(a);
		state.push("G28");
		state.bindMachine(openMachineStore(MACHINE_A)); // a fresh handle for the same id, e.g. a re-render
		assert.deepEqual(state.history, ["G28"], "not wiped by a redundant bind for the machine already bound");
	});
});

test("createCommandHistoryState: binding while unidentified leaves whatever is already buffered alone", () => {
	const state = createCommandHistoryState();
	state.push("M114");
	state.bindMachine(null);
	assert.deepEqual(state.history, ["M114"]);
});
