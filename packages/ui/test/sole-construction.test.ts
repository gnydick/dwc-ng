/**
 * Exactly one place in src constructs a connector.
 *
 * connector/sole-construction sits at rung 6 because a choke-point holds only
 * while it is the sole route — and "someone adds a second route" is a fact
 * about source that will be written later, which no runtime mechanism can see.
 * A scan of the source can.
 *
 * Deleting the classes from connector/index.ts (done) means a second site
 * cannot be written against the module's public face. It does NOT stop a file
 * importing ./PollConnector.ts directly, because they live in the same package.
 * Sealing that needs a package boundary; until then this is the check that
 * notices.
 *
 * Scoped to src on purpose: the tests DO construct PollConnector directly
 * against mock-duet, which is legitimate — they are exercising one dialect, not
 * choosing one for a session.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
/** The one function allowed to decide which dialect a session speaks. */
const FACTORY = "connector/createConnector.ts";
const CONSTRUCTS = /\bnew\s+(Poll|Dsf)Connector\b/;

function sourceFiles(): string[] {
	const out: string[] = [];
	const walk = (dir: string): void => {
		for (const name of readdirSync(dir)) {
			const full = join(dir, name);
			if (statSync(full).isDirectory()) walk(full);
			else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(full);
		}
	};
	walk(SRC);
	return out;
}

const rel = (f: string): string => relative(SRC, f).replaceAll("\\", "/");

test("only createConnector constructs a connector", () => {
	const offenders: string[] = [];
	for (const file of sourceFiles()) {
		const self = rel(file);
		if (self === FACTORY) continue;
		readFileSync(file, "utf8").split("\n").forEach((line, i) => {
			const trimmed = line.trimStart();
			// A comment naming the pattern is prose about it, not a use of it —
			// createConnector's own declaration quotes `new PollConnector`.
			if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) return;
			if (CONSTRUCTS.test(line)) offenders.push(`${self}:${i + 1}  ${line.trim()}`);
		});
	}
	assert.deepEqual(offenders, [],
		`exactly one transport may drive the store per session:\n${offenders.join("\n")}`);
});

test("the concrete connectors are not on the module's public face", () => {
	const index = readFileSync(join(SRC, "connector", "index.ts"), "utf8");
	for (const name of ["PollConnector", "DsfConnector"]) {
		const exported = new RegExp(`^\\s*export\\s*\\{[^}]*\\b${name}\\b`, "m").test(index);
		assert.equal(exported, false,
			`${name} is re-exported from connector/index.ts — createConnector is meant to be the only way to obtain one`);
	}
});
