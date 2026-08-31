/**
 * Custom-card metadata (#194 increment 4): authored default size, tip text,
 * and per-card body padding as OPTIONAL FLAT SCALARS on CustomCardDef.
 *
 * The load-bearing test here is the prune/mergeInto survival one: the spec is
 * opaque JSON text precisely because the overlay machinery corrupts structures
 * it recurses into (config/types.ts, CustomCardDef doc). The metadata fields
 * live NEXT to that text as scalar leaves, and these tests are the falsifying
 * check that the overlay cycle (structuredClone -> mutate -> prune ->
 * mergeInto) and the untrusted parse boundary both carry them intact.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createConfigStore } from "../src/config/store.ts";
import { parseOverlay } from "../src/config/parse.ts";
import { sanitizeCardMeta } from "../src/config/types.ts";
import { addCard, defaultCardSize } from "../src/compose/composition.ts";
import { CARD_DEFS } from "../src/compose/defs.ts";
import { GRID_COLS } from "../src/shell/panelCanvas.ts";
import { SPINDLE_EXAMPLE_JSON } from "../src/compose/controls/examples.ts";

const META = { colSpan: 120, rowSpan: 48, tip: "state.status · M300", padding: 6 };

// ---- store round-trip: the prune/mergeInto survival check ----

test("metadata survives the overlay cycle: add, then an unrelated apply re-runs prune+merge", () => {
	const store = createConfigStore({ machineStore: () => null });
	const id = store.addCustomCard("Meta card", SPINDLE_EXAMPLE_JSON, META);
	// A further, unrelated write re-runs the WHOLE overlay machinery
	// (structuredClone -> prune -> commit -> effective/mergeInto) over the
	// stored def — this is the cycle the opaque-spec comment indicts.
	store.setAxisRole("U", "Z motor 1");
	const def = store.config.cards[id]!;
	assert.equal(def.name, "Meta card");
	assert.equal(def.spec, SPINDLE_EXAMPLE_JSON, "spec text still byte-identical");
	assert.equal(def.colSpan, META.colSpan);
	assert.equal(def.rowSpan, META.rowSpan);
	assert.equal(def.tip, META.tip);
	assert.equal(def.padding, META.padding);
});

test("updateCustomCard patches fields, null clears them, garbage is never written", () => {
	const store = createConfigStore({ machineStore: () => null });
	const id = store.addCustomCard("Meta card", SPINDLE_EXAMPLE_JSON, META);
	store.updateCustomCard(id, { rowSpan: 60, tip: "M300" });
	assert.equal(store.config.cards[id]!.rowSpan, 60);
	assert.equal(store.config.cards[id]!.tip, "M300");
	assert.equal(store.config.cards[id]!.colSpan, META.colSpan, "untouched field kept");
	// null = back to default (field removed).
	store.updateCustomCard(id, { tip: null, padding: null });
	assert.equal(store.config.cards[id]!.tip, undefined);
	assert.equal(store.config.cards[id]!.padding, undefined);
	// Invalid values are ignored at the one gate, never stored.
	store.updateCustomCard(id, { colSpan: Number.NaN, padding: -3, tip: "   " });
	assert.equal(store.config.cards[id]!.colSpan, META.colSpan);
	assert.equal(store.config.cards[id]!.padding, undefined);
	assert.equal(store.config.cards[id]!.tip, undefined);
});

// ---- the untrusted boundary (SD file / cache / future share import) ----

test("parseOverlay keeps valid metadata and drops each invalid field by itself", () => {
	const raw = {
		cards: {
			"c-good": { name: "A", spec: "{}", ...META },
			"c-mixed": { name: "B", spec: "{}", colSpan: "156", rowSpan: 0, tip: "", padding: 2 },
		},
	};
	const parsed = parseOverlay(JSON.parse(JSON.stringify(raw)));
	assert.deepEqual(parsed.cards!["c-good"], { name: "A", spec: "{}", ...META });
	// Mis-typed colSpan, sub-1 rowSpan and empty tip drop THEMSELVES; the card
	// and the fields that pass survive — house per-leaf tolerance.
	assert.deepEqual(parsed.cards!["c-mixed"], { name: "B", spec: "{}", padding: 2 });
});

test("an old-shape overlay (no metadata) parses to exactly the old result", () => {
	const parsed = parseOverlay({ cards: { "c-old": { name: "Old", spec: "{}" } } });
	assert.deepEqual(parsed.cards!["c-old"], { name: "Old", spec: "{}" });
});

test("sanitizeCardMeta is the one gate: passes the valid, drops the rest", () => {
	assert.deepEqual(sanitizeCardMeta(META), META);
	assert.deepEqual(
		sanitizeCardMeta({ colSpan: Infinity, rowSpan: 0.5, tip: 42, padding: "4" }),
		{},
	);
	assert.deepEqual(sanitizeCardMeta({ padding: 0 }), { padding: 0 }, "zero padding is a choice, not absence");
});

// ---- sizing: one placement path for registry and custom cards ----

test("defaultCardSize: registry from CARD_DEFS, custom from authored fields, fallback otherwise", () => {
	assert.deepEqual(defaultCardSize("position"), CARD_DEFS.position.size);
	const cards = { "c-x": { name: "X", spec: "{}", colSpan: 120, rowSpan: 48 } } as const;
	assert.deepEqual(defaultCardSize("c-x", cards), { colSpan: 120, rowSpan: 48 });
	// Absent record or absent fields fall back to the stock custom default.
	assert.deepEqual(defaultCardSize("c-x"), { colSpan: 156, rowSpan: 40 });
	const oneAxis = { "c-x": { name: "X", spec: "{}", rowSpan: 48 } } as const;
	assert.deepEqual(defaultCardSize("c-x", oneAxis), { colSpan: 156, rowSpan: 48 });
	// Spans normalize through clampRect — the ONE bound: rounded, capped at the grid.
	const absurd = { "c-x": { name: "X", spec: "{}", colSpan: 9999, rowSpan: 47.6 } } as const;
	assert.deepEqual(defaultCardSize("c-x", absurd), { colSpan: GRID_COLS, rowSpan: 48 });
});

test("addCard places a custom card at its authored footprint through the same path", () => {
	const cards = { "c-x": { name: "X", spec: "{}", colSpan: 120, rowSpan: 48 } } as const;
	const placed = addCard({}, "c-x", cards)["c-x"]!;
	assert.equal(placed.colSpan, 120);
	assert.equal(placed.rowSpan, 48);
	// Without the defs record the stock default still applies (2-arg call sites).
	const stock = addCard({}, "c-x")["c-x"]!;
	assert.equal(stock.colSpan, 156);
	assert.equal(stock.rowSpan, 40);
});
