import { test } from "node:test";
import assert from "node:assert/strict";
import {
	migratePersonCacheToV3, stampMachineOverlay, readStampedMachineOverlay,
	migrateLegacySnapshots, readAndClearLegacyPersonCache,
} from "../src/config/migrateStorage.ts";
import { parseOverlayPayload } from "../src/config/parse.ts";
import { withLocalStorage } from "./helpers/localStorage.ts";
import { createConfigStore } from "../src/config/store.ts";
import { openMachineStore } from "../src/config/machineStore.ts";

const v2 = JSON.stringify({
	version: 2,
	overlay: {
		thermalColors: { hot: "#f00" },
		axisRoles: { U: "Z motor 1" },
		shaping: { envelope: { x: [0, 300], y: [0, 300] } },
		screens: { hidden: ["jobs"], layouts: { machine: { c1: { row: 1 } } } },
	},
});

test("a v2 localStorage cache keeps the person half and DROPS the machine half", () => {
	const { person, droppedMachineSections } = migratePersonCacheToV3(v2);
	assert.deepEqual(person.thermalColors, { hot: "#f00" });
	assert.deepEqual(person.screens, { hidden: ["jobs"] });
	assert.equal(person.axisRoles, undefined);
	assert.equal(person.shaping, undefined, "an unattributed envelope is exactly the hazard — it must not survive");
	// Recorded, not silent: the card tells the operator what was re-read from SD.
	assert.deepEqual(droppedMachineSections.sort(), ["axisRoles", "screens.layouts", "shaping"]);
});

test("garbage and foreign versions migrate to nothing, never to a throw", () => {
	assert.deepEqual(migratePersonCacheToV3("{not json").person, {});
	assert.deepEqual(migratePersonCacheToV3(null).person, {});
	assert.deepEqual(migratePersonCacheToV3(JSON.stringify({ version: 99, overlay: { thermalColors: {} } })).person, {});
	assert.deepEqual(migratePersonCacheToV3(JSON.stringify({ version: 2, overlay: "nope" })).person, {});
});

test("the SD file's machine half is stamped with the machine it was read from", () => {
	const stamped = stampMachineOverlay({ shaping: { envelope: { x: [0, 300], y: [0, 300] } } } as never, { kind: "board", uniqueId: "A" });
	assert.equal(stamped.machineId, "b.A");
	const back = readStampedMachineOverlay(stamped, { kind: "board", uniqueId: "A" });
	assert.equal(back.claimed, false);
	assert.ok(back.overlay.shaping);
});

test("a stamp from another machine is CLAIMED, not adopted and not discarded", () => {
	const stamped = stampMachineOverlay({ shaping: { envelope: { x: [0, 300], y: [0, 300] } } } as never, { kind: "board", uniqueId: "A" });
	const back = readStampedMachineOverlay(stamped, { kind: "board", uniqueId: "B" });
	assert.equal(back.claimed, true, "an SD card moved to another board must not silently apply its envelope");
	assert.equal(back.writtenFor, "b.A");
	assert.deepEqual(back.overlay, {}, "claimed means NOT in effect until confirmed");
});

test("an unstamped v3 machine overlay is claimed too — absence of proof is not proof", () => {
	const back = readStampedMachineOverlay({ overlay: { shaping: {} } }, { kind: "board", uniqueId: "A" });
	assert.equal(back.claimed, true);
	assert.equal(back.writtenFor, null);
});

test("parseOverlayPayload still reads v1 and v2 files rather than dropping them", () => {
	assert.ok(parseOverlayPayload(v2), "a v2 SD file must still parse — a version bump that dropped it loses every saved layout");
	assert.equal(parseOverlayPayload(JSON.stringify({ version: 99, overlay: {} })), null);
});

// --- Ruling 17: legacy snapshots split the same way as the live overlay ----

test("migrateLegacySnapshots splits each entry, mints an id, and never throws on garbage", () => {
	const legacy = [
		{ takenAt: 100, label: "v1", overlay: { axisRoles: { U: "Z motor 1" }, thermalColors: { hot: "#f00" } } },
		{ takenAt: 200, label: "v2" }, // no overlay at all
		"not an object",
		{ takenAt: "not a number", label: "bad" },
	];
	const out = migrateLegacySnapshots(legacy);
	assert.equal(out.length, 2, "only the two well-shaped entries survive");
	assert.equal(out[0]!.label, "v1");
	assert.deepEqual(out[0]!.person, { thermalColors: { hot: "#f00" } });
	assert.deepEqual(out[0]!.machine, { axisRoles: { U: "Z motor 1" } });
	assert.equal(typeof out[0]!.id, "string");
	assert.notEqual(out[0]!.id, out[1]!.id, "ids must not collide across entries migrated in the same call");
	assert.deepEqual(out[1]!.person, {});
	assert.deepEqual(out[1]!.machine, {});
});

test("migrateLegacySnapshots on non-array input returns nothing, not a throw", () => {
	assert.deepEqual(migrateLegacySnapshots(undefined), []);
	assert.deepEqual(migrateLegacySnapshots("nope"), []);
	assert.deepEqual(migrateLegacySnapshots({ 0: {} }), []);
});

test("readAndClearLegacyPersonCache reads once and removes the key — a second read finds nothing", () => {
	withLocalStorage(() => {
		localStorage.setItem("dwc-ng.config", v2);
		const first = readAndClearLegacyPersonCache();
		assert.equal(first, v2);
		const second = readAndClearLegacyPersonCache();
		assert.equal(second, null, "idempotent: the legacy key is gone after the first read");
		assert.equal(localStorage.getItem("dwc-ng.config"), null);
	});
});

test("readAndClearLegacyPersonCache is null when there is nothing to migrate", () => {
	withLocalStorage(() => {
		assert.equal(readAndClearLegacyPersonCache(), null);
	});
});

// --- wired into createConfigStore (config/store.ts loadPersonCache) -------

test("createConfigStore migrates a legacy dwc-ng.config cache on boot and removes it", () => {
	withLocalStorage(() => {
		localStorage.setItem("dwc-ng.config", v2);
		const store = createConfigStore({ machineStore: () => null });

		assert.equal(store.config.thermalColors.hot, "#f00", "the person half came in");
		assert.equal(store.config.axisRoles.U, undefined, "no machine identified — the machine half is dropped, not guessed");
		assert.deepEqual([...store.droppedMachineSections].sort(), ["axisRoles", "screens.layouts", "shaping"]);

		assert.equal(localStorage.getItem("dwc-ng.config"), null, "the legacy key is gone — a one-shot transform");
		assert.ok(localStorage.getItem("dwc-ng.person"), "the migrated person half was persisted immediately");
	});
});

test("a second boot after migration is a no-op — nothing left to migrate, nothing dropped", () => {
	withLocalStorage(() => {
		localStorage.setItem("dwc-ng.config", v2);
		createConfigStore({ machineStore: () => null }); // first boot migrates

		const second = createConfigStore({ machineStore: () => null });
		assert.equal(second.config.thermalColors.hot, "#f00", "the migrated person data survived the first boot's write");
		assert.deepEqual(second.droppedMachineSections, [], "the legacy key is already gone — there is nothing left to report");
	});
});

test("a legacy backfill does not clobber newer dwc-ng.person edits; current wins on conflict", () => {
	withLocalStorage(() => {
		// dwc-ng.person only exists once Task 7's code has run — model that by
		// writing it FIRST, as a session under that code already would have.
		localStorage.setItem("dwc-ng.person", JSON.stringify({
			version: 3,
			overlay: { thermalColors: { hot: "#00ff00" }, cameraPrefs: { pinned: true } },
			dirty: false,
			snapshots: [],
		}));
		localStorage.setItem("dwc-ng.config", v2); // older: thermalColors.hot #f00, plus screens.hidden

		const store = createConfigStore({ machineStore: () => null });
		assert.equal(store.config.thermalColors.hot, "#00ff00", "the newer dwc-ng.person value wins on the same field");
		assert.equal(store.config.cameraPrefs.pinned, true, "a field only dwc-ng.person had is kept");
		assert.deepEqual(store.config.screens.hidden, ["jobs"], "a field only the legacy cache had backfills in");
	});
});

test("a legacy snapshot's machine half is attributed to the machine already known at migration time", () => {
	withLocalStorage(() => {
		localStorage.setItem("dwc-ng.config", JSON.stringify({
			version: 2,
			overlay: {},
			dirty: false,
			snapshots: [{ takenAt: 111, label: "old", overlay: { axisRoles: { U: "legacy Z motor" }, thermalColors: { hot: "#f00" } } }],
		}));
		const A = openMachineStore({ kind: "board", uniqueId: "legacy-attrib" });
		const store = createConfigStore({ machineStore: () => A });

		assert.equal(store.snapshots.length, 1);
		assert.equal(store.snapshots[0]!.label, "old");
		assert.deepEqual(store.snapshots[0]!.overlay, { thermalColors: { hot: "#f00" } }, "the snapshot record itself is person-only");

		store.setAxisRole("U", "changed after migration");
		store.revert(0);
		assert.equal(store.config.axisRoles.U, "legacy Z motor", "the machine half was attributed to A and is restorable on A");
	});
});

test("a legacy snapshot's machine half is dropped when no machine is known at migration time", () => {
	withLocalStorage(() => {
		localStorage.setItem("dwc-ng.config", JSON.stringify({
			version: 2,
			overlay: {},
			dirty: false,
			snapshots: [{ takenAt: 111, label: "old", overlay: { axisRoles: { U: "legacy Z motor" } } }],
		}));
		const store = createConfigStore({ machineStore: () => null });
		assert.equal(store.snapshots.length, 1);

		store.revert(0);
		assert.equal(store.config.axisRoles.U, undefined, "no machine was known at migration time — nothing to attribute the machine half to");
	});
});
