// An in-memory board. Models the two behaviours that actually bit us on real
// hardware: the SPA fallback answering unknown paths with someone else's
// index.html and a 200, and content-type dispatch by file extension.

import { gunzipSync } from "node:zlib"
import { type FetchedResource, type ServingStack, type Transport } from "../src/transport.ts"

export const DWC_FALLBACK = new TextEncoder().encode(
	"<!doctype html><html lang=\"en\"><head><title>Duet Web Control</title></head></html>",
)

export type FakeOptions = {
	/** Which server this fake stands in for. Defaults to Kestrel (plain). */
	readonly serves?: ServingStack
	/** Serve stock DWC with a 200 for anything not deployed. */
	readonly spaFallback?: boolean
	/** Serve every asset as text/html — the MIME trap. */
	readonly htmlForEverything?: boolean
	readonly wwwRoot?: string
}

const contentTypeFor = (urlPath: string): string => {
	if (urlPath.endsWith(".js")) return "text/javascript"
	if (urlPath.endsWith(".css")) return "text/css"
	if (urlPath.endsWith(".map")) return "application/json"
	if (urlPath.endsWith(".html")) return "text/html"
	return "application/octet-stream"
}

export type FakeTransport = Transport & {
	readonly files: Map<string, Uint8Array>
	readonly putCount: () => number
}

export function fakeTransport(opts: FakeOptions = {}): FakeTransport {
	const files = new Map<string, Uint8Array>()
	const wwwRoot = opts.wwwRoot ?? "0:/www"
	let puts = 0

	return {
		serves: opts.serves ?? "kestrel",
		files,
		putCount: () => puts,

		put(boardPath, bytes) {
			puts++
			files.set(boardPath, bytes)
			return Promise.resolve()
		},
		read(boardPath) {
			return Promise.resolve(files.get(boardPath) ?? null)
		},
		list(boardDir) {
			const prefix = `${boardDir}/`
			const names = [...files.keys()]
				.filter(k => k.startsWith(prefix) && !k.slice(prefix.length).includes("/"))
				.map(k => k.slice(prefix.length))
			return Promise.resolve(names)
		},
		remove(boardPath) {
			files.delete(boardPath)
			for (const key of [...files.keys()]) {
				if (key.startsWith(`${boardPath}/`)) files.delete(key)
			}
			return Promise.resolve()
		},
		fetchUrl(urlPath): Promise<FetchedResource> {
			// RRF stores foo.js.gz and serves it at /foo.js with
			// Content-Encoding: gzip, so fetch() hands the caller the
			// DECOMPRESSED bytes. Model that, or verification would be
			// comparing compressed bytes against source and always fail.
			const plain = files.get(`${wwwRoot}${urlPath}`)
			const packed = files.get(`${wwwRoot}${urlPath}.gz`)
			const stored = plain ?? (packed === undefined ? undefined : new Uint8Array(gunzipSync(packed)))
			if (stored === undefined) {
				return Promise.resolve(
					opts.spaFallback === true
						? { status: 200, contentType: "text/html", bytes: DWC_FALLBACK }
						: { status: 404, contentType: "", bytes: new Uint8Array() },
				)
			}
			return Promise.resolve({
				status: 200,
				contentType: opts.htmlForEverything === true ? "text/html" : contentTypeFor(urlPath),
				bytes: stored,
			})
		},
	}
}
