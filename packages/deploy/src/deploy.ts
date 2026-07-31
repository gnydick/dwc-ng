// Orchestration: manifest -> idempotent upload -> proof.
//
// deploy() hands buildManifest the STACK its transport declares it serves, and
// the manifest derives compression from that. There is no compression parameter
// anywhere on the route, so there is no call site at which the bytes written and
// the server that must read them can disagree.

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
	/** Orphans from earlier builds, deleted (or that would be, on a dry run). */
	readonly pruned: string[]
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
		serves: transport.serves,
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

	// Converge, don't just accumulate. Asset names are content-hashed, so every
	// build produces NEW names and the previous build's files are orphaned the
	// moment they stop being referenced. Uploading-and-skipping alone is
	// idempotent but never subtractive: measured on the real board 2026-07-24,
	// four deploys had left 34 orphans totalling 4 MB — including THREE copies
	// of Babylon at 957 KB each — on an SD card that also has to hold G-code.
	//
	// Only the deployment's own asset directory is swept: a name not in this
	// manifest is by definition from an older build of it. Nothing outside is
	// touched, so stock DWC is never at risk.
	const wwwRoot = opts.wwwRoot ?? "0:/www"
	const assetDir = `${wwwRoot}/${opts.name}/assets`
	const keep = new Set(
		manifest.filter(f => f.board.startsWith(`${assetDir}/`)).map(f => f.board.slice(assetDir.length + 1)),
	)
	const pruned: string[] = []
	for (const name of await transport.list(assetDir)) {
		if (keep.has(name)) continue
		pruned.push(`${assetDir}/${name}`)
		if (!opts.dryRun) await transport.remove(`${assetDir}/${name}`)
	}

	if (!opts.dryRun && opts.skipVerify !== true) {
		await verify(transport, manifest, { name: opts.name })
	}

	return { uploaded, skipped, pruned, bytes }
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
