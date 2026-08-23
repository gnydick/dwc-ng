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
import { RESULTS_PATH, RESULTS_VERSION } from "../shaping/results.ts";
import { toolMacroPath } from "../shaping/toolMacro.ts";
import { ACCEL_DIR, captureNameParts } from "../shaping/captures.ts";

export type ScenarioId = "idle" | "printing" | "paused" | "heater-fault" | "multi-tool" | "shaping-measured";

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
	{ id: "shaping-measured", label: "Shaping measured", note: "T0 fingerprinted, ranked and verified — including the shaper that added a 38 Hz ring." },
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
	): Board => ({ name, shortName, canAddress, firmwareVersion: version, firmwareFileName: file, mcuTemp: { current: mcu }, vIn: { current: 24.1 }, v12: canAddress === 0 ? { current: 12.1 } : null,
		// Only the tool boards carry one on this machine; the Shaping Lab reads
		// exactly this to decide which boards it may capture from.
		accelerometer: canAddress >= 20 ? { orientation: 41, points: 0, runs: 0 } : null });
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
		// Absent, not zero: the idle scenario is what exercises the em-dash
		// path, so both renderings are reachable in the lab without a machine.
		currentMove: { requestedSpeed: null, topSpeed: null, extrusionRate: null },
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
		// No shaper configured in the lab's base model — the Shaping Lab is what
		// puts one here, so its "before" state stays reachable without a machine.
		shaping: { type: "none", frequency: 0, damping: 0, amplitudes: [], delays: [] },
		travelAcceleration: 8000,
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
		probes: [{ type: 8, value: [0], threshold: 500, triggerHeight: 0, lastStopHeight: null }],
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
	// Requested above achieved — the normal printing case, where cornering and
	// segment length keep the machine off its commanded feedrate.
	model.move.currentMove = { requestedSpeed: 120, topSpeed: 87.4, extrusionRate: 3.2 };
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
		case "shaping-measured":
			// Idle, homed and cold — the state a capture run demands, and the one
			// the Shaping cards are read in. `move.shaping` stays "none": the
			// session in the results file below is measured and verified but NOT
			// applied, which is the state where seven of the eight cards have
			// something to say.
			return model;
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

/* ----------------------------------------------- shaping results (card file) */

/**
 * The Shaping Lab reads its per-tool results from a file on the SD card, so a
 * scenario that wants those cards populated supplies that FILE and lets the
 * store's own parse boundary (shaping/results.ts) build the typed results from
 * it. Nothing here constructs a Fingerprint, a Candidate or a
 * VerifiedCandidate directly — those types are mintable only by the engine and
 * by verifyAnalysis, which is the whole point of them. The lab gets exactly
 * what a real card would give it, through exactly the same gate.
 *
 * EVERY NUMBER BELOW IS MEASURED, none invented. They are the prototype's ring1
 * session on Gabe's toolchanger, 2026-08-22, as recorded by tools/accel:
 *
 *  - the fingerprint and all twelve per-capture fits are verbatim from
 *    tools/accel/runs/ring/ring1/fingerprint.json (six stops per axis:
 *    X 18.1 Hz zeta 0.127 0.050 g, Y 51.6 Hz zeta 0.075 0.103 g);
 *  - the capture file names come from that run's ring.json (60 mm at
 *    200 mm/s from 120,120);
 *  - the candidate specs are the best of each shaper type from ranking.json,
 *    worst-robustness first, followed by the two F52 shapers the operator
 *    carried through to a verify run;
 *  - the verified entries are from verify.json, including the one this whole
 *    campaign exists for: zvdd F17.5 — which the impulse model rated second
 *    best of any type — measured WORSE than no shaper at all, because its
 *    ~28 ms impulse spacing excites a 38 Hz mode the unshaped machine does not
 *    have (X 37.8 Hz 0.084 g, Y 38.1 Hz 0.121 g).
 *
 * `cyclesFit` is the one field the prototype's AGGREGATES do not carry. For the
 * twelve captures it is the recorded per-capture value; for the three verify
 * fingerprints it is derived the way the fitter's own decay window is —
 * ln(1/0.15) / (2·pi·zeta), the cycles a ring takes to fall to 15 % of its peak
 * — because a Mode cannot be revived without one. No card renders it.
 */
const RING1_FINGERPRINT = {
	X: { f: 18.134033203125, zeta: 0.1268571930432652, peakG: 0.050196345221876666, cyclesFit: 2.1884765625 },
	Y: { f: 51.59466552734375, zeta: 0.07544016623059525, peakG: 0.1028761604840497, cyclesFit: 4.6231689453125 },
	n: { X: 6, Y: 6 },
	spreadHz: { X: 0.518310546875, Y: 1.213134765625 },
};

const RING1_CAPTURES = [
	{ file: "ring1_Xp0.csv", axis: "X", dir: "+", rep: 0, fit: { f: 18.140625, zeta: 0.12460990562116141, peakG: 0.047582702267217857, cyclesFit: 2.20166015625 }, tStop: 0.4251453488372093 },
	{ file: "ring1_Xp1.csv", axis: "X", dir: "+", rep: 1, fit: { f: 17.843505859375, zeta: 0.12742901905505272, peakG: 0.05101792454203701, cyclesFit: 2.19970703125 }, tStop: 0.4271211022480058 },
	{ file: "ring1_Xp2.csv", axis: "X", dir: "+", rep: 2, fit: { f: 18.1669921875, zeta: 0.12771979516289678, peakG: 0.049645997607167404, cyclesFit: 2.14892578125 }, tStop: 0.42452830188679247 },
	{ file: "ring1_Xm0.csv", axis: "X", dir: "-", rep: 0, fit: { f: 18.0118408203125, zeta: 0.12951997900323292, peakG: 0.05074669283658593, cyclesFit: 2.1290283203125 }, tStop: 0.43002175489485134 },
	{ file: "ring1_Xm1.csv", axis: "X", dir: "-", rep: 1, fit: { f: 18.36181640625, zeta: 0.1262853670314777, peakG: 0.04924323319665922, cyclesFit: 2.1688232421875 }, tStop: 0.42681159420289855 },
	{ file: "ring1_Xm2.csv", axis: "X", dir: "-", rep: 2, fit: { f: 18.12744140625, zeta: 0.1259993035243432, peakG: 0.05108980575008873, cyclesFit: 2.1884765625 }, tStop: 0.4269090909090909 },
	{ file: "ring1_Yp0.csv", axis: "Y", dir: "+", rep: 0, fit: { f: 51.6788330078125, zeta: 0.08733857553190659, peakG: 0.10228234877719825, cyclesFit: 3.672607421875 }, tStop: 0.444525018129079 },
	{ file: "ring1_Yp1.csv", axis: "Y", dir: "+", rep: 1, fit: { f: 51.8287353515625, zeta: 0.08397074709695064, peakG: 0.10723598853964002, cyclesFit: 3.7100830078125 }, tStop: 0.42733188720173537 },
	{ file: "ring1_Yp2.csv", axis: "Y", dir: "+", rep: 2, fit: { f: 51.37939453125, zeta: 0.08160892693914375, peakG: 0.11545189982391406, cyclesFit: 4.095458984375 }, tStop: 0.42318840579710143 },
	{ file: "ring1_Ym0.csv", axis: "Y", dir: "-", rep: 0, fit: { f: 51.510498046875, zeta: 0.06034491647176185, peakG: 0.103463594529451, cyclesFit: 5.080078125 }, tStop: 0.4227701232777375 },
	{ file: "ring1_Ym1.csv", axis: "Y", dir: "-", rep: 1, fit: { f: 51.361083984375, zeta: 0.06927140552204676, peakG: 0.10228872643864839, cyclesFit: 5.00537109375 }, tStop: 0.4254545454545455 },
	{ file: "ring1_Ym2.csv", axis: "Y", dir: "-", rep: 2, fit: { f: 52.57421875, zeta: 0.06205675784453656, peakG: 0.09050018113347098, cyclesFit: 4.6231689453125 }, tStop: 0.4251453488372093 },
];

/** Specs only: every residual and robustness column is re-scored against the
 *  fingerprint on read, so a stale copy of one cannot exist (results.ts). */
const RING1_CANDIDATES = [
	{ type: "zvddd", F: 17.5, S: 0.2 },
	{ type: "zvdd", F: 17.5, S: 0.2 },
	{ type: "ei3", F: 17.0, S: 0.1 },
	{ type: "ei2", F: 16.5, S: 0.1 },
	{ type: "zvd", F: 17.5, S: 0.2 },
	{ type: "mzv", F: 13.0, S: 0.05 },
	{ type: "ei2", F: 52.0, S: 0.1 },
	{ type: "zvdd", F: 52.0, S: 0.1 },
];

/** Spec + the fingerprint measured WITH it on. The verdict is re-derived by
 *  verifyAnalysis on read — a file cannot claim a shaper was verified, only
 *  carry the measurement that makes the analysis come out that way. */
const RING1_VERIFIED = [
	{
		spec: { type: "ei2", F: 52.0, S: 0.1 },
		fingerprint: {
			X: null,
			Y: { f: 15.060546875, zeta: 0.05210280360587004, peakG: 0.028654471269929233, cyclesFit: 5.795 },
			n: { X: 0, Y: 4 },
			spreadHz: { X: 0, Y: 0.2120361328125 },
		},
	},
	{
		spec: { type: "zvdd", F: 52.0, S: 0.1 },
		fingerprint: {
			X: null,
			Y: { f: 15.082275390625, zeta: 0.08740666518886099, peakG: 0.0307218239675315, cyclesFit: 3.4544 },
			n: { X: 0, Y: 4 },
			spreadHz: { X: 0, Y: 0.200927734375 },
		},
	},
	{
		// The campaign's reason to exist: predicted 0 % residual on both axes,
		// measured 167 % of baseline on X and 118 % on Y, with a 38 Hz mode the
		// unshaped machine never showed.
		spec: { type: "zvdd", F: 17.5, S: 0.2 },
		fingerprint: {
			X: { f: 37.79296875, zeta: 0.07249646214676221, peakG: 0.08394011594596341, cyclesFit: 4.1648 },
			Y: { f: 38.05859375, zeta: 0.13026405120686207, peakG: 0.1210640111623631, cyclesFit: 2.3179 },
			n: { X: 3, Y: 4 },
			spreadHz: { X: 6.0830078125, Y: 0.2236328125 },
		},
	},
];

/** A tool nobody has measured: present on the card, empty of results. The
 *  parse boundary refuses a MISSING key, so "empty" is written out in full. */
function emptyResultsFile(tool: number): string {
	return JSON.stringify({
		version: RESULTS_VERSION,
		tool,
		fingerprint: null,
		captures: [],
		sweep: null,
		candidates: [],
		verified: [],
		applied: null,
	});
}

function ring1ResultsFile(tool: number): string {
	return JSON.stringify({
		version: RESULTS_VERSION,
		tool,
		fingerprint: RING1_FINGERPRINT,
		captures: RING1_CAPTURES,
		// The prototype ran no speed sweep in this session.
		sweep: null,
		candidates: RING1_CANDIDATES,
		verified: RING1_VERIFIED,
		// Measured and verified, NOT yet written to tpost0.g — the state in
		// which the Apply card has a recommendation to offer rather than a fact
		// to report, and `move.shaping` above is still "none".
		applied: null,
	});
}


/* -------------------------------------------- accelerometer CSVs (card file) */

/**
 * A capture CSV for the Card Lab, GENERATED rather than shipped.
 *
 * The Decay card draws a real capture downloaded from `0:/sys/accelerometer`,
 * and the lab's stub connector has to answer for one or the card has nothing
 * to draw at any size — which is a problem for a bench whose whole job is
 * measuring cards at their real content. Shipping the twelve 35 KB fixtures
 * into a lab module was the alternative and it is the wrong one: they are test
 * fixtures, not app data, and the lab would carry 420 KB to draw one curve.
 *
 * So this synthesises a ring-down with the shape RRF's `M956` writes: a
 * `Sample,X,Y,Z` body and a `Rate N, overflows 0` trailer, an acceleration
 * pulse, a cruise, a hard stop, and a damped sinusoid after it. The MODEL's
 * frequency and damping are the machine's measured ones (X 18.1 Hz ζ 0.127,
 * Y 51.6 Hz ζ 0.075 — tools/accel/runs/ring/ring1/fingerprint.json), because a
 * lab curve at 5 Hz would not exercise the chart at the scale it will be read
 * at. What comes back on screen is nevertheless whatever the ENGINE makes of
 * these samples — the lab does not get to assert a fit, only to supply a file.
 *
 * It is not a substitute for the real thing anywhere but the bench: real
 * captures reach the card through Import, and through the board in a session
 * with a board.
 */
const RING_MODEL = {
	X: { f: 18.1, zeta: 0.127, peakG: 0.05 },
	Y: { f: 51.6, zeta: 0.075, peakG: 0.103 },
} as const;

/** Deterministic sensor noise, so a lab measurement repeats exactly. */
function labNoise(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return (s / 4294967296 - 0.5) * 0.012;
	};
}

export function syntheticCapture(file: string): string {
	const { axis, dir, rep } = captureNameParts(file);
	const rate = 1379;
	const n = 1500;
	const sign = dir === "+" ? 1 : -1;
	const mode = RING_MODEL[axis];
	const noise = labNoise(rep * 7919 + (axis === "X" ? 11 : 23) + (dir === "+" ? 0 : 101));
	const wn = 2 * Math.PI * mode.f;
	const wd = wn * Math.sqrt(1 - mode.zeta * mode.zeta);
	// The move: accelerate 0.06–0.14 s, cruise, decelerate 0.35–0.43 s. The
	// decel plateau is what detectStop locates, so it has to stand well above
	// the 0.25 g threshold a 12 ms average is measured against.
	const tStop = 0.43;
	const rows = ["Sample,X,Y,Z"];
	for (let i = 0; i < n; i++) {
		const t = i / rate;
		let a = 0;
		if (t >= 0.06 && t < 0.14) a += sign * 0.62;
		if (t >= 0.35 && t < tStop) a -= sign * 0.62;
		if (t >= tStop) a += sign * mode.peakG * Math.exp(-mode.zeta * wn * (t - tStop)) * Math.cos(wd * (t - tStop));
		const x = (axis === "X" ? a : 0) + noise();
		const y = (axis === "Y" ? a : 0) + noise();
		rows.push(`${i},${x.toFixed(4)},${y.toFixed(4)},${(1 + noise()).toFixed(4)}`);
	}
	rows.push(`Rate ${rate}, overflows 0`);
	return rows.join("\n");
}

/**
 * The file a scenario would find at `path`, or null where it has none.
 *
 * The Card Lab's stub connector answers every download with an empty string,
 * which the results parser correctly refuses — so every scenario answers for
 * every tool here, with a well-formed empty file where it has nothing to say.
 * A card that reports "not measured" is telling the truth; an error banner
 * about an unreadable file would not be.
 */
/**
 * A post-select macro of the shape these actually take on Gabe's machine: the
 * heater wait, the offsets, and — on a carriage somebody has been tuning — a
 * short history of commented-out attempts above the live `M593`.
 *
 * The commented lines are not decoration. They are the case `findShapingLine`
 * exists for, and the case the Apply card (task G2) must not overwrite, so the
 * lab shows a file that has them rather than an idealised one that does not.
 */
function toolMacroFile(tool: number, shaped: boolean): string {
	const head = [`; tpost${tool}.g — after tool ${tool} is picked up`, `M116 P${tool}`, `G10 P${tool}`];
	const tuning = shaped
		? [
			'; M593 P"zvdd" F17.5 S0.2   ; predicted best, measured a new 38 Hz ring',
			'; M593 P"zvd" F52 S0.1',
			'M593 P"ei2" F52 S0.1',
		]
		: [];
	return [...head, ...tuning, ""].join("\n");
}

export function scenarioFile(id: ScenarioId, path: string): string | null {
	// Every capture the shaping results file names, so clicking a row on the
	// Decay card draws a curve on the bench exactly as it does on a machine.
	if (id === "shaping-measured" && path.startsWith(`${ACCEL_DIR}/`) && path.endsWith(".csv")) {
		return syntheticCapture(path.slice(ACCEL_DIR.length + 1));
	}
	for (const tool of [0, 1, 2, 3]) {
		if (path === RESULTS_PATH(tool)) {
			return id === "shaping-measured" && tool === 0 ? ring1ResultsFile(tool) : emptyResultsFile(tool);
		}
		// Only the shaping scenario answers for the tool macros: every other
		// scenario leaves them to the stub, so nothing else in the lab changes.
		if (path === toolMacroPath(tool) && id === "shaping-measured") {
			return toolMacroFile(tool, tool === 0);
		}
	}
	return null;
}
