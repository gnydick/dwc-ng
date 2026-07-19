/**
 * Per-mode vertex-color computation for the toolpath LineSegments mesh.
 * "Dim" is a darker shade rather than alpha transparency — avoids
 * transparent-material depth-sorting complexity for what's a preview, not a
 * physically-accurate render. Recomputing colors is O(segmentCount) and
 * runs on every live filePosition tick; it never touches geometry/position
 * data, only the color attribute (see scene.ts's updateColors).
 */

export type RenderMode = "progressive" | "static" | "layer-focus";

const BRIGHT: readonly [number, number, number] = [0.85, 0.55, 0.25];
const DIM: readonly [number, number, number] = [0.18, 0.2, 0.24];

export function computeSegmentColors(
	segmentCount: number,
	layerIndex: Uint16Array,
	liveSegmentIndex: number,
	mode: RenderMode,
): Float32Array {
	const colors = new Float32Array(segmentCount * 6);
	const liveLayer = liveSegmentIndex >= 0 && liveSegmentIndex < layerIndex.length
		? layerIndex[liveSegmentIndex]!
		: -1;

	for (let i = 0; i < segmentCount; i++) {
		let bright: boolean;
		if (mode === "static") bright = true;
		else if (mode === "layer-focus") bright = layerIndex[i] === liveLayer;
		else bright = i <= liveSegmentIndex; // progressive

		const [r, g, b] = bright ? BRIGHT : DIM;
		const base = i * 6;
		colors[base] = r; colors[base + 1] = g; colors[base + 2] = b;
		colors[base + 3] = r; colors[base + 4] = g; colors[base + 5] = b;
	}
	return colors;
}
