import { test } from "node:test";
import assert from "node:assert/strict";
import { heaterSeries, BED_COLOR, CHAMBER_COLOR, TOOL_COLORS, BED_COLOR_LIGHT, CHAMBER_COLOR_LIGHT, TOOL_COLORS_LIGHT } from "../src/om/heaterSeries.ts";
import { deltaE, contrastRatio, MIN_SEPARATION } from "../src/util/colorDistance.ts";

/** --mask-700 in theme-vellum.css: the card the chart is drawn on. */
const VELLUM_CARD = "#f2f5f9";

/**
 * The chart's real requirement is not "each series has a colour" — it is "no
 * operator can mistake one line for another". That is a perceptual property, so
 * it is asserted perceptually here rather than left to whoever next edits the
 * hex values.
 *
 * Regression this pins: the bed's gold and a tool's gold once measured ΔE 9.4
 * apart and were indistinguishable on screen.
 *
 * The ΔE arithmetic used to be duplicated in this file. It now comes from
 * src/util/colorDistance.ts, which the colour picker's collision warning also
 * imports — a second copy here could drift and let the UI bless a pair this
 * test rejects.
 */

test("every pair of heater colours is perceptually distinct", () => {
	const palette: [string, string][] = [
		["Bed", BED_COLOR],
		["Chamber", CHAMBER_COLOR],
		...TOOL_COLORS.map((c, i): [string, string] => [`tool${i}`, c]),
	];
	for (let i = 0; i < palette.length; i++) {
		for (let j = i + 1; j < palette.length; j++) {
			const [nameA, colorA] = palette[i]!;
			const [nameB, colorB] = palette[j]!;
			const separation = deltaE(colorA, colorB);
			assert.ok(
				separation >= MIN_SEPARATION,
				`${nameA} (${colorA}) and ${nameB} (${colorB}) are only ΔE ${separation.toFixed(1)} apart — need ${MIN_SEPARATION}`,
			);
		}
	}
});

test("the measurement can fail — the old bed/tool gold pair is caught", () => {
	// Red-check: proves MIN_SEPARATION is doing work rather than passing vacuously.
	assert.ok(deltaE("#c9a227", "#e0b84a") < MIN_SEPARATION);
});

test("no tool colour duplicates another", () => {
	assert.equal(new Set(TOOL_COLORS).size, TOOL_COLORS.length);
});

// --- the light ground (theme "vellum") gets its own solved palette ---

test("contrastRatio is WCAG: black on white is 21, a colour against itself is 1", () => {
	assert.ok(Math.abs(contrastRatio("#000000", "#ffffff") - 21) < 0.01);
	assert.ok(Math.abs(contrastRatio("#c9a227", "#c9a227") - 1) < 0.0001);
	// Red-check: the dark-ground tool palette really is illegible on the vellum card.
	assert.ok(contrastRatio(TOOL_COLORS[0]!, VELLUM_CARD) < 3);
});

test("every pair of LIGHT-ground heater colours is perceptually distinct", () => {
	const palette: [string, string][] = [
		["Bed", BED_COLOR_LIGHT],
		["Chamber", CHAMBER_COLOR_LIGHT],
		...TOOL_COLORS_LIGHT.map((c, i): [string, string] => [`tool${i}`, c]),
	];
	assert.equal(TOOL_COLORS_LIGHT.length, TOOL_COLORS.length);
	for (let i = 0; i < palette.length; i++) {
		for (let j = i + 1; j < palette.length; j++) {
			const [nameA, colorA] = palette[i]!;
			const [nameB, colorB] = palette[j]!;
			const separation = deltaE(colorA, colorB);
			assert.ok(separation >= MIN_SEPARATION, `${nameA} (${colorA}) and ${nameB} (${colorB}) are only ΔE ${separation.toFixed(1)} apart — need ${MIN_SEPARATION}`);
		}
	}
});

test("every LIGHT-ground line clears 3:1 against the vellum card (WCAG graphics floor)", () => {
	for (const c of [BED_COLOR_LIGHT, CHAMBER_COLOR_LIGHT, ...TOOL_COLORS_LIGHT]) {
		const ratio = contrastRatio(c, VELLUM_CARD);
		assert.ok(ratio >= 3, `${c} is ${ratio.toFixed(2)}:1 on ${VELLUM_CARD}`);
	}
});

test("the bed and chamber stay outside the light tool palette too", () => {
	assert.ok(!TOOL_COLORS_LIGHT.includes(BED_COLOR_LIGHT));
	assert.ok(!TOOL_COLORS_LIGHT.includes(CHAMBER_COLOR_LIGHT));
});

test("heaterSeries paints from the light palette when asked for the light ground", () => {
	const heater = () => ({ active: 0, standby: 0, current: 20, max: 300, state: "off" as const });
	const model = {
		heaters: [heater(), heater(), heater()],
		bedHeaters: [0],
		chamberHeaters: [2],
		tools: [{ number: 0, name: "T0", heaters: [1], filamentExtruder: -1, active: [], standby: [], state: "off" as const }],
	};
	assert.deepEqual(heaterSeries(model, {}, "light").map(s => s.stroke), [BED_COLOR_LIGHT, TOOL_COLORS_LIGHT[0], CHAMBER_COLOR_LIGHT]);
	assert.deepEqual(heaterSeries(model, {}, "dark").map(s => s.stroke), [BED_COLOR, TOOL_COLORS[0], CHAMBER_COLOR]);
		// A user override wins on either ground.
	assert.equal(heaterSeries(model, { "1": "#123456" }, "light")[1]!.stroke, "#123456");
});
