import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildManifest } from "../src/manifest.ts"
import { deploy, uninstall } from "../src/deploy.ts"
import { verify, parseEntryScript } from "../src/verify.ts"
import { crc32, crc32Hex } from "../src/crc32.ts"
import { parseArgs } from "../src/cli.ts"
import { mintCompression } from "../src/transport.ts"
import { fakeTransport } from "./fakeTransport.ts"

const PLAIN = mintCompression(false)
const GZIP = mintCompression(true)

const ENTRY_HTML =
	'<!doctype html><html><head><script type="module" crossorigin src="/ng/assets/index-abc.js"></script></head><body><div id="app"></div></body></html>'

/** A miniature dist/ shaped like the real one, sourcemaps included. */
async function makeDist(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "dwc-ng-dist-"))
	await mkdir(join(dir, "assets"), { recursive: true })
	await writeFile(join(dir, "index.html"), ENTRY_HTML)
	await writeFile(join(dir, "assets", "index-abc.js"), "export const x = 1\n")
	await writeFile(join(dir, "assets", "index-abc.js.map"), '{"version":3}')
	await writeFile(join(dir, "assets", "style.css"), ".a{color:red}")
	await writeFile(join(dir, "favicon.svg"), "<svg/>")
	return dir
}

test("index.html becomes ng.html; everything else nests under ng/", async () => {
	const files = await buildManifest(await makeDist(), { name: "ng", compression: PLAIN })
	assert.deepEqual(
		files.map(f => f.url).sort(),
		["/ng.html", "/ng/assets/index-abc.js", "/ng/assets/style.css", "/ng/favicon.svg"],
	)
})

test("the entry lives at 0:/www/ng.html, not inside the ng/ directory", async () => {
	// Verified on real hardware 2026-07-24: /ng/ serves stock DWC, because
	// Kestrel has no UseDefaultFiles() for subdirectories.
	const files = await buildManifest(await makeDist(), { name: "ng", compression: PLAIN })
	const entry = files.find(f => f.url === "/ng.html")
	assert.equal(entry?.board, "0:/www/ng.html")
})

test("sourcemaps never reach the board", async () => {
	const files = await buildManifest(await makeDist(), { name: "ng", compression: PLAIN })
	assert.equal(files.filter(f => f.url.endsWith(".map")).length, 0)
})

test("gzip mode appends .gz on the board and compresses the payload", async () => {
	const files = await buildManifest(await makeDist(), { name: "ng", compression: GZIP })
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
	const manifest = await buildManifest(dist, { name: "ng", compression: PLAIN })
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
	for (const gzip of [false, true]) {
		const t = fakeTransport({ gzip })
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

test("the transports carry the compression their board actually supports", async () => {
	const { dsfTransport } = await import("../src/dsfTransport.ts")
	const { pollTransport } = await import("../src/pollTransport.ts")
	// DSF/Kestrel 404s a transparent .gz fetch — verified on real hardware.
	assert.equal(dsfTransport("http://x").compression.gzip, false)
	assert.equal(pollTransport("http://x").compression.gzip, true)
})

test("cli rejects a bad mode and a missing target", () => {
	assert.throws(() => parseArgs([]), /--target is required/)
	assert.throws(() => parseArgs(["--target", "http://x", "--mode", "sbc"]), /--mode must be/)
	const args = parseArgs(["--target", "http://x", "--dry-run"])
	assert.equal(args.mode, "dsf")
	assert.equal(args.name, "ng")
	assert.equal(args.dryRun, true)
})
