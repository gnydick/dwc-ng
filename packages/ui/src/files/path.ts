/**
 * The only place a file path is built from user input.
 *
 * The invariant: a name the operator typed can never reach outside the
 * directory it was typed into. This is enforced by construction rather than by
 * checking at each call site — `childPath` accepts only a `FileName`, and the
 * sole way to obtain a `FileName` is `parseFileName`, which returns null for
 * anything that could escape. A caller cannot forget the check, because
 * skipping it leaves them holding a `string`, which `childPath` will not take.
 *
 * (Parse, don't validate: the unchecked value stops existing at the boundary.)
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
 * Rebuild a REMEMBERED path (restored from localStorage — untrusted) as a
 * proven descendant of `root`, or null if it cannot be one. Every segment below
 * the root is re-parsed through `parseFileName` and re-joined through
 * `childPath`, so the result is built only from safe segments: a stored value
 * carrying "..", an absolute path, a foreign root, or any forbidden character
 * cannot point outside its domain. Parse, don't validate — the unchecked string
 * never becomes a path.
 *
 * The ONE segment walk behind both public forms below. They differ only in what
 * an unusable value means — a directory falls back to the root, an open file
 * falls back to nothing — and that is the only thing either is allowed to add.
 * Two copies of this loop would be two chances to get traversal wrong.
 */
function pathUnderRoot(root: string, raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	if (raw === root) return root;
	if (!raw.startsWith(`${root}/`)) return null;
	let path = root;
	for (const segment of raw.slice(root.length + 1).split("/")) {
		const name = parseFileName(segment);
		if (name === null) return null; // any unsafe/empty segment rejects the whole path
		path = childPath(path, name);
	}
	return path;
}

/**
 * A remembered DIRECTORY, or `root` when the stored value is unusable. The
 * browser always has a directory to show, so there is no "no directory" state
 * to represent.
 */
export function dirUnderRoot(root: string, raw: unknown): string {
	return pathUnderRoot(root, raw) ?? root;
}

/**
 * A remembered open FILE, or null when the stored value is unusable — "nothing
 * is open" is a real state here, so this cannot fall back the way a directory
 * does. The root itself is rejected: it is a directory, and an editor holding a
 * directory is not a state that exists.
 */
export function fileUnderRoot(root: string, raw: unknown): string | null {
	const path = pathUnderRoot(root, raw);
	return path === null || path === root ? null : path;
}
