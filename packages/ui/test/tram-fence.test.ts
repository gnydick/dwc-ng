/**
 * The tram-fit modules must not read the height map.
 *
 * tramReply.ts states this in capitals and then relies on everyone reading it,
 * which is rung 0 — and the failure it prevents is silent: a fit that quietly
 * conflates bed SURFACE with gantry TILT still produces plausible numbers, and
 * the numbers it produces are pivot positions the operator would enter into
 * M671. Wrong there, every future tram is wrong.
 *
 * So the rule gets a check. Deliberately shallow: it fences the bed/ modules
 * themselves, not their UI consumers — BedCards renders the map and the tram
 * controls on one screen, legitimately. What must never happen is heightmap
 * data reaching the fit's INPUT, and the fit lives here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BED_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "bed");

test("no bed/ module imports the height map", () => {
	const offenders: string[] = [];
	for (const name of readdirSync(BED_DIR)) {
		if (!name.endsWith(".ts") && !name.endsWith(".tsx")) continue;
		const text = readFileSync(join(BED_DIR, name), "utf8");
		text.split("\n").forEach((line, i) => {
			// An import statement only — the file's own prose explains at length
			// why the map is excluded, and that must not trip its own fence.
			if (/^\s*import\b[^\n]*heightmap/.test(line)) offenders.push(`${name}:${i + 1}  ${line.trim()}`);
		});
	}
	assert.deepEqual(offenders, [], `bed/ must not read the height map:\n${offenders.join("\n")}`);
});
