/**
 * Rewriting a tool macro's shaping line without damaging the file around it.
 *
 * Every case here is a `tpost<N>.g` somebody hand-wrote. The reader and the
 * writer share one rule — last non-comment `M593` wins — and the pairs below
 * assert them against the SAME text, because the failure that matters is not
 * either one being wrong on its own but the two disagreeing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { findShapingLine, replaceShapingLine, toolMacroPath } from "../src/shaping/toolMacro.ts";

const NEW = 'M593 P"ei2" F51.5 S0.05';

test("the path has one spelling", () => {
	assert.equal(toolMacroPath(0), "0:/sys/tpost0.g");
	assert.equal(toolMacroPath(3), "0:/sys/tpost3.g");
});

test("the active line is replaced and everything else survives", () => {
	const before = [
		"; tool 0 post-select",
		"G10 P0 S200",
		'M593 P"zvd" F52 S0.1',
		"M106 P0 S255",
	].join("\n");
	const after = replaceShapingLine(before, NEW);
	assert.equal(findShapingLine(after), NEW);
	assert.match(after, /; tool 0 post-select/);
	assert.match(after, /G10 P0 S200/);
	assert.match(after, /M106 P0 S255/);
	assert.doesNotMatch(after, /zvd/);
});

test("a commented-out attempt is not the line, and is not touched", () => {
	// The normal shape of a file somebody has been iterating in.
	const before = [
		';M593 P"zvdd" F17.5 S0.2',
		';M593 P"custom" H0.1:0.2 T0.01:0.02',
		'M593 P"zvd" F52 S0.1',
	].join("\n");
	assert.equal(findShapingLine(before), 'M593 P"zvd" F52 S0.1');
	const after = replaceShapingLine(before, NEW);
	assert.equal(findShapingLine(after), NEW);
	// The history stays.
	assert.match(after, /;M593 P"zvdd" F17\.5 S0\.2/);
	assert.match(after, /;M593 P"custom"/);
});

test("the LAST active line is the one replaced, matching the reader", () => {
	const before = ['M593 P"zvd" F40 S0.1', "G4 P10", 'M593 P"zvdd" F52 S0.1'].join("\n");
	assert.equal(findShapingLine(before), 'M593 P"zvdd" F52 S0.1');
	const after = replaceShapingLine(before, NEW);
	// The earlier one is untouched — it was already dead code under the
	// firmware's own top-to-bottom rule, and silently deleting somebody's line
	// is not this function's job.
	assert.match(after, /M593 P"zvd" F40 S0\.1/);
	assert.equal(findShapingLine(after), NEW);
});

test("indentation is preserved", () => {
	// tpost macros are often written inside an if-block, and a de-indented line
	// changes which branch it belongs to.
	const before = ['if sensors.probes[0].value[0] < 100', '\tM593 P"zvd" F52 S0.1', "\tG4 P10"].join("\n");
	const after = replaceShapingLine(before, NEW);
	assert.match(after, new RegExp(`\\n\\t${NEW.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("CRLF files stay CRLF and LF files stay LF", () => {
	// Rewriting the endings turns a one-line change into a whole-file diff.
	const crlf = ['; head', 'M593 P"zvd" F52 S0.1', "G4 P10"].join("\r\n");
	const out = replaceShapingLine(crlf, NEW);
	assert.ok(out.includes("\r\n"), "CRLF lost");
	assert.doesNotMatch(out, /[^\r]\n/, "a bare LF crept in");

	const lf = ['; head', 'M593 P"zvd" F52 S0.1', "G4 P10"].join("\n");
	assert.ok(!replaceShapingLine(lf, NEW).includes("\r"), "CR crept in");
});

test("a file with no shaping line gets one appended, and it is then the active one", () => {
	const before = "; tool 2 post-select\nG10 P2 S205\n";
	const after = replaceShapingLine(before, NEW);
	assert.equal(findShapingLine(after), NEW, "appended line must read back as active");
	assert.match(after, /G10 P2 S205/);
	// Exactly one trailing newline, not two.
	assert.ok(after.endsWith("\n"));
	assert.ok(!after.endsWith("\n\n"));
});

test("an empty file gets the line and nothing else", () => {
	const after = replaceShapingLine("", NEW);
	assert.equal(findShapingLine(after), NEW);
	assert.equal(after.trim(), NEW);
});

test("replacing twice is idempotent in shape", () => {
	// Applying, changing your mind, applying again must not accumulate lines.
	const before = 'M593 P"zvd" F52 S0.1\n';
	const once = replaceShapingLine(before, NEW);
	const twice = replaceShapingLine(once, NEW);
	assert.equal(once, twice);
	assert.equal((twice.match(/^M593/gm) ?? []).length, 1);
});
