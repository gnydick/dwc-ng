import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGcode } from "../src/gcode/parseGcode.ts";
import { mapLabelToFeatureType, UNKNOWN_FEATURE_TYPE } from "../src/gcode/featureTypes.ts";

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

test("tracks F (speed) across lines, persisting until changed", () => {
	const gcode = "G1 F1500 X10 E1\nG1 X20 E2\nG1 F3000 X30 E3\n";
	const result = parseGcode(gcode);
	assert.deepEqual(Array.from(result.speed), [1500, 1500, 3000]);
});

test("tracks ;TYPE: comments, applying to every move until the next tag", () => {
	const gcode = ";TYPE:Skirt\nG1 X10 E1\n;TYPE:Perimeter\nG1 X20 E2\nG1 X30 E3\n";
	const result = parseGcode(gcode);
	assert.deepEqual(Array.from(result.featureType), [
		mapLabelToFeatureType("Skirt"),
		mapLabelToFeatureType("Perimeter"),
		mapLabelToFeatureType("Perimeter"),
	]);
});

test("defaults to Unknown feature type when no ;TYPE: tag has appeared yet", () => {
	const gcode = "G1 X10 E1\n";
	const result = parseGcode(gcode);
	assert.deepEqual(Array.from(result.featureType), [UNKNOWN_FEATURE_TYPE]);
});

test("computes deltaE per segment (0 for travel, positive for extrusion)", () => {
	const gcode = "G0 X5 Y5\nG1 X10 Y10 E2\n";
	const result = parseGcode(gcode);
	assert.deepEqual(Array.from(result.deltaE), [0, 2]);
});

test("computes layerHeights per layer: first layer is its own Z, later layers are the Z delta", () => {
	const gcode = [
		"G1 X0 Y0 Z0.2 E1",
		"G1 X10 Y0 Z0.4 E2",
		"G1 X10 Y0 Z0.6 E3",
	].join("\n");
	const result = parseGcode(gcode);
	assert.deepEqual(Array.from(result.layerHeights), Array.from(new Float32Array([0.2, 0.2, 0.2])));
});

test("derives per-layer time from M73 R values bracketing each ;LAYER_CHANGE", () => {
	const gcode = [
		"M73 P0 R10",
		";LAYER_CHANGE",
		"G1 X0 Y0 Z0.2 E1",
		"M73 P50 R6",
		";LAYER_CHANGE",
		"G1 X10 Y0 Z0.4 E2",
		"M73 P100 R0",
	].join("\n");
	const result = parseGcode(gcode);
	// layer 0: R at its LAYER_CHANGE (10) minus R at the NEXT LAYER_CHANGE (6) = 4
	// layer 1 (last layer): R at its LAYER_CHANGE (6) minus the FINAL M73 R seen (0) = 6
	assert.deepEqual(Array.from(result.layerTimeMinutes), [4, 6]);
});

test("layerTimeMinutes is all NaN when the file has no M73/LAYER_CHANGE data", () => {
	const gcode = "G1 X0 Y0 Z0.2 E1\nG1 X10 Y0 Z0.4 E2\n";
	const result = parseGcode(gcode);
	assert.equal(result.layerTimeMinutes.length, 2);
	for (const t of result.layerTimeMinutes) assert.ok(Number.isNaN(t));
});
