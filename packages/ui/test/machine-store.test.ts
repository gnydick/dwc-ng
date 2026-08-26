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

test("suffixes that only differ by dot-vs-dash do not collide", () => {
	// A one-line sanitizer that substitutes both "." and "-" to "-" collapses
	// "a.b" and "a-b" onto the identical key; a later write under one would
	// silently clobber the other's value with no error.
	withLocalStorage(() => {
		const s = openMachineStore(A);
		s.set("canvas", "dot", "a.b");
		s.set("canvas", "dash", "a-b");
		assert.equal(s.get("canvas", "a.b"), "dot");
		assert.equal(s.get("canvas", "a-b"), "dash");
	});
});

test("escaping the dash before substituting still isn't enough — a deeper pair must not collide either", () => {
	// A fix that escapes "-" to "--" and THEN substitutes "." to "-" still
	// collapses "a--b" and "a.-.b" onto "a----b", because the escape
	// character and the substitution target are the same character.
	withLocalStorage(() => {
		const s = openMachineStore(A);
		s.set("canvas", "dashes", "a--b");
		s.set("canvas", "dotdash", "a.-.b");
		assert.equal(s.get("canvas", "a--b"), "dashes");
		assert.equal(s.get("canvas", "a.-.b"), "dotdash");
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

test("a storage that throws on setItem/removeItem (quota exceeded, Safari private mode) does not throw out of set/remove (GIT_86 finding 3)", () => {
	const g = globalThis as { localStorage?: unknown };
	const prior = g.localStorage;
	g.localStorage = {
		getItem: () => null,
		setItem: () => { throw new DOMException("QuotaExceededError"); },
		removeItem: () => { throw new DOMException("QuotaExceededError"); },
		length: 0,
		key: () => null,
	};
	try {
		const s = openMachineStore(A);
		// Before this fix, both of these threw straight out of the caller —
		// and config/store.ts's createComputed calls into `set` SYNCHRONOUSLY
		// during construction, so an uncaught throw here came out of App().
		assert.doesNotThrow(() => s.set("config", "x"), "set must swallow a storage write failure");
		assert.doesNotThrow(() => s.remove("config"), "remove must swallow a storage write failure");
	} finally { g.localStorage = prior; }
});
