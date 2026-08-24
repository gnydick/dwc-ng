// A shaper can excite a mode the unshaped machine never showed (observed
// 2026-08-22: 17.5 Hz ZVDD/ZVDDD/custom produced a new 38 Hz ring). The
// impulse-residual model cannot see that; comparing fingerprints can.

import type { Fingerprint, Mode } from "./fit.ts";
import type { G, Hz } from "./units.ts";

export type Artefact = { readonly axis: "X" | "Y"; readonly hz: Hz; readonly peakG: G };

/**
 * What `newPeaks` could and could not decide.
 *
 * `unjudged` is the arm this analysis was missing, and its absence produced a
 * confidently wrong statement on Gabe's machine on 2026-08-24. His baseline
 * fitted no Y mode at all (`n.Y === 0`), so the only known mode was X at
 * 38.83 Hz; a verify run that rang Y at 54 Hz was 39 % away from it and got
 * reported as "a mode the unshaped machine does not have". His Y really rings
 * near 50 Hz — 54 against that is 8 %, well inside tolerance, and nothing
 * would have been said.
 *
 * The bug was reading "we failed to measure this axis" as "this axis has no
 * mode". `measured` in store.ts already refused to make that mistake — "an
 * axis that never rang has no ratio to report" — and this is the same
 * reasoning finally applied to the same data.
 */
export type PeakReport = {
	readonly artefacts: readonly Artefact[];
	/** Axes with no baseline mode to compare against, so no claim is possible. */
	readonly unjudged: readonly ("X" | "Y")[];
};

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
export function newPeaks(baseline: Fingerprint, verified: Fingerprint, floorG = 0.05, tolRel = 0.15): PeakReport {
	const known: Mode[] = [baseline.X, baseline.Y].filter((m): m is Mode => m !== null);
	const out: Artefact[] = [];
	const unjudged: ("X" | "Y")[] = [];
	for (const axis of ["X", "Y"] as const) {
		const m = verified[axis];
		if (!m || m.peakG < floorG) continue;
		// The axis's OWN baseline mode is what a new peak on it has to be new
		// against. Without one there is no comparison to make, and calling the
		// ring an artefact because it does not match the OTHER axis is how a
		// perfectly ordinary Y mode gets reported as one the machine does not
		// have.
		if (baseline[axis] === null) {
			unjudged.push(axis);
			continue;
		}
		const matches = known.some((k) => Math.abs(m.f - k.f) / k.f <= tolRel);
		if (!matches) out.push({ axis, hz: m.f, peakG: m.peakG });
	}
	return { artefacts: out, unjudged };
}
