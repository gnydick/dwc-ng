/**
 * Lean plain-data types for the object-model subtrees the UI renders.
 *
 * Shape authority: the vendored @duet3d/objectmodel 3.6.3 classes
 * (reference/objectmodel/src/…) — these interfaces are hand-picked subsets
 * of those classes' fields, plain data only (see CLAUDE.md: the classes
 * themselves are not a runtime dependency; their in-place update() model is
 * incompatible with Solid store proxies).
 *
 * Everything not typed here still lives in the store — the model is
 * `KnownModel & Record<string, unknown>` — the UI just doesn't get typed
 * access until a field is promoted into these interfaces. Per the Duet wiki:
 * tolerate missing fields; some exist only in DSF/SBC mode.
 */

/** reference/objectmodel/src/move/Axis.ts */
export interface Axis {
	letter: string;
	homed: boolean;
	machinePosition: number | null;
	userPosition: number | null;
	min: number;
	max: number;
	babystep: number;
	visible: boolean;
}

/** reference/objectmodel/src/move/index.ts (Move) */
export interface Move {
	axes: Axis[];
	currentMove: { requestedSpeed: number; topSpeed: number };
	speedFactor: number;
}

/** reference/objectmodel/src/heat/Heater.ts */
export interface Heater {
	active: number;
	standby: number;
	current: number;
	max: number;
	/** "off" | "standby" | "active" | "fault" | "tuning" | "offline" */
	state: string;
}

/** reference/objectmodel/src/heat/index.ts (Heat) */
export interface Heat {
	bedHeaters: number[];
	chamberHeaters: number[];
	heaters: (Heater | null)[];
}

/** reference/objectmodel/src/tools/Tool.ts */
export interface Tool {
	number: number;
	name: string;
	heaters: number[];
	active: number[];
	standby: number[];
	/** "off" | "active" | "standby" */
	state: string;
}

/** reference/objectmodel/src/state/index.ts (State) */
export interface MachineState {
	/** "idle" | "processing" | "paused" | "halted" | "busy" | … */
	status: string;
	currentTool: number;
	machineMode: string;
	displayMessage: string;
	upTime: number;
}

/** reference/objectmodel/src/boards/Board.ts */
export interface Board {
	name: string;
	shortName: string;
	firmwareVersion?: string;
	canAddress?: number;
	mcuTemp: { current: number } | null;
	vIn: { current: number } | null;
	v12?: { current: number } | null;
}

/** reference/objectmodel/src/job/index.ts (Job) */
export interface Job {
	file: {
		fileName: string;
		size: number;
		printTime: number | null;
		numLayers: number;
	} | null;
	filePosition: number | null;
	duration: number | null;
	layer: number | null;
	lastFileName: string | null;
	timesLeft: { filament: number | null; file: number | null; slicer: number | null };
}

/** reference/objectmodel/src/fans/Fan.ts */
export interface Fan {
	name: string;
	actualValue: number;
	requestedValue: number;
}

/** reference/objectmodel/src/sensors/index.ts (GpInputPort) */
export interface GpInputPort {
	value: number;
}

/** reference/objectmodel/src/sensors/Endstop.ts */
export interface Endstop {
	triggered: boolean;
}

/** reference/objectmodel/src/sensors/FilamentMonitors/FilamentMonitorBase.ts */
export interface FilamentMonitor {
	/** "noMonitor" | "ok" | "noDataReceived" | "noFilament" | "tooLittleMovement" | "tooMuchMovement" | "sensorError" */
	status: string;
}

/** reference/objectmodel/src/sensors/Probe.ts */
export interface Probe {
	/** ProbeType.none = 0 (reference/objectmodel/src/sensors/Probe.ts:4) — anything else means a probe is configured. */
	type: number;
	value: number[];
	threshold: number;
}

/** reference/objectmodel/src/sensors/index.ts (Sensors) */
export interface Sensors {
	gpIn: (GpInputPort | null)[];
	endstops: (Endstop | null)[];
	filamentMonitors: (FilamentMonitor | null)[];
	probes: (Probe | null)[];
}

export interface KnownModel {
	boards: (Board | null)[];
	fans: (Fan | null)[];
	heat: Heat;
	job: Job;
	move: Move;
	sensors: Sensors;
	state: MachineState;
	tools: (Tool | null)[];
}

/** The full model: typed where rendered, open everywhere else. */
export type ObjectModel = KnownModel & Record<string, unknown>;

/** Minimal shape the UI boots with, before the first full sync arrives. */
export function emptyModel(): ObjectModel {
	return {
		boards: [],
		fans: [],
		heat: { bedHeaters: [], chamberHeaters: [], heaters: [] },
		job: { file: null, filePosition: null, duration: null, layer: null, lastFileName: null, timesLeft: { filament: null, file: null, slicer: null } },
		move: { axes: [], currentMove: { requestedSpeed: 0, topSpeed: 0 }, speedFactor: 1 },
		sensors: { gpIn: [], endstops: [], filamentMonitors: [], probes: [] },
		state: { status: "disconnected", currentTool: -1, machineMode: "FFF", displayMessage: "", upTime: 0 },
		tools: [],
	};
}
