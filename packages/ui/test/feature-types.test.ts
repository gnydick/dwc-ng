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

test("maps OrcaSlicer's renamed labels to the matching PrusaSlicer-equivalent bucket", () => {
	assert.equal(mapLabelToFeatureType("Inner wall"), mapLabelToFeatureType("Perimeter"));
	assert.equal(mapLabelToFeatureType("Outer wall"), mapLabelToFeatureType("External perimeter"));
	assert.equal(mapLabelToFeatureType("Overhang wall"), mapLabelToFeatureType("Overhang perimeter"));
	assert.equal(mapLabelToFeatureType("Sparse infill"), mapLabelToFeatureType("Internal infill"));
	assert.equal(mapLabelToFeatureType("Internal solid infill"), mapLabelToFeatureType("Solid infill"));
	assert.equal(mapLabelToFeatureType("Top surface"), mapLabelToFeatureType("Top solid infill"));
	assert.equal(mapLabelToFeatureType("Bridge"), mapLabelToFeatureType("Bridge infill"));
	assert.equal(mapLabelToFeatureType("Gap infill"), mapLabelToFeatureType("Gap fill"));
	assert.equal(mapLabelToFeatureType("Brim"), mapLabelToFeatureType("Skirt"));
	assert.equal(mapLabelToFeatureType("Support"), mapLabelToFeatureType("Support material"));
	assert.equal(mapLabelToFeatureType("Support interface"), mapLabelToFeatureType("Support material interface"));
	assert.equal(mapLabelToFeatureType("Prime tower"), mapLabelToFeatureType("Wipe tower"));
	assert.notEqual(mapLabelToFeatureType("Flush"), UNKNOWN_FEATURE_TYPE);
});

test("OrcaSlicer/BambuStudio roles with no bucket equivalent still resolve to a defined index, not undefined", () => {
	for (const label of ["Internal Bridge", "Support transition", "Support ironing", "Floating vertical shell"]) {
		const idx = mapLabelToFeatureType(label);
		assert.equal(typeof idx, "number");
		assert.ok(idx >= 0 && idx < FEATURE_TYPE_NAMES.length, `${label} -> ${idx} out of range`);
	}
});

test("erMixed/erNone labels ('Multiple', 'Undefined') map to Unknown", () => {
	assert.equal(mapLabelToFeatureType("Multiple"), UNKNOWN_FEATURE_TYPE);
	assert.equal(mapLabelToFeatureType("Undefined"), UNKNOWN_FEATURE_TYPE);
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
