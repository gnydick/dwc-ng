import { test } from "node:test";
import assert from "node:assert/strict";
import {
	mapLabelToFeatureType, UNKNOWN_FEATURE_TYPE, FEATURE_TYPE_NAMES, FEATURE_TYPE_COLORS,
} from "../src/gcode/featureTypes.ts";

test("maps every verified PrusaSlicer label to a non-Unknown index", () => {
	const prusaLabels = [
		"Perimeter", "External perimeter", "Overhang perimeter", "Internal infill",
		"Solid infill", "Top solid infill", "Bridge infill", "Gap fill", "Skirt/Brim",
		"Support material", "Support material interface", "Ironing", "Wipe tower", "Custom",
	];
	for (const label of prusaLabels) {
		assert.notEqual(mapLabelToFeatureType(label), UNKNOWN_FEATURE_TYPE, `expected ${label} to map to a known type`);
	}
});

test("maps SuperSlicer's diverged labels to the same bucket as PrusaSlicer's equivalent", () => {
	assert.equal(mapLabelToFeatureType("Internal perimeter"), mapLabelToFeatureType("Perimeter"));
	assert.equal(mapLabelToFeatureType("Skirt"), mapLabelToFeatureType("Skirt/Brim"));
});

test("unrecognized or empty labels map to Unknown", () => {
	assert.equal(mapLabelToFeatureType("Something else entirely"), UNKNOWN_FEATURE_TYPE);
	assert.equal(mapLabelToFeatureType(""), UNKNOWN_FEATURE_TYPE);
});

test("FEATURE_TYPE_COLORS has exactly one entry per FEATURE_TYPE_NAMES entry", () => {
	assert.equal(FEATURE_TYPE_COLORS.length, FEATURE_TYPE_NAMES.length);
});

test("FEATURE_TYPE_NAMES[UNKNOWN_FEATURE_TYPE] is literally \"Unknown\"", () => {
	assert.equal(FEATURE_TYPE_NAMES[UNKNOWN_FEATURE_TYPE], "Unknown");
});
