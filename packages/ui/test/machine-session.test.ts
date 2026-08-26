import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "solid-js";
import { createMachineSession } from "../src/config/machineSession.ts";
import { createOmStore } from "../src/om/store.ts";

test("before boards land, there is no store to write through", () => {
	createRoot(dispose => {
		const om = createOmStore();
		const session = createMachineSession(om.om);
		assert.equal(session.id().kind, "unidentified");
		assert.equal(session.store(), null, "no handle means no machine-scoped read is even expressible");
		dispose();
	});
});

test("identity appears when the boards key lands, and the store follows", () => {
	createRoot(dispose => {
		const om = createOmStore();
		const session = createMachineSession(om.om);
		om.events.onModelKey?.("boards", [{ canAddress: 0, uniqueId: "LIVE-1", accelerometer: null }]);
		assert.deepEqual(session.id(), { kind: "board", uniqueId: "LIVE-1" });
		assert.equal(session.store()?.id.kind, "board");
		dispose();
	});
});

test("the MAC fallback lands from the network key alone", () => {
	createRoot(dispose => {
		const om = createOmStore();
		const session = createMachineSession(om.om);
		om.events.onModelKey?.("boards", [{ canAddress: 0, accelerometer: null }]);
		assert.equal(session.id().kind, "unidentified");
		om.events.onModelKey?.("network", { interfaces: [{ mac: "2C:CF:67:CF:F5:50" }] });
		assert.deepEqual(session.id(), { kind: "mac", mac: "2C:CF:67:CF:F5:50" });
		dispose();
	});
});

test("the store handle is stable while the id is unchanged", () => {
	// Consumers key effects off it; a new object per poll would re-run every
	// hydrate and thrash the console and the layouts.
	createRoot(dispose => {
		const om = createOmStore();
		const session = createMachineSession(om.om);
		om.events.onModelKey?.("boards", [{ canAddress: 0, uniqueId: "LIVE-1", accelerometer: null }]);
		const first = session.store();
		om.events.onModelKey?.("boards", [{ canAddress: 0, uniqueId: "LIVE-1", accelerometer: null, mcuTemp: { current: 41 } }]);
		assert.equal(session.store(), first, "same machine, same handle");
		dispose();
	});
});

test("the store handle is stable when a second board joins and the main board doesn't change", () => {
	// A tool/expansion board coming online CAN-side changes boards.length,
	// which mainBoard()'s .find() reads while walking the array — so the id
	// memo body DOES re-execute here (unlike the mcuTemp-only mutation
	// above) and would mint a fresh MachineId object if not for the memo's
	// content-equals comparator. This is the one case whose outcome
	// actually depends on that comparator.
	createRoot(dispose => {
		const om = createOmStore();
		const session = createMachineSession(om.om);
		om.events.onModelKey?.("boards", [{ canAddress: 0, uniqueId: "LIVE-1", accelerometer: null }]);
		const first = session.store();
		om.events.onModelKey?.("boards", [
			{ canAddress: 0, uniqueId: "LIVE-1", accelerometer: null },
			{ canAddress: 5, uniqueId: "TOOL-1", accelerometer: null },
		]);
		assert.equal(session.store(), first, "same main board, same handle, despite the array growing");
		dispose();
	});
});

test("a mainboard swap re-keys rather than carrying settings over", () => {
	createRoot(dispose => {
		const om = createOmStore();
		const session = createMachineSession(om.om);
		om.events.onModelKey?.("boards", [{ canAddress: 0, uniqueId: "LIVE-1", accelerometer: null }]);
		const first = session.store();
		om.events.onModelKey?.("boards", [{ canAddress: 0, uniqueId: "LIVE-2", accelerometer: null }]);
		assert.notEqual(session.store(), first);
		assert.deepEqual(session.id(), { kind: "board", uniqueId: "LIVE-2" });
		dispose();
	});
});
