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
 * @invariant history-is-never-empty-and-at-always-indexes-it
 * @rung 5  every producer preserves it — beginSession seeds one entry,
 *          checkpoint appends, stepTo clamps, reviveSession rejects an empty
 *          array and an out-of-range index. But the TYPE says `readonly
 *          string[]` and `number`, so the guarantee is five functions agreeing,
 *          and currentText spends it on a non-null assertion rather than a
 *          proof
 * @why every reader takes entries[at] as the live document. An empty history or
 *      a stale index does not read as a bug, it reads as an EMPTY FILE — and
 *      the next Save uploads that over the operator's config
 * @debt this is the NonEmpty case from the design rules, left undone. Promote
 *       by making the pair a sole-constructor type — a non-empty list plus an
 *       index proven against it — so currentText returns a string without an
 *       assertion and a sixth transition cannot break the pairing.
 */
export interface EditSession {
	/** The absolute path this text belongs to. */
	readonly path: string;
	/** The board's copy as of the last load or save — what "unsaved" measures against. */
	readonly baseline: CanonicalText;
	/** Checkpoints, oldest first. `entries[0]` is the text as first opened. */
	readonly entries: readonly CanonicalText[];
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

declare const canonical: unique symbol;

/**
 * Document text in canonical form — LF line endings.
 *
 * Branded as `string &`, so reading one (rendering it, uploading it, comparing
 * it) needs no unwrapping; what the brand blocks is a raw string being STORED
 * as if it were already canonical. normalizeDoc is its only producer.
 */
export type CanonicalText = string & { readonly [canonical]: true };

/**
 * The canonical form of a document: LF line endings.
 *
 * CodeMirror normalizes line endings when it takes a document, so text read
 * back out of the view is NEVER byte-identical to a CRLF file from the board.
 * Left alone, that difference is indistinguishable from an edit: stepping back
 * to a CRLF revision and forward again made `checkpoint` see a change nobody
 * typed, truncate the forward history as a new branch, and DESTROY the newer
 * revision — observed on the real board, where sys files are CRLF and the
 * mock's are not. It would also have marked every CRLF file dirty on the first
 * tick.
 *
 * Applied at every entry point below rather than at the call sites, so no
 * caller has to know this is a problem. Saving uploads the view's text, which
 * was already LF before any of this existed — so what lands on the board is
 * unchanged.
 *
 * @invariant every-string-in-a-session-is-canonical
 * @rung 7  sole-constructor type — this is the only producer of CanonicalText,
 *          and EditSession's `baseline` and `entries` are typed as it, so a raw
 *          string cannot enter a session at all. A sixth entry point that
 *          forgets does not compile. Promoted 2026-08-02 from a rung 5 where
 *          five call sites each remembered, under a header that called it "by
 *          construction" when it was not
 * @why CodeMirror hands text back as LF whatever it was given, so a CRLF file
 *      from the board comes out of the view different from how it went in — and
 *      that difference is indistinguishable from an edit. Stepping back to a
 *      revision and forward again made checkpoint read the view's own
 *      normalization as a change, truncate the forward history as a new branch,
 *      and DESTROY the newer revision. Watched happen on duet3, where sys files
 *      are CRLF and the mock's are not: lens=[115,126] became lens=[115,111].
 *      It would also have marked every CRLF file dirty on the first tick
 */
export const normalizeDoc = (text: string): CanonicalText =>
	text.replace(/\r\n?/g, "\n") as CanonicalText;

/** Open a file for editing: one checkpoint, holding the board's copy. */
export function beginSession(path: string, baseline: string): EditSession {
	const canonical = normalizeDoc(baseline);
	return { path, baseline: canonical, entries: [canonical], at: 0 };
}

/** The text the document currently shows. */
export function currentText(session: EditSession): CanonicalText {
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
export function checkpoint(session: EditSession, rawText: string): EditSession {
	const text = normalizeDoc(rawText);
	if (text === currentText(session)) return session;
	const kept: CanonicalText[] = session.entries.slice(0, session.at + 1);
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
	return { ...checkpoint(session, text), baseline: normalizeDoc(text) };
}

/**
 * Whether the board's copy moved out from under this session — someone else
 * wrote the file, or a macro did, while a draft of it was held. The draft is
 * still the operator's work and is never discarded for this; the editor says so
 * instead, because saving would overwrite whatever arrived.
 */
export function isStale(session: EditSession, boardText: string): boolean {
	// Normalized both sides: a CRLF file is not "changed on the board" merely
	// for having come back with the line endings it always had.
	return session.baseline !== normalizeDoc(boardText);
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
 *
 * @invariant a-session-belongs-to-exactly-one-file
 * @rung 6  choke-point — readStore is the only route from storage into a
 *          session and revives EVERY entry through this, which refuses a record
 *          whose stored path disagrees with the key it was filed under. Both
 *          public readers (loadSession, and saveSession's read-modify-write) go
 *          through readStore; nothing parses the store itself
 * @why localStorage is operator-editable and the store is one record holding
 *      every file. A session restored under the wrong key puts one file's text
 *      into an editor titled with another, and this editor's Save uploads to
 *      the path in the title — so the next Save overwrites a config file with
 *      an unrelated one. It is the single failure in this module that destroys
 *      data the operator cannot get back
 * @debt the pairing is checked, not typed. Promote by keying the store with a
 *       branded path that a session carries, so "filed under a key it does not
 *       claim" has no representation rather than being rejected on read.
 */
function reviveSession(path: string, value: unknown): EditSession | null {
	if (!isPlainObject(value)) return null;
	if (value["path"] !== path) return null;
	const baseline = value["baseline"];
	if (typeof baseline !== "string") return null;
	const rawEntries = value["entries"];
	if (!Array.isArray(rawEntries)) return null;
	const all: CanonicalText[] = [];
	for (const entry of rawEntries) {
		if (typeof entry !== "string") return null;
		// Normalized on the way IN, not in the map below: the array's type is the
		// guarantee, so it may never hold a string that has not been through here.
		all.push(normalizeDoc(entry));
	}
	if (all.length === 0) return null;
	const rawAt = value["at"];
	if (typeof rawAt !== "number" || !Number.isInteger(rawAt) || rawAt < 0 || rawAt >= all.length) return null;
	// Over-length histories are trimmed from the OLD end, matching `checkpoint`,
	// and `at` moves with the window. Trimming the other end would silently
	// re-point the position at a different snapshot than the one stored.
	const dropped = Math.max(0, all.length - MAX_ENTRIES);
	// Normalized here too, so the "every string in a session is canonical"
	// invariant holds for a record that came from storage rather than a
	// constructor — the one route into a session that skips them.
	const entries = all.slice(dropped);
	return { path, baseline: normalizeDoc(baseline), entries, at: Math.max(0, rawAt - dropped) };
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
 *
 * @invariant the-draft-store-cannot-crowd-out-the-rest-of-the-app
 * @rung 6  choke-point — the only function that grows the store, and it applies
 *          BOTH caps before writing: a count cap by eviction and a byte cap by
 *          eviction, then gives up rather than exceeding either. One record for
 *          every file, deliberately, so the size can be measured where it is
 *          written; per-file keys would each be bounded and the set unbounded
 * @why localStorage gives the whole origin a few megabytes, shared with the
 *      layout canvases and the config cache. Two large config files with twenty
 *      revisions each would evict THOSE — so an unbounded draft store does not
 *      cost you drafts, it costs you your screen layouts and your saved
 *      settings, with nothing on screen connecting the two
 * @debt returning false is honest but silent about WHICH sessions were evicted
 *       to make room. Promote by folding both caps into a bounded-store type
 *       whose insert reports evictions, so a third writer cannot add a session
 *       without meeting them.
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
 *
 * @invariant saving-never-costs-you-your-history
 * @rung 6  choke-point — this is the only function that deletes a session on
 *          purpose, and it has exactly one caller in src (FileEditor's close).
 *          Nothing on the save path reaches it: markSaved does not touch the
 *          store at all, and saveSession's two eviction paths both EXCLUDE
 *          session.path by name, so writing a file cannot evict that file
 * @why the request was "flushed after you close, not after you save". A save
 *      that dropped the history would silently remove the ability to step back
 *      past it — and the operator only discovers that at the moment they need
 *      it, which is after a save went wrong
 * @debt eviction can still drop ANOTHER file's history with nothing said, so
 *       "closing is the only flush" is true of the file you are looking at and
 *       not of the store. Promote by having eviction report what it dropped, so
 *       a lost draft is observable rather than merely bounded.
 */
export function closeSession(path: string): void {
	const store = readStore();
	if (!(path in store)) return;
	delete store[path];
	writeStore(store);
}
