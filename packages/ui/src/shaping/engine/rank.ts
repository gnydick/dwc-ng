// Rank every RRF shaper over an F/S grid against a measured fingerprint.
// The score is the WORST axis's residual with the mode ±10 % off — RRF has
// one global M593, so the recommendation is a compromise, and a knife-edge
// null is not a recommendation.

import type { Fingerprint, Mode } from "./fit.ts";
import { residual, robust } from "./residual.ts";
import { duration, impulses, SHAPER_TYPES, type ShaperSpec } from "./shapers.ts";
import { hz, type Seconds } from "./units.ts";

declare const candidateBrand: unique symbol;

export type Candidate = {
	readonly spec: ShaperSpec;
	readonly residual: { readonly X?: number; readonly Y?: number };
	readonly robust: { readonly X?: number; readonly Y?: number };
	readonly worstRobust: number;
	readonly durationS: Seconds;
	readonly [candidateBrand]: true;
};

function evaluate(spec: ShaperSpec, fp: Fingerprint): Candidate {
	const imp = impulses(spec);
	const res: { X?: number; Y?: number } = {};
	const rob: { X?: number; Y?: number } = {};
	for (const axis of ["X", "Y"] as const) {
		const m: Mode | null = fp[axis];
		if (!m) continue;
		res[axis] = residual(imp, m);
		rob[axis] = robust(imp, m);
	}
	const worst = Math.max(0, ...Object.values(rob));
	return { spec, residual: res, robust: rob, worstRobust: worst, durationS: duration(imp) } as Candidate;
}

export type RankOptions = {
	readonly sValues?: readonly number[];
	readonly fStepHz?: number;
};

export function rank(fp: Fingerprint, opts: RankOptions = {}): Candidate[] {
	const fs = [fp.X?.f, fp.Y?.f].filter((f): f is Mode["f"] => f !== undefined);
	if (fs.length === 0) return [];
	const sValues = opts.sValues ?? [0.05, 0.1, 0.15, 0.2];
	const step = opts.fStepHz ?? 0.5;
	const fLo = Math.floor(0.7 * Math.min(...fs));
	const fHi = Math.ceil(1.3 * Math.max(...fs));
	const out: Candidate[] = [];
	for (const type of SHAPER_TYPES) {
		for (let f = fLo; f <= fHi + 1e-9; f += step) {
			for (const S of sValues) out.push(evaluate({ type, F: hz(Math.round(f * 1000) / 1000), S }, fp));
		}
	}
	out.sort((a, b) => Math.round(a.worstRobust * 1000) - Math.round(b.worstRobust * 1000) || a.durationS - b.durationS);
	return out;
}

/**
 * Score ONE spec against a fingerprint, exactly as `rank` scores the grid.
 *
 * The reason this is exported rather than kept private to `rank`: a candidate
 * persisted to the SD card is written as its SPEC alone and re-scored through
 * here on read. Storing the residuals as well would be the same number in two
 * places, and the copy on the card is the one nobody recomputes when the
 * fingerprint or the shaper model changes.
 */
export function candidateFor(spec: ShaperSpec, fp: Fingerprint): Candidate {
	return evaluate(spec, fp);
}

export function customCandidate(spec: Extract<ShaperSpec, { type: "custom" }>, fp: Fingerprint): Candidate {
	return evaluate(spec, fp);
}
