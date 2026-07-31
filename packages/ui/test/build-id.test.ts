import { test } from "node:test";
import assert from "node:assert/strict";
import { hashFromEntrySrc, buildStamp, commitFromMeta } from "../src/shell/buildId.ts";

/**
 * The stamp must name the SOURCE, not just the bytes. It read "dev" in every
 * dev build and every test — a value that identifies nothing, so a screenshot
 * of a running page could not be traced to the code in it.
 */
test("the stamp leads with the commit, so the page names its own source", () => {
	assert.equal(buildStamp("7f781cd", "CrXMtSAE"), "7f781cd · CrXMtSAE");
	// No bundle in dev, so there is no content hash to show — but the commit is
	// still known, and it is the half that was missing.
	assert.equal(buildStamp("7f781cd", null), "7f781cd");
});

/**
 * A bare SHA on a build made from an edited tree names a commit that does not
 * contain the running code. The suffix is generated in vite.config.ts; this
 * pins that the stamp carries it through rather than trimming it to look tidy.
 */
test("a dirty tree stays visibly dirty in the stamp", () => {
	assert.equal(buildStamp("7f781cd-dirty", "CrXMtSAE"), "7f781cd-dirty · CrXMtSAE");
});

/**
 * The commit comes from a per-request meta tag. It used to come from a vite
 * `define`, which is evaluated ONCE at dev-server boot — so the page went on
 * naming the commit that was checked out when the server started, hours after
 * it stopped being true. A wrong SHA is worse than none, so a missing tag
 * degrades to a marker that names nothing rather than to a plausible value.
 */
test("the commit is read from the injected meta tag", () => {
	const doc = (content: string | undefined) => ({
		querySelector: () => (content === undefined ? null : { content }) as never,
	});
	assert.equal(commitFromMeta(doc("d1020c0")), "d1020c0");
	assert.equal(commitFromMeta(doc("d1020c0-dirty")), "d1020c0-dirty");
	assert.equal(commitFromMeta(doc(undefined)), "nogit", "no tag must not become a SHA");
	assert.equal(commitFromMeta(doc("")), "nogit", "an empty tag is not a commit");
	assert.equal(commitFromMeta(undefined), "nogit", "no document at all (node:test)");
});

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
