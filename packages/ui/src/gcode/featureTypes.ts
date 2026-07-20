/**
 * Feature-type (;TYPE:) label -> color-mode bucket mapping. Buckets and
 * colors are copied verbatim (RGB 0-255 -> 0-1) from OrcaSlicer's actual
 * DEFAULT_EXTRUSION_ROLES_COLORS table (src/libvgcode/src/ViewerImpl.cpp,
 * verified 2026-07-19 against github.com/OrcaSlicer/OrcaSlicer main) — the
 * same libvgcode library PrusaSlicer's own Preview tab uses, so "Feature"
 * mode matches what either slicer's own preview shows, not an invented
 * palette. That table's own EGCodeExtrusionRole enum is the bucket list:
 * the 15 roles PrusaSlicer/SuperSlicer also have, plus 5 OrcaSlicer-only
 * additions (BottomSurface, InternalBridgeInfill, Brim, SupportTransition,
 * Mixed) it defines as genuinely distinct slots with their own colors —
 * this list does NOT include a separate "support ironing" or "floating
 * vertical shell" or "flush" slot (an earlier version of this file assumed
 * it did, from memory rather than the real source; those labels fold into
 * their nearest real bucket instead, noted inline below).
 *
 * Label text -> bucket: PrusaSlicer/SuperSlicer's `;TYPE:` labels — see
 * docs/superpowers/specs/2026-07-19-gcode-viewer-colorize-thick-lines-design.md.
 * OrcaSlicer renamed most role labels (verified against
 * OrcaSlicer/src/libslic3r/ExtrusionEntity.cpp's role_to_string): "Outer
 * wall"/"Inner wall" for perimeters, "Sparse infill"/"Internal solid
 * infill"/"Top surface" for infill, "Gap infill", "Bridge", "Prime tower",
 * plus its own "Bottom surface"/"Internal Bridge"/"Brim"/"Support
 * transition" labels, each mapped to that same-named bucket now that this
 * table has one. Its `;TYPE:` tag (no space after the colon, same format
 * as PrusaSlicer) is only emitted when Orca is configured with a
 * non-Bambu-native printer profile (OrcaSlicer/src/libslic3r/GCode/
 * GCodeProcessor.cpp's Reserved_Tags_compatible) — BambuStudio itself
 * never emits `;TYPE:` at all (it always writes `; FEATURE: <label>`
 * instead), so real BambuStudio output won't be colorized by this
 * mapping; that's a distinct format this parser doesn't target.
 */

export const UNKNOWN_FEATURE_TYPE = 0;

export const FEATURE_TYPE_NAMES = [
	"Unknown",                    // libvgcode: None
	"Perimeter",
	"External perimeter",         // libvgcode: ExternalPerimeter
	"Overhang perimeter",         // libvgcode: OverhangPerimeter
	"Internal infill",            // libvgcode: InternalInfill
	"Solid infill",               // libvgcode: SolidInfill
	"Top solid infill",           // libvgcode: TopSolidInfill
	"Ironing",
	"Bridge infill",              // libvgcode: BridgeInfill
	"Gap fill",                   // libvgcode: GapFill
	"Skirt",
	"Support material",           // libvgcode: SupportMaterial
	"Support material interface", // libvgcode: SupportMaterialInterface
	"Wipe tower",                 // libvgcode: WipeTower
	"Custom",
	"Bottom surface",             // libvgcode: BottomSurface (OrcaSlicer addition)
	"Internal bridge",            // libvgcode: InternalBridgeInfill (OrcaSlicer addition)
	"Brim",                       // libvgcode: Brim (OrcaSlicer addition)
	"Support transition",         // libvgcode: SupportTransition (OrcaSlicer addition)
	"Mixed",                      // libvgcode: Mixed (OrcaSlicer addition; overlapping/ambiguous roles)
] as const;

/** Index-aligned with FEATURE_TYPE_NAMES. Verbatim from libvgcode's
 *  DEFAULT_EXTRUSION_ROLES_COLORS (0-255 RGB, normalized to 0-1 here). */
export const FEATURE_TYPE_COLORS: readonly (readonly [number, number, number])[] = [
	[0.902, 0.702, 0.702], // Unknown (None)
	[1.0, 0.902, 0.302],   // Perimeter
	[1.0, 0.490, 0.220],   // External perimeter
	[0.122, 0.122, 1.0],   // Overhang perimeter
	[0.690, 0.188, 0.161], // Internal infill
	[0.588, 0.329, 0.800], // Solid infill
	[0.941, 0.251, 0.251], // Top solid infill
	[1.0, 0.549, 0.412],   // Ironing
	[0.302, 0.502, 0.729], // Bridge infill
	[1.0, 1.0, 1.0],       // Gap fill
	[0.0, 0.529, 0.431],   // Skirt
	[0.0, 1.0, 0.0],       // Support material
	[0.0, 0.502, 0.0],     // Support material interface
	[0.702, 0.890, 0.671], // Wipe tower
	[0.369, 0.820, 0.580], // Custom
	[0.400, 0.361, 0.780], // Bottom surface
	[0.302, 0.502, 0.729], // Internal bridge (libvgcode reuses BridgeInfill's color)
	[0.0, 0.231, 0.431],   // Brim
	[0.0, 0.251, 0.0],     // Support transition
	[0.502, 0.502, 0.502], // Mixed
];

const LABEL_TO_INDEX: Readonly<Record<string, number>> = {
	"Perimeter": 1,
	"Internal perimeter": 1, // SuperSlicer's name for the same feature
	"External perimeter": 2,
	"Overhang perimeter": 3,
	"Internal infill": 4,
	"Solid infill": 5,
	"Top solid infill": 6,
	"Ironing": 7,
	"Bridge infill": 8,
	"Gap fill": 9,
	"Skirt/Brim": 10, // PrusaSlicer's own combined tag — it never separately tags brim
	"Skirt": 10,      // SuperSlicer's name, PrusaSlicer's pre-2.3.2 name, and OrcaSlicer's own "Skirt"
	"Support material": 11,
	"Support material interface": 12,
	"Wipe tower": 13,
	"Custom": 14,

	// OrcaSlicer's renamed/added labels.
	"Inner wall": 1,             // -> Perimeter
	"Outer wall": 2,             // -> External perimeter
	"Overhang wall": 3,          // -> Overhang perimeter
	"Sparse infill": 4,          // -> Internal infill
	"Internal solid infill": 5,  // -> Solid infill
	"Top surface": 6,            // -> Top solid infill
	"Bridge": 8,                 // -> Bridge infill
	"Gap infill": 9,             // -> Gap fill
	"Bottom surface": 15,        // its own bucket (libvgcode: BottomSurface)
	"Internal Bridge": 16,       // its own bucket (libvgcode: InternalBridgeInfill)
	"Brim": 17,                  // its own bucket (libvgcode: Brim)
	"Support": 11,               // -> Support material
	"Support transition": 18,    // its own bucket (libvgcode: SupportTransition)
	"Support interface": 12,     // -> Support material interface
	"Support ironing": 7,        // -> Ironing (libvgcode has no separate slot for this)
	"Prime tower": 13,           // -> Wipe tower
	"Flush": 14,                 // -> Custom (libvgcode has no separate slot for this; Bambu-only purge operation)
	"Floating vertical shell": 2, // -> External perimeter (libvgcode has no separate slot for this)
	"Multiple": 19,              // -> Mixed (libvgcode: erMixed, genuinely overlapping/ambiguous roles)
	"Undefined": UNKNOWN_FEATURE_TYPE, // erNone
};

export function mapLabelToFeatureType(label: string): number {
	return LABEL_TO_INDEX[label] ?? UNKNOWN_FEATURE_TYPE;
}
