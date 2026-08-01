/**
 * Per-browser navigation memory: the last directory and per-directory scroll
 * offsets a file browser (Jobs/Macros/System) should restore across
 * navigations — and reloads, since it persists to localStorage like the
 * canvas layouts and config cache.
 *
 * Keyed by the browser's ROOT ("0:/gcodes" etc.), so each domain remembers
 * its own place. The stored directory is UNTRUSTED on the way back in — a
 * consumer must re-validate it against the root (files/path.ts dirUnderRoot)
 * before using it as a real directory; this module only stores and returns
 * strings.
 */
import { isPlainObject, safeEntries } from "../util/safeObject.ts";

export interface BrowserMemory {
	/** The directory last shown; undefined when nothing is remembered. */
	dir: string | undefined;
	/**
	 * The file left open in this domain's editor; undefined when none was.
	 * Restoring it is what lets you leave a screen mid-edit and come back to
	 * the file still loaded. Untrusted on the way back in like `dir` — a
	 * consumer re-proves it with files/path.ts `fileUnderRoot`.
	 */
	file: string | undefined;
	/** Scroll offset of the file list, keyed by directory. */
	scroll: Record<string, number>;
}

const keyOf = (root: string): string => `dwc-ng.browser.${root}`;

/** Remembering nothing, in one place — so a field added above cannot be
 *  omitted from one of the several ways a read gives up. */
const empty = (): BrowserMemory => ({ dir: undefined, file: undefined, scroll: {} });

/** Tolerant read: anything missing or malformed yields empty memory. */
export function loadBrowserMemory(root: string): BrowserMemory {
	if (typeof localStorage === "undefined") return empty();
	const raw = localStorage.getItem(keyOf(root));
	if (raw === null) return empty();
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return empty();
	}
	if (!isPlainObject(parsed)) return empty();
	const scroll: Record<string, number> = {};
	if (isPlainObject(parsed["scroll"])) {
		for (const [dir, value] of safeEntries(parsed["scroll"])) {
			if (typeof value === "number" && Number.isFinite(value) && value >= 0) scroll[dir] = value;
		}
	}
	return {
		dir: typeof parsed["dir"] === "string" ? parsed["dir"] : undefined,
		file: typeof parsed["file"] === "string" ? parsed["file"] : undefined,
		scroll,
	};
}

function write(root: string, memory: BrowserMemory): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(keyOf(root), JSON.stringify(memory));
	} catch {
		// Private mode / quota: navigation memory just won't persist.
	}
}

export function saveBrowserDir(root: string, dir: string): void {
	const memory = loadBrowserMemory(root);
	if (memory.dir === dir) return;
	memory.dir = dir;
	write(root, memory);
}

/**
 * Remember (or forget, with null) the file open in this domain's editor.
 *
 * Closing has to be storable, which is why this takes null rather than only a
 * path: "no file is open" is a state the operator can reach on purpose, and a
 * setter that could only record a file would leave a closed editor reopening
 * itself on the next visit.
 */
export function saveBrowserFile(root: string, file: string | null): void {
	const memory = loadBrowserMemory(root);
	const next = file ?? undefined;
	if (memory.file === next) return;
	memory.file = next;
	write(root, memory);
}

/**
 * Cap the scroll map so it can't grow without bound as directories are
 * visited over a long session — an appliance's browsers see few directories,
 * but "few" should be a guarantee, not an assumption.
 */
const MAX_SCROLL_DIRS = 40;

export function saveBrowserScroll(root: string, dir: string, top: number): void {
	const memory = loadBrowserMemory(root);
	if (memory.scroll[dir] === top) return;
	const keys = Object.keys(memory.scroll);
	if (keys.length >= MAX_SCROLL_DIRS && !(dir in memory.scroll)) {
		delete memory.scroll[keys[0]!]; // drop the oldest insertion
	}
	memory.scroll[dir] = top;
	write(root, memory);
}
