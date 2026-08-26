/**
 * The bug this pins: a screen's geometry is stored TWICE — the config overlay
 * (goes to the SD card) and this browser's canvas store (what actually
 * renders). mergeCanvas assembles a layout CARD BY CARD from whichever store
 * has each id, so writing only one of them delivers a shredded layout: cards
 * the browser already knew keep their old spots, and only unknown ones land
 * where the new layout says.
 *
 * Reported as "machine import didn't work" while Control's had appeared to.
 * Same code — Control's file carried cards this browser had never seen, so
 * they took the file's positions; Machine's carried only known cards, so every
 * position lost. The outcome was decided by overlap, which is not a design.
 *
 * GIT_86: the canvas half of both tiers is now keyed by WHICH machine laid the
 * screen out (config/machineStore.ts), not by an origin-global
 * `dwc-ng.canvas.<id>` key — replaceScreenLayout/captureScreenGeometry/
 * readCanvasState/writeCanvasState all take the caller's MachineStore.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { captureScreenGeometry, replaceScreenLayout } from "../src/compose/screens.ts";
import { createPanelCanvas, devCanvasKeys, machineCanvasKeys, mergeCanvas, parseStoredCanvas, readCanvasState } from "../src/shell/panelCanvas.ts";
import type { SlotRect, UiConfig } from "../src/config/types.ts";
import { DEFAULT_CONFIG } from "../src/config/types.ts";
import { openMachineStore } from "../src/config/machineStore.ts";
import type { IdentifiedMachine } from "../src/config/machineId.ts";
import { withLocalStorage } from "./helpers/localStorage.ts";

const MACHINE_A: IdentifiedMachine = { kind: "board", uniqueId: "MACHINE-A" };
const MACHINE_B: IdentifiedMachine = { kind: "board", uniqueId: "MACHINE-B" };

/** A config store stub that records what reached the config overlay. */
const stubStore = (): { config: UiConfig; written: Record<string, Record<string, SlotRect>>; replaceAllScreenCards: (id: string, cards: Record<string, SlotRect>) => void } => {
	const written: Record<string, Record<string, SlotRect>> = {};
	return {
		config: DEFAULT_CONFIG,
		written,
		replaceAllScreenCards(id, cards) { written[id] = cards; },
	};
};

const OLD: Record<string, SlotRect> = {
	position: { col: 0, row: 0, colSpan: 13, rowSpan: 26 },
	sensors: { col: 0, row: 26, colSpan: 13, rowSpan: 32 },
};
const IMPORTED: Record<string, SlotRect> = {
	position: { col: 20, row: 40, colSpan: 6, rowSpan: 60 },
	sensors: { col: 30, row: 90, colSpan: 8, rowSpan: 44 },
};

test("replacing a layout writes BOTH stores — neither alone is a layout", () => {
	withLocalStorage(() => {
		const machine = openMachineStore(MACHINE_A);
		const store = stubStore();
		replaceScreenLayout(store, machine, "machine", IMPORTED);

		assert.deepEqual(store.written["machine"], IMPORTED, "config overlay not written");
		const canvas = readCanvasState(machine, "machine");
		assert.deepEqual(canvas, IMPORTED, "canvas store not written");
	});
});

test("an import lands EVERY card, even when the browser already knew all of them", () => {
	// The exact Machine case. Seed storage with the old layout first, so no
	// imported id is new — the condition under which the old code lost 100% of
	// the imported positions.
	withLocalStorage(() => {
		const machine = openMachineStore(MACHINE_A);
		const store = stubStore();
		replaceScreenLayout(store, machine, "machine", OLD);
		replaceScreenLayout(store, machine, "machine", IMPORTED);

		const stored = readCanvasState(machine, "machine");
		assert.deepEqual(stored, IMPORTED);
		for (const id of Object.keys(IMPORTED)) {
			assert.notDeepEqual(stored?.[id], OLD[id], `${id} kept its OLD rect — layout was pieced together`);
		}
	});
});

test("RED CHECK: writing only the config overlay reproduces the shredding", () => {
	// Proves the test above can fail — i.e. that it is testing the real defect
	// rather than passing vacuously. This is the old behaviour, spelled out.
	withLocalStorage(() => {
		const machine = openMachineStore(MACHINE_A);
		const store = stubStore();
		replaceScreenLayout(store, machine, "machine", OLD); // browser knows the old layout
		store.replaceAllScreenCards("machine", IMPORTED); // config-only write, as before

		// What the canvas would render: defaults (the imported composition) merged
		// against storage, per card. Storage wins for every known id.
		const defaults = Object.entries(IMPORTED).map(([id, r]) => ({ id, ...r }));
		const rendered = mergeCanvas(parseStoredCanvas(machineCanvasKeys(machine, "machine").get("layout")), defaults);

		// POSITION is the invariant this pins: the browser's remembered col/row
		// wins over the imported layout's, which is the shredding. Spans are no
		// longer part of the claim — growToDefaults (USER_AUDIT line 19) adopts a
		// composition span that grew, so position's rowSpan legitimately becomes
		// the imported 60 while its col/row stay stubbornly at the old 0,0.
		assert.equal(rendered["position"]!.col, OLD["position"]!.col, "the old column wins — this is the bug");
		assert.equal(rendered["position"]!.row, OLD["position"]!.row, "the old row wins — this is the bug");
		assert.notDeepEqual(rendered["position"], IMPORTED["position"]);
	});
});

test("a card the incoming layout does not mention is not carried over from the old one", () => {
	withLocalStorage(() => {
		const machine = openMachineStore(MACHINE_A);
		const store = stubStore();
		replaceScreenLayout(store, machine, "machine", { ...OLD, camera: { col: 0, row: 58, colSpan: 13, rowSpan: 119 } });
		replaceScreenLayout(store, machine, "machine", IMPORTED);

		const stored = readCanvasState(machine, "machine");
		assert.equal(stored?.["camera"], undefined, "a dropped card survived the replacement");
	});
});

test("parked spots do not survive a replacement, nor do unclaimed orientations", () => {
	// Parked spots describe the layout being REPLACED — a hidden card's
	// remembered position from the old layout would drop it somewhere
	// arbitrary in the new one. Orientation is different: it belongs to the
	// INCOMING layout and arrives with it, so it is cleared here only because
	// this particular replacement carries none of its own.
	withLocalStorage(() => {
		const machine = openMachineStore(MACHINE_A);
		const keys = machineCanvasKeys(machine, "machine");
		keys.set("parked", JSON.stringify({ camera: { col: 1, row: 1, colSpan: 2, rowSpan: 2 } }));
		keys.set("orientation", JSON.stringify({ position: "horizontal" }));

		replaceScreenLayout(stubStore(), machine, "machine", IMPORTED);

		assert.equal(keys.get("parked"), null);
		assert.equal(keys.get("orientation"), null);
	});
});

test("a screen's canvas does not cross machines", () => {
	// The user-visible consequence: a layout saved while talking to one board
	// must not appear the moment a different board answers at the same address.
	withLocalStorage(() => {
		const a = openMachineStore(MACHINE_A);
		const b = openMachineStore(MACHINE_B);
		replaceScreenLayout(stubStore(), a, "machine", IMPORTED);
		assert.equal(readCanvasState(b, "machine"), null, "machine B never had this screen laid out");
		assert.deepEqual(readCanvasState(a, "machine"), IMPORTED);
	});
});

test("createPanelCanvas and writeCanvasState/readCanvasState address the SAME record", () => {
	// There is exactly one route from a (machine, screen id) pair to its
	// canvas bytes — machineCanvasKeys — so a layout written through one API
	// is visible through the other without a second key format to keep in
	// sync.
	withLocalStorage(() => {
		const machine = openMachineStore(MACHINE_A);
		replaceScreenLayout(stubStore(), machine, "machine", IMPORTED);
		const defaults = Object.entries(IMPORTED).map(([id, r]) => ({ id, ...r }));
		const canvas = createPanelCanvas(machineCanvasKeys(machine, "machine"), defaults);
		assert.deepEqual(canvas.styleFor("position")["grid-column"], `${IMPORTED["position"]!.col + 1} / span ${IMPORTED["position"]!.colSpan}`);
	});
});

// --- orientation travels with the slot -------------------------------------
// Reported 2026-07-24: "card orientation is not stored on export or not
// imported." Both, in fact — it lived ONLY in localStorage under
// "<canvasKey>.orientation", so it was in no persistence tier at all: never
// exported, never imported, never carried to SD, never seeding a new browser.

test("orientation survives the composition parse boundary", async () => {
	const { parseComposition } = await import("../src/compose/composition.ts");
	const parsed = parseComposition({
		position: { col: 0, row: 0, colSpan: 4, rowSpan: 4, orientation: "horizontal" },
		sensors: { col: 4, row: 0, colSpan: 4, rowSpan: 4 },
	});
	assert.equal(parsed["position"]?.orientation, "horizontal");
	assert.equal(parsed["sensors"]?.orientation, undefined);
});

test("a junk orientation drops rather than travelling", async () => {
	const { parseComposition } = await import("../src/compose/composition.ts");
	const parsed = parseComposition({
		position: { col: 0, row: 0, colSpan: 4, rowSpan: 4, orientation: "sideways" },
	});
	assert.equal(parsed["position"]?.orientation, undefined);
	assert.equal(parsed["position"]?.colSpan, 4, "the rest of the slot still parsed");
});

test("an export carries each card's orientation", async () => {
	const { exportScreen } = await import("../src/compose/share.ts");
	const entry = {
		id: "machine",
		builtin: true,
		def: {
			name: "Machine",
			composition: {
				position: { col: 0, row: 0, colSpan: 4, rowSpan: 4, orientation: "horizontal" as const },
				sensors: { col: 4, row: 0, colSpan: 4, rowSpan: 4 },
			},
		},
	};
	const file = exportScreen(entry as never, DEFAULT_CONFIG);
	const parsed = JSON.parse(file.text) as { screen: { cards: Record<string, { orientation?: string }> } };
	assert.equal(parsed.screen.cards["position"]?.orientation, "horizontal");
	assert.equal(parsed.screen.cards["sensors"]?.orientation, undefined);
});

test("replacing a layout writes the incoming orientations, not the old ones", () => {
	withLocalStorage(() => {
		const machine = openMachineStore(MACHINE_A);
		const keys = machineCanvasKeys(machine, "machine");
		// This browser had its own directions from the layout being replaced.
		keys.set("orientation", JSON.stringify({ position: "vertical", sensors: "vertical" }));

		replaceScreenLayout(stubStore(), machine, "machine", {
			position: { col: 0, row: 0, colSpan: 4, rowSpan: 4, orientation: "horizontal" },
			sensors: { col: 4, row: 0, colSpan: 4, rowSpan: 4 },
		});

		const written = JSON.parse(keys.get("orientation") ?? "{}") as Record<string, string>;
		assert.equal(written["position"], "horizontal", "the imported orientation did not land");
		assert.equal(written["sensors"], undefined, "an old orientation survived the replacement");
	});
});

test("a layout carrying no orientations clears rather than inheriting", () => {
	withLocalStorage(() => {
		const machine = openMachineStore(MACHINE_A);
		const keys = machineCanvasKeys(machine, "machine");
		keys.set("orientation", JSON.stringify({ position: "horizontal" }));
		replaceScreenLayout(stubStore(), machine, "machine", IMPORTED);
		assert.equal(keys.get("orientation"), null);
	});
});

test("the Card Lab's dev canvas key stays a plain literal, untouched by machine scoping", () => {
	// devCanvasKeys is the Card Lab's own carve-out — not exercised elsewhere
	// in this file, which is entirely about the machine-scoped door.
	withLocalStorage(() => {
		const keys = devCanvasKeys("dwc-ng.canvas.cardlab");
		keys.set("layout", "x");
		assert.equal(localStorage.getItem("dwc-ng.canvas.cardlab"), "x");
	});
});

test("captureScreenGeometry is a no-op with no machine identified — nothing to read FROM, so it does not guess", () => {
	withLocalStorage(() => {
		const machine = openMachineStore(MACHINE_A);
		// Something IS on disk for machine A, so a bug that ignored the null
		// and fell back to some default store would show up here — seeded
		// through its own throwaway config-overlay stub, discarded below.
		replaceScreenLayout(stubStore(), machine, "machine", IMPORTED);

		const store = stubStore(); // fresh — no prior writes to mask a false pass
		captureScreenGeometry(store, null);
		assert.deepEqual(store.written, {}, "captureScreenGeometry must not touch the config overlay with no machine identified");
	});
});
