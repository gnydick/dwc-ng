// pnpm ship --target http://duet3.local [--mode dsf|poll] [--name ng]
//             [--dist ../ui/dist] [--dry-run] [--uninstall]

import { fileURLToPath, pathToFileURL } from "node:url"
import { dirname, resolve } from "node:path"
import { deploy, uninstall } from "./deploy.ts"
import { dsfTransport } from "./dsfTransport.ts"
import { pollTransport } from "./pollTransport.ts"
import type { Transport } from "./transport.ts"

export type CliArgs = {
	readonly target: string
	readonly mode: "dsf" | "poll"
	readonly name: string
	readonly dist: string
	readonly dryRun: boolean
	readonly uninstall: boolean
}

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_DIST = resolve(HERE, "..", "..", "ui", "dist")

export function parseArgs(argv: readonly string[]): CliArgs {
	const flag = (name: string): string | undefined => {
		const i = argv.indexOf(`--${name}`)
		return i === -1 ? undefined : argv[i + 1]
	}
	const has = (name: string): boolean => argv.includes(`--${name}`)

	const target = flag("target")
	if (target === undefined || target === "") {
		throw new Error("--target is required, e.g. --target http://duet3.local")
	}

	const mode = flag("mode") ?? "dsf"
	if (mode !== "dsf" && mode !== "poll") {
		throw new Error(`--mode must be "dsf" or "poll", got "${mode}"`)
	}

	return {
		target,
		mode,
		name: flag("name") ?? "ng",
		dist: flag("dist") ?? DEFAULT_DIST,
		dryRun: has("dry-run"),
		uninstall: has("uninstall"),
	}
}

const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`

/**
 * The entry module's content hash, from the deployed file list.
 *
 * The SAME string the running app shows in its rail footer — it reads the hash
 * off this very filename at runtime (packages/ui/src/shell/buildId.ts), so the
 * two cannot drift: there is one identity, computed once by the bundler, and
 * both ends quote it. A tab showing a different hash is running different
 * code, which is otherwise indistinguishable from a deploy that did not work.
 *
 * Deliberately not a build timestamp. That records when the build RAN, so two
 * builds of identical code disagree and a rebuild of unchanged code looks new
 * — it cannot answer "are these the same code", which is the only question.
 */
export function entryHash(boardPaths: readonly string[]): string | null {
	for (const path of boardPaths) {
		const match = /\/assets\/index-([A-Za-z0-9_-]{6,})\.js$/.exec(path)
		if (match) return match[1] ?? null
	}
	return null
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2))
	const transport: Transport =
		args.mode === "dsf" ? dsfTransport(args.target) : pollTransport(args.target)

	if (args.uninstall) {
		await uninstall(transport, { name: args.name })
		console.log(`removed ${args.name}.html and ${args.name}/ from ${args.target}`)
		return
	}

	console.log(
		`${args.dryRun ? "dry run" : "deploying"} ${args.dist}\n` +
			`  -> ${args.target}  (${args.mode}, ` +
			`${transport.compression.gzip ? "gzipped" : "plain"})`,
	)

	const result = await deploy(args.dist, transport, {
		name: args.name,
		dryRun: args.dryRun,
		onProgress: (file, action) => {
			if (action === "upload") console.log(`  + ${file.url} (${kb(file.bytes.length)})`)
		},
	})

	console.log(
		`\n${args.dryRun ? "would upload" : "uploaded"} ${result.uploaded.length} file(s), ` +
			`${kb(result.bytes)}; skipped ${result.skipped.length} unchanged`,
	)
	if (!args.dryRun) {
		console.log(`verified: ${args.target}/${args.name}.html serves the deployed bytes`)
		// The board caches the entry document. DuetWebServer sends
		// `cache-control: public,max-age=3600,must-revalidate` for it, and
		// must-revalidate only bites once the hour is up — so for an hour after
		// a deploy an already-open tab keeps its old <script src>, and the old
		// hashed assets are still in ITS cache even though they have been pruned
		// from the board. The deploy verifies the BOARD; only the browser can
		// clear the browser. Observed 2026-07-29: dev showed a fix, the printer
		// did not, and the deployed bytes were correct the whole time.
		// The entry module's content hash — the same string the running app
		// shows in its rail footer, because it reads it off this very filename.
		// A tab showing a different one is running different code, which is
		// otherwise indistinguishable from a deploy that did not work.
		const entry = entryHash(result.uploaded.concat(result.skipped))
		if (entry !== null) console.log(`build: ${entry}  (shown in the app's rail footer)`)
		console.log(`note: an already-open tab may hold ${args.name}.html for up to an hour — hard-reload it`)
	}
}

// Run only when invoked directly. Hand-rolling this comparison gets Windows
// wrong (file://N:/… vs file:///N:/…) — pathToFileURL is the one that agrees
// with import.meta.url on every platform.
const invokedDirectly =
	process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url

if (invokedDirectly) {
	main().catch((err: unknown) => {
		console.error(`deploy failed: ${err instanceof Error ? err.message : String(err)}`)
		process.exitCode = 1
	})
}

export { main }
