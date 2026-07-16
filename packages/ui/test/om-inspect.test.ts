import { test } from "node:test";
import assert from "node:assert/strict";
import { valueKind, isExpandable, formatLeaf, summarize, childKeys } from "../src/om/inspect.ts";

test("valueKind classifies object-model values (null before object)", () => {
	assert.equal(valueKind(null), "null");
	assert.equal(valueKind(42), "number");
	assert.equal(valueKind("idle"), "string");
	assert.equal(valueKind(true), "boolean");
	assert.equal(valueKind([1, 2]), "array");
	assert.equal(valueKind({ a: 1 }), "object");
});

test("formatLeaf renders scalars readably, quoting strings", () => {
	assert.equal(formatLeaf(null), "null");
	assert.equal(formatLeaf(42), "42");
	assert.equal(formatLeaf(22.456), "22.456");
	assert.equal(formatLeaf("idle"), '"idle"');
	assert.equal(formatLeaf(true), "true");
});

test("summarize counts children without expanding", () => {
	assert.equal(summarize({ a: 1, b: 2 }), "{2}");
	assert.equal(summarize([1, 2, 3]), "[3]");
	assert.equal(summarize({}), "{}");
	assert.equal(summarize([]), "[]");
});

test("childKeys: object keys sorted, array indices in order, scalars none", () => {
	assert.deepEqual(childKeys({ b: 1, a: 2 }), ["a", "b"]);
	assert.deepEqual(childKeys([9, 8]), ["0", "1"]);
	assert.deepEqual(childKeys(42), []);
	assert.deepEqual(childKeys(null), []);
});

test("isExpandable only for non-empty objects/arrays", () => {
	assert.equal(isExpandable({ a: 1 }), true);
	assert.equal(isExpandable([1]), true);
	assert.equal(isExpandable({}), false);
	assert.equal(isExpandable([]), false);
	assert.equal(isExpandable(null), false);
	assert.equal(isExpandable(5), false);
});
