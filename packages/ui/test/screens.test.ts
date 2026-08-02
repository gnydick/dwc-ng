import { test } from "node:test";
import assert from "node:assert/strict";
import { createConfigStore } from "../src/config/store.ts";
import { BUILTIN_SCREENS, screenList, resolveScreen } from "../src/compose/screens.ts";

// ---- config store screen operations ----

test("addScreen mints a u- prefixed id and the screen appears with empty cards", () => {
	const store = createConfigStore();
	const id = store.addScreen("CNC Router");
	assert.ok(id.startsWith("u-"), "minted ids live in the u- namespace (I11)");
	const entry = resolveScreen(store.config, id);
	assert.ok(entry !== null && !entry.builtin);
	assert.equal(entry!.def.name, "CNC Router");
	assert.deepEqual(entry!.def.composition, {});
});

test("renameScreen renames a builtin via overlay and a custom in place — ids never change (I10)", () => {
	const store = createConfigStore();
	store.renameScreen("machine", "Printer");
	assert.equal(resolveScreen(store.config, "machine")!.def.name, "Printer");
	// the id still resolves — the rename touched only the label
	assert.ok(resolveScreen(store.config, "machine"));

	const id = store.addScreen("Temp");
	store.renameScreen(id, "Laser");
	assert.equal(resolveScreen(store.config, id)!.def.name, "Laser");
});

test("setScreenHidden removes a builtin from the list and back", () => {
	const store = createConfigStore();
	store.setScreenHidden("bed", true);
	assert.equal(resolveScreen(store.config, "bed"), null);
	assert.ok(!screenList(store.config).some(s => s.id === "bed"));
	store.setScreenHidden("bed", false);
	assert.ok(resolveScreen(store.config, "bed"));
});

test("the screen list is never empty even with every builtin hidden", () => {
	const store = createConfigStore();
	for (const id of Object.keys(BUILTIN_SCREENS)) store.setScreenHidden(id, true);
	const list = screenList(store.config);
	assert.ok(list.length >= 1, "the shell always has a screen to land on");
});

test("replaceAllScreenCards overrides a builtin's composition; garbage falls back", () => {
	const store = createConfigStore();
	store.replaceAllScreenCards("machine", { position: { col: 0, row: 0, colSpan: 24, rowSpan: 95 } });
	const overridden = resolveScreen(store.config, "machine")!.def.composition;
	assert.deepEqual(Object.keys(overridden), ["position"]);
	assert.equal(overridden.position!.colSpan, 24);

	// An override whose every slot is bogus parses to nothing → the builtin
	// composition returns, never a blank screen.
	store.replaceAllScreenCards("control", { "not-a-card": { col: 0, row: 0, colSpan: 4, rowSpan: 4 } });
	assert.deepEqual(
		resolveScreen(store.config, "control")!.def.composition,
		BUILTIN_SCREENS.control.composition,
	);
});

test("removeScreen deletes a custom screen; resetAll undoes renames and hides", () => {
	// resetSection("screens") no longer COMPILES (audit M7): the section holds
	// creations, and the type excludes it. Overrides reset through resetAll.
	const store = createConfigStore();
	const id = store.addScreen("Scratch");
	store.removeScreen(id);
	assert.equal(resolveScreen(store.config, id), null);

	store.renameScreen("machine", "X");
	store.setScreenHidden("bed", true);
	store.resetAll();
	assert.equal(resolveScreen(store.config, "machine")!.def.name, "Machine");
	assert.ok(resolveScreen(store.config, "bed"));
});
