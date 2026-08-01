// The transport seam. Mirrors packages/ui/src/connector: one interface, two
// dialects, no caller that has to know which board it is talking to.
//
// The load-bearing rule here is that COMPRESSION IS A PROPERTY OF THE SERVING
// STACK — the server that will answer the browser — and NOT of the transport
// that put the bytes on the card. Verified 2026-07-24 on a Duet 3 + SBC: DSF's
// Kestrel neither compresses on the fly nor serves .gz transparently, so a
// gzipped DSF deploy 404s every single asset. RRF standalone is the opposite —
// it wants .gz. Pairing the wrong two is a totally broken machine UI, so the
// pairing must not be expressible.
//
// This was anchored to the TRANSPORT until 2026-07-31, which worked only
// because transport and serving stack happened to be 1:1 (rr_ dialect => RRF,
// REST => Kestrel). FTP breaks that: one protocol, either stack, decided by how
// the board is configured rather than by which client wrote the files.
// Anchoring on the stack keeps the guarantee and lets one transport serve both.

declare const compressionBrand: unique symbol

/**
 * WHICH SERVER will answer the browser's request for these assets.
 *
 * The authority on compression, because ".gz or not" is really "does this
 * server resolve foo.css.gz when asked for foo.css" — a fact about the server,
 * not about how the file arrived on the card.
 */
export type ServingStack =
	/** RRF's embedded HTTP server (standalone). Resolves .gz transparently. */
	| "rrf-embedded"
	/** DuetWebServer / Kestrel (DSF, SBC). 404s a transparent .gz fetch. */
	| "kestrel"

/**
 * Whether this deployment's payloads are gzipped.
 *
 * Branded, so it cannot be conjured from a bare boolean: the only route to a
 * value of this type is {@link compressionFor}.
 */
export type CompressionMode = {
	readonly gzip: boolean
	readonly [compressionBrand]: true
}

/**
 * @invariant compression-follows-the-server
 * @rung 8  illegal state unrepresentable — this is the one place the mapping
 *          exists, it takes no boolean, and CompressionMode's brand means
 *          "Kestrel, gzipped" is not a value any caller can construct: not by
 *          passing a wrong argument, not by building the literal, not by
 *          pairing a transport with a mode that disagrees with it. Total over
 *          ServingStack, so a third stack stops compiling until its answer is
 *          written down
 * @why compression depends on which SERVER will answer the browser, never on
 *      the transport that wrote the files. Verified on hardware 2026-07-24:
 *      DuetWebServer (Kestrel) neither compresses on the fly nor serves .gz
 *      transparently, so a gzipped deploy 404s EVERY asset — a bricked UI, from
 *      one boolean set by the wrong thing. Re-seated 2026-07-31 so one protocol
 *      (FTP) can serve either mode
 */
export function compressionFor(stack: ServingStack): CompressionMode {
	switch (stack) {
		case "rrf-embedded":
			return { gzip: true } as CompressionMode
		case "kestrel":
			return { gzip: false } as CompressionMode
		default: {
			const unhandled: never = stack
			throw new Error(`unknown serving stack: ${String(unhandled)}`)
		}
	}
}

export type FetchedResource = {
	readonly status: number
	readonly contentType: string
	readonly bytes: Uint8Array
}

export type Transport = {
	/**
	 * The stack that will SERVE what this transport writes. Compression is
	 * DERIVED from it via compressionFor rather than stored beside it — one
	 * value, so there is no second copy for it to disagree with.
	 *
	 * This replaced a `kind: "dsf" | "poll"` field that nothing ever read. Two
	 * fields both encoding "which board is this" is the duplication that makes
	 * disagreement possible in the first place.
	 */
	readonly serves: ServingStack
	/** Write a file. `boardPath` is SD-relative, e.g. `0:/www/ng.html`. */
	put(boardPath: string, bytes: Uint8Array): Promise<void>
	/** Read a file back, or null when it does not exist. */
	read(boardPath: string): Promise<Uint8Array | null>
	/** File names directly inside a board directory; empty when absent. */
	list(boardDir: string): Promise<string[]>
	/**
	 * Delete a file, or a directory when `recursive`.
	 *
	 * Both servers REFUSE to delete a non-empty directory otherwise — DSF
	 * answers HTTP 500 — so an uninstall that does not ask for recursion removes
	 * the entry document, fails on the directory, and leaves the deployment
	 * half-gone (observed on the board 2026-07-31). Pruning passes it up: an
	 * orphaned asset is a file, and a recursive delete of a file is the same
	 * delete.
	 */
	remove(boardPath: string, recursive?: boolean): Promise<void>
	/** Fetch by URL the way a browser would — this is what proves a deploy. */
	fetchUrl(urlPath: string): Promise<FetchedResource>
}
