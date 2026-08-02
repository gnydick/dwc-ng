import { test } from "node:test";
import assert from "node:assert/strict";
import { exportCard, exportScreen, parseShareFile, remapScreenCards, reviewSpec } from "../src/compose/share.ts";
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

// ---- screen round trip with embedded custom cards + remap ----

test("exportScreen embeds custom cards; import remaps to fresh ids", () => {
	const source = createConfigStore();
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
	const target = createConfigStore();
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
