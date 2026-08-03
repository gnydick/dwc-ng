/**
 * The fence for "board traffic exists only inside the connector".
 *
 * Since the connector became its own package there is no exception to carve
 * out: @dwc-ng/ui contains no sanctioned transport at all, so ANY fetch or
 * XMLHttpRequest in this package is a finding. The rule got simpler by the
 * boundary moving, which is the usual sign it moved to the right place.
 *
 * It is still a scan rather than a compiler rule, and the reason is recorded
 * on the invariant itself: shadowing the DOM global with `declare const fetch:
 * never` was tried and measured, and does not override lib.dom. The remaining
 * routes are a linter (a dependency, so Gabe's call) or dropping "DOM" from
 * this package's lib, which is a large fragile surface.
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

test("no raw transport anywhere in @dwc-ng/ui — it all belongs to the connector package", () => {
	const offenders: string[] = [];
	// \bfetch( does not match refetch( (no word boundary inside a word) —
	// Solid's resource refetch stays legal everywhere.
	const pattern = /\bfetch\s*\(|XMLHttpRequest/;
	for (const file of walk(SRC)) {
		const rel = relative(SRC, file).split(sep).join("/");
		const lines = readFileSync(file, "utf8").split("\n");
		lines.forEach((line, i) => {
			if (pattern.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
		});
	}
	assert.deepEqual(offenders, [],
		`board traffic belongs to @dwc-ng/connector — route this through the Connector interface:\n${offenders.join("\n")}`);
});
