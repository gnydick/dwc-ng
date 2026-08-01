/**
 * Walks the workspace collecting declarations. Sorted output, because the
 * register is compared byte-for-byte by the drift test — a filesystem whose
 * readdir order differs between machines must not produce a different file.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDeclarations, type RawDeclaration } from "./parse.ts";
import { parseBroken, type RawBroken } from "./broken.ts";

const EXTENSIONS = [".ts", ".tsx", ".css"];
const SKIP = new Set(["node_modules", "dist", ".git", "captures"]);

/** This file is packages/invariants/src/scan.ts, so the root is three up. */
export function repoRoot(): string {
	return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

function walk(dir: string, out: string[]): void {
	const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
	for (const entry of entries) {
		if (SKIP.has(entry.name)) continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walk(full, out);
		else if (EXTENSIONS.some(ext => entry.name.endsWith(ext))) out.push(full);
	}
}

/**
 * Only `packages/<pkg>/src` is scanned, and that is a rule about meaning rather
 * than a convenience: a declaration belongs beside the MECHANISM that enforces
 * it, and a test is evidence about a mechanism, never one itself.
 *
 * It also happens to be load-bearing. A test file's fixture strings contain
 * literal "/* ... *\/" text, and a regex over raw bytes cannot tell a comment
 * from a string that looks like one — scanning test/ made this package's own
 * fixtures show up as declarations with newline escapes inside their slugs.
 */
export function scanTree(rootDir: string): RawDeclaration[] {
	return collect(rootDir, parseDeclarations);
}

/** The same walk, for @broken blocks. Defects that live in code are declared beside it. */
export function scanBroken(rootDir: string): RawBroken[] {
	return collect(rootDir, parseBroken);
}

/**
 * One walk, parameterised by what to read out of each file — so adding a second
 * kind of declaration does not add a second traversal that could disagree with
 * the first about which files exist.
 */
function collect<T>(rootDir: string, read: (text: string, file: string) => T[]): T[] {
	const files: string[] = [];
	const packages = join(rootDir, "packages");
	for (const pkg of readdirSync(packages, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
		if (!pkg.isDirectory() || SKIP.has(pkg.name)) continue;
		const src = join(packages, pkg.name, "src");
		if (!existsSync(src)) continue;
		walk(src, files);
	}
	const out: T[] = [];
	for (const full of files.sort()) {
		const rel = relative(rootDir, full).replaceAll("\\", "/");
		out.push(...read(readFileSync(full, "utf8"), rel));
	}
	return out;
}
