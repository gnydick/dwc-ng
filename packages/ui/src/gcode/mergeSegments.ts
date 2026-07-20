/**
 * Collinear-run merging for the toolpath's EXTRUDING segments.
 *
 * Slicers emit many short G1 moves along every curve (and some split even
 * straight runs), so a per-segment mesh instance count balloons into the
 * millions — expensive to render and, because each tiny bead is a separate
 * shape with its own edges, a source of shimmer/moire on dense parallel
 * runs. Merging consecutive segments that head in nearly the same direction
 * (and share a layer + similar width) into one longer box collapses that:
 * fewer instances to draw, fewer edges to alias.
 *
 * Only EXTRUDING segments merge. Travel (non-extruding) moves break a run
 * and are rendered separately (they're hidden by default anyway), so a run
 * is always a contiguous span of printed extrusion within a single layer.
 *
 * The reveal split (renderModes.ts) is by original segment index; a merged
 * run is classified whole by its FIRST segment index (see scene.ts), so the
 * opaque/ghost boundary and live-position reveal become merged-run
 * granularity rather than per-segment — a straight run reveals as a unit.
 * Runs are kept short (a tight angle tolerance only collapses gentle
 * curves/tessellation, not real corners) so this stays visually fine.
 */

/** [start, end) over original segment indices — a contiguous, single-layer, collinear run of extruding segments. */
export interface Run {
	start: number;
	end: number;
}

// ~1.1° per step. Deliberately tight: a run is drawn as ONE straight box
// from its first point to its last, so the chord cuts any curvature inside
// it. A loose tolerance (5° was tried) let gentle curves collapse into long
// straight chords, visibly faceting/decimating organic models. This tight
// value merges only near-straight tessellation (imperceptible) while keeping
// curves intact — most of the instance-count win with little shape loss.
const DEFAULT_COS_ANGLE_TOL = 0.9998;
const DEFAULT_WIDTH_TOL_MM = 0.15;

/** Unit direction (gcode space) of segment i from its start point to its end point; null if degenerate. */
function segmentDir(positions: Float32Array, i: number): [number, number, number] | null {
	const b = i * 6;
	const dx = positions[b + 3]! - positions[b]!;
	const dy = positions[b + 4]! - positions[b + 1]!;
	const dz = positions[b + 5]! - positions[b + 2]!;
	const len = Math.hypot(dx, dy, dz);
	if (len < 1e-6) return null;
	return [dx / len, dy / len, dz / len];
}

/**
 * Groups consecutive extruding segments into collinear runs. Segments are
 * merged with the current run while they stay in the same layer, keep a
 * similar width, and turn less than the angle tolerance from the previous
 * segment's direction. Non-extruding segments are never in a run.
 */
export function mergeExtrudingRuns(
	positions: Float32Array,
	widths: Float32Array,
	extruding: Uint8Array,
	layerIndex: Uint16Array,
	cosAngleTol: number = DEFAULT_COS_ANGLE_TOL,
	widthTolMm: number = DEFAULT_WIDTH_TOL_MM,
): Run[] {
	const n = extruding.length;
	const runs: Run[] = [];
	let i = 0;
	while (i < n) {
		if (extruding[i] !== 1) {
			i++;
			continue;
		}
		const start = i;
		const layer = layerIndex[i]!;
		const refWidth = widths[i]!;
		let prevDir = segmentDir(positions, i);
		let j = i + 1;
		while (j < n) {
			if (extruding[j] !== 1) break;
			if (layerIndex[j] !== layer) break;
			if (Math.abs(widths[j]! - refWidth) > widthTolMm) break;
			const dir = segmentDir(positions, j);
			// A degenerate (zero-length) segment doesn't bend the run — absorb
			// it and carry the previous direction forward.
			if (dir !== null && prevDir !== null) {
				const dot = prevDir[0] * dir[0] + prevDir[1] * dir[1] + prevDir[2] * dir[2];
				if (dot < cosAngleTol) break;
				prevDir = dir;
			}
			j++;
		}
		runs.push({ start, end: j });
		i = j;
	}
	return runs;
}
