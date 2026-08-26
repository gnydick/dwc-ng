// GIT_86 Critical 2 — `savedScreenLayout(app.config.config, screenId)` was
// read `untrack`ed at canvas construction, and construction happened the
// instant the keyed `<Show>` in compose/ComposedScreen.tsx swapped from the
// UNIDENTIFIED sentinel to a real MachineStore. Identity resolving happens
// DURING `connector.connect()`'s fullSync; `config.loadFromMachine` runs only
// AFTER `connect()` resolves (App.tsx) — so the canvas used to construct
// (and settle-write its coded defaults, permanently — `isWhollyEmpty` is
// false on every later boot) BEFORE the SD file's layout was ever in
// `app.config.config` at all.
//
// Task 16's own regression tests (panel-canvas.test.ts) hand `seedFromOverlay`
// to `createPanelCanvas` directly — real coverage of "seeding works when a
// seed exists", but not of "does a seed exist at the moment this runs, on
// the real boot path" (the whole-branch review's own criticism). These tests
// exercise the ACTUAL ordering: the real config store constructed, identity
// resolved, and `loadFromMachine` run in the same sequence App.tsx drives,
// with the same `canvasIdentity` gate compose/ComposedScreen.tsx now uses
// (mirrored here rather than imported, since ComposedScreen.tsx is a .tsx
// component and this suite runs with no jsdom — see panel-canvas.test.ts's
// own "no DOM needed" precedent for testing this module's logic directly).
// See scratch-probes/probe-c2.ts / probe-c2-old.ts for the same scenario
// run as a standalone script against the real modules, framework-free.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoot, createSignal, createMemo } from "solid-js";
import type { Connector } from "@dwc-ng/connector";
import { createConfigStore } from "../src/config/store.ts";
import { openMachineStore } from "../src/config/machineStore.ts";
import type { MachineStore } from "../src/config/machineStore.ts";
import { savedScreenLayout } from "../src/compose/screens.ts";
import { createPanelCanvas, machineCanvasKeys, devCanvasKeys } from "../src/shell/panelCanvas.ts";
import { withLocalStorage } from "./helpers/localStorage.ts";

function fakeConnector(text: string): Connector {
	return { download: async () => text, upload: async () => undefined } as unknown as Connector;
}

const UNIDENTIFIED = Symbol("unidentified");

const B_LAYOUT_FILE = JSON.stringify({
	version: 3, machineId: "b.B",
	overlay: { screens: { layouts: { control: { "shaping-decay": { col: 2, row: 1, colSpan: 10, rowSpan: 8 } } } } },
});

function runInRoot(body: (dispose: () => void) => Promise<void>): Promise<void> {
	let p: Promise<void> = Promise.resolve();
	withLocalStorage(() => { p = createRoot(body); });
	return p;
}

test("the canvas identity gate stays at the sentinel through the whole pre-load window, even once identity itself has resolved", async () => {
	await runInRoot(async dispose => {
		const B = openMachineStore({ kind: "board", uniqueId: "B" });
		const [ms, setMs] = createSignal<MachineStore | null>(null);
		const [configLoaded, setConfigLoaded] = createSignal(false);
		const store = createConfigStore({ machineStore: ms });
		// The exact expression added to ComposedScreen.tsx.
		const canvasIdentity = createMemo(() => (configLoaded() ? (ms() ?? UNIDENTIFIED) : UNIDENTIFIED));

		assert.equal(canvasIdentity(), UNIDENTIFIED, "boot: unidentified AND not loaded");

		setMs(B); // identity resolves inside connect()'s fullSync
		assert.equal(canvasIdentity(), UNIDENTIFIED, "identity resolved but the load has not settled — still the sentinel");
		assert.equal(savedScreenLayout(store.config, "control"), null, "the config's machine half is still empty at this instant");

		await store.loadFromMachine(fakeConnector(B_LAYOUT_FILE));
		assert.equal(canvasIdentity(), UNIDENTIFIED, "load settled, but configLoaded has not been set yet (App.tsx's own next step)");

		setConfigLoaded(true); // App.tsx's `.finally`
		assert.equal(canvasIdentity(), B, "now, and only now, the real store");
		assert.deepEqual(
			savedScreenLayout(store.config, "control"),
			{ "shaping-decay": { col: 2, row: 1, colSpan: 10, rowSpan: 8 } },
			"the seed IS available at the one instant a real canvas would ever be constructed",
		);
		dispose();
	});
});

test("a canvas constructed at the gated instant seeds from the operator's real SD layout, not a coded default", async () => {
	await runInRoot(async dispose => {
		const B = openMachineStore({ kind: "board", uniqueId: "B" });
		const [ms, setMs] = createSignal<MachineStore | null>(null);
		const [configLoaded, setConfigLoaded] = createSignal(false);
		const store = createConfigStore({ machineStore: ms });
		const canvasIdentity = createMemo(() => (configLoaded() ? (ms() ?? UNIDENTIFIED) : UNIDENTIFIED));

		setMs(B);
		await store.loadFromMachine(fakeConnector(B_LAYOUT_FILE));
		setConfigLoaded(true);

		const identity = canvasIdentity();
		assert.notEqual(identity, UNIDENTIFIED);
		const canvas = createPanelCanvas(
			machineCanvasKeys(identity as MachineStore, "control"),
			[{ id: "shaping-decay", col: 0, row: 0, colSpan: 4, rowSpan: 2 }, { id: "shaping-apply", col: 0, row: 0, colSpan: 4, rowSpan: 2 }],
			undefined, undefined, undefined,
			savedScreenLayout(store.config, "control"),
		);
		assert.deepEqual(canvas.styleFor("shaping-decay"), { "grid-column": "3 / span 10", "grid-row": "2 / span 8" },
			"the operator's real, dragged layout — not the coded default (col 0/row 0)");
		dispose();
	});
});

test("Card Lab's bench path is unaffected: a seed is ignored regardless, growToDefaults + benchOrigin run exactly as before", () => {
	const defaults = [{ id: "a", col: 5, row: 5, colSpan: 4, rowSpan: 4 }];
	const seed = { a: { col: 9, row: 9, colSpan: 4, rowSpan: 4 } };
	const withSeed = createPanelCanvas(devCanvasKeys("dwc-ng.canvas.test-bench-1"), defaults, undefined, undefined, true, seed);
	const withoutSeed = createPanelCanvas(devCanvasKeys("dwc-ng.canvas.test-bench-2"), defaults, undefined, undefined, true, null);
	assert.deepEqual(withSeed.styleFor("a"), withoutSeed.styleFor("a"), "the bench path reads storedRaw and never the seed — a seed present or absent must not change it");
});
