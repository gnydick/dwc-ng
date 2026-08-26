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
