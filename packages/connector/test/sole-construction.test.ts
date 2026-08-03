/**
 * Exactly one place constructs a connector, and the concrete dialects are not
 * on the package's public face.
 *
 * Since the connector became its own package, `@dwc-ng/connector` exports no
 * concrete class at all — so a second construction site cannot be written in
 * the app, because the class cannot be named there. What remains reachable is
 * inside THIS package, which is what this scans, plus the deliberate
 * `@dwc-ng/connector/testing` door (checked from the ui side).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
/** The one function allowed to decide which dialect a session speaks. */
const FACTORY = "createConnector.ts";
/** The test-only door; it exists to hand the classes out, so it is not a site. */
const TESTING_DOOR = "testing.ts";
const CONSTRUCTS = /\bnew\s+(Poll|Dsf)Connector\b/;

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
		else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(full);
	}
	return out;
}

test("only createConnector constructs a connector", () => {
	const offenders: string[] = [];
	for (const file of sourceFiles(SRC)) {
		const self = relative(SRC, file).replaceAll("\\", "/");
		if (self === FACTORY || self === TESTING_DOOR) continue;
		readFileSync(file, "utf8").split("\n").forEach((line, i) => {
			const trimmed = line.trimStart();
			// A comment naming the pattern is prose about it, not a use of it.
			if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) return;
			if (CONSTRUCTS.test(line)) offenders.push(`${self}:${i + 1}  ${line.trim()}`);
		});
	}
	assert.deepEqual(offenders, [],
		`exactly one transport may drive the store per session:\n${offenders.join("\n")}`);
});

test("the package's main entry exports no concrete dialect", () => {
	const index = readFileSync(join(SRC, "index.ts"), "utf8");
	for (const name of ["PollConnector", "DsfConnector"]) {
		const exported = new RegExp(`^\\s*export\\s*\\{[^}]*\\b${name}\\b`, "m").test(index);
		assert.equal(exported, false,
			`${name} is exported from the package's main entry — createConnector is meant to be the only way to obtain one`);
	}
});
