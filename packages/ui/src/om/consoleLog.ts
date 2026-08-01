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

/**
 * Severity a reply carries. RRF authors it into the message itself: a flagged
 * error/warning arrives prefixed "Error: " / "Warning: " (RRF's own convention,
 * see reference/dwc utils/logging.ts). We only REFLECT that prefix — we never
 * decide severity ourselves, so an error can't be styled as normal or vice
 * versa. Derived from the text at render, never stored, so it can't drift from
 * the words on screen.
 */
export type ReplySeverity = "error" | "warning" | "normal";

export function classifyReply(text: string): ReplySeverity {
	if (text.startsWith("Error: ")) return "error";
	if (text.startsWith("Warning: ")) return "warning";
	return "normal";
}

/**
 * Deep enough to scroll back through a long macro run.
 *
 * @invariant console-log-is-bounded
 * @rung 5  one shared constant, TWO enforcement sites — om/store.ts:100 splices
 *          the live store in place, and capLines below slices on the way to
 *          localStorage. The number is a single fact; the capping is not
 * @why the console takes every reply the board sends, and a long print sends a
 *      lot. Unbounded, it grows until the tab is slow and the localStorage
 *      write throws — and the catch that hides that write failure would take
 *      the whole persisted log with it
 * @debt the tripwire: the same processing step at a second call site. Promote
 *       by making the log a small bounded type whose push caps, so both the
 *       live store and the save path get the bound from the value rather than
 *       each applying it, and a third consumer cannot forget.
 */
export const CONSOLE_LIMIT = 1000;

const STORAGE_KEY = "dwc-ng.console";

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
