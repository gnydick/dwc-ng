/**
 * A declaration's namespace is DERIVED from where it lives, never written by
 * the author — so a namespace that disagrees with the file's location has no
 * encoding. Moving a file renames its ids, which shows up as a visible diff in
 * the generated register rather than a silent mismatch.
 *
 * Rule: strip `packages/<pkg>/`, strip a leading `src/`, then join the
 * remaining directory segments. Nothing left means the package name itself.
 */
export function namespaceOf(repoRelPath: string): string {
	const parts = repoRelPath.split("/");
	if (parts[0] !== "packages" || parts.length < 3) {
		throw new Error(`${repoRelPath} is not under packages/<pkg>/`);
	}
	const pkg = parts[1]!; // length >= 3 proves index 1 exists
	let rest = parts.slice(2);
	if (rest[0] === "src") rest = rest.slice(1);
	const dir = rest.slice(0, -1); // drop the filename
	return dir.length === 0 ? pkg : dir.join("/");
}
