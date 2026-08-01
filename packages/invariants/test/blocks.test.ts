import { test } from "node:test";
import assert from "node:assert/strict";
import { readRecords, strayLeads } from "../src/blocks.ts";

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

test("a near-miss tag does not silently overwrite the real one", () => {
	const text = "/**\n * @broken x\n * @what the real text\n * @whatever invented tag\n */";
	assert.equal(readRecords(text, "broken", ["what"])[0]?.fields["what"], "the real text @whatever invented tag");
});

// strayLeads: a declaration the block reader cannot see. Found by writing one
// as a `//` comment and getting no record, no error and no register row.
test("a line-comment declaration is reported, not ignored", () => {
	assert.deepEqual(strayLeads("const a = 1;\n// @invariant escaped-the-block\n", "invariant"), [2]);
});

test("a bare tag line outside any comment is reported", () => {
	assert.deepEqual(strayLeads("@invariant orphaned-by-an-edit\n", "invariant"), [1]);
});

test("a declaration inside a block comment is not a stray", () => {
	assert.deepEqual(strayLeads("/**\n * @invariant properly-declared\n */\n", "invariant"), []);
});

test("prose and string literals mentioning the tag are not strays", () => {
	// render.ts and broken.ts both carry these; a naive scan flags both.
	const text = 'const help = "declare it with an @invariant block";\n// see @invariant handling below\n';
	assert.deepEqual(strayLeads(text, "invariant"), []);
});
