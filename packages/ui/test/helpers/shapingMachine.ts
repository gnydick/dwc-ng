// Crafted object models and configs for the Shaping Lab's motion tests.
//
// Shared by shaping-procedure.test.ts (planning) and
// shaping-procedure-run.test.ts (running) so the two halves are measured
// against the SAME machine — a fixture that drifted between them would let a
// plan pass here and a run fail there for reasons neither test could see.
import { Preconditions } from "../../src/shaping/preconditions.ts";
import type { RingPlan } from "../../src/shaping/procedure.ts";
import { accelAddr } from "../../src/control/commands.ts";
import { emptyModel, type Axis, type Board, type ObjectModel, type Shaping } from "../../src/om/types.ts";
import type { Envelope, ShapingConfig } from "../../src/config/types.ts";
import { mm, mmPerS } from "../../src/shaping/engine/units.ts";

export const TOOLBOARD = accelAddr(20, 0);
export const MAINBOARD = accelAddr(0, 0);
export const NOW = 1_000_000;

export const BOX: Envelope = { x: [50, 250], y: [50, 250] };

export const NO_SHAPER: Shaping = { type: "none", frequency: 0, damping: 0, amplitudes: [], delays: [] };
export const EI2_PRIOR: Shaping = { type: "ei2", frequency: 52, damping: 0.075, amplitudes: [0.34, 0.44, 0.22], delays: [0, 0.0096, 0.0192] };

export function axis(letter: string, homed: boolean, position: number | null): Axis {
	return { letter, homed, machinePosition: position, userPosition: position, min: 0, max: 300, babystep: 0, visible: true };
}

export function board(canAddress: number, accelerometer: boolean, runs = 0): Board {
	return {
		name: `board-${canAddress}`,
		shortName: String(canAddress),
		canAddress,
		mcuTemp: null,
		vIn: null,
		accelerometer: accelerometer ? { orientation: 20, points: 0, runs } : null,
	};
}

export type ModelOverrides = {
	status?: string;
	axes?: Axis[];
	boards?: (Board | null)[];
	shaping?: Shaping;
	travelAcceleration?: unknown;
};

/** Idle, homed at X100 Y100, an accelerometer on CAN board 20, no shaper. */
export function modelWith(over: ModelOverrides = {}): ObjectModel {
	const m = emptyModel();
	m.state.status = over.status ?? "idle";
	m.move.axes = over.axes ?? [axis("X", true, 100), axis("Y", true, 100), axis("Z", true, 5)];
	m.boards = over.boards ?? [board(0, false), board(20, true)];
	const move = m.move as unknown as Record<string, unknown>;
	move.shaping = over.shaping ?? NO_SHAPER;
	move.travelAcceleration = "travelAcceleration" in over ? over.travelAcceleration : 3000;
	return m;
}

export function config(envelope: Envelope | null = BOX): ShapingConfig {
	return { envelope, defaults: { distMm: 60, speedMmS: 200, repeats: 3, samples: 1500 }, accelByTool: {} };
}

/** A Preconditions or an explosion — callers of this are not measuring `read`. */
export function freshPre(over: ModelOverrides = {}, cfg = config(), addr = TOOLBOARD): Preconditions {
	const r = Preconditions.read(modelWith(over), cfg, addr, NOW);
	if (!r.ok) throw new Error(`fixture refused: ${JSON.stringify(r.refusal)}`);
	return r.pre;
}

export const ringPlan = (over: Partial<RingPlan> = {}): RingPlan => ({
	kind: "ring",
	axis: "X",
	start: { x: mm(100), y: mm(100) },
	distMm: mm(60),
	speed: mmPerS(200),
	repeats: 3,
	samples: 1500,
	namePrefix: "ring",
	...over,
});
