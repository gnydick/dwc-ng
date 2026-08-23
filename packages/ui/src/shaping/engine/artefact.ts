// A shaper can excite a mode the unshaped machine never showed (observed
// 2026-08-22: 17.5 Hz ZVDD/ZVDDD/custom produced a new 38 Hz ring). The
// impulse-residual model cannot see that; comparing fingerprints can.

import type { Fingerprint, Mode } from "./fit.ts";
import type { G, Hz } from "./units.ts";

export type Artefact = { readonly axis: "X" | "Y"; readonly hz: Hz; readonly peakG: G };

/**
 * Modes present in the verified fingerprint that are not within ±tolRel of
 * any mode in the baseline, with a peak of at least floorG.
 */
export function newPeaks(baseline: Fingerprint, verified: Fingerprint, floorG = 0.05, tolRel = 0.15): Artefact[] {
	const known: Mode[] = [baseline.X, baseline.Y].filter((m): m is Mode => m !== null);
	const out: Artefact[] = [];
	for (const axis of ["X", "Y"] as const) {
		const m = verified[axis];
		if (!m || m.peakG < floorG) continue;
		const matches = known.some((k) => Math.abs(m.f - k.f) / k.f <= tolRel);
		if (!matches) out.push({ axis, hz: m.f, peakG: m.peakG });
	}
	return out;
}
