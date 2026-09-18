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
	/**
	 * `entry` holds the socket.
	 *
	 * The other pidfiles naming this port are split by what is TRUE of them, not
	 * by which one was chosen: `alsoHolding` are on the socket as well (the same
	 * live PID registered from a second worktree), `alsoClaimed` are not. Calling
	 * the first group "not holding it" is a sentence that contradicts itself
	 * (GIT_218).
	 */
	| { kind: "listening"; entry: PidEntry; alsoHolding: PidEntry[]; alsoClaimed: PidEntry[] }
	/** Something holds the socket; `claimed` are pidfiles naming the port that do not. */
	| { kind: "untracked"; pids: number[]; claimed: PidEntry[] }
	/** Nothing holds the socket. `claimed` are the pidfiles left behind. */
	| { kind: "idle"; claimed: PidEntry[] };

/** What the caller knows about an entry that this module cannot work out. */
export interface EntryShown {
	/** The entry's classification, e.g. "running" or "stale pidfile (process gone)". */
	status: string;
	/** Where its worktree is, or whatever the caller wants shown in its place. */
	worktree: string;
}

/**
 * @invariant a-port-is-owned-by-its-listener-not-by-a-filename
 * @rung 6  choke point — this is the only place that decides which registry
 *          entry owns a port, and it cannot reach an entry except through the
 *          listener set: the `listening` arm is constructed solely from
 *          `claimants.find(e => holders.includes(e.pid))`, so an entry that is
 *          not on the socket has no route into it. The promotion this row used
 *          to name — the status renderer taking a PortSlot rather than the raw
 *          entries — LANDED in GIT_218 and is declared separately on
 *          {@link slotLines} at rung 7. This stays at 6 because `cmdStatus`
 *          still holds `entries` in scope for the tracked-mocks table, so a
 *          future line could select from them without coming through here; it
 *          reaches 7 when nothing in that function can name an entry except
 *          through a slot
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
	if (entry === undefined) return { kind: "untracked", pids: holders, claimed: claimants };

	const others = claimants.filter(e => e !== entry);
	return {
		kind: "listening",
		entry,
		alsoHolding: others.filter(e => holders.includes(e.pid)),
		alsoClaimed: others.filter(e => !holders.includes(e.pid)),
	};
}

/** Continuation lines sit under the head line, not beside it. */
const INDENT = " ".repeat(13);
const under = (label: string, entry: PidEntry, shown: EntryShown): string =>
	`${INDENT}${label} — pid ${entry.pid}, worktree ${entry.segment}: ${shown.status}`;

/**
 * @invariant the-uat-line-is-rendered-from-a-slot-never-from-the-entries
 * @rung 7  sole input — this function takes a `PortSlot` and a lookup, and
 *          `PidEntry[]` is not among its parameters, so the lines for this port
 *          CANNOT be produced from the registry directly: a caller that wanted
 *          to name a claimant its own way has nothing here to call. Every entry
 *          reaching the output arrives through the arm `slotFor` put it in, and
 *          each arm is exhaustive over its own lists — a claimant cannot be
 *          silently dropped the way `untracked` dropped its own before GIT_218,
 *          because there is no arm without a list. This is the promotion the
 *          rung-6 declaration on `slotFor` named
 * @why the line answers "is the UAT stack up?", and both of its failure modes
 *      cost real work: naming a dead worktree sends someone to restart a stack
 *      that is already serving, and naming a live process in the WRONG worktree
 *      invites tearing down someone else's. Rendering from the raw entries is
 *      how the first one happened (GIT_216); dropping a list is how the second
 *      stayed invisible (GIT_218)
 */
export function slotLines(port: number, slot: PortSlot, shown: (entry: PidEntry) => EntryShown): string[] {
	switch (slot.kind) {
		case "unverifiable":
			// Naming a claimant here would be a guess wearing a reading's clothes.
			return [`  mock ${port} : unknown — ${slot.reason}`];
		case "listening": {
			const head = shown(slot.entry);
			return [
				`  mock ${port} : ${head.status} — pid ${slot.entry.pid}, worktree ${slot.entry.segment} (${head.worktree})`,
				...slot.alsoHolding.map(e => under("the same live pid is registered here too", e, shown(e))),
				...slot.alsoClaimed.map(e => under("also claimed, not holding it", e, shown(e))),
			];
		}
		case "untracked":
			return [
				`  mock ${port} : LISTENING but untracked — pid ${slot.pids.join(", ")}`,
				...slot.claimed.map(e => under("claimed by a pidfile that does not hold it", e, shown(e))),
			];
		case "idle":
			return [
				`  mock ${port} : not running`,
				...slot.claimed.map(e => under("claimed by a pidfile", e, shown(e))),
			];
	}
}
