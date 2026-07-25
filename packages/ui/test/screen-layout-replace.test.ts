/**
 * The bug this pins: a screen's geometry is stored TWICE — the config overlay
 * (goes to the SD card) and this browser's canvas store (what actually
 * renders). mergeCanvas assembles a layout CARD BY CARD from whichever store
 * has each id, so writing only one of them delivers a shredded layout: cards
 * the browser already knew keep their old spots, only unknown ones land where
 * the new layout says.
 *
 * Reported as "machine import didn't work" while Control's had appeared to.
 * Same code — Control's file carried cards this browser had never seen, so
 * they took the file's positions; Machine's carried only known cards, so every
 * position lost. The outcome was decided by overlap, which is not a design.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { replaceScreenLayout } from "../src/compose/screens.ts";
import { canvasStorageKey, mergeCanvas, parseStoredCanvas, readCanvasState } from "../src/shell/panelCanvas.ts";
import type { SlotRect, UiConfig } from "../src/config/types.ts";
import { DEFAULT_CONFIG } from "../src/config/types.ts";

class MemStore {
	private map = new Map<string, string>();
	getItem(k: string): string | null { return this.map.get(k) ?? null; }
	setItem(k: string, v: string): void { this.map.set(k, v); }
	removeItem(k: string): void { this.map.delete(k); }
}

const useMemStore = (): MemStore => {
	const ls = new MemStore();
	(globalThis as { localStorage?: unknown }).localStorage = ls;
	return ls;
};

/** A config store stub that records what reached the config overlay. */
const stubStore = (): { config: UiConfig; written: Record<string, Record<string, SlotRect>>; updateScreenCards: (id: string, cards: Record<string, SlotRect>) => void } => {
	const written: Record<string, Record<string, SlotRect>> = {};
	return {
		config: DEFAULT_CONFIG,
		written,
		updateScreenCards(id, cards) { written[id] = cards; },
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
	const ls = useMemStore();
	const store = stubStore();
	replaceScreenLayout(store, "machine", IMPORTED);

	assert.deepEqual(store.written["machine"], IMPORTED, "config overlay not written");
	const canvas = readCanvasState(canvasStorageKey("machine"));
	assert.deepEqual(canvas, IMPORTED, "canvas store not written");
	void ls;
});

test("an import lands EVERY card, even when the browser already knew all of them", () => {
	// The exact Machine case. Seed storage with the old layout first, so no
	// imported id is new — the condition under which the old code lost 100% of
	// the imported positions.
	useMemStore();
	const store = stubStore();
	replaceScreenLayout(store, "machine", OLD);
	replaceScreenLayout(store, "machine", IMPORTED);

	const stored = readCanvasState(canvasStorageKey("machine"));
	assert.deepEqual(stored, IMPORTED);
	for (const id of Object.keys(IMPORTED)) {
		assert.notDeepEqual(stored?.[id], OLD[id], `${id} kept its OLD rect — layout was pieced together`);
	}
});

test("RED CHECK: writing only the config overlay reproduces the shredding", () => {
	// Proves the test above can fail — i.e. that it is testing the real defect
	// rather than passing vacuously. This is the old behaviour, spelled out.
	useMemStore();
	const store = stubStore();
	replaceScreenLayout(store, "machine", OLD); // browser knows the old layout
	store.updateScreenCards("machine", IMPORTED); // config-only write, as before

	// What the canvas would render: defaults (the imported composition) merged
	// against storage, per card. Storage wins for every known id.
	const defaults = Object.entries(IMPORTED).map(([id, r]) => ({ id, ...r }));
	const rendered = mergeCanvas(parseStoredCanvas(localStorage.getItem(canvasStorageKey("machine"))), defaults);

	assert.deepEqual(rendered["position"], OLD["position"], "the old rect wins — this is the bug");
	assert.notDeepEqual(rendered["position"], IMPORTED["position"]);
});

test("a card the incoming layout does not mention is not carried over from the old one", () => {
	useMemStore();
	const store = stubStore();
	replaceScreenLayout(store, "machine", { ...OLD, camera: { col: 0, row: 58, colSpan: 13, rowSpan: 119 } });
	replaceScreenLayout(store, "machine", IMPORTED);

	const stored = readCanvasState(canvasStorageKey("machine"));
	assert.equal(stored?.["camera"], undefined, "a dropped card survived the replacement");
});

test("parked spots do not survive a replacement, nor do unclaimed orientations", () => {
	// Parked spots describe the layout being REPLACED — a hidden card's
	// remembered position from the old layout would drop it somewhere
	// arbitrary in the new one. Orientation is different: it belongs to the
	// INCOMING layout and arrives with it, so it is cleared here only because
	// this particular replacement carries none of its own.
	const ls = useMemStore();
	const key = canvasStorageKey("machine");
	ls.setItem(`${key}.parked`, JSON.stringify({ camera: { col: 1, row: 1, colSpan: 2, rowSpan: 2 } }));
	ls.setItem(`${key}.orientation`, JSON.stringify({ position: "horizontal" }));

	replaceScreenLayout(stubStore(), "machine", IMPORTED);

	assert.equal(ls.getItem(`${key}.parked`), null);
	assert.equal(ls.getItem(`${key}.orientation`), null);
});

test("the storage key has ONE definition, shared by every writer", () => {
	assert.equal(canvasStorageKey("machine"), "dwc-ng.canvas.machine");
	assert.equal(canvasStorageKey("u-abc"), "dwc-ng.canvas.u-abc");
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
	const ls = useMemStore();
	const key = canvasStorageKey("machine");
	// This browser had its own directions from the layout being replaced.
	ls.setItem(`${key}.orientation`, JSON.stringify({ position: "vertical", sensors: "vertical" }));

	replaceScreenLayout(stubStore(), "machine", {
		position: { col: 0, row: 0, colSpan: 4, rowSpan: 4, orientation: "horizontal" },
		sensors: { col: 4, row: 0, colSpan: 4, rowSpan: 4 },
	});

	const written = JSON.parse(ls.getItem(`${key}.orientation`) ?? "{}") as Record<string, string>;
	assert.equal(written["position"], "horizontal", "the imported orientation did not land");
	assert.equal(written["sensors"], undefined, "an old orientation survived the replacement");
});

test("a layout carrying no orientations clears rather than inheriting", () => {
	const ls = useMemStore();
	const key = canvasStorageKey("machine");
	ls.setItem(`${key}.orientation`, JSON.stringify({ position: "horizontal" }));
	replaceScreenLayout(stubStore(), "machine", IMPORTED);
	assert.equal(ls.getItem(`${key}.orientation`), null);
});
