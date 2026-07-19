/**
 * PrusaSlicer/SuperSlicer feature-type (;TYPE:) label -> color-mode bucket
 * mapping. Verified directly against both slicers' current source (see
 * docs/superpowers/specs/2026-07-19-gcode-viewer-colorize-thick-lines-design.md):
 * exact tag format is ";TYPE:<label>" (no space), one tag governs every
 * extrusion move until the next tag. SuperSlicer diverges on two labels
 * only ("Internal perimeter" vs PrusaSlicer's "Perimeter", "Skirt" vs
 * "Skirt/Brim") — both folded into the same bucket as their PrusaSlicer
 * equivalent.
 */

export const UNKNOWN_FEATURE_TYPE = 0;

export const FEATURE_TYPE_NAMES = [
	"Unknown",
	"Perimeter",
	"External perimeter",
	"Overhang perimeter",
	"Internal infill",
	"Solid infill",
	"Top solid infill",
	"Bridge infill",
	"Gap fill",
	"Skirt",
	"Support material",
	"Support material interface",
	"Ironing",
	"Wipe tower",
	"Custom",
] as const;

/** Index-aligned with FEATURE_TYPE_NAMES. */
export const FEATURE_TYPE_COLORS: readonly (readonly [number, number, number])[] = [
	[0.5, 0.5, 0.5],    // Unknown
	[0.85, 0.55, 0.25], // Perimeter
	[0.95, 0.75, 0.35], // External perimeter
	[0.9, 0.4, 0.4],    // Overhang perimeter
	[0.3, 0.55, 0.85],  // Internal infill
	[0.35, 0.65, 0.9],  // Solid infill
	[0.5, 0.8, 0.95],   // Top solid infill
	[0.8, 0.3, 0.6],    // Bridge infill
	[0.6, 0.6, 0.3],    // Gap fill
	[0.4, 0.4, 0.4],    // Skirt
	[0.3, 0.75, 0.4],   // Support material
	[0.45, 0.85, 0.5],  // Support material interface
	[0.9, 0.85, 0.4],   // Ironing
	[0.55, 0.4, 0.7],   // Wipe tower
	[0.7, 0.7, 0.7],    // Custom
];

const LABEL_TO_INDEX: Readonly<Record<string, number>> = {
	"Perimeter": 1,
	"Internal perimeter": 1, // SuperSlicer's name for the same feature
	"External perimeter": 2,
	"Overhang perimeter": 3,
	"Internal infill": 4,
	"Solid infill": 5,
	"Top solid infill": 6,
	"Bridge infill": 7,
	"Gap fill": 8,
	"Skirt/Brim": 9,
	"Skirt": 9, // SuperSlicer's name, and PrusaSlicer's pre-2.3.2 name
	"Support material": 10,
	"Support material interface": 11,
	"Ironing": 12,
	"Wipe tower": 13,
	"Custom": 14,
};

export function mapLabelToFeatureType(label: string): number {
	return LABEL_TO_INDEX[label] ?? UNKNOWN_FEATURE_TYPE;
}
