// The machine half of the config overlay must live behind a MachineStore —
// never in the origin-global person cache — and must never be written at all
// while identity is unknown (store() === null). See config/store.ts's
// persistCache/writeMachineOverlay and its hydrateMachine computed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoot, createSignal } from "solid-js";
import { createConfigStore } from "../src/config/store.ts";
import { openMachineStore } from "../src/config/machineStore.ts";
import type { MachineStore } from "../src/config/machineStore.ts";
import { withLocalStorage } from "./helpers/localStorage.ts";

test("the person cache survives a boot with no identity; the machine half does not appear", () => {
	withLocalStorage(() => {
		createRoot(dispose => {
			const [ms, setMs] = createSignal<MachineStore | null>(null);
			const store = createConfigStore({ machineStore: ms });
			store.setThermalColors({ hot: "#ff0000" }); // person
			store.setAxisRole("U", "Z motor 1");         // machine
			dispose();

			// Fresh boot, still no identity.
			createRoot(d2 => {
				const [ms2] = createSignal<MachineStore | null>(null);
				const s2 = createConfigStore({ machineStore: ms2 });
				assert.equal(s2.config.thermalColors.hot, "#ff0000", "person state boots from cache");
				assert.equal(s2.config.axisRoles.U, undefined, "machine state is not readable without a machine");
				d2();
			});
			setMs(null);
		});
	});
});

test("machine state written on A is not visible on B", () => {
	withLocalStorage(() => {
		const A = openMachineStore({ kind: "board", uniqueId: "A" });
		const B = openMachineStore({ kind: "board", uniqueId: "B" });
		createRoot(dispose => {
			const [ms, setMs] = createSignal<MachineStore | null>(null);
			const store = createConfigStore({ machineStore: ms });
			setMs(A);
			store.setAxisRole("U", "A's Z motor");
			assert.equal(store.config.axisRoles.U, "A's Z motor");
			setMs(B);
			assert.equal(store.config.axisRoles.U, undefined, "B must not inherit A's machine state");
			dispose();
		});
	});
});

test("the envelope is the case that matters and behaves the same way", () => {
	withLocalStorage(() => {
		const A = openMachineStore({ kind: "board", uniqueId: "A" });
		const B = openMachineStore({ kind: "board", uniqueId: "B" });
		createRoot(dispose => {
			const [ms, setMs] = createSignal<MachineStore | null>(null);
			const store = createConfigStore({ machineStore: ms });
			setMs(A);
			store.setShaping({ envelope: { x: [0, 300], y: [0, 300] } });
			setMs(B);
			assert.equal(store.config.shaping.envelope, null, "an inherited envelope is the crash this campaign exists to stop");
			dispose();
		});
	});
});

test("an edit made before identity resolves is discarded, not adopted by whichever machine answers first", () => {
	// Pins config/store.ts's hydrateMachine doc comment: the join on identity
	// arrival is a full reconstruction, so an edit made while store() was
	// still null has nowhere to land — it must not be carried into the first
	// machine that resolves, and it must not have been written to that
	// machine's own storage either (see writeMachineOverlay's invariant: a
	// commit always runs persistCache, and persistCache always writes
	// WHATEVER the current machine half is, discarded or not).
	withLocalStorage(() => {
		const A = openMachineStore({ kind: "board", uniqueId: "A" });
		createRoot(dispose => {
			const [ms, setMs] = createSignal<MachineStore | null>(null);
			const store = createConfigStore({ machineStore: ms });
			store.setAxisRole("U", "a guess made with no machine known");
			assert.equal(
				store.config.axisRoles.U, "a guess made with no machine known",
				"in-memory, before identity — the edit itself is not refused",
			);

			setMs(A);
			assert.equal(store.config.axisRoles.U, undefined, "discarded the instant identity arrives, not adopted by A");

			const raw = A.get("config");
			const onDisk = raw === null ? {} : (JSON.parse(raw) as { overlay?: { axisRoles?: Record<string, string> } }).overlay ?? {};
			assert.equal(onDisk.axisRoles?.U, undefined, "the discarded edit must not have been written to A's storage either");
			dispose();
		});
	});
});

test("person edits are not lost when identity arrives", () => {
	withLocalStorage(() => {
		const A = openMachineStore({ kind: "board", uniqueId: "A" });
		createRoot(dispose => {
			const [ms, setMs] = createSignal<MachineStore | null>(null);
			const store = createConfigStore({ machineStore: ms });
			store.setThermalColors({ hot: "#abcdef" });
			setMs(A);
			assert.equal(store.config.thermalColors.hot, "#abcdef");
			dispose();
		});
	});
});

// --- Ruling 17: a snapshot's machine half is scoped exactly like the live
// overlay's — see config/store.ts snapshot()/revert() and ConfigSnapshot's
// own doc comment (config/types.ts). ---------------------------------------

test("reverting a snapshot taken on machine A does not carry its machine half onto machine B", () => {
	withLocalStorage(() => {
		const A = openMachineStore({ kind: "board", uniqueId: "A" });
		const B = openMachineStore({ kind: "board", uniqueId: "B" });
		createRoot(dispose => {
			const [ms, setMs] = createSignal<MachineStore | null>(null);
			const store = createConfigStore({ machineStore: ms });
			setMs(A);
			store.setAxisRole("U", "A's Z motor");
			store.snapshot("on A");
			store.setAxisRole("U", "changed after the snapshot");

			setMs(B);
			assert.equal(store.config.axisRoles.U, undefined, "B starts clean (hydrateMachine already covers this)");

			store.revert(0);
			assert.equal(store.config.axisRoles.U, undefined, "A's axis role must not appear on B — the exact hazard Ruling 17 closes");
			dispose();
		});
	});
});

test("reverting on the SAME machine that took the snapshot restores its machine half", () => {
	withLocalStorage(() => {
		const A = openMachineStore({ kind: "board", uniqueId: "A" });
		createRoot(dispose => {
			const [ms] = createSignal<MachineStore | null>(A);
			const store = createConfigStore({ machineStore: ms });
			store.setAxisRole("U", "A's Z motor");
			store.snapshot("on A");
			store.setAxisRole("U", "changed after the snapshot");

			store.revert(0);
			assert.equal(store.config.axisRoles.U, "A's Z motor", "same machine — the entry is found in A's own store, which is the proof");
			dispose();
		});
	});
});

test("a snapshot taken with no identified machine never carries a machine half, even on a later revert", () => {
	withLocalStorage(() => {
		const A = openMachineStore({ kind: "board", uniqueId: "A" });
		createRoot(dispose => {
			const [ms, setMs] = createSignal<MachineStore | null>(null);
			const store = createConfigStore({ machineStore: ms });
			store.setAxisRole("U", "guessed with no machine known");
			store.snapshot("no machine identified");

			setMs(A); // hydrateMachine discards the pre-identity edit — unrelated to this snapshot
			store.revert(0);
			assert.equal(store.config.axisRoles.U, undefined, "nothing was ever attributed to any machine — never guess on revert either");
			dispose();
		});
	});
});

// --- GIT_86 finding I1: a miss on the CURRENT machine's own snapshot record
// must leave that machine's live machine half untouched, never replace it
// with `{}`. `{}` is not "nothing to restore" — it is "restore emptiness",
// and committing it is what erased a live axis role beneath the very next
// Save. See config/store.ts revert()'s own invariant. --------------------

test("I1: reverting to a snapshot taken on a DIFFERENT machine does not erase this machine's own live machine half", () => {
	withLocalStorage(() => {
		const A = openMachineStore({ kind: "board", uniqueId: "A" });
		const B = openMachineStore({ kind: "board", uniqueId: "B" });
		createRoot(dispose => {
			const [ms, setMs] = createSignal<MachineStore | null>(null);
			const store = createConfigStore({ machineStore: ms });

			setMs(A);
			store.setAxisRole("U", "A's Z motor");
			store.snapshot("on A");

			setMs(B);
			// B's OWN live setting, unrelated to any snapshot — this is the value
			// finding I1 showed getting silently wiped.
			store.setAxisRole("U", "B-role");
			assert.equal(store.config.axisRoles.U, "B-role");

			store.revert(0); // "on A" — not found in B's own snapshot record
			assert.equal(store.config.axisRoles.U, "B-role", "B's own machine half must survive a miss, not be replaced with {}");

			// And the erasure must not have been persisted to B's own storage
			// either — the exact "next Save writes {} to the card" failure mode.
			const raw = B.get("config");
			const onDisk = raw === null ? {} : (JSON.parse(raw) as { overlay?: { axisRoles?: Record<string, string> } }).overlay ?? {};
			assert.equal(onDisk.axisRoles?.U, "B-role", "B's cached machine half must not have been overwritten with emptiness");
			dispose();
		});
	});
});

test("I1: revert() reports a partial restore via meta.revertNotice on a miss, and clears it on a hit", () => {
	withLocalStorage(() => {
		const A = openMachineStore({ kind: "board", uniqueId: "A" });
		const B = openMachineStore({ kind: "board", uniqueId: "B" });
		createRoot(dispose => {
			const [ms, setMs] = createSignal<MachineStore | null>(null);
			const store = createConfigStore({ machineStore: ms });

			setMs(A);
			store.setAxisRole("U", "A's Z motor");
			store.snapshot("on A");
			store.setAxisRole("U", "A's Z motor v2");
			store.snapshot("on A v2");

			assert.equal(store.meta.revertNotice, null, "nothing reverted yet this session");

			setMs(B);
			store.revert(0); // "on A" — a miss on B
			assert.notEqual(store.meta.revertNotice, null, "a miss must be reported, not silent");
			assert.match(store.meta.revertNotice ?? "", /on A/, "names the snapshot that was only partially restored");

			setMs(A);
			store.revert(0); // same machine that took it — a hit
			assert.equal(store.meta.revertNotice, null, "a hit clears any earlier notice");
			dispose();
		});
	});
});

test("I1: revertNotice does not survive a re-identify to a different machine", () => {
	withLocalStorage(() => {
		const A = openMachineStore({ kind: "board", uniqueId: "A" });
		const B = openMachineStore({ kind: "board", uniqueId: "B" });
		createRoot(dispose => {
			const [ms, setMs] = createSignal<MachineStore | null>(null);
			const store = createConfigStore({ machineStore: ms });

			setMs(A);
			store.setAxisRole("U", "A's Z motor");
			store.snapshot("on A");

			setMs(B);
			store.revert(0); // a miss on B — sets the notice
			assert.notEqual(store.meta.revertNotice, null);

			setMs(A); // re-identify: the notice named a fact about B, which is no longer current
			assert.equal(store.meta.revertNotice, null, "a stale notice must not follow identity to a new machine");
			dispose();
		});
	});
});

// GIT_86 finding 3: createConfigStore's construction-time createComputed runs
// hydrateMachine -> commit -> persistCache synchronously, so BOTH
// writePersonCache and writeMachineOverlay (via MachineStore.set) can run
// before createConfigStore ever returns. Before this fix, neither caught a
// storage write failure, so a quota-exceeded or storage-blocked browser threw
// straight out of construction — and therefore out of App() — where a failed
// write must instead mean "does not survive a reload", never a blank app.
test("a storage that throws on every write does not prevent the config store from being constructed, with an ALREADY-identified machine", () => {
	const g = globalThis as { localStorage?: unknown };
	const prior = g.localStorage;
	g.localStorage = {
		getItem: () => null,
		setItem: () => { throw new DOMException("QuotaExceededError"); },
		removeItem: () => { throw new DOMException("QuotaExceededError"); },
		length: 0,
		key: () => null,
	};
	try {
		const A = openMachineStore({ kind: "board", uniqueId: "A" });
		createRoot(dispose => {
			const [ms] = createSignal<MachineStore | null>(A);
			let store: ReturnType<typeof createConfigStore> | undefined;
			assert.doesNotThrow(() => { store = createConfigStore({ machineStore: ms }); },
				"construction must survive a storage that throws on every write — this is the createComputed path, not an edit made later");
			// The store still works in memory even though nothing it writes can
			// reach disk — a failed write must degrade to "won't survive a
			// reload", not to a store that never came into being.
			store!.setAxisRole("U", "in memory only");
			assert.equal(store!.config.axisRoles.U, "in memory only");
			dispose();
		});
	} finally { g.localStorage = prior; }
});

test("a storage that throws on every write does not prevent the config store from being constructed, with NO identified machine (person-only path)", () => {
	const g = globalThis as { localStorage?: unknown };
	const prior = g.localStorage;
	g.localStorage = {
		getItem: () => null,
		setItem: () => { throw new DOMException("QuotaExceededError"); },
		removeItem: () => { throw new DOMException("QuotaExceededError"); },
		length: 0,
		key: () => null,
	};
	try {
		createRoot(dispose => {
			const [ms] = createSignal<MachineStore | null>(null);
			let store: ReturnType<typeof createConfigStore> | undefined;
			// This path exercises writePersonCache alone (no MachineStore involved
			// at all) — the other half of the fix.
			assert.doesNotThrow(() => { store = createConfigStore({ machineStore: ms }); });
			store!.setThermalColors({ hot: "#ff0000" });
			assert.equal(store!.config.thermalColors.hot, "#ff0000");
			dispose();
		});
	} finally { g.localStorage = prior; }
});
