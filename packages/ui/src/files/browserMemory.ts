/**
 * Per-browser navigation memory: the last directory and per-directory scroll
 * offsets a file browser (Jobs/Macros/System) should restore across
 * navigations — and reloads, since it persists to localStorage like the
 * canvas layouts and config cache.
 *
 * Keyed by the browser's ROOT ("0:/gcodes" etc.), so each domain remembers
 * its own place.
 *
 * @invariant remembered-dir-untrusted
 * @rung 3  a test, plus the return type being plain `string` rather than a
 *          proven directory — the single consumer (createFileBrowser) does call
 *          dirUnderRoot, but nothing makes it
 * @why localStorage is operator-editable and survives a firmware change that
 *      moved or deleted the directory. A remembered path used as a real one
 *      lists outside the browser's root, or 404s the view into a dead end it
 *      cannot navigate out of
 * @debt return a branded `RememberedDir` that only `dirUnderRoot` can convert
 *       into the directory type createFileBrowser accepts, so a second consumer
 *       cannot use the raw string as a path — the same shape as
 *       files/path-escape, which already proves it works here.
 *
 * @invariant scroll-map-bounded
 * @rung 6  choke-point — saveBrowserScroll is the only writer of the map and
 *          evicts on every insert past MAX_SCROLL_DIRS
 * @why an appliance's browsers see few directories, but "few" should be a
 *      guarantee rather than an assumption: unbounded growth in localStorage
 *      eventually throws on write, and the catch that hides it would take the
 *      dir memory down with it
 * @debt fold the cap into a small bounded-map type so a second writer cannot
 *       add a key without eviction.
 */
import { isPlainObject, safeEntries } from "../util/safeObject.ts";

export interface BrowserMemory {
	/** The directory last shown; undefined when nothing is remembered. */
	dir: string | undefined;
	/** Scroll offset of the file list, keyed by directory. */
	scroll: Record<string, number>;
}

const keyOf = (root: string): string => `dwc-ng.browser.${root}`;

/** Tolerant read: anything missing or malformed yields empty memory. */
export function loadBrowserMemory(root: string): BrowserMemory {
	if (typeof localStorage === "undefined") return { dir: undefined, scroll: {} };
	const raw = localStorage.getItem(keyOf(root));
	if (raw === null) return { dir: undefined, scroll: {} };
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { dir: undefined, scroll: {} };
	}
	if (!isPlainObject(parsed)) return { dir: undefined, scroll: {} };
	const scroll: Record<string, number> = {};
	if (isPlainObject(parsed["scroll"])) {
		for (const [dir, value] of safeEntries(parsed["scroll"])) {
			if (typeof value === "number" && Number.isFinite(value) && value >= 0) scroll[dir] = value;
		}
	}
	return {
		dir: typeof parsed["dir"] === "string" ? parsed["dir"] : undefined,
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
