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
 * @rung 6  choke-point — every APPLICATION of the bound lives in this module.
 *          om/store.ts used to import CONSOLE_LIMIT and splice the live array
 *          itself; it now calls appendCapped and has no way to express an
 *          uncapped append. The two entry points that remain — live append and
 *          the storage boundary — are two operations on one bound rather than
 *          two implementations of it. The constant stays exported because the
 *          tests build an overflowing log from it, which is reading the bound,
 *          not re-applying it
 * @why the console takes every reply the board sends, and a long print sends a
 *      lot. Unbounded, it grows until the tab is slow and the localStorage
 *      write throws — and the catch that hides that write failure would take
 *      the whole persisted log with it
 * @debt promotion to 7 is a bounded log TYPE whose push caps, so the bound
 *       comes from the value rather than from calling the right function.
 *       Blocked by the live log being a Solid store array written through
 *       produce(), which hands the callback a plain mutable array — a custom
 *       type cannot survive that round trip without wrapping every read.
 */
export const CONSOLE_LIMIT = 1000;

/**
 * Append one line, evicting the oldest past the bound — the only sanctioned
 * way to grow the live log.
 *
 * Mutates in place, deliberately: the live console is a Solid store array
 * written through `produce`, which hands the callback a draft to mutate. A
 * function returning a new array would defeat the fine-grained update and make
 * every reply re-render the whole console.
 */
export function appendCapped(lines: ConsoleLine[], line: ConsoleLine): void {
	lines.push(line);
	if (lines.length > CONSOLE_LIMIT) lines.splice(0, lines.length - CONSOLE_LIMIT);
}

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
