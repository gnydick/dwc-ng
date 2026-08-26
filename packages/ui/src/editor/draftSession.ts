/**
 * The swap-safe machine binding behind FileEditor's draft session.
 *
 * FileEditor.tsx used to resolve `machineStoreFor(app.machineId())` FRESH at
 * every write site (capture, save, revert, close, step) — but `session` (the
 * in-memory buffer holding whatever text the operator is editing) can outlive
 * an identity change. An editor left open across a board swap would flush its
 * OUTGOING machine's text under the INCOMING machine's `drafts` key on the
 * very next checkpoint tick — the same shape as the console-log and command-
 * history defects this file's siblings (om/store.ts's hydrateConsole,
 * om/commandHistory.ts's createCommandHistoryState) exist to close.
 *
 * Unlike either of those, a draft session has no display-continuity argument
 * for keeping the outgoing text around at all: there is nothing on screen
 * that benefits from staying past the boundary, so the remedy here is not
 * "flush the outgoing store, then rebind" but "report the swap and let the
 * caller drop the session outright" — matching config/store.ts's
 * hydrateMachine precedent, "an edit made against a machine that is no
 * longer current has no machine to belong to."
 *
 * Binding for the FIRST time (unbound → a known machine) is deliberately NOT
 * reported as a swap: an edit begun before identity resolved has only ever
 * had one candidate machine to belong to (there is exactly one connection),
 * so it simply starts persisting from here — same tradeoff FileEditor's own
 * doc comment already accepted ("the in-memory session still works for this
 * mount; it just won't survive a reload until a machine is known").
 */
import { machineKeySegment } from "../config/machineId.ts";
import type { MachineStore } from "../config/machineStore.ts";

export type RebindResult = "unchanged" | "bound" | "swapped";

export interface DraftSessionHandle {
	/** The store a caller should persist THIS session's writes through right
	 *  now — null while unidentified. Never re-resolve `app.machineId()`
	 *  independently for a write; always go through this. */
	readonly store: MachineStore | null;
	/**
	 * (Re)bind to whichever machine is current.
	 *
	 * - "unchanged": already bound to this machine (or still unidentified) —
	 *   nothing to do.
	 * - "bound": the FIRST resolution (unbound → known). Not a swap; the
	 *   caller keeps whatever session it is holding and starts persisting it.
	 * - "swapped": a DIFFERENT machine than the one already bound. The
	 *   caller's cue to drop its in-memory session — it belongs to neither
	 *   the outgoing nor the incoming machine's storage from this point on.
	 */
	rebind(next: MachineStore | null): RebindResult;
}

export function createDraftSessionHandle(): DraftSessionHandle {
	let store: MachineStore | null = null;
	let key: string | null = null;
	return {
		get store() {
			return store;
		},
		rebind(next) {
			const nextKey = next === null ? null : machineKeySegment(next.id);
			if (nextKey === key) return "unchanged";
			const swapped = key !== null && nextKey !== null; // both known, and different
			store = next;
			key = nextKey;
			return swapped ? "swapped" : "bound";
		},
	};
}
