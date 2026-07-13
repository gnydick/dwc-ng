import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCaptureFile, loadCaptureModel } from "../src/capture.ts";
import { Machine } from "../src/machine.ts";
import { POLLED_KEYS, AMBIENT } from "../src/snapshot.ts";
import { startMock, fetchStitched } from "./helpers.ts";

// The real capture from Gabe's toolchanger (SBC mode, GET /machine/model).
const CAPTURE = new URL("../captures/om-snapshot-2026-07-12.json", import.meta.url);

test("capture loads: polled keys replaced, non-standalone keys dropped", () => {
	const model = loadCaptureFile(CAPTURE);

	// Real machine facts survive the load
	assert.equal(model.tools.length, 4);
	assert.deepEqual(
		model.move.axes.map((a: any) => a.letter),
		["X", "Y", "Z", "U", "V", "W", "C"],
	);
	assert.equal(model.boards.length, 6);
	assert.equal(model.volumes.length, 2);
	assert.equal(model.heat.heaters.length, 5);

	// Standalone RRF never serves these — they must not leak from an SBC capture
	assert.ok(!("sbc" in model), "sbc key must be dropped");
	assert.ok(!("plugins" in model), "plugins key must be dropped");
	assert.deepEqual(model.messages, [], "messages stays the base empty list");
	assert.ok(!("seqs" in model), "seqs is wire-protocol state, never model state");
});

test("capture load is non-destructive for missing keys", () => {
	// A partial capture (only heat) keeps every other base subtree intact
	const model = loadCaptureModel({ heat: { bedHeaters: [0], heaters: [] } });
	assert.deepEqual(model.heat.heaters, []);
	assert.ok(model.move.axes.length >= 3, "base move subtree kept");
	assert.ok(model.state.status === "idle", "base state kept");
});

test("machine on a captured model: seqs synthesized, sim stays sane", () => {
	const machine = new Machine(undefined, loadCaptureFile(CAPTURE));

	// seqs never comes from the capture — the machine owns every counter
	for (const key of POLLED_KEYS) {
		assert.equal(machine.seqs[key], 1, `seqs.${key} initialized`);
	}
	assert.equal(machine.volSeqs.length, 2, "one volChanges counter per volume");

	// The captured bed sits at state "active" with target 0: it must idle at
	// ambient, not "heat" toward 0°C
	const bed = machine.om.heat.heaters[0];
	assert.equal(bed.state, "active");
	assert.equal(bed.active, 0);
	for (let i = 0; i < 60; i++) machine.advance(1000);
	assert.ok(
		bed.current > AMBIENT - 2,
		`bed stays near ambient (got ${bed.current.toFixed(1)}°C)`,
	);
	assert.equal(machine.om.state.upTime, 60);
});

test("firmware reset restores the captured model, not the synthetic base", () => {
	const machine = new Machine(undefined, loadCaptureFile(CAPTURE));
	machine.om.move.axes[0].homed = true;
	machine.reset();
	assert.equal(machine.om.move.axes.length, 7, "captured axes survive M999");
	assert.equal(machine.om.move.axes[0].homed, false, "runtime state reverted");
});

test("rr_model serves the captured toolchanger over the standalone protocol", async () => {
	const mock = await startMock({ model: loadCaptureFile(CAPTURE) });
	try {
		const key = await mock.connect();

		const axes = await fetchStitched(mock, key, "move.axes", "d99vno");
		assert.deepEqual(
			axes.map((a: any) => a.letter),
			["X", "Y", "Z", "U", "V", "W", "C"],
		);

		const seqs = await mock.getJson("rr_model?key=seqs", key);
		for (const k of ["move", "heat", "tools", "state"]) {
			assert.equal(typeof seqs.result[k], "number", `seqs.${k} served`);
		}
		assert.deepEqual(seqs.result.volChanges, [0, 0]);

		const tools = await fetchStitched(mock, key, "tools", "d99vno");
		assert.equal(tools.length, 4);
		assert.deepEqual(tools.map((t: any) => t.state), ["standby", "standby", "off", "off"]);

		// Live projection must survive boards without a 12V rail (TOOL1LC
		// reports v12: null) — regression for a crash found on first live run
		const live = await mock.getJson("rr_model?flags=d99fn", key);
		const boards = live.result.boards;
		assert.equal(boards.length, 6);
		assert.equal(boards[0].v12.current, 12.2, "MB6HC reports its 12V rail");
		assert.equal(boards[2].v12, null, "TOOL1LC has none — null, not a fake reading");
	} finally {
		await mock.close();
	}
});
