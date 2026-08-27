/**
 * The G28 axis-set fence (invariant `mock-duet/g28-axis-set-from-model`,
 * declared beside the `case "G28":` handler in src/gcode.ts).
 *
 * Rule: the G28 case may not state an axis letter as a literal. The set of
 * axes it can act on comes from `om.move.axes` — the object model the mock
 * itself serves — and nowhere else. A second, independent statement of "what
 * axes exist" (`["X","Y","Z"]`, `letter === "X"`, ...) is exactly the defect
 * this invariant closes (GIT_102/#102): the bundled 7-axis toolchanger
 * capture (X Y Z U V W C) had no route to U/V/W/C through the old literal,
 * and an unrecognised letter fell back to homing X/Y/Z instead of erroring.
 *
 * The rule is a pure predicate over the case's own source text, so the red
 * checks below can feed it offending text that is not on disk and prove it
 * bites — a rule proven only by "the tree is clean today" fences an empty
 * field.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const GCODE_TS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "gcode.ts");

/** A quoted single letter — "X", 'x', … — the shape a hardcoded axis takes. */
const AXIS_LITERAL = /["'][A-Za-z]["']/;

/** Everything between the `case "G28":` label and that case's closing brace. */
function g28CaseBody(source: string): string {
	const label = 'case "G28":';
	const start = source.indexOf(label);
	if (start === -1) throw new Error('no `case "G28":` found in gcode.ts — has the handler been renamed?');
	const braceOpen = source.indexOf("{", start);
	let depth = 0;
	for (let i = braceOpen; i < source.length; i++) {
		if (source[i] === "{") depth++;
		else if (source[i] === "}") {
			depth--;
			if (depth === 0) return source.slice(braceOpen, i + 1);
		}
	}
	throw new Error("unbalanced braces while scanning the G28 case");
}

/** The rule, as a pure predicate over one case body's text. */
function axisLiteralViolations(body: string): string[] {
	const out: string[] = [];
	body.split("\n").forEach((line, i) => {
		const trimmed = line.trimStart();
		if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return; // commentary, not code
		if (AXIS_LITERAL.test(line)) out.push(`line ${i + 1}: ${line.trim()}`);
	});
	return out;
}

test("G28's case body carries no quoted axis-letter literal", () => {
	const source = readFileSync(GCODE_TS, "utf8");
	const body = g28CaseBody(source);
	assert.ok(body.length > 50, "expected to find a non-trivial G28 case body");
	assert.deepEqual(axisLiteralViolations(body), [], "G28 must derive its axis set from om.move.axes, never a literal");
});

// ---- red checks: prove the rule bites on text that is not on disk ----

test("red check: a hardcoded axis array is rejected", () => {
	const bad = '{\n\tconst toHome = ["X", "Y", "Z"];\n}';
	assert.equal(axisLiteralViolations(bad).length, 1, "the offending line is reported");
});

test("red check: a single-letter equality check is rejected", () => {
	const bad = '{\n\tif (axis.letter === "U") axis.homed = true;\n}';
	assert.equal(axisLiteralViolations(bad).length, 1);
});

test("red check: deriving the set from om.move.axes is clean", () => {
	const good =
		"{\n\tfor (const axis of om.move.axes) {\n\t\tif (requested.includes(axis.letter)) homeAxis(axis);\n\t}\n}";
	assert.deepEqual(axisLiteralViolations(good), []);
});

test("red check: commentary mentioning a letter is prose, not code", () => {
	const good = '{\n\t// the old code checked ["X", "Y", "Z"] here\n}';
	assert.deepEqual(axisLiteralViolations(good), []);
});

test("the fence finds the real handler, not an empty match", () => {
	const source = readFileSync(GCODE_TS, "utf8");
	const body = g28CaseBody(source);
	assert.match(body, /om\.move\.axes/, "the real handler must read om.move.axes");
});
