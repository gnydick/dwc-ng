/**
 * Who holds a reserved port: the registry's claims, reconciled against the
 * machine (GIT_216).
 *
 * Separate from `mockctl.ts` because that module IS the CLI — it dispatches a
 * verb at import — so anything living there can only be exercised by running
 * the command. This is the part worth testing: no processes, no registry on
 * disk, two readings in and one answer out.
 *
 * The problem it exists to solve: several pidfiles claiming one port is the
 * NORMAL state of an old machine, not a corrupt registry. A hard kill cannot
 * run the exit handler, so the file outlives the process by design, and the
 * registry is shared by every worktree. Choosing among the claimants by
 * registry order therefore names whichever worktree sorts first, which on
 * 2026-09-17 reported a running UAT stack as "process gone" and blamed a
 * worktree that had not run in weeks.
 */

import type { PidEntry, Snapshot } from "./pidfile.ts";

export type PortSlot =
	/** The listener probe could not answer, so nothing here is known. */
	| { kind: "unverifiable"; reason: string }
	/** `entry` holds the socket. `alsoClaimed` are pidfiles that name the port and do not. */
	| { kind: "listening"; entry: PidEntry; alsoClaimed: PidEntry[] }
	/** Something holds the socket and no pidfile names it. */
	| { kind: "untracked"; pids: number[] }
	/** Nothing holds the socket. `claimed` are the pidfiles left behind. */
	| { kind: "idle"; claimed: PidEntry[] };

/**
 * @invariant a-port-is-owned-by-its-listener-not-by-a-filename
 * @rung 6  choke point — this is the only place that decides which registry
 *          entry owns a port, and it cannot reach an entry except through the
 *          listener set: the `listening` arm is constructed solely from
 *          `claimants.find(e => holders.includes(e.pid))`, so an entry that is
 *          not on the socket has no route into it. A caller can still ignore
 *          the answer and read `entries` itself, which is what keeps this at 6
 *          rather than 7; promoting it means the status renderer taking a
 *          PortSlot rather than the raw entries
 * @why one process holds a listening socket, but any number of pidfiles may
 *      name that port — a hard kill leaves its file behind by design, and the
 *      registry is shared across worktrees. Selecting by registry order names
 *      whichever worktree sorts first: on 2026-09-17 `status` called a running
 *      UAT stack "process gone" and attributed it to a worktree that had not
 *      run in weeks. The reverse costs more than a wrong label — a live
 *      process named in the wrong worktree invites tearing down someone else's
 *      stack
 */
export function slotFor(entries: readonly PidEntry[], snap: Snapshot, port: number): PortSlot {
	// GIT_210: a probe that could not answer is never a verdict. Picking a
	// claimant here would be a guess wearing the clothes of a reading.
	if (!snap.listeners.ok) return { kind: "unverifiable", reason: snap.listeners.failure.reason };

	const holders = snap.listeners.data.get(port) ?? [];
	const claimants = entries.filter(e => e.port === port);
	if (holders.length === 0) return { kind: "idle", claimed: claimants };

	const entry = claimants.find(e => holders.includes(e.pid));
	if (entry === undefined) return { kind: "untracked", pids: holders };
	return { kind: "listening", entry, alsoClaimed: claimants.filter(e => e !== entry) };
}
