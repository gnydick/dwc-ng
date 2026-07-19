/**
 * Feature-type (;TYPE:) label -> color-mode bucket mapping. Covers
 * PrusaSlicer, SuperSlicer, and OrcaSlicer (all forks of the same
 * ExtrusionRole lineage, verified directly against each's current
 * source):
 *
 * PrusaSlicer/SuperSlicer — see docs/superpowers/specs/
 * 2026-07-19-gcode-viewer-colorize-thick-lines-design.md. SuperSlicer
 * diverges on two labels only ("Internal perimeter" vs PrusaSlicer's
 * "Perimeter", "Skirt" vs "Skirt/Brim").
 *
 * OrcaSlicer renamed most role labels (verified against
 * OrcaSlicer/src/libslic3r/ExtrusionEntity.cpp's role_to_string): "Outer
 * wall"/"Inner wall" for perimeters, "Sparse infill"/"Internal solid
 * infill"/"Top surface" for infill, "Gap infill", "Bridge", "Prime tower".
 * Its `;TYPE:` tag (no space after the colon, same format as PrusaSlicer)
 * is only emitted when Orca is configured with a non-Bambu-native printer
 * profile (OrcaSlicer/src/libslic3r/GCode/GCodeProcessor.cpp's
 * Reserved_Tags_compatible) — BambuStudio itself never emits `;TYPE:` at
 * all (it always writes `; FEATURE: <label>` instead), so real BambuStudio
 * output won't be colorized by this mapping; that's a distinct format
 * this parser doesn't target.
 *
 * A handful of OrcaSlicer/BambuStudio roles have no PrusaSlicer-bucket
 * equivalent (Brim, Bottom surface, Support transition, Internal Bridge,
 * Floating vertical shell, Flush, Multiple/Undefined) — each is folded
 * into its nearest existing bucket rather than growing the palette for
 * roles this app doesn't need to distinguish visually.
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

	// OrcaSlicer (and, for the roles it shares, BambuStudio's own enum —
	// though BambuStudio never actually emits a ;TYPE: tag, see header).
	"Inner wall": 1,               // -> Perimeter
	"Outer wall": 2,               // -> External perimeter
	"Overhang wall": 3,            // -> Overhang perimeter
	"Sparse infill": 4,            // -> Internal infill
	"Internal solid infill": 5,    // -> Solid infill
	"Bottom surface": 5,           // -> Solid infill (nearest concept; no dedicated PrusaSlicer bucket)
	"Top surface": 6,              // -> Top solid infill
	"Bridge": 7,                   // -> Bridge infill
	"Internal Bridge": 7,          // -> Bridge infill (OrcaSlicer-only sub-variant)
	"Gap infill": 8,               // -> Gap fill
	"Brim": 9,                     // -> Skirt (PrusaSlicer's own "Skirt/Brim" already combines these)
	"Support": 10,                 // -> Support material
	"Support transition": 10,      // -> Support material (nearest concept)
	"Support interface": 11,       // -> Support material interface
	"Support ironing": 12,         // -> Ironing (support variant)
	"Prime tower": 13,             // -> Wipe tower
	"Flush": 14,                   // -> Custom (a deliberate, named operation, not truly unclassified)
	"Floating vertical shell": 2,  // -> External perimeter (nearest concept; BambuStudio-only wall variant)
	"Multiple": UNKNOWN_FEATURE_TYPE, // erMixed — genuinely ambiguous, no single bucket fits
	"Undefined": UNKNOWN_FEATURE_TYPE, // erNone
};

export function mapLabelToFeatureType(label: string): number {
	return LABEL_TO_INDEX[label] ?? UNKNOWN_FEATURE_TYPE;
}
