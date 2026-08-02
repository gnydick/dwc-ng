import type { OwnedPath } from "./transport.ts"

// Pure: turn a built dist/ into the exact set of files that belong on the
// board, at the exact paths they belong at. No network, no side effects.

import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import { compressionFor, type ServingStack } from "./transport.ts"

export type DeployFile = {
	/** Absolute path on disk. */
	readonly local: string
	/** Absolute path on the board, e.g. `0:/www/ng/assets/index-abc.js`. */
	readonly board: string
	/** The URL a browser reaches it at, e.g. `/ng/assets/index-abc.js`. */
	readonly url: string
	/** Exactly what gets uploaded — gzipped when the transport says so. */
	readonly bytes: Uint8Array
	/**
	 * The original, uncompressed content. Verification compares against this,
	 * not against `bytes`: RRF serves .gz with `Content-Encoding: gzip`, so a
	 * browser (and `fetch`) sees the decompressed form on the way back.
	 */
	readonly raw: Uint8Array
}

export type ManifestOptions = {
	/** Entry becomes `<name>.html`; everything else nests under `<name>/`. */
	readonly name: string
	/**
	 * The server that will serve these files. Compression is derived from it
	 * here, rather than accepted as a mode alongside it: a caller holding both a
	 * stack and a CompressionMode could hand over two that disagree, and this is
	 * the function that decides whether bytes get a .gz suffix and a gzip pass.
	 * Naming the stack is the only thing anyone can say.
	 */
	readonly serves: ServingStack
	/** Board directory the deployment lives in. Defaults per layout. */
	readonly wwwRoot?: string
	readonly layout?: Layout
}

/**
 * WHERE a deployment sits relative to the server's document root.
 *
 * - `sidecar` — inside stock DWC's root, as `<root>/<name>.html` plus
 *   `<root>/<name>/…`. Both UIs are served at once. The entry cannot be
 *   `<name>/index.html`, because Kestrel has no `UseDefaultFiles()` for
 *   subdirectories and `/ng/` falls through to the SPA fallback and serves
 *   stock DWC (verified on hardware 2026-07-24). An extensioned path dodges it.
 *
 * - `root` — the deployment IS the document root, reached by pointing the
 *   server at it with `M505.1 P"0:/ng"`. The fallback is no longer in the way,
 *   so the entry is a plain `index.html` and assets keep their natural paths.
 *   Stock DWC stays on the card at `0:/www`, just unserved; reverting is
 *   `M505.1 P"0:/www"` and nothing else.
 *
 * Note M505.1 is documented as temporary and development-only, which is why
 * `sidecar` remains supported rather than deleted.
 */
export type Layout = "root" | "sidecar"

/** Vite's entry document. Everything else is an asset. */
const ENTRY = "index.html"

/** Where a layout's deployment lives when the caller does not say. */
const defaultWwwRoot = (layout: Layout): string => (layout === "root" ? "0:/ng" : "0:/www")

/** The URL prefix Vite baked into the asset paths, given a layout. */
const expectedBase = (layout: Layout, name: string): string =>
	layout === "root" ? "/" : `/${name}/`

/** Pull the entry module's src out of the built index.html. */
export function parseEntryScript(html: string): string | null {
	const match = /<script[^>]*\bsrc="([^"]+)"/i.exec(html)
	return match?.[1] ?? null
}

/**
 * Refuse a dist whose baked-in base contradicts the layout it is being
 * deployed as.
 *
 * The two are set in different places — `DWC_BASE` at build time, `--layout` at
 * deploy time — and nothing used to check they agreed. A `pnpm ship` that
 * forgot the env var uploaded a deployment whose every asset URL was wrong, and
 * the first symptom was a blank page on the board with a MIME-type error in a
 * console nobody had open.
 *
 * Checked against the ONE artefact that carries the answer: the base Vite
 * actually wrote into index.html. Reading the env var here would only compare
 * an intention with itself.
 */
function assertBaseMatchesLayout(html: string, layout: Layout, name: string): void {
	const src = parseEntryScript(html)
	if (src === null || !src.startsWith("/")) return
	const want = expectedBase(layout, name)
	// Root's base is "/", which every absolute path starts with, so the test is
	// that it is NOT nested under a directory rather than a prefix match.
	const ok = layout === "root" ? !/^\/[^/]+\/assets\//.test(src) : src.startsWith(want)
	if (ok) return
	throw new Error(
		`dist was built for base "${src.replace(/assets\/.*$/, "")}" but is being deployed as ` +
			`layout "${layout}", which needs base "${want}". Rebuild with ` +
			(layout === "root" ? `DWC_BASE unset (it defaults to "/")` : `DWC_BASE=${want}`) +
			` — from PowerShell, $env:DWC_BASE='${want}'.`,
	)
}

/**
 * Sourcemaps are never deployed. Stock DWC ships 15,234,312 bytes of
 * `monaco-editor.*.js.map` to the SD card; we are not doing that.
 */
const isSourcemap = (path: string): boolean => path.endsWith(".map")

async function walk(dir: string, prefix = ""): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true })
	const out: string[] = []
	for (const entry of entries) {
		const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`
		if (entry.isDirectory()) out.push(...(await walk(join(dir, entry.name), rel)))
		else if (entry.isFile()) out.push(rel)
	}
	return out
}

/**
 * Build the deployment manifest.
 *
 * Layout is forced by a real constraint, verified 2026-07-24: Kestrel has no
 * `UseDefaultFiles()` for subdirectories, so `/<name>/` falls through to the
 * SPA fallback and serves stock DWC. An extensioned entry path bypasses it.
 */
export async function buildManifest(distDir: string, opts: ManifestOptions): Promise<DeployFile[]> {
	const layout = opts.layout ?? "sidecar"
	const wwwRoot = opts.wwwRoot ?? defaultWwwRoot(layout)
	const compression = compressionFor(opts.serves)
	const relPaths = (await walk(distDir)).filter(p => !isSourcemap(p))

	// Before anything is read, let alone uploaded.
	assertBaseMatchesLayout(await readFile(join(distDir, ENTRY), "utf8"), layout, opts.name)

	const files = relPaths.map((rel): DeployFile => {
		// Root mode needs no rewriting at all: the deployment IS the root, so
		// every file keeps the path Vite gave it, index.html included.
		const urlPath = layout === "root"
			? `/${rel}`
			: rel === ENTRY ? `/${opts.name}.html` : `/${opts.name}/${rel}`
		const suffix = compression.gzip ? ".gz" : ""
		return {
			local: join(distDir, rel),
			board: `${wwwRoot}${urlPath}${suffix}`,
			url: urlPath,
			bytes: new Uint8Array(),
			raw: new Uint8Array(),
		}
	})

	// Belt and braces: if the filter above ever stops matching, fail loudly
	// rather than quietly shipping megabytes of sourcemaps to an SD card.
	const leaked = files.filter(f => isSourcemap(f.url))
	if (leaked.length > 0) {
		throw new Error(`refusing to deploy sourcemaps: ${leaked.map(f => f.url).join(", ")}`)
	}

	return Promise.all(
		files.map(async f => {
			const raw = new Uint8Array(await readFile(f.local))
			return { ...f, raw, bytes: compression.gzip ? new Uint8Array(gzipSync(raw)) : raw }
		}),
	)
}

/** The entry document's URL, for verification. */
export const entryUrl = (name: string, layout: Layout = "sidecar"): string =>
	layout === "root" ? `/${ENTRY}` : `/${name}.html`

/**
 * The directory a redeploy sweeps for orphans — and the reason it is derived
 * here rather than spelled out at the call site: it has to be the same
 * directory buildManifest just wrote the assets into, or a prune either misses
 * the orphans or reaches outside the deployment.
 */
export const assetDir = (name: string, layout: Layout, wwwRoot?: string): string =>
	`${wwwRoot ?? defaultWwwRoot(layout)}${layout === "root" ? "" : `/${name}`}/assets`

/**
/**
 * One orphaned asset, inside the asset directory this deploy just wrote.
 *
 * A separate producer from ownedPaths on purpose: the prune's entitlement comes
 * from a DIFFERENT argument — the manifest says which files belong, and
 * anything else in that one directory is ours to remove. Naming it here is what
 * lets deploy.ts stop building the path itself.
 */
export const ownedAsset = (assetDirectory: string, fileName: string): OwnedPath =>
	`${assetDirectory}/${fileName}` as OwnedPath

/**
 * Every board path a deployment owns, for uninstall.
 *
 * @invariant uninstall-owns-only-its-own
 * @rung 7  sole-constructor type — transport.remove takes an OwnedPath, and
 *          the only two producers are this function and ownedAsset above. A
 *          hand-built string does not compile, so BOTH delete paths now carry
 *          proof of entitlement rather than one being trusted because it looks
 *          careful. Red-checked: restoring the prune's own template literal
 *          fails the build at deploy.ts:86. Promoted 2026-08-01 from rung 5,
 *          itself a correction of a rung-6 claim the prune contradicted
 * @why the board's filesystem IS the machine's configuration. Sidecar mode
 *      shares 0:/www with stock DWC, so an uninstall handed the shared root
 *      would delete the operator's working UI along with ours — and there is no
 *      undo on an SD card
 */
export const ownedPaths = (name: string, layout: Layout, wwwRoot?: string): OwnedPath[] => {
	const root = wwwRoot ?? defaultWwwRoot(layout)
	// Root mode owns its whole directory; sidecar owns exactly two entries and
	// must never be handed the root it shares with stock DWC.
	return (layout === "root" ? [root] : [`${root}/${name}.html`, `${root}/${name}`]) as OwnedPath[]
}
