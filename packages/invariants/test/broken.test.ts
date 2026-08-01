import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBroken, checkBroken, renderDebt, STATUSES } from "../src/broken.ts";
import type { RawBroken } from "../src/broken.ts";

const raw = (over: Partial<RawBroken> = {}): RawBroken => ({
	slug: "sample-defect",
	status: "todo",
	what: "the thing is wrong",
	fix: undefined,
	where: undefined,
	file: "packages/ui/src/files/path.ts",
	line: 10,
	...over,
});

const messages = (input: readonly RawBroken[]): string[] => checkBroken(input).problems.map(p => p.message);

test("a @broken block parses its fields", () => {
	const text = [
		"/**",
		" * @broken seqs-typecheck",
		" * @status todo",
		" * @what tsc reports four TS18048 errors under noUncheckedIndexedAccess",
		" * @fix narrow the optional before comparing",
		" */",
	].join("\n");
	const found = parseBroken(text, "packages/mock-duet/src/x.ts");
	assert.equal(found.length, 1);
	assert.equal(found[0]?.slug, "seqs-typecheck");
	assert.equal(found[0]?.status, "todo");
	assert.match(found[0]?.what ?? "", /TS18048/);
	assert.equal(found[0]?.fix, "narrow the optional before comparing");
});

test("a missing @what is rejected — an entry with no defect is not an entry", () => {
	assert.match(messages([raw({ what: undefined })]).join(), /@what/);
});

test("an unknown @status is rejected rather than rendered as a blank badge", () => {
	assert.match(messages([raw({ status: "kinda-broken" })]).join(), /status/i);
});

test("a missing @status is rejected", () => {
	assert.match(messages([raw({ status: undefined })]).join(), /@status/);
});

test("status fixed requires a @fix — a fix with no account of it is not evidence", () => {
	assert.match(messages([raw({ status: "fixed", fix: undefined })]).join(), /@fix/);
});

test("every documented status is accepted", () => {
	for (const status of STATUSES) {
		const entry = raw({ status, fix: status === "todo" ? undefined : "did the thing" });
		assert.deepEqual(checkBroken([entry]).problems, [], `status "${status}" was rejected`);
	}
});

test("duplicate slugs are rejected", () => {
	assert.match(messages([raw(), raw({ file: "packages/ui/src/om/a.ts" })]).join(), /duplicate/i);
});

test("DEBT.md carries the USER_AUDIT badge legend and the same three columns", () => {
	const out = renderDebt(checkBroken([raw()]).entries);
	assert.match(out, /\| Badge/);
	assert.match(out, /✅ \*\*FIXED\*\*/);
	assert.match(out, /❌ \*\*TODO\*\*/);
	assert.match(out, /\| Status \| Bug \| Fix \|/);
});

test("a row shows its badge, its defect and where it lives", () => {
	const out = renderDebt(checkBroken([raw()]).entries);
	assert.match(out, /❌/);
	assert.match(out, /the thing is wrong/);
	assert.match(out, /packages\/ui\/src\/files\/path\.ts:10/);
});

test("an explicit @where wins over the declaration's own location", () => {
	const out = renderDebt(checkBroken([raw({ where: "packages/mock-duet/test/simulation.test.ts:141" })]).entries);
	assert.match(out, /simulation\.test\.ts:141/);
});

test("a pipe in the text cannot break the table it sits in", () => {
	const out = renderDebt(checkBroken([raw({ what: "a | b" })]).entries);
	assert.match(out, /a \\\| b/); // escaped, so markdown reads it as content
	// Count UNESCAPED pipes: an escaped one is not a column separator, so
	// splitting on raw "|" would count it and measure the wrong thing.
	const row = out.split("\n").find(l => l.includes("a \\| b"));
	assert.notEqual(row, undefined);
	assert.equal((row ?? "").match(/(?<!\\)\|/g)?.length, 4, `row has stray separators: ${row}`);
});

test("output is stable regardless of input order and ends in one newline", () => {
	const a = renderDebt(checkBroken([raw(), raw({ slug: "zzz" })]).entries);
	const b = renderDebt(checkBroken([raw({ slug: "zzz" }), raw()]).entries);
	assert.equal(a, b);
	assert.equal(a.endsWith("\n"), true);
	assert.equal(a.endsWith("\n\n"), false);
});
