// DSF / SBC transport. Verified against duet3.nydick.net 2026-07-24.
//
// Note on compression: this transport mints `gzip: false` and there is no way
// to talk it out of that. Kestrel returns 404 for a transparent .gz fetch.

import { mintCompression, type FetchedResource, type Transport } from "./transport.ts"

const filesEndpoint = (base: string, boardPath: string): string =>
	`${base.replace(/\/$/, "")}/machine/file/${encodeURIComponent(boardPath)}`

export function dsfTransport(baseUrl: string): Transport {
	const base = baseUrl.replace(/\/$/, "")
	return {
		kind: "dsf",
		compression: mintCompression(false),

		async put(boardPath, bytes) {
			const res = await fetch(filesEndpoint(base, boardPath), {
				method: "PUT",
				body: bytes,
				headers: { "Content-Type": "application/octet-stream" },
			})
			if (!res.ok) throw new Error(`PUT ${boardPath} failed: HTTP ${res.status}`)
		},

		async read(boardPath) {
			const res = await fetch(filesEndpoint(base, boardPath))
			if (res.status === 404) return null
			if (!res.ok) throw new Error(`GET ${boardPath} failed: HTTP ${res.status}`)
			return new Uint8Array(await res.arrayBuffer())
		},

		async list(boardDir) {
			const res = await fetch(`${base}/machine/directory/${encodeURIComponent(boardDir)}`)
			if (!res.ok) return []
			const entries = (await res.json()) as Array<{ type?: string; name?: string }>
			return entries.filter(e => e.type === "f" && typeof e.name === "string").map(e => e.name as string)
		},

		async remove(boardPath) {
			const res = await fetch(filesEndpoint(base, boardPath), { method: "DELETE" })
			// 404 means already gone, which is the state we wanted anyway.
			if (!res.ok && res.status !== 404) {
				throw new Error(`DELETE ${boardPath} failed: HTTP ${res.status}`)
			}
		},

		async fetchUrl(urlPath): Promise<FetchedResource> {
			const res = await fetch(`${base}${urlPath}`)
			return {
				status: res.status,
				contentType: res.headers.get("content-type") ?? "",
				bytes: new Uint8Array(await res.arrayBuffer()),
			}
		},
	}
}
