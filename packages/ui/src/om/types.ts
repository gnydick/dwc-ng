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

// One implementation of the number gate, shared with the render derivation.
// speeds.ts imports only TYPES from here, so this is not a runtime cycle.
import { numberOrNull } from "./speeds.ts";

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

/** reference/objectmodel/src/move/Extruder.ts */
export interface Extruder {
	filamentDiameter: number;
	/** Name of the loaded filament; "" when nothing is loaded. */
	filament: string;
}

/** reference/objectmodel/src/move/index.ts (Move) */
/** reference/objectmodel/src/move/Compensation.ts — what the bed is currently
 *  compensating WITH, which is not the same as what is on the SD card. */
export interface Compensation {
	/** "none" | "mesh" (RRF reports other kinds on non-Cartesian builds). */
	type: string;
	/** The height map file in use, or null when nothing is loaded. */
	file: string | null;
	/** Flatness of the loaded map, or null when there is none. */
	meshDeviation: { mean: number; deviation: number } | null;
	/** M376 taper height; compensation fades out above it. */
	fadeHeight: number | null;
}

/**
 * reference/objectmodel/src/move/index.ts:13-20 (CurrentMove).
 *
 * RRF declares all three as non-nullable numbers defaulting to 0, so a
 * connected board serving this subtree always sends numbers. `null` here means
 * the field was ABSENT — before the first sync, or on a partial patch — which
 * must not render as "0.0", since that asserts the machine is stopped on no
 * evidence. (DWC has exactly this bug: its isFinite() guard passes null
 * through as 0, because isFinite(null) === true.)
 */
export interface CurrentMove {
	/** "Requested speed of the current move (in mm/s)" — after M220. */
	requestedSpeed: number | null;
	/** "Top speed of the current move (in mm/s)" — the achieved speed. */
	topSpeed: number | null;
	/** "Current extrusion rate (in mm/s)" — filament, not nozzle travel. */
	extrusionRate: number | null;
}

export interface Move {
	axes: Axis[];
	currentMove: CurrentMove;
	speedFactor: number;
	extruders: Extruder[];
	compensation: Compensation;
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
	/** Index into move.extruders that this tool feeds; -1 when it has none. */
	filamentExtruder: number;
	active: number[];
	standby: number[];
	/** "off" | "active" | "standby" */
	state: string;
}

/**
 * reference/objectmodel/src/state/MessageBox.ts
 *
 * A blocking prompt raised by M291. While one is present with mode >= okOnly
 * the FIRMWARE IS WAITING for M292 — the machine looks hung until it is
 * answered, so this is live-print state, not a notification.
 */
export interface MessageBox {
	/** See MessageBoxMode in messagebox/ack.ts. */
	mode: number;
	/** Echoed back in M292; identifies WHICH box is being answered. */
	seq: number;
	title: string;
	message: string;
	/** Bitmap over move.axes INDEX — jog controls to show inside the prompt. */
	axisControls: number | null;
	cancelButton: boolean;
	/** Button labels for multipleChoice; the M292 value is the chosen index. */
	choices: string[] | null;
	/** Seeds the input (or the highlighted choice index). */
	default: number | string | null;
	/** Input bounds: value range for numbers, length range for strings. */
	min: number | null;
	max: number | null;
	timeout: number;
}

/** reference/objectmodel/src/state/index.ts (State) */
export interface MachineState {
	/** "idle" | "processing" | "paused" | "halted" | "busy" | … */
	status: string;
	currentTool: number;
	machineMode: string;
	displayMessage: string;
	upTime: number;
	/** null whenever no prompt is open. */
	messageBox: MessageBox | null;
	/**
	 * ATX PSU state, or null when the board has no PS_ON port configured —
	 * null means "this machine has no such control", not "it is off".
	 */
	atxPower: boolean | null;
}

/** reference/objectmodel/src/boards/Board.ts */
export interface Board {
	name: string;
	shortName: string;
	firmwareVersion?: string;
	/** Standard firmware binary for this board, e.g. "Duet3Firmware_MB6HC.bin" —
	 *  the file M997 flashes from 0:/firmware/. */
	firmwareFileName?: string;
	/** CAN bus address. 0 (or absent) = main board; >0 = a CAN-connected
	 *  expansion/tool board, which M997 targets with B<canAddress>. */
	canAddress?: number;
	mcuTemp: { current: number } | null;
	vIn: { current: number } | null;
	v12?: { current: number } | null;
}

/** reference/objectmodel/src/job/Build.ts (BuildObject) */
export interface BuildObject {
	cancelled: boolean;
	/** null when the slicer emitted no M486 name for it. */
	name: string | null;
	/** Bounding box on each axis, [min, max]; entries may be null. */
	x: (number | null)[];
	y: (number | null)[];
}

/** reference/objectmodel/src/job/Build.ts (Build) */
export interface Build {
	/** Index of the object being printed; -1 between objects. */
	currentObject: number;
	objects: (BuildObject | null)[];
}

/**
 * Layer statistics are SYNTHESIZED by the connector — RRF keeps no per-layer
 * history — so the type lives with the thing that produces it and is re-exported
 * here, where the rest of the app reads the object model from. See
 * connector/synthesized-layers-have-one-producer.
 */
import type { Layer } from "@dwc-ng/connector";
export type { Layer };

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
	/** One entry per completed layer (the last is the in-progress one, duration 0). */
	layers: Layer[];
	lastFileName: string | null;
	timesLeft: { filament: number | null; file: number | null; slicer: number | null };
	/** null when the job carries no M486 object information. */
	build: Build | null;
}

/** reference/objectmodel/src/fans/Fan.ts (FanThermostaticControl) */
export interface FanThermostaticControl {
	/** Sensor indices driving this fan automatically; non-empty means the
	 *  firmware controls it, not the user. */
	sensors: number[];
}

/** reference/objectmodel/src/fans/index.ts (Fan) */
export interface Fan {
	name: string;
	actualValue: number;
	requestedValue: number;
	/** Tacho reading. -1 when no tacho is configured; the live RPM otherwise
	 *  (reference/objectmodel/src/fans/index.ts:15). */
	rpm: number;
	thermostatic: FanThermostaticControl;
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
	/** G31 Z, the probe's Z trigger height (reference/objectmodel/src/sensors/Probe.ts:56).
	 *  A re-probe's map value is (reported stop height - this); subtracting it makes a
	 *  spot high of the reference read positive whatever the sign of this value. */
	triggerHeight: number;
	/**
	 * Machine Z the probe last stopped at — the same number RRF prints as
	 * "Stopped at height <n> mm", carried in the model rather than in reply
	 * text. Preferred over parsing the reply: a re-probe macro can outlive the
	 * connector's request timeout, and this survives that. null on a board that
	 * has not probed since boot.
	 */
	lastStopHeight: number | null;
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
		job: { file: null, filePosition: null, duration: null, layer: null, layers: [], lastFileName: null, timesLeft: { filament: null, file: null, slicer: null }, build: null },
		move: {
			axes: [],
			currentMove: { requestedSpeed: null, topSpeed: null, extrusionRate: null },
			speedFactor: 1,
			extruders: [],
			compensation: { type: "none", file: null, meshDeviation: null, fadeHeight: null },
		},
		sensors: { gpIn: [], endstops: [], filamentMonitors: [], probes: [] },
		state: { status: "disconnected", currentTool: -1, machineMode: "FFF", displayMessage: "", upTime: 0, messageBox: null, atxPower: null },
		tools: [],
	};
}

const arrayOr = (value: unknown, fallback: unknown[]): unknown[] =>
	Array.isArray(value) ? value : fallback;

/**
 * Parse currentMove's numbers at the refetch gate so the store's shape matches
 * its declared type. NOT the render guarantee: the live d99fn patch route
 * (store.ts:89) never reaches conformModelKey, so om/speeds.ts parses again at
 * the point of display. See I-A in the design doc.
 */
const conformCurrentMove = (value: unknown): CurrentMove => {
	const v = typeof value === "object" && value !== null && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
	return {
		requestedSpeed: numberOrNull(v.requestedSpeed),
		topSpeed: numberOrNull(v.topSpeed),
		extrusionRate: numberOrNull(v.extrusionRate),
	};
};

/**
 * The per-key shape gate at the OM's single entry (audit M8). The wire is a
 * trusted-ish cast beyond this point, so the fields render code ITERATES
 * (`move.axes.filter`, `heat.heaters.some`, `job.layers` totals — the
 * 2026-07-23 layerStats incident) must be guaranteed here, by construction:
 *
 * - a known key whose top-level shape is unusable (an object key arriving
 *   as a string) is REJECTED — the store keeps the last good subtree;
 * - a usable object is CONFORMED: promised container fields that are
 *   missing or mis-typed are filled from the empty model. A board that
 *   legitimately omits `job.layers` must not have its whole job update
 *   rejected — the incident's lesson — so fill, don't refuse;
 * - unknown keys pass through untouched (the model is open; the OM
 *   inspector renders whatever the board serves).
 *
 * @invariant om-entry-shape-gate
 * @rung 5  shared helper on ONE of two ingress routes — onModelKey
 *          (store.ts:75) passes every key through this, but the live d99fn
 *          patch route (onModelPatch, store.ts:90) deep-merges into the store
 *          WITHOUT it. Corrected 2026-08-01: this was first declared as a rung-6
 *          choke-point, which was wrong — the second route is documented four
 *          lines below and I read past it
 * @why the board is the untrusted party here, not the user: firmware versions
 *      differ in which fields they serve, and a machine that legitimately omits
 *      job.layers must not have its whole job update rejected. Conform rather
 *      than refuse — that was the layerStats incident's lesson
 * @debt two routes in means the gate is not a gate, and om/speeds.ts re-parses
 *       currentMove at the point of DISPLAY to cover the ungated one — a second
 *       mechanism for the same property, i.e. the drift hazard.
 *
 *       CORRECTED 2026-08-01. This used to say "promote by routing both through
 *       one entry that brands what it produces". Following that literally would
 *       have introduced a bug, measured rather than reasoned about: this
 *       function FILLS IN defaults for absent arrays, so conforming a PARTIAL
 *       patch invents them. conformModelKey("heat", { heaters: [...] }) returns
 *       that patch plus bedHeaters: [] and chamberHeaters: [], and deep-merging
 *       those empties over the store wipes the real lists — on this machine the
 *       bed heater would vanish from the UI mid-print. Pinned by
 *       test/om-conform.test.ts.
 *
 *       The two routes are not one operation with two callers. A wholesale
 *       subtree may be completed from defaults because it IS the whole truth; a
 *       live patch may never be, because absence there means "unchanged", not
 *       "empty". The real promotion is a conform that distinguishes the two —
 *       filling only on replacement — and only then can both share an entry.
 *       Until that exists, speeds.ts's second parse is load bearing and must
 *       not be deleted as redundant.
 */
export function conformModelKey(key: string, value: unknown): { ok: true; value: unknown } | { ok: false } {
	const isObject = (v: unknown): v is Record<string, unknown> =>
		typeof v === "object" && v !== null && !Array.isArray(v);
	const defaults = emptyModel();
	switch (key as keyof KnownModel) {
		case "boards":
		case "fans":
		case "tools":
			return Array.isArray(value) ? { ok: true, value } : { ok: false };
		case "heat": {
			if (!isObject(value)) return { ok: false };
			const d = defaults.heat;
			return { ok: true, value: {
				...value,
				bedHeaters: arrayOr(value.bedHeaters, d.bedHeaters),
				chamberHeaters: arrayOr(value.chamberHeaters, d.chamberHeaters),
				heaters: arrayOr(value.heaters, d.heaters),
			} };
		}
		case "job": {
			if (!isObject(value)) return { ok: false };
			const d = defaults.job;
			return { ok: true, value: {
				...d,
				...value,
				layers: arrayOr(value.layers, []),
				timesLeft: isObject(value.timesLeft) ? value.timesLeft : d.timesLeft,
			} };
		}
		case "move": {
			if (!isObject(value)) return { ok: false };
			const d = defaults.move;
			return { ok: true, value: {
				...d,
				...value,
				axes: arrayOr(value.axes, []),
				extruders: arrayOr(value.extruders, []),
				currentMove: conformCurrentMove(value.currentMove),
				// A board that omits compensation (or sends it as a scalar) must not
				// cost the whole move subtree — fill, don't refuse.
				compensation: isObject(value.compensation) ? value.compensation : d.compensation,
			} };
		}
		case "sensors": {
			if (!isObject(value)) return { ok: false };
			const d = defaults.sensors;
			return { ok: true, value: {
				...value,
				gpIn: arrayOr(value.gpIn, d.gpIn),
				endstops: arrayOr(value.endstops, d.endstops),
				filamentMonitors: arrayOr(value.filamentMonitors, d.filamentMonitors),
				probes: arrayOr(value.probes, d.probes),
			} };
		}
		case "state": {
			if (!isObject(value)) return { ok: false };
			return { ok: true, value: { ...defaults.state, ...value } };
		}
		default:
			return { ok: true, value };
	}
}
