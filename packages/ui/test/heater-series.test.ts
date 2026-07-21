import { test } from "node:test";
import assert from "node:assert/strict";
import { heaterSeries, BED_COLOR, CHAMBER_COLOR, TOOL_COLORS } from "../src/om/heaterSeries.ts";
import type { Heater, Tool } from "../src/om/types.ts";

const heater = (): Heater => ({ active: 0, standby: 0, current: 20, max: 300, state: "off" });

const tool = (number: number, name: string, heaters: number[]): Tool =>
	({ number, name, heaters, active: [], standby: [], state: "off" });

/** Gabe's toolchanger: bed on heater 0, four tools on heaters 1-4. */
const toolchanger = {
	heaters: [heater(), heater(), heater(), heater(), heater()],
	bedHeaters: [0, -1, -1],
	chamberHeaters: [-1],
	tools: [
		tool(0, "T0", [1]),
		tool(1, "T1", [2]),
		tool(2, "T2", [3]),
		tool(3, "T3", [4]),
	],
};

// --- the invariant: the bed's line is never confusable with a tool's ---

test("the bed's colour is not a member of the tool palette at all", () => {
	// Structural, not incidental: a tool cannot be given the bed's colour
	// because the palette it draws from does not contain it.
	assert.ok(!TOOL_COLORS.includes(BED_COLOR));
	assert.ok(!TOOL_COLORS.includes(CHAMBER_COLOR));
	assert.notEqual(BED_COLOR, CHAMBER_COLOR);
});

test("every series on a 4-tool toolchanger gets a distinct colour", () => {
	const series = heaterSeries(toolchanger);
	const colors = series.map(s => s.stroke);
	assert.equal(new Set(colors).size, colors.length, `duplicate colour in ${JSON.stringify(colors)}`);
});

test("the bed keeps its own colour and label", () => {
	const series = heaterSeries(toolchanger);
	assert.equal(series[0]!.label, "Bed");
	assert.equal(series[0]!.stroke, BED_COLOR);
});

test("tool colours start at the top of the palette even though the bed holds index 0", () => {
	// The regression: indexing the palette by HEATER index skipped the first
	// colour (the bed sits there) and pushed the fourth tool onto the gold that
	// collides with the bed.
	const series = heaterSeries(toolchanger);
	assert.deepEqual(series.slice(1).map(s => s.stroke), TOOL_COLORS.slice(0, 4));
});

test("a bed at a non-zero index still does not shift the tool palette", () => {
	const series = heaterSeries({
		heaters: [heater(), heater(), heater()],
		bedHeaters: [2],
		chamberHeaters: [],
		tools: [tool(0, "T0", [0]), tool(1, "T1", [1])],
	});
	assert.deepEqual(series.map(s => s.stroke), [TOOL_COLORS[0], TOOL_COLORS[1], BED_COLOR]);
});

// --- labelling ---

test("tool heaters take their tool's name", () => {
	const series = heaterSeries(toolchanger);
	assert.deepEqual(series.map(s => s.label), ["Bed", "T0", "T1", "T2", "T3"]);
});

test("an unnamed tool falls back to its number, not the heater index", () => {
	const series = heaterSeries({
		heaters: [heater(), heater()],
		bedHeaters: [0],
		chamberHeaters: [],
		tools: [tool(3, "", [1])],
	});
	assert.equal(series[1]!.label, "Tool 3");
});

test("a heater belonging to no tool is labelled by its own index", () => {
	const series = heaterSeries({
		heaters: [heater(), heater()],
		bedHeaters: [0],
		chamberHeaters: [],
		tools: [],
	});
	assert.equal(series[1]!.label, "Heater 1");
});

test("a chamber heater is named and coloured as a chamber, not as a tool", () => {
	const series = heaterSeries({
		heaters: [heater(), heater(), heater()],
		bedHeaters: [0],
		chamberHeaters: [1],
		tools: [tool(0, "T0", [2])],
	});
	assert.deepEqual(series.map(s => s.label), ["Bed", "Chamber", "T0"]);
	assert.equal(series[1]!.stroke, CHAMBER_COLOR);
	assert.equal(series[2]!.stroke, TOOL_COLORS[0]);
});

// --- shape contracts the chart depends on ---

test("there is exactly one series per heater, in heater order", () => {
	// uPlot aligns series to column index, so this mapping must stay 1:1.
	const series = heaterSeries(toolchanger);
	assert.equal(series.length, toolchanger.heaters.length);
});

test("a null heater slot still produces a series so column alignment holds", () => {
	const series = heaterSeries({
		heaters: [heater(), null, heater()],
		bedHeaters: [0],
		chamberHeaters: [],
		tools: [tool(0, "T0", [2])],
	});
	assert.equal(series.length, 3);
});

test("the sentinel -1 in bedHeaters never marks heater 0 as a bed", () => {
	const series = heaterSeries({
		heaters: [heater()],
		bedHeaters: [-1, -1],
		chamberHeaters: [-1],
		tools: [tool(0, "T0", [0])],
	});
	assert.equal(series[0]!.label, "T0");
	assert.equal(series[0]!.stroke, TOOL_COLORS[0]);
});

test("more tools than palette entries wraps rather than running out", () => {
	const many = Array.from({ length: TOOL_COLORS.length + 2 }, () => heater());
	const series = heaterSeries({
		heaters: many,
		bedHeaters: [],
		chamberHeaters: [],
		tools: many.map((_, i) => tool(i, `T${i}`, [i])),
	});
	assert.equal(series.length, many.length);
	assert.equal(series[TOOL_COLORS.length]!.stroke, TOOL_COLORS[0]);
});
