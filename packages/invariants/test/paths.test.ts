import { test } from "node:test";
import assert from "node:assert/strict";
import { namespaceOf } from "../src/paths.ts";

test("a nested source directory becomes a slash-joined namespace", () => {
	assert.equal(namespaceOf("packages/ui/src/compose/controls/spec.ts"), "compose/controls");
});

test("one level under src is that one directory", () => {
	assert.equal(namespaceOf("packages/ui/src/files/path.ts"), "files");
});

test("a file directly in src falls back to the package name", () => {
	assert.equal(namespaceOf("packages/ui/src/app.css"), "ui");
	assert.equal(namespaceOf("packages/deploy/src/manifest.ts"), "deploy");
});

test("a file outside packages/ is rejected rather than guessed at", () => {
	assert.throws(() => namespaceOf("docs/notes.md"), /not under packages/);
});
