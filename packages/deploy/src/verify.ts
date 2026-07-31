// Proving a deploy actually landed.
//
// A status check alone is worthless here, and that is not a hypothetical:
// verified 2026-07-24 on a Duet 3 + SBC board, a GET of a path that does not
// exist under the deployment returns stock DWC's index.html with HTTP 200,
// because ASP.NET's SPA fallback catches it. So a deploy that uploaded
// nothing at all would "pass" a 200 check while the machine still served the
// old UI. Everything below therefore checks CONTENT, not status.

import { entryUrl, parseEntryScript, type DeployFile, type Layout } from "./manifest.ts"
import type { Transport } from "./transport.ts"

// Re-exported, not redefined: buildManifest needs the same parse to check the
// baked-in base before uploading, and two copies of "where is the entry script"
// would be one copy too many.
export { parseEntryScript }

export type VerifyOptions = { readonly name: string; readonly layout?: Layout }

/** Content types a browser will execute as a module. */
const isJavaScript = (contentType: string): boolean =>
	/javascript|ecmascript/i.test(contentType)

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
	a.length === b.length && a.every((byte, i) => byte === b[i])

/**
 * Verify a deployment, throwing on the first failure.
 *
 * Deliberately not a boolean: a deploy that cannot prove itself is a failed
 * deploy, and the caller should not have the option of ignoring it.
 */
export async function verify(
	transport: Transport,
	manifest: readonly DeployFile[],
	opts: VerifyOptions,
): Promise<void> {
	const url = entryUrl(opts.name, opts.layout ?? "sidecar")
	const entry = manifest.find(f => f.url === url)
	if (entry === undefined) {
		throw new Error(`manifest has no entry document at ${url}`)
	}

	// 1. The entry document must be OURS, byte for byte.
	const served = await transport.fetchUrl(entry.url)
	if (served.status !== 200) {
		throw new Error(`entry ${entry.url} returned HTTP ${served.status}`)
	}
	if (!bytesEqual(served.bytes, entry.raw)) {
		throw new Error(
			`content mismatch at ${entry.url}: served ${served.bytes.length} bytes, ` +
				`deployed ${entry.raw.length}. The SPA fallback serves stock DWC with a ` +
				`200, so this is what a deploy that never landed looks like.`,
		)
	}

	// 2. The entry module must load as JavaScript. Same fallback trap: a
	//    missing asset comes back as text/html with a 200 and the browser
	//    refuses it with a MIME type error rather than anything legible.
	const src = parseEntryScript(new TextDecoder().decode(entry.raw))
	if (src !== null && src.startsWith("/")) {
		const asset = await transport.fetchUrl(src)
		if (asset.status !== 200) {
			throw new Error(`entry module ${src} returned HTTP ${asset.status}`)
		}
		if (!isJavaScript(asset.contentType)) {
			throw new Error(
				`entry module ${src} served as content-type "${asset.contentType}", ` +
					`not JavaScript — the browser will refuse to execute it`,
			)
		}

		// 3. No sourcemap may be reachable beside it.
		const map = await transport.fetchUrl(`${src}.map`)
		if (map.status === 200 && !isHtml(map.contentType)) {
			throw new Error(`sourcemap reachable at ${src}.map — it must not be deployed`)
		}
	}
}

/** The fallback answers with HTML; that is a 404 in disguise, not a real hit. */
const isHtml = (contentType: string): boolean => /text\/html/i.test(contentType)
