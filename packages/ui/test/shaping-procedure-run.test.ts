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

import {
	captureTiming, captureWindow, planProcedure, CAPTURE_DIR,
	type ProcEvent, type RingPlan, type VerifyPlan,
} from "../src/shaping/procedure.ts";
import type { ObjectModel } from "../src/om/types.ts";
import { hz, mm, mmPerS, mmPerS2 } from "../src/shaping/engine/units.ts";
import type { ShaperSpec } from "../src/shaping/engine/shapers.ts";
import {
	EI2_PRIOR, FAKE_CSV, NO_SHAPER, NOW, RATE, board, config, drain, errorOf, fakeBoard, freshPre, kinds,
	modelWith, ringPlan, testClock, type Fake, type FakeOptions,
} from "./helpers/shapingMachine.ts";
import { operatorTyped } from "../src/control/commands.ts";

const CSV = FAKE_CSV;
const EI2_SPEC: ShaperSpec = { type: "ei2", F: hz(52), S: 0.075 };
const OFF = 'M593 P"none"';
const EI2_LINE = 'M593 P"ei2" F52 S0.075';

/** A planned ring on a fresh machine, with the fake board wired to that model. */
function ready(fake: FakeOptions = {}, over: Partial<RingPlan> = {}): Fake & { proc: ReturnType<typeof plannedRing>; model: ObjectModel } {
	const model = modelWith();
	const proc = plannedRing(over);
	return { proc, model, ...fakeBoard(model, fake) };
}

function plannedRing(over: Partial<RingPlan> = {}) {
	const planned = planProcedure(ringPlan({ repeats: 1, ...over }), freshPre(), config(), NOW, RATE, NO_SHAPER);
	if (!planned.ok) throw new Error(`fixture refused: ${JSON.stringify(planned.refusal)}`);
	return planned.proc;
}

/**
 * The same one-repeat ring, on a machine whose own shaper is a NAMED one.
 *
 * Its restore line is then distinguishable from the `M593 P"none"` every ring
 * now leads with (#53), which is what lets a fixture reject the restore ALONE.
 * On the unshaped fixture the two are spelled identically, so "throw on any
 * M593" would kill the baseline at step 1 and never reach a restore to fail.
 */
function readyShaped(fake: FakeOptions = {}): Fake & { proc: ReturnType<typeof plannedRing>; model: ObjectModel } {
	const model = modelWith({ shaping: EI2_PRIOR });
	const planned = planProcedure(ringPlan({ repeats: 1 }), freshPre({ shaping: EI2_PRIOR }), config(), NOW, RATE, EI2_PRIOR);
	if (!planned.ok) throw new Error(`fixture refused: ${JSON.stringify(planned.refusal)}`);
	return { proc: planned.proc, model, ...fakeBoard(model, fake) };
}

// --- the happy path ---------------------------------------------------------

// S1508 and G4 P731 are DERIVED, and this is where the derivation reaches the
// wire. The fixture machine is 3000 mm/s^2 at 1375 Hz (helpers/shapingMachine),
// the pass is 60 mm at 200 mm/s, and the mode is unknown because a ring is the
// measurement that finds it — so:
//   move    = 60/200 + 200/3000                    = 0.3667 s
//   ring    = FIT_DEFAULTS.leadS + windowS         = 0.61 s   (the whole window
//                                                   the fitter can ever read)
//   capture = 0.12 lead-in + 0.3667 + 0.61         = 1.0967 s
//   S       = ceil(1.0967 * 1375)                  = 1508
//   G4      = ceil((1508/1375 - 0.3667) * 1000)    = 731 ms
// A change to any of those constants lands here as a failing wire, which is the
// point: this test is the A/B on `captureTiming` reaching the machine.
//
// One list per capture step rather than one flat sixteen, so an assertion about
// the FIRST pass names that pass instead of slicing a count off the front — a
// count the shaper statement (#53) already moved once.
const RING_XP = [
	"G90",
	"G1 X100 Y100 F12000",
	"M400",
	"G4 P500",
	'M956 P20.0 S1508 A2 F"ring_Xp0.csv"\nG1 X160 Y100 F12000',
	"M400",
	"G4 P731",
];
const RING_XM = [
	"G90",
	"G1 X160 Y100 F12000",
	"M400",
	"G4 P500",
	'M956 P20.0 S1508 A2 F"ring_Xm0.csv"\nG1 X100 Y100 F12000',
	"M400",
	"G4 P731",
];
const RING_CODES = [...RING_XP, ...RING_XM];

test("a one-repeat ring states its shaper, puts exactly the planned codes on the wire, then restores", async () => {
	const r = ready();
	const events = await drain(r.proc.run(r.conn, () => r.model, testClock()));
	// The first OFF is the baseline the ring is recorded through and the last is
	// the restore — same spelling, different jobs, and this fixture's machine
	// happened to be unshaped to begin with.
	assert.deepEqual(r.sent, [OFF, ...RING_CODES, OFF]);
	assert.deepEqual(kinds(events), ["step", "step", "capture", "step", "capture", "done", "restored"]);
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
		{ kind: "step", index: 0, label: "shaper none" },
		{ kind: "step", index: 1, label: "X+ 200 mm/s (1/1)" },
		{ kind: "step", index: 2, label: "X- 200 mm/s (1/1)" },
	]);
});

test("a capture that only appears on the second poll is still downloaded", async () => {
	const r = ready({ fileAfterPolls: 1 });
	const events = await drain(r.proc.run(r.conn, () => r.model, testClock()));
	assert.deepEqual(kinds(events), ["step", "step", "capture", "step", "capture", "done", "restored"]);
	assert.deepEqual(r.downloaded, [`${CAPTURE_DIR}/ring_Xp0.csv`, `${CAPTURE_DIR}/ring_Xm0.csv`]);
});

test("a capture overwriting a file of the same name waits for the board's run counter", async () => {
	const r = ready({ preexisting: ["ring_Xp0.csv", "ring_Xm0.csv"], fileAfterPolls: 2 });
	const events = await drain(r.proc.run(r.conn, () => r.model, testClock()));
	assert.deepEqual(kinds(events), ["step", "step", "capture", "step", "capture", "done", "restored"]);
});

// --- the file exists before its samples do ----------------------------------
//
// The failure this section exists for, from Gabe's machine on 2026-08-23: a
// sweep took the file NAME as proof, moved on while the board was still
// writing 184 KB of samples into it, and pass 2's M956 queued behind that
// write until the run died one capture in.

test("a board still writing the capture is waited for, not read", async () => {
	const r = ready({ dumpPolls: 6 });
	const events = await drain(r.proc.run(r.conn, () => r.model, testClock()));
	assert.deepEqual(kinds(events), ["step", "step", "capture", "step", "capture", "done", "restored"]);
	// The entry existed from the FIRST listing of each step. Reading it then is
	// precisely the bug, so the proof is the ordering: nothing was downloaded
	// until the dump had run its six polls and the counter had ticked.
	assert.equal(r.downloadedAfterListings.length, 2);
	assert.ok(r.downloadedAfterListings[0]! >= 7, `first read after ${r.downloadedAfterListings[0]} listings, expected the file to have settled first`);
});

test("a file that appears and is never finished fails, and is never read", async () => {
	const r = ready({ dumpPolls: 1000 });
	const events = await drain(r.proc.run(r.conn, () => r.model, testClock()));
	assert.deepEqual(kinds(events), ["step", "step", "failed", "restored"]);
	assert.match(errorOf(events), /ring_Xp0\.csv appeared in .* but was still being written/);
	assert.deepEqual(r.downloaded, [], "a half-written capture must never reach the fitter");
});

test("a stale file of the right name is refused: the run counter never ticked", async () => {
	// The name is there from the start and never changes size — last week's
	// capture — and the board never runs, so nothing dates the file to now.
	const r = ready({ preexisting: ["ring_Xp0.csv"], fileAfterPolls: 1000 });
	const events = await drain(r.proc.run(r.conn, () => r.model, testClock()));
	assert.deepEqual(kinds(events), ["step", "step", "failed", "restored"]);
	assert.match(errorOf(events), /ring_Xp0\.csv is in .* but the board never reported a finished capture/);
	assert.deepEqual(r.downloaded, [], "a file the board never claimed is not this run's capture");
});

test("a download without the board's trailer is not a finished capture", async () => {
	// The samples are there but the `Rate n, overflows n` line RRF writes LAST
	// is not, so the transfer had not finished when the bytes were fetched.
	const r = ready({ download: () => "Sample,X,Y,Z\n0,0.01,0.02,0.03\n" });
	const events = await drain(r.proc.run(r.conn, () => r.model, testClock()));
	assert.deepEqual(kinds(events), ["step", "step", "failed", "restored"]);
	assert.match(errorOf(events), /without the "Rate n, overflows n" line/);
	assert.ok(r.downloaded.length > 1, "it kept trying within the budget rather than accepting the first partial read");
});

test("a board reporting no accelerometer run counter refuses BEFORE it is moved", async () => {
	const boards = [board(0, false), board(20, true, null)];
	const model = modelWith({ boards });
	const planned = planProcedure(ringPlan({ repeats: 1 }), freshPre({ boards }), config(), NOW, RATE, NO_SHAPER);
	assert.equal(planned.ok, true);
	if (!planned.ok) return;
	const fake = fakeBoard(model);
	const events = await drain(planned.proc.run(fake.conn, () => model, testClock()));
	assert.deepEqual(kinds(events), ["step", "step", "failed", "restored"]);
	assert.match(errorOf(events), /not reporting an accelerometer run counter for P20\.0/);
	assert.deepEqual(fake.sent, [OFF, OFF], "the carriage never moved: the shaper statement, then the restore, and nothing else");
});

test("a rejected request AND no capture names both pieces of evidence", async () => {
	const r = ready({ fileAfterPolls: 1000, onSend: (code) => { if (code.startsWith("M956")) throw new Error("signal timed out"); } });
	const events = await drain(r.proc.run(r.conn, () => r.model, testClock()));
	assert.deepEqual(kinds(events), ["step", "step", "failed", "restored"]);
	assert.match(errorOf(events), /signal timed out/, "the rejected request is still named");
	assert.match(errorOf(events), /no capture named ring_Xp0\.csv appeared/, "and so is the absent file");
});

// --- the per-call deadline (GIT_69) -----------------------------------------

/**
 * The deadline every code of a recording step is sent with, derived here the
 * same way the procedure derives it — from the pass, not from a number copied
 * out of the implementation. The fixture machine is 3000 mm/s^2 and the ring
 * pass is 60 mm at 200 mm/s with the mode unknown, which is exactly what
 * `captureStep` sizes its M956 and its G4 from.
 */
const RING_TIMING = captureTiming(captureWindow(mm(60), mmPerS(200), mmPerS2(3000), null), RATE);

test("every code of a recording step carries the deadline that recording produced", async () => {
	const r = ready();
	await drain(r.proc.run(r.conn, () => r.model, testClock()));
	// The shaper statement first, then seven codes per capture step — the arm
	// and its move are ONE of them (#43) — then the restore. The two single
	// M593s record nothing and are therefore back on the transport's flat
	// budget; only the recording steps carry a deadline.
	assert.deepEqual(r.deadlines, [
		undefined,
		...new Array<number | undefined>(7).fill(RING_TIMING.sendBudgetMs),
		...new Array<number | undefined>(7).fill(RING_TIMING.sendBudgetMs),
		undefined,
	]);
	// The A/B against the bug: it is bigger than the flat budget that aborted
	// the sweep, and bigger than the whole of the step's excitation work.
	assert.ok(RING_TIMING.sendBudgetMs > 5000, `${RING_TIMING.sendBudgetMs} ms is not past the flat default`);
	assert.ok(
		RING_TIMING.sendBudgetMs > RING_TIMING.dwellMs + RING_TIMING.moveS * 1000,
		"the deadline must cover the move AND the dwell it is queued behind",
	);
});

test("a verify plan's shaper step records nothing, so it keeps the flat budget", async () => {
	const model = modelWith({ shaping: EI2_PRIOR });
	const verify: VerifyPlan = { kind: "verify", spec: EI2_SPEC, ring: ringPlan({ repeats: 1, namePrefix: "ver" }) };
	const planned = planProcedure(verify, freshPre({ shaping: EI2_PRIOR }), config(), NOW, RATE, EI2_PRIOR);
	assert.equal(planned.ok, true);
	if (!planned.ok) return;
	const fake = fakeBoard(model);
	await drain(planned.proc.run(fake.conn, () => model, testClock()));
	// A verify ring knows the mode under test, so its recording — and with it
	// its deadline — is sized differently from a blind ring. Derived here the
	// same way, which is the point: one arithmetic, two callers.
	const verifyTiming = captureTiming(
		captureWindow(mm(60), mmPerS(200), mmPerS2(3000), { f: EI2_SPEC.F, zeta: EI2_SPEC.S }), RATE,
	);
	assert.equal(fake.sent[0], EI2_LINE, "precondition: the shaper step is first");
	assert.equal(fake.deadlines[0], undefined, "one M593 is not a recording and does not get a recording's budget");
	assert.equal(fake.deadlines[1], verifyTiming.sendBudgetMs, "the capture step that follows does");
});

test("a step's failure names the code that was refused, not just the transport error", async () => {
	// The second defect in the ticket. A capture step is seven codes; "POST
	// timed out" is true of all of them and identifies none, which is what
	// made the real fault take three rounds to place. The file must be kept
	// away too, because a rejection with a capture behind it is deliberately
	// NOT a failure — the machine's evidence decides.
	const r = ready({
		// Attempt 0 is the shaper statement, so the first pass's seven codes are
		// attempts 1..7 and its closing G4 is the seventh. The `startsWith` guard
		// is what stops a renumbering from quietly disarming this test.
		fileAfterPolls: 1000,
		onSend: (code, nth) => { if (nth === 7 && code.startsWith("G4")) throw new Error("signal timed out"); },
	});
	const events = await drain(r.proc.run(r.conn, () => r.model, testClock()));
	assert.match(errorOf(events), /^step 2 of 3 \(X\+ 200 mm\/s \(1\/1\)\): G4 P731: signal timed out — /);
});

test("a failed restore names its code too", async () => {
	const r = readyShaped({ onSend: (code) => { if (code === EI2_LINE) throw new Error("link down"); } });
	const events = await drain(r.proc.run(r.conn, () => r.model, testClock()));
	assert.equal(errorOf(events), `restore failed: ${EI2_LINE}: link down`);
});

// --- refusing rather than correcting ----------------------------------------

test("a position mismatch before the second capture step fails the run WITHOUT sending that step's codes", async () => {
	const r = ready({ driftOnMove: 10 });
	const events = await drain(r.proc.run(r.conn, () => r.model, testClock()));
	assert.deepEqual(r.sent, [OFF, ...RING_XP, OFF], "the X- pass never went out, and nothing tried to fix the position");
	assert.deepEqual(kinds(events), ["step", "step", "capture", "failed", "restored"]);
	assert.match(errorOf(events), /X170\.00 Y100\.00/);
	assert.match(errorOf(events), /X160\.00 Y100\.00/);
});

test("a mismatch on the very first step still restores, and sends nothing else", async () => {
	const model = modelWith({ shaping: EI2_PRIOR });
	const proc = (() => {
		const planned = planProcedure(ringPlan({ repeats: 1 }), freshPre({ shaping: EI2_PRIOR }), config(), NOW, RATE, EI2_PRIOR);
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

test("a send that throws on the third capture step still gets the restore out", async () => {
	const model = modelWith();
	const planned = planProcedure(ringPlan({ repeats: 2 }), freshPre(), config(), NOW, RATE, NO_SHAPER);
	assert.equal(planned.ok, true);
	if (!planned.ok) return;
	// The shaper statement is attempt 0, so the third capture step's codes are
	// sends 15..21; reject the very first of them.
	const fake = fakeBoard(model, { onSend: (code, nth) => {
		if (nth === 15) {
			assert.equal(code, "G90", "fixture: attempt 15 is the third capture step's first code");
			throw new Error("board said no");
		}
	} });
	const events = await drain(planned.proc.run(fake.conn, () => model, testClock()));
	assert.deepEqual(kinds(events), ["step", "step", "capture", "step", "capture", "step", "failed", "restored"]);
	assert.match(errorOf(events), /board said no/);
	assert.equal(fake.sent[fake.sent.length - 1], OFF, "the restore is the last thing the board hears");
});

test("a request that times out AFTER the capture was armed is not a failure — the file is the evidence", async () => {
	// Attempt 7 is the first pass's closing G4 — the shaper statement took 0,
	// and a capture step is seven codes since the arm was fused to its move.
	const r = ready({ onSend: (code, nth) => {
		if (nth !== 7) return;
		assert.ok(code.startsWith("G4"), `fixture: attempt 7 should be the closing G4, was ${code}`);
		throw new Error("timed out");
	} });
	const events = await drain(r.proc.run(r.conn, () => r.model, testClock()));
	assert.deepEqual(kinds(events), ["step", "step", "capture", "step", "capture", "done", "restored"]);
});

test("a restore that cannot be sent is reported, not swallowed", async () => {
	// Every step succeeds and only the putting-back fails, which is the case
	// worth reporting: the run got what it came for and left the machine in the
	// lab's disable rather than in the operator's own shaper.
	const r = readyShaped({ onSend: (code) => { if (code === EI2_LINE) throw new Error("link down"); } });
	const events = await drain(r.proc.run(r.conn, () => r.model, testClock()));
	assert.deepEqual(kinds(events), ["step", "step", "capture", "step", "capture", "done", "failed"]);
	assert.match(errorOf(events), /restore/);
});

// --- cancellation -----------------------------------------------------------

test("abandoning the generator mid-run still sends the restore", async () => {
	const r = ready({}, { repeats: 3 });
	const gen = r.proc.run(r.conn, () => r.model, testClock());
	await gen.next(); // step 1: the shaper this run measures through
	await gen.next(); // step 2: the first capture pass
	await gen.next(); // and its capture — the run is genuinely mid-flight now
	const ending = await gen.return();
	assert.deepEqual(ending.value, { kind: "restored" });
	assert.equal(r.sent[r.sent.length - 1], OFF);
	assert.ok(r.sent.length < 7 * 6, "the remaining steps were never sent");
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
	assert.deepEqual(kinds(events), ["step", "step", "capture", "restored"]);
	assert.deepEqual(r.sent, [OFF, ...RING_XP, OFF]);
});

// --- verify -----------------------------------------------------------------

test("a verify run applies the candidate first and hands the machine back to the prior shaper", async () => {
	const model = modelWith({ shaping: EI2_PRIOR });
	const verify: VerifyPlan = { kind: "verify", spec: EI2_SPEC, ring: ringPlan({ repeats: 1, namePrefix: "ver" }) };
	const planned = planProcedure(verify, freshPre({ shaping: EI2_PRIOR }), config(), NOW, RATE, EI2_PRIOR);
	assert.equal(planned.ok, true);
	if (!planned.ok) return;
	const fake = fakeBoard(model);
	const events = await drain(planned.proc.run(fake.conn, () => model, testClock()));
	assert.equal(fake.sent[0], EI2_LINE);
	assert.equal(fake.sent[fake.sent.length - 1], EI2_LINE);
	assert.deepEqual(kinds(events), ["step", "step", "capture", "step", "capture", "done", "restored"]);
});

// --- the accelerometer is never left armed (#43) -----------------------------
//
// M956 with A1 or A2 does not record; it ARMS, and the recording starts when
// the next move does (reference/duet-gcode.md, M956). RRF documents no way to
// cancel one — the command's parameters are P, S, X/Y/Z, A and F and there is
// no disarm among them — so an arm that loses its move is not something a
// `finally` can put right. It waits on the board, and the next move ANYONE
// makes, jog or homing macro or the start of a print, is written into the
// abandoned pass's file.
//
// So the fix is not a cleanup, it is the absence of a gap: the arm and the move
// that consumes it are one command and therefore one request. These two tests
// are the two halves of that claim — what the wire carries, and what a refusal
// at the worst possible moment leaves behind.

test("the fake board really does hold an arm until a move consumes it", async () => {
	// Otherwise the test below measures nothing: a board that recorded on the
	// arm alone would report `armed() === false` however badly the run failed.
	const r = ready();
	await r.conn.sendCode(operatorTyped('M956 P20.0 S10 A2 F"stray.csv"'));
	assert.equal(r.armed(), true, "an M956 on its own leaves a capture pending");
	await r.conn.sendCode(operatorTyped("G1 X100 Y100 F6000"));
	assert.equal(r.armed(), false, "and the next move is what consumes it");
});

test("no arm reaches the board without the move that consumes it", async () => {
	const r = ready();
	await drain(r.proc.run(r.conn, () => r.model, testClock()));
	const arms = r.sent.filter((code) => code.includes("M956"));
	assert.equal(arms.length, 2, "one arm per capture pass");
	for (const arm of arms) {
		assert.match(arm, /^M956 [^\n]*\nG1 X-?[\d.]+ Y-?[\d.]+ F/, "the arm went out with no move behind it");
	}
});

test("a refusal immediately after the arm leaves nothing pending on the board", async () => {
	// The ticket's failure, written as a gesture rather than as an index:
	// whatever the transport is asked to send NEXT after the code that armed the
	// capture is refused. While the arm was a code of its own, that next code
	// WAS the excitation move, so the run ended with the board holding a capture
	// no move would ever trigger. Fused, the refusal lands on the M400 behind
	// them, the move has already gone, and the pass still produces its file.
	let armedAt: number | null = null;
	const r = ready({
		onSend: (code, nth) => {
			if (armedAt !== null && nth === armedAt + 1) throw new Error("link down");
			if (code.includes("M956")) armedAt = nth;
		},
	});
	const events = await drain(r.proc.run(r.conn, () => r.model, testClock()));
	assert.equal(r.armed(), false, "the run ended with a capture still armed on the board");
	// And the refusal is still not a failure by itself: the file is the evidence.
	assert.deepEqual(kinds(events), ["step", "step", "capture", "step", "capture", "done", "restored"]);
});

// --- the capture never arrives ----------------------------------------------

test("a capture that never appears fails after the poll budget rather than hanging", async () => {
	const r = ready({ fileAfterPolls: 1000 });
	const clock = testClock();
	const events = await drain(r.proc.run(r.conn, () => r.model, clock));
	assert.deepEqual(kinds(events), ["step", "step", "failed", "restored"]);
	assert.match(errorOf(events), /ring_Xp0\.csv/);
	// The budget is DERIVED from this capture's own recording, not a constant:
	// 10 s of fixed overhead plus twice the 1.097 s record = 12.194 s.
	assert.ok(clock.now() >= 12_194, "the full budget was spent before giving up");
	assert.ok(clock.now() < 12_500, "and no more than the budget");
	assert.match(errorOf(events), /within 12\.2 s/, "the sentence states the budget it actually waited");
});
