/**
 * A declaration names the mechanism that enforces it. If that name does not
 * exist in the code, the declaration is prose wearing a rung number.
 *
 * This is not hypothetical. `compose/additive-placement` was declared against
 * `autoPlace`, a function renamed away in 89e43fb — the stale name lived on in
 * the module's own header, and the 2026-07-31 sweep copied it into the register.
 * The mechanism was real; the citation pointed at nothing. Nobody could have
 * checked the claim by following it.
 *
 * So: every identifier a @rung line cites in backticks must exist somewhere in
 * src. Deliberately loose — it asks whether the name exists at all, not whether
 * it is the right one, because the first question is cheap and mechanical and
 * the second is judgement.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildRegister } from "../src/cli.ts";
import { scanFiles, repoRoot } from "../src/scan.ts";

/**
 * Every identifier-shaped token in `src` CODE — comments stripped first.
 *
 * That stripping is the whole point. The bug this test exists for was a stale
 * name surviving in a doc comment; counting comment text as "the name exists"
 * would make the test agree with exactly the mistake it is meant to catch. The
 * red check below fails if this ever stops being true.
 */
function identifiersInSource(): Set<string> {
	const all = new Set<string>();
	const code = (text: string): string =>
		text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
	for (const word of scanFiles(repoRoot(), text => code(text).match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [])) {
		all.add(word);
	}
	return all;
}

test("every backticked identifier a declaration cites actually exists in src", () => {
	const { declarations } = buildRegister();
	const known = identifiersInSource();
	const dangling: string[] = [];

	for (const d of declarations) {
		// Backticked tokens in the mechanism text are citations of real code.
		for (const cited of d.mechanism.matchAll(/`([A-Za-z_$][A-Za-z0-9_$.]*)`/g)) {
			// Take the head of a dotted path: `cmd.emergencyStop` -> cmd.
			const head = cited[1]!.split(".")[0]!;
			if (!known.has(head)) dangling.push(`${d.id} (${d.file}:${d.line}) cites \`${cited[1]!}\``);
		}
	}

	assert.deepEqual(
		dangling,
		[],
		"a declaration cites a name that is not in src — rename the citation, or the rung is describing something that does not exist",
	);
});

test("RED CHECK: the scan really would catch a dangling citation", () => {
	const known = identifiersInSource();
	assert.equal(known.has("addCard"), true, "a name that DOES exist must be found");
	assert.equal(known.has("autoPlace"), false, "the removed name must NOT be found — otherwise this test proves nothing");
});

test("the register file itself is never hand-edited into disagreement", () => {
	// Cheap belt-and-braces on top of the drift gate: the header must survive.
	const committed = readFileSync(`${repoRoot()}/docs/invariant-register.md`, "utf8");
	assert.match(committed, /DO NOT EDIT/);
});
