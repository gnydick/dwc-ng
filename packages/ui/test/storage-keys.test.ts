/**
 * Machine-scoped storage has exactly one legitimate producer:
 * config/machineStore.ts (openMachineStore). This lint is a plain substring
 * scan over packages/ui/src: it matches each name in MACHINE_SCOPED as bare
 * text anywhere in a file's contents, not only inside a double-quoted
 * string literal. That is deliberate — it catches the name inside a
 * backtick template literal, a single-quoted string, or a prose comment
 * (that is how compose/screens.ts fails today; see the skip reason below).
 *
 * It is NOT a parser and does NOT prove every machine-scoped byte flows
 * through the one door. Known, real gaps:
 *   - string concatenation that never holds an unbroken copy of the name
 *     (`"dwc-ng." + "console"`, or building a prefix from a constant and
 *     appending a suffix) is invisible to a substring match;
 *   - a key already defined in an ALLOWED file and merely re-exported or
 *     imported elsewhere carries no literal at the import site, so that
 *     call site is invisible too;
 *   - only `.ts`/`.tsx` files under packages/ui/src are walked — a `.json`,
 *     a `.css` file, a build config, or another package entirely is out of
 *     scope.
 * This lint raises the cost of retyping a known key string in a new file.
 * The stronger claim — that ALL machine-scoped storage flows through
 * MachineStore — still rests on openMachineStore()'s rung-6 choke-point in
 * config/machineStore.ts and the @debt recorded there, not on this test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

/** Names spec §4 puts on the machine side. Person keys are unrestricted. */
const MACHINE_SCOPED = ["dwc-ng.config", "dwc-ng.drafts", "dwc-ng.cmdHistory", "dwc-ng.console", "dwc-ng.canvas."];

/**
 * The door itself, plus the migration that must name the old keys to retire
 * them, plus Card Lab — a dev-only bench with no machine behind it (its
 * canvas key is an isolated sandbox, never a saved layout for a real
 * screen), so it is exempt on the merits rather than grandfathered debt.
 */
const ALLOWED = ["config/machineStore.ts", "config/migrateStorage.ts", "dev/CardLab.tsx"];

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) walk(full, out);
		else if (/\.tsx?$/.test(entry)) out.push(full);
	}
	return out;
}

test("no machine-scoped storage key literal lives outside config/machineStore.ts", () => {
	const offenders: string[] = [];
	for (const file of walk(SRC)) {
		const rel = file.slice(SRC.length).replace(/\\/g, "/");
		// Anchored on a path separator (or an exact match), not a bare suffix —
		// "src/otherconfig/machineStore.ts" must not ride in on the allowlist
		// entry for "config/machineStore.ts".
		if (ALLOWED.some(a => rel === a || rel.endsWith(`/${a}`))) continue;
		const text = readFileSync(file, "utf8");
		for (const key of MACHINE_SCOPED) {
			// Bare substring match — no quote-character requirement. A quote
			// prefix would make the check blind to backtick template literals,
			// single-quoted strings, and comments, which is a structural hole,
			// not a coverage gap (see header).
			if (text.includes(key)) offenders.push(`${rel}: ${key}`);
		}
	}
	assert.deepEqual(offenders, [], `machine-scoped keys must go through openMachineStore():\n${offenders.join("\n")}`);
});

test("walk() actually descends into subdirectories and finds a planted violation", () => {
	// Exercises the REAL walk() against a throwaway fixture tree, not a
	// restatement of the matcher predicate. A regression that stopped walk()
	// recursing (e.g. dropping the `walk(full, out)` call, or returning early)
	// would leave a hand-rolled "does this string match" test green forever
	// while detection silently died on every real file. This one goes red
	// with that regression — see the falsification record in the task report.
	const root = mkdtempSync(join(tmpdir(), "storage-keys-fixture-"));
	try {
		const nested = join(root, "a", "b");
		mkdirSync(nested, { recursive: true });
		writeFileSync(join(nested, "sneaky.ts"), 'const k = "dwc-ng.console";');
		// A decoy at the top level so a walk() that only reads its starting
		// directory (never recursing) would still "find something" and mask
		// the exact regression this test exists to catch.
		writeFileSync(join(root, "decoy.ts"), "export const harmless = 1;");

		const found = walk(root);
		const hit = found.find(f => readFileSync(f, "utf8").includes("dwc-ng.console"));

		assert.ok(hit, `walk() must find the fixture planted two directories deep; found files: ${found.join(", ")}`);
		assert.ok(hit!.endsWith(join("a", "b", "sneaky.ts")), hit);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
