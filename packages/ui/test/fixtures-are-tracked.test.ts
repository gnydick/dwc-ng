/**
 * The fence for "a test can only read data that is in the repo".
 *
 * On 2026-08-24 the shaping regression gate had been green for a day on one
 * machine and red on every other: `shaping-findings-real-run.test.ts` and
 * `shaping-sweep.test.ts` read 36 captures out of `tools/accel/runs/`, and
 * `tools/accel/.gitignore` ignores the CSVs under it. Not one of those files
 * was tracked. The design that named that directory the fixture home said the
 * data was "already in the repo"; it was not.
 *
 * Two constructions replace that prose. The captures moved into this package's
 * fixture tree, which the capture tooling cannot write to and no ignore rule
 * covers. And this test checks the property that actually failed — is it in the
 * repo — rather than a proxy for it: a "path must start with test/fixtures"
 * string check would still pass the day someone ignores the new location.
 *
 * Asked of every data directory a test names:
 *
 *   1. git reports at least one tracked file in it. This is the one that holds
 *      on a fresh clone and in a worktree, where an untracked fixture is not
 *      merely unlisted but absent — the directory itself is missing.
 *   2. git reports no untracked and no ignored file in it. This is the one that
 *      holds on the machine that took the captures, which is the machine where
 *      the mistake is made and the only place the files exist to be seen.
 *
 * Scope: directories outside this package, and `fixtures/` directories. Source
 * trees are left alone — an unstaged new source file is an ordinary state of a
 * working tree, while an unstaged fixture is a test that runs nowhere else.
 *
 * No @invariant block: the register scans packages/<pkg>/src only, on the rule
 * that a declaration belongs beside the mechanism and a test is evidence about
 * a mechanism, never one itself (invariants/src/scan.ts). The mechanism here is
 * where the fixture tree lives; this file is the evidence that it holds.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve, sep } from "node:path";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(TEST_DIR, "..");
const REPO = resolve(PKG, "..", "..");

function* walk(dir: string): Generator<string> {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== "fixtures") yield* walk(full);
		} else if (/\.tsx?$/.test(entry.name)) yield full;
	}
}

/** The static head of a `new URL(...)` first argument: a template's first `${`
 *  cuts off what is unknowable here, and the directory is what matters. */
function urlLiterals(source: string): string[] {
	const out: string[] = [];
	for (const m of source.matchAll(/new URL\(\s*([`'"])([^`'"]*)\1/g)) {
		const [head = ""] = (m[2] ?? "").split("${");
		if (head.includes("/")) out.push(head);
	}
	return out;
}

/**
 * Which directory a literal names. A literal ending in `/` names one outright,
 * and is returned whether or not it exists — a missing fixture directory is the
 * finding, not a reason to look at its parent instead.
 */
function dirOf(fromFile: string, literal: string): string | null {
	const abs = resolve(dirname(fromFile), literal);
	if (literal.endsWith("/")) return abs;
	try {
		if (statSync(abs).isDirectory()) return abs;
	} catch {
		/* a file, or nothing: its directory is the one being read */
	}
	const parent = dirname(abs);
	try {
		return statSync(parent).isDirectory() ? parent : null;
	} catch {
		return null;
	}
}

/** Outside this package, or a fixture directory: data, either way. */
function isDataDir(dir: string): boolean {
	const rel = relative(PKG, dir);
	return rel.startsWith("..") || rel.split(sep).includes("fixtures");
}

const git = (args: readonly string[], dir: string): string[] =>
	execFileSync("git", [...args, "--", dir], { cwd: REPO, encoding: "utf8" })
		.split("\n")
		.filter((l) => l.length > 0);

function dataDirs(): string[] {
	const dirs = new Set<string>();
	for (const file of walk(TEST_DIR)) {
		for (const literal of urlLiterals(readFileSync(file, "utf8"))) {
			const dir = dirOf(file, literal);
			if (dir !== null && isDataDir(dir)) dirs.add(dir);
		}
	}
	return [...dirs].sort();
}

test("the scan can still see the data directories the suite reads", () => {
	// A regex that stops matching makes every assertion below vacuous, so the
	// gate this test was written for is named here.
	const dirs = dataDirs();
	assert.ok(
		dirs.some((d) => d.endsWith(join("fixtures", "shaping", "ui-first-run-2026-08-23"))),
		`the scan found no path to the first-run captures — it found:\n${dirs.join("\n")}`,
	);
});

test("every data directory a test reads from is in the repo, whole", () => {
	// Deduped, because the scan reaches a fixture tree through its parents too
	// and a hundred-line repeat of the same hundred files is unreadable.
	const offenders = new Set<string>();
	for (const dir of dataDirs()) {
		const rel = relative(REPO, dir).split(sep).join("/");
		if (git(["ls-files"], dir).length === 0) {
			offenders.add(`  nothing tracked (absent on every other clone): ${rel}/`);
			continue;
		}
		for (const f of git(["ls-files", "--others", "--exclude-standard"], dir)) offenders.add(`  untracked: ${f}`);
		for (const f of git(["ls-files", "--others", "--ignored", "--exclude-standard"], dir)) offenders.add(`  IGNORED: ${f}`);
	}
	const lines = [...offenders].sort();
	const shown = lines.length > 12 ? [...lines.slice(0, 12), `  ... and ${lines.length - 12} more`] : lines;
	assert.equal(
		lines.length,
		0,
		"a test reads data that is not in the repo, so this suite is green only on the machine that made it.\n" +
			"Commit these, or move them out of the ignored tree they are in:\n" +
			shown.join("\n"),
	);
});
