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
/**
 * @invariant width-is-never-divided-by-a-length-too-short-to-trust
 * @rung 6  choke-point — one width function, one threshold, and the division
 *          is unreachable below it: the short-segment branch returns the last
 *          stable width without evaluating the formula. Travel moves take the
 *          hairline before the division too, so the zero case has no path to it
 * @why width is INVERSELY proportional to segment length, and real G-code
 *      rounds E to a few decimals — so on a segment a hundredth of a mm long
 *      (curve tessellation, corner rounding) the rounding error is a large
 *      fraction of deltaE and the computed width blows up rather than staying
 *      proportionally small. Confirmed against a real file: one pathological
 *      segment rendered as a blob that swallowed the surrounding lines, turning
 *      the preview into solid colour blocks with none of a slicer's gaps. The
 *      viewer is how the operator checks a job BEFORE committing filament and
 *      hours to it, so a preview that hides the pattern defeats its purpose
 * @debt the threshold is a module constant and the substitute is "the previous
 *       segment's width", which is a good estimate precisely because a short
 *       segment continues the same bead — but nothing states that adjacency
 *       requirement, so a future caller computing widths out of order would get
 *       a stable-looking number from an unrelated bead. Promote by having the
 *       function take the run it is walking rather than raw arrays, so
 *       "previous" is defined by the value instead of by call order.
 */
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
