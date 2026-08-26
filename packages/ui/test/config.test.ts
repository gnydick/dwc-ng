import { test } from "node:test";
import assert from "node:assert/strict";
import { createConfigStore } from "../src/config/store.ts";
import { CONFIG_FILE, DEFAULT_CONFIG, MAX_LABEL_LEN } from "../src/config/types.ts";
import { openMachineStore } from "../src/config/machineStore.ts";
import { createMockServer } from "../../mock-duet/src/server.ts";
import { PollConnector } from "@dwc-ng/connector/testing";

test("empty overlay means pure defaults", () => {
	const store = createConfigStore({ machineStore: () => null });
	assert.deepEqual(store.config, DEFAULT_CONFIG);
	assert.equal(store.dirty, false);
});

test("edits land in the effective config and mark it dirty", () => {
	const store = createConfigStore({ machineStore: () => null });
	store.setAxisRole("U", "Z motor 1");
	store.setDockSensor(0, { gpIn: 4 });
	store.setCamera({ streamUrl: "http://printercams:8080/stream" });

	assert.equal(store.config.axisRoles["U"], "Z motor 1");
	assert.deepEqual(store.config.dockSensors["0"], { gpIn: 4 });
	assert.equal(store.config.camera.streamUrl, "http://printercams:8080/stream");
	assert.equal(store.config.cameraPrefs.pinned, false, "untouched fields stay default");
	assert.equal(store.dirty, true);
});

test("resetSection(\"camera\") drops only the machine's streamUrl — the person's pin stands", () => {
	// camera (streamUrl) is machine-scoped; cameraPrefs (pinned) is person-
	// scoped. A machine-section reset must not reach into the person half —
	// that is exactly the boundary the whole split exists to hold.
	const store = createConfigStore({ machineStore: () => null });
	store.setCamera({ streamUrl: "http://printercams:8080/stream" });
	store.setCameraPrefs({ pinned: true });

	store.resetSection("camera");

	assert.equal(store.config.camera.streamUrl, "", "camera section reverted to default");
	assert.equal(store.config.cameraPrefs.pinned, true, "the pin is untouched by a machine-section reset");
});

test("resetSection drops one section only; resetAll drops everything", () => {
	const store = createConfigStore({ machineStore: () => null });
	store.setAxisRole("U", "Z motor 1");
	store.setDockSensor(1, { gpIn: 5, inverted: true });
	store.setSensorName("probe:0", "BLTouch");

	store.resetSection("axisRoles");
	assert.deepEqual(store.config.axisRoles, {}, "section back to defaults");
	assert.deepEqual(store.config.dockSensors["1"], { gpIn: 5, inverted: true }, "other sections kept");
	assert.equal(store.config.sensorNames["probe:0"], "BLTouch", "other sections kept");

	store.resetAll();
	assert.deepEqual(store.config, DEFAULT_CONFIG);
});

test("clearing the last key of a section equals never touching it", () => {
	const store = createConfigStore({ machineStore: () => null });
	store.setAxisRole("C", "Tool coupler");
	store.clearAxisRole("C");
	assert.deepEqual(store.config, DEFAULT_CONFIG);
});

test("sensor names: set/clear round-trip, other names untouched", () => {
	const store = createConfigStore({ machineStore: () => null });
	store.setSensorName("endstop:0", "Bed leveling switch");
	store.setSensorName("probe:0", "BLTouch");
	assert.equal(store.config.sensorNames["endstop:0"], "Bed leveling switch");
	assert.equal(store.config.sensorNames["probe:0"], "BLTouch");

	store.clearSensorName("endstop:0");
	assert.equal(store.config.sensorNames["endstop:0"], undefined);
	assert.equal(store.config.sensorNames["probe:0"], "BLTouch", "clearing one name doesn't touch others");

	store.clearSensorName("probe:0");
	assert.deepEqual(store.config, DEFAULT_CONFIG, "clearing the last name equals never touching it");
});

test("snapshot and revert restore an earlier overlay", () => {
	// axisRoles is machine-scoped (Ruling 17: a snapshot's machine half lives
	// behind whichever machine took it, never in the person cache alone) — an
	// identified machine is what makes it attributable and so restorable on
	// revert. See test/config-cache-scope.test.ts for the cross-machine case.
	const ls = new MemStore();
	(globalThis as { localStorage?: unknown }).localStorage = ls;
	try {
		const machine = openMachineStore({ kind: "board", uniqueId: "snap-revert" });
		const store = createConfigStore({ machineStore: () => machine });
		store.setAxisRole("U", "Z motor 1");
		store.snapshot("before experiment");

		store.setAxisRole("U", "something wrong");
		store.setCameraPrefs({ pinned: true });
		assert.equal(store.config.axisRoles["U"], "something wrong");

		store.revert(0);
		assert.equal(store.config.axisRoles["U"], "Z motor 1");
		assert.equal(store.config.cameraPrefs.pinned, false);
		assert.equal(store.snapshots.length, 1, "reverting keeps the snapshot");
	} finally {
		delete (globalThis as { localStorage?: unknown }).localStorage;
	}
});

test("snapshot history is capped", () => {
	const store = createConfigStore({ machineStore: () => null });
	for (let i = 0; i < 14; i++) {
		store.setAxisRole("X", `role ${i}`);
		store.snapshot(`snap ${i}`);
	}
	assert.equal(store.snapshots.length, 10);
	assert.equal(store.snapshots[0]!.label, "snap 4", "oldest snapshots dropped");
});

// --- named backups (USER_AUDIT line 20) -------------------------------------

test("snapshot trims, defaults a blank label, and caps an over-long one", () => {
	const store = createConfigStore({ machineStore: () => null });
	store.snapshot("  pre-CNC experiment  ");
	assert.equal(store.snapshots.at(-1)!.label, "pre-CNC experiment", "surrounding whitespace trimmed");

	store.snapshot("");
	assert.equal(store.snapshots.at(-1)!.label, "saved", "blank falls back");

	store.snapshot("   \t  ");
	assert.equal(store.snapshots.at(-1)!.label, "saved", "whitespace-only is blank");

	// Enforced in snapshot() itself, not at the UI: the input's maxLength is a
	// convenience, and a caller reaching the store directly must still be
	// covered.
	store.snapshot("x".repeat(MAX_LABEL_LEN + 40));
	assert.equal(store.snapshots.at(-1)!.label.length, MAX_LABEL_LEN, "capped at MAX_LABEL_LEN");
});

test("a named save labels the backup and still clears dirty", async () => {
	const mock = createMockServer({ tickMs: 0 });
	const port = await mock.listen(0);
	const connector = new PollConnector({ baseUrl: `http://127.0.0.1:${port}`, autoPoll: false, retryDelayMs: 10 });
	try {
		await connector.connect();
		const store = createConfigStore({ machineStore: () => null });
		store.setAxisRole("U", "Z motor 1");
		await store.saveToMachine(connector, "toolchanger baseline");
		assert.equal(store.snapshots.at(-1)!.label, "toolchanger baseline");
		assert.equal(store.dirty, false, "a named save still completes");
	} finally {
		await connector.disconnect().catch(() => undefined);
		await mock.close();
	}
});

test("the backup name never reaches the SD payload", async () => {
	// The label is a local aid for choosing what to restore. A named save and
	// an unnamed one must put identical bytes on the card, or the name becomes
	// config that travels between machines.
	const mock = createMockServer({ tickMs: 0 });
	const port = await mock.listen(0);
	const connector = new PollConnector({ baseUrl: `http://127.0.0.1:${port}`, autoPoll: false, retryDelayMs: 10 });
	try {
		await connector.connect();

		const plain = createConfigStore({ machineStore: () => null });
		plain.setAxisRole("U", "Z motor 1");
		await plain.saveToMachine(connector);
		const unnamedBytes = await connector.download(CONFIG_FILE);

		const named = createConfigStore({ machineStore: () => null });
		named.setAxisRole("U", "Z motor 1");
		await named.saveToMachine(connector, "pre-CNC experiment");
		const namedBytes = await connector.download(CONFIG_FILE);

		assert.equal(namedBytes, unnamedBytes, "same overlay, same bytes, label or not");
		assert.equal(namedBytes.includes("pre-CNC experiment"), false, "label absent from the file");
	} finally {
		await connector.disconnect().catch(() => undefined);
		await mock.close();
	}
});

test("save/load round-trip through the machine's SD card", async () => {
	const mock = createMockServer({ tickMs: 0 });
	const port = await mock.listen(0);
	const connector = new PollConnector({ baseUrl: `http://127.0.0.1:${port}`, autoPoll: false, retryDelayMs: 10 });
	try {
		await connector.connect();

		const store = createConfigStore({ machineStore: () => null });
		store.setAxisRole("U", "Z motor 1");
		store.setDockSensor(0, { gpIn: 4 });
		await store.saveToMachine(connector);
		assert.equal(store.dirty, false);
		assert.equal(store.snapshots.at(-1)!.label, "saved", "every save snapshots first");

		// A different session (fresh store) sees the same config
		const other = createConfigStore({ machineStore: () => null });
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
		const store = createConfigStore({ machineStore: () => null });
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
		const store = createConfigStore({ machineStore: () => null });
		await store.loadFromMachine(connector);
		assert.deepEqual(store.config, DEFAULT_CONFIG);
	} finally {
		await connector.disconnect().catch(() => undefined);
		await mock.close();
	}
});

// A minimal in-memory localStorage, so the cache path can be exercised in node
// (the whole persistence model lives there). Same shape as browser-memory.test.
class MemStore {
	private m = new Map<string, string>();
	getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
	setItem(k: string, v: string): void { this.m.set(k, String(v)); }
	removeItem(k: string): void { this.m.delete(k); }
	clear(): void { this.m.clear(); }
}

test("unsaved edits survive a reload — the cache carries them AND their dirty flag", () => {
	const ls = new MemStore();
	(globalThis as { localStorage?: unknown }).localStorage = ls;
	try {
		// axisRoles is machine-scoped: since Task 7, surviving a reload requires
		// an identified machine — an edit made with none is NOT expected to
		// survive (see test/config-cache-scope.test.ts). Both stores here share
		// the SAME machine identity, which is what a real reload of the same
		// browser pointed at the same board would too.
		const machine = openMachineStore({ kind: "board", uniqueId: "reload-test" });
		const store = createConfigStore({ machineStore: () => machine });
		store.setAxisRole("U", "Z motor 1");
		assert.equal(store.dirty, true);

		// "Reload": a brand-new store built from the same localStorage AND the
		// same machine identity.
		const reloaded = createConfigStore({ machineStore: () => machine });
		assert.equal(reloaded.config.axisRoles["U"], "Z motor 1", "the edit came back");
		assert.equal(reloaded.dirty, true, "and it is still known to be unsaved");
	} finally {
		delete (globalThis as { localStorage?: unknown }).localStorage;
	}
});

test("loadFromMachine does NOT overwrite unsaved local edits", async () => {
	const ls = new MemStore();
	(globalThis as { localStorage?: unknown }).localStorage = ls;
	const mock = createMockServer({ tickMs: 0 });
	const port = await mock.listen(0);
	const connector = new PollConnector({ baseUrl: `http://127.0.0.1:${port}`, autoPoll: false, retryDelayMs: 10 });
	try {
		await connector.connect();

		// A saved config on the SD card.
		const onMachine = createConfigStore({ machineStore: () => null });
		onMachine.setAxisRole("U", "from SD");
		await onMachine.saveToMachine(connector);

		// A different session with its OWN unsaved edit — then a connect.
		ls.clear();
		const local = createConfigStore({ machineStore: () => null });
		local.setAxisRole("V", "unsaved local");
		assert.equal(local.dirty, true);
		await local.loadFromMachine(connector);

		// The unsaved edit stands; the SD config did not clobber it.
		assert.equal(local.config.axisRoles["V"], "unsaved local", "local edit survives the connect");
		assert.equal(local.config.axisRoles["U"], undefined, "SD value was NOT pulled over it");
		assert.equal(local.dirty, true, "still unsaved");
	} finally {
		await connector.disconnect().catch(() => undefined);
		await mock.close();
		delete (globalThis as { localStorage?: unknown }).localStorage;
	}
});

test("a CLEAN session still adopts the SD config on connect", async () => {
	const ls = new MemStore();
	(globalThis as { localStorage?: unknown }).localStorage = ls;
	const mock = createMockServer({ tickMs: 0 });
	const port = await mock.listen(0);
	const connector = new PollConnector({ baseUrl: `http://127.0.0.1:${port}`, autoPoll: false, retryDelayMs: 10 });
	try {
		await connector.connect();
		const onMachine = createConfigStore({ machineStore: () => null });
		onMachine.setAxisRole("U", "from SD");
		await onMachine.saveToMachine(connector);

		// Fresh, clean session (no unsaved edits) must pick the SD config up.
		ls.clear();
		const fresh = createConfigStore({ machineStore: () => null });
		assert.equal(fresh.dirty, false);
		await fresh.loadFromMachine(connector);
		assert.equal(fresh.config.axisRoles["U"], "from SD", "clean session adopts SD");
	} finally {
		await connector.disconnect().catch(() => undefined);
		await mock.close();
		delete (globalThis as { localStorage?: unknown }).localStorage;
	}
});

// --- pinned commands ---

test("addPin appends a disabled row and returns its id", () => {
	const store = createConfigStore({ machineStore: () => null });
	const id = store.addPin("M204 P6000");
	assert.equal(store.config.pins.length, 1);
	assert.equal(store.config.pins[0]!.command, "M204 P6000");
	assert.equal(store.config.pins[0]!.enabled, false, "a fresh pin must not immediately hit the machine");
	assert.equal(store.config.pins[0]!.id, id);
	assert.equal(store.dirty, true);
});

test("updatePin edits command and enabled; removePin drops it", () => {
	const store = createConfigStore({ machineStore: () => null });
	const id = store.addPin("M204 P6000");
	store.updatePin(id, { enabled: true });
	assert.equal(store.config.pins[0]!.enabled, true);
	store.updatePin(id, { command: "M204 P8000" });
	assert.equal(store.config.pins[0]!.command, "M204 P8000");
	assert.equal(store.config.pins[0]!.enabled, true, "unrelated fields survive a patch");
	store.removePin(id);
	assert.equal(store.config.pins.length, 0);
});

test("setKeyedPin upserts by key — a fan re-pin replaces, never stacks", () => {
	const store = createConfigStore({ machineStore: () => null });
	store.setKeyedPin("fan:0", "M106 P0 S0.30", true);
	store.setKeyedPin("fan:0", "M106 P0 S0.80", true); // re-pin at a new value
	const fanPins = store.config.pins.filter(p => p.key === "fan:0");
	assert.equal(fanPins.length, 1, "same key must not accumulate rows");
	assert.equal(fanPins[0]!.command, "M106 P0 S0.80");
	store.removeKeyedPin("fan:0");
	assert.equal(store.config.pins.filter(p => p.key === "fan:0").length, 0);
});

test("keyed and keyless pins coexist without colliding", () => {
	const store = createConfigStore({ machineStore: () => null });
	store.addPin("M204 P6000");            // keyless (Pinned commands card)
	store.setKeyedPin("fan:0", "M106 P0 S0.5", true); // fan pin
	assert.equal(store.config.pins.length, 2);
	assert.equal(store.config.pins.filter(p => p.key === undefined).length, 1);
	assert.equal(store.config.pins.filter(p => p.key === "fan:0").length, 1);
});

test("Save-to-machine backups (snapshots) survive a reload", () => {
	const ls = new MemStore();
	(globalThis as { localStorage?: unknown }).localStorage = ls;
	try {
		// Same machine identity across both stores — a real reload of the same
		// browser pointed at the same board (see the "unsaved edits survive a
		// reload" test above for the identical pattern).
		const machine = openMachineStore({ kind: "board", uniqueId: "snap-reload" });
		const store = createConfigStore({ machineStore: () => machine });
		store.setAxisRole("U", "Z motor 1");
		store.snapshot("v1");
		store.setAxisRole("V", "Z motor 2");
		store.snapshot("v2");
		assert.equal(store.snapshots.length, 2);

		// "Reload": a fresh store from the same localStorage AND machine.
		const reloaded = createConfigStore({ machineStore: () => machine });
		assert.equal(reloaded.snapshots.length, 2, "the backup history came back, not an empty set");
		assert.equal(reloaded.snapshots.at(-1)!.label, "v2");

		// The snapshot's overlay is intact — reverting to v1 undoes the V edit.
		reloaded.revert(0);
		assert.equal(reloaded.config.axisRoles["U"], "Z motor 1");
		assert.equal(reloaded.config.axisRoles["V"], undefined, "reverted to before V was set");
	} finally {
		delete (globalThis as { localStorage?: unknown }).localStorage;
	}
});
