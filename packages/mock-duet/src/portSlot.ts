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
	 * by which one was chosen: `alsoHolding` are in the holder set too,
	 * `alsoClaimed` are not. Calling the first group "not holding it" is a
	 * sentence that contradicts itself (GIT_218).
	 *
	 * `alsoHolding` does NOT mean "the same PID as `entry`". The usual way in is
	 * one PID registered from two worktrees, but the predicate is membership in
	 * the holder set, so with two holders it is a different PID — which is why
	 * the line says "also holding this port" and not "the same pid".
	 */
	| {
			kind: "listening";
			entry: PidEntry;
			alsoHolding: PidEntry[];
			alsoClaimed: PidEntry[];
			/**
			 * PIDs on the socket that NO pidfile names. Measured 2026-09-17 on
			 * Windows 11: two processes do hold one port (one bound 0.0.0.0, one
			 * 127.0.0.1, distinct owners, both reported). Before GIT_220 such a
			 * process was named in the `untracked` arm and silently dropped here.
			 */
			unclaimedHolders: number[];
	  }
	/** Something holds the socket; `claimed` are pidfiles naming the port that do not. */
	| { kind: "untracked"; pids: number[]; claimed: PidEntry[] }
	/** Nothing holds the socket. `claimed` are the pidfiles left behind. */
	| { kind: "idle"; claimed: PidEntry[] };

/**
 * What the caller knows about an entry that this module cannot work out.
 *
 * Two lookups rather than one record, because they do not cost the same: the
 * real `where` reads a file off disk per entry, and only the head line shows
 * it. Asking for both together meant a read per claimant, discarded (GIT_220).
 */
export interface EntryLookup {
	/** The entry's classification, e.g. "running" or "stale pidfile (process gone)". */
	status: (entry: PidEntry) => string;
	/** Where its worktree is, or whatever the caller wants shown in its place. */
	where: (entry: PidEntry) => string;
}

/**
 * @invariant a-port-is-owned-by-its-listener-not-by-a-filename
 * @rung 6  choke point — this is the only place that decides which registry
 *          entry owns a port, and it cannot reach an entry except through the
 *          listener set: the `listening` arm is constructed solely from
 *          `claimants.find(e => holders.includes(e.pid))`, so an entry that is
 *          not on the socket has no route into it. The step this row used to
 *          call its promotion — the status renderer taking a PortSlot rather
 *          than the raw entries — landed in GIT_218 and is declared on
 *          {@link slotLines}, but it did NOT promote either row: the renderer
 *          not taking entries says nothing about what `cmdStatus` can print
 *          beside it. Both stay at 6 for the same reason — `cmdStatus` holds
 *          `entries`, `snap` and `console.log` in scope — and both reach 7 only
 *          when nothing in that function can name an entry except through a
 *          slot
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
	const claimed = new Set(claimants.map(e => e.pid));
	return {
		kind: "listening",
		entry,
		alsoHolding: others.filter(e => holders.includes(e.pid)),
		alsoClaimed: others.filter(e => !holders.includes(e.pid)),
		unclaimedHolders: holders.filter(pid => !claimed.has(pid)),
	};
}

/** Continuation lines sit under the head line, not beside it. */
const INDENT = " ".repeat(13);
const under = (label: string, entry: PidEntry, status: string): string =>
	`${INDENT}${label} — pid ${entry.pid}, worktree ${entry.segment}: ${status}`;

/**
 * @invariant the-uat-line-is-rendered-from-a-slot-never-from-the-entries
 * @rung 6  choke point — the only function that turns a slot into lines, and it
 *          does not take `PidEntry[]` at all, so it cannot reach the registry
 *          even by accident. NOT rung 7, and the first draft of this row said 7
 *          wrongly: `cmdStatus` still holds `entries`, `snap` and `console.log`
 *          in scope, so a second line printed beside this call compiles and
 *          ships. That is the same residual bypass that caps `slotFor`, and
 *          both rows reach 7 only when nothing in `cmdStatus` can name an entry
 *          except through a slot. What the compiler DOES enforce unaided is
 *          narrower: a new `PortSlot` arm fails to compile here — measured
 *          2026-09-17, TS2366 under TypeScript strict mode — but that rests on
 *          the declared return type rather than an explicit never arm, so
 *          inferring the return type or adding a default arm would remove it
 *          silently
 * @why the line answers "is the UAT stack up?", and both of its failure modes
 *      cost real work: naming a dead worktree sends someone to restart a stack
 *      that is already serving, and naming a live process in the WRONG worktree
 *      invites tearing down someone else's. Rendering from the raw entries is
 *      how the first one happened (GIT_216); an arm with nowhere to put its
 *      claimants is how the second stayed invisible (GIT_218). Neither is
 *      prevented by construction — what this buys is one place to look
 */
export function slotLines(port: number, slot: PortSlot, shown: EntryLookup): string[] {
	switch (slot.kind) {
		case "unverifiable":
			// Naming a claimant here would be a guess wearing a reading's clothes.
			return [`  mock ${port} : unknown — ${slot.reason}`];
		case "listening":
			return [
				`  mock ${port} : ${shown.status(slot.entry)} — pid ${slot.entry.pid}, ` +
					`worktree ${slot.entry.segment} (${shown.where(slot.entry)})`,
				...slot.alsoHolding.map(e => under("also holding this port", e, shown.status(e))),
				// A live process on the reserved port that no pidfile claims FOR THIS
				// PORT. It may still have a pidfile — one naming another port, or
				// one whose body is unparseable — so the line says what is known
				// rather than "no pidfile exists". There is no entry here either
				// way, so no status or worktree to show.
				...slot.unclaimedHolders.map(pid => `${INDENT}also holding this port, no pidfile claims it — pid ${pid}`),
				...slot.alsoClaimed.map(e => under("also claimed, not holding it", e, shown.status(e))),
			];
		case "untracked":
			return [
				`  mock ${port} : LISTENING but untracked — pid ${slot.pids.join(", ")}`,
				...slot.claimed.map(e => under("claimed by a pidfile that does not hold it", e, shown.status(e))),
			];
		case "idle":
			return [
				`  mock ${port} : not running`,
				...slot.claimed.map(e => under("claimed by a pidfile", e, shown.status(e))),
			];
	}
}
