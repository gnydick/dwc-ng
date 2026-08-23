// A shaper can excite a mode the unshaped machine never showed (observed
// 2026-08-22: 17.5 Hz ZVDD/ZVDDD/custom produced a new 38 Hz ring). The
// impulse-residual model cannot see that; comparing fingerprints can.

import type { Fingerprint, Mode } from "./fit.ts";
import type { G, Hz } from "./units.ts";

export type Artefact = { readonly axis: "X" | "Y"; readonly hz: Hz; readonly peakG: G };

/**
 * Modes present in the verified fingerprint that are not within ±tolRel of
 * any mode in the baseline, with a peak of at least floorG.
 *
 * `floorG` is read against Mode.peakG, which since 2026-08-23 (GIT_33) is the
 * ring amplitude rather than the argmax of a band-mask transient. The old
 * number ran 16-63 % low, so this floor was effectively ~0.1 g of real ring;
 * it is now the 0.05 g it says. Left at 0.05 deliberately: the smaller value
 * is what the name always claimed, and 0.05 g of a mode the machine did not
 * have before is worth telling the operator about.
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
