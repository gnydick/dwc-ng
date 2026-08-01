import type { Job } from "./types.ts";

/**
 * RRF publishes up to three independent "time remaining" estimates in
 * `job.timesLeft` (reference/objectmodel/src/job/TimesLeft.ts): one from the
 * FILE byte position, one from FILAMENT consumed vs the slicer's total, and the
 * SLICER's own static guess. They disagree — file-based is jumpy, slicer-based
 * is fixed, filament-based tracks the actual extruded length — and any of them
 * can be absent (null) at a given moment.
 *
 * @invariant headline-estimate-precedence
 * @rung 6  choke-point — "most trustworthy AVAILABLE source" is one pure
 *          function, the only place the precedence exists, rather than a chain
 *          of Show/ternaries in JSX
 * @why the headline is the number the operator plans around. Spread across JSX,
 *      a fourth source or a reordering changes the answer silently, and the
 *      breakdown below it would disagree with the headline above
 * @debt promote by returning a sum type carrying the chosen source, so a
 *       consumer cannot render a headline without naming which source it came
 *       from and the two cannot drift.
 */
export type EstimateSource = "filament" | "file" | "slicer";

export interface RemainingEstimate {
	seconds: number;
	source: EstimateSource;
}

/**
 * Trust order for the headline: filament-based is the most accurate once the
 * machine is actually extruding, then the file-position extrapolation, then the
 * slicer's static estimate as a last resort.
 */
const TRUST: readonly EstimateSource[] = ["filament", "file", "slicer"];

/** The single figure to show prominently, or null when RRF has published none. */
export function headlineRemaining(t: Job["timesLeft"]): RemainingEstimate | null {
	for (const source of TRUST) {
		const seconds = t[source];
		if (seconds !== null) return { seconds, source };
	}
	return null;
}

/**
 * Every published source, in a FIXED display order so the breakdown never
 * reorders as sources appear and disappear mid-print (positional stability).
 * The order is intentionally file → filament → slicer, not the trust order:
 * the breakdown reads left-to-right the way an operator scans them, while the
 * headline above it already carries the "which do we trust" decision.
 */
export function estimateSources(t: Job["timesLeft"]): RemainingEstimate[] {
	const order: readonly EstimateSource[] = ["file", "filament", "slicer"];
	return order.flatMap(source => (t[source] !== null ? [{ seconds: t[source]!, source }] : []));
}
