import { createStore, reconcile, produce, type SetStoreFunction } from "solid-js/store";
import type { ConnectorEvents, ConnectionStatus } from "../connector/types.ts";
import { emptyModel, type ObjectModel } from "./types.ts";

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

export interface ConsoleLine {
	/** Wall-clock time the reply arrived (client-side). */
	receivedAt: number;
	text: string;
}

const CONSOLE_LIMIT = 200;

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
	const [consoleLines, setConsoleLines] = createStore<ConsoleLine[]>([]);

	const events: ConnectorEvents = {
		onModelKey(key, value) {
			// Authoritative subtree: replace wholesale, reconcile diffs the rest
			setOm(key as keyof ObjectModel, reconcile(value as never));
		},
		onModelPatch(patch) {
			setOm(produce(draft => deepMergeInto(draft as Record<string, unknown>, patch)));
		},
		onReply(text) {
			setConsoleLines(produce(lines => {
				lines.push({ receivedAt: Date.now(), text });
				if (lines.length > CONSOLE_LIMIT) lines.splice(0, lines.length - CONSOLE_LIMIT);
			}));
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
	for (const [key, value] of Object.entries(patch)) {
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
