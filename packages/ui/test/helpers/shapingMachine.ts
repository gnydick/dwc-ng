// Crafted object models and configs for the Shaping Lab's motion tests.
//
// Shared by shaping-procedure.test.ts (planning) and
// shaping-procedure-run.test.ts (running) so the two halves are measured
// against the SAME machine — a fixture that drifted between them would let a
// plan pass here and a run fail there for reasons neither test could see.
import { Preconditions, runPriorOf, type RunPrior } from "../../src/shaping/preconditions.ts";
import { sampleRateFrom, type ProcEvent, type Procedure, type RingPlan, type RunConnector, type SampleRate } from "../../src/shaping/procedure.ts";
import type { FileListEntry, GcodeCommand, SendCodeOptions } from "@dwc-ng/connector";
import { accelAddr } from "../../src/control/commands.ts";
import { emptyModel, type Axis, type Board, type ObjectModel, type Shaping, type Tool } from "../../src/om/types.ts";
import type { Envelope, ShapingConfig } from "../../src/config/types.ts";
import { mm, mmPerS } from "../../src/shaping/engine/units.ts";

export const TOOLBOARD = accelAddr(20, 0);
export const MAINBOARD = accelAddr(0, 0);
export const NOW = 1_000_000;

/** What `M955 P20.0` answers with, in RRF's own shape. */
export const M955_REPLY = "Accelerometer 20:0 type LIS3DH with orientation 41 samples at 1375Hz with 10-bit resolution";

/** The board's reported accelerometer rate, minted the ONLY way one can be:
 *  through the parser, off the sentence M955 P answers with. The number is the
 *  one Gabe's toolboard reports (test/fixtures/shaping/ui-first-run-2026-08-23:
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
	/** How many heads this machine has. Four, like Gabe's changer, unless a
	 *  test is about a machine with fewer. */
	tools?: number;
	/** Which head is on the carriage. `-1` is none, which is a real state a
	 *  toolchanger sits in between jobs. */
	currentTool?: number;
};

const toolNamed = (n: number): Tool => ({
	number: n, name: `T${n}`, heaters: [], filamentExtruder: -1, active: [], standby: [], state: "off",
});

/** Idle, homed at X100 Y100, an accelerometer on CAN board 20, no shaper, four
 *  heads with T0 on the carriage. */
export function modelWith(over: ModelOverrides = {}): ObjectModel {
	const m = emptyModel();
	m.state.status = over.status ?? "idle";
	m.move.axes = over.axes ?? [axis("X", true, 100), axis("Y", true, 100), axis("Z", true, 5)];
	m.boards = over.boards ?? [board(0, false), board(20, true)];
	m.tools = Array.from({ length: over.tools ?? 4 }, (_, n) => toolNamed(n));
	m.state.currentTool = over.currentTool ?? 0;
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

/**
 * The run-scoped prior a `Procedure` is planned against, for tests that care
 * about the shaper and not about the tool.
 *
 * Minted through `runPriorOf` like every real one — there is no other producer
 * — off a reading of a machine already holding the head being measured, so the
 * plans these tests assert about carry no tool change and their wire is the
 * one they were written for.
 */
export const priorOf = (shaping: Shaping = NO_SHAPER, tool = 0): RunPrior =>
	runPriorOf(freshPre({ shaping, currentTool: tool }), tool);

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

// --- the shaper the fake board is holding ------------------------------------
//
// The fake used to leave `move.shaping` frozen for the whole test, which made
// every shaper assertion in this suite unfalsifiable: a run could send
// `M593 P"none"` and the object model would still report the operator's ei2, so
// no test could tell a run that put the shaper back from one that did not. That
// is exactly how the multi-leg restore bug (#53 follow-on) survived — leg 2 of a
// measure run re-reads `move.shaping` for its "prior", and on a real board that
// field is whatever leg 1's own G-code last set it to.
//
// So the fake keeps TWO shapers, because a real machine does:
//
//   the BOARD's, which M593 changes the instant the firmware accepts it, and
//   the MIRROR — `model.move.shaping` — which is this UI's polled copy and only
//   catches up on a poll.
//
// Modelling the lag is not decoration. A fake whose mirror moved with the send
// would hand leg 2 a perfectly current reading, `pre.priorShaping` and the
// run's own `runPrior` would agree, and the bug would once again be invisible:
// with the fix reverted the whole suite still passed until the mirror learned
// to lag. What lags it is the capture wait's directory polling, which is
// literally where the real one catches up — "the poll catches up during leg 1's
// captures". A leg's restore is the last thing it sends and nothing polls after
// it, so leg 2 opens on a model that still reports leg 1's `none`.

/**
 * The shapers this fake can report an impulse train for.
 *
 * M593 states a shaper's IDENTITY — type, F, S — and the board derives the
 * impulse train from it. Deriving ei2's train here would mean reimplementing
 * the firmware's shaper maths inside a test helper, so instead the fake knows
 * the trains of the fixtures this suite already states, and reports an empty
 * train for any other named shaper. That is honest about what it models:
 * identity exactly, impulses only where something already states them.
 *
 * Nothing depends on the gap: `restoreFor` (procedure.ts) rebuilds a NAMED
 * shaper from its identity alone and only consults the train for `custom`,
 * which M593 spells out in full and this fake therefore reconstructs exactly.
 */
const KNOWN_TRAINS: readonly Shaping[] = [EI2_PRIOR];

/** RRF's number syntax, as it appears after an M593 parameter letter. */
const NUM = String.raw`-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?`;

/**
 * What an `M593` leaves `move.shaping` as, or null when the code changes it.
 *
 * Null covers two cases that are not a write: a code that is not an M593 at
 * all, and a BARE `M593`, which the firmware documents as asking rather than
 * setting (reference/duet-gcode.md, M593). An omitted F or S keeps the value
 * the machine is already holding, which is what makes `M593 P"none"` a change
 * of TYPE and not a reset of the whole shaper.
 *
 * Written here rather than imported from packages/mock-duet: that parser is
 * wired into a Machine and a Params object that only exist inside the mock's
 * HTTP server, and a test helper that had to stand one up to answer "what is
 * the shaper now" would be a far bigger dependency than eight lines of regex.
 */
export function shapingAfterM593(code: string, current: Shaping): Shaping | null {
	if (!/^M593(?:\s|$)/.test(code)) return null;
	const rest = code.slice("M593".length);
	if (rest.trim() === "") return null;
	const p = /\bP"([^"]*)"/.exec(rest);
	const f = new RegExp(String.raw`\bF(${NUM})`).exec(rest);
	const s = new RegExp(String.raw`\bS(${NUM})`).exec(rest);
	const type = (p === null ? current.type : p[1]!).toLowerCase();
	const frequency = f === null ? current.frequency : Number(f[1]);
	const damping = s === null ? current.damping : Number(s[1]);
	if (type === "none") return { type, frequency, damping, amplitudes: [], delays: [] };
	if (type === "custom") {
		const h = /\bH([\d.:]+)/.exec(rest);
		const t = /\bT([\d.:]+)/.exec(rest);
		if (h === null || t === null) return null;
		// H omits the last amplitude (the firmware derives it as 1 - sum) and T
		// omits the first delay (it is zero) — the exact complements procedure.ts
		// drops when it builds the command, put back here.
		const head = h[1]!.split(":").map(Number);
		return {
			type,
			frequency,
			damping,
			amplitudes: [...head, 1 - head.reduce((a, b) => a + b, 0)],
			delays: [0, ...t[1]!.split(":").map(Number)],
		};
	}
	const known = KNOWN_TRAINS.find((k) => k.type === type && k.frequency === frequency && k.damping === damping);
	return { type, frequency, damping, amplitudes: known?.amplitudes ?? [], delays: known?.delays ?? [] };
}

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
	/** The shaper the BOARD is holding right now — what the firmware would be
	 *  applying to the next move. `model.move.shaping` is the UI's polled MIRROR
	 *  of this and is allowed to be behind it; a test asking "what was the
	 *  machine left with?" has to ask here. */
	shaping: () => Shaping;
	/**
	 * Is the board still holding a capture request that no move has consumed?
	 *
	 * The fake arms on `M956` and consumes the arm on the next `G1`, which is
	 * what RRF's `A1`/`A2` do (reference/duet-gcode.md, M956: "activate just
	 * before the start of the next move" / "of the deceleration segment of the
	 * next move"). Modelling those as two events rather than one is what lets a
	 * test see the #43 failure at all: a fake that wrote the capture on the arm
	 * alone would report a perfectly finished run for a board left waiting.
	 */
	armed: () => boolean;
	/**
	 * The head the BOARD is holding right now. `model.state.currentTool` is the
	 * UI's polled mirror of this and is allowed to lag it, exactly as
	 * `move.shaping` does — a test asking "what was the machine left holding?"
	 * has to ask here.
	 */
	currentTool: () => number;
};

/**
 * Where this fake parks the carriage on a tool change.
 *
 * OUTSIDE the fixture envelope (BOX is 50..250) and deliberately so. A tool
 * change is real motion — dock, undock, Z clearance — and a fake that left the
 * head where it found it could not tell a procedure that plans its approach
 * from one that assumes the carriage never moved. With this, every step after
 * a tool change is checked against a machine that really did go somewhere
 * else, which is the state the bug lives in.
 */
export const DOCK = { x: 20, y: 280 };

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
	/** The firmware's own copy, which M593 changes at once. Starts agreeing with
	 *  the mirror: a machine nobody has sent anything to is not out of date. */
	let boardShaping: Shaping = model.move.shaping;
	/** The same two-copy treatment for the head on the carriage: the board's
	 *  own, which `T` changes at once, and the polled mirror below. */
	let boardTool: number = model.state.currentTool;
	const applyShaping = (code: string): void => {
		const next = shapingAfterM593(code, boardShaping);
		if (next !== null) boardShaping = next;
	};
	/**
	 * A poll: the mirror takes the board's CURRENT shaper, whole.
	 *
	 * Through the same `model` the caller passes to `sentBy` and `runMotion`,
	 * because that is the object `Preconditions.read` reads — a fake that
	 * recorded the shaper anywhere else would answer a question nothing asks.
	 * Wholesale rather than a queue of pending changes, because that is what a
	 * poll is: one look at the machine as it is, not a replay of what it was
	 * told.
	 *
	 * Assigned as a whole new object and never mutated in place — `modelWith`
	 * hands out the module-level `NO_SHAPER` / `EI2_PRIOR` by reference, and a
	 * fake that edited one of those would rewrite the fixtures for every test
	 * that ran after it.
	 */
	const pollShaping = (): void => {
		if (model.move.shaping === boardShaping) return;
		(model.move as unknown as Record<string, unknown>).shaping = boardShaping;
	};

	/** The same poll, for the head. */
	const pollTool = (): void => {
		model.state.currentTool = boardTool;
	};

	/**
	 * `T<n>`, as RRF documents it (reference/duet-gcode.md, T).
	 *
	 * Selecting the tool that is already active does NOTHING — no macros, no
	 * motion — which is precisely why a procedure may skip the send and still
	 * have a correct restore. Any other selection runs the change macros, and
	 * this fake models the one consequence the lab has to plan around: the
	 * carriage ends up at the dock rather than where it was.
	 */
	const selectTool = (n: number): void => {
		if (n === boardTool) return;
		boardTool = n;
		setAt(DOCK.x, DOCK.y);
	};

	/**
	 * The capture the board is holding, waiting for a move to trigger it.
	 *
	 * A real board's `A2` request survives until a move consumes it and has no
	 * documented way to be cancelled, so this survives too — including past the
	 * end of the run, which is the whole of what #43 was about. What a SECOND
	 * arm does to a pending one is a firmware fact nobody here has established,
	 * so the fake takes no position on it: `cmd.captureMove` cannot emit an arm
	 * without the move that consumes it, so two pending arms is not a state the
	 * app can put a board into.
	 */
	let armedFile: string | null = null;

	/** One line of one request, the way the firmware would take it. */
	const execute = (line: string): string => {
		const tool = /^T(-?\d+)$/.exec(line);
		if (tool !== null) {
			selectTool(Number(tool[1]));
			return "";
		}
		const arm = /^M956 .* F"(.+)"$/.exec(line);
		if (arm !== null) armedFile = arm[1] ?? "";
		const move = /^G1 X(-?[\d.]+) Y(-?[\d.]+) F/.exec(line);
		if (move !== null) {
			setAt(Number(move[1]) + (opts.driftOnMove ?? 0), Number(move[2]));
			if (armedFile !== null) {
				const appearIn = opts.fileAfterPolls ?? 0;
				pending.push({ file: armedFile, appearIn, finishIn: appearIn + (opts.dumpPolls ?? 0) });
				armedFile = null;
			}
		}
		applyShaping(line);
		// M955 with P alone REPORTS; the board answers with a sentence and
		// changes nothing. `opts.accelReply` is how a test says the board
		// answered with something unusable.
		if (/^M955 P[\d.]+$/.test(line)) return opts.accelReply ?? M955_REPLY;
		return "";
	};

	const conn: RunConnector = {
		async sendCode(code: GcodeCommand, sendOpts?: SendCodeOptions): Promise<string> {
			opts.onSend?.(String(code), attempts++);
			sent.push(String(code));
			deadlines.push(sendOpts?.timeoutMs);
			// One request may carry several newline-separated codes, and RRF runs
			// every line of it (packages/mock-duet/src/gcode.ts says the same of
			// the mock). The fake has to as well, or a fused arm-and-move would
			// look to it like a code it has never heard of.
			let reply = "";
			for (const line of String(code).split("\n")) reply = execute(line) || reply;
			return reply;
		},
		async list(dir: string): Promise<FileListEntry[]> {
			listed.push(dir);
			// A listing is the run's own polling loop, and it is where the UI's
			// copy of the machine catches up. See the note above the parser.
			pollShaping();
			pollTool();
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
	return {
		conn, sent, deadlines, listed, downloaded, downloadedAfterListings,
		shaping: () => boardShaping,
		armed: () => armedFile !== null,
		currentTool: () => boardTool,
	};
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

/** One step's label and the codes that step alone put on the wire. */
export type StepWire = { readonly label: string; readonly codes: readonly string[] };

/**
 * The same wire as `sentBy`, cut into the steps that produced it.
 *
 * `sentBy` answers "what did the board hear"; this answers "which step said
 * it", which is what an assertion about ONE step's codes actually needs. The
 * cuts come from the run's OWN `step` events — `Procedure.run` yields one
 * before that step's codes go out — so they cannot drift from the steps the
 * procedure really ran, and a step added at the front of every plan (the
 * shaper statement, #53) moves no expectation that names its step.
 *
 * The restore belongs to no step and is left out: `done` and `failed` are both
 * yielded before the `finally` sends it.
 */
export async function sentByStep(proc: Procedure, model: ObjectModel, opts: FakeOptions = {}): Promise<readonly StepWire[]> {
	const fake = fakeBoard(model, opts);
	const marks: Array<{ label: string; from: number }> = [];
	let endOfSteps = -1;
	for await (const ev of proc.run(fake.conn, () => model, testClock())) {
		if (ev.kind === "step") marks.push({ label: ev.label, from: fake.sent.length });
		if (endOfSteps < 0 && (ev.kind === "done" || ev.kind === "failed")) endOfSteps = fake.sent.length;
	}
	const end = endOfSteps < 0 ? fake.sent.length : endOfSteps;
	return marks.map((m, i) => ({ label: m.label, codes: fake.sent.slice(m.from, marks[i + 1]?.from ?? end) }));
}

/**
 * The codes of the ONE step with this label.
 *
 * By name and never by index: a test that says "this capture step sends
 * exactly these eight codes" is making a claim about that step, and reaching
 * it through `[0]` makes the claim break the next time anything is inserted in
 * front of it. Two steps of the same name — or none — is a broken fixture and
 * throws rather than quietly measuring the wrong one.
 */
export function codesOf(steps: readonly StepWire[], label: string): readonly string[] {
	const found = steps.filter((s) => s.label === label);
	if (found.length !== 1) throw new Error(`expected exactly one step labelled ${JSON.stringify(label)}, found ${found.length}`);
	return found[0]!.codes;
}
