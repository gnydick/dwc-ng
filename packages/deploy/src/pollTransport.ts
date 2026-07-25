// Standalone RRF transport, speaking the rr_ dialect.
//
// This one mints `gzip: true`: RRF's embedded server serves .gz transparently,
// and its requests are expensive enough that shipping compressed matters.

import { crc32Hex } from "./crc32.ts"
import { mintCompression, type FetchedResource, type Transport } from "./transport.ts"

export function pollTransport(baseUrl: string): Transport {
	const base = baseUrl.replace(/\/$/, "")
	return {
		kind: "poll",
		compression: mintCompression(true),

		async put(boardPath, bytes) {
			const url = `${base}/rr_upload?name=${encodeURIComponent(boardPath)}&crc32=${crc32Hex(bytes)}`
			const res = await fetch(url, {
				method: "POST",
				body: bytes,
				headers: { "Content-Type": "application/octet-stream" },
			})
			if (!res.ok) throw new Error(`rr_upload ${boardPath} failed: HTTP ${res.status}`)
			// RRF reports upload failure in the body, not the status line.
			const body = (await res.json()) as { err?: number }
			if (body.err !== 0) throw new Error(`rr_upload ${boardPath} rejected: err=${body.err}`)
		},

		async read(boardPath) {
			const res = await fetch(`${base}/rr_download?name=${encodeURIComponent(boardPath)}`)
			if (res.status === 404) return null
			if (!res.ok) throw new Error(`rr_download ${boardPath} failed: HTTP ${res.status}`)
			return new Uint8Array(await res.arrayBuffer())
		},

		async list(boardDir) {
			// rr_filelist paginates via "next"; 0 means the listing is complete.
			const names: string[] = []
			let first = 0
			for (;;) {
				const res = await fetch(`${base}/rr_filelist?dir=${encodeURIComponent(boardDir)}&first=${first}`)
				if (!res.ok) return names
				const body = (await res.json()) as { files?: Array<{ type?: string; name?: string }>; next?: number }
				for (const f of body.files ?? []) {
					if (f.type === "f" && typeof f.name === "string") names.push(f.name)
				}
				const next = body.next ?? 0
				if (next === 0) return names
				first = next
			}
		},

		async remove(boardPath) {
			const res = await fetch(`${base}/rr_delete?name=${encodeURIComponent(boardPath)}`)
			if (!res.ok && res.status !== 404) {
				throw new Error(`rr_delete ${boardPath} failed: HTTP ${res.status}`)
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
