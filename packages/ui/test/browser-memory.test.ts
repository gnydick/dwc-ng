/**
 * Per-browser navigation memory (files/browserMemory.ts): last directory +
 * per-directory scroll, persisted per root, tolerant of malformed storage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBrowserMemory, saveBrowserDir, saveBrowserScroll } from "../src/files/browserMemory.ts";

// A minimal in-memory localStorage for the node test environment.
class MemStore {
	private m = new Map<string, string>();
	getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
	setItem(k: string, v: string): void { this.m.set(k, v); }
	removeItem(k: string): void { this.m.delete(k); }
	clear(): void { this.m.clear(); }
	get raw(): Map<string, string> { return this.m; }
}
(globalThis as { localStorage?: unknown }).localStorage = new MemStore();

test("dir round-trips per root, independently", () => {
	saveBrowserDir("0:/gcodes", "0:/gcodes/benchies");
	saveBrowserDir("0:/macros", "0:/macros/tools");
	assert.equal(loadBrowserMemory("0:/gcodes").dir, "0:/gcodes/benchies");
	assert.equal(loadBrowserMemory("0:/macros").dir, "0:/macros/tools");
	assert.equal(loadBrowserMemory("0:/sys").dir, undefined, "an untouched root remembers nothing");
});

test("scroll round-trips per directory, and dir/scroll coexist", () => {
	saveBrowserDir("0:/gcodes", "0:/gcodes/a");
	saveBrowserScroll("0:/gcodes", "0:/gcodes/a", 120);
	saveBrowserScroll("0:/gcodes", "0:/gcodes/b", 340);
	const m = loadBrowserMemory("0:/gcodes");
	assert.equal(m.dir, "0:/gcodes/a", "saving scroll preserves the remembered dir");
	assert.equal(m.scroll["0:/gcodes/a"], 120);
	assert.equal(m.scroll["0:/gcodes/b"], 340);
});

test("malformed or hostile storage yields empty memory, never a throw", () => {
	const ls = globalThis.localStorage as unknown as MemStore;
	ls.setItem("dwc-ng.browser.0:/x", "{not json");
	assert.deepEqual(loadBrowserMemory("0:/x"), { dir: undefined, scroll: {} });
	ls.setItem("dwc-ng.browser.0:/y", JSON.stringify({ dir: 5, scroll: { good: 10, bad: "x", neg: -3, inf: Infinity } }));
	const m = loadBrowserMemory("0:/y");
	assert.equal(m.dir, undefined, "a non-string dir is dropped");
	assert.deepEqual(m.scroll, { good: 10 }, "only finite non-negative numbers survive");
	ls.setItem("dwc-ng.browser.0:/z", JSON.stringify({ scroll: { "__proto__": 9 } }));
	const z = loadBrowserMemory("0:/z");
	assert.equal(Object.getPrototypeOf(z.scroll), Object.prototype, "a prototype-reaching scroll key can't pollute");
});

test("the scroll map is capped so it cannot grow without bound", () => {
	const root = "0:/cap";
	for (let i = 0; i < 60; i++) saveBrowserScroll(root, `${root}/d${i}`, i);
	const m = loadBrowserMemory(root);
	assert.ok(Object.keys(m.scroll).length <= 40, `capped at 40, got ${Object.keys(m.scroll).length}`);
	assert.equal(m.scroll[`${root}/d59`], 59, "the most recent directory is kept");
});
