import { test } from "node:test";
import assert from "node:assert/strict";
import { scenarioModel, SCENARIOS } from "../src/dev/cardScenarios.ts";

test("every listed scenario builds a model", () => {
	for (const s of SCENARIOS) {
		const model = scenarioModel(s.id);
		assert.ok(model.state && model.move && model.heat && model.job, `${s.id} is a full model`);
	}
});

test("idle: no job on the machine", () => {
	const m = scenarioModel("idle");
	assert.equal(m.state.status, "idle");
	assert.equal(m.job.file, null);
});

test("printing: a job is running with three DISTINCT time estimates", () => {
	const m = scenarioModel("printing");
	assert.equal(m.state.status, "processing");
	assert.ok(m.job.file, "has a job file");
	const { filament, file, slicer } = m.job.timesLeft;
	assert.ok(filament !== null && file !== null && slicer !== null, "all three sources present");
	// The whole point of the breakdown is that the sources diverge.
	assert.equal(new Set([filament, file, slicer]).size, 3, "estimates are distinct");
});

test("paused: same job shape, paused status", () => {
	const m = scenarioModel("paused");
	assert.equal(m.state.status, "paused");
	assert.ok(m.job.file);
});

test("heater-fault: nozzle 1 is latched in fault (so the M562 reset shows)", () => {
	const m = scenarioModel("heater-fault");
	assert.equal(m.heat.heaters[1]?.state, "fault");
});

test("multi-tool: four tools, T2 active", () => {
	const m = scenarioModel("multi-tool");
	assert.equal(m.tools.filter(Boolean).length, 4);
	assert.equal(m.state.currentTool, 2);
	assert.equal(m.tools[2]?.state, "active");
});

test("each call returns an independent model (no shared mutable state)", () => {
	const a = scenarioModel("printing");
	a.state.status = "mutated";
	const b = scenarioModel("printing");
	assert.equal(b.state.status, "processing", "a later build is unaffected by mutating an earlier one");
});
