import type { Machine } from "../machine.ts";

export interface ScenarioEvent {
	/** Simulated ms since power-up at which to fire (once). */
	at: number;
	note?: string;
	run(machine: Machine): void;
}

export interface Scenario {
	name: string;
	description: string;
	/** Applied once at construction, before the clock starts. */
	init?(machine: Machine): void;
	events?: ScenarioEvent[];
}
