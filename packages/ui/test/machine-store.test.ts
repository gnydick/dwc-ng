/**
 * The single door for machine-scoped localStorage. The property under test is
 * negative and is the whole point of phase 1: bytes written for machine A are
 * not reachable while connected to machine B.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openMachineStore, MACHINE_KEY_PREFIX } from "../src/config/machineStore.ts";
import type { IdentifiedMachine } from "../src/config/machineId.ts";
import { withLocalStorage } from "./helpers/localStorage.ts";

const A: IdentifiedMachine = { kind: "board", uniqueId: "MACHINE-A" };
const B: IdentifiedMachine = { kind: "board", uniqueId: "MACHINE-B" };

test("what machine A wrote, machine B cannot read", () => {
	withLocalStorage(() => {
		openMachineStore(A).set("config", '{"envelope":"A"}');
		assert.equal(openMachineStore(B).get("config"), null);
		assert.equal(openMachineStore(A).get("config"), '{"envelope":"A"}');
	});
});

test("keys carry the machine segment and the prefix", () => {
	withLocalStorage(() => {
		openMachineStore(A).set("config", "x");
		const keys = [...Array(localStorage.length).keys()].map(i => localStorage.key(i)!);
		assert.equal(keys.length, 1);
		const key = keys[0]!;
		assert.ok(key.startsWith(MACHINE_KEY_PREFIX), key);
		assert.ok(key.includes("MACHINE-A"), key);
		assert.ok(key.endsWith(".config"), key);
	});
});

test("a suffix scopes per-screen values without escaping the machine", () => {
	withLocalStorage(() => {
		openMachineStore(A).set("canvas", "layoutA", "machine");
		assert.equal(openMachineStore(A).get("canvas", "machine"), "layoutA");
		assert.equal(openMachineStore(A).get("canvas", "control"), null);
		assert.equal(openMachineStore(B).get("canvas", "machine"), null);
	});
});

test("a suffix cannot climb out of its level", () => {
	// A screen id reaches this from user config; a dotted one must not be able
	// to address another key name.
	withLocalStorage(() => {
		const s = openMachineStore(A);
		s.set("canvas", "sneaky", "x.config");
		assert.equal(s.get("config"), null, "a dotted suffix must not land on the config key");
	});
});

test("remove clears only that machine's value", () => {
	withLocalStorage(() => {
		openMachineStore(A).set("console", "a");
		openMachineStore(B).set("console", "b");
		openMachineStore(A).remove("console");
		assert.equal(openMachineStore(A).get("console"), null);
		assert.equal(openMachineStore(B).get("console"), "b");
	});
});

test("no localStorage (SSR, a locked-down browser) is not a crash", () => {
	const g = globalThis as { localStorage?: unknown };
	const prior = g.localStorage;
	delete g.localStorage;
	try {
		const s = openMachineStore(A);
		assert.equal(s.get("config"), null);
		s.set("config", "x");
		s.remove("config");
	} finally { g.localStorage = prior; }
});
