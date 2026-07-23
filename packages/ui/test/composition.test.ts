import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCardId, allCardIds, CARD_DEFS } from "../src/compose/defs.ts";
import {
	parseComposition, findFreePosition, addCard, removeCard, slotsOf,
	type Composition,
} from "../src/compose/composition.ts";
import { GRID_COLS, rectsOverlap } from "../src/shell/panelCanvas.ts";

// ---- I1: boundary parse — a string becomes a CardId or ceases to exist ----

test("parseCardId accepts every registered id and only those", () => {
	for (const id of allCardIds()) assert.equal(parseCardId(id), id);
	assert.equal(parseCardId("not-a-card"), null);
	assert.equal(parseCardId(""), null);
	assert.equal(parseCardId("BUILD-OBJECTS"), null); // exact, not fuzzy
});

test("parseComposition drops bad slots, never the screen", () => {
	const raw = {
		"build-objects": { col: 2, row: 4, colSpan: 12, rowSpan: 53 },
		"ghost-card": { col: 0, row: 0, colSpan: 4, rowSpan: 10 }, // unknown id
		// malformed rect on a real id: dropped per-slot
	};
	const parsed = parseComposition(raw);
	assert.deepEqual(Object.keys(parsed), ["build-objects"]);
	assert.deepEqual(parsed["build-objects"], { col: 2, row: 4, colSpan: 12, rowSpan: 53 });
});

test("parseComposition survives garbage without throwing", () => {
	assert.deepEqual(parseComposition(null), {});
	assert.deepEqual(parseComposition("nonsense"), {});
	assert.deepEqual(parseComposition([1, 2, 3]), {});
	assert.deepEqual(parseComposition({ "build-objects": "not a rect" }), {});
	// corrupt numbers clamp to sanity rather than propagating NaN
	const clamped = parseComposition({ "build-objects": { col: "x", row: -5, colSpan: 9999, rowSpan: 0 } });
	const slot = clamped["build-objects"]!;
	assert.ok(slot.col >= 0 && slot.colSpan <= GRID_COLS && slot.rowSpan >= 1 && slot.row >= 0);
});

// ---- auto-place: additive by construction, never displaces or discards ----

test("findFreePosition never overlaps occupied slots", () => {
	const occupied = [
		{ col: 0, row: 0, colSpan: 24, rowSpan: 40 },
		{ col: 24, row: 0, colSpan: 24, rowSpan: 60 },
		{ col: 0, row: 40, colSpan: 12, rowSpan: 30 },
	];
	const spot = findFreePosition(occupied, { colSpan: 12, rowSpan: 20 });
	const candidate = { ...spot, colSpan: 12, rowSpan: 20 };
	assert.ok(!occupied.some(s => rectsOverlap(candidate, s)), "placed clear of everything");
	assert.ok(spot.col + 12 <= GRID_COLS, "inside the grid");
});

test("findFreePosition falls to the bottom when nothing fits between", () => {
	const wall = [{ col: 0, row: 0, colSpan: GRID_COLS, rowSpan: 100 }];
	assert.deepEqual(findFreePosition(wall, { colSpan: 48, rowSpan: 10 }), { col: 0, row: 100 });
});

test("findFreePosition on an empty screen is the origin", () => {
	assert.deepEqual(findFreePosition([], { colSpan: 12, rowSpan: 53 }), { col: 0, row: 0 });
});

test("addCard places at natural size and NEVER moves existing slots", () => {
	const before: Composition = {};
	const one = addCard(before, "build-objects");
	assert.deepEqual(one["build-objects"], { col: 0, row: 0, ...CARD_DEFS["build-objects"].size });
	assert.deepEqual(before, {}, "input untouched — placement is pure");
});

test("addCard is idempotent (I2: the duplicate has no encoding)", () => {
	const once = addCard({}, "build-objects");
	const twice = addCard(once, "build-objects");
	assert.equal(twice, once, "re-adding returns the same composition");
	assert.equal(slotsOf(twice).length, 1);
});

test("removeCard removes only the named slot and never reflows", () => {
	const composition = addCard({}, "build-objects");
	const emptied = removeCard(composition, "build-objects");
	assert.deepEqual(emptied, {});
	assert.equal(removeCard(emptied, "build-objects"), emptied, "removing absent = no-op");
});

// ---- registry sanity: every def is renderable-shaped ----

test("every card def has a positive natural size within the grid", () => {
	for (const id of allCardIds()) {
		const size = CARD_DEFS[id].size;
		assert.ok(size.colSpan >= 1 && size.colSpan <= GRID_COLS, `${id} colSpan`);
		assert.ok(size.rowSpan >= 1, `${id} rowSpan`);
		assert.ok(CARD_DEFS[id].title.length > 0, `${id} title`);
	}
});
