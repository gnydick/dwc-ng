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
