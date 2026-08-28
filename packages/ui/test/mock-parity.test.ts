// GIT_92 requirement 5 — docs/mock-parity.md enumerates where mock-duet and a
// real board differ, so the gap is visible rather than rediscovered per feature.
//
// A prose parity list has one failure mode: it goes stale, and a stale one is
// worse than none, because it is READ as current. The section that would hurt
// most is §1, the G-codes the UI emits that the mock silently no-ops — an
// unhandled code returns `{"err":0}` with an empty reply, so it is
// indistinguishable from success and a UAT pass over those controls is evidence
// of nothing. That table is pinned here in both directions.
//
// This test does NOT try to check the whole document. Most of it is judgement
// (what the real firmware does, what is deliberately absent) that no scan can
// verify. It checks the one table whose facts live in this repo and change
// under our own hands.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/**
 * The codes `mock-duet` actually executes.
 *
 * Taken from the `case "…":` labels of its command switch. A code reachable any
 * other way would be missed — which is why the assertions below are phrased as
 * "the doc's list is right about these codes" rather than "this is every code",
 * a claim this scan cannot support.
 */
function executedByMock(): Set<string> {
	const src = read("../../mock-duet/src/gcode.ts");
	const out = new Set<string>();
	for (const m of src.matchAll(/case\s+"([GMT]\d+)"/g)) out.add(m[1]!);
	return out;
}

/**
 * The codes the UI emits, from the sole place it spells them
 * (`control/commands.ts` — CLAUDE.md's standing rule is that the emitted form
 * lives there and nowhere else). Both quoting styles: plain strings and the
 * `gc` tagged template.
 */
function emittedByUi(): Set<string> {
	const src = read("../src/control/commands.ts");
	const out = new Set<string>();
	for (const m of src.matchAll(/["`]([GMT]\d+)\b/g)) out.add(m[1]!);
	return out;
}

/** The codes §1's table names as emitted-but-not-executed. */
function documentedGap(): Set<string> {
	const doc = read("../../../docs/mock-parity.md");
	const section = doc.slice(doc.indexOf("## 1."), doc.indexOf("## 2."));
	const out = new Set<string>();
	for (const line of section.split(/\r?\n/)) {
		if (!line.startsWith("| `")) continue;
		for (const m of line.matchAll(/`([GMT]\d+)`/g)) out.add(m[1]!);
	}
	return out;
}

test("every code docs/mock-parity.md §1 calls unexecuted really is unexecuted", () => {
	// The direction that protects a reader: if the mock LEARNS one of these and
	// nobody updates the doc, a future session reads "cannot be verified on the
	// mock" about a control that now can be — and skips the check.
	const executed = executedByMock();
	const stale = [...documentedGap()].filter(code => executed.has(code));
	assert.deepEqual(stale, [], `mock-duet now executes ${stale.join(", ")} — remove it from docs/mock-parity.md §1`);
});

test("no code the UI emits is missing from either §1's table or the executed list", () => {
	// The other direction: a NEW control emitting a code the mock ignores must
	// not join the silent-no-op set unrecorded. This is the check that would
	// have caught #102's class before the owner did.
	const executed = executedByMock();
	const documented = documentedGap();
	const unaccounted = [...emittedByUi()]
		.filter(code => !executed.has(code) && !documented.has(code))
		.sort();
	assert.deepEqual(
		unaccounted,
		[],
		`the UI emits ${unaccounted.join(", ")}, which mock-duet does not execute and docs/mock-parity.md §1 does not list. `
		+ "Either teach the mock the code, or add a row saying it cannot be verified there.",
	);
});

test("§1's table is not empty, so a broken scan fails loudly rather than passing", () => {
	// Both assertions above are vacuously true if the parsers stop matching —
	// a renamed file, a reformatted table, a switch rewritten as an if-chain.
	// This is the tripwire for that, and the reason the numbers are asserted
	// rather than merely non-zero.
	assert.ok(documentedGap().size >= 9, `§1 should list the known gap; parsed ${documentedGap().size} codes`);
	assert.ok(executedByMock().size >= 35, `the mock's switch should be found; parsed ${executedByMock().size} codes`);
	assert.ok(emittedByUi().size >= 20, `commands.ts should be found; parsed ${emittedByUi().size} codes`);
});
