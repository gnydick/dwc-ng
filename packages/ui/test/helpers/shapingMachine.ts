// Crafted object models and configs for the Shaping Lab's motion tests.
//
// Shared by shaping-procedure.test.ts (planning) and
// shaping-procedure-run.test.ts (running) so the two halves are measured
// against the SAME machine — a fixture that drifted between them would let a
// plan pass here and a run fail there for reasons neither test could see.
import { Preconditions } from "../../src/shaping/preconditions.ts";
import { sampleRateFrom, type ProcEvent, type Procedure, type RingPlan, type RunConnector, type SampleRate } from "../../src/shaping/procedure.ts";
import type { FileListEntry, GcodeCommand, SendCodeOptions } from "@dwc-ng/connector";
import { accelAddr } from "../../src/control/commands.ts";
import { emptyModel, type Axis, type Board, type ObjectModel, type Shaping } from "../../src/om/types.ts";
import type { Envelope, ShapingConfig } from "../../src/config/types.ts";
import { mm, mmPerS } from "../../src/shaping/engine/units.ts";

export const TOOLBOARD = accelAddr(20, 0);
export const MAINBOARD = accelAddr(0, 0);
export const NOW = 1_000_000;

/** What `M955 P20.0` answers with, in RRF's own shape. */
export const M955_REPLY = "Accelerometer 20:0 type LIS3DH with orientation 41 samples at 1375Hz with 10-bit resolution";

/** The board's reported accelerometer rate, minted the ONLY way one can be:
 *  through the parser, off the sentence M955 P answers with. The number is the
 *  one Gabe's toolboard reports (tools/accel/runs/ui-first-run-2026-08-23:
 *  "Rate 1375"), so the sample counts these tests assert are the counts that
 *  machine would be asked for. */
export const RATE: SampleRate = (() => {
	const parsed = sampleRateFrom(M955_REPLY);
	if (parsed === null) throw new Error("fixture: the M955 reply did not parse");
	return parsed;
})();

export const BOX: Envelope = { x: [50, 250], y: [50, 250] };


export const NO_SHAPER: Shaping = { type: "none", frequency: 0, damping: 0, amplitudes: [], delays: [] };
export const EI2_PRIOR: Shaping = { type: "ei2", frequency: 52, damping: 0.075, amplitudes: [0.34, 0.44, 0.22], delays: [0, 0.0096, 0.0192] };

export function axis(letter: string, homed: boolean, position: number | null): Axis {
	return { letter, homed, machinePosition: position, userPosition: position, min: 0, max: 300, babystep: 0, visible: true };
}

/**
 * `runs: null` is a board that reports an accelerometer with NO run counter.
 * That is not a hypothetical shape: the live d99fn patch route never meets
 * `conformModelKey`, so the declared `runs: number` is a claim the store does
 * not enforce, and the procedure re-parses it for exactly this reason.
 */
export function board(canAddress: number, accelerometer: boolean, runs: number | null = 0): Board {
	const accel = runs === null
		? ({ orientation: 20, points: 0 } as unknown as Board["accelerometer"])
		: { orientation: 20, points: 0, runs };
	return {
		name: `board-${canAddress}`,
		shortName: String(canAddress),
		canAddress,
		mcuTemp: null,
		vIn: null,
		accelerometer: accelerometer ? accel : null,
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
	return { envelope, defaults: { distMm: 60, speedMmS: 200, repeats: 3 }, accelByTool: {} };
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
//
// It models the DUMP, not just the file. A real board creates the entry and
// then streams the samples into it off the CAN toolboard, so the name exists
// long before the contents do: here the entry appears after `fileAfterPolls`
// listings at a partial size that grows, and only `dumpPolls` listings later
// does it reach its final size and the run counter tick. A fake that wrote the
// file atomically at completion could not fail a run that took the name as
// proof — which is exactly the bug that reached Gabe's machine on 2026-08-23.

export const FAKE_CSV = "0,0.01,0.02,0.03\nRate 1344, overflows 0\n";

/** The size the fake's captures settle at, and the chunk a poll sees arrive
 *  while one is still being written. Both arbitrary: what matters is that the
 *  size MOVES while the dump is in flight and stops when it is not. */
const FINAL_SIZE = 4096;
const CHUNK_SIZE = 512;

export type FakeOptions = {
	/** Throw from here to reject the nth send ATTEMPT (0-based over the whole
	 *  run, so a rejected attempt still consumes its number). */
	onSend?: (code: string, nth: number) => void;
	/** How many directory listings pass before an armed capture's file lands. */
	fileAfterPolls?: number;
	/** How many further listings the board spends WRITING that file before the
	 *  dump finishes and its run counter ticks. 0 = the file lands finished. */
	dumpPolls?: number;
	/** Files already in the accelerometer directory when the run starts. They
	 *  are there at their final size, exactly like a capture from last week. */
	preexisting?: readonly string[];
	/** Millimetres of error the simulated carriage introduces on every move. */
	driftOnMove?: number;
	/** What `M955 P<addr>` answers with. Default: the real sentence. */
	accelReply?: string;
	/** What a download of a capture answers with. Default: a complete CSV. */
	download?: (path: string) => string;
};

export type Fake = {
	conn: RunConnector;
	sent: string[];
	/** The per-call deadline each `sent` code carried, index for index —
	 *  `undefined` where the caller passed none. A parallel array rather than
	 *  a richer `sent`, so every existing assertion about the WIRE keeps
	 *  reading the wire. */
	deadlines: Array<number | undefined>;
	listed: string[];
	downloaded: string[];
	/** How many listings had happened when each download was issued. This is
	 *  what proves a capture was NOT read while the board was still writing
	 *  it: a count is a fact about ordering, an event kind is not. */
	downloadedAfterListings: number[];
};

export function fakeBoard(model: ObjectModel, opts: FakeOptions = {}): Fake {
	const sent: string[] = [];
	const deadlines: Array<number | undefined> = [];
	const listed: string[] = [];
	const downloaded: string[] = [];
	const downloadedAfterListings: number[] = [];
	const sizes = new Map<string, number>((opts.preexisting ?? []).map((name) => [name, FINAL_SIZE]));
	let pending: { file: string; appearIn: number; finishIn: number }[] = [];
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
		async sendCode(code: GcodeCommand, sendOpts?: SendCodeOptions): Promise<string> {
			opts.onSend?.(String(code), attempts++);
			sent.push(String(code));
			deadlines.push(sendOpts?.timeoutMs);
			const armed = /^M956 .* F"(.+)"$/.exec(String(code));
			if (armed !== null) {
				const appearIn = opts.fileAfterPolls ?? 0;
				pending.push({ file: armed[1] ?? "", appearIn, finishIn: appearIn + (opts.dumpPolls ?? 0) });
			}
			const move = /^G1 X(-?[\d.]+) Y(-?[\d.]+) F/.exec(String(code));
			if (move !== null) setAt(Number(move[1]) + (opts.driftOnMove ?? 0), Number(move[2]));
			// M955 with P alone REPORTS; the board answers with a sentence and
			// changes nothing. `opts.accelReply` is how a test says the board
			// answered with something unusable.
			if (/^M955 P[\d.]+$/.test(String(code))) return opts.accelReply ?? M955_REPLY;
			return "";
		},
		async list(dir: string): Promise<FileListEntry[]> {
			listed.push(dir);
			const still: typeof pending = [];
			for (const p of pending) {
				if (p.appearIn > 0) {
					// Not created yet: nothing to see, and the dump's own clock
					// runs from the arm, not from the moment the entry lands.
					still.push({ file: p.file, appearIn: p.appearIn - 1, finishIn: p.finishIn - 1 });
				} else if (p.finishIn > 0) {
					// Created, and filling. This is the state a name alone
					// cannot tell from a finished capture.
					sizes.set(p.file, (sizes.get(p.file) ?? 0) + CHUNK_SIZE);
					still.push({ file: p.file, appearIn: 0, finishIn: p.finishIn - 1 });
				} else {
					sizes.set(p.file, FINAL_SIZE);
					bumpRuns();
				}
			}
			pending = still;
			return [...sizes].map(([name, size]) => ({ type: "f" as const, name, size }));
		},
		async download(path: string): Promise<string> {
			downloaded.push(path);
			downloadedAfterListings.push(listed.length);
			return opts.download === undefined ? FAKE_CSV : opts.download(path);
		},
	};
	return { conn, sent, deadlines, listed, downloaded, downloadedAfterListings };
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
