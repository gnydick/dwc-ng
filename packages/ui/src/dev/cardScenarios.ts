/**
 * Synthetic object-model fixtures for the Card Lab (dev/CardLab.tsx).
 *
 * The point of the lab is to see a card in states that are awkward or slow to
 * reproduce on a live board — mid-print, paused, a latched heater fault. These
 * are hand-built ObjectModel snapshots the lab feeds a card through a private
 * AppContext, so nothing here ever touches a real machine.
 *
 * Modelled on Gabe's toolchanger (7 axes incl. UVW Z-motors + C coupler, 4
 * tools, bed with no standby) so the cards render against a realistic shape.
 */

import type { ObjectModel, Axis, Heater, Tool, Fan, Board } from "../om/types.ts";
import { emptyModel } from "../om/types.ts";

export type ScenarioId = "idle" | "printing" | "paused" | "heater-fault" | "multi-tool";

export interface Scenario {
	id: ScenarioId;
	label: string;
	/** One-line note shown under the picker. */
	note: string;
}

export const SCENARIOS: Scenario[] = [
	{ id: "idle", label: "Idle", note: "Homed, cold, no job." },
	{ id: "printing", label: "Printing", note: "T0 printing at 53%, hot, three diverging time estimates." },
	{ id: "paused", label: "Paused", note: "Same job, paused mid-print." },
	{ id: "heater-fault", label: "Heater fault", note: "Nozzle 1 latched in fault — the M562 reset appears." },
	{ id: "multi-tool", label: "Multi-tool", note: "All four tools warm; T2 active." },
];

const axis = (letter: string, position: number, homed = true, visible = true): Axis => ({
	letter, homed, machinePosition: position, userPosition: position,
	min: 0, max: 320, babystep: 0, visible,
});

const heater = (current: number, active: number, standby: number, state: string): Heater => ({
	active, standby, current, max: 300, state,
});

const tool = (number: number, heaterIndex: number, active: number, standby: number, state: string): Tool => ({
	number, name: `T${number}`, heaters: [heaterIndex], filamentExtruder: number,
	active: [active], standby: [standby], state,
});

const fan = (name: string, value: number, thermostatic: number[] = [], rpm = -1): Fan => ({
	name, actualValue: value, requestedValue: value, rpm, thermostatic: { sensors: thermostatic },
});

/** A cold, homed toolchanger with everything off — the base every scenario patches. */
function base(): ObjectModel {
	const model = emptyModel();
	// The real toolchanger's CAN topology (from the 2026-07-15 capture): main
	// board + one EXP3HC + four TOOL1LC, so the firmware card has real boards.
	const board = (
		name: string, shortName: string, canAddress: number, version: string, file: string, mcu: number,
	): Board => ({ name, shortName, canAddress, firmwareVersion: version, firmwareFileName: file, mcuTemp: { current: mcu }, vIn: { current: 24.1 }, v12: canAddress === 0 ? { current: 12.1 } : null });
	model.boards = [
		board("Duet 3 MB6HC", "MB6HC", 0, "3.6.3", "Duet3Firmware_MB6HC.bin", 38.2),
		board("Duet 3 Expansion EXP3HC", "EXP3HC", 1, "3.6.3", "Duet3Firmware_EXP3HC.bin", 35.0),
		board("Duet 3 Expansion TOOL1LC", "TOOL1LC", 20, "3.6.3+1", "Duet3Firmware_TOOL1LC.bin", 30.0),
		board("Duet 3 Expansion TOOL1LC", "TOOL1LC", 21, "3.6.3+1", "Duet3Firmware_TOOL1LC.bin", 30.2),
		board("Duet 3 Expansion TOOL1LC", "TOOL1LC", 22, "3.6.3+1", "Duet3Firmware_TOOL1LC.bin", 30.1),
		board("Duet 3 Expansion TOOL1LC", "TOOL1LC", 23, "3.6.3+1", "Duet3Firmware_TOOL1LC.bin", 30.3),
	];
	model.move = {
		axes: [
			axis("X", 150), axis("Y", 140), axis("Z", 12.4),
			axis("U", 12.4), axis("V", 12.4), axis("W", 12.4),
			axis("C", 0),
		],
		currentMove: { requestedSpeed: 0, topSpeed: 0 },
		speedFactor: 1,
		extruders: [0, 1, 2, 3].map(() => ({ filamentDiameter: 1.75, filament: "" })),
		// A mesh IS loaded here, so the Mesh card's status line has something to
		// show. The real machine spends most of its time at type "none" (every
		// G32 runs M561 first), which the empty model already covers.
		compensation: {
			type: "mesh",
			file: "0:/sys/heightmap.csv",
			meshDeviation: { mean: 0.012, deviation: 0.043 },
			fadeHeight: 20,
		},
	};
	model.heat = {
		bedHeaters: [0], chamberHeaters: [],
		heaters: [
			heater(22.5, 0, 0, "off"), // bed (no standby on this machine)
			heater(21.8, 0, 0, "off"), // nozzle 1
			heater(21.9, 0, 0, "off"), // nozzle 2
			heater(22.1, 0, 0, "off"), // nozzle 3
			heater(21.7, 0, 0, "off"), // nozzle 4
		],
	};
	model.tools = [
		tool(0, 1, 0, 0, "off"), tool(1, 2, 0, 0, "off"),
		tool(2, 3, 0, 0, "off"), tool(3, 4, 0, 0, "off"),
	];
	model.fans = [fan("Part cooling", 0), fan("Hot end", 0, [1])] as (Fan | null)[];
	model.sensors = {
		gpIn: [{ value: 1 }, { value: 0 }, { value: 0 }, { value: 0 }],
		endstops: [{ triggered: false }, { triggered: false }, { triggered: false }],
		filamentMonitors: [{ status: "ok" }, { status: "ok" }, { status: "ok" }, { status: "ok" }],
		probes: [{ type: 8, value: [0], threshold: 500, triggerHeight: 0 }],
	};
	model.state = {
		status: "idle", currentTool: -1, machineMode: "FFF", displayMessage: "",
		upTime: 4210, messageBox: null, atxPower: null,
	};
	model.job = {
		file: null, filePosition: null, duration: null, layer: null, layers: [],
		lastFileName: "0:/gcodes/benchy_toolchange_v3.gcode",
		timesLeft: { filament: null, file: null, slicer: null }, build: null,
	};
	return model;
}

/** Layer a mid-print job (used by printing + paused) onto a warm base. */
function withPrintingJob(model: ObjectModel): ObjectModel {
	model.state.currentTool = 0;
	model.heat.heaters[0] = heater(60.0, 60, 0, "active"); // bed
	model.heat.heaters[1] = heater(209.4, 210, 0, "active"); // nozzle 1
	model.tools[0] = tool(0, 1, 210, 0, "active");
	model.fans[0] = fan("Part cooling", 0.8);
	model.job = {
		file: { fileName: "0:/gcodes/benchy_toolchange_v3.gcode", size: 4_812_400, printTime: 8_640, numLayers: 180 },
		filePosition: 2_560_000, duration: 4_980, layer: 142, layers: [],
		lastFileName: "0:/gcodes/benchy_toolchange_v3.gcode",
		// Three genuinely diverging estimates, as a real board reports them.
		timesLeft: { filament: 2703, file: 2832, slicer: 2960 },
		build: {
			currentObject: 1,
			objects: [
				{ cancelled: false, name: "hull", x: [90, 130], y: [80, 120] },
				{ cancelled: false, name: "chimney", x: [104, 116], y: [92, 104] },
				{ cancelled: true, name: "nameplate", x: [60, 150], y: [60, 70] },
			],
		},
	};
	return model;
}

/** Build the object model for a scenario. Each call is a fresh object. */
export function scenarioModel(id: ScenarioId): ObjectModel {
	const model = base();
	switch (id) {
		case "idle":
			return model;
		case "printing":
			model.state.status = "processing";
			return withPrintingJob(model);
		case "paused":
			model.state.status = "paused";
			return withPrintingJob(model);
		case "heater-fault": {
			// A latched fault: nozzle 1 cooling, powered off, waiting on M562.
			model.state.status = "idle";
			model.heat.heaters[1] = heater(148.0, 210, 0, "fault");
			model.tools[0] = tool(0, 1, 210, 0, "off");
			return model;
		}
		case "multi-tool":
			model.state.currentTool = 2;
			model.heat.heaters[0] = heater(60.0, 60, 0, "active");
			model.heat.heaters[1] = heater(180.0, 200, 160, "standby");
			model.heat.heaters[2] = heater(178.5, 200, 160, "standby");
			model.heat.heaters[3] = heater(205.0, 205, 160, "active");
			model.heat.heaters[4] = heater(179.2, 200, 160, "standby");
			model.tools[0] = tool(0, 1, 200, 160, "standby");
			model.tools[1] = tool(1, 2, 200, 160, "standby");
			model.tools[2] = tool(2, 3, 205, 160, "active");
			model.tools[3] = tool(3, 4, 200, 160, "standby");
			return model;
	}
}
