import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAll } from "../src/check.ts";
import type { RawDeclaration } from "../src/parse.ts";

const raw = (over: Partial<RawDeclaration> = {}): RawDeclaration => ({
	slug: "sample",
	rung: "7  sole-constructor type — the only producer is parseX",
	why: "something bad cannot happen",
	debt: undefined,
	file: "packages/ui/src/files/path.ts",
	line: 10,
	...over,
});

const messages = (input: readonly RawDeclaration[]): string[] =>
	checkAll(input).problems.map(p => p.message);

test("a good declaration validates and gets its derived id", () => {
	const { declarations, problems } = checkAll([raw()]);
	assert.deepEqual(problems, []);
	assert.equal(declarations[0]?.id, "files/sample");
	assert.equal(declarations[0]?.namespace, "files");
	assert.equal(declarations[0]?.rung, 7);
	assert.equal(declarations[0]?.mechanism, "sole-constructor type — the only producer is parseX");
});

test("a duplicate id within one namespace is rejected", () => {
	const both = [raw(), raw({ file: "packages/ui/src/files/other.ts", line: 3 })];
	assert.match(messages(both).join(), /duplicate/i);
});

test("the same slug in DIFFERENT namespaces is fine", () => {
	const ok = [raw(), raw({ file: "packages/ui/src/om/estimates.ts" })];
	assert.deepEqual(checkAll(ok).problems, []);
});

test("a missing @rung is rejected", () => {
	assert.match(messages([raw({ rung: undefined })]).join(), /@rung/);
});

test("a missing @why is rejected", () => {
	assert.match(messages([raw({ why: undefined })]).join(), /@why/);
});

test("a rung outside 0-8 is rejected", () => {
	assert.match(messages([raw({ rung: "9 something" })]).join(), /0-8/);
});

test("a rung number with no named mechanism is rejected", () => {
	assert.match(messages([raw({ rung: "7" })]).join(), /mechanism/i);
});

test("rung below 6 with no @debt is rejected", () => {
	assert.match(messages([raw({ rung: "3  a test pins it" })]).join(), /@debt/);
});

test("rung below 6 WITH a promotion is accepted as filed debt", () => {
	const debt = raw({ rung: "3  a test pins it", debt: "brand the parameter so a bypass is a compile error" });
	assert.deepEqual(checkAll([debt]).problems, []);
	assert.equal(checkAll([debt]).declarations[0]?.debt, "brand the parameter so a bypass is a compile error");
});

test("@debt on a rung >= 6 declaration is rejected — there is nothing to promote", () => {
	assert.match(messages([raw({ debt: "tidy this up sometime" })]).join(), /rung 6/);
});

test("an empty @debt is not a promotion", () => {
	assert.match(messages([raw({ rung: "2 an assert", debt: "" })]).join(), /@debt/);
});

test("a non-kebab slug is rejected rather than normalised", () => {
	assert.match(messages([raw({ slug: "Path Escape" })]).join(), /kebab/i);
});

test("a declaration outside packages/ is reported, not thrown", () => {
	assert.match(messages([raw({ file: "docs/notes.md" })]).join(), /not under packages/);
});
