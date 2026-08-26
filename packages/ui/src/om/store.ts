import { createStore, reconcile, produce, type SetStoreFunction } from "solid-js/store";
import type { Accessor } from "solid-js";
import type { ConnectorEvents, ConnectionStatus, ConnectorTransport } from "@dwc-ng/connector";
import { conformModelKey, emptyModel, type ObjectModel } from "./types.ts";
import { appendCapped, capLines, saveConsole, CONSOLE_LIMIT, type ConsoleLine } from "./consoleLog.ts";
import { isPlainObject, isSafeKey, safeEntries } from "@dwc-ng/connector";
import type { MachineStore } from "../config/machineStore.ts";
import { describeMachineId, machineKeySegment } from "../config/machineId.ts";

/**
 * The two stores of machine truth, and the bridge from a Connector.
 *
 * Boundary rule (see design/README.md and project memory): this store holds
 * ONLY the RRF object model + connection state — poll-driven machine truth.
 * User truth (layout overlays, axis role labels, dock-sensor mappings) lives
 * in a separate UI-config store and never mixes with this one.
 *
 * Merge strategy (CLAUDE.md):
 * - full subtree from a seqs re-fetch  → wholesale replacement via reconcile()
 *   so only signals whose values changed are notified;
 * - sparse live patch (flags=d99fn)    → deep merge via produce(); absent
 *   fields are untouched, never deleted.
 */

export interface ConnectionState {
	status: ConnectionStatus;
	/** Human-readable detail for the current status (e.g. last error). */
	detail: string;
	/** true = rr_ served by DSF on an SBC; false = standalone firmware; null = unknown. */
	emulated: boolean | null;
	/** Which dialect is serving this session; null until the connector says. */
	transport: ConnectorTransport | null;
	boardType: string | null;
}

export type { ConsoleLine };

export interface OmStore {
	om: ObjectModel;
	setOm: SetStoreFunction<ObjectModel>;
	connection: ConnectionState;
	console: ConsoleLine[];
	/**
	 * Fold a machine's persisted console lines in — never overwrite.
	 * Identity resolves about a poll after boot (config/machineSession.ts),
	 * so replies can already be streaming in by the time a machine's own
	 * history is known; dropping them to make room for the load would lose
	 * live data to a merely-late one. Capped the same as a live append, so a
	 * machine with a long persisted log cannot make this call exceed
	 * CONSOLE_LIMIT.
	 *
	 * The FIRST call (boot) prepends `loaded` ahead of whatever is already
	 * live, on the assumption that a machine's disk history predates
	 * anything this tab has seen. A LATER call for a DIFFERENT `store`
	 * (Ruling 22 — a board swap mid-session) instead APPENDS a single
	 * boundary line naming the new machine, then that machine's history —
	 * the log otherwise has nothing distinguishing two machines' replies
	 * sitting side by side, which is exactly the misattribution this
	 * campaign exists to rule out elsewhere.
	 *
	 * DISPLAY continuity (both machines visible, separated by the boundary)
	 * is deliberately wider than what gets WRITTEN (Ruling 23): only the
	 * segment belonging to the CURRENTLY identified machine is ever saved —
	 * see the `currentMachineStart` doc comment inside createOmStore for how
	 * that segment is tracked. Passing `store` here (not just the identity)
	 * is what lets this function rebind future persists to it directly,
	 * rather than a later read racing a swap that already moved on.
	 */
	hydrateConsole(loaded: ConsoleLine[], store: MachineStore): void;
	/** ConnectorEvents implementation — pass to the connector's options. */
	events: ConnectorEvents;
}

/**
 * `machineStore` names which machine's store an incoming reply persists to,
 * the same "no machine, no write" precedent as config/store.ts's machine
 * half: a reply that arrives before identity resolves still joins the LIVE
 * log (it is real data the operator is watching right now), it just is not
 * written to disk under a guess.
 *
 * REQUIRED, not optional-with-a-default (Ruling 21) — the same shape and the
 * same reason as config/store.ts's own `machineStore` parameter: an optional
 * dependency compiles cleanly at a call site that forgot it, and the failure
 * mode is silent (console history that quietly never persists), not a crash
 * that gets noticed. A caller with no machine session yet writes
 * `() => null` explicitly, which is also documentation — every OM-merge test
 * that does so is declaring "this test has no machine" rather than omitting
 * the question.
 *
 * A lazy accessor rather than a `MachineStore | null` value: App.tsx builds
 * the machine session FROM this store's `om` proxy, so the two are
 * necessarily constructed in that order and the accessor is what lets the
 * later one's answer reach code written here. Read EAGERLY, once, the
 * instant a reply schedules a persist (persistSoon) — never lazily inside
 * the deferred timeout callback. Ruling 23: a lazy read there answers for
 * WHATEVER machine is current when the timer fires, which can be a
 * DIFFERENT machine than the one the buffered lines came from if a swap
 * happened during the debounce window — the exact cross-contamination this
 * rule exists to prevent. `scheduledFor` (below) carries the eager answer
 * forward from schedule time to fire time.
 */
export function createOmStore(options: { machineStore: Accessor<MachineStore | null> }): OmStore {
	const machineStore = options.machineStore;
	const [om, setOm] = createStore<ObjectModel>(emptyModel());
	const [connection, setConnection] = createStore<ConnectionState>({
		status: "disconnected",
		detail: "",
		emulated: null,
		transport: null,
		boardType: null,
	});
	// Starts empty rather than reading a prior machine's (or no machine's)
	// bytes at boot — see hydrateConsole's doc comment for how a machine's own
	// history joins once identity is known.
	const [consoleLines, setConsoleLines] = createStore<ConsoleLine[]>([]);

	// Which machine's history is already folded in — null until the first
	// hydrate. Compared by machineKeySegment (the same canonical per-machine
	// string the storage keys themselves use), not by object identity, so
	// re-resolving to the SAME machine is never mistaken for a swap.
	let hydratedFor: string | null = null;

	/**
	 * Where the CURRENTLY identified machine's OWN lines begin in
	 * `consoleLines` — in memory only, never persisted (Ruling 23). Everything
	 * at or after this index came from (or arrived while talking to) the
	 * current machine; everything before it is an earlier machine's content,
	 * kept on screen for display continuity (Ruling 22) but never eligible to
	 * be written under the current machine's own key. Reset to 0 on the
	 * FIRST hydrate (nothing precedes it — the whole buffer is one machine's).
	 * On a SWAP, set to just past the freshly-appended boundary line, using
	 * `merged.length - loaded.length`: the boundary+loaded block is always
	 * the tail of the pre-cap array, and capLines only ever trims from the
	 * FRONT, so that arithmetic holds whether or not capping actually
	 * dropped anything (clamped to 0 for the case where capping ate into
	 * `loaded` itself, at which point the whole remaining tail is the new
	 * machine's own content regardless). Adjusted downward -- never past 0 --
	 * whenever a live append's own cap (appendCapped) evicts from the front.
	 */
	let currentMachineStart = 0;

	// Persist throttled: a chatty macro must not re-serialize the whole log per
	// message. `scheduledFor` is machineStore()'s answer captured the instant
	// persistSoon schedules the timer (see machineStore's own doc comment for
	// why eagerly, not lazily) — it is what a swap's flush (below) reads to
	// know which store the ALREADY-PENDING lines belong to, since by the time
	// hydrateConsole runs for the new machine, machineStore() only answers for
	// the new one any more.
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let scheduledFor: MachineStore | null = null;

	/**
	 * Write whatever is pending RIGHT NOW, synchronously, to whichever store
	 * it was scheduled against — and only that machine's OWN segment
	 * (`currentMachineStart` onward), never the earlier machine's content
	 * still on screen for display continuity. A no-op when nothing is
	 * pending (`scheduledFor` is only ever non-null alongside a live
	 * `saveTimer`, so checking one is checking both).
	 *
	 * @invariant a-machine-swap-flushes-the-outgoing-machine-first
	 * @rung 6  choke-point — the ONLY function that calls saveConsole, shared
	 *          by persistSoon's own deferred timeout AND hydrateConsole's
	 *          swap branch, so "which segment gets written" is decided once
	 * @why the debounce timer is one shared value, not one per machine — a
	 *      swap that rebinds it without flushing first hands the OUTGOING
	 *      machine's last few lines to the INCOMING machine's key, the exact
	 *      hazard #76 phase 1 exists to make unrepresentable
	 */
	const flushNow = (): void => {
		if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; }
		const store = scheduledFor;
		scheduledFor = null;
		if (store !== null) saveConsole(store, consoleLines.slice(currentMachineStart));
	};

	const persistSoon = (): void => {
		if (saveTimer !== null) return;
		scheduledFor = machineStore();
		saveTimer = setTimeout(flushNow, 400);
	};

	const hydrateConsole = (loaded: ConsoleLine[], store: MachineStore): void => {
		const key = machineKeySegment(store.id);
		if (key === hydratedFor) return; // already folded this machine's history in
		const first = hydratedFor === null;
		// Ruling 23, requirement 1: flush the OUTGOING machine's pending
		// persist BEFORE rebinding anything below. Harmless (a no-op) on the
		// very first hydrate, since nothing can be scheduled — and pending —
		// against a machine before one is ever known.
		flushNow();
		hydratedFor = key;
		setConsoleLines(produce(lines => {
			if (first) {
				// Boot: nothing was on screen before this, so the disk history
				// reads as strictly older than anything live.
				const merged = capLines([...loaded, ...lines]);
				lines.length = 0;
				lines.push(...merged);
				currentMachineStart = 0;
				return;
			}
			// A machine SWAP (Ruling 22): appended, not prepended — `lines`
			// already holds the PREVIOUS machine's content in the order it was
			// displayed, and splicing a different machine's disk history in
			// ahead of that would interleave two machines' pasts with nothing
			// marking where one ends and the other begins.
			const boundary: ConsoleLine = { receivedAt: Date.now(), text: `— now viewing ${describeMachineId(store.id)} —` };
			const merged = capLines([...lines, boundary, ...loaded]);
			lines.length = 0;
			lines.push(...merged);
			// See currentMachineStart's own doc comment for why this holds
			// regardless of how much (if anything) capLines trimmed.
			currentMachineStart = Math.max(0, merged.length - loaded.length);
		}));
	};

	const events: ConnectorEvents = {
		onModelKey(key, value) {
			// The key comes off the wire (the board's seqs object). A
			// prototype-reaching key must never become a store path.
			if (!isSafeKey(key)) return;
			// Shape gate (audit M8): the fields render code iterates are
			// guaranteed here; an unusable subtree keeps the last good one.
			const conformed = conformModelKey(key, value);
			if (!conformed.ok) return;
			// job.layers is CONNECTOR truth (onJobLayers), never rr_ truth —
			// RRF keeps no layer history, so a wholesale job refetch always
			// arrives layer-less and must not wipe the maintained history.
			if (key === "job") {
				const incoming = conformed.value as Record<string, unknown>;
				if (Array.isArray(incoming.layers) && incoming.layers.length === 0 && om.job.layers.length > 0) {
					incoming.layers = om.job.layers.map(l => ({ ...l }));
				}
			}
			// Authoritative subtree: replace wholesale, reconcile diffs the rest
			setOm(key as keyof ObjectModel, reconcile(conformed.value as never));
		},
		onModelPatch(patch) {
			setOm(produce(draft => deepMergeInto(draft as Record<string, unknown>, patch)));
		},
		onJobLayers(layers) {
			// Wholesale replacement (see ConnectorEvents doc): a new print's
			// shorter history must not keep the previous print's tail.
			setOm("job", "layers", reconcile(layers as never));
		},
		onReply(text) {
			// The bound lives in consoleLog.ts; this module no longer knows what
			// it is, so it cannot append past it. appendCapped's own eviction
			// (splicing from the front once over CONSOLE_LIMIT) can eat into
			// content BEFORE currentMachineStart -- shift it down by however
			// many lines actually left, clamped at 0, so it keeps pointing at
			// the same logical position rather than drifting stale.
			setConsoleLines(produce(lines => {
				const before = lines.length;
				appendCapped(lines, { receivedAt: Date.now(), text });
				const evicted = Math.max(0, before + 1 - CONSOLE_LIMIT);
				currentMachineStart = Math.max(0, currentMachineStart - evicted);
			}));
			persistSoon();
		},
		onStatusChange(status, detail) {
			setConnection({ status, detail: detail ?? "" });
		},
		onBoardInfo(info) {
			setConnection({
				emulated: info.emulated,
				// A connector that predates the field still yields a truthful
				// answer from the flag it does set.
				transport: info.transport ?? (info.emulated ? "rr-emulated" : "rr"),
				boardType: info.boardType ?? null,
			});
		},
	};

	return { om, setOm, connection, console: consoleLines, hydrateConsole, events };
}

/**
 * Deep-merge a sparse live patch into the draft model.
 * - objects merge recursively;
 * - arrays merge element-wise by index (live arrays are positional in RRF —
 *   axis 2 is axis 2 in every response) and adopt the patch's length when it
 *   grows; a shorter live array never truncates authoritative data;
 * - primitives and null replace.
 */
export function deepMergeInto(target: Record<string, unknown>, patch: Record<string, unknown>): void {
	// safeEntries, not Object.entries: the patch is raw board JSON and a
	// "__proto__" key would recurse into Object.prototype (global pollution).
	for (const [key, value] of safeEntries(patch)) {
		const existing = target[key];
		if (isPlainObject(value) && isPlainObject(existing)) {
			deepMergeInto(existing, value);
		} else if (Array.isArray(value) && Array.isArray(existing)) {
			for (let i = 0; i < value.length; i++) {
				const item = value[i];
				if (isPlainObject(item) && isPlainObject(existing[i])) {
					deepMergeInto(existing[i] as Record<string, unknown>, item as Record<string, unknown>);
				} else {
					existing[i] = item;
				}
			}
		} else {
			target[key] = value;
		}
	}
}
