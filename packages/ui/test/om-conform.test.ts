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
