import { test } from "node:test";
import assert from "node:assert/strict";
import { createOmStore, deepMergeInto } from "../src/om/store.ts";
import { CONSOLE_LIMIT } from "../src/om/consoleLog.ts";
import { createMockServer } from "../../mock-duet/src/server.ts";
import { PollConnector } from "@dwc-ng/connector/testing";

test("onModelKey replaces a subtree wholesale", () => {
	const store = createOmStore();
	store.events.onModelKey!("heat", {
		bedHeaters: [0],
		chamberHeaters: [],
		heaters: [{ active: 60, standby: 0, current: 58.2, max: 140, state: "active" }],
	});
	assert.equal(store.om.heat.heaters[0]!.current, 58.2);

	// Replacement is authoritative: fields not in the new subtree disappear
	store.events.onModelKey!("heat", { bedHeaters: [0], chamberHeaters: [], heaters: [null] });
	assert.equal(store.om.heat.heaters[0], null);
});

test("onModelPatch deep-merges without deleting", () => {
	const store = createOmStore();
	store.events.onModelKey!("state", {
		status: "idle", currentTool: -1, machineMode: "FFF", displayMessage: "hello", upTime: 0,
	});

	store.events.onModelPatch!({ state: { status: "processing", upTime: 42 } });

	assert.equal(store.om.state.status, "processing");
	assert.equal(store.om.state.upTime, 42);
	assert.equal(store.om.state.displayMessage, "hello", "absent fields survive a patch");
});

test("array patches merge element-wise and never truncate", () => {
	const target: Record<string, unknown> = {
		axes: [
			{ letter: "X", homed: true, machinePosition: 10 },
			{ letter: "Y", homed: true, machinePosition: 20 },
			{ letter: "Z", homed: true, machinePosition: 5 },
		],
	};
	deepMergeInto(target, { axes: [{ machinePosition: 11.5 }] });

	const axes = target.axes as any[];
	assert.equal(axes[0].machinePosition, 11.5);
	assert.equal(axes[0].letter, "X", "unpatched fields kept");
	assert.equal(axes.length, 3, "shorter live array does not truncate");
	assert.equal(axes[2].machinePosition, 5);
});

test("console log is a capped ring buffer", () => {
	const store = createOmStore();
	const overflow = 30;
	const total = CONSOLE_LIMIT + overflow;
	for (let i = 0; i < total; i++) store.events.onReply!(`reply ${i}`);
	assert.equal(store.console.length, CONSOLE_LIMIT);
	assert.equal(store.console[0]!.text, `reply ${overflow}`, "oldest lines dropped first");
	assert.equal(store.console.at(-1)!.text, `reply ${total - 1}`);
});

test("end to end: poll → seqs → rr_model → reconcile, mock to store", async () => {
	const mock = createMockServer({ tickMs: 0 });
	const port = await mock.listen(0);
	const store = createOmStore();
	const connector = new PollConnector({
		baseUrl: `http://127.0.0.1:${port}`,
		autoPoll: false,
		retryDelayMs: 10,
		events: store.events,
	});

	try {
		await connector.connect();
		assert.equal(store.connection.status, "connected");
		assert.equal(store.om.move.axes.length, 3, "full sync landed in the store");
		assert.equal(store.om.state.status, "idle");

		// Live values flow through patches
		mock.machine.advance(2000);
		await connector.pollOnce();
		assert.equal(store.om.state.upTime, 2);

		// A discrete event (heater fault) flows through seqs → subtree refetch
		mock.machine.faultHeater(1);
		await connector.pollOnce();
		assert.equal(store.om.heat.heaters[1]!.state, "fault");
		assert.match(store.console.at(-1)!.text, /Heater 1 fault/);

		// A job start replaces several subtrees at once
		mock.machine.startJob("0:/gcodes/benchy.gcode");
		await connector.pollOnce();
		assert.equal(store.om.state.status, "processing");
		assert.equal(store.om.job.file!.fileName, "0:/gcodes/benchy.gcode");
		assert.equal(store.om.tools[0]!.state, "active", "tool subtree refreshed too");
	} finally {
		await connector.disconnect().catch(() => undefined);
		await mock.close();
	}
});

// A dismissed message box arrives as state.messageBox = null. If the live-patch
// merge treated null as "no news" and skipped it, the blocking prompt would
// stay up forever after the machine had already moved on — the operator would
// be staring at a dialog for a box that no longer exists.
test("a null in a live patch clears the value, it does not skip", () => {
	const target: Record<string, unknown> = {
		state: { status: "processing", messageBox: { seq: 3, mode: 2, message: "hi" } },
	};
	deepMergeInto(target, { state: { messageBox: null } });
	assert.equal((target.state as Record<string, unknown>).messageBox, null);
	assert.equal((target.state as Record<string, unknown>).status, "processing", "siblings survive");
});

test("a message box replaces wholesale rather than merging field-by-field", () => {
	// Merging would leave the OLD choices attached to the NEW prompt.
	const target: Record<string, unknown> = {
		state: { messageBox: { seq: 3, mode: 4, message: "first", choices: ["a", "b"] } },
	};
	deepMergeInto(target, { state: { messageBox: null } });
	deepMergeInto(target, { state: { messageBox: { seq: 4, mode: 2, message: "second" } } });
	const box = (target.state as Record<string, unknown>).messageBox as Record<string, unknown>;
	assert.equal(box.seq, 4);
	assert.equal(box.choices, undefined, "stale choices must not survive into the new box");
});
