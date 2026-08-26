import { test } from "node:test";
import assert from "node:assert/strict";
import { parseControlSpecText } from "../src/compose/controls/parse.ts";
import { SPINDLE_EXAMPLE_JSON } from "../src/compose/controls/examples.ts";
import { compileTemplate, resolveTemplate } from "../src/compose/controls/template.ts";
import { parseComposition, addCard, isCustomCardId, type CustomCardId } from "../src/compose/composition.ts";
import { createConfigStore } from "../src/config/store.ts";
import { resolveScreen } from "../src/compose/screens.ts";

// ---- the untrusted boundary ----

test("the spindle example parses, compiles, and resolves the verified M-codes", () => {
	const parsed = parseControlSpecText(SPINDLE_EXAMPLE_JSON);
	assert.ok(parsed.ok, parsed.ok ? "" : parsed.error);
	// forms verified against reference/duet-gcode.md (M3/M4/M5)
	const scope = { input: (n: string) => ({ rpm: 12000 } as Record<string, number>)[n], om: {}, vars: {} };
	assert.equal(resolveTemplate(compileTemplate("M3 S{input.rpm}")!, scope), "M3 S12000");
	assert.equal(resolveTemplate(compileTemplate("M4 S{input.rpm}")!, scope), "M4 S12000");
	assert.equal(resolveTemplate(compileTemplate("M5")!, scope), "M5");
});

test("garbage, unknown types, and injection-shaped specs are named errors, never cards", () => {
	assert.match((parseControlSpecText("not json") as { error: string }).error, /Not valid JSON/);
	assert.match(
		(parseControlSpecText('{"nodes":[{"type":"script","src":"evil"}]}') as { error: string }).error,
		/unknown control type "script"/,
	);
	assert.match(
		(parseControlSpecText('{"nodes":[{"type":"forEach","from":"a[b()]","as":"x","node":{"type":"gcode-button","label":"x","template":"G4"}}]}') as { error: string }).error,
		/invalid selector/,
	);
	assert.match(
		(parseControlSpecText('{"nodes":[{"type":"gcode-button","label":"x","template":"G1 {input.}"}]}') as { error: string }).error,
		/invalid template/,
	);
	assert.match(
		(parseControlSpecText('{"nodes":[{"type":"jog-pad","step":"step","feed":"feed"}]}') as { error: string }).error,
		/unknown input/,
	);
	assert.match(
		(parseControlSpecText('{"nodes":[{"type":"forEach","from":"move.axes","as":"a","enrich":"evalEverything","node":{"type":"gcode-button","label":"x","template":"G4"}}]}') as { error: string }).error,
		/unknown enrichment/,
	);
});

// ---- custom cards in config + compositions ----

test("addCustomCard mints c- ids; the spec text round-trips exactly", () => {
	const store = createConfigStore({ machineStore: () => null });
	const id = store.addCustomCard("Spindle", SPINDLE_EXAMPLE_JSON);
	assert.ok(isCustomCardId(id), "minted ids live in the c- namespace");
	assert.equal(store.config.cards[id]!.spec, SPINDLE_EXAMPLE_JSON, "opaque text — prune/merge never touch it");
	store.updateCustomCard(id, { name: "Spindle 2" });
	assert.equal(store.config.cards[id]!.name, "Spindle 2");
	store.removeCustomCard(id);
	assert.equal(store.config.cards[id], undefined);
});

test("compositions keep c- slots only while the card definition exists", () => {
	const raw = { "c-abc": { col: 0, row: 0, colSpan: 12, rowSpan: 40 } };
	assert.deepEqual(parseComposition(raw), {}, "no custom set → dropped");
	assert.deepEqual(parseComposition(raw, new Set(["c-abc"])), { "c-abc": raw["c-abc"] });
	assert.deepEqual(parseComposition(raw, new Set(["c-other"])), {}, "unknown custom id → dropped");
});

test("a custom card lands on a screen via the same addCard path and survives resolveScreen", () => {
	const store = createConfigStore({ machineStore: () => null });
	const cardId = store.addCustomCard("Spindle", SPINDLE_EXAMPLE_JSON) as CustomCardId;
	const screenId = store.addScreen("CNC");
	const composition = addCard({}, cardId);
	assert.ok(composition[cardId], "auto-placed at the custom default size");
	store.replaceAllScreenCards(screenId, composition as Record<string, { col: number; row: number; colSpan: number; rowSpan: number }>);
	const entry = resolveScreen(store.config, screenId)!;
	assert.deepEqual(Object.keys(entry.def.composition), [cardId]);

	// Deleting the card degrades the screen by exactly that slot.
	store.removeCustomCard(cardId);
	assert.deepEqual(resolveScreen(store.config, screenId)!.def.composition, {});
});

// ---- the studio's form model: a projection, not a second semantics ----

test("form → spec → form round-trips; the spindle example lifts to the form", async () => {
	const { toSpec, tryFromSpec } = await import("../src/compose/controls/formModel.ts");
	const { SPINDLE_EXAMPLE } = await import("../src/compose/controls/examples.ts");
	const lifted = tryFromSpec(SPINDLE_EXAMPLE);
	assert.ok(lifted !== null, "the example is form-shaped");
	assert.deepEqual(toSpec(lifted!), SPINDLE_EXAMPLE, "lower(lift(spec)) is identity");
	// and the lowered spec passes the one true boundary
	assert.ok(parseControlSpecText(JSON.stringify(toSpec(lifted!))).ok);
});

test("power-vocabulary specs refuse to lift (edited as JSON, never approximated)", async () => {
	const { tryFromSpec } = await import("../src/compose/controls/formModel.ts");
	assert.equal(tryFromSpec({
		inputs: {},
		nodes: [{ type: "forEach", from: "move.axes[visible]", as: "a", node: { type: "gcode-button", label: "x", template: "G4" } }],
	}), null, "forEach is JSON territory");
	assert.equal(tryFromSpec({
		inputs: { step: { kind: "number", label: "s", default: 1 }, feed: { kind: "number", label: "f", default: 6000 } },
		nodes: [{ type: "jog-pad", step: "step", feed: "feed" }],
	}), null, "jog primitives are JSON territory");
});

// ---- reset semantics: overrides reset, creations survive ----

test("Reset everything drops overrides but KEEPS custom cards and screens", async () => {
	const { BUILTIN_SCREENS } = await import("../src/compose/screens.ts");
	const store = createConfigStore({ machineStore: () => null });
	const cardId = store.addCustomCard("Spindle", SPINDLE_EXAMPLE_JSON);
	const screenId = store.addScreen("CNC");
	store.replaceAllScreenCards(screenId, { [cardId]: { col: 0, row: 0, colSpan: 12, rowSpan: 40 } });
	store.setAxisRole("U", "Z motor 1");
	store.renameScreen("machine", "Printer");
	store.setScreenHidden("bed", true);
	store.replaceAllScreenCards("machine", { position: { col: 0, row: 0, colSpan: 24, rowSpan: 95 } });

	store.resetAll();

	// Overrides are gone — built-ins back to how they shipped.
	assert.equal(store.config.axisRoles["U"], undefined);
	assert.equal(resolveScreen(store.config, "machine")!.def.name, "Machine");
	assert.ok(resolveScreen(store.config, "bed"), "hidden builtin restored");
	assert.deepEqual(
		resolveScreen(store.config, "machine")!.def.composition,
		BUILTIN_SCREENS.machine.composition,
		"layout override dropped",
	);
	// Creations survive — they have no default to return to.
	assert.ok(store.config.cards[cardId], "custom card kept");
	const screen = resolveScreen(store.config, screenId);
	assert.ok(screen !== null, "custom screen kept");
	assert.deepEqual(Object.keys(screen!.def.composition), [cardId], "its composition kept");
});
