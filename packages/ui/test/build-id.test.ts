import { test } from "node:test";
import assert from "node:assert/strict";
import { hashFromEntrySrc } from "../src/shell/buildId.ts";

/**
 * The build id must be a CONTENT hash, not a timestamp. A timestamp records
 * when the build ran, so two builds of identical code disagree and a rebuild
 * of unchanged code looks new — neither answers "are these two tabs running
 * the same code", which is the only question it exists for.
 */
test("reads Vite's content hash out of the entry filename", () => {
	assert.equal(hashFromEntrySrc("/ng/assets/index-DUTmpm5G.js"), "DUTmpm5G");
	assert.equal(hashFromEntrySrc("http://duet3.local/ng/assets/index-c5-VB0t5.js"), "c5-VB0t5");
	assert.equal(hashFromEntrySrc("/assets/index-BXe9wu64.js?t=1"), "BXe9wu64");
});

/** Identical content gets an identical hash — that IS the property we need. */
test("the same filename always yields the same id", () => {
	const a = hashFromEntrySrc("/ng/assets/index-DUTmpm5G.js");
	const b = hashFromEntrySrc("/ng/assets/index-DUTmpm5G.js");
	assert.equal(a, b);
	assert.notEqual(a, hashFromEntrySrc("/ng/assets/index-Bi7E-ik7.js"));
});

/** The dev server serves unhashed source; there is no build to identify. */
test("an unhashed entry has no build id", () => {
	assert.equal(hashFromEntrySrc("/src/main.tsx"), null);
	assert.equal(hashFromEntrySrc("/main.js"), null);
	assert.equal(hashFromEntrySrc(""), null);
});
