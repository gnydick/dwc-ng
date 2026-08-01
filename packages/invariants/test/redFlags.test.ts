import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRedFlags, PHRASES } from "../src/redFlags.ts";

function withSource(body: string): string {
	const root = mkdtempSync(join(tmpdir(), "flags-"));
	const dir = join(root, "packages", "ui", "src", "files");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "x.ts"), body);
	return root;
}

test("an undeclared red-flag phrase is reported", () => {
	const found = findRedFlags(withSource("/**\n * Callers must sort the list first.\n */"));
	assert.equal(found.length, 1);
	assert.match(found[0]!.message, /callers must/i);
});

test("the same phrase inside a DECLARED block is not reported — that is filed debt", () => {
	const body = [
		"/**",
		" * @invariant sorted",
		" * @rung 3  a test pins it",
		" * @why order matters",
		" * @debt take a Sorted<T> so the precondition is a type",
		" * Callers must sort the list first.",
		" */",
	].join("\n");
	assert.deepEqual(findRedFlags(withSource(body)), []);
});

test("a block that merely MENTIONS the tag in prose is not exempt", () => {
	// Otherwise writing "@invariant" in a comment would silence the lint —
	// a bypass that costs one word.
	const body = "/**\n * See the @invariant register for how we file these.\n * Callers must sort first.\n */";
	assert.equal(findRedFlags(withSource(body)).length, 1);
});

test("every phrase in the published list is detected", () => {
	for (const phrase of PHRASES) {
		const found = findRedFlags(withSource(`/**\n * Note: ${phrase} something.\n */`));
		assert.equal(found.length, 1, `"${phrase}" was not detected`);
	}
});

test("ordinary prose is left alone", () => {
	assert.deepEqual(findRedFlags(withSource("/**\n * Loads the file and returns its text.\n */")), []);
});

test("detection is case-insensitive, and reports where", () => {
	const found = findRedFlags(withSource("const a = 1;\n/**\n * BY CONVENTION this is sorted.\n */"));
	assert.equal(found.length, 1);
	assert.equal(found[0]?.file, "packages/ui/src/files/x.ts");
	assert.equal(found[0]?.line, 2);
});
