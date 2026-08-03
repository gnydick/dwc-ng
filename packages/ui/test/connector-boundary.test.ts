/**
 * The app talks to the board through the package's front door only.
 *
 * `@dwc-ng/connector` exports no concrete dialect, so a second construction
 * site cannot be written here — the class cannot be named. The one way back in
 * is `@dwc-ng/connector/testing`, which exists so tests can drive a dialect
 * against mock-duet. This is what keeps that door test-only.
 *
 * Worth being precise about what changed: before the package split, "no second
 * construction site" was a scan over one directory in one package, and any file
 * could have imported the class directly. Now the export map does the work and
 * this scan guards the single named exception, which is a much smaller thing to
 * watch.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
		else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(full);
	}
	return out;
}

test("application code never reaches for the test-only dialect door", () => {
	const offenders: string[] = [];
	for (const file of sourceFiles(SRC)) {
		readFileSync(file, "utf8").split("\n").forEach((line, i) => {
			if (line.includes("@dwc-ng/connector/testing")) {
				offenders.push(`${relative(SRC, file).replaceAll("\\", "/")}:${i + 1}  ${line.trim()}`);
			}
		});
	}
	assert.deepEqual(offenders, [],
		`the /testing entry hands out concrete dialects and is for tests only:\n${offenders.join("\n")}`);
});

test("createConnector is what the app imports", async () => {
	const mod: Record<string, unknown> = await import("@dwc-ng/connector");
	assert.equal(typeof mod["createConnector"], "function", "the front door is open");
	assert.equal(mod["PollConnector"], undefined, "and the concrete dialects are not behind it");
	assert.equal(mod["DsfConnector"], undefined);
});
