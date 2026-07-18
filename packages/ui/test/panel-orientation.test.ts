import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOrientationState, serializeOrientationState, toggledOrientation } from "../src/shell/panelOrientation.ts";

test("parseOrientationState tolerates missing or corrupt storage", () => {
	assert.deepEqual(parseOrientationState(null), {});
	assert.deepEqual(parseOrientationState(""), {});
	assert.deepEqual(parseOrientationState("{not json"), {});
	assert.deepEqual(parseOrientationState('"a string"'), {});
	assert.deepEqual(parseOrientationState("42"), {});
});

test("parseOrientationState drops entries with an invalid orientation value, keeps good ones", () => {
	const raw = JSON.stringify({ position: "horizontal", fans: "sideways", sensors: "vertical", tools: 1 });
	assert.deepEqual(parseOrientationState(raw), { position: "horizontal", sensors: "vertical" });
});

test("serialize -> parse round-trips", () => {
	const state = { position: "horizontal" as const, sensors: "vertical" as const };
	assert.deepEqual(parseOrientationState(serializeOrientationState(state)), state);
});

test("toggledOrientation flips between vertical and horizontal", () => {
	assert.equal(toggledOrientation("vertical"), "horizontal");
	assert.equal(toggledOrientation("horizontal"), "vertical");
});
