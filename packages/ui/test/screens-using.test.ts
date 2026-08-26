import { test } from "node:test";
import assert from "node:assert/strict";
import { createConfigStore } from "../src/config/store.ts";
import { planCardDelete, screensUsing } from "../src/compose/screens.ts";
import { isOrphanSlot } from "../src/compose/composition.ts";
import { SPINDLE_EXAMPLE_JSON } from "../src/compose/controls/examples.ts";

const RECT = { col: 0, row: 0, colSpan: 24, rowSpan: 40 };

// ---- screensUsing: the blast-radius data behind the plan ----

test("screensUsing: unplaced card is on no screen", () => {
	const store = createConfigStore({ machineStore: () => null });
	const id = store.addCustomCard("Spindle", SPINDLE_EXAMPLE_JSON);
	assert.deepEqual(screensUsing(store.config, id), []);
});

test("screensUsing finds a card on a builtin via the layouts overlay, rename applied", () => {
	const store = createConfigStore({ machineStore: () => null });
	const id = store.addCustomCard("Spindle", SPINDLE_EXAMPLE_JSON);
	store.setScreenCard("machine", id, RECT);
	store.renameScreen("machine", "Printer");
	assert.deepEqual(screensUsing(store.config, id), [
		{ id: "machine", name: "Printer", hidden: false },
	]);
});

test("screensUsing reports hidden builtins — the card is still placed on them", () => {
	const store = createConfigStore({ machineStore: () => null });
	const id = store.addCustomCard("Spindle", SPINDLE_EXAMPLE_JSON);
	store.setScreenCard("bed", id, RECT);
	store.setScreenHidden("bed", true);
	assert.deepEqual(screensUsing(store.config, id), [
		{ id: "bed", name: "Bed maintenance", hidden: true },
	]);
});

test("screensUsing finds a card on a custom screen", () => {
	const store = createConfigStore({ machineStore: () => null });
	const cardId = store.addCustomCard("Spindle", SPINDLE_EXAMPLE_JSON);
	const screenId = store.addScreen("CNC bench");
	store.setScreenCard(screenId, cardId, RECT);
	assert.deepEqual(screensUsing(store.config, cardId), [
		{ id: screenId, name: "CNC bench", hidden: false },
	]);
});

test("screensUsing: removing the placement removes the usage", () => {
	const store = createConfigStore({ machineStore: () => null });
	const id = store.addCustomCard("Spindle", SPINDLE_EXAMPLE_JSON);
	store.setScreenCard("machine", id, RECT);
	store.setScreenCard("machine", id, null);
	assert.deepEqual(screensUsing(store.config, id), []);
});

// ---- planCardDelete: the sole producer builds id, uses, and message TOGETHER ----

test("planCardDelete: unused card — plan says so and still names the id it deletes", () => {
	const store = createConfigStore({ machineStore: () => null });
	const id = store.addCustomCard("Spindle", SPINDLE_EXAMPLE_JSON);
	const plan = planCardDelete(store.config, id);
	assert.equal(plan.id, id);
	assert.deepEqual(plan.uses, []);
	assert.equal(plan.message, "Not on any screen.");
});

test("planCardDelete: message lists every use, hidden flagged, from the same uses array", () => {
	const store = createConfigStore({ machineStore: () => null });
	const id = store.addCustomCard("Spindle", SPINDLE_EXAMPLE_JSON);
	store.setScreenCard("machine", id, RECT);
	const screenId = store.addScreen("CNC bench");
	store.setScreenCard(screenId, id, RECT);
	store.setScreenHidden("machine", true);
	const plan = planCardDelete(store.config, id);
	assert.deepEqual(plan.uses.map(u => u.name), ["Machine", "CNC bench"]);
	assert.equal(
		plan.message,
		"On screens: Machine (hidden), CNC bench — confirm to remove it from all of them.",
	);
});

// ---- isOrphanSlot: the lab's featured-fallback condition ----

test("isOrphanSlot: registry ids never orphan; custom ids orphan when their def is gone", () => {
	const store = createConfigStore({ machineStore: () => null });
	assert.equal(isOrphanSlot("position", store.config), false);
	const id = store.addCustomCard("Spindle", SPINDLE_EXAMPLE_JSON);
	assert.equal(isOrphanSlot(id, store.config), false);
	store.removeCustomCard(id);
	assert.equal(isOrphanSlot(id, store.config), true);
});
