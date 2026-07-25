// The transport seam. Mirrors packages/ui/src/connector: one interface, two
// dialects, no caller that has to know which board it is talking to.
//
// The load-bearing rule here is that COMPRESSION IS A PROPERTY OF THE
// TRANSPORT, not an argument travelling alongside it. Verified 2026-07-24 on
// a Duet 3 + SBC: DSF's Kestrel neither compresses on the fly nor serves
// .gz transparently, so a gzipped DSF deploy 404s every single asset. RRF
// standalone is the opposite — it wants .gz. Pairing the wrong two is a
// totally broken machine UI, so the pairing must not be expressible.

declare const compressionBrand: unique symbol

/**
 * Whether this deployment's payloads are gzipped.
 *
 * Only {@link mintCompression} can produce one, and only the transport
 * factories call it — so a caller cannot hand `buildManifest` a compression
 * mode that disagrees with the transport actually doing the upload.
 */
export type CompressionMode = {
	readonly gzip: boolean
	readonly [compressionBrand]: true
}

/** The single mint. Transport factories only — never call this from a caller. */
export function mintCompression(gzip: boolean): CompressionMode {
	return { gzip } as CompressionMode
}

export type FetchedResource = {
	readonly status: number
	readonly contentType: string
	readonly bytes: Uint8Array
}

export type Transport = {
	readonly kind: "dsf" | "poll"
	readonly compression: CompressionMode
	/** Write a file. `boardPath` is SD-relative, e.g. `0:/www/ng.html`. */
	put(boardPath: string, bytes: Uint8Array): Promise<void>
	/** Read a file back, or null when it does not exist. */
	read(boardPath: string): Promise<Uint8Array | null>
	/** File names directly inside a board directory; empty when absent. */
	list(boardDir: string): Promise<string[]>
	remove(boardPath: string): Promise<void>
	/** Fetch by URL the way a browser would — this is what proves a deploy. */
	fetchUrl(urlPath: string): Promise<FetchedResource>
}
