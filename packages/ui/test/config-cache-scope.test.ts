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
