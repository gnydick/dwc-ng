/**
 * The heavy libraries must not reach the eager bundle.
 *
 * CLAUDE.md's first hard constraint is that RRF's embedded HTTP server is weak
 * and payload is expensive. Babylon alone is 232 KB gzipped — larger than the
 * entire eager bundle — and CodeMirror is comparable. Both are kept out by
 * being reachable ONLY through a dynamic import(), which is a property of how
 * three specific files are imported, and nothing enforced it.
 *
 * The failure is silent in the worst way: a static import somewhere adds a
 * quarter-megabyte to what every board load must serve, the app still works
 * perfectly on a dev machine, and the cost shows up as a slower first paint on
 * hardware nobody profiles.
 *
 * Two halves, because either alone is insufficient:
 *  1. only the three owner modules may name the heavy packages at all;
 *  2. those owners may only be imported as `import type` (erased, since
 *     verbatimModuleSyntax is on) or via `import(...)`. A value import of
 *     scene.ts pulls Babylon in just as surely as importing Babylon directly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/**
 * The modules allowed to name a heavy package. An allowlist is debt (a fourth
 * lazy surface has to be added by hand), and it is the honest shape here: the
 * set of dynamic-import boundaries is a design decision, not something derivable
 * from the source. Adding a name is the deliberate act the list exists to make.
 */
const LAZY_OWNERS = ["editor/setup.ts", "gcode/scene.ts", "heightmap/surface3d.ts"];
const HEAVY = /"(codemirror|@codemirror\/|@babylonjs\/|@lezer\/)/;

function sourceFiles(): string[] {
	const out: string[] = [];
	const walk = (dir: string): void => {
		for (const name of readdirSync(dir)) {
			const full = join(dir, name);
			if (statSync(full).isDirectory()) walk(full);
			else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(full);
		}
	};
	walk(SRC);
	return out;
}

const rel = (f: string): string => relative(SRC, f).replaceAll("\\", "/");

test("only the lazy-loaded owners name a heavy package", () => {
	const offenders: string[] = [];
	for (const file of sourceFiles()) {
		if (LAZY_OWNERS.includes(rel(file))) continue;
		readFileSync(file, "utf8").split("\n").forEach((line, i) => {
			if (/^\s*import\b/.test(line) && HEAVY.test(line)) offenders.push(`${rel(file)}:${i + 1}  ${line.trim()}`);
		});
	}
	assert.deepEqual(offenders, [], `these would pull a lazy library into the eager bundle:\n${offenders.join("\n")}`);
});

test("a lazy owner is only ever type-imported or dynamically imported", () => {
	const offenders: string[] = [];
	for (const file of sourceFiles()) {
		const self = rel(file);
		if (LAZY_OWNERS.includes(self)) continue;
		readFileSync(file, "utf8").split("\n").forEach((line, i) => {
			for (const owner of LAZY_OWNERS) {
				const base = owner.slice(owner.lastIndexOf("/") + 1);
				if (!line.includes(base)) continue;
				// `import type {...}` is erased; `await import("./scene.ts")` is the
				// dynamic form. A bare `import {...} from "./scene.ts"` is neither.
				if (/^\s*import\s+type\b/.test(line) || /\bimport\s*\(/.test(line)) continue;
				if (/^\s*import\b/.test(line)) offenders.push(`${self}:${i + 1}  ${line.trim()}`);
			}
		});
	}
	assert.deepEqual(offenders, [], `a value import defeats the dynamic boundary:\n${offenders.join("\n")}`);
});
