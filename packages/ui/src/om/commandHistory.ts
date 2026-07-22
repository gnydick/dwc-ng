/**
 * Sent-command history for the console input (↑/↓ recall).
 *
 * Separate from the reply log (om/consoleLog.ts): that stores what the machine
 * SAID, this stores what the operator TYPED, so a code can be recalled and
 * re-sent without retyping. Persisted to localStorage, not the config overlay —
 * a command log has no business being uploaded to the printer's SD, same
 * reasoning as the reply log.
 *
 * Pure reducer (`pushCommand`) kept apart from storage so it's testable and so
 * a corrupt/blocked store can never break boot.
 */

/** Plenty to scroll back through a session's worth of manual codes. */
export const COMMAND_LIMIT = 100;

const STORAGE_KEY = "dwc-ng.cmdHistory";

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

/** Restore the history; a blocked or corrupt store just starts empty. */
export function loadCommandHistory(): string[] {
	if (typeof localStorage === "undefined") return [];
	try {
		return parseHistory(localStorage.getItem(STORAGE_KEY));
	} catch {
		return [];
	}
}

/** Persist the history. Never throws — a full/blocked quota must not break the UI. */
export function saveCommandHistory(history: string[]): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(STORAGE_KEY, serializeHistory(history));
	} catch {
		// Private mode / quota exceeded: recall just won't survive a reload.
	}
}
