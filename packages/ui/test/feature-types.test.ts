import { test } from "node:test";
import assert from "node:assert/strict";
import {
	mapLabelToFeatureType, UNKNOWN_FEATURE_TYPE, FEATURE_TYPE_NAMES, FEATURE_TYPE_COLORS,
} from "../src/gcode/featureTypes.ts";

test("maps every verified PrusaSlicer label to a non-Unknown index", () => {
	const prusaLabels = [
		"Perimeter", "External perimeter", "Overhang perimeter", "Internal infill",
		"Solid infill", "Top solid infill", "Ironing", "Bridge infill", "Gap fill", "Skirt/Brim",
		"Support material", "Support material interface", "Wipe tower", "Custom",
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
	assert.equal(mapLabelToFeatureType("Support"), mapLabelToFeatureType("Support material"));
	assert.equal(mapLabelToFeatureType("Support interface"), mapLabelToFeatureType("Support material interface"));
	assert.equal(mapLabelToFeatureType("Prime tower"), mapLabelToFeatureType("Wipe tower"));
	assert.notEqual(mapLabelToFeatureType("Flush"), UNKNOWN_FEATURE_TYPE);
});

test("OrcaSlicer roles that libvgcode gives a genuinely distinct bucket/color get their own index, not folded into Skirt/Bridge/etc", () => {
	assert.notEqual(mapLabelToFeatureType("Brim"), mapLabelToFeatureType("Skirt"));
	assert.notEqual(mapLabelToFeatureType("Bottom surface"), mapLabelToFeatureType("Solid infill"));
	assert.notEqual(mapLabelToFeatureType("Internal Bridge"), UNKNOWN_FEATURE_TYPE);
	assert.notEqual(mapLabelToFeatureType("Support transition"), mapLabelToFeatureType("Support material"));
});

test("OrcaSlicer/BambuStudio roles with no dedicated libvgcode slot fold into their nearest real bucket", () => {
	assert.equal(mapLabelToFeatureType("Support ironing"), mapLabelToFeatureType("Ironing"));
	assert.equal(mapLabelToFeatureType("Floating vertical shell"), mapLabelToFeatureType("External perimeter"));
	assert.equal(mapLabelToFeatureType("Flush"), mapLabelToFeatureType("Custom"));
});

test("'Multiple' (erMixed) maps to its own Mixed bucket, distinct from Unknown", () => {
	const idx = mapLabelToFeatureType("Multiple");
	assert.notEqual(idx, UNKNOWN_FEATURE_TYPE);
	assert.equal(FEATURE_TYPE_NAMES[idx], "Mixed");
});

test("'Undefined' (erNone) maps to Unknown", () => {
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

test("every color channel is within [0,1]", () => {
	for (const [r, g, b] of FEATURE_TYPE_COLORS) {
		for (const c of [r, g, b]) assert.ok(c >= 0 && c <= 1, `channel ${c} out of range`);
	}
});
