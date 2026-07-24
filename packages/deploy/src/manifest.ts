// Pure: turn a built dist/ into the exact set of files that belong on the
// board, at the exact paths they belong at. No network, no side effects.

import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import type { CompressionMode } from "./transport.ts"

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
	readonly compression: CompressionMode
	/** Board directory the deployment lives in. */
	readonly wwwRoot?: string
}

/** Vite's entry document. Everything else is an asset. */
const ENTRY = "index.html"

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
	const wwwRoot = opts.wwwRoot ?? "0:/www"
	const relPaths = (await walk(distDir)).filter(p => !isSourcemap(p))

	const files = relPaths.map((rel): DeployFile => {
		const urlPath = rel === ENTRY ? `/${opts.name}.html` : `/${opts.name}/${rel}`
		const suffix = opts.compression.gzip ? ".gz" : ""
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
			return { ...f, raw, bytes: opts.compression.gzip ? new Uint8Array(gzipSync(raw)) : raw }
		}),
	)
}

/** The entry document's board path, for verification. */
export const entryUrl = (name: string): string => `/${name}.html`
