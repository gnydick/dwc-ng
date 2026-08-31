import { test } from "node:test";
import assert from "node:assert/strict";
import { describeCardMeta, exportCard, exportScreen, parseShareFile, remapScreenCards, reviewSpec } from "../src/compose/share.ts";
import { parseControlSpecText } from "../src/compose/controls/parse.ts";
import { SPINDLE_EXAMPLE_JSON } from "../src/compose/controls/examples.ts";
import { createConfigStore } from "../src/config/store.ts";
import { resolveScreen } from "../src/compose/screens.ts";
import { isCustomCardId, type CustomCardId } from "../src/compose/composition.ts";

// ---- review completeness: the closed vocabulary makes the inventory total ----

test("reviewSpec enumerates every template, om read, loop, and motion primitive", () => {
	const parsed = parseControlSpecText(JSON.stringify({
		inputs: { step: { kind: "number", label: "s", default: 1 }, feed: { kind: "number", label: "f", default: 6000 } },
		nodes: [
			{ type: "grid", items: [
				{ type: "gcode-button", label: "Home All", template: "G28" },
				{ type: "forEach", from: "move.axes[visible]", as: "axis",
					node: { type: "gcode-button", label: "Home {axis.letter}", template: "G28 {axis.letter}" } },
			] },
			{ type: "row", items: [
				{ type: "gcode-button", label: "Status", template: "M114 ;{om:state.status}" },
			] },
			{ type: "jog-pad", step: "step", feed: "feed" },
		],
	}));
	assert.ok(parsed.ok);
	const review = reviewSpec(parsed.ok ? parsed.spec : (undefined as never));
	assert.deepEqual(review.buttons.map(b => b.template), ["G28", "G28 {axis.letter}", "M114 ;{om:state.status}"]);
	assert.deepEqual(review.omReads, ["state.status"]);
	assert.deepEqual(review.loops, ["move.axes[visible]"]);
	assert.equal(review.motion.length, 1);
	assert.deepEqual(review.inputs, ["step", "feed"]);
});

test("reviewSpec inventories a slider's raw template and a readout's OM read", () => {
	const parsed = parseControlSpecText(JSON.stringify({
		inputs: { speed: { kind: "number", label: "Speed", default: 100 } },
		nodes: [
			{ type: "readout", om: "heat.heaters[1].current", label: "T {om:state.currentTool}", unit: "°C" },
			{ type: "row", items: [
				{ type: "slider", input: "speed", min: 0, max: 200, template: "M220 S{input.speed} ;{om:move.speedFactor}" },
			] },
		],
	}));
	assert.ok(parsed.ok, parsed.ok ? "" : parsed.error);
	const review = reviewSpec(parsed.ok ? parsed.spec : (undefined as never));
	assert.deepEqual(review.sliders, [
		{ input: "speed", template: "M220 S{input.speed} ;{om:move.speedFactor}", min: 0, max: 200 },
	], "the slider's raw template is in the inventory — it is an emitter");
	assert.deepEqual(
		review.omReads,
		["heat.heaters[1].current", "state.currentTool", "move.speedFactor"],
		"the readout's selector and every template read are inventoried",
	);
});

test("reviewSpec inventories BOTH of a toggle's raw templates and its OM binding", () => {
	const parsed = parseControlSpecText(JSON.stringify({
		nodes: [
			{ type: "row", items: [
				{ type: "toggle", om: "fans[0].requestedValue", label: "Fan {om:state.currentTool}",
					whenOn: "M106 P0 S0", whenOff: "M106 P0 S{om:move.speedFactor}" },
			] },
		],
	}));
	assert.ok(parsed.ok, parsed.ok ? "" : parsed.error);
	const review = reviewSpec(parsed.ok ? parsed.spec : (undefined as never));
	// A toggle is an emitter with TWO alternatives — accepting the card means
	// having seen BOTH raw templates, not just whichever the state resolves.
	assert.deepEqual(review.toggles, [
		{ om: "fans[0].requestedValue", whenOn: "M106 P0 S0", whenOff: "M106 P0 S{om:move.speedFactor}" },
	]);
	assert.deepEqual(
		review.omReads,
		["fans[0].requestedValue", "state.currentTool", "move.speedFactor"],
		"the state binding, the label read, and every template read are inventoried",
	);
});

test("reviewSpec inventories a select input's labeled options — string values reach templates verbatim", () => {
	const parsed = parseControlSpecText(JSON.stringify({
		inputs: {
			macro: { kind: "select", label: "Macro", default: "purge", options: [
				{ label: "Purge", value: "purge" }, { label: "Wipe", value: "wipe" },
			] },
			speed: { kind: "number", label: "Speed", default: 100 },
		},
		nodes: [{ type: "gcode-button", label: "Run", template: 'M98 P"/macros/{input.macro}"' }],
	}));
	assert.ok(parsed.ok, parsed.ok ? "" : parsed.error);
	const review = reviewSpec(parsed.ok ? parsed.spec : (undefined as never));
	assert.deepEqual(review.selects, [
		{ input: "macro", options: [{ label: "Purge", value: "purge" }, { label: "Wipe", value: "wipe" }] },
	], "every author-enumerated value a placeholder can become is on the review");
	assert.deepEqual(review.inputs, ["macro", "speed"], "select inputs still list among inputs");
});

test("the weld forces the walk: emitters inside columns and groups are inventoried", () => {
	const parsed = parseControlSpecText(JSON.stringify({
		inputs: { speed: { kind: "number", label: "Speed", default: 100 } },
		nodes: [{
			type: "columns",
			rulers: true,
			columns: [
				{ weight: 2, nodes: [
					{ type: "group", label: "Grp {om:state.status}", nodes: [
						{ type: "gcode-button", label: "Deep", template: "G28 X" },
						{ type: "spacer", size: 2 },
					] },
				] },
				{ nodes: [
					{ type: "slider", input: "speed", min: 0, max: 200, template: "M220 S{input.speed}" },
					{ type: "toggle", om: "fans[0].requestedValue", whenOn: "M106 P0 S0", whenOff: "M106 P0 S1" },
				] },
			],
		}],
	}));
	assert.ok(parsed.ok, parsed.ok ? "" : parsed.error);
	const review = reviewSpec(parsed.ok ? parsed.spec : (undefined as never));
	assert.deepEqual(review.buttons, [{ label: "Deep", template: "G28 X" }], "a button nested two structural levels down is still on the review");
	assert.deepEqual(review.sliders, [{ input: "speed", template: "M220 S{input.speed}", min: 0, max: 200 }]);
	assert.deepEqual(review.toggles, [{ om: "fans[0].requestedValue", whenOn: "M106 P0 S0", whenOff: "M106 P0 S1" }]);
	assert.ok(review.omReads.includes("state.status"), "a group label's {om:} read joins the Reads inventory");
});

test("a row label's {om:} reads join the Reads inventory (found: were silently absent)", () => {
	const parsed = parseControlSpecText(JSON.stringify({
		nodes: [{ type: "row", label: "Status {om:state.status}", sub: "{om:state.machineMode}", items: [] }],
	}));
	assert.ok(parsed.ok, parsed.ok ? "" : parsed.error);
	const review = reviewSpec(parsed.ok ? parsed.spec : (undefined as never));
	assert.ok(review.omReads.includes("state.status"), "row label reads are inventoried");
	assert.ok(review.omReads.includes("state.machineMode"), "row sub reads are inventoried");
});

// ---- card round trip ----

test("exportCard → parseShareFile round-trips with a complete review", () => {
	const file = exportCard("Spindle", SPINDLE_EXAMPLE_JSON);
	assert.ok(file !== null);
	assert.equal(file!.fileName, "spindle.dwcng-card.json");
	const parsed = parseShareFile(file!.text);
	assert.equal(parsed.kind, "card");
	if (parsed.kind !== "card") return;
	assert.equal(parsed.name, "Spindle");
	assert.deepEqual(parsed.review.buttons.map(b => b.template), ["M3 S{input.rpm}", "M4 S{input.rpm}", "M5"]);
	// the normalized spec text passes the one boundary
	assert.ok(parseControlSpecText(parsed.specText).ok);
});

test("a card whose stored spec no longer parses refuses to export", () => {
	assert.equal(exportCard("Broken", "not json"), null);
});

// ---- chrome metadata travels the share file (#194 inc 4, spec §7) ----

const META = { colSpan: 120, rowSpan: 48, tip: "state.status · M300", padding: 6 };

test("exportCard embeds the chrome metadata beside the spec, and import returns it through the one gate", () => {
	const file = exportCard("Meta", SPINDLE_EXAMPLE_JSON, META);
	assert.ok(file !== null);
	// Beside the spec, never inside it: the fields sit on the card object.
	const raw = JSON.parse(file!.text) as { card: Record<string, unknown> };
	assert.equal(raw.card.colSpan, 120);
	assert.equal(raw.card.tip, META.tip);
	assert.equal((raw.card.spec as Record<string, unknown>).colSpan, undefined, "metadata does not ride the spec JSON");

	const parsed = parseShareFile(file!.text);
	assert.equal(parsed.kind, "card");
	if (parsed.kind !== "card") return;
	assert.deepEqual(parsed.meta, META, "ready for addCustomCard's meta argument");
});

test("a card exported without metadata imports with empty meta (old files read identically)", () => {
	const file = exportCard("Plain", SPINDLE_EXAMPLE_JSON);
	assert.ok(file !== null);
	const parsed = parseShareFile(file!.text);
	assert.equal(parsed.kind, "card");
	if (parsed.kind !== "card") return;
	assert.deepEqual(parsed.meta, {});
});

test("a foreign file's bad metadata drops FIELD BY FIELD, never the card", () => {
	const text = JSON.stringify({
		dwcng: "card", version: 1,
		card: { name: "Hostile", spec: JSON.parse(SPINDLE_EXAMPLE_JSON), colSpan: "wide", rowSpan: 48, tip: "   ", padding: -1 },
	});
	const parsed = parseShareFile(text);
	assert.equal(parsed.kind, "card");
	if (parsed.kind !== "card") return;
	assert.deepEqual(parsed.meta, { rowSpan: 48 }, "the one valid field survives; each bad one drops itself");
});

test("describeCardMeta is the review's total rendering: every present field, one line each", () => {
	assert.deepEqual(describeCardMeta({}), [], "no metadata, no lines — the section stays absent");
	assert.deepEqual(describeCardMeta(META), [
		"default width 120 cells",
		"default height 48 cells",
		`tip "${META.tip}"`,
		"body padding 6u",
	]);
	assert.deepEqual(describeCardMeta({ padding: 0 }), ["body padding 0u"], "zero padding is a choice, not absence");
});

test("exportScreen embeds each custom card's metadata with its definition", () => {
	const source = createConfigStore({ machineStore: () => null });
	const cardId = source.addCustomCard("Meta", SPINDLE_EXAMPLE_JSON, META) as CustomCardId;
	const screenId = source.addScreen("Meta screen");
	source.replaceAllScreenCards(screenId, { [cardId]: { col: 0, row: 0, colSpan: 120, rowSpan: 48 } });
	const entry = resolveScreen(source.config, screenId)!;
	const parsed = parseShareFile(exportScreen(entry, source.config).text);
	assert.equal(parsed.kind, "screen");
	if (parsed.kind !== "screen") return;
	assert.deepEqual(parsed.customCards[0]!.meta, META);
});

// ---- screen round trip with embedded custom cards + remap ----

test("exportScreen embeds custom cards; import remaps to fresh ids", () => {
	const source = createConfigStore({ machineStore: () => null });
	const cardId = source.addCustomCard("Spindle", SPINDLE_EXAMPLE_JSON) as CustomCardId;
	const screenId = source.addScreen("CNC");
	source.replaceAllScreenCards(screenId, {
		[cardId]: { col: 0, row: 0, colSpan: 12, rowSpan: 40 },
		homing: { col: 12, row: 0, colSpan: 12, rowSpan: 51 },
	});
	const entry = resolveScreen(source.config, screenId)!;
	const file = exportScreen(entry, source.config);
	assert.equal(file.fileName, "cnc.dwcng-screen.json");

	const parsed = parseShareFile(file.text);
	assert.equal(parsed.kind, "screen");
	if (parsed.kind !== "screen") return;
	assert.equal(parsed.name, "CNC");
	assert.equal(parsed.customCards.length, 1);
	assert.deepEqual(parsed.customCards[0]!.review.buttons.map(b => b.template), ["M3 S{input.rpm}", "M4 S{input.rpm}", "M5"]);
	assert.deepEqual(parsed.registryCards, ["Homing"]);

	// Commit on a DIFFERENT install: fresh ids, remapped slots, working screen.
	const target = createConfigStore({ machineStore: () => null });
	const idMap = new Map<string, string>();
	for (const card of parsed.customCards) idMap.set(card.fileId, target.addCustomCard(card.name, card.specText));
	const newScreen = target.addScreen(parsed.name);
	target.replaceAllScreenCards(newScreen, remapScreenCards(parsed.cards, idMap));
	const imported = resolveScreen(target.config, newScreen)!;
	const keys = Object.keys(imported.def.composition);
	assert.equal(keys.length, 2);
	assert.ok(keys.includes("homing"), "registry slots travel by stable id");
	const mintedKey = keys.filter(isCustomCardId)[0]!;
	assert.notEqual(mintedKey, cardId, "foreign ids never adopted — fresh mint");
	assert.equal(target.config.cards[mintedKey]!.name, "Spindle");
});

// ---- hostile files ----

test("hostile and malformed files are named errors, never imports", () => {
	assert.equal(parseShareFile("not json").kind, "error");
	assert.equal(parseShareFile("{}").kind, "error");
	assert.equal(parseShareFile('{"dwcng":"plugin","code":"evil()"}').kind, "error");
	const badSpec = parseShareFile(JSON.stringify({
		dwcng: "card", version: 1,
		card: { name: "X", spec: { nodes: [{ type: "script", src: "evil" }] } },
	}));
	assert.equal(badSpec.kind, "error");
	assert.match((badSpec as { error: string }).error, /unknown control type/);
	// a screen embedding a bad card fails whole, by name
	const badEmbed = parseShareFile(JSON.stringify({
		dwcng: "screen", version: 1,
		screen: { name: "S", cards: { "c-x": { col: 0, row: 0, colSpan: 4, rowSpan: 4 } } },
		customCards: { "c-x": { name: "Bad", spec: { nodes: [{ type: "forEach", from: "a[b()]", as: "x", node: { type: "gcode-button", label: "x", template: "G4" } }] } } },
	}));
	assert.equal(badEmbed.kind, "error");
	assert.match((badEmbed as { error: string }).error, /invalid selector/);
});

test("dangling custom slots are surfaced and dropped, not imported blind", () => {
	const parsed = parseShareFile(JSON.stringify({
		dwcng: "screen", version: 1,
		screen: { name: "S", cards: {
			homing: { col: 0, row: 0, colSpan: 12, rowSpan: 51 },
			"c-ghost": { col: 12, row: 0, colSpan: 12, rowSpan: 40 },
		} },
		customCards: {},
	}));
	assert.equal(parsed.kind, "screen");
	if (parsed.kind !== "screen") return;
	assert.deepEqual(parsed.dangling, ["c-ghost"]);
	assert.deepEqual(Object.keys(parsed.cards), ["homing"]);
});
