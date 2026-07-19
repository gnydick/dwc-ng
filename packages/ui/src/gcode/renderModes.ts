/**
 * Per-mode ALPHA computation for the toolpath mesh — color (hue) comes
 * from hueColors.ts, this only decides how see-through each segment is.
 * "Not yet printed" / "not the focused layer" segments become genuinely
 * translucent (real alpha, via the forked LineMaterial — see
 * src/gcode/lineMaterial/) rather than a darker shade, so GcodeViewer.tsx
 * can combine any color mode with any reveal mode. Recomputing alpha is
 * O(segmentCount) and runs on every live filePosition tick; it never
 * touches geometry/position/hue data, only the alpha channel (see
 * scene.ts's updateColors).
 */

export type RenderMode = "progressive" | "static" | "layer-focus";

const OPAQUE = 1.0;
const TRANSLUCENT = 0.15;

export function computeSegmentAlpha(
	segmentCount: number,
	layerIndex: Uint16Array,
	liveSegmentIndex: number,
	mode: RenderMode,
): Float32Array {
	const alpha = new Float32Array(segmentCount * 2); // 1 value per vertex
	const liveLayer = liveSegmentIndex >= 0 && liveSegmentIndex < layerIndex.length
		? layerIndex[liveSegmentIndex]!
		: -1;

	for (let i = 0; i < segmentCount; i++) {
		let opaque: boolean;
		if (mode === "static") opaque = true;
		else if (mode === "layer-focus") opaque = layerIndex[i] === liveLayer;
		else opaque = i <= liveSegmentIndex; // progressive

		const a = opaque ? OPAQUE : TRANSLUCENT;
		alpha[i * 2] = a;
		alpha[i * 2 + 1] = a;
	}
	return alpha;
}

/** Interleaves hueColors.ts's per-vertex RGB with this module's per-vertex
 *  alpha into the RGBA the forked LineSegmentsGeometry.setColors expects. */
export function combineRGBA(rgb: Float32Array, alpha: Float32Array): Float32Array {
	const segmentCount = alpha.length / 2;
	const rgba = new Float32Array(segmentCount * 8);
	for (let i = 0; i < segmentCount; i++) {
		const rgbBase = i * 6;
		const rgbaBase = i * 8;
		rgba[rgbaBase] = rgb[rgbBase]!;
		rgba[rgbaBase + 1] = rgb[rgbBase + 1]!;
		rgba[rgbaBase + 2] = rgb[rgbBase + 2]!;
		rgba[rgbaBase + 3] = alpha[i * 2]!;
		rgba[rgbaBase + 4] = rgb[rgbBase + 3]!;
		rgba[rgbaBase + 5] = rgb[rgbBase + 4]!;
		rgba[rgbaBase + 6] = rgb[rgbBase + 5]!;
		rgba[rgbaBase + 7] = alpha[i * 2 + 1]!;
	}
	return rgba;
}
