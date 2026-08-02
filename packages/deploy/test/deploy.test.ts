import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildManifest, ownedAsset, ownedPaths } from "../src/manifest.ts"
import type { OwnedPath } from "../src/transport.ts"
import { deploy, uninstall } from "../src/deploy.ts"
import { verify, parseEntryScript } from "../src/verify.ts"
import { crc32, crc32Hex } from "../src/crc32.ts"
import { parseArgs } from "../src/cli.ts"
import { compressionFor, type ServingStack } from "../src/transport.ts"
import { fakeTransport } from "./fakeTransport.ts"

/** Every stack there is. Adding one here without answering for it below is the
 *  point — the A/B test then fails until the new stack's behaviour is stated. */
const ALL_STACKS: ServingStack[] = ["rrf-embedded", "kestrel"]

const ENTRY_HTML =
	'<!doctype html><html><head><script type="module" crossorigin src="/ng/assets/index-abc.js"></script></head><body><div id="app"></div></body></html>'

/** What Vite emits when built with the default base — root mode's input. */
const ROOT_ENTRY_HTML =
	'<!doctype html><html><head><script type="module" crossorigin src="/assets/index-abc.js"></script></head><body><div id="app"></div></body></html>'

/** A miniature dist/ shaped like the real one, sourcemaps included. */
async function makeDist(html: string = ENTRY_HTML): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "dwc-ng-dist-"))
	await mkdir(join(dir, "assets"), { recursive: true })
	await writeFile(join(dir, "index.html"), html)
	await writeFile(join(dir, "assets", "index-abc.js"), "export const x = 1\n")
	await writeFile(join(dir, "assets", "index-abc.js.map"), '{"version":3}')
	await writeFile(join(dir, "assets", "style.css"), ".a{color:red}")
	await writeFile(join(dir, "favicon.svg"), "<svg/>")
	return dir
}

/** A dist built with `DWC_BASE=/`, deployed as its own HTTP root. */
const rootDist = (): Promise<string> => makeDist(ROOT_ENTRY_HTML)

test("index.html becomes ng.html; everything else nests under ng/", async () => {
	const files = await buildManifest(await makeDist(), { name: "ng", serves: "kestrel" })
	assert.deepEqual(
		files.map(f => f.url).sort(),
		["/ng.html", "/ng/assets/index-abc.js", "/ng/assets/style.css", "/ng/favicon.svg"],
	)
})

test("the entry lives at 0:/www/ng.html, not inside the ng/ directory", async () => {
	// Verified on real hardware 2026-07-24: /ng/ serves stock DWC, because
	// Kestrel has no UseDefaultFiles() for subdirectories.
	const files = await buildManifest(await makeDist(), { name: "ng", serves: "kestrel" })
	const entry = files.find(f => f.url === "/ng.html")
	assert.equal(entry?.board, "0:/www/ng.html")
})

test("root layout keeps index.html as index.html, with assets beside it", async () => {
	// M505.1 P"0:/ng" makes the deployment its own HTTP root, so the SPA
	// fallback that forced the ng.html trick is no longer in the way: the
	// server's own default document does the job.
	const files = await buildManifest(await rootDist(), {
		name: "ng", serves: "kestrel", layout: "root",
	})
	assert.deepEqual(
		files.map(f => f.url).sort(),
		["/assets/index-abc.js", "/assets/style.css", "/favicon.svg", "/index.html"],
	)
})

test("root layout lives at 0:/ng, outside the directory a DWC update rewrites", async () => {
	const files = await buildManifest(await rootDist(), {
		name: "ng", serves: "kestrel", layout: "root",
	})
	assert.equal(files.find(f => f.url === "/index.html")?.board, "0:/ng/index.html")
	assert.equal(files.find(f => f.url === "/assets/style.css")?.board, "0:/ng/assets/style.css")
})

test("a dist built for /ng/ cannot be deployed as a root, and vice versa", async () => {
	// The build base and the deploy layout have to agree, and until now nothing
	// checked: `pnpm ship` without DWC_BASE produced a deployment whose every
	// asset URL was wrong, and the first sign of it was a blank page on the
	// board. Caught here, before a byte is uploaded, naming the fix.
	const sidecarBuild = await makeDist()
	const rootBuild = await rootDist()
	await assert.rejects(
		() => buildManifest(sidecarBuild, { name: "ng", serves: "kestrel", layout: "root" }),
		/DWC_BASE/,
	)
	await assert.rejects(
		() => buildManifest(rootBuild, { name: "ng", serves: "kestrel", layout: "sidecar" }),
		/DWC_BASE/,
	)
})

test("a root deploy verifies, prunes and uninstalls within 0:/ng", async () => {
	const dist = await rootDist()
	// The fake's wwwRoot is what the SERVER serves from, which is exactly what
	// M505.1 P"0:/ng" changes. Verification is therefore testing the same thing
	// the board will: that our index.html is what answers "/".
	const t = fakeTransport({ wwwRoot: "0:/ng" })
	await deploy(dist, t, { name: "ng", layout: "root" }) // throws if verification fails

	const stale = "0:/ng/assets/math.color-OLDHASH.js"
	await t.put(stale, new TextEncoder().encode("old babylon"))
	const result = await deploy(dist, t, { name: "ng", layout: "root" })
	assert.deepEqual(result.pruned, [stale])

	await uninstall(t, { name: "ng", layout: "root" })
	assert.equal(t.files.size, 0)
})

test("a root deploy leaves stock DWC's files alone", async () => {
	// Nothing is served from 0:/www while the root is 0:/ng, but the files must
	// still be THERE — reverting is M505.1 P"0:/www" and nothing else.
	const dist = await rootDist()
	const t = fakeTransport({ wwwRoot: "0:/ng" })
	await t.put("0:/www/index.html", new TextEncoder().encode("DWC"))
	await t.put("0:/www/js/app.js", new TextEncoder().encode("DWC js"))
	await deploy(dist, t, { name: "ng", layout: "root" })
	await deploy(dist, t, { name: "ng", layout: "root" })
	await uninstall(t, { name: "ng", layout: "root" })
	assert.ok(t.files.has("0:/www/index.html"), "stock DWC index was deleted")
	assert.ok(t.files.has("0:/www/js/app.js"), "stock DWC asset was deleted")
})

test("sourcemaps never reach the board", async () => {
	const files = await buildManifest(await makeDist(), { name: "ng", serves: "kestrel" })
	assert.equal(files.filter(f => f.url.endsWith(".map")).length, 0)
})

test("gzip mode appends .gz on the board and compresses the payload", async () => {
	const files = await buildManifest(await makeDist(), { name: "ng", serves: "rrf-embedded" })
	assert.ok(files.every(f => f.board.endsWith(".gz")))
	const entry = files.find(f => f.url === "/ng.html")
	assert.ok(entry !== undefined)
	assert.notDeepEqual(entry.bytes, entry.raw) // payload compressed, raw preserved
	// The URL a browser asks for must NOT carry .gz — RRF maps it internally.
	assert.equal(entry.url, "/ng.html")
})

test("a second deploy of identical output uploads nothing", async () => {
	const dist = await makeDist()
	const t = fakeTransport()
	await deploy(dist, t, { name: "ng" })
	const before = t.putCount()
	const second = await deploy(dist, t, { name: "ng" })
	assert.equal(second.uploaded.length, 0)
	assert.ok(second.skipped.length > 0)
	assert.equal(t.putCount(), before, "no PUT should be issued for unchanged files")
})

test("a dry run writes nothing but still reports the work", async () => {
	const dist = await makeDist()
	const t = fakeTransport()
	const result = await deploy(dist, t, { name: "ng", dryRun: true })
	assert.ok(result.uploaded.length > 0)
	assert.equal(t.putCount(), 0)
	assert.equal(t.files.size, 0)
})

test("a deploy that never landed FAILS verification instead of passing on the 200", async () => {
	// The exact real-hardware trap: every unknown path returns stock DWC's
	// index.html with HTTP 200. A status-only check would call this success.
	const dist = await makeDist()
	const t = fakeTransport({ spaFallback: true })
	const manifest = await buildManifest(dist, { name: "ng", serves: "kestrel" })
	await assert.rejects(() => verify(t, manifest, { name: "ng" }), /content mismatch/i)
})

test("an entry module served as text/html fails verification", async () => {
	const dist = await makeDist()
	const t = fakeTransport({ htmlForEverything: true })
	await assert.rejects(
		() => deploy(dist, t, { name: "ng" }),
		/content-type|content mismatch/i,
	)
})

test("a real deploy verifies clean, in both plain and gzip modes", async () => {
	const dist = await makeDist()
	for (const serves of ALL_STACKS) {
		const t = fakeTransport({ serves })
		await deploy(dist, t, { name: "ng" }) // throws if verification fails
		assert.ok(t.files.size > 0)
	}
})

test("uninstall removes the entry and the whole directory", async () => {
	const dist = await makeDist()
	const t = fakeTransport()
	await deploy(dist, t, { name: "ng" })
	await uninstall(t, { name: "ng" })
	assert.equal(t.files.size, 0)
})

test("the entry script src is parsed out of the built html", () => {
	assert.equal(parseEntryScript(ENTRY_HTML), "/ng/assets/index-abc.js")
	assert.equal(parseEntryScript("<html><body>no script</body></html>"), null)
})

test("CRC-32 matches the reference vectors rr_upload checks against", () => {
	assert.equal(crc32(new Uint8Array()), 0)
	assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926)
	assert.equal(crc32Hex(new TextEncoder().encode("123456789")), "cbf43926")
})

test("each transport declares the stack that will serve what it writes", async () => {
	const { dsfTransport } = await import("../src/dsfTransport.ts")
	const { pollTransport } = await import("../src/pollTransport.ts")
	assert.equal(dsfTransport("http://x").serves, "kestrel")
	assert.equal(pollTransport("http://x").serves, "rrf-embedded")
})

test("compression is decided by the serving stack, and only there", () => {
	// The mapping itself. DSF/Kestrel 404s a transparent .gz fetch and RRF's
	// embedded server resolves one — both verified on real hardware 2026-07-24.
	assert.equal(compressionFor("kestrel").gzip, false)
	assert.equal(compressionFor("rrf-embedded").gzip, true)
	// Total: every stack has an answer, so a new one cannot slip through
	// silently taking whichever branch happened to be the default.
	for (const serves of ALL_STACKS) {
		assert.equal(typeof compressionFor(serves).gzip, "boolean")
	}
})

test("what lands on the board matches what its server can serve", async () => {
	// The A/B test the seam exists for: drive a whole deploy through each stack
	// and read back the BOARD PATHS. Kestrel must receive no .gz at all (every
	// asset would 404); RRF's embedded server must receive nothing but.
	const dist = await makeDist()

	const kestrel = fakeTransport({ serves: "kestrel" })
	await deploy(dist, kestrel, { name: "ng" })
	const kestrelPaths = [...kestrel.files.keys()]
	assert.ok(kestrelPaths.length > 0)
	assert.deepEqual(kestrelPaths.filter(p => p.endsWith(".gz")), [])

	const rrf = fakeTransport({ serves: "rrf-embedded" })
	await deploy(dist, rrf, { name: "ng" })
	const rrfPaths = [...rrf.files.keys()]
	assert.ok(rrfPaths.length > 0)
	assert.deepEqual(rrfPaths.filter(p => !p.endsWith(".gz")), [])
})

test("cli rejects a bad mode and a missing target", () => {
	assert.throws(() => parseArgs([]), /--target is required/)
	assert.throws(() => parseArgs(["--target", "http://x", "--mode", "sbc"]), /--mode must be/)
	const args = parseArgs(["--target", "http://x", "--dry-run"])
	assert.equal(args.mode, "dsf")
	assert.equal(args.name, "ng")
	assert.equal(args.dryRun, true)
})

test("cli defaults to the root layout and rejects an unknown one", () => {
	assert.equal(parseArgs(["--target", "http://x"]).layout, "root")
	assert.equal(parseArgs(["--target", "http://x", "--layout", "sidecar"]).layout, "sidecar")
	assert.throws(
		() => parseArgs(["--target", "http://x", "--layout", "beside"]),
		/--layout must be/,
	)
})

test("a redeploy PRUNES the previous build's orphaned chunks", async () => {
	// Asset names are content-hashed, so a new build orphans the old names.
	// Upload-and-skip alone is idempotent but never subtractive: measured on
	// the real board, four deploys had left 34 orphans totalling 4 MB —
	// including three copies of Babylon at 957 KB each.
	const dist = await makeDist()
	const t = fakeTransport()
	await deploy(dist, t, { name: "ng" })

	// Simulate what an earlier build left behind.
	const stale = "0:/www/ng/assets/math.color-OLDHASH.js"
	await t.put(stale, new TextEncoder().encode("old babylon"))
	assert.ok(t.files.has(stale))

	const result = await deploy(dist, t, { name: "ng" })
	assert.deepEqual(result.pruned, [stale])
	assert.equal(t.files.has(stale), false, "the orphan survived the redeploy")
})

test("pruning never touches a file the current build still needs", async () => {
	const dist = await makeDist()
	const t = fakeTransport()
	await deploy(dist, t, { name: "ng" })
	const before = [...t.files.keys()].sort()
	const result = await deploy(dist, t, { name: "ng" })
	assert.deepEqual(result.pruned, [])
	assert.deepEqual([...t.files.keys()].sort(), before)
})

test("pruning stays inside the deployment — stock DWC is never at risk", async () => {
	const dist = await makeDist()
	const t = fakeTransport()
	await t.put("0:/www/index.html", new TextEncoder().encode("DWC"))
	await t.put("0:/www/js/app.js", new TextEncoder().encode("DWC js"))
	await deploy(dist, t, { name: "ng" })
	await deploy(dist, t, { name: "ng" })
	assert.ok(t.files.has("0:/www/index.html"), "stock DWC index was deleted")
	assert.ok(t.files.has("0:/www/js/app.js"), "stock DWC asset was deleted")
})

test("a dry run reports orphans without deleting them", async () => {
	const dist = await makeDist()
	const t = fakeTransport()
	await deploy(dist, t, { name: "ng" })
	const stale = "0:/www/ng/assets/index-GONE.js"
	await t.put(stale, new TextEncoder().encode("x"))
	const result = await deploy(dist, t, { name: "ng", dryRun: true })
	assert.deepEqual(result.pruned, [stale])
	assert.ok(t.files.has(stale), "dry run deleted a file")
})

// The brand's whole job: a path nobody minted cannot be deleted. These are
// COMPILE-time assertions — each directive below is the test, and the build
// fails if remove starts accepting a bare string again. The board's filesystem
// IS the machine's configuration, and there is no undo on an SD card.
test("only a minted OwnedPath can be deleted", () => {
	const owned = ownedPaths("ng", "sidecar")
	assert.equal(typeof owned[0], "string", "still reads and logs as a path")
	const takesOwned = (p: OwnedPath): OwnedPath => p
	takesOwned(owned[0]!)
	takesOwned(ownedAsset("0:/www/ng/assets", "index-abc123.js"))
	// @ts-expect-error a hand-built path carries no proof of ownership
	takesOwned("0:/www")
	// @ts-expect-error not even one that looks exactly like ours
	takesOwned("0:/www/ng.html")
})
