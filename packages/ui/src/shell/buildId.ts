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
 * The stamp is TWO values, because there are two questions. The commit SHA
 * says which source this is — the one you can `git show`. The content hash says
 * whether your tab is actually running it. Neither substitutes for the other:
 * a hash maps back to no commit, and a commit does not tell you what a stale
 * tab is executing.
 *
 * The second value is the ENTRY MODULE'S CONTENT HASH, read out of its filename.
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

/**
 * WHICH SOURCE the bundle was built from — the short commit SHA, `-dirty` when
 * the tree had uncommitted tracked changes, `nogit` when it could not be read.
 * Substituted at build time by vite's `define` (see vite.config.ts).
 *
 * This is the half the content hash cannot supply. A hash tells you two tabs
 * agree; it does not tell you WHAT they agree on, and there is no way back from
 * a hash to a commit you can read. The old fallback said "dev", which named
 * nothing at all.
 *
 * Read from a `<meta name="dwc-commit">` that vite injects per request, NOT
 * from a build-time `define`. A define is evaluated once when the dev server
 * boots: the stamp then froze at whatever the tree looked like at that moment
 * and kept asserting it for the rest of the session, so a dev page confidently
 * named a commit it was not running. Per-request means a reload re-reads git.
 *
 * "nogit" when the tag is absent — under node:test there is no document, and a
 * page served without the plugin has nothing to report. Better a marker that
 * names nothing than a SHA that names the wrong thing.
 */
export function commitFromMeta(doc: Pick<Document, "querySelector"> | undefined): string {
	if (doc === undefined) return "nogit";
	const content = doc.querySelector<HTMLMetaElement>('meta[name="dwc-commit"]')?.content;
	return content === undefined || content === "" ? "nogit" : content;
}

export const GIT_COMMIT: string =
	commitFromMeta(typeof document === "undefined" ? undefined : document);

/** The entry module's content hash, or null when there is no bundle (dev). */
function readContentHash(): string | null {
	if (typeof document === "undefined") return null;
	// The module script the page actually loaded. In dev this is /src/main.tsx —
	// unhashed, because there is no bundle yet.
	for (const el of document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')) {
		const hash = hashFromEntrySrc(el.src);
		if (hash !== null) return hash;
	}
	return null;
}

/**
 * Both identities, because they answer different questions: the commit says
 * what the code IS, the content hash says whether your tab is running it. In
 * dev there is no bundle and so no second half.
 */
export function buildStamp(commit: string, contentHash: string | null): string {
	return contentHash === null ? commit : `${commit} · ${contentHash}`;
}

export const CONTENT_HASH: string | null = readContentHash();

export const BUILD_ID: string = buildStamp(GIT_COMMIT, CONTENT_HASH);
