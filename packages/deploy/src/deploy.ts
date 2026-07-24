// Orchestration: manifest -> idempotent upload -> proof.
//
// deploy() takes a Transport and reads its compression mode. There is no
// compression parameter, so there is no call site at which the mode and the
// dialect can disagree.

import { buildManifest, type DeployFile } from "./manifest.ts"
import type { Transport } from "./transport.ts"
import { verify } from "./verify.ts"

export type DeployOptions = {
	readonly name: string
	/** Report what would happen; write nothing. */
	readonly dryRun?: boolean
	/** Skip the post-deploy proof. Only for dry runs and tests. */
	readonly skipVerify?: boolean
	readonly wwwRoot?: string
	readonly onProgress?: (file: DeployFile, action: "upload" | "skip") => void
}

export type DeployResult = {
	readonly uploaded: string[]
	readonly skipped: string[]
	readonly bytes: number
}

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
	a.length === b.length && a.every((byte, i) => byte === b[i])

export async function deploy(
	distDir: string,
	transport: Transport,
	opts: DeployOptions,
): Promise<DeployResult> {
	const manifest = await buildManifest(distDir, {
		name: opts.name,
		compression: transport.compression,
		...(opts.wwwRoot === undefined ? {} : { wwwRoot: opts.wwwRoot }),
	})

	const uploaded: string[] = []
	const skipped: string[] = []
	let bytes = 0

	for (const file of manifest) {
		// Idempotence: an unchanged file is not worth a request. This matters
		// far more on standalone, where requests are expensive and connections
		// scarce, but it is one code path for both dialects.
		const existing = opts.dryRun ? null : await transport.read(file.board)
		if (existing !== null && bytesEqual(existing, file.bytes)) {
			skipped.push(file.board)
			opts.onProgress?.(file, "skip")
			continue
		}

		if (!opts.dryRun) await transport.put(file.board, file.bytes)
		uploaded.push(file.board)
		bytes += file.bytes.length
		opts.onProgress?.(file, "upload")
	}

	if (!opts.dryRun && opts.skipVerify !== true) {
		await verify(transport, manifest, { name: opts.name })
	}

	return { uploaded, skipped, bytes }
}

/** Remove a deployment: the entry document and everything under its directory. */
export async function uninstall(
	transport: Transport,
	opts: { readonly name: string; readonly wwwRoot?: string },
): Promise<void> {
	const wwwRoot = opts.wwwRoot ?? "0:/www"
	await transport.remove(`${wwwRoot}/${opts.name}.html`)
	await transport.remove(`${wwwRoot}/${opts.name}`)
}
