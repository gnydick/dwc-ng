import type { Machine } from "../machine.ts";
import type { Scenario } from "./types.ts";

export type { Scenario, ScenarioEvent } from "./types.ts";

const idle: Scenario = {
	name: "idle",
	description: "Powered on, homed nothing, everything at ambient.",
};

const midPrint: Scenario = {
	name: "mid-print",
	description: "Benchy print in progress (~37% through, temps at target).",
	init(machine: Machine) {
		machine.startJob("0:/gcodes/benchy.gcode");
		const job = machine.om.job;
		// Fast-forward: 37% in, temps settled at target
		job.filePosition = Math.floor(job.file.size * 0.37);
		job.duration = Math.floor(job.file.printTime * 0.37);
		job.warmUpDuration = 95;
		machine.om.heat.heaters[0].current = 60.1;
		machine.om.heat.heaters[1].current = 209.8;
		machine.advance(0); // settle derived values (layer, timesLeft, positions)
	},
};

const heaterFault: Scenario = {
	name: "heater-fault",
	description: "Starts heating for a print; hotend faults after 15 s.",
	init(machine: Machine) {
		machine.execute("M140 S60");
		machine.execute("M104 S210");
	},
	events: [
		{
			at: 15_000,
			note: "hotend heater fault",
			run: machine => machine.faultHeater(1),
		},
	],
};

const disconnect: Scenario = {
	name: "disconnect",
	description: "Board drops off the network for 8 s at t=20 s and t=90 s.",
	events: [
		{ at: 20_000, note: "network outage", run: m => m.requestOutage(8_000) },
		{ at: 90_000, note: "network outage", run: m => m.requestOutage(8_000) },
	],
};

export const scenarios: Record<string, Scenario> = {
	[idle.name]: idle,
	[midPrint.name]: midPrint,
	[heaterFault.name]: heaterFault,
	[disconnect.name]: disconnect,
};
