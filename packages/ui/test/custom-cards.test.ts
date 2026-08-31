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

test("readout and slider pass the untrusted boundary; malformed fields are named errors", () => {
	const good = parseControlSpecText(JSON.stringify({
		inputs: { speed: { kind: "number", label: "Speed", default: 100, unit: "%" } },
		nodes: [
			{ type: "readout", om: "heat.heaters[1].current", label: "Nozzle", unit: "°C", decimals: 1 },
			{ type: "slider", input: "speed", min: 0, max: 200, step: 5, template: "M220 S{input.speed}" },
		],
	}));
	assert.ok(good.ok, good.ok ? "" : good.error);
	assert.match(
		(parseControlSpecText('{"nodes":[{"type":"readout"}]}') as { error: string }).error,
		/nodes\[0\]\.om: expected a string/,
	);
	assert.match(
		(parseControlSpecText('{"nodes":[{"type":"readout","om":"state.status","decimals":"2"}]}') as { error: string }).error,
		/nodes\[0\]\.decimals: expected a number/,
	);
	assert.match(
		(parseControlSpecText('{"inputs":{"s":{"kind":"number","label":"s","default":1}},"nodes":[{"type":"slider","input":"s","template":"M220 S{input.s}"}]}') as { error: string }).error,
		/nodes\[0\]\.min: expected a number/,
	);
	assert.match(
		(parseControlSpecText('{"inputs":{"s":{"kind":"number","label":"s","default":1}},"nodes":[{"type":"slider","input":"s","min":0,"max":100,"stamp":"yes","template":"M220 S{input.s}"}]}') as { error: string }).error,
		/nodes\[0\]\.stamp: expected a boolean/,
	);
});

test("select and toggle pass the untrusted boundary; malformed fields are named errors", () => {
	const good = parseControlSpecText(JSON.stringify({
		inputs: {
			mode: { kind: "select", label: "Mode", default: 0, options: [
				{ label: "Off", value: 0 }, { label: "Full", value: 1 },
			] },
		},
		nodes: [
			{ type: "toggle", om: "fans[0].requestedValue", label: "Part fan", whenOn: "M106 P0 S0", whenOff: "M106 P0 S1" },
			{ type: "gcode-button", label: "Set", template: "M106 S{input.mode}" },
		],
	}));
	assert.ok(good.ok, good.ok ? "" : good.error);
	assert.match(
		(parseControlSpecText('{"inputs":{"m":{"kind":"select","label":"m","default":0}},"nodes":[]}') as { error: string }).error,
		/inputs\.m\.options: expected an array/,
	);
	assert.match(
		(parseControlSpecText('{"inputs":{"m":{"kind":"select","label":"m","default":0,"options":[{"value":0}]}},"nodes":[]}') as { error: string }).error,
		/inputs\.m\.options\[0\]\.label: expected a string/,
	);
	assert.match(
		(parseControlSpecText('{"inputs":{"m":{"kind":"select","label":"m","default":0,"options":[{"label":"x","value":true}]}},"nodes":[]}') as { error: string }).error,
		/inputs\.m\.options\[0\]\.value: expected a number or a string/,
	);
	assert.match(
		(parseControlSpecText('{"nodes":[{"type":"toggle","om":"fans[0].requestedValue","whenOn":"M106 S0"}]}') as { error: string }).error,
		/nodes\[0\]\.whenOff: expected a string/,
	);
	assert.match(
		(parseControlSpecText('{"nodes":[{"type":"toggle","om":"fans[0].requestedValue","whenOn":"M106 S0","whenOff":"M106 S1","stamp":"yes"}]}') as { error: string }).error,
		/nodes\[0\]\.stamp: expected a boolean/,
	);
});

test("layout nodes pass the untrusted boundary; malformed fields are named errors", () => {
	const good = parseControlSpecText(JSON.stringify({
		nodes: [{
			type: "columns",
			rulers: true,
			columns: [
				{ weight: 2, nodes: [{ type: "gcode-button", label: "A", template: "G28" }] },
				{ justify: "between", nodes: [{ type: "group", label: "G", nodes: [{ type: "spacer", size: 2 }, { type: "spacer" }] }] },
			],
		}],
	}));
	assert.ok(good.ok, good.ok ? "" : good.error);
	assert.match(
		(parseControlSpecText('{"nodes":[{"type":"columns"}]}') as { error: string }).error,
		/nodes\[0\]\.columns: expected an array/,
	);
	assert.match(
		(parseControlSpecText('{"nodes":[{"type":"columns","columns":[{"nodes":[]},{"weight":"2","nodes":[]}]}]}') as { error: string }).error,
		/nodes\[0\]\.columns\[1\]\.weight: expected a number/,
	);
	assert.match(
		(parseControlSpecText('{"nodes":[{"type":"columns","columns":[{"nodes":[]},{"justify":"stretch","nodes":[]}]}]}') as { error: string }).error,
		/nodes\[0\]\.columns\[1\]\.justify/,
	);
	assert.match(
		(parseControlSpecText('{"nodes":[{"type":"columns","columns":[{"nodes":[]},"x"]}]}') as { error: string }).error,
		/nodes\[0\]\.columns\[1\]: expected an object/,
	);
	assert.match(
		(parseControlSpecText('{"nodes":[{"type":"group"}]}') as { error: string }).error,
		/nodes\[0\]\.nodes: expected an array/,
	);
	assert.match(
		(parseControlSpecText('{"nodes":[{"type":"spacer","size":"4"}]}') as { error: string }).error,
		/nodes\[0\]\.size: expected a number/,
	);
	assert.match(
		(parseControlSpecText('{"nodes":[{"type":"row","justify":"sideways","items":[]}]}') as { error: string }).error,
		/nodes\[0\]\.justify/,
	);
});

test("a hostile deep-nesting file is a named error, never a throw or a card", () => {
	// 1000 nested groups. Whatever refuses it (the compile boundary's depth
	// cap), parseControlSpecText's contract is ok:false with a message — a
	// throw here would break every import surface at once.
	const deep = '{"nodes":[' + '{"type":"group","nodes":['.repeat(1000) + ']}'.repeat(1000) + "]}";
	const parsed = parseControlSpecText(deep);
	assert.ok(!parsed.ok, "a pathological nesting depth is not a card");
	assert.match((parsed as { error: string }).error, /deeper than 8/);
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
	const composition = addCard({}, cardId, store.config.cards);
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

test("readout and slider items round-trip through the form model", async () => {
	const { toSpec, tryFromSpec } = await import("../src/compose/controls/formModel.ts");
	const spec = {
		inputs: { speed: { kind: "number" as const, label: "Speed", default: 100, unit: "%" } },
		nodes: [{
			type: "row" as const,
			label: "Tuning",
			items: [
				{ type: "readout" as const, om: "heat.heaters[1].current", label: "Nozzle", unit: "°C", decimals: 1 },
				{ type: "readout" as const, om: "state.status" },
				{ type: "slider" as const, input: "speed", min: 0, max: 200, step: 5, template: "M220 S{input.speed}" },
				{ type: "slider" as const, input: "speed", min: 0, max: 200, template: "M220 S{input.speed}", stamp: false },
			],
		}],
	};
	const lifted = tryFromSpec(spec);
	assert.ok(lifted !== null, "both kinds are form-shaped");
	assert.deepEqual(toSpec(lifted!), spec, "lower(lift(spec)) is identity");
	assert.ok(parseControlSpecText(JSON.stringify(toSpec(lifted!))).ok);
});

test("toggle items round-trip through the form model", async () => {
	const { toSpec, tryFromSpec } = await import("../src/compose/controls/formModel.ts");
	const spec = {
		inputs: {},
		nodes: [{
			type: "row" as const,
			items: [
				{ type: "toggle" as const, om: "fans[0].requestedValue", label: "Part fan", whenOn: "M106 P0 S0", whenOff: "M106 P0 S1" },
				{ type: "toggle" as const, om: "state.atxPower", whenOn: "M81", whenOff: "M80", stamp: false },
			],
		}],
	};
	const lifted = tryFromSpec(spec);
	assert.ok(lifted !== null, "a toggle is form-shaped — every field has a form slot");
	assert.deepEqual(toSpec(lifted!), spec, "lower(lift(spec)) is identity");
	assert.ok(parseControlSpecText(JSON.stringify(toSpec(lifted!))).ok);
});

test("spacer items round-trip through the form model", async () => {
	const { toSpec, tryFromSpec } = await import("../src/compose/controls/formModel.ts");
	const spec = {
		inputs: {},
		nodes: [{
			type: "row" as const,
			items: [
				{ type: "gcode-button" as const, label: "A", template: "G28" },
				{ type: "spacer" as const, size: 4 },
				{ type: "spacer" as const },
				{ type: "gcode-button" as const, label: "B", template: "M84" },
			],
		}],
	};
	const lifted = tryFromSpec(spec);
	assert.ok(lifted !== null, "a spacer in a flat row is form-shaped");
	assert.deepEqual(toSpec(lifted!), spec, "lower(lift(spec)) is identity — flexible stays flexible, fixed keeps its size");
	assert.ok(parseControlSpecText(JSON.stringify(toSpec(lifted!))).ok);
});

test("columns, groups, and justified rows refuse to lift — JSON territory", async () => {
	const { tryFromSpec } = await import("../src/compose/controls/formModel.ts");
	assert.equal(tryFromSpec({
		inputs: {},
		nodes: [{ type: "columns", columns: [{ nodes: [] }, { nodes: [] }] }],
	}), null, "a column split cannot ride the form's flat rows");
	assert.equal(tryFromSpec({
		inputs: {},
		nodes: [{ type: "group", nodes: [] }],
	}), null, "a group is JSON territory");
	assert.equal(tryFromSpec({
		inputs: {},
		nodes: [{ type: "row", justify: "between", items: [] }],
	}), null, "the form has no justify field — null over silently dropping it");
});

test("a spec with a select input refuses to lift — null over approximation", async () => {
	const { tryFromSpec } = await import("../src/compose/controls/formModel.ts");
	assert.equal(tryFromSpec({
		inputs: { mode: { kind: "select", label: "Mode", default: 0, options: [{ label: "Off", value: 0 }] } },
		nodes: [{ type: "row", items: [{ input: "mode" }] }],
	}), null, "a labeled option list cannot ride the form's flat input row");
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
