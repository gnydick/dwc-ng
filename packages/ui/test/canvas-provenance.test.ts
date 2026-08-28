// #87 — screen geometry lives in TWO stores with no ordering between them:
// the machine-scoped canvas record (written on every drag) and the config
// overlay's `screens.layouts` (written at Save and uploaded to the SD card).
// Which one is right was decided by whichever path ran first.
//
// `seedFromOverlay` closed one case: a canvas store with NO record at all
// seeds from the card's copy. Two ambiguities were left, and both are the same
// missing fact — whether this browser's canvas has ever been reconciled
// against the card's copy:
//
//   1. `reset()` REMOVED the layout key, so a deliberately cleared canvas was
//      indistinguishable from a browser that had never opened the screen. The
//      next mount re-seeded from the overlay: the operator cleared a layout
//      and it came back.
//   2. A canvas holding ANY entry was left alone, so a browser carrying rects
//      from before someone else saved a new layout to this machine's SD kept
//      its stale copy — and its next Save uploaded it over the good one.
//
// Both are fixed by writing the missing fact down: every canvas record carries
// the BASIS it was reconciled against (a digest of the overlay's rects for
// that screen), and a reset is a positive `cleared` record rather than an
// absence.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	createPanelCanvas, devCanvasKeys, layoutBasis, readStoredCanvasRecord,
	machineCanvasKeys, restampCanvas, serializeCanvas,
	type CanvasState,
} from "../src/shell/panelCanvas.ts";
import { createRoot } from "solid-js";
import { openMachineStore } from "../src/config/machineStore.ts";
import { createConfigStore } from "../src/config/store.ts";
import { droppedSectionsText } from "../src/cards/machineIdentityText.ts";
import { withLocalStorage } from "./helpers/localStorage.ts";

const rect = (col: number, row: number, colSpan = 12, rowSpan = 40) => ({ col, row, colSpan, rowSpan });

/** A scratch localStorage, matching panel-canvas.test.ts's own MemStore. */
function withStorage(run: () => void): void {
	const backing = new Map<string, string>();
	const g = globalThis as { localStorage?: unknown };
	const prior = g.localStorage;
	g.localStorage = {
		getItem: (k: string) => backing.get(k) ?? null,
		setItem: (k: string, v: string) => void backing.set(k, String(v)),
		removeItem: (k: string) => void backing.delete(k),
	};
	try { run(); } finally { g.localStorage = prior; }
}

const DEFAULTS = [
	{ id: "a", ...rect(0, 0) },
	{ id: "b", ...rect(12, 0) },
];

/** Where the canvas thinks a card is, as a bare rect. */
function posOf(canvas: ReturnType<typeof createPanelCanvas>, id: string): { col: number; row: number } | null {
	const style = canvas.styleFor(id);
	const col = style["grid-column"];
	const row = style["grid-row"];
	if (col === undefined || row === undefined) return null;
	return { col: Number(col.split(" ")[0]) - 1, row: Number(row.split(" ")[0]) - 1 };
}

// ---- requirement 2: a cleared canvas is not an empty one ----

test("a reset layout stays reset across a remount, even with a saved layout on the card", () => {
	// THE RED. `reset()` used to remove the key; the next mount saw "wholly
	// empty", seeded from the overlay, and the operator's clear was undone.
	withStorage(() => {
		const key = "dwc-ng.canvas.test-87-reset";
		const seed: CanvasState = { a: rect(0, 200), b: rect(12, 200) };

		const first = createPanelCanvas(devCanvasKeys(key), DEFAULTS, undefined, undefined, undefined, seed);
		assert.deepEqual(posOf(first, "a"), { col: 0, row: 200 }, "precondition: the SD layout seeded this browser");

		first.reset();
		const second = createPanelCanvas(devCanvasKeys(key), DEFAULTS, undefined, undefined, undefined, seed);
		assert.deepEqual(posOf(second, "a"), { col: 0, row: 0 }, "the coded default, not the card's saved layout");
	});
});

test("a reset writes a positive record rather than removing the key", () => {
	withStorage(() => {
		const key = "dwc-ng.canvas.test-87-reset-record";
		const canvas = createPanelCanvas(devCanvasKeys(key), DEFAULTS);
		canvas.reset();

		const stored = localStorage.getItem(key);
		assert.notEqual(stored, null, "the key survives a reset — absence means something else now");
		assert.equal(readStoredCanvasRecord(stored).cleared, true);
	});
});

// ---- requirement 3: an unproven copy never wins over a proof-carrying one ----

test("a canvas built against an OLDER saved layout is dropped when the card's copy has changed", () => {
	withStorage(() => {
		const key = "dwc-ng.canvas.test-87-stale";
		const saved: CanvasState = { a: rect(0, 100), b: rect(12, 100) };

		// This browser drags a card. Its record now carries the basis of the
		// layout it was reconciled against.
		const first = createPanelCanvas(devCanvasKeys(key), DEFAULTS, undefined, undefined, undefined, saved);
		first.adoptLayout({ a: rect(0, 150), b: rect(12, 150) });
		assert.deepEqual(posOf(first, "a"), { col: 0, row: 150 });

		// Meanwhile someone saves a DIFFERENT layout to this machine's card.
		const newer: CanvasState = { a: rect(0, 300), b: rect(12, 300) };
		const dropped: string[] = [];
		const second = createPanelCanvas(
			devCanvasKeys(key), DEFAULTS, undefined, undefined, undefined, newer,
			why => dropped.push(why),
		);

		assert.deepEqual(posOf(second, "a"), { col: 0, row: 300 }, "the card's copy wins over the unreconciled local one");
		assert.equal(dropped.length, 1, "and the drop is reported, not silent");
	});
});

test("a canvas built against the CURRENT saved layout keeps its local edits", () => {
	// The other half, and the one that makes this safe to ship: unsaved drags
	// must survive a reload. Only a copy that has never seen this layout is
	// unproven.
	withStorage(() => {
		const key = "dwc-ng.canvas.test-87-fresh";
		const saved: CanvasState = { a: rect(0, 100), b: rect(12, 100) };

		const first = createPanelCanvas(devCanvasKeys(key), DEFAULTS, undefined, undefined, undefined, saved);
		first.adoptLayout({ a: rect(0, 150), b: rect(12, 150) });

		const dropped: string[] = [];
		const second = createPanelCanvas(
			devCanvasKeys(key), DEFAULTS, undefined, undefined, undefined, saved,
			why => dropped.push(why),
		);
		assert.deepEqual(posOf(second, "a"), { col: 0, row: 150 }, "the local drag survived the reload");
		assert.deepEqual(dropped, [], "nothing was dropped, so nothing is reported");
	});
});

test("a record written before the basis existed is unproven, so the card's copy wins", () => {
	// The migration case: every canvas already in every browser. It carries no
	// basis, so it cannot show it was ever reconciled — and the ticket's own
	// precedent (#76) is that bytes with no proof of origin are dropped, never
	// guessed at.
	withStorage(() => {
		const key = "dwc-ng.canvas.test-87-legacy";
		// v4 with no basis — exactly what today's builds write.
		localStorage.setItem(key, JSON.stringify({ v: 4, state: { a: rect(0, 500), b: rect(12, 500) } }));

		const dropped: string[] = [];
		const canvas = createPanelCanvas(
			devCanvasKeys(key), DEFAULTS, undefined, undefined, undefined,
			{ a: rect(0, 700), b: rect(12, 700) },
			why => dropped.push(why),
		);
		assert.deepEqual(posOf(canvas, "a"), { col: 0, row: 700 });
		assert.equal(dropped.length, 1);
	});
});

// ---- the case with nothing to defer to is unchanged ----

test("with no saved layout on the card, the browser's own canvas stands", () => {
	// There is no proof-carrying copy here, so there is nothing for the local
	// one to be stale against. This is every machine that has never saved a
	// screen, and it must not start losing layouts.
	withStorage(() => {
		const key = "dwc-ng.canvas.test-87-nocard";
		const first = createPanelCanvas(devCanvasKeys(key), DEFAULTS);
		first.adoptLayout({ a: rect(0, 260), b: rect(12, 260) });

		const dropped: string[] = [];
		const second = createPanelCanvas(devCanvasKeys(key), DEFAULTS, undefined, undefined, undefined, null, why => dropped.push(why));
		assert.deepEqual(posOf(second, "a"), { col: 0, row: 260 });
		assert.deepEqual(dropped, []);
	});
});

test("a cleared canvas stays cleared when there is no saved layout either", () => {
	withStorage(() => {
		const key = "dwc-ng.canvas.test-87-cleared-nocard";
		const first = createPanelCanvas(devCanvasKeys(key), DEFAULTS);
		first.adoptLayout({ a: rect(0, 260), b: rect(12, 260) });
		first.reset();

		const second = createPanelCanvas(devCanvasKeys(key), DEFAULTS);
		assert.deepEqual(posOf(second, "a"), { col: 0, row: 0 }, "back to the coded default and staying there");
	});
});

test("a browser that has never opened the screen still seeds from the card — the landed case", () => {
	withStorage(() => {
		const dropped: string[] = [];
		const canvas = createPanelCanvas(
			devCanvasKeys("dwc-ng.canvas.test-87-virgin"), DEFAULTS, undefined, undefined, undefined,
			{ a: rect(0, 400), b: rect(12, 400) },
			why => dropped.push(why),
		);
		assert.deepEqual(posOf(canvas, "a"), { col: 0, row: 400 });
		assert.deepEqual(dropped, [], "seeding an empty browser is not a drop — nothing was discarded");
	});
});

// ---- the basis itself ----

test("layoutBasis is stable across key order and distinguishes a real change", () => {
	// It is the whole mechanism: if it changed when the layout did not, every
	// reload would discard unsaved drags; if it did not change when the layout
	// did, the stale copy would win and this ticket would be unfixed.
	assert.equal(
		layoutBasis({ a: rect(0, 1), b: rect(12, 2) }),
		layoutBasis({ b: rect(12, 2), a: rect(0, 1) }),
		"insertion order is not part of the layout",
	);
	assert.notEqual(layoutBasis({ a: rect(0, 1) }), layoutBasis({ a: rect(0, 2) }), "a moved card is a change");
	assert.notEqual(layoutBasis({ a: rect(0, 1) }), layoutBasis({ a: rect(0, 1, 12, 41) }), "a resized card is a change");
	assert.notEqual(layoutBasis({ a: rect(0, 1) }), layoutBasis({ a: rect(0, 1), b: rect(12, 1) }), "an added card is a change");
	assert.notEqual(layoutBasis(null), layoutBasis({}), "no layout at all is not an empty layout");
});

// ---- requirement 4: a drop is reported, and a SAVE is not a drop ----

test("Save to machine re-stamps the canvas, so the next mount reports nothing", () => {
	// The trap this guards: captureScreenGeometry copies the canvas INTO the
	// overlay, so afterwards the two agree — but the canvas record still names
	// the older layout it was built from. Without the re-stamp the next mount
	// reads that as a stale browser, discards a canvas identical to the
	// overlay, and tells the operator a layout was dropped when none was.
	withStorage(() => {
		const store = openMachineStore({ kind: "board", uniqueId: "restamp-test" });
		const keys = machineCanvasKeys(store, "machine");
		const built: CanvasState = { a: rect(0, 10), b: rect(12, 10) };
		keys.set("layout", serializeCanvas(built, layoutBasis(built)));

		// The operator drags, then Saves: the overlay now holds a DIFFERENT
		// layout than the canvas was built against.
		const saved: CanvasState = { a: rect(0, 90), b: rect(12, 90) };
		restampCanvas(store, "machine", layoutBasis(saved));

		const dropped: string[] = [];
		const after = createPanelCanvas(
			machineCanvasKeys(store, "machine"), DEFAULTS, undefined, undefined, undefined, saved,
			why => dropped.push(why),
		);
		assert.deepEqual(dropped, [], "a reconciled canvas is not a stale one");
		assert.deepEqual(posOf(after, "a"), { col: 0, row: 10 }, "and it keeps the geometry it had");
	});
});

test("a re-stamp leaves a cleared canvas cleared", () => {
	withStorage(() => {
		const store = openMachineStore({ kind: "board", uniqueId: "restamp-cleared" });
		const keys = machineCanvasKeys(store, "machine");
		keys.set("layout", serializeCanvas({}, "old", true));

		restampCanvas(store, "machine", "new");
		const record = readStoredCanvasRecord(keys.get("layout"));
		assert.equal(record.cleared, true, "a Save does not un-clear a screen the operator cleared");
		assert.equal(record.basis, "new");
	});
});

test("a dropped layout reaches the operator through droppedMachineSections, once", () => {
	withLocalStorage(() => {
		createRoot(dispose => {
			const config = createConfigStore({ machineStore: () => null });
			assert.deepEqual(config.droppedMachineSections, []);

			config.noteDroppedMachineSection("the Machine screen's layout (stale)");
			config.noteDroppedMachineSection("the Machine screen's layout (stale)");
			assert.equal(config.droppedMachineSections.length, 1, "a remount does not repeat the line");

			config.noteDroppedMachineSection("the Control screen's layout (stale)");
			assert.equal(config.droppedMachineSections.length, 2);
			assert.match(droppedSectionsText(config.droppedMachineSections) ?? "", /could not be carried forward/);
			dispose();
		});
	});
});

test("a cleared canvas stays cleared across MANY reloads, and a drag ends it", () => {
	// The settle write at construction is a repair, not an edit, so it must not
	// quietly retract the reset. Observed on the mock before this was fixed: the
	// flag survived exactly one mount, after which the record described itself
	// as an ordinary layout that happened to match the coded defaults.
	withStorage(() => {
		const key = "dwc-ng.canvas.test-87-cleared-persists";
		const seed: CanvasState = { a: rect(0, 200), b: rect(12, 200) };
		createPanelCanvas(devCanvasKeys(key), DEFAULTS, undefined, undefined, undefined, seed).reset();

		for (let reload = 0; reload < 3; reload++) {
			const canvas = createPanelCanvas(devCanvasKeys(key), DEFAULTS, undefined, undefined, undefined, seed);
			assert.deepEqual(posOf(canvas, "a"), { col: 0, row: 0 }, `reload ${reload}: still reset`);
			assert.equal(readStoredCanvasRecord(localStorage.getItem(key)).cleared, true, `reload ${reload}: still says so`);
		}

		// A drag is an edit, and a canvas with rects the operator placed is not
		// a cleared one any more.
		const canvas = createPanelCanvas(devCanvasKeys(key), DEFAULTS, undefined, undefined, undefined, seed);
		canvas.adoptLayout({ a: rect(0, 60), b: rect(12, 60) });
		assert.equal(readStoredCanvasRecord(localStorage.getItem(key)).cleared, false);
	});
});
