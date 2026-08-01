import { test } from "node:test";
import assert from "node:assert/strict";
import { readRecords } from "../src/blocks.ts";

test("prose that merely MENTIONS the lead tag at line start is not a record", () => {
	const text = "/**\n * Both @invariant and\n * @broken need exactly this, and it is not a declaration.\n */";
	assert.deepEqual(readRecords(text, "broken", ["status", "what"]), []);
});

test("a single malformed token is still reported as an attempted record", () => {
	const text = "/**\n * @broken Not_Kebab\n * @status todo\n * @what x\n */";
	assert.equal(readRecords(text, "broken", ["status", "what"])[0]?.lead, "Not_Kebab");
});

test("a well-formed record is unaffected", () => {
	const text = "/**\n * @broken real-defect\n * @status todo\n * @what it is wrong\n */";
	const found = readRecords(text, "broken", ["status", "what"]);
	assert.equal(found[0]?.lead, "real-defect");
	assert.equal(found[0]?.fields["what"], "it is wrong");
});
