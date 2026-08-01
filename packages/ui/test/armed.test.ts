/**
 * control/armed.ts promises that Escape disarms EVERY armed control on the
 * page, "including ones written later by someone who never read this file".
 * That is only true if every two-step control actually routes through
 * createArmed — so the promise needs a check that can catch one that doesn't.
 *
 * FirmwareUpdateCard was that one: it armed with a raw createSignal, and its
 * next click sends M997. Found by the 2026-07-31 invariant sweep.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC = new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function* walk(dir: string): Generator<string> {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) yield* walk(full);
		else if (/\.tsx?$/.test(entry.name)) yield full;
	}
}

test("no two-step control arms with a raw signal — Escape must reach all of them", () => {
	const offenders: string[] = [];
	for (const file of walk(SRC)) {
		const rel = relative(SRC, file).split(sep).join("/");
		if (rel === "control/armed.ts") continue; // the mechanism itself
		const text = readFileSync(file, "utf8");
		// An `armed` signal produced by anything other than createArmed is a
		// control Escape cannot reach.
		const lines = text.split("\n");
		lines.forEach((line, i) => {
			if (/\[\s*armed\s*,/.test(line) && !line.includes("createArmed")) {
				offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
			}
		});
	}
	assert.deepEqual(
		offenders,
		[],
		"arm through createArmed() so Escape disarms it — a two-step control with no way back is the failure control/armed.ts exists to delete",
	);
});
