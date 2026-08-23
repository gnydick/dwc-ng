/**
 * The OM per-key shape gate (audit M8). The iterated fields the UI renders
 * (move.axes.filter, heat.heaters.some, job.layers totals) are guaranteed
 * at the store's single entry: unusable subtrees keep the last good value,
 * legitimately-sparse subtrees are conformed to the promised shape — the
 * 2026-07-23 layerStats incident (a board serving job WITHOUT layers)
 * must render, not crash.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { conformModelKey } from "../src/om/types.ts";
import { createOmStore } from "../src/om/store.ts";

test("unusable top-level shapes are rejected — the store keeps last good", () => {
	assert.deepEqual(conformModelKey("move", "garbage"), { ok: false });
	assert.deepEqual(conformModelKey("heat", 42), { ok: false });
	assert.deepEqual(conformModelKey("tools", { not: "an array" }), { ok: false });
	assert.deepEqual(conformModelKey("boards", null), { ok: false });

	const store = createOmStore();
	store.events.onModelKey?.("move", { axes: [{ letter: "X" }] });
	store.events.onModelKey?.("move", "garbage");
	assert.equal((store.om.move.axes[0] as { letter: string }).letter, "X", "last good subtree survives");
});

test("the layerStats incident shape: job without layers conforms, never crashes", () => {
	const gated = conformModelKey("job", { file: { fileName: "x.gcode" }, duration: 12 });
	assert.equal(gated.ok, true);
	if (gated.ok) {
		const job = gated.value as Record<string, unknown>;
		assert.deepEqual(job.layers, [], "the promised array exists even when the board omits it");
		assert.equal(job.duration, 12, "served fields win");
		assert.ok(typeof job.timesLeft === "object" && job.timesLeft !== null, "promised containers filled");
	}
});

test("mis-typed iterated fields are replaced with safe defaults", () => {
	const heat = conformModelKey("heat", { heaters: "x", bedHeaters: [0], chamberHeaters: null });
	assert.ok(heat.ok);
	if (heat.ok) {
		const v = heat.value as Record<string, unknown>;
		assert.deepEqual(v.heaters, []);
		assert.deepEqual(v.bedHeaters, [0]);
		assert.deepEqual(v.chamberHeaters, []);
	}
	const sensors = conformModelKey("sensors", { gpIn: [{ value: 1 }], endstops: 5 });
	assert.ok(sensors.ok);
	if (sensors.ok) {
		const v = sensors.value as Record<string, unknown>;
		assert.deepEqual(v.gpIn, [{ value: 1 }]);
		assert.deepEqual(v.endstops, []);
	}
});

test("unknown keys pass through untouched — the model stays open", () => {
	const gated = conformModelKey("network", { interfaces: [{ ip: "10.0.0.5" }] });
	assert.deepEqual(gated, { ok: true, value: { interfaces: [{ ip: "10.0.0.5" }] } });
});

test("good subtrees pass through with served values intact", () => {
	const move = conformModelKey("move", {
		axes: [{ letter: "X", homed: true }],
		extruders: [],
		currentMove: { requestedSpeed: 50, topSpeed: 60 },
		speedFactor: 1.2,
	});
	assert.ok(move.ok);
	if (move.ok) {
		const v = move.value as Record<string, unknown>;
		assert.deepEqual(v.axes, [{ letter: "X", homed: true }]);
		assert.equal(v.speedFactor, 1.2);
	}
});

test("currentMove's numbers are parsed, not waved through", () => {
	const move = conformModelKey("move", {
		axes: [],
		extruders: [],
		currentMove: { requestedSpeed: "fast", topSpeed: 87.4, extrusionRate: null },
	});
	assert.ok(move.ok);
	if (move.ok) {
		const cm = (move.value as Record<string, unknown>).currentMove as Record<string, unknown>;
		assert.equal(cm.requestedSpeed, null, "a string becomes null, not a string reaching toFixed()");
		assert.equal(cm.topSpeed, 87.4, "good neighbours survive");
		assert.equal(cm.extrusionRate, null);
	}
});

test("a move subtree with no currentMove still conforms to the promised shape", () => {
	const move = conformModelKey("move", { axes: [], extruders: [] });
	assert.ok(move.ok);
	if (move.ok) {
		const cm = (move.value as Record<string, unknown>).currentMove as Record<string, unknown>;
		assert.deepEqual(cm, { requestedSpeed: null, topSpeed: null, extrusionRate: null });
	}
});

// Measured 2026-08-01 while considering routing the live patch route through
// this function: it FILLS IN absent arrays from defaults, which is right for a
// wholesale subtree (the whole truth) and wrong for a partial patch (absence
// means "unchanged"). Pinned so the difference stays visible to whoever tries.
test("conform COMPLETES a subtree from defaults — which a partial patch must not do", () => {
	const r = conformModelKey("heat", { heaters: [{ current: 210 }] });
	assert.equal(r.ok, true);
	const value = (r as { ok: true; value: Record<string, unknown> }).value;
	assert.deepEqual(value.bedHeaters, [], "absent arrays are invented, not left absent");
	assert.deepEqual(value.chamberHeaters, []);
	// Deep-merged into a store that HAS bed heaters, those empties would replace
	// them. That is why om-entry-shape-gate cannot simply reuse this on the
	// patch route, and why om/speeds.ts's second parse is load bearing.
});

// Input shaping (move.shaping) and the per-board accelerometer, added for the
// Shaping Lab. Both are read by code that indexes into them — the shaper
// summary reads shaping.amplitudes[i]/delays[i] pairwise, and the accelerometer
// presence decides whether a board can be captured from at all — so the gate
// owes them the same promised shape it owes job.layers.
test("a move subtree with no shaping conforms to the off shaper", () => {
	const move = conformModelKey("move", { axes: [], extruders: [] });
	assert.ok(move.ok);
	if (move.ok) {
		const shaping = (move.value as Record<string, unknown>).shaping as Record<string, unknown>;
		assert.deepEqual(shaping, { type: "none", frequency: 0, damping: 0, amplitudes: [], delays: [] });
	}
});

test("travel acceleration is parsed, and its absence stays absent rather than defaulting", () => {
	const served = conformModelKey("move", { axes: [], extruders: [], travelAcceleration: 8000 });
	assert.ok(served.ok);
	if (served.ok) assert.equal((served.value as Record<string, unknown>).travelAcceleration, 8000);

	const silent = conformModelKey("move", { axes: [], extruders: [] });
	assert.ok(silent.ok);
	if (silent.ok) {
		assert.equal((silent.value as Record<string, unknown>).travelAcceleration, null,
			"a board that did not report it must not read as RRF's 10000 default");
	}

	const rubbish = conformModelKey("move", { axes: [], extruders: [], travelAcceleration: "fast" });
	assert.ok(rubbish.ok);
	if (rubbish.ok) assert.equal((rubbish.value as Record<string, unknown>).travelAcceleration, null);
});

test("a served shaper passes through intact", () => {
	const move = conformModelKey("move", {
		axes: [], extruders: [],
		shaping: {
			type: "ei2", frequency: 52, damping: 0.075,
			amplitudes: [0.335, 0.2641, 0.2242, 0.1767],
			delays: [0, 0.00972, 0.0278, 0.03752],
		},
	});
	assert.ok(move.ok);
	if (move.ok) {
		const s = (move.value as Record<string, unknown>).shaping as Record<string, unknown>;
		assert.equal(s.type, "ei2");
		assert.equal(s.frequency, 52);
		assert.equal(s.damping, 0.075);
		assert.deepEqual(s.amplitudes, [0.335, 0.2641, 0.2242, 0.1767]);
		assert.deepEqual(s.delays, [0, 0.00972, 0.0278, 0.03752]);
	}
});

test("a mis-typed shaper falls back to the off shaper's fields, not to strings", () => {
	const move = conformModelKey("move", {
		axes: [], extruders: [],
		shaping: { type: 7, frequency: "52", damping: null, amplitudes: "x", delays: [1, "2"] },
	});
	assert.ok(move.ok);
	if (move.ok) {
		const s = (move.value as Record<string, unknown>).shaping as Record<string, unknown>;
		assert.equal(s.type, "none", "a non-string type is not a shaper name");
		assert.equal(s.frequency, 0);
		assert.equal(s.damping, 0);
		assert.deepEqual(s.amplitudes, []);
		// Pairwise with delays: one bad element invalidates the whole vector,
		// because dropping it would silently re-pair amplitudes to delays.
		assert.deepEqual(s.delays, []);
	}
});

test("a shaping key that is not an object costs the shaper, not the move subtree", () => {
	const move = conformModelKey("move", { axes: [{ letter: "X" }], extruders: [], shaping: "ei2" });
	assert.ok(move.ok);
	if (move.ok) {
		const v = move.value as Record<string, unknown>;
		assert.deepEqual(v.axes, [{ letter: "X" }], "the rest of the subtree survives");
		assert.deepEqual((v.shaping as Record<string, unknown>).type, "none");
	}
});

test("a board without an accelerometer conforms to null, not to absent", () => {
	const boards = conformModelKey("boards", [{ shortName: "MB6HC", canAddress: 0 }]);
	assert.ok(boards.ok);
	if (boards.ok) {
		const b = (boards.value as Record<string, unknown>[])[0]!;
		assert.equal(b.accelerometer, null);
		assert.equal(b.shortName, "MB6HC", "served fields survive");
	}
});

test("a board's accelerometer passes through", () => {
	const boards = conformModelKey("boards", [
		{ shortName: "TOOL1LC", canAddress: 20, accelerometer: { orientation: 41, points: 0, runs: 3 } },
	]);
	assert.ok(boards.ok);
	if (boards.ok) {
		const b = (boards.value as Record<string, unknown>[])[0]!;
		assert.deepEqual(b.accelerometer, { orientation: 41, points: 0, runs: 3 });
	}
});

test("board entries that cannot be a board become null, not garbage the card iterates", () => {
	const boards = conformModelKey("boards", [null, "MB6HC", { shortName: "EXP3HC", accelerometer: 5 }]);
	assert.ok(boards.ok);
	if (boards.ok) {
		const v = boards.value as unknown[];
		assert.equal(v[0], null, "a null slot stays a null slot");
		assert.equal(v[1], null, "a scalar entry is not a board");
		assert.equal((v[2] as Record<string, unknown>).accelerometer, null, "a scalar accelerometer is no accelerometer");
	}
});

test("a mis-typed accelerometer keeps the board and defaults its numbers", () => {
	const boards = conformModelKey("boards", [
		{ shortName: "TOOL1LC", accelerometer: { orientation: "41", points: null, runs: 3 } },
	]);
	assert.ok(boards.ok);
	if (boards.ok) {
		const b = (boards.value as Record<string, unknown>[])[0]!;
		// 20 is RRF's own default orientation (reference/objectmodel/src/boards/index.ts:8).
		assert.deepEqual(b.accelerometer, { orientation: 20, points: 0, runs: 3 });
	}
});
