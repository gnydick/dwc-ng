/**
 * compose/one-card-delete-surface (declared in CardStudio.tsx): the studio's
 * plan-armed confirm is the only user-facing route to removeCustomCard, so a
 * card deletion cannot reach the config without its blast radius having been
 * computed and shown. This walk rejects any new caller by file and line.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC = new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

// Every entry carries its reason — an allowlist without reasons is how it grows.
const ALLOWED = new Set([
	"config/store.ts", // the store: interface declaration + the one mutator body
	"compose/CardStudio.tsx", // the sole user-facing surface (plan-armed confirm)
	"compose/ComposedScreen.tsx", // import purge: cards embedded in a displaced screen
]);

function* walk(dir: string): Generator<string> {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) yield* walk(full);
		else if (/\.tsx?$/.test(entry.name)) yield full;
	}
}

test("removeCustomCard is reachable only from the store, the studio, and the import purge", () => {
	const offenders: string[] = [];
	for (const file of walk(SRC)) {
		const rel = relative(SRC, file).split(sep).join("/");
		if (ALLOWED.has(rel)) continue;
		readFileSync(file, "utf8").split("\n").forEach((line, i) => {
			if (line.includes("removeCustomCard")) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
		});
	}
	assert.deepEqual(
		offenders,
		[],
		"card deletion goes through the studio's plan-armed confirm — a new delete surface skips the blast-radius report",
	);
});
