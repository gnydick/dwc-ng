/**
 * Which line of `tpost<N>.g` is the shaper.
 *
 * This is a READER today (the status card shows what the machine will run on
 * the next toolchange) and a WRITER at task G2 (Apply rewrites that line). The
 * two must agree about which line they mean, so the predicate is one function
 * with tests rather than a regex written twice — a reader that skipped a
 * commented-out attempt while the writer replaced it would show one line and
 * edit another.
 *
 * Shapes below are the real ones: a tuning macro accumulates commented-out
 * attempts above the live line, which is what Gabe's tpost files look like.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { findShapingLine, toolMacroPath } from "../src/shaping/toolMacro.ts";

test("the path is the firmware's per-tool post-select macro", () => {
	assert.equal(toolMacroPath(0), "0:/sys/tpost0.g");
	assert.equal(toolMacroPath(3), "0:/sys/tpost3.g");
});

test("finds the active line in a file that has one", () => {
	const text = [
		"; tool 0 post-select",
		"M116 P0",
		'M593 P"ei2" F52 S0.1',
		"G10 P0",
		"",
	].join("\n");
	assert.equal(findShapingLine(text), 'M593 P"ei2" F52 S0.1');
});

test("ignores commented-out attempts, however they are spaced", () => {
	const text = [
		';M593 P"zvd" F52 S0.1',
		'  ; M593 P"zvdd" F17.5 S0.2   ; this one added a 38 Hz ring',
		"\t;M593 P\"mzv\" F13 S0.05",
		'M593 P"ei2" F52 S0.1',
	].join("\n");
	assert.equal(findShapingLine(text), 'M593 P"ei2" F52 S0.1');
});

test("a file with only commented-out attempts has no active line", () => {
	assert.equal(findShapingLine(';M593 P"zvd" F52 S0.1\nG10 P0\n'), null);
});

test("a file with no M593 at all has no active line", () => {
	assert.equal(findShapingLine("M116 P0\nG10 P0\n"), null);
	assert.equal(findShapingLine(""), null);
});

test("the LAST active line wins — the firmware executes top to bottom", () => {
	const text = 'M593 P"zvd" F52 S0.1\nM593 P"ei2" F52 S0.1\n';
	assert.equal(findShapingLine(text), 'M593 P"ei2" F52 S0.1');
});

test("returns the line verbatim, indentation trimmed and nothing else touched", () => {
	assert.equal(findShapingLine('\t  M593 P"custom" H0.3350:0.2641 T0.00972:0.02780  '), 'M593 P"custom" H0.3350:0.2641 T0.00972:0.02780');
});

test("CRLF files are read the same way", () => {
	assert.equal(findShapingLine('M116 P0\r\nM593 P"ei2" F52 S0.1\r\n'), 'M593 P"ei2" F52 S0.1');
});

test("a bare M593 is the active line — it is a report, but it is still the one there", () => {
	assert.equal(findShapingLine("M593\n"), "M593");
});

test("a different code that merely starts with the digits is not a match", () => {
	assert.equal(findShapingLine("M5931 P0\nM59 P1\n"), null);
});

test("case follows RRF, which does not care", () => {
	assert.equal(findShapingLine('m593 p"ei2" f52 s0.1'), 'm593 p"ei2" f52 s0.1');
});
