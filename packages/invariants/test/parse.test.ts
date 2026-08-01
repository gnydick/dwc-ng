import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDeclarations } from "../src/parse.ts";

test("a complete block yields every field, with the tag's line number", () => {
	const text = [
		"const a = 1;",
		"/**",
		" * @invariant path-escape",
		" * @rung 7  sole-constructor type — parseFileName is the only producer",
		" * @why     a typed name can never reach outside its directory",
		" */",
		"export const x = 2;",
	].join("\n");
	const found = parseDeclarations(text, "packages/ui/src/files/path.ts");
	assert.equal(found.length, 1);
	assert.equal(found[0]?.slug, "path-escape");
	assert.equal(found[0]?.rung, "7  sole-constructor type — parseFileName is the only producer");
	assert.equal(found[0]?.why, "a typed name can never reach outside its directory");
	assert.equal(found[0]?.debt, undefined);
	assert.equal(found[0]?.line, 3);
});

test("a wrapped field continues onto the next line, joined by one space", () => {
	const text = [
		"/**",
		" * @invariant two-tier-write",
		" * @rung 5  shared helper — replaceScreenLayout writes both tiers, but",
		" *          updateScreenCards is still public",
		" * @why  a replacement that writes one tier delivers a shredded layout",
		" * @debt remove updateScreenCards from the public ConfigStore interface",
		" */",
	].join("\n");
	const found = parseDeclarations(text, "packages/ui/src/config/store.ts");
	assert.equal(
		found[0]?.rung,
		"5  shared helper — replaceScreenLayout writes both tiers, but updateScreenCards is still public",
	);
	assert.equal(found[0]?.debt, "remove updateScreenCards from the public ConfigStore interface");
});

test("two blocks in one file are two declarations", () => {
	const text = "/**\n * @invariant one\n * @rung 6 a\n * @why b\n */\n/**\n * @invariant two\n * @rung 7 c\n * @why d\n */";
	assert.equal(parseDeclarations(text, "packages/ui/src/files/a.ts").length, 2);
});

test("a CSS block comment parses identically", () => {
	const text = "/* @invariant floor-independence\n * @rung 6 one declaration site\n * @why a card's minimum must not depend on its own width\n */";
	assert.equal(parseDeclarations(text, "packages/ui/src/app.css")[0]?.slug, "floor-independence");
});

test("RED CHECK: a typo'd tag is not silently accepted as a declaration", () => {
	const text = "/**\n * @invariants path-escape\n * @rung 7 x\n * @why y\n */";
	assert.deepEqual(parseDeclarations(text, "packages/ui/src/files/path.ts"), []);
});

test("text outside a block comment is never scanned", () => {
	const text = 'const s = "@invariant not-a-declaration";';
	assert.deepEqual(parseDeclarations(text, "packages/ui/src/files/path.ts"), []);
});
