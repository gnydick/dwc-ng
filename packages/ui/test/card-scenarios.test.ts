import { test } from "node:test";
import assert from "node:assert/strict";
import { scenarioFile, scenarioModel, SCENARIOS } from "../src/dev/cardScenarios.ts";
import { capturesOf, fingerprintOf, parseResults, RESULTS_PATH } from "../src/shaping/results.ts";
import { findShapingLine, toolMacroPath } from "../src/shaping/toolMacro.ts";

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

/**
 * The shaping cards are fed by a FILE, not by the model, so the lab shows
 * nothing unless that file survives the same parse boundary a real SD card's
 * would. Without this, a scenario that quietly fails to parse looks exactly
 * like a set of cards with nothing to say.
 */
test("every scenario's shaping file parses — for every tool the lab offers", () => {
	for (const s of SCENARIOS) {
		for (const tool of [0, 1, 2, 3]) {
			const text = scenarioFile(s.id, RESULTS_PATH(tool));
			assert.ok(text !== null, `${s.id} has no file for tool ${tool}`);
			assert.ok(parseResults(text) !== null, `${s.id} tool ${tool} did not parse`);
		}
	}
	assert.equal(scenarioFile("shaping-measured", "0:/sys/config.g"), null, "only the results files are served");
});

test("shaping-measured carries the prototype session, artefact and all", () => {
	const r = parseResults(scenarioFile("shaping-measured", RESULTS_PATH(0))!);
	assert.ok(r !== null);
	// The prototype's ring1 fingerprint (tools/accel/runs/ring/ring1).
	assert.ok(Math.abs(fingerprintOf(r!)!.X!.f - 18.1) < 0.1, `X ${fingerprintOf(r!)!.X!.f}`);
	assert.ok(Math.abs(fingerprintOf(r!)!.Y!.f - 51.6) < 0.1, `Y ${fingerprintOf(r!)!.Y!.f}`);
	assert.equal(capturesOf(r!).length, 12, "six stops per axis");
	assert.ok(r!.candidates.length >= 6, "one candidate per shaper type at least");
	// The campaign's whole point: a shaper the model rated best measured worse,
	// because it excited a mode the unshaped machine does not have.
	const artefacted = r!.verified.filter(v => v.artefacts.length > 0);
	assert.equal(artefacted.length, 1, "exactly one verified entry carries an artefact");
	for (const a of artefacted[0]!.artefacts) {
		assert.ok(Math.abs(a.hz - 38) < 1, `artefact at ${a.hz} Hz, expected ~38`);
	}
	assert.ok(artefacted[0]!.measured.X! > 1, "and it left MORE ring on X than no shaper at all");
	// T0 is measured; the other three tools are present and empty.
	assert.equal(parseResults(scenarioFile("shaping-measured", RESULTS_PATH(1))!)!.measurement, null);
});

test("shaping-measured serves a tpost macro whose live M593 the reader finds", () => {
	const t0 = scenarioFile("shaping-measured", toolMacroPath(0));
	assert.ok(t0 !== null, "T0 has a post-select macro");
	// The file carries commented-out attempts above the live line, which is the
	// shape the status card and task G2's rewrite both have to survive.
	assert.match(t0!, /^;\s*M593/m, "the fixture must contain a commented-out attempt");
	assert.equal(findShapingLine(t0!), 'M593 P"ei2" F52 S0.1');
	// A tool nobody has tuned has a macro with no shaper line at all.
	assert.equal(findShapingLine(scenarioFile("shaping-measured", toolMacroPath(2))!), null);
	// Other scenarios leave the macros to the stub, so nothing else changes.
	assert.equal(scenarioFile("printing", toolMacroPath(0)), null);
});

test("each call returns an independent model (no shared mutable state)", () => {
	const a = scenarioModel("printing");
	a.state.status = "mutated";
	const b = scenarioModel("printing");
	assert.equal(b.state.status, "processing", "a later build is unaffected by mutating an earlier one");
});
