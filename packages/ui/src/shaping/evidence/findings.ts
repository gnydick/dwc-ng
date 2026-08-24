/**
 * Pure functions from measurements to the caveats they imply.
 *
 * Everything here is arithmetic over data the app already holds, which is the
 * claim issue #68 rests on: every statement an operator worked out by hand on
 * 2026-08-23 was derivable from numbers already on the card. Nothing in this
 * module reads the object model, touches the connector or decides anything — a
 * detector's whole job is to notice, and `evidence.ts` decides what noticing it
 * means for a product.
 *
 * @invariant findings-cite-what-they-came-from
 * @rung 8  illegal state unrepresentable — a `Caveat` has no free-text arm.
 *          Every reason is a record of the numbers it was derived from, and the
 *          sentence is written from those numbers by the copy table. A detector
 *          therefore CANNOT emit a claim it has no evidence for: there is no
 *          shape in the union to put one in
 */
import { type Caveat, severityOf } from "./caveat.ts";
import { type Axis, type Fingerprint, isMode, MAX_FIT_ZETA, type Mode, type NoFit } from "../engine/fit.ts";
import { analysedRows, type SweepMatrix } from "../engine/sweep.ts";
import type { Evidence } from "./evidence.ts";
import type { WorkflowProducts } from "../steps.ts";
import type { CaptureRecord } from "../results.ts";
import { hz, type Hz } from "../engine/units.ts";

/**
 * The full-step rate the matrix was BUILT with, recovered from it.
 *
 * `sweepMatrix` stores `fullStepHz[i] = speeds[i] * fullStepsPerMm`, so the
 * quotient is that rate exactly. Recovered rather than passed in alongside,
 * because a rate handed to the finding separately is a second copy of a number
 * the matrix already holds — and the failure mode of two copies is a finding
 * that disagrees with the dashed locus drawn on the very chart it annotates.
 */
export function fullStepsPerMmOf(m: SweepMatrix): number | null {
	for (let i = 0; i < m.speeds.length; i++) {
		const speed = Number(m.speeds[i]);
		const forced = Number(m.fullStepHz[i]);
		if (speed > 0 && Number.isFinite(forced) && forced > 0) return forced / speed;
	}
	return null;
}

/** Lowest and highest frequency this ladder's motors actually forced. */
export function forcingBand(m: SweepMatrix): readonly [Hz, Hz] | null {
	if (m.fullStepHz.length === 0) return null;
	const fs = m.fullStepHz.map(Number);
	return [hz(Math.min(...fs)), hz(Math.max(...fs))];
}

/**
 * How close a mode has to sit to a forced frequency before it is more likely to
 * BE that forcing than to be a structure ringing near it.
 *
 * One FFT bin. `sweepMatrix` bins at 1 Hz and rounds each peak into the nearest
 * one, so a mode inside a bin of the locus is not distinguishable from the
 * locus by anything the chart can draw — and claiming a distinction the
 * instrument cannot resolve is the exact error this layer exists to prevent.
 */
const LOCUS_BIN_HZ = 1;

const modesOf = (fp: Fingerprint): ReadonlyArray<{ axis: Axis; mode: Mode }> =>
	([["X", fp.X], ["Y", fp.Y]] as const)
		.filter((e): e is readonly ["X" | "Y", Mode] => e[1] !== null)
		.map(([axis, mode]) => ({ axis, mode }));

/**
 * What this sweep can and cannot say, given the fingerprint beside it.
 *
 * The order of the two questions matters and is not arbitrary: a mode is asked
 * "are you ON the locus" BEFORE "are you outside the band", because a mode
 * sitting on a forced frequency is inside the band by definition, and reporting
 * it as merely undriven would name the wrong problem — and the wrong remedy.
 */
export function sweepCaveats(m: SweepMatrix, fp: Fingerprint | null): readonly Caveat[] {
	const out: Caveat[] = [];

	const analysed = analysedRows(m);
	if (analysed < m.speeds.length) {
		out.push({ kind: "rows-not-analysed", analysed, rows: m.speeds.length });
	}

	const band = forcingBand(m);
	const perMm = fullStepsPerMmOf(m);
	if (fp === null || band === null || perMm === null) return out;

	for (const { axis, mode } of modesOf(fp)) {
		const f = Number(mode.f);
		const onLocus = m.fullStepHz.findIndex((forced) => Math.abs(Number(forced) - f) <= LOCUS_BIN_HZ);
		if (onLocus >= 0) {
			out.push({
				kind: "mode-on-forcing-locus",
				axis,
				modeHz: mode.f,
				speedMmPerS: Number(m.speeds[onLocus]),
			});
			continue;
		}
		if (f < Number(band[0]) || f > Number(band[1])) {
			out.push({
				kind: "forcing-band-excludes-mode",
				axis,
				modeHz: mode.f,
				bandHz: band,
				needMmPerS: f / perMm,
			});
		}
	}
	return out;
}

/**
 * How much spread makes an axis untrustworthy, as a fraction of its own mode
 * frequency.
 *
 * Ten per cent, and the number is NOT invented for this finding: it is the same
 * ±10 % mistuning band the Candidates card already ranks robustness over — the
 * margin that decides whether a shaper survives a tool change. A direction
 * whose spread eats that whole band has made the ranking meaningless, which is
 * precisely when the operator needs telling.
 */
const SPREAD_FRACTION = 0.1;

const spreadOf = (caps: readonly CaptureRecord[]): number => {
	const fs = caps.filter((c) => isMode(c.fit)).map((c) => Number((c.fit as Mode).f));
	return fs.length === 0 ? 0 : Math.max(...fs) - Math.min(...fs);
};

/**
 * What a fingerprint can say about its own trustworthiness.
 *
 * `sweep` is passed so the locus question can be ASKED here, on the card that
 * shows the modes, rather than only on the sweep card. Passing `null` does not
 * mean "no problem": it produces `mode-locus-unknown`, because a fingerprint
 * card that stayed silent about a check nobody ran reads as a card that ran it.
 */
export function fingerprintCaveats(
	fp: Fingerprint,
	captures: readonly CaptureRecord[],
	sweep: SweepMatrix | null,
): readonly Caveat[] {
	const out: Caveat[] = [];

	for (const { axis, mode } of modesOf(fp)) {
		const mine = captures.filter((c) => c.axis === axis);
		const attempted = mine.length;
		const fitted = mine.filter((c) => isMode(c.fit));
		const plusFits = fitted.filter((c) => c.dir === "+");
		const minusFits = fitted.filter((c) => c.dir === "-");

		// A spread needs at least two numbers to BE a spread, and both sides
		// need them. `spreadOf([])` is 0, and comparing against that reported
		// "0.00 Hz of spread" for a direction that fitted nothing — a
		// fabricated measurement, which `findings-cite-what-they-came-from`
		// exists to make impossible. Found on Gabe's board 2026-08-24, where
		// all ten Y-plus captures were refused.
		if (plusFits.length >= 2 && minusFits.length >= 2) {
			const plus = spreadOf(plusFits);
			const minus = spreadOf(minusFits);
			const limit = Number(mode.f) * SPREAD_FRACTION;
			// One direction over the band and the other under it. Both over is
			// a noisy axis; what is worth a sentence is the ASYMMETRY, because
			// its cause is physical.
			if ((plus > limit) !== (minus > limit)) {
				out.push({ kind: "direction-spread", axis, plusHz: hz(plus), minusHz: hz(minus), modeHz: mode.f });
			}
		} else if (fitted.length > 0 && (plusFits.length === 0 || minusFits.length === 0)) {
			// One direction produced everything. Only worth saying when the
			// other was actually ATTEMPTED — a run that only ever drove one way
			// has not lost anything.
			const dir: "+" | "-" = plusFits.length === 0 ? "-" : "+";
			const other = mine.filter((c) => c.dir !== dir).length;
			if (other > 0) {
				out.push({ kind: "one-direction-only", axis, dir, n: fitted.length, refused: other });
			}
		}

		// Refusals, whatever reason they carry. Reported by the DOMINANT
		// reason: a mixed bag is still one story to the operator, and naming
		// the most common one keeps the sentence to a single remedy.
		const refusedFits = mine.filter((c) => !isMode(c.fit));
		if (refusedFits.length > 0) {
			const tally = new Map<NoFit["reason"], number>();
			for (const c of refusedFits) {
				if (isMode(c.fit)) continue;
				tally.set(c.fit.reason, (tally.get(c.fit.reason) ?? 0) + 1);
			}
			let reason: NoFit["reason"] = "short-window";
			let best = -1;
			for (const [r, n] of tally) if (n > best) { reason = r; best = n; }
			const cycles = refusedFits
				.map((c) => (isMode(c.fit) ? null : c.fit.cyclesFit ?? null))
				.filter((n): n is number => n !== null)
				.sort((a, b) => a - b);
			out.push({
				kind: "fits-refused",
				axis,
				refused: refusedFits.length,
				of: attempted,
				reason,
				cyclesFit: cycles.length === 0 ? null : cycles[cycles.length >> 1]!,
				cap: MAX_FIT_ZETA,
			});
		}

		// A median over fewer than three is barely a median. This is about the
		// SURVIVORS being thin, which is a different fact from captures having
		// been refused (`fits-refused` above) — the old `n < attempted / 2`
		// conflated the two and then missed the case at exactly half.
		const n = axis === "X" ? fp.n.X : fp.n.Y;
		if (n > 0 && n < 3) out.push({ kind: "few-fits", axis, n, of: attempted });
	}

	// Two axes agreeing, which needs BOTH and so cannot live in the per-axis
	// loop above. See the `axes-agree` arm in caveat.ts for why this matters:
	// on the 2026-08-23 run every capture fitted cleanly and no other quality
	// finding fires, yet the measurement was taken through an active shaper.
	if (fp.X !== null && fp.Y !== null) {
		const x = Number(fp.X.f);
		const y = Number(fp.Y.f);
		const apart = Math.abs(x - y) / Math.max(x, y);
		// The same ±10 % the rest of this module uses, and for the same reason:
		// inside it a single shaper tuned to one axis sits within the other's
		// mistuning band, so the two are not separable by shaping at all.
		if (apart <= SPREAD_FRACTION) {
			out.push({ kind: "axes-agree", xHz: fp.X.f, yHz: fp.Y.f, apartFraction: apart });
		}
	}

	if (modesOf(fp).length === 0) return out;
	if (sweep === null) out.push({ kind: "mode-locus-unknown" });
	else out.push(...sweepCaveats(sweep, fp).filter((c) => c.kind === "mode-on-forcing-locus"));

	return out;
}

/**
 * What a ranked list has to say about itself.
 *
 * Two things, and the second is the important one. It is a PREDICTION until
 * something has been measured on the machine — the ranking is arithmetic over
 * an impulse model, and on this machine the top-ranked candidate once
 * introduced a 38 Hz mode that no amount of better arithmetic would have
 * caught. And it INHERITS: whatever limits the fingerprint limits everything
 * ranked from it, automatically, because a step that had to remember to check
 * is a step that will one day forget.
 */
/**
 * The shape this module needs off a candidate, without importing the branded
 * `Candidate` type.
 *
 * `candidateCaveats` takes `readonly unknown[]` so that the workflow can hold
 * products as `Evidence<unknown>` — see steps.ts `WorkflowProducts`. Narrowing
 * here rather than widening the signature keeps that boundary intact, and a
 * value that does not carry these fields simply contributes no trade-off
 * finding instead of throwing.
 */
type RankedLike = { readonly spec: { readonly type: string }; readonly worstRobust: number; readonly durationS: number };

const isRanked = (c: unknown): c is RankedLike => {
	if (typeof c !== "object" || c === null) return false;
	const v = c as Record<string, unknown>;
	const spec = v.spec;
	return (
		typeof v.worstRobust === "number" &&
		typeof v.durationS === "number" &&
		typeof spec === "object" &&
		spec !== null &&
		typeof (spec as Record<string, unknown>).type === "string"
	);
};

export function candidateCaveats(
	candidates: readonly unknown[],
	fingerprint: Evidence<unknown>,
	verifiedCount: number,
): readonly Caveat[] {
	const out: Caveat[] = [];
	if (candidates.length === 0) return out;

	// The trade the ordering hides. Both ends of the list the operator is
	// looking at, so the sentence states the choice rather than describing it;
	// only worth saying when the list actually holds more than one option.
	const shaped = candidates.filter((c): c is RankedLike => isRanked(c));
	if (shaped.length >= 2) {
		const best = shaped[0]!;
		const lean = shaped.reduce((a, b) => (Number(b.durationS) < Number(a.durationS) ? b : a));
		if (lean !== best) {
			out.push({
				kind: "ranking-trade-off",
				bestType: best.spec.type,
				bestResidual: best.worstRobust,
				bestMs: Number(best.durationS) * 1000,
				leanType: lean.spec.type,
				leanResidual: lean.worstRobust,
				leanMs: Number(lean.durationS) * 1000,
			});
		}
	}

	if (verifiedCount === 0) out.push({ kind: "predicted-not-measured", n: candidates.length });
	if (fingerprint.state === "held") {
		for (const c of fingerprint.caveats) out.push({ kind: "inherited", from: "fingerprint", caveat: c });
	}
	return out;
}

/**
 * The one sentence for the top of the screen, folded out of the five products.
 *
 * A FOLD and not a stored value: a thread anything could set independently is a
 * thread that can contradict the card it summarises, which is the drift
 * `nextStep` was already built to prevent one level down.
 *
 * The pick, in the operator's order: anything shaping cannot act on first,
 * because it is the only kind with an action attached; then the earliest
 * product in the workflow, because a note about the ranking while the
 * fingerprint under it is questionable points at the wrong thing.
 */
export function screenThread(p: WorkflowProducts): Caveat | null {
	const inOrder: ReadonlyArray<Evidence<unknown>> = [p.fingerprint, p.sweep, p.candidates, p.verified, p.applied];
	const all = inOrder.flatMap((e) => (e.state === "held" ? [...e.caveats] : []));
	return all.find((c) => severityOf(c) === "disqualifying") ?? all[0] ?? null;
}
