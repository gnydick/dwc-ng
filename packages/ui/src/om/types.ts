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
	/**
	 * M92's rate, microsteps per mm, and M350's multiplier.
	 *
	 * OPTIONAL, unlike every field above, and that is the honest shape rather
	 * than a lax one. Axis ENTRIES are not conformed — `conformModelKey` gates
	 * the `move` subtree and fills its arrays, but it does not descend into
	 * them — so what reaches a reader is whatever the firmware sent. Declaring
	 * these `number | null` would promise a null that nothing produces; `?`
	 * says what is true, which is that a board may simply not carry them.
	 *
	 * Read only through `shaping/fullStep.ts`, which validates both and returns
	 * the quotient or a reason. Present on RRF 3.6 (Gabe's X: 80 and 16).
	 */
	stepsPerMm?: number;
	microstepping?: { value?: number; interpolated?: boolean };
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

/**
 * reference/objectmodel/src/move/InputShaping.ts:14-20 — the shaper M593 has
 * configured, as the firmware reports it back.
 *
 * `type` is kept a plain string rather than a union of
 * InputShapingType (same file, :3-12): the board is the authority on what
 * shaper names its firmware knows, and a name this build has never heard of
 * must still render as itself, not collapse to "none". The Shaping Lab's own
 * candidate names are a separate, closed set (shaping/engine/shapers.ts).
 *
 * `amplitudes` and `delays` are PAIRWISE — impulse i is (amplitudes[i],
 * delays[i]) — which is why conformShaping rejects a whole vector rather than
 * dropping bad elements out of one of them.
 */
export interface Shaping {
	/** "none" | "zvd" | "mzv" | "ei2" | "ei3" | "custom" | … (board's word). */
	readonly type: string;
	/** Centre frequency in Hz. 0 when no shaper is configured. */
	readonly frequency: number;
	/** Damping ratio ζ the shaper was solved for. */
	readonly damping: number;
	readonly amplitudes: readonly number[];
	/** Seconds, cumulative from the first impulse (which is always 0). */
	readonly delays: readonly number[];
}

export interface Move {
	axes: Axis[];
	currentMove: CurrentMove;
	speedFactor: number;
	extruders: Extruder[];
	compensation: Compensation;
	readonly shaping: Shaping;
	/**
	 * M204 T, the acceleration a non-printing move is planned with, mm/s²
	 * (reference/objectmodel/src/move/index.ts:55 — RRF declares it a plain
	 * number defaulting to 10000; Gabe's board reports 8000 in
	 * packages/mock-duet/captures/om-snapshot-2026-07-12.json).
	 *
	 * NULLABLE HERE, unlike the vendored shape, for the same reason
	 * CurrentMove's numbers are: absent means "the board has not said", and a
	 * card showing a defaulted 10000 would state a fact about this machine
	 * that nothing measured. The Shaping Lab reasons about how much of an
	 * excitation move is spent at constant velocity, which is worth showing
	 * as "—" rather than as a confident wrong number.
	 */
	readonly travelAcceleration: number | null;
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

/**
 * reference/objectmodel/src/boards/index.ts:7-11 (Accelerometer).
 *
 * PRESENCE IS THE POINT: `boards[n].accelerometer` is null on a board with no
 * accelerometer wired to it, and that is the only thing that says whether
 * M955/M956 can address that board at all. `points`/`runs` are the firmware's
 * own capture counters, which is how a capture in flight is observed without
 * polling the file system.
 */
export interface Accelerometer {
	/** M955 I<n> axis-mapping code, e.g. 41. Defaults to 20 in RRF
	 *  (reference/objectmodel/src/boards/index.ts:8). */
	readonly orientation: number;
	/** Samples collected by the run in progress. */
	readonly points: number;
	/** Captures completed since boot. */
	readonly runs: number;
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
	/**
	 * null = this board has no accelerometer (reference/objectmodel/src/boards/index.ts:50).
	 *
	 * conformModelKey guarantees the key EXISTS on every board it gates, but the
	 * live d99fn patch route does not pass through that gate (see the @debt on
	 * conformModelKey), so a consumer must test presence — `if (b.accelerometer)`
	 * — rather than `=== null`, exactly as it must for mcuTemp and vIn.
	 */
	readonly accelerometer: Accelerometer | null;
}

/** reference/objectmodel/src/network/NetworkInterface.ts */
export interface NetworkInterface {
	/**
	 * null on an interface that has none — the vendored type declares it
	 * `string | null` (reference/objectmodel/src/network/NetworkInterface.ts:38),
	 * and the real board serves a disabled wifi radio alongside the ethernet.
	 * Machine identity's MAC fallback must therefore look for the first
	 * interface CARRYING one, never interfaces[0].
	 */
	readonly mac: string | null;
	readonly type?: string;
	readonly state?: string | null;
	readonly actualIP?: string | null;
}

/** reference/objectmodel/src/network/index.ts (Network) */
export interface Network {
	readonly interfaces: (NetworkInterface | null)[];
	/** M550 — an operator renames this. Display, never a key. */
	readonly hostname?: string;
	readonly name?: string;
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
	network: Network;
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
			shaping: { type: "none", frequency: 0, damping: 0, amplitudes: [], delays: [] },
			travelAcceleration: null,
		},
		network: { interfaces: [] },
		sensors: { gpIn: [], endstops: [], filamentMonitors: [], probes: [] },
		state: { status: "disconnected", currentTool: -1, machineMode: "FFF", displayMessage: "", upTime: 0, messageBox: null, atxPower: null },
		tools: [],
	};
}

const arrayOr = (value: unknown, fallback: unknown[]): unknown[] =>
	Array.isArray(value) ? value : fallback;

/** The one object test in this file: an OM node, not an array, not null. */
const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** Same gate as numberOrNull, with a promised value instead of null — used
 *  wherever the declared type is a plain `number` and absence is not a state. */
const numberOr = (value: unknown, fallback: number): number =>
	numberOrNull(value) ?? fallback;

/**
 * A vector of finite numbers, ALL OR NOTHING. Dropping a bad element would
 * silently re-pair two vectors read by index (shaping's amplitudes/delays), so
 * one bad element costs the whole vector and the pairing stays true.
 */
const numberArrayOr = (value: unknown, fallback: readonly number[]): readonly number[] =>
	Array.isArray(value) && value.every(n => numberOrNull(n) !== null)
		? value as number[]
		: fallback;

/**
 * Parse currentMove's numbers at the refetch gate so the store's shape matches
 * its declared type. NOT the render guarantee: the live d99fn patch route
 * (store.ts:89) never reaches conformModelKey, so om/speeds.ts parses again at
 * the point of display. See I-A in the design doc.
 */
const conformCurrentMove = (value: unknown): CurrentMove => {
	const v: Record<string, unknown> = isObject(value) ? value : {};
	return {
		requestedSpeed: numberOrNull(v.requestedSpeed),
		topSpeed: numberOrNull(v.topSpeed),
		extrusionRate: numberOrNull(v.extrusionRate),
	};
};

/**
 * move.shaping is a promised object, never absent: "no shaper" is the type
 * "none" with empty impulse vectors, not a missing key. A board that omits the
 * subtree (or serves the shaper as a bare string, as an older firmware might)
 * therefore costs the SHAPER, not the whole move subtree — same rule as
 * compensation above.
 */
const conformShaping = (value: unknown, fallback: Shaping): Shaping => {
	const v: Record<string, unknown> = isObject(value) ? value : {};
	return {
		type: typeof v.type === "string" ? v.type : fallback.type,
		frequency: numberOr(v.frequency, fallback.frequency),
		damping: numberOr(v.damping, fallback.damping),
		amplitudes: numberArrayOr(v.amplitudes, fallback.amplitudes),
		delays: numberArrayOr(v.delays, fallback.delays),
	};
};

/** null is the answer for "this board has no accelerometer" AND for "what the
 *  board sent cannot be one" — the caller of M955 must not be able to tell the
 *  difference, because neither can be captured from. */
const conformAccelerometer = (value: unknown): Accelerometer | null => {
	if (!isObject(value)) return null;
	return {
		orientation: numberOr(value.orientation, 20),
		points: numberOr(value.points, 0),
		runs: numberOr(value.runs, 0),
	};
};

/**
 * boards[] is declared `(Board | null)[]` and the firmware card iterates it
 * with `filter(b => b !== null)`, so an entry that is not an object is not a
 * board — it becomes the null slot it already renders as, rather than a
 * string the card would read `.canAddress` off.
 */
const conformBoard = (entry: unknown): unknown =>
	isObject(entry) ? { ...entry, accelerometer: conformAccelerometer(entry.accelerometer) } : null;

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
	const defaults = emptyModel();
	switch (key as keyof KnownModel) {
		// boards is the one array key whose ELEMENTS are gated: the Shaping Lab
		// reads accelerometer presence per board to decide what it may address,
		// and "absent" and "null" must not be two different answers to that.
		case "boards":
			return Array.isArray(value) ? { ok: true, value: value.map(conformBoard) } : { ok: false };
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
				shaping: conformShaping(value.shaping, d.shaping),
				// Parsed, not waved through, exactly like currentMove's numbers: a
				// string here would reach a toFixed() in the shaping cards.
				travelAcceleration: numberOrNull(value.travelAcceleration),
			} };
		}
		// network is gated for one reason: machine IDENTITY is read out of it
		// (config/machineId.ts). An ungated subtree cannot carry a key.
		case "network": {
			if (!isObject(value)) return { ok: false };
			return { ok: true, value: {
				...value,
				interfaces: arrayOr(value.interfaces, []).map(e => (isObject(e) ? e : null)),
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
