import { test } from "node:test";
import assert from "node:assert/strict";
import type { Connector } from "@dwc-ng/connector";
import {
	migratePersonCacheToV3, stampMachineOverlay, readStampedMachineOverlay,
	migrateLegacySnapshots, readAndClearLegacyPersonCache,
} from "../src/config/migrateStorage.ts";
import { parseOverlayPayload } from "../src/config/parse.ts";
import { CONFIG_VERSION } from "../src/config/types.ts";
import { withLocalStorage } from "./helpers/localStorage.ts";
import { createConfigStore } from "../src/config/store.ts";
import { openMachineStore } from "../src/config/machineStore.ts";
import type { IdentifiedMachine } from "../src/config/machineId.ts";

/** A connector stub: download returns the given text, upload records it —
 *  same shape as config-claimed.test.ts's own (kept local: these two files
 *  test different modules and neither should import test-only helpers from
 *  the other). */
function fakeConnector(text: string): Connector & { uploads: { path: string; body: string }[] } {
	const uploads: { path: string; body: string }[] = [];
	return {
		uploads,
		download: async () => text,
		upload: async (path: string, body: string) => void uploads.push({ path, body }),
	} as unknown as Connector & { uploads: { path: string; body: string }[] };
}

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
	const back = readStampedMachineOverlay(stamped, { kind: "board", uniqueId: "A" }, CONFIG_VERSION);
	assert.equal(back.claimed, false);
	assert.equal(back.migrated, false);
	assert.ok(back.overlay.shaping);
});

test("a stamp from another machine is CLAIMED, not adopted and not discarded", () => {
	const stamped = stampMachineOverlay({ shaping: { envelope: { x: [0, 300], y: [0, 300] } } } as never, { kind: "board", uniqueId: "A" });
	const back = readStampedMachineOverlay(stamped, { kind: "board", uniqueId: "B" }, CONFIG_VERSION);
	assert.equal(back.claimed, true, "an SD card moved to another board must not silently apply its envelope");
	assert.equal(back.migrated, false);
	assert.equal(back.writtenFor, "b.A");
	assert.deepEqual(back.overlay, {}, "claimed means NOT in effect until confirmed");
});

test("an unstamped v3 machine overlay is claimed too — absence of proof is not proof", () => {
	const back = readStampedMachineOverlay({ overlay: { shaping: {} } }, { kind: "board", uniqueId: "A" }, CONFIG_VERSION);
	assert.equal(back.claimed, true);
	assert.equal(back.migrated, false);
	assert.equal(back.writtenFor, null);
});

// --- spec §3/§4: a PRE-v3 machine half never had a stamp to check in the
// first place — the SD read itself is proof of origin, so it is migrated,
// not claimed. Only a v3 payload's missing/mismatched stamp is a genuine
// claim (the two tests above). ---------------------------------------------

test("a v2 machine half has no machineId field at all, and is MIGRATED — never claimed", () => {
	// Exactly the shape config/store.ts's loadFromMachine hands in: no
	// `machineId` (v2 never had one), the machine half already split out.
	const back = readStampedMachineOverlay(
		{ overlay: { axisRoles: { U: "Z motor 1" } } },
		{ kind: "board", uniqueId: "A" },
		2,
	);
	assert.equal(back.claimed, false, "a v2 file came off THIS board's own card — that is its proof of origin");
	assert.equal(back.migrated, true);
	assert.equal(back.writtenFor, null);
	assert.deepEqual(back.overlay, { axisRoles: { U: "Z motor 1" } }, "adopted, not quarantined to {}");
});

test("a v1 machine half is migrated too — versioning lives outside this shape, not on it", () => {
	const back = readStampedMachineOverlay({ overlay: { axisRoles: { U: "Z motor 1" } } }, { kind: "board", uniqueId: "A" }, 1);
	assert.equal(back.migrated, true);
	assert.equal(back.claimed, false);
	assert.deepEqual(back.overlay, { axisRoles: { U: "Z motor 1" } });
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

test("Ruling 18: a legacy snapshot's machine half is dropped UNCONDITIONALLY — even when a machine is already known at migration time", () => {
	withLocalStorage(() => {
		localStorage.setItem("dwc-ng.config", JSON.stringify({
			version: 2,
			overlay: {},
			dirty: false,
			snapshots: [{ takenAt: 111, label: "old", overlay: { axisRoles: { U: "legacy Z motor" }, thermalColors: { hot: "#f00" } } }],
		}));
		// A machine IS resolved at the exact synchronous instant migration
		// runs — the one case Ruling 18 exists to close. A resolved machine is
		// not evidence about who wrote a byte read out of unkeyed localStorage;
		// it must not be treated as such merely because a machine happens to
		// be identified at this instant.
		const A = openMachineStore({ kind: "board", uniqueId: "legacy-attrib" });
		const store = createConfigStore({ machineStore: () => A });

		assert.equal(store.snapshots.length, 1);
		assert.equal(store.snapshots[0]!.label, "old");
		assert.deepEqual(store.snapshots[0]!.overlay, { thermalColors: { hot: "#f00" } }, "the snapshot record itself is person-only");

		store.revert(store.snapshots[0]!.id);
		assert.equal(
			store.config.axisRoles.U, undefined,
			"the machine half must NOT have been attributed to A — its origin is unknowable in principle, so A being connected right now proves nothing",
		);
		assert.ok(
			store.droppedMachineSections.includes('saved version "old"'),
			"the drop is visible, not silent (Ruling 19) — reported alongside the live overlay's own droppedMachineSections",
		);
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

		store.revert(store.snapshots[0]!.id);
		assert.equal(store.config.axisRoles.U, undefined, "no machine was known at migration time — nothing to attribute the machine half to");
		assert.ok(store.droppedMachineSections.includes('saved version "old"'), "the drop is reported here too, not only in the machine-known case");
	});
});

// --- Defect 2 (GIT_86): loadFromMachine's dirty guard used to block a v2 SD
// file from ever being read at all, and a v2 file's missing machineId was
// read as a foreign claim. Reproduces the owner's real regression: SD file
// intact and v2, person cache's dirty carried forward true, machine half
// never loaded, empty settings. A realistic v2 payload — shaped like the
// actual file (axisRoles, heaterColors, thermalColors, dockSensors, camera,
// sensorNames, macros, screens, shaping), both halves mixed the way an
// unsplit v2 overlay always was. ------------------------------------------

const OWNER: IdentifiedMachine = { kind: "board", uniqueId: "OWNER" };

const REALISTIC_V2 = JSON.stringify({
	version: 2,
	overlay: {
		axisRoles: { U: "Z motor 1", V: "Z motor 2", W: "Z motor 3", C: "Coupler" },
		heaterColors: { "1": "#ff8800", "2": "#0088ff" },
		thermalColors: { cold: "#3080ff", warm: "#ffb000", hot: "#ff3030" },
		dockSensors: { "0": { gpIn: 4 }, "1": { gpIn: 5, inverted: true } },
		camera: { streamUrl: "http://duet3.local/webcam" },
		sensorNames: { "probe:0": "Bed probe" },
		macros: { autoConfirmRun: true },
		screens: { hidden: ["jobs"], layouts: { machine: { c1: { col: 0, row: 0, colSpan: 4, rowSpan: 2 } } } },
		shaping: { envelope: { x: [0, 300], y: [0, 300] }, accelByTool: { 0: "20.0" } },
	},
});

test("Defect 2: a v2 SD file's machine half still loads even though the person cache carries a stale dirty:true", async () => {
	let store!: ReturnType<typeof createConfigStore>;
	withLocalStorage(() => {
		const handle = openMachineStore(OWNER);
		store = createConfigStore({ machineStore: () => handle });
		// The exact shape of the real regression: an edit (here, a PERSON one)
		// left the overlay dirty BEFORE this load runs — see the next test for
		// why it must survive, not just be tolerated.
		store.setThermalColors({ hot: "#00ff00" });
	});
	assert.equal(store.dirty, true, "dirty going in, same as the owner's carried-forward flag");

	const conn = fakeConnector(REALISTIC_V2);
	await store.loadFromMachine(conn);

	assert.equal(store.config.axisRoles.U, "Z motor 1", "the machine half loaded — the owner's headline symptom");
	assert.equal(store.config.axisRoles.V, "Z motor 2");
	assert.deepEqual(store.config.heaterColors, { "1": "#ff8800", "2": "#0088ff" });
	assert.deepEqual(store.config.dockSensors["1"], { gpIn: 5, inverted: true });
	assert.equal(store.config.camera.streamUrl, "http://duet3.local/webcam");
	assert.equal(store.config.sensorNames["probe:0"], "Bed probe");
	assert.equal(store.config.shaping.envelope?.x[1], 300);
	assert.deepEqual(
		store.config.screens.layouts["machine"]?.["c1"],
		{ col: 0, row: 0, colSpan: 4, rowSpan: 2 },
		"the machine-scoped screens.layouts half loads too — via this same path (screens.hidden is PERSON and is deliberately NOT asserted here)",
	);

	assert.equal(conn.uploads.length, 1, "written back stamped, per spec §4 — a v3 file from here on");
	const body = JSON.parse(conn.uploads[0]!.body) as { version: number; machineId: string };
	assert.equal(body.version, CONFIG_VERSION);
	assert.equal(body.machineId, "b.OWNER");
});

test("Defect 2: local unsaved PERSON edits survive that same load — the file's person section does not clobber them", async () => {
	let store!: ReturnType<typeof createConfigStore>;
	withLocalStorage(() => {
		const handle = openMachineStore(OWNER);
		store = createConfigStore({ machineStore: () => handle });
		store.setThermalColors({ hot: "#00ff00" }); // local unsaved PERSON edit
	});
	assert.equal(store.dirty, true);

	await store.loadFromMachine(fakeConnector(REALISTIC_V2));

	assert.equal(
		store.config.thermalColors.hot, "#00ff00",
		"the LOCAL unsaved person edit stands — the v2 file's own thermalColors.hot (#ff3030) must not have overwritten it",
	);
	// The rest of the person half the file DID carry (autoConfirmRun) is not
	// pulled in either while dirty — only the local person half is kept, not
	// a field-by-field merge of the two.
	assert.equal(store.config.macros.autoConfirmRun, false, "the file's person section is not adopted while dirty, not even partially");
});

test("Defect 2: a v3 file with a FOREIGN stamp is still claimed, not adopted", async () => {
	const handle = openMachineStore(OWNER);
	const store = createConfigStore({ machineStore: () => handle });
	await store.loadFromMachine(fakeConnector(JSON.stringify({
		version: CONFIG_VERSION, machineId: "b.SOME-OTHER-BOARD", overlay: { axisRoles: { U: "someone else's Z motor" } },
	})));
	assert.equal(store.config.axisRoles.U, undefined, "a foreign stamp must not drive the effective config");
	assert.equal(store.meta.claimedProfile?.writtenFor, "b.SOME-OTHER-BOARD");
});

test("Defect 2: a v3 file with NO stamp at all is still claimed, not adopted — absence of proof is not proof, unlike a v2 file's absence of the FIELD", async () => {
	const handle = openMachineStore(OWNER);
	const store = createConfigStore({ machineStore: () => handle });
	await store.loadFromMachine(fakeConnector(JSON.stringify({
		version: CONFIG_VERSION, overlay: { axisRoles: { U: "unstamped" } }, // no machineId at all
	})));
	assert.equal(store.config.axisRoles.U, undefined, "an unstamped v3 file must not drive the effective config");
	assert.equal(store.meta.claimedProfile?.writtenFor, null);
	assert.deepEqual(store.meta.claimedProfile?.sections, ["axisRoles"]);
});
