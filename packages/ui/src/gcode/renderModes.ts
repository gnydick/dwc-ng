/**
 * Reveal-mode logic: which segments count as "opaque" (already printed /
 * in focus) right now, and which remaining segments get a translucent
 * ghost preview. Both are always CONTIGUOUS ranges over the segment array
 * — layerIndex is monotonically non-decreasing by construction (slicers
 * never interleave layers), so any single-layer or single-prefix
 * classification is a contiguous run, never a scattered set. scene.ts
 * relies on this to slice which segments go into which of its instanced
 * meshes (opaque/ghost-before/ghost-after).
 *
 * Ghost segments cover the WHOLE rest of the model (every remaining move),
 * not a bounded lookahead window — an earlier version of this file bounded
 * it to dodge alpha-blending compounding (N overlapping translucent draws
 * push toward 1-(1-a)^N, saturating near-opaque for a tall model where
 * many upper layers project onto the same screen pixels as lower ones).
 * That's solved properly now instead: scene.ts's ghost material writes
 * real depth (not just tests it), so the GPU's own depth test resolves
 * "nearest ghost fragment wins" per pixel — no compounding regardless of
 * how many ghost segments overlap, so there's no need to bound the range.
 * See docs/superpowers/specs/2026-07-19-gcode-viewer-colorize-thick-lines-design.md.
 */

export type RenderMode = "progressive" | "static" | "layer-focus";

/** Whether the ghost (non-opaque) segments are previewed or hidden entirely. */
export type GhostMode = "show" | "hidden";

/** [start, end) over segment indices — half-open, may be empty (start === end). */
export interface SegmentRange {
	start: number;
	end: number;
}

export interface GhostRanges {
	before: SegmentRange;
	after: SegmentRange;
}

function lowerBound(layerIndex: Uint16Array, value: number): number {
	let lo = 0;
	let hi = layerIndex.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (layerIndex[mid]! < value) lo = mid + 1; else hi = mid;
	}
	return lo;
}

/** The contiguous range of segments this reveal mode currently counts as opaque. */
export function computeOpaqueRange(
	segmentCount: number, layerIndex: Uint16Array, liveSegmentIndex: number, mode: RenderMode,
): SegmentRange {
	if (segmentCount === 0) return { start: 0, end: 0 };
	if (mode === "static") return { start: 0, end: segmentCount };
	if (mode === "progressive") {
		const end = Math.min(segmentCount, Math.max(0, liveSegmentIndex + 1));
		return { start: 0, end };
	}
	// layer-focus
	if (liveSegmentIndex < 0 || liveSegmentIndex >= segmentCount) return { start: 0, end: 0 };
	const liveLayer = layerIndex[liveSegmentIndex]!;
	return { start: lowerBound(layerIndex, liveLayer), end: lowerBound(layerIndex, liveLayer + 1) };
}

/**
 * The ranges immediately before/after the opaque range that get a
 * translucent ghost preview — everything NOT opaque, when ghostMode is
 * "show". "before" is only ever non-empty in layer-focus mode
 * (progressive/static already start their opaque range at 0, so there's
 * nothing before it); "after" is the rest of the not-yet-printed model.
 */
export function computeGhostRanges(segmentCount: number, opaqueRange: SegmentRange, ghostMode: GhostMode): GhostRanges {
	const empty = (at: number): SegmentRange => ({ start: at, end: at });
	if (ghostMode === "hidden" || segmentCount === 0) {
		return { before: empty(opaqueRange.start), after: empty(opaqueRange.end) };
	}
	return {
		before: { start: 0, end: opaqueRange.start },
		after: { start: opaqueRange.end, end: segmentCount },
	};
}
