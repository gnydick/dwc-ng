import { test } from "node:test"
import assert from "node:assert/strict"
import { entryHash } from "../src/cli.ts"

/**
 * The deploy and the running app must quote the SAME identity. The app reads
 * the hash off the entry filename at runtime; this reads it off the same
 * filename in the deployed file list. One identity, computed once by the
 * bundler, so the two ends cannot drift.
 */
test("finds the entry hash among the deployed paths", () => {
	assert.equal(entryHash([
		"/ng/assets/math.color-haKoR2GN.js",
		"/ng/assets/index-DUTmpm5G.js",
		"/ng.html",
	]), "DUTmpm5G")
})

test("is not fooled by other hashed assets", () => {
	assert.equal(entryHash(["/ng/assets/CardStudio-chlfkjNN.js", "/ng.html"]), null)
	assert.equal(entryHash(["/ng/assets/index-BsbchVni.css"]), null, "the stylesheet is not the entry module")
})

test("no entry, no claim", () => {
	assert.equal(entryHash([]), null)
})
