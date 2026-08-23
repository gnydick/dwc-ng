/**
 * Running a Procedure: what actually reaches the wire, and what happens when
 * it does not.
 *
 * The three things these tests exist to pin, in order of how much damage they
 * prevent:
 *
 *  1. The restore goes out. Always. After a clean run, after a thrown send,
 *     after a refused position check, and after the operator cancels. A
 *     half-finished verify pass that leaves a candidate shaper active is the
 *     failure the restore-is-structural invariant is built around.
 *  2. A position that does not match the plan STOPS the run. It is never
 *     corrected — the machine is not told where it is, and it is not moved to
 *     where the plan assumed it was.
 *  3. A capture is proven by the machine, not assumed: the file has to appear
 *     (and, when it is overwriting a file of the same name, the board's own
 *     run counter has to tick) before the run moves on.
 *
 * The fake board below is a small simulator rather than a stub: it moves when
 * it is told to move, writes a capture file when it is armed, and counts its
 * runs. A stub that always said yes could not fail tests 2 or 3.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { FileListEntry, GcodeCommand } from "@dwc-ng/connector";
import { planProcedure, CAPTURE_DIR, type ProcEvent, type RingPlan, type RunConnector, type VerifyPlan } from "../src/shaping/procedure.ts";
import type { ObjectModel } from "../src/om/types.ts";
import { hz } from "../src/shaping/engine/units.ts";
import type { ShaperSpec } from "../src/shaping/engine/shapers.ts";
import { EI2_PRIOR, NOW, config, freshPre, modelWith, ringPlan } from "./helpers/shapingMachine.ts";

const CSV = "0,0.01,0.02,0.03\nRate 1344, overflows 0\n";
const EI2_SPEC: ShaperSpec = { type: "ei2", F: hz(52), S: 0.075 };
const OFF = 'M593 P"none"';
const EI2_LINE = 'M593 P"ei2" F52 S0.075';

/** Instant, deterministic time. Every poll advances the clock by its own wait,
 *  so the 10 s budget is exercised for real without the suite sleeping. */
function testClock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
	let t = 0;
	return { now: () => t, sleep: async (ms: number): Promise<void> => { t += ms; } };
}

type FakeOptions = {
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

type Fake = { conn: RunConnector; sent: string[]; listed: string[]; downloaded: string[] };

function fakeBoard(model: ObjectModel, opts: FakeOptions = {}): Fake {
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
			return CSV;
		},
	};
	return { conn, sent, listed, downloaded };
}

async function drain(gen: AsyncGenerator<ProcEvent, void, void>): Promise<ProcEvent[]> {
	const out: ProcEvent[] = [];
	for await (const ev of gen) out.push(ev);
	return out;
}

const kinds = (events: readonly ProcEvent[]): string[] => events.map((e) => e.kind);

const errorOf = (events: readonly ProcEvent[]): string => {
	const failed = events.filter((e) => e.kind === "failed");
	return failed.length === 0 ? "" : (failed[failed.length - 1] as { error: string }).error;
};

/** A planned ring on a fresh machine, with the fake board wired to that model. */
function ready(fake: FakeOptions = {}, over: Partial<RingPlan> = {}): Fake & { proc: ReturnType<typeof plannedRing>; model: ObjectModel } {
	const model = modelWith();
	const proc = plannedRing(over);
	return { proc, model, ...fakeBoard(model, fake) };
}

function plannedRing(over: Partial<RingPlan> = {}) {
	const planned = planProcedure(ringPlan({ repeats: 1, ...over }), freshPre(), config(), NOW);
	if (!planned.ok) throw new Error(`fixture refused: ${JSON.stringify(planned.refusal)}`);
	return planned.proc;
}

// --- the happy path ---------------------------------------------------------

const RING_CODES = [
	"G90",
	"G1 X100 Y100 F12000",
	"M400",
	"G4 P500",
	'M956 P20.0 S1500 A2 F"ring_Xp0.csv"',
	"G1 X160 Y100 F12000",
	"M400",
	"G4 P1500",
	"G90",
	"G1 X160 Y100 F12000",
	"M400",
	"G4 P500",
	'M956 P20.0 S1500 A2 F"ring_Xm0.csv"',
	"G1 X100 Y100 F12000",
	"M400",
	"G4 P1500",
];

test("a one-repeat ring puts exactly the planned codes on the wire, then the restore", async () => {
	const r = ready();
	const events = await drain(r.proc.run(r.conn, () => r.model, testClock()));
	assert.deepEqual(r.sent, [...RING_CODES, OFF]);
	assert.deepEqual(kinds(events), ["step", "capture", "step", "capture", "done", "restored"]);
});

test("each capture is downloaded from the accelerometer directory and carried in the event", async () => {
	const r = ready();
	const events = await drain(r.proc.run(r.conn, () => r.model, testClock()));
	assert.deepEqual(r.downloaded, [`${CAPTURE_DIR}/ring_Xp0.csv`, `${CAPTURE_DIR}/ring_Xm0.csv`]);
	assert.deepEqual(events.filter((e) => e.kind === "capture"), [
		{ kind: "capture", file: "ring_Xp0.csv", csv: CSV },
		{ kind: "capture", file: "ring_Xm0.csv", csv: CSV },
	]);
});

test("step events carry the index and the label the progress strip shows", async () => {
	const r = ready();
	const events = await drain(r.proc.run(r.conn, () => r.model, testClock()));
	assert.deepEqual(events.filter((e) => e.kind === "step"), [
		{ kind: "step", index: 0, label: "X+ 200 mm/s (1/1)" },
		{ kind: "step", index: 1, label: "X- 200 mm/s (1/1)" },
	]);
});

test("a capture that only appears on the second poll is still downloaded", async () => {
	const r = ready({ fileAfterPolls: 1 });
	const events = await drain(r.proc.run(r.conn, () => r.model, testClock()));
	assert.deepEqual(kinds(events), ["step", "capture", "step", "capture", "done", "restored"]);
	assert.deepEqual(r.downloaded, [`${CAPTURE_DIR}/ring_Xp0.csv`, `${CAPTURE_DIR}/ring_Xm0.csv`]);
});

test("a capture overwriting a file of the same name waits for the board's run counter", async () => {
	const r = ready({ preexisting: ["ring_Xp0.csv", "ring_Xm0.csv"], fileAfterPolls: 2 });
	const events = await drain(r.proc.run(r.conn, () => r.model, testClock()));
	assert.deepEqual(kinds(events), ["step", "capture", "step", "capture", "done", "restored"]);
});

// --- refusing rather than correcting ----------------------------------------

test("a position mismatch before step 2 fails the run WITHOUT sending that step's codes", async () => {
	const r = ready({ driftOnMove: 10 });
	const events = await drain(r.proc.run(r.conn, () => r.model, testClock()));
	assert.deepEqual(r.sent, [...RING_CODES.slice(0, 8), OFF], "step 2 never went out, and nothing tried to fix the position");
	assert.deepEqual(kinds(events), ["step", "capture", "failed", "restored"]);
	assert.match(errorOf(events), /X170\.00 Y100\.00/);
	assert.match(errorOf(events), /X160\.00 Y100\.00/);
});

test("a mismatch on the very first step still restores, and sends nothing else", async () => {
	const model = modelWith({ shaping: EI2_PRIOR });
	const proc = (() => {
		const planned = planProcedure(ringPlan({ repeats: 1 }), freshPre({ shaping: EI2_PRIOR }), config(), NOW);
		if (!planned.ok) throw new Error("fixture refused");
		return planned.proc;
	})();
	// The carriage moved between the read and the run.
	for (const a of model.move.axes) if (a.letter === "X") a.userPosition = 130;
	const fake = fakeBoard(model);
	const events = await drain(proc.run(fake.conn, () => model, testClock()));
	assert.deepEqual(kinds(events), ["failed", "restored"]);
	assert.deepEqual(fake.sent, [EI2_LINE]);
});

test("a machine that stops reporting a homed position fails the run rather than guessing", async () => {
	const r = ready();
	for (const a of r.model.move.axes) if (a.letter === "Y") a.homed = false;
	const events = await drain(r.proc.run(r.conn, () => r.model, testClock()));
	assert.deepEqual(kinds(events), ["failed", "restored"]);
	assert.deepEqual(r.sent, [OFF]);
});

// --- failures mid-run -------------------------------------------------------

test("a send that throws on step 3 still gets the restore out", async () => {
	const model = modelWith();
	const planned = planProcedure(ringPlan({ repeats: 2 }), freshPre(), config(), NOW);
	assert.equal(planned.ok, true);
	if (!planned.ok) return;
	// Step 3's codes are sends 16..23; reject the very first of them.
	const fake = fakeBoard(model, { onSend: (_code, nth) => { if (nth === 16) throw new Error("board said no"); } });
	const events = await drain(planned.proc.run(fake.conn, () => model, testClock()));
	assert.deepEqual(kinds(events), ["step", "capture", "step", "capture", "step", "failed", "restored"]);
	assert.match(errorOf(events), /board said no/);
	assert.equal(fake.sent[fake.sent.length - 1], OFF, "the restore is the last thing the board hears");
});

test("a request that times out AFTER the capture was armed is not a failure — the file is the evidence", async () => {
	const r = ready({ onSend: (code, nth) => { if (nth === 7 && code.startsWith("G4")) throw new Error("timed out"); } });
	const events = await drain(r.proc.run(r.conn, () => r.model, testClock()));
	assert.deepEqual(kinds(events), ["step", "capture", "step", "capture", "done", "restored"]);
});

test("a restore that cannot be sent is reported, not swallowed", async () => {
	const r = ready({ onSend: (code) => { if (code.startsWith("M593")) throw new Error("link down"); } });
	const events = await drain(r.proc.run(r.conn, () => r.model, testClock()));
	assert.deepEqual(kinds(events), ["step", "capture", "step", "capture", "done", "failed"]);
	assert.match(errorOf(events), /restore/);
});

// --- cancellation -----------------------------------------------------------

test("abandoning the generator mid-run still sends the restore", async () => {
	const r = ready({}, { repeats: 3 });
	const gen = r.proc.run(r.conn, () => r.model, testClock());
	await gen.next(); // step 0
	await gen.next(); // capture 0
	const ending = await gen.return();
	assert.deepEqual(ending.value, { kind: "restored" });
	assert.equal(r.sent[r.sent.length - 1], OFF);
	assert.ok(r.sent.length < 8 * 6, "the remaining steps were never sent");
});

test("breaking out of a for-await loop restores the machine", async () => {
	const r = ready({}, { repeats: 3 });
	for await (const ev of r.proc.run(r.conn, () => r.model, testClock())) {
		if (ev.kind === "capture") break;
	}
	assert.equal(r.sent[r.sent.length - 1], OFF);
});

test("an aborted signal stops before the next step and restores", async () => {
	const r = ready({}, { repeats: 3 });
	const ac = new AbortController();
	const events: ProcEvent[] = [];
	for await (const ev of r.proc.run(r.conn, () => r.model, { ...testClock(), signal: ac.signal })) {
		events.push(ev);
		if (ev.kind === "capture") ac.abort();
	}
	assert.deepEqual(kinds(events), ["step", "capture", "restored"]);
	assert.deepEqual(r.sent, [...RING_CODES.slice(0, 8), OFF]);
});

// --- verify -----------------------------------------------------------------

test("a verify run applies the candidate first and hands the machine back to the prior shaper", async () => {
	const model = modelWith({ shaping: EI2_PRIOR });
	const verify: VerifyPlan = { kind: "verify", spec: EI2_SPEC, ring: ringPlan({ repeats: 1, namePrefix: "ver" }) };
	const planned = planProcedure(verify, freshPre({ shaping: EI2_PRIOR }), config(), NOW);
	assert.equal(planned.ok, true);
	if (!planned.ok) return;
	const fake = fakeBoard(model);
	const events = await drain(planned.proc.run(fake.conn, () => model, testClock()));
	assert.equal(fake.sent[0], EI2_LINE);
	assert.equal(fake.sent[fake.sent.length - 1], EI2_LINE);
	assert.deepEqual(kinds(events), ["step", "step", "capture", "step", "capture", "done", "restored"]);
});

// --- the capture never arrives ----------------------------------------------

test("a capture that never appears fails after the poll budget rather than hanging", async () => {
	const r = ready({ fileAfterPolls: 1000 });
	const clock = testClock();
	const events = await drain(r.proc.run(r.conn, () => r.model, clock));
	assert.deepEqual(kinds(events), ["step", "failed", "restored"]);
	assert.match(errorOf(events), /ring_Xp0\.csv/);
	assert.ok(clock.now() >= 10_000, "the full budget was spent before giving up");
	assert.ok(clock.now() < 11_000, "and no more than the budget");
});
