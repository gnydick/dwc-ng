/**
 * Console history + its persistence.
 *
 * Gabe's macros emit messages (M118) that are the point of running them, so the
 * log is real data, not decoration: it survives a reload. Kept in localStorage
 * rather than the config overlay — the overlay persists to the machine's SD,
 * and a chat log has no business being uploaded to a printer.
 *
 * The pure helpers are separated from storage so they're testable and so a
 * corrupt/blocked store can never break boot.
 */

export interface ConsoleLine {
	/** Wall-clock time the reply arrived (client-side). */
	receivedAt: number;
	text: string;
}

/** Deep enough to scroll back through a long macro run. */
export const CONSOLE_LIMIT = 1000;

const STORAGE_KEY = "dwc-ng.console";
const FLOATING_KEY = "dwc-ng.console.floating";

/** Keep only the newest `limit` lines. */
export function capLines(lines: ConsoleLine[], limit: number = CONSOLE_LIMIT): ConsoleLine[] {
	return lines.length > limit ? lines.slice(lines.length - limit) : lines;
}

/** Tolerant parse: anything unexpected yields an empty log, never a throw. */
export function parseConsole(raw: string | null): ConsoleLine[] {
	if (raw === null || raw === "") return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	return parsed.filter((entry): entry is ConsoleLine =>
		typeof entry === "object" && entry !== null
		&& typeof (entry as ConsoleLine).receivedAt === "number"
		&& typeof (entry as ConsoleLine).text === "string",
	);
}

export function serializeConsole(lines: ConsoleLine[]): string {
	return JSON.stringify(capLines(lines));
}

/** Restore the log; a blocked or corrupt store just starts empty. */
export function loadConsole(): ConsoleLine[] {
	if (typeof localStorage === "undefined") return [];
	try {
		return parseConsole(localStorage.getItem(STORAGE_KEY));
	} catch {
		return [];
	}
}

/** Persist the log. Never throws — a full/blocked quota must not break the UI. */
export function saveConsole(lines: ConsoleLine[]): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(STORAGE_KEY, serializeConsole(lines));
	} catch {
		// Private mode / quota exceeded: the log just won't survive a reload.
	}
}

/**
 * Whether the console is snapped out into its floating panel.
 *
 * Persisted here rather than in the config overlay: the overlay only lands on
 * an explicit Save (and uploads to the machine's SD), which would mean snapping
 * the console out, reloading, and finding it docked again. It's a workspace
 * preference, so it sticks immediately and stays local to this browser.
 */
export function loadConsoleFloating(): boolean {
	if (typeof localStorage === "undefined") return false;
	try {
		return localStorage.getItem(FLOATING_KEY) === "true";
	} catch {
		return false;
	}
}

export function saveConsoleFloating(floating: boolean): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(FLOATING_KEY, String(floating));
	} catch {
		// Private mode / quota: the choice just won't survive a reload.
	}
}
