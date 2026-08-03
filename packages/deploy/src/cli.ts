// pnpm ship --target http://duet3.local [--mode dsf|poll] [--name ng]
//             [--layout root|sidecar] [--www-root 0:/ng]
//             [--dist ../ui/dist] [--dry-run] [--uninstall]

import { fileURLToPath, pathToFileURL } from "node:url"
import { dirname, resolve } from "node:path"
import { deploy, uninstall } from "./deploy.ts"
import { entryUrl, type Layout } from "./manifest.ts"
import { dsfTransport } from "./dsfTransport.ts"
import { pollTransport } from "./pollTransport.ts"
import { compressionFor, type Transport } from "./transport.ts"
import { measureEager, overBudget, readEagerBudget } from "./eagerBudget.ts"

export type CliArgs = {
	readonly target: string
	readonly mode: "dsf" | "poll"
	readonly name: string
	readonly layout: Layout
	readonly wwwRoot?: string
	readonly dist: string
	readonly dryRun: boolean
	readonly uninstall: boolean
	readonly bootstrap: boolean
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

	// Root is the default: the deployment is its own document root, reached by
	// pointing the server at it once with M505.1. Sidecar stays available for a
	// board where that command is absent — it is documented as temporary.
	const layout = flag("layout") ?? "root"
	if (layout !== "root" && layout !== "sidecar") {
		throw new Error(`--layout must be "root" or "sidecar", got "${layout}"`)
	}

	const wwwRoot = flag("www-root")
	return {
		target,
		mode,
		name: flag("name") ?? "ng",
		layout,
		...(wwwRoot === undefined ? {} : { wwwRoot }),
		dist: flag("dist") ?? DEFAULT_DIST,
		dryRun: has("dry-run"),
		uninstall: has("uninstall"),
		bootstrap: has("bootstrap"),
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
		await uninstall(transport, {
			name: args.name,
			layout: args.layout,
			...(args.wwwRoot === undefined ? {} : { wwwRoot: args.wwwRoot }),
		})
		console.log(`removed the ${args.layout} deployment of ${args.name} from ${args.target}`)
		if (args.layout === "root") {
			console.log(`note: point the server back at stock DWC with  M505.1 P"0:/www"`)
		}
		return
	}

	/**
	 * The payload gate, before anything is written — and on a dry run too,
	 * because the point of a dry run is to learn what a deploy would do, and
	 * "it would exceed the payload budget" is the most useful thing it can say.
	 *
	 * Not applied to --uninstall, which returns above: removing a deployment
	 * has no payload, and blocking a removal on the size of what is being
	 * removed would be absurd.
	 */
	const eager = measureEager(args.dist)
	const overrun = overBudget(eager, readEagerBudget())
	if (overrun !== null) {
		console.error(overrun)
		process.exitCode = 1
		return
	}

	console.log(
		`${args.dryRun ? "dry run" : "deploying"} ${args.dist}\n` +
			`  -> ${args.target}  (${args.mode}, ${args.layout} layout, ` +
			`${compressionFor(transport.serves).gzip ? "gzipped" : "plain"})`,
	)

	const result = await deploy(args.dist, transport, {
		name: args.name,
		layout: args.layout,
		...(args.wwwRoot === undefined ? {} : { wwwRoot: args.wwwRoot }),
		dryRun: args.dryRun,
		// THE FIRST ROOT DEPLOY ONLY, and it is a genuine chicken-and-egg rather
		// than an escape hatch: verification asks whether the SERVER serves our
		// bytes at "/", which cannot be true until M505.1 points the root at this
		// directory — and M505.1 errors if the directory does not exist yet. So
		// the files have to land unverified exactly once. Named for the situation
		// rather than offered as a general --skip-verify, because every other
		// deploy must keep proving itself.
		skipVerify: args.bootstrap,
		onProgress: (file, action) => {
			if (action === "upload") console.log(`  + ${file.url} (${kb(file.bytes.length)})`)
		},
	})

	console.log(
		`\n${args.dryRun ? "would upload" : "uploaded"} ${result.uploaded.length} file(s), ` +
			`${kb(result.bytes)}; skipped ${result.skipped.length} unchanged`,
	)
	const entryPath = entryUrl(args.name, args.layout)
	if (args.bootstrap && !args.dryRun) {
		console.log(
			`\nNOT VERIFIED — bootstrap run. The files are on the card; nothing serves\n` +
				`them yet. Point the board at them, then deploy again to prove it:\n` +
				`  M505.1 P"${args.wwwRoot ?? "0:/ng"}"\n` +
				`  pnpm ship --target ${args.target} --mode ${args.mode}`,
		)
		return
	}
	if (!args.dryRun) {
		console.log(`verified: ${args.target}${entryPath} serves the deployed bytes`)
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
		console.log(`note: an already-open tab may hold ${entryPath} for up to an hour — hard-reload it`)
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
