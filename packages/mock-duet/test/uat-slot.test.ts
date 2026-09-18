/**
 * Which pidfile owns the UAT port (GIT_216).
 *
 * The registry is shared across every worktree and a hard kill leaves its
 * pidfile behind by design, so several pidfiles claiming one port is the normal
 * state of an old machine, not a corrupt registry. Picking among them by
 * REGISTRY ORDER is what made `status` report a running UAT stack as "process
 * gone" on 2026-09-17, naming a worktree that had not run in weeks.
 *
 * Only one process can hold a listening socket, and the snapshot already knows
 * which. These drive that selection directly: no processes, no registry on
 * disk, just the two readings and the answer.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { failedProbe, okProbe, type PidEntry, type ProcInfo, type Snapshot } from "../src/pidfile.ts";
import { type PortSlot, slotFor, slotLines } from "../src/portSlot.ts";

const PORT = 8970;

/** A pidfile claiming {@link PORT}, in `<segment>` for `<pid>`. */
function claim(segment: string, pid: number): PidEntry {
	return { segment, pid, port: PORT, file: `/registry/${segment}/${pid}`, mtimeMs: Date.now() - 60_000 };
}

function proc(pid: number): ProcInfo {
	return {
		pid,
		executable: "node.exe",
		commandLine: "node --title=mock-duet packages/mock-duet/src/cli.ts",
		startedAtMs: Date.now() - 120_000,
	};
}

/** A machine where exactly `listeningPid` holds {@link PORT}. */
function machineWith(listeningPid: number | null, pids: number[]): Snapshot {
	return {
		procs: okProbe(new Map(pids.map(p => [p, proc(p)]))),
		listeners: okProbe(listeningPid === null ? new Map() : new Map([[PORT, [listeningPid]]])),
	};
}

describe("the UAT slot names the process that holds the port", () => {
	// The 2026-09-17 case, exactly: `wt-GIT_194` sorts first and is long dead;
	// `wt-pidfile-probe-verdict` sorts later and is the one actually serving.
	test("a stale pidfile that sorts FIRST does not win over the live one", () => {
		const stale = claim("wt-GIT_194", 30092);
		const live = claim("wt-pidfile-probe-verdict", 59520);
		const slot = slotFor([stale, live], machineWith(59520, [59520]), PORT);

		assert.equal(slot.kind, "listening");
		assert.equal(slot.kind === "listening" ? slot.entry.pid : null, 59520);
		assert.equal(slot.kind === "listening" ? slot.entry.segment : null, "wt-pidfile-probe-verdict");
	});

	// The direction that did NOT happen, and is worse: the line would name a
	// live process in the WRONG worktree, and the next person tears down a
	// stack they do not own.
	test("a live pidfile that sorts first does not win over the one actually listening", () => {
		const otherLive = claim("wt-AAA-first", 111);
		const live = claim("wt-zzz-last", 222);
		const slot = slotFor([otherLive, live], machineWith(222, [111, 222]), PORT);

		assert.equal(slot.kind === "listening" ? slot.entry.pid : null, 222);
		assert.equal(slot.kind === "listening" ? slot.entry.segment : null, "wt-zzz-last");
	});

	test("the pidfiles that do NOT hold the port are still reported, because that is a registry problem", () => {
		const stale = claim("wt-GIT_194", 30092);
		const live = claim("wt-now", 59520);
		const slot = slotFor([stale, live], machineWith(59520, [59520]), PORT);
		assert.deepEqual(slot.kind === "listening" ? slot.alsoClaimed.map(e => e.pid) : null, [30092]);
	});

	test("one entry, listening: the ordinary case still reads as before", () => {
		const live = claim("wt-only", 4242);
		const slot = slotFor([live], machineWith(4242, [4242]), PORT);
		assert.equal(slot.kind === "listening" ? slot.entry.pid : null, 4242);
		assert.deepEqual(slot.kind === "listening" ? slot.alsoClaimed : null, []);
	});

	test("pidfiles claim the port but nothing holds it: idle, and every claimant named", () => {
		const a = claim("wt-a", 1);
		const b = claim("wt-b", 2);
		const slot = slotFor([a, b], machineWith(null, []), PORT);
		assert.equal(slot.kind, "idle");
		assert.deepEqual(slot.kind === "idle" ? slot.claimed.map(e => e.pid) : null, [1, 2]);
	});

	test("nothing claims it and nothing holds it: idle, with no claimants", () => {
		const slot = slotFor([], machineWith(null, []), PORT);
		assert.equal(slot.kind, "idle");
		assert.deepEqual(slot.kind === "idle" ? slot.claimed : null, []);
	});

	test("something holds it that no pidfile names: untracked, with the PID", () => {
		const slot = slotFor([], machineWith(777, [777]), PORT);
		assert.equal(slot.kind, "untracked");
		assert.deepEqual(slot.kind === "untracked" ? slot.pids : null, [777]);
	});

	test("an entry exists but ANOTHER process holds the port: untracked, never the entry", () => {
		// The pidfile names 5, but 6 is on the socket. Naming 5 here would be
		// the same lie in a different shape.
		const slot = slotFor([claim("wt-a", 5)], machineWith(6, [5, 6]), PORT);
		assert.equal(slot.kind, "untracked");
		assert.deepEqual(slot.kind === "untracked" ? slot.pids : null, [6]);
	});

	// GIT_210's rule: a probe that could not answer is never a verdict.
	test("when the listener probe FAILED, the slot picks nobody and says why", () => {
		const stale = claim("wt-GIT_194", 30092);
		const live = claim("wt-now", 59520);
		const slot = slotFor([stale, live], {
			procs: okProbe(new Map([[59520, proc(59520)]])),
			listeners: failedProbe("reading listening sockets with `powershell.exe` failed: the RPC server is unavailable"),
		}, PORT);

		assert.equal(slot.kind, "unverifiable");
		assert.match(slot.kind === "unverifiable" ? slot.reason : "", /RPC server is unavailable/);
	});
});


// ---------------------------------------------------------------------------
// GIT_218: the lines the operator reads
// ---------------------------------------------------------------------------

/**
 * The two display lookups the renderer needs, stubbed.
 *
 * `classify` needs a machine snapshot and `describeSegment` needs a resolved
 * registry; neither is what these check. What IS checked is which entries reach
 * the output and how each is labelled — the part that was wrong.
 */
const shown = {
	status: (e: PidEntry) => `status(${e.pid})`,
	where: (e: PidEntry) => `/path/${e.segment}`,
	named: (pid: number) => `cmdline(${pid})`,
};

describe("the rendered lines name every entry, and label each one truthfully", () => {
	test("untracked: the pidfiles claiming the port are NOT dropped", () => {
		// The arm's whole failure mode: a different pid holds the port, and the
		// claimants vanished from the output entirely.
		const slot = slotFor([claim("wt-a", 5), claim("wt-b", 7)], machineWith(6, [5, 6, 7]), PORT);
		const lines = slotLines(PORT, slot, shown).join("\n");

		assert.match(lines, /LISTENING but untracked/);
		// The holder moved off the head line onto its own named line in GIT_222's
		// follow-up, so that a stranger reads the same in both arms. It is still
		// reported, which is what this test is for.
		assert.match(lines, /holding this port — pid 6/);
		assert.match(lines, /pid 5/, "the pidfile claiming the port must still be named");
		assert.match(lines, /pid 7/, "and so must the second one");
	});

	test("listening: a claimant that IS on the socket is never called not-holding", () => {
		// Same pid registered from two worktrees: both are on the socket, so
		// "also claimed, not holding it" would contradict itself.
		const here = claim("wt-aaa", 77);
		const there = claim("wt-zzz", 77);
		const lines = slotLines(PORT, slotFor([here, there], machineWith(77, [77]), PORT), shown).join("\n");

		assert.doesNotMatch(lines, /not holding it — pid 77/);
		assert.match(lines, /also holding this port — pid 77/, "it says what is actually true of the other entry");
	});

	// The reading `machineWith` cannot build: more than one PID against one port.
	// Its absence is why the label below was wrong and no test saw it — the
	// predicate is membership in the holder set, NOT sameness of PID.
	test("listening: a second holder with a DIFFERENT pid is not called the same pid", () => {
		const mine = claim("wt-a", 77);
		const other = claim("wt-b", 999);
		const twoHolders: Snapshot = {
			procs: okProbe(new Map([[77, proc(77)], [999, proc(999)]])),
			listeners: okProbe(new Map([[PORT, [77, 999]]])),
		};
		const lines = slotLines(PORT, slotFor([mine, other], twoHolders, PORT), shown).join("\n");

		assert.match(lines, /also holding this port — pid 999/);
		assert.doesNotMatch(lines, /same live pid/, "the old label said this, and 999 is not 77");
		assert.doesNotMatch(lines, /not holding it — pid 999/, "it IS holding it");
	});

	test("listening: a claimant that is NOT on the socket still reads as not holding it", () => {
		const live = claim("wt-live", 77);
		const stale = claim("wt-stale", 30092);
		const lines = slotLines(PORT, slotFor([live, stale], machineWith(77, [77]), PORT), shown).join("\n");

		assert.match(lines, /not holding it — pid 30092/);
		assert.doesNotMatch(lines, /also holding this port/);
	});

	test("the first line always names the port, in every arm", () => {
		const arms: PortSlot[] = [
			{ kind: "unverifiable", reason: "the RPC server is unavailable" },
			slotFor([claim("wt-a", 9)], machineWith(9, [9]), PORT),
			slotFor([], machineWith(3, [3]), PORT),
			slotFor([], machineWith(null, []), PORT),
		];
		for (const slot of arms) {
			const first = slotLines(PORT, slot, shown)[0] ?? "";
			assert.match(first, new RegExp(`mock ${PORT} `), `${slot.kind} must name the port`);
		}
	});

	test("unverifiable: the probe's reason is printed, on one line and no more", () => {
		const lines = slotLines(PORT, { kind: "unverifiable", reason: "the RPC server is unavailable" }, shown);
		assert.match(lines[0] ?? "", /unknown — the RPC server is unavailable/);
		assert.equal(lines.length, 1, "a reading that failed has nothing to list under it");
	});

	test("idle: not running, and every left-behind pidfile is listed", () => {
		const slot = slotFor([claim("wt-a", 1), claim("wt-b", 2)], machineWith(null, []), PORT);
		const lines = slotLines(PORT, slot, shown);
		assert.match(lines[0] ?? "", /not running/);
		assert.equal(lines.length, 3, "the head line plus one per claimant");
	});

	test("the entry's status and worktree come from the caller, not invented here", () => {
		const slot = slotFor([claim("wt-only", 4242)], machineWith(4242, [4242]), PORT);
		const lines = slotLines(PORT, slot, shown).join("\n");
		assert.match(lines, /status\(4242\)/);
		assert.match(lines, /\/path\/wt-only/);
	});
});


// ---------------------------------------------------------------------------
// GIT_220: a holder nobody registered
// ---------------------------------------------------------------------------

describe("every process holding the port is reported, registered or not", () => {
	// Measured 2026-09-17 on Windows 11: two separate processes DO hold one
	// port — one bound 0.0.0.0, one bound 127.0.0.1, both reported by
	// Get-NetTCPConnection with distinct owning pids. So this is a state the
	// machine reaches, not a hypothetical.
	const twoHolders = (pids: number[]): Snapshot => ({
		procs: okProbe(new Map(pids.map(pid => [pid, {
			pid,
			executable: "node.exe",
			commandLine: `node holder-${pid}`,
			startedAtMs: Date.now() - 1000,
		}]))),
		listeners: okProbe(new Map([[PORT, pids]])),
	});

	test("a holder with no pidfile is carried on the listening slot", () => {
		const mine = claim("wt-a", 77);
		const slot = slotFor([mine], twoHolders([77, 999]), PORT);
		assert.equal(slot.kind, "listening");
		assert.deepEqual(slot.kind === "listening" ? slot.unclaimedHolders : null, [999]);
	});

	test("and it reaches the lines — this is the one that was silent", () => {
		const slot = slotFor([claim("wt-a", 77)], twoHolders([77, 999]), PORT);
		const lines = slotLines(PORT, slot, shown).join("\n");
		assert.match(lines, /pid 999/, "a live process on the reserved port must be named");
	});

	test("the registered holder is still the head line, not demoted", () => {
		const slot = slotFor([claim("wt-a", 77)], twoHolders([77, 999]), PORT);
		const lines = slotLines(PORT, slot, shown);
		assert.match(lines[0] ?? "", /pid 77, worktree wt-a/);
	});

	test("a holder whose pidfile names ANOTHER port is not said to have none", () => {
		// `claimants` filters on `e.port === port`, so a pidfile for 8971, or one
		// whose body will not parse, leaves its PID outside the claimed set. The
		// PID is still an unclaimed holder of THIS port — but saying "no pidfile"
		// about it would be false, and the operator would go looking for a file
		// that is sitting right there.
		const elsewhere: PidEntry = { segment: "wt-b", pid: 999, port: 8971, file: "/registry/wt-b/999", mtimeMs: Date.now() };
		const slot = slotFor([claim("wt-a", 77), elsewhere], twoHolders([77, 999]), PORT);
		const lines = slotLines(PORT, slot, shown).join("\n");

		assert.deepEqual(slot.kind === "listening" ? slot.unclaimedHolders : null, [999]);
		assert.match(lines, /no pidfile claims it — pid 999/);
		assert.doesNotMatch(lines, /with NO pidfile/, "the old wording asserted a file does not exist");
	});

	test("one holder, one pidfile: nothing extra is invented", () => {
		// The positive control. Without it, listing a phantom holder in the
		// ordinary case would satisfy the assertions above.
		const slot = slotFor([claim("wt-a", 77)], twoHolders([77]), PORT);
		assert.deepEqual(slot.kind === "listening" ? slot.unclaimedHolders : null, []);
		assert.equal(slotLines(PORT, slot, shown).length, 1, "head line only");
	});

	test("a continuation line never costs a worktree lookup", () => {
		// `where` runs readFileSync in the real caller. Four stale claims on this
		// machine meant four reads per `status`, every one discarded.
		let wheres = 0;
		const counted = {
			...shown,
			where: (e: PidEntry) => { wheres += 1; return `/path/${e.segment}`; },
		};
		const slot = slotFor([claim("wt-a", 77), claim("wt-b", 30092), claim("wt-c", 30093)], twoHolders([77]), PORT);
		slotLines(PORT, slot, counted);
		assert.equal(wheres, 1, "only the head entry has a worktree shown");
	});
});


// ---------------------------------------------------------------------------
// GIT_222: the stranger is named, from the reading already taken
// ---------------------------------------------------------------------------

describe("a holder with no pidfile is named, not just numbered", () => {
	const twoHolders = (pids: number[]): Snapshot => ({
		procs: okProbe(new Map(pids.map(pid => [pid, {
			pid,
			executable: "node.exe",
			commandLine: `node holder-${pid}`,
			startedAtMs: Date.now() - 1000,
		}]))),
		listeners: okProbe(new Map([[PORT, pids]])),
	});

	test("a stranger ALONE on the port is named too — the untracked arm", () => {
		// Reached whenever holders exist and no pidfile claims this port: a
		// squatter with no mock running, which is at least as common as the
		// two-holder case. Before GIT_222 this arm printed a bare PID.
		const slot = slotFor([], twoHolders([999]), PORT);
		assert.equal(slot.kind, "untracked");
		const lines = slotLines(PORT, slot, shown).join("\n");
		assert.match(lines, /cmdline\(999\)/);
	});

	test("an untracked holder the caller cannot name keeps its pid and gains no colon", () => {
		const nameless = { ...shown, named: () => null };
		const lines = slotLines(PORT, slotFor([], twoHolders([999]), PORT), nameless).join("\n");
		assert.match(lines, /pid 999/);
		assert.doesNotMatch(lines, /pid 999:/);
	});

	test("the line says WHAT is on the reserved port, not only that something is", () => {
		const slot = slotFor([claim("wt-a", 77)], twoHolders([77, 999]), PORT);
		const lines = slotLines(PORT, slot, shown).join("\n");
		assert.match(lines, /pid 999: cmdline\(999\)/);
	});

	test("a name the caller cannot supply is absent, never invented", () => {
		// The process probe can fail while the listener probe succeeds: the PID
		// is known and the name is not. portSlot must not fill that in with
		// "unknown" — it would be this module asserting something it never read.
		const nameless = { ...shown, named: () => null };
		const slot = slotFor([claim("wt-a", 77)], twoHolders([77, 999]), PORT);
		const lines = slotLines(PORT, slot, nameless).join("\n");

		assert.match(lines, /no pidfile claims it — pid 999$/m, "the pid still gets its line");
		assert.doesNotMatch(lines, /unknown/i);
		assert.doesNotMatch(lines, /pid 999:/, "no empty colon where a name would go");
	});

	test("control: a CLAIMED holder's line is unchanged — it reads from its entry", () => {
		// Without this, naming every line would satisfy the first test for the
		// wrong reason. A claimed holder has an entry, so it keeps status and
		// worktree and never gets a by-pid name.
		const slot = slotFor([claim("wt-a", 77), claim("wt-b", 999)], twoHolders([77, 999]), PORT);
		const lines = slotLines(PORT, slot, shown).join("\n");

		assert.match(lines, /also holding this port — pid 999, worktree wt-b: status\(999\)/);
		assert.doesNotMatch(lines, /cmdline\(999\)/, "a claimed holder is described by its entry");
	});

	test("the name is asked for ONCE per unnamed holder, and never for a claimed one", () => {
		let asked: number[] = [];
		const counted = { ...shown, named: (pid: number) => { asked.push(pid); return `cmdline(${pid})`; } };
		const slot = slotFor([claim("wt-a", 77)], twoHolders([77, 999, 1000]), PORT);
		slotLines(PORT, slot, counted);
		assert.deepEqual(asked, [999, 1000]);
	});
});
