/**
 * The only place a file path is built from user input.
 *
 * @invariant path-escape
 * @rung 7  sole-constructor type — `childPath` accepts only a `FileName`, and
 *          the only way to obtain one is `parseFileName`, which returns null
 *          for anything that could escape. Skipping the check leaves the caller
 *          holding a `string`, which `childPath` will not take
 * @why a name the operator typed must never reach outside the directory it was
 *      typed into. On a board whose filesystem is the machine's configuration,
 *      a traversing name overwrites config.g rather than a macro
 *
 * (Parse, don't validate: the unchecked value stops existing at the boundary.
 * A caller cannot forget the check, because there is no forgetting available.)
 */

/**
 * A single path segment, proven safe to append to a directory. The brand is
 * erased at runtime — its whole job is to make `childPath(dir, rawUserInput)`
 * a compile error.
 */
export type FileName = string & { readonly __fileName: unique symbol };

/** Characters RRF's FAT filesystem cannot store, plus both separators and the volume mark. */
const FORBIDDEN = /[/\\:*?"<>|]/;

/**
 * Turn raw operator input into a `FileName`, or null if it could not be one.
 * Surrounding whitespace is trimmed first — a trailing space is a typo, not an
 * intent, and FAT would silently drop it anyway (leaving the UI showing a name
 * the board doesn't have).
 */
export function parseFileName(raw: string): FileName | null {
	const name = raw.trim();
	if (name === "") return null;
	// "." and ".." are traversal, not names. Rejected by identity rather than by
	// scanning for "..", so a legitimate "v1..2.gcode" still passes.
	if (name === "." || name === "..") return null;
	if (FORBIDDEN.test(name)) return null;
	// Anything below U+0020 is a control character; none belong in a filename
	// and several would corrupt the rr_ query string they travel in.
	for (let i = 0; i < name.length; i++) {
		if (name.charCodeAt(i) < 0x20) return null;
	}
	// FAT drops a trailing dot, so accepting one would desynchronise the UI from
	// the board. (A leading dot is fine — ".hidden" is a real name.)
	if (name.endsWith(".")) return null;
	return name as FileName;
}

/** Join a directory to a parsed name, collapsing the separator exactly once. */
export function childPath(dir: string, name: FileName): string {
	return `${dir.endsWith("/") ? dir.slice(0, -1) : dir}/${name}`;
}

/**
 * The directory one level up, clamped at `root`. A listing is a view of one
 * domain (0:/gcodes, 0:/macros, 0:/sys); walking above its root would show
 * another domain's files inside it, so "up" from the root is a no-op rather
 * than a surprise. A path outside the domain entirely falls back to the root.
 */
export function parentDir(dir: string, root: string): string {
	if (dir === root || !dir.startsWith(root)) return root;
	const cut = dir.lastIndexOf("/");
	if (cut < 0) return root;
	const up = dir.slice(0, cut);
	return up.length < root.length ? root : up;
}

declare const remembered: unique symbol;

/**
 * A directory string as restored from storage — deliberately NOT a string.
 *
 * A branded string would be assignable anywhere a path is wanted, which is
 * precisely the mistake to prevent, so this is an opaque OBJECT: it cannot be
 * concatenated, passed to childPath, or handed to the connector. The only thing
 * that can be done with one is give it to dirUnderRoot, which is the check.
 */
export interface RememberedDir {
	readonly raw: string;
	readonly [remembered]: true;
}

/** Wrap a stored value. Untrusted by construction — that is the whole point. */
export const asRemembered = (raw: string): RememberedDir => ({ raw }) as RememberedDir;

/**
 * Reconstruct a REMEMBERED directory (restored from localStorage — untrusted)
 * as a proven descendant of `root`, or fall back to `root`. Every segment
 * below the root is re-parsed through `parseFileName` and re-joined through
 * `childPath`, so the result is built only from safe segments: a stored value
 * carrying "..", an absolute path, a foreign root, or any forbidden character
 * cannot point the browser outside its domain. Parse, don't validate — the
 * unchecked string never becomes a dir.
 *
 * @invariant remembered-dir-untrusted
 * @rung 7  sole-constructor type — BrowserMemory.dir is a RememberedDir, an
 *          opaque object rather than a branded string, so it cannot be used as
 *          a path by accident: not concatenated, not passed to childPath, not
 *          sent to the connector. This function is the only thing that accepts
 *          one, and what it returns is built segment by segment from
 *          parseFileName. Promoted from rung 3 on 2026-08-01, where it had been
 *          "the single consumer does call this, but nothing makes it"
 * @why localStorage is operator-editable and survives a firmware change that
 *      moved or deleted the directory. A remembered path used as a real one
 *      lists outside the browser's domain, or 404s the view into a dead end it
 *      cannot navigate out of — and the browser is how files get deleted
 */
export function dirUnderRoot(root: string, stored: RememberedDir | undefined): string {
	const raw = stored?.raw;
	if (raw === undefined || raw === root) return root;
	if (!raw.startsWith(`${root}/`)) return root;
	let dir = root;
	for (const segment of raw.slice(root.length + 1).split("/")) {
		const name = parseFileName(segment);
		if (name === null) return root; // any unsafe/empty segment rejects the whole path
		dir = childPath(dir, name);
	}
	return dir;
}
