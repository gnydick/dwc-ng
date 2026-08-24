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

/**
 * The candidates worth putting in front of somebody: the Pareto front over
 * (worst residual, duration).
 *
 * WHY THIS EXISTS. `rank` sorts on `worstRobust` alone, with `durationS` only a
 * tie-break at 0.001 granularity — and that tie never fires between shaper
 * types, because the widest shaper always wins the residual contest outright.
 * Taking the top 40 of that order therefore produced 40 rows of ONE shaper.
 * Measured on Gabe's machine 2026-08-24 (X 38.66, Y 50.05): every one of the
 * top 50 was `zvddd` at ~44.7 ms, while `zvdd` reached 0.0270 in 33.5 ms and
 * never appeared. The 11 ms it costs to go from 0.0270 to 0.0081 is a real
 * trade — 11 ms of extra smoothing on every direction change — and the list
 * hid the fact that a trade existed at all.
 *
 * A front rather than a re-weighting, deliberately. Weighting residual against
 * milliseconds would mean inventing an exchange rate between "ringing left" and
 * "corners rounded", which is a judgement about the operator's prints and not
 * one this tool has any basis to make. The front states the options and leaves
 * the choice where it belongs.
 *
 * @invariant shortlist-is-dominated-free
 * @rung 6  choke-point — the sole route from a full grid to what a card shows.
 *          A candidate survives only if nothing else is at least as good on
 *          BOTH axes, so no row on the list is beaten outright by another row
 *          on the same list
 */
export function shortlist(all: readonly Candidate[], n: number, perType = 3): Candidate[] {
	// Residual to 4 decimals and duration to a tenth of a millisecond, so
	// float noise cannot make two indistinguishable candidates each "dominate"
	// the other and bloat the front with duplicates.
	const res = (c: Candidate): number => Math.round(c.worstRobust * 1e4);
	const dur = (c: Candidate): number => Math.round(Number(c.durationS) * 1e4);

	// Ascending residual: any later candidate is worse-or-equal there, so it
	// earns its place only by being strictly shorter than everything before it.
	const byResidual = [...all].sort((a, b) => res(a) - res(b) || dur(a) - dur(b));
	const front: Candidate[] = [];
	const seen = new Map<string, number>();
	let shortest = Number.POSITIVE_INFINITY;
	for (const c of byResidual) {
		const d = dur(c);
		if (d >= shortest) continue;
		// Dominance is what makes a row honest; the per-type cap is what makes
		// the list readable. On Gabe's fingerprint the raw front held
		// twenty-one `zvddd` rows separated by 0.3 ms and 0.001 residual —
		// each genuinely undominated, none of them a decision anybody could
		// make. Capping is a PRESENTATION choice and is kept separate from the
		// dominance test on purpose: it never lets a dominated row in, it only
		// stops showing more of an option already on the list.
		const type = c.spec.type;
		const used = seen.get(type) ?? 0;
		// `shortest` advances whether or not the row is shown, so a capped type
		// cannot go on blocking shorter rows of another type behind it.
		shortest = d;
		if (used >= perType) continue;
		seen.set(type, used + 1);
		front.push(c);
		if (front.length >= n) break;
	}
	return front;
}
