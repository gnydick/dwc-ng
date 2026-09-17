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
import { slotFor } from "../src/portSlot.ts";

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
