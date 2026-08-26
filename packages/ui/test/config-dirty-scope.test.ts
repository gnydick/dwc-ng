// GIT_86 Critical 1 — `meta.dirty` is restored from `dwc-ng.person`, which is
// deliberately NOT machine-scoped (Ruling 18). Gating a machine-scoped
// `loadFromMachine` on it unqualified means unsaved work done while pointed
// at machine A makes `wasDirty` true on the next boot pointed at machine B,
// and B's own, correctly-stamped SD file was refused — leaving B's machine
// half at `{}`, which a later Save then uploaded over B's intact config.
//
// Reproduced by the whole-branch review by executing the real modules
// (config/store.ts + config/machineStore.ts) in the real boot order; see
// scratch-probes/probe-c1.ts for the standalone, framework-free version of
// the same scenario. These tests pin the fix at the unit level.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoot, createSignal } from "solid-js";
import type { Connector } from "@dwc-ng/connector";
import { createConfigStore } from "../src/config/store.ts";
import { openMachineStore } from "../src/config/machineStore.ts";
import type { MachineStore } from "../src/config/machineStore.ts";
import { withLocalStorage } from "./helpers/localStorage.ts";

function fakeConnector(text: string): Connector & { uploads: { path: string; body: string }[] } {
	const uploads: { path: string; body: string }[] = [];
	return {
		uploads,
		download: async () => text,
		upload: async (path: string, body: string) => void uploads.push({ path, body }),
	} as unknown as Connector & { uploads: { path: string; body: string }[] };
}

/** See config-claimed.test.ts's own `runInRoot` for why this shape (a
 *  synchronous `withLocalStorage` body starting an async `createRoot`,
 *  captured and awaited outside) is required for an async test body. */
function runInRoot(body: (dispose: () => void) => Promise<void>): Promise<void> {
	let p: Promise<void> = Promise.resolve();
	withLocalStorage(() => { p = createRoot(body); });
	return p;
}

const B_FILE = JSON.stringify({
	version: 3, machineId: "b.B",
	overlay: { axisRoles: { U: "B's Z motor" }, shaping: { envelope: { x: [0, 300], y: [0, 300] } } },
});

test("a machine never before visited on this browser still loads its own SD file, even with a dirty flag inherited from a different machine's session", async () => {
	await runInRoot(async dispose => {
		// --- Session on A: an unsaved MACHINE edit, never saved to A's card. ---
		const A = openMachineStore({ kind: "board", uniqueId: "A" });
		const [msA] = createSignal<MachineStore | null>(A);
		const storeA = createConfigStore({ machineStore: msA });
		storeA.setAxisRole("U", "A's unsaved edit");
		assert.equal(storeA.dirty, true);

		// --- Fresh boot, pointed at B — never visited by this browser before. ---
		const B = openMachineStore({ kind: "board", uniqueId: "B" });
		const [msB, setMsB] = createSignal<MachineStore | null>(null);
		const storeB = createConfigStore({ machineStore: msB });
		assert.equal(storeB.dirty, true, "inherited from the person cache A's session wrote");

		setMsB(B); // identity resolves
		const conn = fakeConnector(B_FILE);
		await storeB.loadFromMachine(conn);

		assert.equal(storeB.config.axisRoles.U, "B's Z motor", "B's own file loaded — the headline regression");
		assert.deepEqual(storeB.config.shaping.envelope, { x: [0, 300], y: [0, 300] });
		assert.equal(storeB.meta.claimedProfile, null, "matched B's stamp — nothing claimed");

		await storeB.saveToMachine(conn);
		// The connector's own capture, not a post-`await` localStorage read —
		// per runInRoot's own doc comment, the scratch localStorage is only
		// guaranteed live for the synchronous portion of this body.
		assert.equal(conn.uploads.length, 1);
		const parsed = JSON.parse(conn.uploads[0]!.body) as { overlay: { axisRoles?: Record<string, string> } };
		assert.equal(parsed.overlay.axisRoles?.U, "B's Z motor", "Save did not write an empty machine half over B's file");
		dispose();
	});
});

test("A's unsaved PERSON edit is not silently discarded by B's bypassed load", async () => {
	await runInRoot(async dispose => {
		const A = openMachineStore({ kind: "board", uniqueId: "A" });
		const [msA] = createSignal<MachineStore | null>(A);
		const storeA = createConfigStore({ machineStore: msA });
		storeA.setThermalColors({ hot: "#123456" }); // PERSON edit, unsaved
		assert.equal(storeA.dirty, true);

		const B = openMachineStore({ kind: "board", uniqueId: "B" });
		const [msB, setMsB] = createSignal<MachineStore | null>(null);
		const storeB = createConfigStore({ machineStore: msB });
		setMsB(B);

		await storeB.loadFromMachine(fakeConnector(B_FILE));
		assert.equal(storeB.config.thermalColors.hot, "#123456", "the unsaved person edit survives the bypass, not silently discarded");
		assert.equal(storeB.config.axisRoles.U, "B's Z motor", "B's machine half still loaded");
		assert.equal(storeB.dirty, true, "still unsaved — the person half never made it to any card");
		dispose();
	});
});

test("a machine's OWN local unsaved machine-half edit still blocks an ordinary reload (non-regression)", async () => {
	// Same shape as config-claimed.test.ts's "dirty still wins" — re-pinned
	// here because this is exactly the case the bypass above must NOT widen.
	await runInRoot(async dispose => {
		const A = openMachineStore({ kind: "board", uniqueId: "A" });
		const [ms] = createSignal<MachineStore | null>(A);
		const store = createConfigStore({ machineStore: ms });
		store.setAxisRole("U", "unsaved, local to A");
		await store.loadFromMachine(fakeConnector(JSON.stringify({
			version: 3, machineId: "b.A", overlay: { axisRoles: { U: "from SD" } },
		})));
		assert.equal(store.config.axisRoles.U, "unsaved, local to A", "A's own local edit still wins — nothing to bypass, A's local half is non-empty");
		dispose();
	});
});

test("a claimed (foreign-stamped) file for a never-before-visited machine still raises a claim, even with an inherited dirty flag", async () => {
	await runInRoot(async dispose => {
		const A = openMachineStore({ kind: "board", uniqueId: "A" });
		const [msA] = createSignal<MachineStore | null>(A);
		const storeA = createConfigStore({ machineStore: msA });
		storeA.setThermalColors({ hot: "#abcdef" });

		const B = openMachineStore({ kind: "board", uniqueId: "B" });
		const [msB, setMsB] = createSignal<MachineStore | null>(null);
		const storeB = createConfigStore({ machineStore: msB });
		setMsB(B);

		await storeB.loadFromMachine(fakeConnector(JSON.stringify({
			version: 3, machineId: "b.SOME-OTHER-BOARD", overlay: { axisRoles: { U: "not B's" } },
		})));
		assert.equal(storeB.config.axisRoles.U, undefined, "a foreign stamp never drives the effective config, dirty or not");
		assert.equal(storeB.meta.claimedProfile?.writtenFor, "b.SOME-OTHER-BOARD", "the claim is raised, not silently swallowed by the inherited dirty flag");
		assert.equal(storeB.config.thermalColors.hot, "#abcdef", "the unsaved person edit still survives");
		dispose();
	});
});
