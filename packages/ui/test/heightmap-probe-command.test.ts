import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProbeCommand } from "../src/heightmap/probeCommand.ts";
import { DEFAULT_CONFIG } from "../src/config/types.ts";

test("substitutes the cell's bed coordinates", () => {
	assert.equal(
		buildProbeCommand('M98 P"0:/macros/dwc-ng/reprobe.g" X{x} Y{y}', 27, 5),
		'M98 P"0:/macros/dwc-ng/reprobe.g" X27 Y5',
	);
});

test("coordinates are trimmed to three decimals, without trailing zeroes", () => {
	// The Y step on the real machine is 290/15 = 19.3333…, so rows land on
	// fractional coordinates and a raw toString would send X5 Y24.333333333.
	assert.equal(buildProbeCommand("G30 X{x} Y{y}", 5, 24.333333), "G30 X5 Y24.333");
});

test("every occurrence is replaced, not just the first", () => {
	assert.equal(buildProbeCommand("{x} {y} {x}", 1, 2), "1 2 1");
});

test("a template with no placeholders is sent unchanged", () => {
	assert.equal(buildProbeCommand("G30 S-1", 1, 2), "G30 S-1");
});

test("negative coordinates survive", () => {
	// X on this machine runs from -98.2, so a probe point can be negative.
	assert.equal(buildProbeCommand("G30 X{x} Y{y}", -98.2, 5), "G30 X-98.2 Y5");
});

test("the shipped default calls a macro rather than composing motion", () => {
	// The UI must not invent a probe move: clearance, probe deploy, tool state
	// and the dock guard mesh.g already enforces all belong in the operator's
	// own macro.
	assert.match(DEFAULT_CONFIG.bed.probePointCommand, /^M98 P"/);
	assert.match(DEFAULT_CONFIG.bed.probePointCommand, /\{x\}/);
	assert.match(DEFAULT_CONFIG.bed.probePointCommand, /\{y\}/);
});
