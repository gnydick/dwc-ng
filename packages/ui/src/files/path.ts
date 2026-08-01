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

/**
 * Reconstruct a REMEMBERED directory (restored from localStorage — untrusted)
 * as a proven descendant of `root`, or fall back to `root`. Every segment
 * below the root is re-parsed through `parseFileName` and re-joined through
 * `childPath`, so the result is built only from safe segments: a stored value
 * carrying "..", an absolute path, a foreign root, or any forbidden character
 * cannot point the browser outside its domain. Parse, don't validate — the
 * unchecked string never becomes a dir.
 */
export function dirUnderRoot(root: string, raw: unknown): string {
	if (typeof raw !== "string" || raw === root) return root;
	if (!raw.startsWith(`${root}/`)) return root;
	let dir = root;
	for (const segment of raw.slice(root.length + 1).split("/")) {
		const name = parseFileName(segment);
		if (name === null) return root; // any unsafe/empty segment rejects the whole path
		dir = childPath(dir, name);
	}
	return dir;
}
