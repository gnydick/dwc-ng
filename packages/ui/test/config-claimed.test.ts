// "Claimed, not adopted" on the SD load path (spec §3; campaign #76 phase 1
// task 9). A profile downloaded from CONFIG_FILE that was stamped for a
// DIFFERENT machine must never drive the effective config — its machine half
// sits in store.meta.claimedProfile (origin + section NAMES only, never a
// leaf value) until the operator explicitly Adopts or Clears it. See
// config/store.ts's loadFromMachine/saveToMachine and their own
// `claimed-not-adopted` / `no-unstamped-sd-write` invariant comments.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoot, createSignal } from "solid-js";
import type { Connector } from "@dwc-ng/connector";
import { createConfigStore } from "../src/config/store.ts";
import { openMachineStore } from "../src/config/machineStore.ts";
import type { MachineStore } from "../src/config/machineStore.ts";
import { claimedProfileText } from "../src/cards/machineIdentityText.ts";
import { withLocalStorage } from "./helpers/localStorage.ts";

/** A connector stub: download returns the given text, upload records it. */
function fakeConnector(text: string): Connector & { uploads: { path: string; body: string }[] } {
	const uploads: { path: string; body: string }[] = [];
	return {
		uploads,
		download: async () => text,
		upload: async (path: string, body: string) => void uploads.push({ path, body }),
	} as unknown as Connector & { uploads: { path: string; body: string }[] };
}

/**
 * withLocalStorage's `run` is synchronous (see its own doc comment: an async
 * form was tried and reverted — it corrupts overlapping tests). An async
 * `createRoot` body (this file's tests all await loadFromMachine/
 * saveToMachine inside one) is still driven correctly: `run` starts the
 * root SYNCHRONOUSLY, capturing the promise `createRoot` returns before
 * `withLocalStorage`'s own `finally` restores localStorage, and the caller
 * `await`s that captured promise — satisfying Ruling 4 (every `createRoot`
 * with an async callback must be awaited) without needing withLocalStorage
 * itself to change shape. The scratch localStorage is only guaranteed live
 * for the SYNCHRONOUS portion of `body` (up to its first `await`) — every
 * assertion below reads `store.config`/`store.meta` (in-memory, set
 * synchronously by `commit()` regardless of what persistCache's underlying
 * writes land on), never a fresh localStorage read after an `await`.
 */
function runInRoot(body: (dispose: () => void) => Promise<void>): Promise<void> {
	let p: Promise<void> = Promise.resolve();
	withLocalStorage(() => { p = createRoot(body); });
	return p;
}

test("saveToMachine stamps the machine half with the connected machine", async () => {
	await runInRoot(async dispose => {
		const [ms] = createSignal<MachineStore | null>(openMachineStore({ kind: "board", uniqueId: "A" }));
		const store = createConfigStore({ machineStore: ms });
		store.setShaping({ envelope: { x: [0, 300], y: [0, 300] } });
		const conn = fakeConnector("");
		await store.saveToMachine(conn);
		const body = JSON.parse(conn.uploads[0]!.body);
		assert.equal(body.version, 3);
		assert.equal(body.machineId, "b.A");
		dispose();
	});
});

test("saveToMachine refuses to write without an identified machine", async () => {
	await runInRoot(async dispose => {
		const [ms] = createSignal<MachineStore | null>(null);
		const store = createConfigStore({ machineStore: ms });
		store.setThermalColors({ hot: "#ff0000" }); // an edit, so there is something to (not) save
		const conn = fakeConnector("");
		await store.saveToMachine(conn);
		assert.equal(conn.uploads.length, 0, "no identified machine — must not write an unstamped file");
		assert.equal(store.dirty, true, "refused, not silently treated as saved");
		dispose();
	});
});

test("a card from another board loads CLAIMED: the envelope is not in effect", async () => {
	await runInRoot(async dispose => {
		const [ms] = createSignal<MachineStore | null>(openMachineStore({ kind: "board", uniqueId: "B" }));
		const store = createConfigStore({ machineStore: ms });
		const written = JSON.stringify({
			version: 3,
			machineId: "b.A",
			overlay: { shaping: { envelope: { x: [0, 999], y: [0, 999] } } },
		});
		await store.loadFromMachine(fakeConnector(written));
		assert.equal(store.config.shaping.envelope, null, "a claimed envelope must NOT be driven against");
		assert.equal(store.meta.claimedProfile?.writtenFor, "b.A");
		assert.deepEqual(store.meta.claimedProfile?.sections, ["shaping"]);
		dispose();
	});
});

test("adopting a claimed profile applies it and clears the claim", async () => {
	await runInRoot(async dispose => {
		const [ms] = createSignal<MachineStore | null>(openMachineStore({ kind: "board", uniqueId: "B" }));
		const store = createConfigStore({ machineStore: ms });
		await store.loadFromMachine(fakeConnector(JSON.stringify({
			version: 3, machineId: "b.A", overlay: { shaping: { envelope: { x: [0, 200], y: [0, 200] } } },
		})));
		store.adoptClaimedProfile();
		assert.deepEqual(store.config.shaping.envelope, { x: [0, 200], y: [0, 200] });
		assert.equal(store.meta.claimedProfile, null);
		dispose();
	});
});

test("clearing a claimed profile discards it without applying it", async () => {
	await runInRoot(async dispose => {
		const [ms] = createSignal<MachineStore | null>(openMachineStore({ kind: "board", uniqueId: "B" }));
		const store = createConfigStore({ machineStore: ms });
		await store.loadFromMachine(fakeConnector(JSON.stringify({
			version: 3, machineId: "b.A", overlay: { shaping: { envelope: { x: [0, 200], y: [0, 200] } } },
		})));
		store.clearClaimedProfile();
		assert.equal(store.config.shaping.envelope, null, "clearing must not apply the claimed data");
		assert.equal(store.meta.claimedProfile, null);
		dispose();
	});
});

test("adopting or clearing with nothing claimed is a harmless no-op", async () => {
	await runInRoot(async dispose => {
		const [ms] = createSignal<MachineStore | null>(openMachineStore({ kind: "board", uniqueId: "A" }));
		const store = createConfigStore({ machineStore: ms });
		store.adoptClaimedProfile();
		store.clearClaimedProfile();
		assert.equal(store.config.shaping.envelope, null, "nothing to adopt — defaults stand");
		assert.equal(store.meta.claimedProfile, null);
		dispose();
	});
});

test("a matching stamp is adopted with no claim at all", async () => {
	await runInRoot(async dispose => {
		const [ms] = createSignal<MachineStore | null>(openMachineStore({ kind: "board", uniqueId: "A" }));
		const store = createConfigStore({ machineStore: ms });
		await store.loadFromMachine(fakeConnector(JSON.stringify({
			version: 3, machineId: "b.A", overlay: { axisRoles: { U: "Z motor 1" } },
		})));
		assert.equal(store.config.axisRoles.U, "Z motor 1");
		assert.equal(store.meta.claimedProfile, null);
		dispose();
	});
});

test("dirty still wins: a reconnect must not discard unsaved work", async () => {
	// The existing guard at store.ts's loadFromMachine. Re-pinned here because
	// this task rewrites the function around it.
	await runInRoot(async dispose => {
		const [ms] = createSignal<MachineStore | null>(openMachineStore({ kind: "board", uniqueId: "A" }));
		const store = createConfigStore({ machineStore: ms });
		store.setAxisRole("U", "unsaved");
		await store.loadFromMachine(fakeConnector(JSON.stringify({ version: 3, machineId: "b.A", overlay: { axisRoles: { U: "from SD" } } })));
		assert.equal(store.config.axisRoles.U, "unsaved");
		dispose();
	});
});

test("an unidentified machine trusts the file in full and raises no claim", async () => {
	// No id to test a stamp against — a claim needs a name to compare the
	// file's stamp TO, and there isn't one yet. Per spec §3, an unidentified
	// machine has no local cache of its own; the SD file IS its store. Safe
	// because hydrateMachine rebuilds the machine half from scratch, from
	// the newly-identified machine's OWN local cache alone, the instant
	// identity resolves — see loadFromMachine's own null-handle comment.
	await runInRoot(async dispose => {
		const [ms] = createSignal<MachineStore | null>(null);
		const store = createConfigStore({ machineStore: ms });
		await store.loadFromMachine(fakeConnector(JSON.stringify({
			version: 3, machineId: "b.A", overlay: { axisRoles: { U: "from SD" } },
		})));
		assert.equal(store.config.axisRoles.U, "from SD");
		assert.equal(store.meta.claimedProfile, null);
		dispose();
	});
});

// ---- the seam with Task 11's System card (machine-card.test.ts) ----
//
// The card never constructs a ClaimedProfile itself — it only renders one
// handed to it. This test hands it the REAL value store.ts produces (not a
// hand-built literal matching the card's guess) to the card's own text
// function. A shape divergence between the two — a renamed field, a value
// where the type says a name — fails HERE, either as a compile error (the
// import in cards/machineIdentityText.ts re-exports config/store.ts's own
// ClaimedProfile, so the two cannot type-check against different shapes) or
// as this assertion going red, not as a card that silently stops matching
// what the store actually produces.
test("the store's claimed-profile value renders through the card's own text function", async () => {
	await runInRoot(async dispose => {
		const [ms] = createSignal<MachineStore | null>(openMachineStore({ kind: "board", uniqueId: "B" }));
		const store = createConfigStore({ machineStore: ms });
		await store.loadFromMachine(fakeConnector(JSON.stringify({
			version: 3, machineId: "b.A", overlay: { shaping: { envelope: { x: [0, 200], y: [0, 200] } } },
		})));
		const text = claimedProfileText(store.meta.claimedProfile);
		assert.match(text ?? "", /b\.A/, "names the board the store itself resolved as the writer");
		assert.match(text ?? "", /claimed, not in effect/);
		dispose();
	});
});
