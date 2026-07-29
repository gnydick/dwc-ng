import { test } from "node:test";
import assert from "node:assert/strict";
import { BED_COLOR, CHAMBER_COLOR, TOOL_COLORS } from "../src/om/heaterSeries.ts";
import { deltaE, MIN_SEPARATION } from "../src/util/colorDistance.ts";

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
