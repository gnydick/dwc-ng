import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAll } from "../src/check.ts";
import { renderRegister } from "../src/render.ts";
import type { RawDeclaration } from "../src/parse.ts";

const raw = (over: Partial<RawDeclaration> = {}): RawDeclaration => ({
	slug: "sample",
	rung: "7  brand — one producer",
	why: "a bad state cannot be written",
	debt: undefined,
	file: "packages/ui/src/files/path.ts",
	line: 10,
	...over,
});

const render = (input: readonly RawDeclaration[], ceiling = 0): string =>
	renderRegister(checkAll(input).declarations, ceiling);

test("the generated header warns the file is not to be edited", () => {
	assert.match(render([raw()]), /DO NOT EDIT/);
});

test("the preamble states the honest limit on discovery", () => {
	assert.match(render([raw()]), /completeness of discovery is rung 4/i);
});

test("declarations are grouped under their namespace with id, rung and why", () => {
	const out = render([raw()]);
	assert.match(out, /## files/);
	assert.match(out, /files\/sample/);
	assert.match(out, /rung 7/);
	assert.match(out, /a bad state cannot be written/);
});

test("a debt row shows its promotion so the reader sees the way out", () => {
	const out = render([raw({ rung: "3  a test pins it", debt: "brand the parameter" })], 1);
	assert.match(out, /brand the parameter/);
});

test("totals count the debts and name the ceiling", () => {
	const out = render([raw(), raw({ slug: "other", rung: "2  an assert", debt: "seal the route" })], 4);
	assert.match(out, /2 invariants/);
	assert.match(out, /1 below rung 6/);
	assert.match(out, /ceiling 4/);
});

test("output is stable regardless of input order, and ends in one newline", () => {
	const a = render([raw(), raw({ slug: "zzz" })]);
	const b = render([raw({ slug: "zzz" }), raw()]);
	assert.equal(a, b);
	assert.equal(a.endsWith("\n"), true);
	assert.equal(a.endsWith("\n\n"), false);
});

test("an empty register still renders its header and honest totals", () => {
	const out = renderRegister([], 0);
	assert.match(out, /DO NOT EDIT/);
	assert.match(out, /0 invariants/);
});
