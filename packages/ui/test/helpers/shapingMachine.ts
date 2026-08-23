// Crafted object models and configs for the Shaping Lab's motion tests.
//
// Shared by shaping-procedure.test.ts (planning) and
// shaping-procedure-run.test.ts (running) so the two halves are measured
// against the SAME machine — a fixture that drifted between them would let a
// plan pass here and a run fail there for reasons neither test could see.
import { Preconditions } from "../../src/shaping/preconditions.ts";
import type { ProcEvent, Procedure, RingPlan, RunConnector } from "../../src/shaping/procedure.ts";
import type { FileListEntry, GcodeCommand } from "@dwc-ng/connector";
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

// --- a fake board -----------------------------------------------------------
//
// Shared by the planning and running tests. Since `Procedure` no longer hands
// out its commands, "what exactly does this plan send?" can only be answered by
// running it, so BOTH suites need a board to run against — and it has to be one
// board, or the two halves would be measured against different machines.
//
// It is a small simulator, not a stub: it moves when told to move, writes a
// capture file when armed, and counts its runs. A stub that always said yes
// could not fail a position check or a capture wait.

export const FAKE_CSV = "0,0.01,0.02,0.03\nRate 1344, overflows 0\n";

export type FakeOptions = {
	/** Throw from here to reject the nth send ATTEMPT (0-based over the whole
	 *  run, so a rejected attempt still consumes its number). */
	onSend?: (code: string, nth: number) => void;
	/** How many directory listings pass before an armed capture's file lands. */
	fileAfterPolls?: number;
	/** Files already in the accelerometer directory when the run starts. */
	preexisting?: readonly string[];
	/** Millimetres of error the simulated carriage introduces on every move. */
	driftOnMove?: number;
};

export type Fake = { conn: RunConnector; sent: string[]; listed: string[]; downloaded: string[] };

export function fakeBoard(model: ObjectModel, opts: FakeOptions = {}): Fake {
	const sent: string[] = [];
	const listed: string[] = [];
	const downloaded: string[] = [];
	const present = new Set<string>(opts.preexisting ?? []);
	let pending: { file: string; ticks: number }[] = [];
	let attempts = 0;

	const setAt = (x: number, y: number): void => {
		for (const a of model.move.axes) {
			if (a.letter === "X") a.userPosition = x;
			if (a.letter === "Y") a.userPosition = y;
		}
	};
	const bumpRuns = (): void => {
		const b = model.boards.find((e) => e !== null && e.canAddress === 20);
		const accel = b?.accelerometer;
		if (accel) (accel as { runs: number }).runs += 1;
	};

	const conn: RunConnector = {
		async sendCode(code: GcodeCommand): Promise<string> {
			opts.onSend?.(String(code), attempts++);
			sent.push(String(code));
			const armed = /^M956 .* F"(.+)"$/.exec(String(code));
			if (armed !== null) pending.push({ file: armed[1] ?? "", ticks: opts.fileAfterPolls ?? 0 });
			const move = /^G1 X(-?[\d.]+) Y(-?[\d.]+) F/.exec(String(code));
			if (move !== null) setAt(Number(move[1]) + (opts.driftOnMove ?? 0), Number(move[2]));
			return "";
		},
		async list(dir: string): Promise<FileListEntry[]> {
			listed.push(dir);
			const ready = pending.filter((p) => p.ticks <= 0);
			pending = pending.filter((p) => p.ticks > 0).map((p) => ({ file: p.file, ticks: p.ticks - 1 }));
			for (const p of ready) { present.add(p.file); bumpRuns(); }
			return [...present].map((name) => ({ type: "f" as const, name, size: 1 }));
		},
		async download(path: string): Promise<string> {
			downloaded.push(path);
			return FAKE_CSV;
		},
	};
	return { conn, sent, listed, downloaded };
}

/** Instant, deterministic time. Every poll advances the clock by its own wait,
 *  so the capture budget is exercised for real without the suite sleeping. */
export function testClock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
	let t = 0;
	return { now: () => t, sleep: async (ms: number): Promise<void> => { t += ms; } };
}

export async function drain(gen: AsyncGenerator<ProcEvent, void, void>): Promise<ProcEvent[]> {
	const out: ProcEvent[] = [];
	for await (const ev of gen) out.push(ev);
	return out;
}

export const kinds = (events: readonly ProcEvent[]): string[] => events.map((e) => e.kind);

export const errorOf = (events: readonly ProcEvent[]): string => {
	const failed = events.filter((e) => e.kind === "failed");
	return failed.length === 0 ? "" : (failed[failed.length - 1] as { error: string }).error;
};

/**
 * Run a procedure against a fresh fake board and report what the board heard.
 *
 * This is now the ONLY way to see a procedure's commands, which is the point:
 * the assertion measures what reaches the machine rather than what a field
 * happens to hold.
 */
export async function sentBy(proc: Procedure, model: ObjectModel, opts: FakeOptions = {}): Promise<string[]> {
	const fake = fakeBoard(model, opts);
	await drain(proc.run(fake.conn, () => model, testClock()));
	return fake.sent;
}
