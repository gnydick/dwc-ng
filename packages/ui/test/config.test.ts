import { test } from "node:test";
import assert from "node:assert/strict";
import { createConfigStore } from "../src/config/store.ts";
import { DEFAULT_CONFIG } from "../src/config/types.ts";
import { createMockServer } from "../../mock-duet/src/server.ts";
import { PollConnector } from "../src/connector/PollConnector.ts";

test("empty overlay means pure defaults", () => {
	const store = createConfigStore();
	assert.deepEqual(store.config, DEFAULT_CONFIG);
	assert.equal(store.dirty, false);
});

test("edits land in the effective config and mark it dirty", () => {
	const store = createConfigStore();
	store.setAxisRole("U", "Z motor 1");
	store.setDockSensor(0, { gpIn: 4 });
	store.setCamera({ streamUrl: "http://printercams:8080/stream" });

	assert.equal(store.config.axisRoles["U"], "Z motor 1");
	assert.deepEqual(store.config.dockSensors["0"], { gpIn: 4 });
	assert.equal(store.config.camera.streamUrl, "http://printercams:8080/stream");
	assert.equal(store.config.camera.pinned, false, "untouched fields stay default");
	assert.equal(store.dirty, true);
});

test("resetSection drops one section only; resetAll drops everything", () => {
	const store = createConfigStore();
	store.setAxisRole("U", "Z motor 1");
	store.setDockSensor(1, { gpIn: 5, inverted: true });

	store.resetSection("axisRoles");
	assert.deepEqual(store.config.axisRoles, {}, "section back to defaults");
	assert.deepEqual(store.config.dockSensors["1"], { gpIn: 5, inverted: true }, "other sections kept");

	store.resetAll();
	assert.deepEqual(store.config, DEFAULT_CONFIG);
});

test("clearing the last key of a section equals never touching it", () => {
	const store = createConfigStore();
	store.setAxisRole("C", "Tool coupler");
	store.clearAxisRole("C");
	assert.deepEqual(store.config, DEFAULT_CONFIG);
});

test("snapshot and revert restore an earlier overlay", () => {
	const store = createConfigStore();
	store.setAxisRole("U", "Z motor 1");
	store.snapshot("before experiment");

	store.setAxisRole("U", "something wrong");
	store.setCamera({ pinned: true });
	assert.equal(store.config.axisRoles["U"], "something wrong");

	store.revert(0);
	assert.equal(store.config.axisRoles["U"], "Z motor 1");
	assert.equal(store.config.camera.pinned, false);
	assert.equal(store.snapshots.length, 1, "reverting keeps the snapshot");
});

test("snapshot history is capped", () => {
	const store = createConfigStore();
	for (let i = 0; i < 14; i++) {
		store.setAxisRole("X", `role ${i}`);
		store.snapshot(`snap ${i}`);
	}
	assert.equal(store.snapshots.length, 10);
	assert.equal(store.snapshots[0]!.label, "snap 4", "oldest snapshots dropped");
});

test("save/load round-trip through the machine's SD card", async () => {
	const mock = createMockServer({ tickMs: 0 });
	const port = await mock.listen(0);
	const connector = new PollConnector({ baseUrl: `http://127.0.0.1:${port}`, autoPoll: false, retryDelayMs: 10 });
	try {
		await connector.connect();

		const store = createConfigStore();
		store.setAxisRole("U", "Z motor 1");
		store.setDockSensor(0, { gpIn: 4 });
		await store.saveToMachine(connector);
		assert.equal(store.dirty, false);
		assert.equal(store.snapshots.at(-1)!.label, "saved", "every save snapshots first");

		// A different session (fresh store) sees the same config
		const other = createConfigStore();
		await other.loadFromMachine(connector);
		assert.equal(other.config.axisRoles["U"], "Z motor 1");
		assert.deepEqual(other.config.dockSensors["0"], { gpIn: 4 });
		assert.equal(other.dirty, false);
	} finally {
		await connector.disconnect().catch(() => undefined);
		await mock.close();
	}
});

test("loading from a machine with no config file yields defaults", async () => {
	const mock = createMockServer({ tickMs: 0 });
	const port = await mock.listen(0);
	const connector = new PollConnector({ baseUrl: `http://127.0.0.1:${port}`, autoPoll: false, retryDelayMs: 10 });
	try {
		await connector.connect();
		// The mock seeds a config for the machine it emulates; a truly blank
		// machine has none, so remove it to exercise the no-file path.
		mock.machine.sd.delete("0:/sys/dwc-ng-config.json", false);
		const store = createConfigStore();
		await store.loadFromMachine(connector); // no file on SD → not an error
		assert.deepEqual(store.config, DEFAULT_CONFIG);
	} finally {
		await connector.disconnect().catch(() => undefined);
		await mock.close();
	}
});

test("a corrupt config file falls back to defaults instead of failing boot", async () => {
	const mock = createMockServer({ tickMs: 0 });
	const port = await mock.listen(0);
	const connector = new PollConnector({ baseUrl: `http://127.0.0.1:${port}`, autoPoll: false, retryDelayMs: 10 });
	try {
		await connector.connect();
		await connector.upload("0:/sys/dwc-ng-config.json", "{not json at all");
		const store = createConfigStore();
		await store.loadFromMachine(connector);
		assert.deepEqual(store.config, DEFAULT_CONFIG);
	} finally {
		await connector.disconnect().catch(() => undefined);
		await mock.close();
	}
});
