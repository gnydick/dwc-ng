import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFileName, childPath, parentDir } from "../src/files/path.ts";

// --- parseFileName: the boundary where untrusted keystrokes become a name ---

test("parseFileName accepts an ordinary name", () => {
	assert.equal(parseFileName("config.g"), "config.g");
});

test("parseFileName trims surrounding whitespace", () => {
	assert.equal(parseFileName("  homeall.g  "), "homeall.g");
});

test("parseFileName rejects empty and whitespace-only input", () => {
	assert.equal(parseFileName(""), null);
	assert.equal(parseFileName("   "), null);
});

test("parseFileName rejects a name containing a separator", () => {
	assert.equal(parseFileName("sub/file.g"), null);
	assert.equal(parseFileName("sub\\file.g"), null);
});

test("parseFileName rejects traversal steps outright", () => {
	assert.equal(parseFileName(".."), null);
	assert.equal(parseFileName("."), null);
	assert.equal(parseFileName("../../sys/config.g"), null);
});

test("parseFileName rejects a volume separator - 0:/ must stay unreachable", () => {
	assert.equal(parseFileName("0:"), null);
	assert.equal(parseFileName("0:/sys"), null);
});

test("parseFileName rejects characters FAT cannot store", () => {
	for (const bad of ["a*b", "a?b", "a\"b", "a<b", "a>b", "a|b"]) {
		assert.equal(parseFileName(bad), null, `expected ${bad} to be rejected`);
	}
});

test("parseFileName rejects control characters", () => {
	const NEWLINE = String.fromCharCode(10);
	const TAB = String.fromCharCode(9);
	const NUL = String.fromCharCode(0);
	assert.equal(parseFileName(`a${NEWLINE}b`), null);
	assert.equal(parseFileName(`a${TAB}b`), null);
	assert.equal(parseFileName(`a${NUL}b`), null);
});

test("parseFileName keeps interior spaces - slicers emit them constantly", () => {
	assert.equal(parseFileName("Benchy v2 0.2mm.gcode"), "Benchy v2 0.2mm.gcode");
});

test("parseFileName rejects a trailing dot - FAT silently drops it", () => {
	assert.equal(parseFileName("name."), null);
	// Inner dots and leading dots are fine.
	assert.equal(parseFileName(".hidden"), ".hidden");
	assert.equal(parseFileName("a.b.c"), "a.b.c");
});

// --- childPath: the sole path constructor ---

test("childPath joins a directory and a parsed name with exactly one slash", () => {
	const name = parseFileName("tool_lock.g");
	assert.ok(name);
	assert.equal(childPath("0:/macros", name), "0:/macros/tool_lock.g");
});

test("childPath does not double a slash when the directory has a trailing one", () => {
	const name = parseFileName("config.g");
	assert.ok(name);
	assert.equal(childPath("0:/sys/", name), "0:/sys/config.g");
});

test("childPath handles the volume root without producing 0://", () => {
	const name = parseFileName("gcodes");
	assert.ok(name);
	assert.equal(childPath("0:/", name), "0:/gcodes");
});

// --- parentDir: clamped at the domain root, never above it ---

test("parentDir walks up one level", () => {
	assert.equal(parentDir("0:/gcodes/sub/deep", "0:/gcodes"), "0:/gcodes/sub");
});

test("parentDir clamps at the root rather than escaping the domain", () => {
	assert.equal(parentDir("0:/gcodes", "0:/gcodes"), "0:/gcodes");
	assert.equal(parentDir("0:/", "0:/gcodes"), "0:/gcodes");
});

test("parentDir on an unrelated path falls back to the root", () => {
	assert.equal(parentDir("0:/sys/foo", "0:/gcodes"), "0:/gcodes");
});

// --- dirUnderRoot: a REMEMBERED directory can never escape its root ---

test("dirUnderRoot reconstructs a genuine descendant", async () => {
	const { dirUnderRoot, asRemembered } = await import("../src/files/path.ts");
	assert.equal(dirUnderRoot("0:/gcodes", asRemembered("0:/gcodes")), "0:/gcodes", "root is itself");
	assert.equal(dirUnderRoot("0:/gcodes", asRemembered("0:/gcodes/benchies")), "0:/gcodes/benchies");
	assert.equal(dirUnderRoot("0:/gcodes", asRemembered("0:/gcodes/a/b/c")), "0:/gcodes/a/b/c", "nested rebuilt");
});

test("dirUnderRoot rejects anything that could escape the root — falls back to root", async () => {
	const { dirUnderRoot, asRemembered } = await import("../src/files/path.ts");
	const root = "0:/gcodes";
	for (const hostile of [
		"0:/gcodes/../../sys",     // traversal
		"0:/gcodes/../macros",     // sibling domain
		"0:/sys",                  // a different root
		"0:/sys/config.g",         // outside entirely
		"0:/gcodes/a/../../b",     // traversal mid-path
		"0:/gcodes/a//b",          // empty segment
		"0:/gcodes/sub/",          // trailing slash (empty last segment)
		"relative/path",           // not under root at all
		"0:/gcodesevil/x",         // prefix-match trap (starts with root text, not root/)
	]) {
		assert.equal(dirUnderRoot(root, asRemembered(hostile)), root, `must fall back to root: ${hostile}`);
	}
});

test("dirUnderRoot falls back to root when nothing is remembered", async () => {
	const { dirUnderRoot } = await import("../src/files/path.ts");
	assert.equal(dirUnderRoot("0:/macros", undefined), "0:/macros");
});

// The brand is an opaque OBJECT, not a branded string, precisely so a
// remembered value cannot be used as a path by being passed somewhere a string
// is wanted. A branded string would satisfy every one of those signatures.
test("a RememberedDir is not usable as a path", async () => {
	const { asRemembered } = await import("../src/files/path.ts");
	const stored: unknown = asRemembered("0:/gcodes/sub");
	assert.equal(typeof stored, "object", "not a string, so it cannot be concatenated into one");
	// @ts-expect-error a RememberedDir is not assignable where a path is wanted
	const _reject: string = asRemembered("0:/gcodes/sub");
	void _reject;
});
