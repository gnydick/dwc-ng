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
