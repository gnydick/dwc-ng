/**
 * Which build this bundle IS — a content hash, not a timestamp.
 *
 * A Duet board serves the entry document with
 * `cache-control: public,max-age=3600,must-revalidate`, so for an hour after a
 * deploy an already-open tab keeps its old `<script src>` — and the hashed
 * assets it names are still in that browser's cache even after the deploy has
 * pruned them from the board. The result is a tab quietly running an older
 * bundle while every other signal says the deploy succeeded, and the same code
 * appearing to behave differently in two places. So the running app says which
 * build it is, in the rail footer.
 *
 * The value is the ENTRY MODULE'S CONTENT HASH, read out of its own filename.
 * A build stamp was the obvious first idea and it is the wrong one: it records
 * when the build ran, so two builds of identical code disagree and a rebuild
 * of unchanged code looks new. Neither tells you whether two tabs are running
 * the same code, which is the only question this exists to answer.
 *
 * Vite already computes exactly the right thing — the hash it puts in the
 * filename is over the emitted content — so this reads that back rather than
 * inventing a second identity that could drift from it. Nothing to plumb
 * through the build, and it cannot be stale: it is the name of the file the
 * browser actually executed.
 */

/** `/ng/assets/index-DUTmpm5G.js` -> `DUTmpm5G`. */
export function hashFromEntrySrc(src: string): string | null {
	// Vite's pattern is <name>-<hash>.js; take the last dash-group before .js.
	const match = /-([A-Za-z0-9_-]{6,})\.js(?:\?.*)?$/.exec(src);
	return match?.[1] ?? null;
}

function readBuildId(): string {
	if (typeof document === "undefined") return "dev";
	// The module script the page actually loaded. In dev this is /src/main.tsx
	// (unhashed, because there is no bundle yet) and the fallback applies.
	for (const el of document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')) {
		const hash = hashFromEntrySrc(el.src);
		if (hash !== null) return hash;
	}
	return "dev";
}

export const BUILD_ID: string = readBuildId();
