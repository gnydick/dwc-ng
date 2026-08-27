/**
 * WHICH SPEC the Shaping screen is acting on — one value, every acting card a
 * reader of it.
 *
 * Gabe, 2026-08-27: "tap means use this spec". Before this module the tap set
 * an INDEX into `candidates` that the Verify card honoured and the Apply card
 * did not: Apply asked `recommendation()` for its own answer, so tapping row 3
 * ran row 3 through the verify run and still offered row 1 to write into
 * `tpost<N>.g`. Two cards, two derivations of one question, free to disagree —
 * and they did, visibly, with `aria-pressed` on the row the second card
 * ignored.
 *
 * An index could not be the fix. `recommendation` draws its answer from
 * `verified` when a clean verified result exists, and a verified spec need not
 * appear in `candidates` at the same position or at all — the results file
 * carries a verify run's spec whether or not this build's ranking grid
 * produced it — so there is no index expressing "the default is that verified
 * spec". The selection is the spec's IDENTITY instead, resolved against the
 * tool's own results every time it is read.
 *
 * @invariant a-selection-is-one-of-this-tools-own-results
 * @rung 7  sole-constructor type — `Selection` carries `selectionBrand`, a
 *          `unique symbol` declared in this module and never exported, so an
 *          object literal of that type cannot be written anywhere else: a
 *          second route to a selection is a compile error, not a review
 *          catch. `made` is the only expression in the program that produces
 *          one, it is module-private, and both of its call sites are inside
 *          `selectionOf`. Neither can hand it a foreign spec: one passes what
 *          `findSpec` located inside the `ToolResults` argument, the other
 *          passes what `recommendation` returned, which is itself an element
 *          of `r.verified` or `r.candidates`. A `SpecKey` naming nothing in
 *          `r` — the previous tool's shaper, a spec dropped by a re-rank —
 *          resolves to the default rather than to itself, so the stale-key
 *          state has no representation to reach.
 * @why the selected spec becomes the `M593` line written into `tpost<N>.g`, at
 *      every future pickup of that head. A selection that outlived the results
 *      it was made against would install a shaper measured on a different
 *      tool, under the name of this one.
 */

import type { Candidate } from "./engine/rank.ts";
import type { ShaperSpec } from "./engine/shapers.ts";
import type { ToolResults } from "./results.ts";
import type { VerifiedCandidate } from "./store.ts";

// Declared, never exported, no runtime value: the brand lives only in the type
// system, which is where the guarantee is needed.
declare const specKeyBrand: unique symbol;
declare const selectionBrand: unique symbol;

/** A spec's identity, as the one string two specs share exactly when they are
 *  the same line of G-code. */
export type SpecKey = string & { readonly [specKeyBrand]: true };

/**
 * The identity of a spec.
 *
 * Fixed decimals rather than raw `toString`, because the same shaper arrives
 * from two directions — re-scored by the ranking engine, and parsed back out
 * of the results file — and a float that made a round trip through JSON has to
 * key the same as the one that did not. Three and four places are far finer
 * than either the ranking grid's F step or its S ladder, so no two distinct
 * rows collapse onto one key.
 */
export const specKey = (spec: ShaperSpec): SpecKey =>
	(spec.type === "custom"
		? `custom:${spec.H.map(h => h.toFixed(6)).join(",")}:${spec.T.map(t => Number(t).toFixed(6)).join(",")}`
		: `${spec.type}:${spec.F.toFixed(3)}:${spec.S.toFixed(4)}`) as SpecKey;

/**
 * Where the selected spec came from.
 *
 * `verified` and `predicted` are the recommendation's own two answers, kept
 * word for word. `override` is the operator having tapped something else — a
 * departure from the recommendation, which the Apply card states as one so it
 * reads as a decision rather than as the machine's advice.
 */
export type SelectionBasis = "verified" | "predicted" | "override";

export type Selection = {
	readonly spec: ShaperSpec;
	readonly basis: SelectionBasis;
	/** The ranked row for this spec, where the ranking has one — its predicted numbers. */
	readonly candidate: Candidate | null;
	/** The verify run's own numbers for this spec, where one has been run. */
	readonly verified: VerifiedCandidate | null;
	readonly [selectionBrand]: true;
};

/** The largest share of the baseline ring left on any axis — the honest
 *  single number for "how well did this actually work". */
const worstMeasured = (v: VerifiedCandidate): number => Math.max(0, ...Object.values(v.measured));

/**
 * The line to put on the machine, absent an operator saying otherwise.
 *
 * A verified candidate that introduced no mode of its own beats anything
 * merely predicted, however good the prediction — that ordering IS the lesson
 * of the 2026-08-22 session, where the model's second-favourite shaper of any
 * type measured 167 % of the unshaped ring. Among those, the one that left
 * least behind, measured; and only with nothing verified at all does the
 * ranking's own top row stand in, labelled as the guess it is.
 *
 * This function once WAS the Apply card's answer, privately. It is the DEFAULT
 * selection now: the same ordering, deciding what is selected before anybody
 * taps, rather than deciding again after they have.
 */
export function recommendation(r: ToolResults): { spec: ShaperSpec; basis: "verified" | "predicted" } | null {
	// Clean means CHECKED and clean. A candidate whose artefact test could not
	// run on an axis (no baseline mode to compare against) has not earned
	// "measured on the machine, no new peaks" — that sentence would be claiming
	// a result nobody established.
	const clean = r.verified.filter(v => v.artefacts.length === 0 && v.unjudged.length === 0);
	if (clean.length > 0) {
		const best = clean.reduce((a, b) => (worstMeasured(b) < worstMeasured(a) ? b : a));
		return { spec: best.spec, basis: "verified" };
	}
	const top = r.candidates[0];
	return top === undefined ? null : { spec: top.spec, basis: "predicted" };
}

/** The spec this key names, looked up in these results and nowhere else. The
 *  verify list is searched first so a spec present in both carries its run. */
function findSpec(r: ToolResults, key: SpecKey): ShaperSpec | null {
	return (
		r.verified.find(v => specKey(v.spec) === key)?.spec ??
		r.candidates.find(c => specKey(c.spec) === key)?.spec ??
		null
	);
}

/**
 * The only expression in the program that produces a `Selection`.
 *
 * Both halves of the evidence are looked up HERE, from the same results the
 * spec was found in, so a card cannot pair this spec with another row's
 * numbers: it is handed the numbers rather than told where to go and find some.
 */
function made(r: ToolResults, spec: ShaperSpec, basis: SelectionBasis): Selection {
	const key = specKey(spec);
	return {
		spec,
		basis,
		candidate: r.candidates.find(c => specKey(c.spec) === key) ?? null,
		verified: r.verified.find(v => specKey(v.spec) === key) ?? null,
	} as Selection;
}

/**
 * The tool's selection: the operator's pick where these results still hold it,
 * the recommendation otherwise, and null when the tool has nothing to select.
 *
 * A pick is a request, not a fact — resolution is what turns it into one. That
 * is also the whole of the tool-change answer: a key made against T0's ranking
 * names nothing in T1's, so reading the selection after a tool change gives
 * T1's own default — no reset anywhere has to fire first for that to hold.
 */
export function selectionOf(r: ToolResults, pick: SpecKey | null): Selection | null {
	const fallback = recommendation(r);
	const chosen = pick === null ? null : findSpec(r, pick);
	if (chosen === null) return fallback === null ? null : made(r, fallback.spec, fallback.basis);
	// Tapping the row the recommendation already chose is not a departure from
	// it, so it keeps the recommendation's own word for where it came from.
	const basis: SelectionBasis = fallback !== null && specKey(fallback.spec) === pick ? fallback.basis : "override";
	return made(r, chosen, basis);
}
