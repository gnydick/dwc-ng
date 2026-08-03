/**
 * The payload ratchet. CLAUDE.md's first hard constraint is the one thing in
 * this repo that had no gate; this is it.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { eagerAssets, measureEager, overBudget, readEagerBudget } from "../src/eagerBudget.ts"

const HTML = `<!doctype html><html><head>
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<script type="module" crossorigin src="/assets/entry.js"></script>
<link rel="modulepreload" crossorigin href="/assets/shared.js">
<link rel="stylesheet" crossorigin href="/assets/app.css">
</head><body><div id="app"></div></body></html>`

test("eager assets are the entry, its modulepreloads, and its stylesheets", () => {
	assert.deepEqual(eagerAssets(HTML), ["/assets/app.css", "/assets/entry.js", "/assets/shared.js"])
})

test("a favicon is not on the critical path", () => {
	assert.equal(eagerAssets(HTML).includes("/favicon.svg"), false, "rel=icon does not block paint")
})

test("a lazily-imported chunk is not counted", () => {
	// The dynamic-import boundary is the whole point of the split; counting the
	// chunks it produces would punish the thing that keeps Babylon out of this
	// number. Only what index.html names is eager.
	assert.equal(eagerAssets(HTML).includes("/assets/babylon.js"), false)
})

function fixture(sizes: Record<string, number>): string {
	const root = mkdtempSync(join(tmpdir(), "eager-"))
	mkdirSync(join(root, "assets"), { recursive: true })
	writeFileSync(join(root, "index.html"), HTML)
	for (const [name, bytes] of Object.entries(sizes)) {
		writeFileSync(join(root, "assets", name), "x".repeat(bytes))
	}
	return root
}

test("measureEager sums the referenced files and the document itself", () => {
	const dist = fixture({ "entry.js": 1000, "shared.js": 2000, "app.css": 500 })
	const m = measureEager(dist)
	assert.equal(m.bytes, 3500 + Buffer.byteLength(HTML))
	assert.deepEqual(m.assets.map(a => a.bytes), [500, 1000, 2000])
})

test("a referenced file that is missing THROWS rather than under-reporting", () => {
	// A budget computed over a partial build would come in low and pass, which
	// is the failure mode a size gate must not have.
	const dist = fixture({ "entry.js": 1000 })
	assert.throws(() => measureEager(dist), /shared\.js|ENOENT/)
})

test("overBudget names the largest assets, and is silent when inside", () => {
	const dist = fixture({ "entry.js": 1000, "shared.js": 9000, "app.css": 500 })
	const m = measureEager(dist)
	assert.equal(overBudget(m, 1_000_000), null, "inside budget says nothing")
	const report = overBudget(m, 5000)
	assert.ok(report !== null)
	assert.match(report, /exceeds the committed budget/)
	assert.match(report, /shared\.js/, "the biggest contributor is named")
	assert.match(report, /uncompressed/, "and says why raw is the unit")
})

test("the committed budget is a positive integer of BYTES", () => {
	const budget = readEagerBudget()
	assert.equal(Number.isInteger(budget), true)
	assert.ok(budget > 100_000, "a budget below the current app would be a typo, not a ratchet")
})

test("a malformed budget is an error, never a permissive default", () => {
	const root = mkdtempSync(join(tmpdir(), "budget-"))
	const bad = join(root, "eager-budget.json")
	writeFileSync(bad, JSON.stringify({ maxEagerBytes: "401 KB" }))
	assert.throws(() => readEagerBudget(bad), /must be a positive integer/)
})
