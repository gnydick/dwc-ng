/**
 * The DSF diff applier (connector/dsfModel.ts) — design D1/D2/D3,
 * invariants C2/C3/C4/C5. Pure module, pure tests: raw frames in, digests
 * and snapshots out.
 *
 * The load-bearing pins:
 * - DSF array semantics are FULL-LENGTH authority — shrink truncates,
 *   which the store's grow-only live-patch path cannot express (why this
 *   module exists at all);
 * - C4 A/B: layer data travels ONLY on the digest's layers channel; a job
 *   snapshot carries layers: [] always;
 * - C5 A/B: messages become replies and can NEVER enter a snapshot;
 * - C3: a prototype-reaching key anywhere in a frame is dead on arrival
 *   (mirrors proto-pollution.test.ts);
 * - snapshots and digests are independent clones — caller mutation cannot
 *   corrupt the copy, later merges cannot reach emitted values.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDsfModel, type DsfModel } from "../src/dsfModel.ts";

/** Assert Object.prototype did not gain `name`; clean up if it somehow did,
 *  so one failing construction can't cascade into unrelated tests. */
function assertUnpolluted(name: string): void {
	const probe = {} as Record<string, unknown>;
	const leaked = probe[name];
	if (leaked !== undefined) delete (Object.prototype as Record<string, unknown>)[name];
	assert.equal(leaked, undefined, `Object.prototype gained "${name}"`);
}

/** A fresh full frame per call — tests must never share mutable fixtures. */
const fullFrame = (): Record<string, unknown> => ({
	state: { status: "idle", currentTool: -1 },
	heat: { heaters: [{ current: 20, state: "off" }, { current: 21, state: "off" }, { current: 22, state: "off" }] },
	move: { axes: [{ letter: "X", homed: false, machinePosition: 0 }, { letter: "Y", homed: false, machinePosition: 0 }] },
	job: { duration: 5, layer: 2, layers: [{ height: 0.2 }, { height: 0.4 }] },
	seqs: { reply: 3 },
	messages: [{ time: "2026-07-23T00:00:00", type: 0, content: "connected" }],
});

const connected = (): DsfModel => {
	const model = createDsfModel();
	model.applyFull(fullFrame());
	return model;
};

test("a full frame digests every model key and extracts the channels", () => {
	const model = createDsfModel();
	const digest = model.applyFull(fullFrame());
	assert.deepEqual(digest.touchedKeys, ["state", "heat", "move", "job"], "channels (messages/seqs) are not model keys");
	assert.deepEqual(digest.replies, ["connected"]);
	assert.deepEqual(digest.layers, [{ height: 0.2 }, { height: 0.4 }]);
	assert.deepEqual(model.snapshot("state"), { status: "idle", currentTool: -1 });
	assert.equal(model.snapshot("seqs"), undefined, "seqs is standalone-only protocol state — inert");
	assert.deepEqual(model.snapshot("messages"), [], "the copy pins messages: []");
	assert.deepEqual(model.snapshot("job"), { duration: 5, layer: 2, layers: [] }, "C4: job snapshots pin layers: []");
});

test("diff: absent keys are unchanged, present primitives replace", () => {
	const model = connected();
	const digest = model.applyDiff({ state: { status: "processing" } });
	assert.deepEqual(digest.touchedKeys, ["state"]);
	assert.equal(digest.layers, null);
	assert.deepEqual(model.snapshot("state"), { status: "processing", currentTool: -1 }, "currentTool untouched by the partial diff");
	assert.deepEqual(model.snapshot("heat"), fullFrame()["heat"], "untouched subtree identical");
});

test("diff: null replaces a whole subtree, and an object can replace null back", () => {
	const model = connected();
	assert.deepEqual(model.applyDiff({ heat: null }).touchedKeys, ["heat"]);
	assert.equal(model.snapshot("heat"), null);
	assert.deepEqual(model.applyDiff({ heat: { heaters: [{ current: 55 }] } }).touchedKeys, ["heat"]);
	assert.deepEqual(model.snapshot("heat"), { heaters: [{ current: 55 }] });
});

test("array SHRINK: a shorter patch array truncates the copy", () => {
	// The store's live-patch merge is grow-only — this truncation is the
	// behavior only this module can provide (design D1).
	const model = connected();
	const digest = model.applyDiff({ heat: { heaters: [{ current: 25 }] } });
	assert.deepEqual(digest.touchedKeys, ["heat"]);
	const heat = model.snapshot("heat") as { heaters: unknown[] };
	assert.equal(heat.heaters.length, 1, "3 heaters truncated to 1");
	assert.deepEqual(heat.heaters[0], { current: 25, state: "off" }, "the surviving element merged, not replaced");
});

test("array GROW: a longer patch array appends", () => {
	const model = connected();
	model.applyDiff({ heat: { heaters: [{}, {}, {}, { current: 100, state: "fault" }] } });
	const heat = model.snapshot("heat") as { heaters: unknown[] };
	assert.equal(heat.heaters.length, 4);
	assert.deepEqual(heat.heaters[0], { current: 20, state: "off" }, "an empty object element changes nothing");
	assert.deepEqual(heat.heaters[3], { current: 100, state: "fault" });
});

test("array element-wise merge: an object element is a partial diff in place", () => {
	const model = connected();
	const digest = model.applyDiff({ move: { axes: [{ homed: true }, {}] } });
	assert.deepEqual(digest.touchedKeys, ["move"]);
	const move = model.snapshot("move") as { axes: unknown[] };
	assert.equal(move.axes.length, 2, "full-length patch keeps the length");
	assert.deepEqual(move.axes[0], { letter: "X", homed: true, machinePosition: 0 }, "only the present key changed");
	assert.deepEqual(move.axes[1], { letter: "Y", homed: false, machinePosition: 0 });
});

test("C4 A/B: layers travel on the layers channel and never in a job snapshot", () => {
	const model = connected();
	// A: a layers change produces a non-null layers digest.
	const digest = model.applyDiff({ job: { layer: 3, layers: [{ height: 0.2 }, { height: 0.4 }, { height: 0.6 }] } });
	assert.deepEqual(digest.layers, [{ height: 0.2 }, { height: 0.4 }, { height: 0.6 }]);
	assert.deepEqual(digest.touchedKeys, ["job"], "job.layer changed too");
	// B: the job emission still pins layers: [].
	assert.deepEqual(model.snapshot("job"), { duration: 5, layer: 3, layers: [] });
});

test("a layers-only diff fires the layers channel WITHOUT touching job", () => {
	const model = connected();
	// Element-wise partial merge inside the layers array itself.
	const digest = model.applyDiff({ job: { layers: [{}, { duration: 12 }] } });
	assert.deepEqual(digest.touchedKeys, [], "the job emission would be identical — no phantom key");
	assert.deepEqual(digest.layers, [{ height: 0.2 }, { height: 0.4, duration: 12 }]);
});

test("new-print shrink: layers to empty digests [] (reset), not null", () => {
	const model = connected();
	const digest = model.applyDiff({ job: { layers: [] } });
	assert.notEqual(digest.layers, null, "a shrink-to-empty must reach the store");
	assert.deepEqual(digest.layers, []);
	// And an unrelated job diff afterwards leaves the channel silent.
	assert.equal(model.applyDiff({ job: { duration: 6 } }).layers, null);
});

test("applyFull always re-asserts layer truth, even without a job subtree", () => {
	const model = connected();
	const digest = model.applyFull({ state: { status: "idle" } });
	assert.deepEqual(digest.layers, [], "reconnect without layers = reset, not silence");
	assert.deepEqual(digest.touchedKeys, ["state"]);
});

test("C5 A: messages become severity-prefixed replies, tolerantly", () => {
	const model = connected();
	const digest = model.applyDiff({
		messages: [
			{ time: "2026-07-23T01:00:00", type: 2, content: "Short-to-ground" },
			{ type: 1, content: "heater near limit" },
			{ type: 0, content: "done" },
			{ content: "bare content" },
			{ type: "error", content: "string severity" },
			{ type: "warning", content: "string severity too" },
			{ type: 2 },
			{ type: 1, content: "" },
			"junk",
			null,
			42,
		],
	});
	assert.deepEqual(digest.replies, [
		"Error: Short-to-ground",
		"Warning: heater near limit",
		"done",
		"bare content",
		"Error: string severity",
		"Warning: string severity too",
	]);
	assert.deepEqual(digest.touchedKeys, [], "a consumed channel is not a model change");
});

test("C5 B: no sequence of frames can put messages into a snapshot", () => {
	const model = connected();
	model.applyDiff({ messages: [{ type: 2, content: "x" }] });
	model.applyDiff({ messages: { evil: "not an array" } });
	model.applyDiff({ messages: null });
	model.applyDiff({ messages: [["nested"]] });
	const full = fullFrame();
	full["messages"] = [{ type: 1, content: "carried on a full frame" }];
	const digest = model.applyFull(full);
	assert.deepEqual(digest.replies, ["Warning: carried on a full frame"], "full frames strip messages too");
	assert.deepEqual(model.snapshot("messages"), [], "pinned [] through every path");
	assert.equal(digest.touchedKeys.includes("messages"), false);
});

test("C3: a __proto__ key at the top level is dead on arrival", () => {
	const model = connected();
	const digest = model.applyDiff(JSON.parse('{"state":{"status":"processing"},"__proto__":{"pollutedDsfTop":true}}'));
	assert.deepEqual(digest.touchedKeys, ["state"]);
	assertUnpolluted("pollutedDsfTop");
	assert.equal(model.snapshot("__proto__"), undefined, "never stored, and never read through the prototype chain");
});

test("C3: a nested __proto__ cannot merge into Object.prototype", () => {
	// The classic vector: recursive merge where target["__proto__"] IS
	// Object.prototype — safeEntries removes the key from iteration.
	const model = connected();
	model.applyDiff(JSON.parse('{"heat":{"__proto__":{"pollutedDsfNested":true},"heaters":[]}}'));
	assertUnpolluted("pollutedDsfNested");
	assert.deepEqual(model.snapshot("heat"), { heaters: [] });
});

test("C3: a __proto__ inside a replaced array element is stripped by the clone", () => {
	const model = connected();
	model.applyDiff(JSON.parse('{"tools":[{"__proto__":{"pollutedDsfArr":true},"number":0}]}'));
	assertUnpolluted("pollutedDsfArr");
	const tools = model.snapshot("tools") as Record<string, unknown>[];
	assert.deepEqual(tools[0], { number: 0 });
	assert.equal(Object.getPrototypeOf(tools[0]), Object.prototype, "the stored element was not re-prototyped");
	// Merge path (element already exists in the copy) is guarded the same way.
	model.applyDiff(JSON.parse('{"tools":[{"__proto__":{"pollutedDsfMerge":true},"name":"T0"}]}'));
	assertUnpolluted("pollutedDsfMerge");
	assert.deepEqual((model.snapshot("tools") as unknown[])[0], { number: 0, name: "T0" });
});

test("C3: a hostile full frame is sanitized like any diff", () => {
	const model = createDsfModel();
	model.applyFull(JSON.parse('{"state":{"status":"idle"},"__proto__":{"pollutedDsfFull":true}}'));
	assertUnpolluted("pollutedDsfFull");
	assert.deepEqual(model.snapshot("state"), { status: "idle" });
});

test("unknown top-level keys pass through (the OM inspector renders them)", () => {
	const model = connected();
	const digest = model.applyDiff({ scanner: { status: "idle", progress: 0.5 } });
	assert.deepEqual(digest.touchedKeys, ["scanner"]);
	assert.deepEqual(model.snapshot("scanner"), { status: "idle", progress: 0.5 });
});

test("deterministic touchedKeys: an identical diff the second time touches nothing", () => {
	const model = connected();
	const diff = (): unknown => ({
		state: { status: "processing" },
		move: { axes: [{ homed: true }, { homed: false }] },
		job: { duration: 9, layers: [{ height: 0.2 }, { height: 0.4 }, { height: 0.6 }] },
	});
	const first = model.applyDiff(diff());
	assert.deepEqual(first.touchedKeys, ["state", "move", "job"]);
	assert.notEqual(first.layers, null);
	const second = model.applyDiff(diff());
	assert.deepEqual(second.touchedKeys, [], "no phantom keys when a diff changes nothing");
	assert.equal(second.layers, null, "no phantom layers emission either");
});

test("snapshots are independent clones — caller mutation cannot corrupt the copy", () => {
	const model = connected();
	const stolen = model.snapshot("heat") as { heaters: Record<string, unknown>[] };
	stolen.heaters[0]!["current"] = 999;
	stolen.heaters.push({ forged: true });
	const again = model.snapshot("heat") as { heaters: Record<string, unknown>[] };
	assert.equal(again.heaters[0]!["current"], 20);
	assert.equal(again.heaters.length, 3);
});

test("digest layers are independent clones — later merges cannot reach them", () => {
	const model = connected();
	const digest = model.applyDiff({ job: { layers: [{ height: 0.2 }, { height: 0.4 }, { height: 0.6 }] } });
	const emitted = digest.layers as Record<string, unknown>[];
	model.applyDiff({ job: { layers: [{ height: 0.2 }, { height: 0.4 }, { height: 0.9 }] } });
	assert.deepEqual(emitted[2], { height: 0.6 }, "the earlier emission still reads what it read");
	emitted[2]!["height"] = 123;
	assert.deepEqual((model.applyDiff({ job: { layers: [{}, {}, {}, { height: 1.2 }] } }).layers as unknown[])[2], { height: 0.9 });
});

test("mutating the raw frame after apply cannot reach the copy", () => {
	const model = connected();
	const raw = { tools: [{ number: 0, name: "T0" }] };
	model.applyDiff(raw);
	raw.tools[0]!.number = 99;
	assert.deepEqual((model.snapshot("tools") as unknown[])[0], { number: 0, name: "T0" });
});

test("reconnect full frame replaces wholesale — vanished keys stop existing", () => {
	const model = connected();
	model.applyDiff({ scanner: { status: "idle" } });
	const digest = model.applyFull({ state: { status: "idle" }, heat: { heaters: [] } });
	assert.deepEqual(digest.touchedKeys, ["state", "heat"]);
	assert.equal(model.snapshot("scanner"), undefined, "no partial-resume state exists (C8)");
	assert.equal(model.snapshot("move"), undefined);
});

test("totality: non-object frames and a diff-before-full are defined no-ops or plain merges", () => {
	const model = createDsfModel();
	assert.deepEqual(model.applyDiff("garbage"), { touchedKeys: [], layers: null, replies: [] });
	assert.deepEqual(model.applyFull(null), { touchedKeys: [], layers: [], replies: [] });
	const digest = model.applyDiff({ state: { status: "starting" } });
	assert.deepEqual(digest.touchedKeys, ["state"], "a diff before any full frame still merges");
	assert.deepEqual(model.snapshot("state"), { status: "starting" });
});
