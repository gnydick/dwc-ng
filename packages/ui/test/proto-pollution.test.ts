/**
 * Hostile-input pins for the safe-object kernel (audit H2/M2): JSON from
 * the SD card, localStorage, the board, and share files may carry
 * prototype-reaching keys ("__proto__", "constructor", "prototype"). Every
 * walk over such data goes through util/safeObject.ts — these tests prove
 * the pollution has no route through any load path, and that hostile share
 * files produce named errors, never throws.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createConfigStore } from "../src/config/store.ts";
import { DEFAULT_CONFIG } from "../src/config/types.ts";
import type { Connector } from "../src/connector/types.ts";
import { createOmStore, deepMergeInto } from "../src/om/store.ts";
import { parseShareFile } from "../src/compose/share.ts";
import { parseControlSpecText } from "../src/compose/controls/parse.ts";
import { parseOrientationState } from "../src/shell/panelOrientation.ts";
import { safeEntries, isSafeKey } from "../src/util/safeObject.ts";

/** Assert Object.prototype did not gain `name`; clean up if it somehow did,
 *  so one failing construction can't cascade into unrelated tests. */
function assertUnpolluted(name: string): void {
	const probe = {} as Record<string, unknown>;
	const leaked = probe[name];
	if (leaked !== undefined) delete (Object.prototype as Record<string, unknown>)[name];
	assert.equal(leaked, undefined, `Object.prototype gained "${name}"`);
}

test("safeEntries drops exactly the prototype-reaching keys", () => {
	const parsed = JSON.parse('{"a":1,"__proto__":{"x":1},"constructor":2,"prototype":3,"b":4}') as Record<string, unknown>;
	assert.deepEqual(safeEntries(parsed), [["a", 1], ["b", 4]]);
	assert.equal(isSafeKey("__proto__"), false);
	assert.equal(isSafeKey("axisRoles"), true);
});

test("a hostile SD config file cannot pollute Object.prototype", async () => {
	// A computed ["__proto__"] literal creates an OWN property, which
	// stringify keeps and JSON.parse recreates — the dangerous shape.
	const hostile = JSON.stringify({
		version: 1,
		overlay: { axisRoles: { X: "ok" }, ["__proto__"]: { pollutedCfg: true } },
	});
	assert.match(hostile, /__proto__/, "the hostile key must survive serialization");
	const connector = { download: async () => hostile } as unknown as Connector;
	const store = createConfigStore();
	await store.loadFromMachine(connector);
	assert.equal(store.config.axisRoles["X"], "ok", "legitimate keys still load");
	assertUnpolluted("pollutedCfg");
});

test("deepMergeInto ignores prototype-reaching keys in board patches", () => {
	const target: Record<string, unknown> = { state: { status: "idle" } };
	deepMergeInto(target, JSON.parse('{"state":{"status":"printing"},"__proto__":{"pollutedOm":true}}') as Record<string, unknown>);
	assert.deepEqual(target, { state: { status: "printing" } });
	assertUnpolluted("pollutedOm");
});

test("onModelKey refuses a prototype-reaching key from the wire", () => {
	const store = createOmStore();
	const before = Object.keys(store.om);
	store.events.onModelKey?.("__proto__", { pollutedKey: true });
	assert.deepEqual(Object.keys(store.om), before, "the store gains no key");
	assertUnpolluted("pollutedKey");
});

test("parseShareFile returns a named error on null card/screen (not a throw)", () => {
	assert.deepEqual(parseShareFile('{"dwcng":"card","card":null}'), { kind: "error", error: "Malformed card file." });
	assert.deepEqual(parseShareFile('{"dwcng":"screen","screen":null}'), { kind: "error", error: "Malformed screen file." });
	assert.equal(parseShareFile('{"dwcng":"screen","screen":{"name":"x","cards":{}},"customCards":"junk"}').kind, "error");
});

test("a screen file with prototype-reaching slot keys cannot poison the import", () => {
	const file = JSON.stringify({
		dwcng: "screen",
		version: 1,
		screen: { name: "evil", cards: { ["__proto__"]: { col: 0, row: 0, colSpan: 2, rowSpan: 2 } } },
		customCards: {},
	});
	const imported = parseShareFile(file);
	assert.equal(imported.kind, "screen");
	if (imported.kind === "screen") {
		assert.deepEqual(imported.cards, {}, "the hostile key never enters the slot record");
		assert.equal(Object.getPrototypeOf(imported.cards), Object.prototype);
	}
});

test("a spec with a prototype-reaching input name is a named parse error", () => {
	const spec = JSON.stringify({
		inputs: { ["__proto__"]: { kind: "number", label: "x", default: 1 } },
		nodes: [],
	});
	const parsed = parseControlSpecText(spec);
	assert.equal(parsed.ok, false);
	if (!parsed.ok) assert.match(parsed.error, /not a usable input name/);
});

test("orientation state parse drops prototype-reaching panel ids", () => {
	const state = parseOrientationState('{"tools":"horizontal","__proto__":"horizontal"}');
	assert.deepEqual(state, { tools: "horizontal" });
	assert.equal(Object.getPrototypeOf(state), Object.prototype);
});

test("defaults remain intact after everything above", () => {
	// A polluted prototype would surface as phantom keys on a fresh store.
	const store = createConfigStore();
	assert.deepEqual(store.config, DEFAULT_CONFIG);
});
