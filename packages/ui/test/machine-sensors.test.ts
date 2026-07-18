import { test } from "node:test";
import assert from "node:assert/strict";
import { sensorRows, endstopKey, filamentKey, probeKey } from "../src/views/machine.sensors.ts";
import type { Axis, Sensors } from "../src/om/types.ts";

const axis = (letter: string): Axis => ({
	letter, homed: true, machinePosition: 0, userPosition: 0, min: 0, max: 200, babystep: 0, visible: true,
});

const emptySensors = (): Sensors => ({ gpIn: [], endstops: [], filamentMonitors: [], probes: [] });

test("endstops: null slots are omitted, labeled by matching axis letter", () => {
	const sensors = emptySensors();
	sensors.endstops = [{ triggered: false }, null, { triggered: true }];
	const rows = sensorRows(sensors, [axis("X"), axis("Y"), axis("Z")]);
	assert.deepEqual(rows, [
		{ key: "endstop:0", label: "X endstop", ok: true, state: "Clear" },
		{ key: "endstop:2", label: "Z endstop", ok: false, state: "Triggered" },
	]);
});

test("endstops: falls back to an index label when axes are shorter than endstops", () => {
	const sensors = emptySensors();
	sensors.endstops = [{ triggered: false }];
	assert.deepEqual(sensorRows(sensors, []), [{ key: "endstop:0", label: "Endstop 0", ok: true, state: "Clear" }]);
});

test("filament monitors: noMonitor and null are omitted, other statuses map to green/yellow", () => {
	const sensors = emptySensors();
	sensors.filamentMonitors = [
		{ status: "ok" },
		{ status: "noMonitor" },
		null,
		{ status: "noFilament" },
		{ status: "sensorError" },
	];
	const rows = sensorRows(sensors, []);
	assert.deepEqual(rows, [
		{ key: "filament:0", label: "Extruder 0 filament", ok: true, state: "OK" },
		{ key: "filament:3", label: "Extruder 3 filament", ok: false, state: "No filament" },
		{ key: "filament:4", label: "Extruder 4 filament", ok: false, state: "Sensor error" },
	]);
});

test("filament monitors: unrecognized status still shown, falls back to the raw string", () => {
	const sensors = emptySensors();
	sensors.filamentMonitors = [{ status: "somethingNew" }];
	assert.deepEqual(sensorRows(sensors, []), [{ key: "filament:0", label: "Extruder 0 filament", ok: false, state: "somethingNew" }]);
});

test("probes: type none and null are omitted; triggered is reading >= threshold", () => {
	const sensors = emptySensors();
	sensors.probes = [
		{ type: 0, value: [999], threshold: 500 }, // configured type=none -> omitted
		null,
		{ type: 8, value: [200], threshold: 500 },
		{ type: 8, value: [500], threshold: 500 }, // exactly at threshold counts as triggered
	];
	const rows = sensorRows(sensors, []);
	assert.deepEqual(rows, [
		{ key: "probe:2", label: "Probe 2", ok: true, state: "200" },
		{ key: "probe:3", label: "Probe 3", ok: false, state: "Triggered" },
	]);
});

test("probes: missing value entry treated as 0", () => {
	const sensors = emptySensors();
	sensors.probes = [{ type: 8, value: [], threshold: 500 }];
	assert.deepEqual(sensorRows(sensors, []), [{ key: "probe:0", label: "Probe 0", ok: true, state: "0" }]);
});

test("combines all three kinds in endstops -> filament -> probes order", () => {
	const sensors: Sensors = {
		gpIn: [],
		endstops: [{ triggered: true }],
		filamentMonitors: [{ status: "ok" }],
		probes: [{ type: 8, value: [0], threshold: 500 }],
	};
	const rows = sensorRows(sensors, [axis("X")]);
	assert.deepEqual(rows.map(r => r.label), ["X endstop", "Extruder 0 filament", "Probe 0"]);
});

test("names overrides the auto-generated label when set for that key", () => {
	const sensors: Sensors = {
		gpIn: [],
		endstops: [{ triggered: false }],
		filamentMonitors: [{ status: "ok" }],
		probes: [{ type: 8, value: [0], threshold: 500 }],
	};
	const names = {
		[endstopKey(0)]: "Bed leveling switch",
		[filamentKey(0)]: "Main extruder sensor",
		[probeKey(0)]: "BLTouch",
	};
	const rows = sensorRows(sensors, [axis("X")], names);
	assert.deepEqual(rows.map(r => r.label), ["Bed leveling switch", "Main extruder sensor", "BLTouch"]);
});

test("names with an unrelated key doesn't affect unnamed sensors", () => {
	const sensors: Sensors = { gpIn: [], endstops: [{ triggered: false }], filamentMonitors: [], probes: [] };
	const rows = sensorRows(sensors, [axis("X")], { [endstopKey(5)]: "Unrelated" });
	assert.deepEqual(rows[0]!.label, "X endstop");
});
