import { createStore, reconcile, produce, type SetStoreFunction } from "solid-js/store";
import type { ConnectorEvents, ConnectionStatus } from "../connector/types.ts";
import { conformModelKey, emptyModel, type ObjectModel } from "./types.ts";
import { CONSOLE_LIMIT, loadConsole, saveConsole, type ConsoleLine } from "./consoleLog.ts";
import { isPlainObject, isSafeKey, safeEntries } from "../util/safeObject.ts";

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
	boardType: string | null;
}

export type { ConsoleLine };

export interface OmStore {
	om: ObjectModel;
	setOm: SetStoreFunction<ObjectModel>;
	connection: ConnectionState;
	console: ConsoleLine[];
	/** ConnectorEvents implementation — pass to the connector's options. */
	events: ConnectorEvents;
}

export function createOmStore(): OmStore {
	const [om, setOm] = createStore<ObjectModel>(emptyModel());
	const [connection, setConnection] = createStore<ConnectionState>({
		status: "disconnected",
		detail: "",
		emulated: null,
		boardType: null,
	});
	// Macro output (M118) is the reason to run some macros — restore it so a
	// reload mid-run doesn't lose what the machine already told you.
	const [consoleLines, setConsoleLines] = createStore<ConsoleLine[]>(loadConsole());

	// Persist throttled: a chatty macro must not re-serialize the whole log per
	// message. The store proxy is read at flush time, so this saves current state.
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	const persistSoon = (): void => {
		if (saveTimer !== null) return;
		saveTimer = setTimeout(() => {
			saveTimer = null;
			saveConsole(consoleLines.slice());
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
			// Authoritative subtree: replace wholesale, reconcile diffs the rest
			setOm(key as keyof ObjectModel, reconcile(conformed.value as never));
		},
		onModelPatch(patch) {
			setOm(produce(draft => deepMergeInto(draft as Record<string, unknown>, patch)));
		},
		onReply(text) {
			setConsoleLines(produce(lines => {
				lines.push({ receivedAt: Date.now(), text });
				if (lines.length > CONSOLE_LIMIT) lines.splice(0, lines.length - CONSOLE_LIMIT);
			}));
			persistSoon();
		},
		onStatusChange(status, detail) {
			setConnection({ status, detail: detail ?? "" });
		},
		onBoardInfo(info) {
			setConnection({ emulated: info.emulated, boardType: info.boardType ?? null });
		},
	};

	return { om, setOm, connection, console: consoleLines, events };
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
