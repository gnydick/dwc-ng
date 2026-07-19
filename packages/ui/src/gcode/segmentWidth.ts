/**
 * Per-segment world-space line width from actual extrusion volume — the
 * same rectangular-bead approximation slicers themselves use:
 *   width = (pi * (filamentDiameter/2)^2 * deltaE) / (layerHeight * segmentLength)
 * Travel moves (no extrusion) get a fixed hairline width instead of
 * running through the formula, which would divide by zero.
 */

export const TRAVEL_WIDTH_MM = 0.1;
const DEFAULT_LAYER_HEIGHT_MM = 0.2;

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
		const layerHeight = layerHeights[layerIndex[i]!] || DEFAULT_LAYER_HEIGHT_MM;
		widths[i] = segmentLength > 0
			? (filamentArea * deltaE[i]!) / (layerHeight * segmentLength)
			: TRAVEL_WIDTH_MM;
	}
	return widths;
}
