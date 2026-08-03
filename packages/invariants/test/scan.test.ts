import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanTree, repoRoot } from "../src/scan.ts";

function fixture(): string {
	const root = mkdtempSync(join(tmpdir(), "inv-"));
	const ui = join(root, "packages", "ui", "src", "files");
	mkdirSync(ui, { recursive: true });
	writeFileSync(join(ui, "path.ts"), "/**\n * @invariant path-escape\n * @rung 7 brand\n * @why safety\n */");
	writeFileSync(join(ui, "a.css"), "/* @invariant floor\n * @rung 6 one site\n * @why layout\n */");
	writeFileSync(join(ui, "notes.md"), "@invariant not-scanned\n");
	const skipped = join(root, "packages", "ui", "node_modules", "dep");
	mkdirSync(skipped, { recursive: true });
	writeFileSync(join(skipped, "x.ts"), "/**\n * @invariant vendor\n * @rung 7 x\n * @why y\n */");
	// A test file whose FIXTURE STRING looks exactly like a declaration. A regex
	// over raw bytes cannot tell this from a real comment, which is why only
	// src/ is scanned — this package's own fixtures were the first casualties.
	const tests = join(root, "packages", "ui", "test");
	mkdirSync(tests, { recursive: true });
	writeFileSync(join(tests, "a.test.ts"), 'const f = "/* @invariant fixture\\n * @rung 7 x\\n * @why y\\n */";');
	return root;
}

test("scans ts/tsx/css under packages, and nothing else", () => {
	const found = scanTree(fixture());
	const slugs = found.map(d => d.slug).sort();
	assert.deepEqual(slugs, ["floor", "path-escape"]);
});

test("node_modules is never scanned", () => {
	assert.equal(scanTree(fixture()).some(d => d.slug === "vendor"), false);
});

test("test/ is never scanned — a fixture that LOOKS like a declaration is not one", () => {
	assert.equal(scanTree(fixture()).some(d => d.slug.startsWith("fixture")), false);
});

test("scanning the real repo yields no declaration with a broken slug", () => {
	// The guard that would have caught the fixture bug on any future change.
	for (const d of scanTree(repoRoot())) {
		assert.match(d.slug, /^[a-z0-9-]+$/, `${d.file}:${d.line} produced the slug ${JSON.stringify(d.slug)}`);
	}
});

test("paths are repo-relative with forward slashes on every platform", () => {
	const found = scanTree(fixture());
	assert.equal(found.every(d => d.file.startsWith("packages/") && !d.file.includes("\\")), true);
});

test("the order is deterministic across runs", () => {
	const root = fixture();
	assert.deepEqual(scanTree(root).map(d => d.file), scanTree(root).map(d => d.file));
});

// Asserts what repoRoot is FOR — that it lands on a directory holding the
// workspace — rather than that the checkout is named a particular thing. The
// name check failed in a git worktree, where the root is
// .claude/worktrees/<name>, which this project uses routinely. A test that
// pins an incidental fact reports a false defect the first time the
// environment is legitimately different.
test("repoRoot finds the real workspace", () => {
	const root = repoRoot();
	assert.equal(typeof root, "string");
	assert.ok(existsSync(join(root, "pnpm-workspace.yaml")), `no pnpm-workspace.yaml at ${root}`);
	assert.ok(existsSync(join(root, "packages", "invariants")), `no packages/invariants at ${root}`);
});
