/**
 * Per-segment world-space line width from actual extrusion volume — the
 * same rectangular-bead approximation slicers themselves use:
 *   width = (pi * (filamentDiameter/2)^2 * deltaE) / (layerHeight * segmentLength)
 * Travel moves (no extrusion) get a fixed hairline width instead of
 * running through the formula, which would divide by zero.
 *
 * This formula is numerically unstable for very short segments: real gcode
 * rounds E to a fixed number of decimal places, so for a segment only a
 * few hundredths of a mm long (common in curve/arc tessellation, dense
 * corner rounding), that rounding is a much larger fraction of the true
 * deltaE — and since width is INVERSELY proportional to segmentLength, the
 * error blows up rather than staying proportionally small. A pathological
 * short segment can compute a width many times its neighbors', rendering
 * as an oversized blob that swallows the actual line pattern (confirmed
 * against a real file: this is what made lines merge into solid color
 * blocks with none of the gaps a real slicer preview shows). Below
 * MIN_SEGMENT_LENGTH_MM, reuse the last stable width instead of dividing —
 * physically, a short segment is still part of the same continuous bead
 * as its neighbors, so their width is a far better estimate than its own
 * unstable division.
 */

export const TRAVEL_WIDTH_MM = 0.1;
const DEFAULT_LAYER_HEIGHT_MM = 0.2;
const MIN_SEGMENT_LENGTH_MM = 0.05;

export function computeSegmentWidths(
	positions: Float32Array,
	deltaE: Float32Array,
	extruding: Uint8Array,
	layerIndex: Uint16Array,
	layerHeights: Float32Array,
	filamentDiameter: number,
): Float32Array {
	const segmentCount = deltaE.length;
	const widths = new Float32Array(segmentCount);
	const filamentArea = Math.PI * (filamentDiameter / 2) ** 2;
	let lastStableWidth = TRAVEL_WIDTH_MM;

	for (let i = 0; i < segmentCount; i++) {
		if (!extruding[i]) {
			widths[i] = TRAVEL_WIDTH_MM;
			continue;
		}
		const base = i * 6;
		const dx = positions[base + 3]! - positions[base]!;
		const dy = positions[base + 4]! - positions[base + 1]!;
		const dz = positions[base + 5]! - positions[base + 2]!;
		const segmentLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
		if (segmentLength < MIN_SEGMENT_LENGTH_MM) {
			widths[i] = lastStableWidth;
			continue;
		}
		const layerHeight = layerHeights[layerIndex[i]!] || DEFAULT_LAYER_HEIGHT_MM;
		const width = (filamentArea * deltaE[i]!) / (layerHeight * segmentLength);
		widths[i] = width;
		lastStableWidth = width;
	}
	return widths;
}
