/**
 * The sole OM → display-text derivation for move.currentMove.
 *
 * I-A: no unvalidated number reaches a rendered speed string. conform is NOT
 * the OM's single entry — store.ts:89 routes live d99fn patches straight into
 * deepMergeInto — so speedRow parses its inputs rather than trusting the
 * declared type.
 * I-B: the row is always exactly three cells, so the footer cannot reflow.
 * I-D: absent ("—") and zero ("0.0") are different renderings.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { numberOrNull, speedRow } from "../src/om/speeds.ts";
import { emptyModel, type ObjectModel } from "../src/om/types.ts";

/** A model with one tool selected, feeding extruder 0 at 1.75 mm. */
function modelWith(currentMove: unknown): ObjectModel {
	const m = emptyModel();
	m.move.extruders = [{ filamentDiameter: 1.75, filament: "PLA" }];
	m.tools = [{ number: 0, name: "T0", heaters: [1], filamentExtruder: 0, active: [210], standby: [0], state: "active" }];
	m.state.currentTool = 0;
	(m.move as unknown as Record<string, unknown>).currentMove = currentMove;
	return m;
}

test("numberOrNull parses, it does not trust", () => {
	assert.equal(numberOrNull(12.5), 12.5);
	assert.equal(numberOrNull(0), 0);
	assert.equal(numberOrNull("fast"), null);
	assert.equal(numberOrNull(null), null);
	assert.equal(numberOrNull(undefined), null);
	assert.equal(numberOrNull(NaN), null);
	assert.equal(numberOrNull(Infinity), null);
	assert.equal(numberOrNull({}), null);
});

test("the row is always exactly three cells (I-B)", () => {
	const cases: unknown[] = [
		{ requestedSpeed: 120, topSpeed: 87.4, extrusionRate: 3.2 },
		{ requestedSpeed: null, topSpeed: null, extrusionRate: null },
		"garbage",
		undefined,
		{},
	];
	for (const c of cases) {
		assert.equal(speedRow(modelWith(c), "linear").length, 3, `three cells for ${JSON.stringify(c)}`);
		assert.equal(speedRow(modelWith(c), "volumetric").length, 3);
	}
});

test("numbers render at one decimal place, with the right labels", () => {
	const row = speedRow(modelWith({ requestedSpeed: 120, topSpeed: 87.44, extrusionRate: 3.2 }), "linear");
	assert.deepEqual(row.map(c => c.key), ["requested", "actual", "flow"]);
	assert.deepEqual(row.map(c => c.label), ["Requested", "Actual", "Extrusion"]);
	assert.deepEqual(row.map(c => c.value), ["120.0", "87.4", "3.2"]);
	assert.deepEqual(row.map(c => c.unit), ["mm/s", "mm/s", "mm/s"]);
});

test("absent renders as an em-dash, zero renders as 0.0 (I-D)", () => {
	const absent = speedRow(modelWith({}), "linear");
	assert.deepEqual(absent.map(c => c.value), ["—", "—", "—"]);
	const stopped = speedRow(modelWith({ requestedSpeed: 0, topSpeed: 0, extrusionRate: 0 }), "linear");
	assert.deepEqual(stopped.map(c => c.value), ["0.0", "0.0", "0.0"]);
});

test("a string from the wire renders as an em-dash, never throws (I-A)", () => {
	const row = speedRow(modelWith({ requestedSpeed: "fast", topSpeed: 87.4, extrusionRate: 3.2 }), "linear");
	assert.equal(row[0].value, "—");
	assert.equal(row[1].value, "87.4", "the neighbouring good value still renders");
});

test("volumetric flow is derived from extrusionRate and filament area (I-C)", () => {
	const row = speedRow(modelWith({ requestedSpeed: 120, topSpeed: 87.4, extrusionRate: 3.2 }), "volumetric");
	// area = pi * (1.75/2)^2 = 2.40528... mm^2; 2.40528 * 3.2 = 7.6969... mm^3/s
	assert.equal(row[2].label, "Flow");
	assert.equal(row[2].unit, "mm³/s");
	assert.equal(row[2].value, "7.7");
	assert.deepEqual(row.slice(0, 2).map(c => c.unit), ["mm/s", "mm/s"], "only cell 3 changes unit");
});

test("volumetric with no usable filament diameter shows a dash, not the linear number", () => {
	const noTool = modelWith({ requestedSpeed: 120, topSpeed: 87.4, extrusionRate: 3.2 });
	noTool.state.currentTool = -1;
	assert.equal(speedRow(noTool, "volumetric")[2].value, "—");

	const noExtruder = modelWith({ requestedSpeed: 120, topSpeed: 87.4, extrusionRate: 3.2 });
	noExtruder.tools[0] = { ...noExtruder.tools[0]!, filamentExtruder: -1 };
	assert.equal(speedRow(noExtruder, "volumetric")[2].value, "—");

	const zeroDiameter = modelWith({ requestedSpeed: 120, topSpeed: 87.4, extrusionRate: 3.2 });
	zeroDiameter.move.extruders = [{ filamentDiameter: 0, filament: "" }];
	assert.equal(speedRow(zeroDiameter, "volumetric")[2].value, "—");
});

test("every cell names its OM source for the title attribute", () => {
	const row = speedRow(modelWith({ requestedSpeed: 120, topSpeed: 87.4, extrusionRate: 3.2 }), "linear");
	assert.deepEqual(row.map(c => c.source), [
		"move.currentMove.requestedSpeed",
		"move.currentMove.topSpeed",
		"move.currentMove.extrusionRate",
	]);
});
