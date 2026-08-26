/**
 * The overlay parse boundary (audit H5): well-formed but MIS-TYPED JSON
 * from the SD card or localStorage must degrade leaf-by-leaf to defaults —
 * never crash the shell, and never persist a poisoned cache that crashes
 * every later boot (the failure mode the old cast allowed).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOverlay, parseOverlayPayload, asSlotRect } from "../src/config/parse.ts";
import { createConfigStore } from "../src/config/store.ts";
import { DEFAULT_CONFIG } from "../src/config/types.ts";
import { screenList } from "../src/compose/screens.ts";
import type { Connector } from "@dwc-ng/connector";

const payload = (overlay: unknown): string => JSON.stringify({ version: 1, overlay });

test("a mis-typed screens section can no longer wedge the shell", async () => {
	// The audit's exact reproducer: screens:"x" (and hidden:{}) used to merge
	// into config.screens, then screenList's .includes() threw inside Shell's
	// memo — and the cached bad overlay crashed every boot after.
	for (const hostile of [
		{ screens: "x" },
		{ screens: { hidden: {} } },
		{ screens: { hidden: 42, renames: [], custom: null, layouts: "y" } },
	]) {
		const connector = { download: async () => payload(hostile) } as unknown as Connector;
		const store = createConfigStore();
		await store.loadFromMachine(connector);
		assert.deepEqual(store.config.screens, DEFAULT_CONFIG.screens);
		// The full path the white-screen took: screenList must survive.
		assert.ok(screenList(store.config).length > 0);
	}
});

test("mis-typed leaves drop; well-typed siblings survive", () => {
	const overlay = parseOverlay({
		axisRoles: { X: 5, Y: "gantry" },
		dockSensors: { "0": { gpIn: "four" }, "1": { gpIn: 7, inverted: true }, "2": { gpIn: 3, inverted: "yes" } },
		camera: { streamUrl: 9 },
		cameraPrefs: { pinned: true },
		sensorNames: "junk",
		macros: { autoConfirmRun: "true" },
		bed: { probePointCommand: null },
	});
	assert.deepEqual(overlay, {
		axisRoles: { Y: "gantry" },
		dockSensors: { "1": { gpIn: 7, inverted: true }, "2": { gpIn: 3 } },
		cameraPrefs: { pinned: true },
	});
});

test("card entries survive only with the minted prefix and full shape", () => {
	const overlay = parseOverlay({
		cards: {
			"c-good": { name: "Spindle", spec: "{}" },
			"machine": { name: "Impostor", spec: "{}" }, // foreign key — dropped
			"c-half": { name: "NoSpec" }, // missing spec — dropped
			"c-bad": "junk",
		},
	});
	assert.deepEqual(overlay, { cards: { "c-good": { name: "Spindle", spec: "{}" } } });
});

test("custom screens survive only with the minted prefix; rects are validated", () => {
	const overlay = parseOverlay({
		screens: {
			custom: {
				"u-ok": { name: "CNC", cards: { homing: { col: 0, row: 0, colSpan: 8, rowSpan: 40 } } },
				"machine": { name: "Shadow", cards: {} }, // would shadow a built-in — dropped
				"u-badrect": { name: "X", cards: { homing: { col: "0", row: 0, colSpan: 8, rowSpan: 40 } } },
			},
			layouts: { machine: { position: { col: 0, row: 0, colSpan: 12, rowSpan: 95 } }, junk: "x" },
		},
	});
	assert.deepEqual(overlay, {
		screens: {
			custom: {
				"u-ok": { name: "CNC", cards: { homing: { col: 0, row: 0, colSpan: 8, rowSpan: 40 } } },
				"u-badrect": { name: "X", cards: {} },
			},
			layouts: { machine: { position: { col: 0, row: 0, colSpan: 12, rowSpan: 95 } } },
		},
	});
});

test("the version gate: a foreign or future envelope yields defaults", () => {
	assert.equal(parseOverlayPayload(JSON.stringify({ version: 999, overlay: { axisRoles: { X: "ok" } } })), null);
	assert.equal(parseOverlayPayload(JSON.stringify({ overlay: {} })), null);
	assert.equal(parseOverlayPayload("not json"), null);
	assert.equal(parseOverlayPayload("[1,2]"), null);
	assert.deepEqual(parseOverlayPayload(payload({ axisRoles: { X: "ok" } })), { axisRoles: { X: "ok" } });
});

test("asSlotRect demands exactly four finite numbers", () => {
	assert.deepEqual(asSlotRect({ col: 1, row: 2, colSpan: 3, rowSpan: 4 }), { col: 1, row: 2, colSpan: 3, rowSpan: 4 });
	assert.equal(asSlotRect({ col: 1, row: 2, colSpan: 3 }), null);
	assert.equal(asSlotRect({ col: 1, row: 2, colSpan: 3, rowSpan: Infinity }), null);
	assert.equal(asSlotRect({ col: 1, row: 2, colSpan: 3, rowSpan: "4" }), null);
	assert.equal(asSlotRect(null), null);
	assert.equal(asSlotRect([1, 2, 3, 4]), null);
});

test("a good overlay round-trips the boundary unchanged", () => {
	const overlay = {
		axisRoles: { U: "Z motor 1" },
		camera: { streamUrl: "http://printercams:8080/stream" },
		cameraPrefs: { pinned: true },
		screens: { hidden: ["bed"], renames: { machine: "Mill" } },
		cards: { "c-abc": { name: "Spindle", spec: '{"inputs":{},"nodes":[]}' } },
	};
	assert.deepEqual(parseOverlayPayload(payload(overlay)), overlay);
});
