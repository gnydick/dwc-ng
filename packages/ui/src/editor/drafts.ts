/**
 * Edit sessions: the unsaved text and the coarse checkpoint history behind the
 * editor's ◀ ▶ stepper.
 *
 * What this exists for: the editor used to hold everything in CodeMirror, which
 * is destroyed whenever the open path changes or the card unmounts. Navigating
 * away therefore threw away both the in-progress text AND CodeMirror's own undo
 * stack. Now the text lives here, keyed by absolute path, and CodeMirror is only
 * a view of it.
 *
 * Two rules from the request, and both are structural rather than remembered:
 *
 *  - **Closing flushes; saving does not.** `closeSession` is the ONLY function
 *    that erases a session, and nothing on the save path calls it. Saving moves
 *    the baseline (what "unsaved" is measured against) and leaves the history
 *    alone, so you can still step back to before a save.
 *  - **A session belongs to exactly one file.** It is keyed by absolute path AND
 *    carries that path, and `loadSession` refuses a record whose stored path
 *    disagrees with the key. Restoring one file's text into another editor would
 *    write it over that file on the next Save — the one failure here that
 *    destroys data, so it is checked rather than assumed.
 *
 * Every session lives in ONE localStorage record (not a key per file) so the
 * count and the total size can be capped in the same place they are written;
 * per-file keys would each be bounded and the set of them unbounded.
 */
import { isPlainObject, safeEntries } from "../util/safeObject.ts";

const STORE_KEY = "dwc-ng.drafts";

/**
 * The document, its history, and the board copy it diverged from.
 *
 * Invariant: `entries` is non-empty and `at` indexes it. Every value of this
 * type comes from `beginSession` or from a transition below that preserves
 * both, and `loadSession` rebuilds a stored record through the same rules —
 * so no reader has to defend against an empty history or an index off its end.
 */
export interface EditSession {
	/** The absolute path this text belongs to. */
	readonly path: string;
	/** The board's copy as of the last load or save — what "unsaved" measures against. */
	readonly baseline: string;
	/** Checkpoints, oldest first. `entries[0]` is the text as first opened. */
	readonly entries: readonly string[];
	/** Which checkpoint the document currently shows. Always a valid index. */
	readonly at: number;
}

/**
 * How many checkpoints a file keeps. At one snapshot per 10s of *changed*
 * typing this is a little over three minutes of stepping back, which is the
 * scale the stepper is for — CodeMirror's own undo still handles keystrokes.
 */
export const MAX_ENTRIES = 20;

/** How many files keep a session. Oldest written is evicted first. */
const MAX_SESSIONS = 12;

/**
 * Ceiling on the serialized store. localStorage gives an origin a few MB TOTAL,
 * shared with the layout canvases and the config cache — a couple of large
 * config files with twenty revisions each would otherwise evict them. Sessions
 * are dropped oldest-first until the store fits; a single session too big even
 * alone is not persisted, and says so via `persisted`.
 */
const MAX_STORE_BYTES = 512 * 1024;

/** Open a file for editing: one checkpoint, holding the board's copy. */
export function beginSession(path: string, baseline: string): EditSession {
	return { path, baseline, entries: [baseline], at: 0 };
}

/** The text the document currently shows. */
export function currentText(session: EditSession): string {
	return session.entries[session.at]!;
}

/** Whether the document differs from the board copy it was loaded or saved from. */
export function isDirty(session: EditSession): boolean {
	return currentText(session) !== session.baseline;
}

/**
 * Fold the live text in as a new checkpoint, or return the session untouched
 * when nothing changed — so idle ticks cost nothing and cannot pad the history
 * with duplicates.
 *
 * Checkpointing after stepping BACK discards the checkpoints ahead, the usual
 * undo-branch rule: those describe a future that no longer happened, and
 * keeping them would let ▶ walk forward into text the operator never typed.
 */
export function checkpoint(session: EditSession, text: string): EditSession {
	if (text === currentText(session)) return session;
	const kept = session.entries.slice(0, session.at + 1);
	kept.push(text);
	// Drop from the OLD end when full: the recent past is what a stepper is for.
	const entries = kept.length > MAX_ENTRIES ? kept.slice(kept.length - MAX_ENTRIES) : kept;
	return { ...session, entries, at: entries.length - 1 };
}

/** Move the stepper. Out-of-range positions clamp rather than throw — the
 *  buttons are already bounded, and a clamp keeps the invariant total. */
export function stepTo(session: EditSession, index: number): EditSession {
	const at = Math.min(Math.max(Math.trunc(index), 0), session.entries.length - 1);
	return at === session.at ? session : { ...session, at };
}

/**
 * Record that `text` is now the board's copy.
 *
 * It checkpoints first, so the text you saved is in the history as a position
 * you can return to, and then moves ONLY the baseline. The history is
 * deliberately untouched: "flushed after you close, not after you save" means a
 * save must not cost you the ability to step back past it.
 */
export function markSaved(session: EditSession, text: string): EditSession {
	return { ...checkpoint(session, text), baseline: text };
}

/**
 * Whether the board's copy moved out from under this session — someone else
 * wrote the file, or a macro did, while a draft of it was held. The draft is
 * still the operator's work and is never discarded for this; the editor says so
 * instead, because saving would overwrite whatever arrived.
 */
export function isStale(session: EditSession, boardText: string): boolean {
	return session.baseline !== boardText;
}

// ---- persistence ----

type Store = Record<string, EditSession>;

/** Tolerant read of the whole store: anything malformed is simply not a session. */
function readStore(): Store {
	if (typeof localStorage === "undefined") return {};
	const raw = localStorage.getItem(STORE_KEY);
	if (raw === null) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {};
	}
	if (!isPlainObject(parsed)) return {};
	const store: Store = {};
	for (const [path, value] of safeEntries(parsed)) {
		const session = reviveSession(path, value);
		if (session !== null) store[path] = session;
	}
	return store;
}

/**
 * Rebuild one stored record, or null. The stored `path` must match the key it
 * was filed under: that is the check that stops a hand-edited store from
 * handing config.g's text to an editor open on homeall.g, which would overwrite
 * it on the next Save.
 */
function reviveSession(path: string, value: unknown): EditSession | null {
	if (!isPlainObject(value)) return null;
	if (value["path"] !== path) return null;
	const baseline = value["baseline"];
	if (typeof baseline !== "string") return null;
	const rawEntries = value["entries"];
	if (!Array.isArray(rawEntries)) return null;
	const all: string[] = [];
	for (const entry of rawEntries) {
		if (typeof entry !== "string") return null;
		all.push(entry);
	}
	if (all.length === 0) return null;
	const rawAt = value["at"];
	if (typeof rawAt !== "number" || !Number.isInteger(rawAt) || rawAt < 0 || rawAt >= all.length) return null;
	// Over-length histories are trimmed from the OLD end, matching `checkpoint`,
	// and `at` moves with the window. Trimming the other end would silently
	// re-point the position at a different snapshot than the one stored.
	const dropped = Math.max(0, all.length - MAX_ENTRIES);
	const entries = all.slice(dropped);
	return { path, baseline, entries, at: Math.max(0, rawAt - dropped) };
}

function writeStore(store: Store): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(STORE_KEY, JSON.stringify(store));
	} catch {
		// Private mode / quota: drafts just won't outlive the tab.
	}
}

/** The session held for `path`, or null. */
export function loadSession(path: string): EditSession | null {
	return readStore()[path] ?? null;
}

/**
 * Persist a session, evicting to stay inside both caps.
 *
 * Returns whether it actually landed, so the editor can tell the operator that
 * this file is too large to survive a reload instead of implying a safety net
 * that isn't there.
 */
export function saveSession(session: EditSession): boolean {
	const store = readStore();
	// Re-inserting last makes plain object order a least-recently-written list,
	// which is what the count cap evicts from.
	delete store[session.path];
	store[session.path] = session;
	for (const path of Object.keys(store)) {
		if (Object.keys(store).length <= MAX_SESSIONS) break;
		if (path !== session.path) delete store[path];
	}
	while (JSON.stringify(store).length > MAX_STORE_BYTES) {
		const oldest = Object.keys(store).find(path => path !== session.path);
		if (oldest === undefined) {
			// Nothing left to give: this one session is over the ceiling on its
			// own. Leave what was already stored alone rather than clearing it.
			return false;
		}
		delete store[oldest];
	}
	writeStore(store);
	return true;
}

/**
 * Forget a file's session entirely. THE sole flush — closing an editor is the
 * only thing that reaches it, which is what makes "saving keeps your history"
 * a property of the code rather than a promise in a comment.
 */
export function closeSession(path: string): void {
	const store = readStore();
	if (!(path in store)) return;
	delete store[path];
	writeStore(store);
}
