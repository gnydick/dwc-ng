/**
 * Sent-command history for the console input (↑/↓ recall).
 *
 * Separate from the reply log (om/consoleLog.ts): that stores what the machine
 * SAID, this stores what the operator TYPED, so a code can be recalled and
 * re-sent without retyping. Persisted through the caller's machine's store
 * (config/machineStore.ts) — a command log has no business crossing machines
 * any more than a config file does, same reasoning as the reply log.
 *
 * Pure reducer (`pushCommand`) kept apart from storage so it's testable and so
 * a corrupt/blocked store can never break boot.
 */
import { machineKeySegment } from "../config/machineId.ts";
import type { MachineStore } from "../config/machineStore.ts";

/** Plenty to scroll back through a session's worth of manual codes. */
export const COMMAND_LIMIT = 100;

/**
 * Append a sent command, oldest→newest. Blank input is ignored; an immediate
 * repeat of the last command is collapsed so ↑ never steps over duplicates.
 * Capped to the newest `limit`.
 */
export function pushCommand(history: string[], command: string, limit: number = COMMAND_LIMIT): string[] {
	const trimmed = command.trim();
	if (trimmed === "") return history;
	if (history.length > 0 && history[history.length - 1] === trimmed) return history;
	const next = [...history, trimmed];
	return next.length > limit ? next.slice(next.length - limit) : next;
}

/** Keep only the newest `limit` commands — same shape as consoleLog's capLines,
 *  used when hydrating a history that grew locally before a machine was known. */
export function capHistory(history: string[], limit: number = COMMAND_LIMIT): string[] {
	return history.length > limit ? history.slice(history.length - limit) : history;
}

/** Tolerant parse: anything unexpected yields an empty history, never a throw. */
export function parseHistory(raw: string | null): string[] {
	if (raw === null || raw === "") return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	return parsed.filter((entry): entry is string => typeof entry === "string");
}

export function serializeHistory(history: string[], limit: number = COMMAND_LIMIT): string {
	return JSON.stringify(history.length > limit ? history.slice(history.length - limit) : history);
}

/** Restore the history from `store`'s machine; a blocked or corrupt store just
 *  starts empty. */
export function loadCommandHistory(store: MachineStore): string[] {
	try {
		return parseHistory(store.get("cmdHistory"));
	} catch {
		return [];
	}
}

/** Persist the history to `store`'s machine. Never throws — a full/blocked
 *  quota must not break the UI. */
export function saveCommandHistory(store: MachineStore, history: string[]): void {
	try {
		store.set("cmdHistory", serializeHistory(history));
	} catch {
		// Private mode / quota exceeded: recall just won't survive a reload.
	}
}

/**
 * The swap-safe in-memory buffer behind ConsolePanel's ↑/↓ recall.
 *
 * Same remedy as om/store.ts's hydrateConsole (the console-log sibling this
 * campaign already fixed), but REPLACE rather than fold-and-flush: unlike the
 * reply log, a command typed for one machine has no display-continuity
 * argument for staying on screen after a swap, and — the harm that actually
 * reaches hardware — sitting at the top of ↑-recall it can be resent to the
 * WRONG board with one keystroke. So there is no boundary line and no
 * flush-then-append; `bindMachine` on an identity change simply drops
 * whatever is in memory and loads the newly-current machine's own history in
 * its place, matching config/store.ts's hydrateMachine: "an edit made
 * against a machine that is no longer current has no machine to belong to."
 * That includes the FIRST bind — commands typed before identity resolves are
 * discarded too, never folded into whichever machine happens to answer
 * first (the same "no machine, no write" precedent, extended to reads).
 *
 * `push` persists through whichever store `bindMachine` most recently bound
 * — captured once there, never re-resolved fresh at write time — so a send()
 * that races a swap cannot land under the NEW machine's key.
 */
export interface CommandHistoryState {
	readonly history: readonly string[];
	/**
	 * (Re)bind to `store`'s machine. A no-op when already bound to it
	 * (compared by machineKeySegment, the same canonical string the storage
	 * keys themselves use). Otherwise REPLACES the in-memory buffer with
	 * that machine's own saved history — never merged with, and never
	 * preceded or followed by, whatever was there before.
	 */
	bindMachine(store: MachineStore | null): void;
	/** Record a sent command and persist it to whichever store is currently
	 *  bound. A no-op write (in-memory only) while unbound. */
	push(command: string): void;
}

export function createCommandHistoryState(): CommandHistoryState {
	let history: string[] = [];
	let boundStore: MachineStore | null = null;
	let boundKey: string | null = null;
	return {
		get history() {
			return history;
		},
		bindMachine(store) {
			// Unidentified: nothing to bind to yet. Leave whatever is already in
			// memory alone — same as the effect never running at all — rather
			// than wipe it out from under an operator still typing.
			if (store === null) return;
			const key = machineKeySegment(store.id);
			if (key === boundKey) return; // already bound to this machine
			boundKey = key;
			boundStore = store;
			history = capHistory(loadCommandHistory(store));
		},
		push(command) {
			history = pushCommand(history, command);
			if (boundStore !== null) saveCommandHistory(boundStore, history);
		},
	};
}
