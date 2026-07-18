import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCameraViewState, serializeCameraViewState, DEFAULT_CAMERA_VIEW_STATE } from "../src/shell/cameraViewState.ts";

test("parseCameraViewState tolerates missing or corrupt storage", () => {
	assert.deepEqual(parseCameraViewState(null), DEFAULT_CAMERA_VIEW_STATE);
	assert.deepEqual(parseCameraViewState(""), DEFAULT_CAMERA_VIEW_STATE);
	assert.deepEqual(parseCameraViewState("{not json"), DEFAULT_CAMERA_VIEW_STATE);
	assert.deepEqual(parseCameraViewState('"a string"'), DEFAULT_CAMERA_VIEW_STATE);
	assert.deepEqual(parseCameraViewState("42"), DEFAULT_CAMERA_VIEW_STATE);
});

test("parseCameraViewState falls back field-by-field on partial/malformed data", () => {
	assert.deepEqual(parseCameraViewState(JSON.stringify({})), DEFAULT_CAMERA_VIEW_STATE);
	assert.deepEqual(
		parseCameraViewState(JSON.stringify({ native: true, scrollLeft: "nope", scrollTop: 40 })),
		{ native: true, scrollLeft: 0, scrollTop: 40 },
	);
	assert.deepEqual(
		parseCameraViewState(JSON.stringify({ native: "yes", scrollLeft: Number.NaN, scrollTop: Infinity })),
		{ native: false, scrollLeft: 0, scrollTop: 0 },
	);
});

test("serialize -> parse round-trips", () => {
	const state = { native: true, scrollLeft: 123, scrollTop: 456 };
	assert.deepEqual(parseCameraViewState(serializeCameraViewState(state)), state);
});
