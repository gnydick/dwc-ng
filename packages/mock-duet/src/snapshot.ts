/**
 * Base object model snapshot: a single-tool CoreXY printer on a Duet 3 Mini 5+
 * running RRF 3.6.3 (the firmware line this project is pinned to).
 *
 * Field names and shapes follow the vendored @duet3d/objectmodel 3.6.3 classes
 * (reference/objectmodel/src/). Values are plausible synthetic data — captured
 * traffic from a real board can replace whole subtrees later (see README).
 *
 * The model is intentionally typed loosely: the mock must be able to replay
 * captured responses verbatim, so it never assumes a schema. Typed OM classes
 * belong to the UI side (CLAUDE.md Task #4).
 */
export type Om = Record<string, any>;

/** Root keys a standalone client polls (everything except messages/plugins/sbc). */
export const POLLED_KEYS = [
	"boards", "directories", "fans", "global", "heat", "inputs", "job",
	"ledStrips", "limits", "move", "network", "sensors", "spindles",
	"state", "tools", "volumes",
] as const;

const AMBIENT = 22.5;

/**
 * Strip every identity the UI can key a machine to — `boards[].uniqueId` and
 * every network interface's `mac`.
 *
 * The UI's `resolveMachineId` (config/machineId.ts) returns `unidentified` only
 * when BOTH are absent, so removing one is not enough and removing them from
 * the served snapshot is not enough either: the same model must be stripped
 * before it reaches `pristine`, or a scenario reset would hand the identity
 * back mid-session.
 *
 * This is a DEGRADED machine on purpose. GIT_92 requirement 3: the mock exists
 * to make a wrong UI observable, so every state the UI must handle needs a way
 * to be presented deliberately — and closing requirements 1 and 2 (giving the
 * default machine a uniqueId and a MAC) made this one unreachable by any flag,
 * which is exactly the failure this ticket's design constraint warned about. A
 * mock that is EASIER than the real board hides the defects UAT is for.
 *
 * What it makes reachable: the machine-identity card's unidentified branch, and
 * `nullCanvasKeys` — the in-memory canvas that writes nowhere while
 * unidentified, so a drag made in that state vanishes when identity resolves
 * (GIT_86 finding 1). Verified live 2026-08-28: the card reads "Not identified
 * — no board uniqueId and no network interface MAC", and the browser holds
 * ZERO `dwc-ng.m.*` keys.
 *
 * It does NOT present "claimed, not adopted", though the stamped v3 seed makes
 * that look likely: `loadFromMachine` takes its `handle === null` branch while
 * unidentified and sets no claim at all (config/store.ts). A claim needs an
 * IDENTIFIED machine reading a file stamped for a DIFFERENT one, which nothing
 * here can present — recorded as a known gap in docs/mock-parity.md rather
 * than left as a plausible-sounding assumption.
 *
 * Composes with everything else — it edits the model in place and reads no
 * other option — so an unidentified FOUR-TOOL machine with a seeded config is
 * a legal combination, which the parity list (docs/mock-parity.md) records as
 * the point of the flag rather than an accident of it.
 */
export function stripIdentity(model: Om): Om {
	for (const board of (model.boards ?? []) as Om[]) {
		if (board !== null && typeof board === "object") delete board.uniqueId;
	}
	const network = model.network as Om | undefined;
	for (const iface of ((network?.interfaces ?? []) as Om[])) {
		if (iface !== null && typeof iface === "object") delete iface.mac;
	}
	return model;
}

export function createBaseModel(): Om {
	return {
		boards: [
			{
				canAddress: 0,
				firmwareDate: "2026-01-15",
				firmwareFileName: "Duet3Firmware_Mini5plus.uf2",
				firmwareName: "RepRapFirmware for Duet 3 Mini 5+",
				firmwareVersion: "3.6.3",
				freeRam: 22712,
				iapFileNameSD: "Duet3_SDiap32_Mini5plus.bin",
				maxHeaters: 32,
				maxMotors: 7,
				mcuTemp: { current: 34.2, max: 36.1, min: 26.9 },
				name: "Duet 3 Mini 5+",
				shortName: "Mini5plus",
				state: "running",
				supportsDirectDisplay: true,
				uniqueId: "MOCK00-000000-000000-MOCKID",
				v12: { current: 12.1, max: 12.2, min: 12.0 },
				vIn: { current: 24.1, max: 24.3, min: 23.9 },
				wifiFirmwareVersion: "2.1.0",
			},
		],
		directories: {
			filaments: "0:/filaments",
			firmware: "0:/firmware",
			gCodes: "0:/gcodes",
			macros: "0:/macros",
			menu: "0:/menu",
			system: "0:/sys",
			web: "0:/www",
		},
		fans: [
			{
				actualValue: 0,
				blip: 0.1,
				frequency: 250,
				max: 1,
				min: 0.1,
				name: "Part cooling",
				requestedValue: 0,
				rpm: -1,
				thermostatic: { highTemperature: null, lowTemperature: null, sensors: [] },
			},
			{
				actualValue: 0,
				blip: 0.1,
				frequency: 250,
				max: 1,
				min: 0.1,
				name: "Hotend",
				requestedValue: 0,
				rpm: -1,
				thermostatic: { highTemperature: null, lowTemperature: 45, sensors: [1] },
			},
		],
		global: {},
		heat: {
			bedHeaters: [0],
			chamberHeaters: [],
			coldExtrudeTemperature: 160,
			coldRetractTemperature: 90,
			heaters: [
				{
					active: 0,
					avgPwm: 0,
					current: AMBIENT,
					max: 140,
					min: -10,
					maxBadReadings: 3,
					model: { enabled: true, maxPwm: 1, standardVoltage: 24 },
					monitors: [{ action: 0, condition: "tooHigh", limit: 145 }],
					sensor: 0,
					standby: 0,
					state: "off",
				},
				{
					active: 0,
					avgPwm: 0,
					current: AMBIENT,
					max: 285,
					min: -10,
					maxBadReadings: 3,
					model: { enabled: true, maxPwm: 1, standardVoltage: 24 },
					monitors: [{ action: 0, condition: "tooHigh", limit: 290 }],
					sensor: 1,
					standby: 0,
					state: "off",
				},
			],
		},
		inputs: [
			mkInput("HTTP"), mkInput("Telnet"), mkInput("File"), mkInput("USB"),
			mkInput("Aux"), mkInput("Trigger"), mkInput("Queue"), mkInput("LCD"),
			mkInput("Daemon"), mkInput("Autopause"),
		],
		job: {
			// M486 build objects. A slicer only emits these when object markers are
			// enabled, so a job legitimately has none — but with no model for them
			// at all, per-object cancel could not be exercised here.
			build: {
				currentObject: 0,
				m486names: true,
				m486numbers: true,
				objects: [
					{ cancelled: false, name: "left bracket", x: [20, 80], y: [20, 80] },
					{ cancelled: false, name: "right bracket", x: [120, 180], y: [20, 80] },
					{ cancelled: false, name: null, x: [60, 140], y: [120, 200] },
				],
			},
			duration: null,
			file: null,
			filePosition: null,
			lastDuration: 0,
			lastFileName: null,
			lastFileAborted: false,
			lastFileCancelled: false,
			lastFileSimulated: false,
			layer: 8,
			layerTime: null,
			// A handful of completed layers so the layer-times chart has data to
			// draw; the last (duration 0) is the layer still printing.
			layers: [
				{ duration: 42, filament: [310], fractionPrinted: 0.02, height: 0.2, temperatures: [] },
				{ duration: 38, filament: [305], fractionPrinted: 0.04, height: 0.4, temperatures: [] },
				{ duration: 51, filament: [402], fractionPrinted: 0.07, height: 0.6, temperatures: [] },
				{ duration: 47, filament: [388], fractionPrinted: 0.10, height: 0.8, temperatures: [] },
				{ duration: 45, filament: [377], fractionPrinted: 0.13, height: 1.0, temperatures: [] },
				{ duration: 63, filament: [510], fractionPrinted: 0.17, height: 1.2, temperatures: [] },
				{ duration: 44, filament: [369], fractionPrinted: 0.20, height: 1.4, temperatures: [] },
				{ duration: 0, filament: [120], fractionPrinted: 0.22, height: 1.6, temperatures: [] },
			],
			pauseDuration: null,
			rawExtrusion: null,
			timesLeft: { filament: null, file: null, slicer: null },
			warmUpDuration: null,
		},
		ledStrips: [],
		limits: {
			axes: 7,
			axesPlusExtruders: 7,
			bedHeaters: 4,
			boards: 4,
			chamberHeaters: 4,
			drivers: 14,
			extruders: 5,
			extrudersPerTool: 8,
			fans: 12,
			gpInPorts: 16,
			gpOutPorts: 16,
			heaters: 32,
			heatersPerTool: 8,
			monitorsPerHeater: 3,
			portsPerHeater: 3,
			reportedAxes: 9,
			restorePoints: 6,
			sensors: 56,
			spindles: 4,
			tools: 50,
			trackedObjects: 40,
			triggers: 16,
			volumes: 2,
			workplaces: 9,
			zProbeProgramBytes: 8,
			zProbes: 4,
		},
		messages: [],
		move: {
			axes: [
				mkAxis("X", 0, 220), mkAxis("Y", 0, 195), mkAxis("Z", 0, 240),
			],
			calibration: { final: { deviation: 0, mean: 0 }, initial: { deviation: 0, mean: 0 }, numFactors: 0 },
			compensation: { fadeHeight: null, file: null, meshDeviation: null, probeGrid: { axes: ["X", "Y"], maxs: [180, 160], mins: [20, 20], radius: -1, spacings: [20, 20] }, skew: { compensateXY: true, tanXY: 0, tanXZ: 0, tanYZ: 0 }, type: "none" },
			currentMove: { acceleration: 0, deceleration: 0, extrusionRate: 0, laserPwm: null, requestedSpeed: 0, topSpeed: 0 },
			extruders: [
				{
					acceleration: 3000,
					current: 800,
					driver: "0.3",
					factor: 1,
					filament: "",
					filamentDiameter: 1.75,
					jerk: 300,
					microstepping: { interpolated: true, value: 16 },
					nonlinear: { a: 0, b: 0, upperLimit: 0.2 },
					position: 0,
					pressureAdvance: 0.04,
					rawPosition: 0,
					speed: 3600,
					stepsPerMm: 409,
				},
			],
			idle: { factor: 0.3, timeout: 30 },
			kinematics: { forwardMatrix: [[0.5, 0.5, 0], [0.5, -0.5, 0], [0, 0, 1]], inverseMatrix: [[1, 1, 0], [1, -1, 0], [0, 0, 1]], name: "coreXY", segmentation: null },
			limitAxes: true,
			noMovesBeforeHoming: true,
			printingAcceleration: 3000,
			queue: [{ gracePeriod: 0.01, length: 40 }],
			// `delays`, not `durations` — the field name is the vendored
			// @duet3d/objectmodel 3.6.3 class (reference/objectmodel/src/move/
			// InputShaping.ts) and the real board's capture agrees. Disabled
			// shaping is a single unit impulse, as the capture shows.
			shaping: { amplitudes: [1], damping: 0.1, delays: [0], frequency: 40, type: "none" },
			speedFactor: 1,
			travelAcceleration: 5000,
			workplaceNumber: 0,
		},
		network: {
			corsSite: "",
			hostname: "mockduet",
			interfaces: [
				{
					actualIP: "127.0.0.1",
					activeProtocols: ["http"],
					configuredIP: "0.0.0.0",
					dnsServer: "0.0.0.0",
					firmwareVersion: "2.1.0",
					gateway: "192.168.1.1",
					mac: "de:ad:be:ef:00:01",
					signal: -54,
					speed: null,
					ssid: "MockNet",
					state: "active",
					subnet: "255.255.255.0",
					type: "wifi",
				},
			],
			name: "Mock Duet",
		},
		sensors: {
			analog: [
				{ lastReading: AMBIENT, name: "Bed", state: "ok", type: "thermistor" },
				{ lastReading: AMBIENT, name: "Hotend", state: "ok", type: "thermistor" },
				{ lastReading: 34.2, name: "MCU", state: "ok", type: "mcutemp" },
			],
			endstops: [
				{ highEnd: false, triggered: false, type: "inputPin" },
				{ highEnd: false, triggered: false, type: "inputPin" },
				null,
			],
			filamentMonitors: [],
			gpIn: [],
			probes: [
				{
					calibrationTemperature: 25,
					deployedByUser: false,
					disablesHeaters: false,
					diveHeights: [5, 5],
					lastStopHeight: 0,
					maxProbeCount: 1,
					offsets: [-25, -5],
					recoveryTime: 0,
					speeds: [120, 120],
					temperatureCoefficients: [0, 0],
					threshold: 500,
					tolerance: 0.03,
					travelSpeed: 6000,
					triggerHeight: 1.45,
					type: 9,
					value: [0],
				},
			],
		},
		spindles: [],
		state: {
			atxPower: null,
			atxPowerPort: null,
			beep: null,
			currentTool: 0, // config.g ends with T0, like most single-tool configs
			displayMessage: "",
			gpOut: [],
			laserPwm: null,
			logFile: null,
			logLevel: "off",
			machineMode: "FFF",
			macroRestarted: false,
			messageBox: null,
			msUpTime: 0,
			nextTool: -1,
			pluginsStarted: false,
			powerFailScript: "",
			previousTool: -1,
			restorePoints: [],
			startupError: null,
			status: "idle",
			time: "2026-07-12T12:00:00",
			upTime: 0,
		},
		tools: [
			{
				active: [0],
				axes: [[0], [1]],
				extruders: [0],
				fans: [0],
				filamentExtruder: 0,
				heaters: [1],
				mix: [1],
				name: "",
				number: 0,
				offsets: [0, 0, 0],
				offsetsProbed: 0,
				retraction: { extraRestart: 0, length: 2, speed: 45, zHop: 0.2 },
				spindle: -1,
				spindleRpm: 0,
				standby: [0],
				state: "active", // selected by the trailing T0 in config.g
			},
		],
		volumes: [
			{
				capacity: 15931539456,
				freeSpace: 15127343104,
				mounted: true,
				openFiles: 0,
				path: "0:/",
				speed: 20000000,
			},
		],
	};
}

function mkInput(name: string): Om {
	return {
		axesRelative: false,
		compatibility: "RepRapFirmware",
		distanceUnit: "mm",
		drivesRelative: true,
		feedRate: 50,
		inMacro: false,
		lineNumber: 0,
		macroRestartable: false,
		name,
		stackDepth: 0,
		state: "idle",
		volumetric: false,
	};
}

function mkAxis(letter: string, min: number, max: number): Om {
	return {
		acceleration: 3000,
		babystep: 0,
		current: 1000,
		drivers: [letter === "Z" ? "0.2" : letter === "Y" ? "0.1" : "0.0"],
		homed: false,
		jerk: 900,
		letter,
		machinePosition: 0,
		max,
		maxProbed: false,
		microstepping: { interpolated: true, value: 16 },
		min,
		minProbed: false,
		speed: 6000,
		stepsPerMm: letter === "Z" ? 400 : 80,
		userPosition: 0,
		visible: true,
		workplaceOffsets: [0, 0, 0, 0, 0, 0, 0, 0, 0],
	};
}

export { AMBIENT };
