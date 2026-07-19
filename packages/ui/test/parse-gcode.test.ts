import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGcode } from "../src/gcode/parseGcode.ts";

test("parses linear G1 moves into one segment per move", () => {
	const gcode = "G1 X10 Y0 Z0.2 E1\nG1 X10 Y10 E2\n";
	const result = parseGcode(gcode);
	assert.equal(result.segmentCount, 2);
	assert.equal(result.positions.length, 2 * 6);
	// Expected values are round-tripped through Float32Array too, so the
	// comparison is exact despite 0.2 not being representable in binary
	// floating point (both sides lose the same precision the same way).
	// segment 0: (0,0,0) -> (10,0,0.2)
	assert.deepEqual(Array.from(result.positions.slice(0, 6)), Array.from(new Float32Array([0, 0, 0, 10, 0, 0.2])));
	// segment 1: (10,0,0.2) -> (10,10,0.2)
	assert.deepEqual(Array.from(result.positions.slice(6, 12)), Array.from(new Float32Array([10, 0, 0.2, 10, 10, 0.2])));
});

test("marks moves with increasing E as extruding, others as travel", () => {
	const gcode = "G0 X5 Y5\nG1 X10 Y10 E1\n";
	const result = parseGcode(gcode);
	assert.deepEqual(Array.from(result.extruding), [0, 1]);
});

test("increments layer on a Z change between extruding moves, ignores travel-only Z hops", () => {
	const gcode = [
		"G1 X0 Y0 Z0.2 E1",   // layer 0 (first extrude sets the baseline, no increment)
		"G0 Z5",              // travel Z hop — must NOT bump the layer
		"G0 Z0.2",            // travel back down — must NOT bump the layer
		"G1 X10 Y0 E2",       // still layer 0 (same Z as the last extrude)
		"G1 X10 Y0 Z0.4 E3",  // layer 1 (new Z on an extruding move)
	].join("\n");
	const result = parseGcode(gcode);
	assert.deepEqual(Array.from(result.layerIndex), [0, 0, 0, 0, 1]);
	assert.equal(result.layerCount, 2);
});

test("treats G2/G3 arcs as a chord to their endpoint, ignoring I/J", () => {
	const gcode = "G1 X0 Y0 E1\nG2 X10 Y0 I5 J5 E2\n";
	const result = parseGcode(gcode);
	assert.equal(result.segmentCount, 2);
	assert.deepEqual(Array.from(result.positions.slice(6, 12)), [0, 0, 0, 10, 0, 0]);
});

test("respects G91 relative positioning and M83 relative extrusion", () => {
	const gcode = "G91\nM83\nG1 X10 Y0 E1\nG1 X0 Y10 E1\n";
	const result = parseGcode(gcode);
	assert.deepEqual(Array.from(result.positions.slice(0, 6)), [0, 0, 0, 10, 0, 0]);
	assert.deepEqual(Array.from(result.positions.slice(6, 12)), [10, 0, 0, 10, 10, 0]);
	assert.deepEqual(Array.from(result.extruding), [1, 1]);
});

test("byteOffset is monotonically non-decreasing and tracks cumulative line length", () => {
	const gcode = "G1 X1 E1\nG1 X2 E2\nG1 X3 E3\n";
	const result = parseGcode(gcode);
	for (let i = 1; i < result.byteOffset.length; i++) {
		assert.ok(result.byteOffset[i]! >= result.byteOffset[i - 1]!);
	}
	assert.equal(result.byteOffset[0], "G1 X1 E1".length + 1);
});

test("byteOffset does not overcount the final line when the text has no trailing newline", () => {
	const gcode = "G1 X1 E1\nG1 X2 E2"; // note: no trailing \n
	const result = parseGcode(gcode);
	assert.equal(result.byteOffset[0], "G1 X1 E1".length + 1);
	assert.equal(result.byteOffset[1], gcode.length); // no +1 — nothing follows the last line
});

test("strips ; and (...) comments without producing segments for comment-only lines", () => {
	const gcode = "; header comment\nG1 X10 E1 ; move to 10\n(a paren comment)\nG1 X20 E2\n";
	const result = parseGcode(gcode);
	assert.equal(result.segmentCount, 2);
});

test("empty input produces an empty, valid toolpath", () => {
	const result = parseGcode("");
	assert.equal(result.segmentCount, 0);
	assert.equal(result.layerCount, 0);
	assert.equal(result.positions.length, 0);
});
