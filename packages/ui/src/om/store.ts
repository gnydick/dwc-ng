import { createStore, reconcile, produce, type SetStoreFunction } from "solid-js/store";
import type { Accessor } from "solid-js";
import type { ConnectorEvents, ConnectionStatus, ConnectorTransport } from "@dwc-ng/connector";
import { conformModelKey, emptyModel, type ObjectModel } from "./types.ts";
import { appendCapped, capLines, saveConsole, type ConsoleLine } from "./consoleLog.ts";
import { isPlainObject, isSafeKey, safeEntries } from "@dwc-ng/connector";
import type { MachineStore } from "../config/machineStore.ts";

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
	 * Fold a machine's persisted console lines in, oldest-first, ahead of
	 * whatever arrived live since boot — never overwrite. Identity resolves
	 * about a poll after boot (config/machineSession.ts), so replies can
	 * already be streaming in by the time a machine's own history is known;
	 * dropping them to make room for the load would lose live data to a
	 * merely-late one. Capped the same as a live append, so a machine with a
	 * long persisted log cannot make this call exceed CONSOLE_LIMIT.
	 */
	hydrateConsole(loaded: ConsoleLine[]): void;
	/** ConnectorEvents implementation — pass to the connector's options. */
	events: ConnectorEvents;
}

/**
 * `machineStore` names which machine's store an incoming reply persists to,
 * the same "no machine, no write" precedent as config/store.ts's machine
 * half: a reply that arrives before identity resolves still joins the LIVE
 * log (it is real data the operator is watching right now), it just is not
 * written to disk under a guess. Optional and defaulting to "no machine" —
 * unlike config/store.ts's machineStore, which the machine-identity work
 * itself is reviewed against, createOmStore is called from many OM-merge
 * tests that have nothing to do with identity, and an unwired default of
 * "never persists" is safe (never wrong-machine) rather than merely
 * convenient, so it does not carry the same "must be explicit" case.
 *
 * A lazy accessor rather than a `MachineStore | null` value: App.tsx builds
 * the machine session FROM this store's `om` proxy, so the two are
 * necessarily constructed in that order and the accessor is what lets the
 * later one's answer reach code written here. It is read only from inside
 * `persistSoon`'s deferred timeout, never synchronously during construction,
 * so which of the two exists first is not a hazard.
 */
export function createOmStore(options?: { machineStore?: Accessor<MachineStore | null> }): OmStore {
	const machineStore = options?.machineStore ?? ((): null => null);
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

	const hydrateConsole = (loaded: ConsoleLine[]): void => {
		setConsoleLines(produce(lines => {
			const merged = capLines([...loaded, ...lines]);
			lines.length = 0;
			lines.push(...merged);
		}));
	};

	// Persist throttled: a chatty macro must not re-serialize the whole log per
	// message. The store proxy is read at flush time, so this saves current state.
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	const persistSoon = (): void => {
		if (saveTimer !== null) return;
		saveTimer = setTimeout(() => {
			saveTimer = null;
			const store = machineStore();
			if (store !== null) saveConsole(store, consoleLines.slice());
		}, 400);
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
			// it is, so it cannot append past it.
			setConsoleLines(produce(lines => appendCapped(lines, { receivedAt: Date.now(), text })));
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
