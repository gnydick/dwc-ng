/**
 * Run-building for the toolpath's EXTRUDING segments.
 *
 * Slicers emit many short G1 moves along every curve, so a per-segment mesh
 * instance count balloons into the millions — expensive to render and, because
 * each tiny bead is a separate shape with its own edges, a source of
 * shimmer/moire on dense parallel runs. Grouping consecutive segments into
 * longer boxes collapses that.
 *
 * HOW (changed 2026-07-20): a contiguous span of extruding segments within one
 * layer is simplified with Visvalingam–Whyatt under a MILLIMETRE deviation
 * bound (see simplifyRun.ts). Each kept point pair becomes one box.
 *
 * The previous approach compared the turn between CONSECUTIVE segments and
 * carried the direction forward, so it never bounded deviation from the chord
 * it actually draws: a gentle arc whose every step was under tolerance merged
 * without limit and was then drawn as one straight box across the whole arc.
 * That is why a 5° tolerance visibly faceted organic models, and why the 1.1°
 * workaround barely merged at all — measured on a real 800-layer organic job it
 * collapsed 1,620,273 extruding segments to 1,551,820 runs, a 4.2% reduction,
 * while still offering no guarantee. VW at 0.05 mm gives 1,181,524 (-23.9%)
 * with a proven 0.05 mm worst-case error.
 *
 * Only EXTRUDING segments merge. Travel (non-extruding) moves break a span and
 * are rendered separately, so a run is always a contiguous span of printed
 * extrusion within a single layer.
 *
 * The reveal split (renderModes.ts) is by original segment index; a run is
 * classified whole by its FIRST segment index (see scene.ts), so the
 * opaque/ghost boundary and live-position reveal are run-granular.
 */
import { simplifyIndices } from "./simplifyRun.ts";

/** [start, end) over original segment indices — a contiguous, single-layer run of extruding segments drawn as one box. */
export interface Run {
	start: number;
	end: number;
}

/**
 * Worst-case distance (mm) between the drawn boxes and the true toolpath.
 * 0.05 mm is an eighth of a typical 0.4 mm bead — imperceptible — while
 * removing ~24% of instances. Unlike the old angle tolerance this is a real
 * guarantee, enforced and asserted in simplifyRun.ts.
 */
export const DEFAULT_TOLERANCE_MM = 0.05;
const DEFAULT_WIDTH_TOL_MM = 0.15;

/**
 * Groups consecutive extruding segments into runs. A span is broken by a
 * travel move, a layer change, or a large width change; within a span, points
 * are dropped only while the drawn chord stays within `toleranceMm` of the
 * real path.
 */
export function mergeExtrudingRuns(
	positions: Float32Array,
	widths: Float32Array,
	extruding: Uint8Array,
	layerIndex: Uint16Array,
	toleranceMm: number = DEFAULT_TOLERANCE_MM,
	widthTolMm: number = DEFAULT_WIDTH_TOL_MM,
): Run[] {
	const n = extruding.length;
	const runs: Run[] = [];
	let i = 0;
	while (i < n) {
		if (extruding[i] !== 1) { i++; continue; }

		// Maximal contiguous span: same layer, similar width, all extruding.
		const start = i;
		const layer = layerIndex[i]!;
		const refWidth = widths[i]!;
		let end = i + 1;
		while (
			end < n && extruding[end] === 1 && layerIndex[end] === layer
			&& Math.abs(widths[end]! - refWidth) <= widthTolMm
		) end++;

		const count = end - start;
		if (count === 1) {
			runs.push({ start, end });
		} else {
			// Segments are point pairs; the span's polyline has count+1 points.
			const pts = new Float32Array((count + 1) * 3);
			for (let k = 0; k < count; k++) {
				const b = (start + k) * 6;
				pts[k * 3] = positions[b]!;
				pts[k * 3 + 1] = positions[b + 1]!;
				pts[k * 3 + 2] = positions[b + 2]!;
			}
			const last = (end - 1) * 6;
			pts[count * 3] = positions[last + 3]!;
			pts[count * 3 + 1] = positions[last + 4]!;
			pts[count * 3 + 2] = positions[last + 5]!;

			const kept = simplifyIndices(pts, toleranceMm);
			for (let k = 0; k + 1 < kept.length; k++) {
				runs.push({ start: start + kept[k]!, end: start + kept[k + 1]! });
			}
		}
		i = end;
	}
	return runs;
}
