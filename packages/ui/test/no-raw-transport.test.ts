/**
 * The rung-4 fence for invariant "board traffic exists only inside the
 * connector" (audit L3). TS-private fields stop nothing at runtime and no
 * lint layer exists (adding ESLint means a dependency), so this test IS
 * the static rule: raw fetch()/XMLHttpRequest anywhere in src outside
 * src/connector/ fails the suite with the offending file:line. The
 * connector's four internal fetch sites and the stub/emergency paths are
 * the only sanctioned raw-transport code.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC = new URL("../src", import.meta.url).pathname
	// Windows: strip the leading slash of /N:/… and normalize.
	.replace(/^\/([A-Za-z]:)/, "$1");

function* walk(dir: string): Generator<string> {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) yield* walk(full);
		else if (/\.(ts|tsx)$/.test(entry.name)) yield full;
	}
}

test("raw transport (fetch/XMLHttpRequest) lives only in src/connector/", () => {
	const offenders: string[] = [];
	// \bfetch( does not match refetch( (no word boundary inside a word) —
	// Solid's resource refetch stays legal everywhere.
	const pattern = /\bfetch\s*\(|XMLHttpRequest/;
	for (const file of walk(SRC)) {
		const rel = relative(SRC, file).split(sep).join("/");
		if (rel.startsWith("connector/")) continue;
		const lines = readFileSync(file, "utf8").split("\n");
		lines.forEach((line, i) => {
			if (pattern.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
		});
	}
	assert.deepEqual(offenders, [], "board traffic must go through the connector — move this into src/connector/ or route it through the Connector interface");
});
