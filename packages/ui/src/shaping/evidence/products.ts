/**
 * A tool's five products, each with what limits it.
 *
 * A PURE function of the results, and it lives here rather than on the shaping
 * service for a payload reason that turned out to be structural. The service is
 * eager — every screen pays for it — while every card that reads these products
 * is behind the Shaping screen's dynamic import. Hanging the findings layer off
 * the service dragged the whole evidence graph, the copy table and the walk
 * into the eager bundle, which is 15 KB a machine downloads on every cold load
 * to render screens that never mention shaping (issue #72).
 *
 * Derived on every read rather than cached, exactly as it was on the service: a
 * stored copy is a second answer to "is this fingerprint any good", and the two
 * part company the first time a capture is added.
 *
 * Called from more than one card, which is safe in a way a stored value would
 * not be — it is a pure function of one source of truth, so two callers get one
 * answer by construction rather than by coordination.
 */
import type { Caveat } from "./caveat.ts";
import { type Evidence, held, type MachineNow, type Provenance, type Supersede, supersededBy } from "./evidence.ts";
import { candidateCaveats, fingerprintCaveats, sweepCaveats, verifiedCaveats } from "./findings.ts";
import type { WorkflowProducts } from "../steps.ts";
import { capturesOf, fingerprintOf, type ToolResults } from "../results.ts";

/**
 * Provenance for the four products that are not the measurement.
 *
 * Not a placeholder and not laziness — it is the honest answer, and each of
 * the four has its own reason. A SWEEP is built by `buildSweep` from a family
 * of files named on the card, and nothing in a `<prefix>_<axis>_<speed>.csv`
 * records the machine that wrote it. CANDIDATES and VERIFIED are derived from
 * the fingerprint and inherit its caveats through the `inherited` arm, which is
 * the mechanism that matters for them; giving them a provenance of their own
 * would be a second claim about one measurement. APPLIED is what was written
 * into `tpost<N>.g`, and what it needs is not an origin but a comparison
 * against `move.shaping` right now — the `shaper-changed` supersede
 * `supersededBy` explains it is not yet in a position to make.
 *
 * The fingerprint no longer comes through here: it carries whatever
 * `Measurement.provenance` says, which after #57 is `measured` with the
 * conditions attached for anything a run produced.
 */
const UNRECORDED: Provenance = {
	kind: "unknown",
	why: "this product does not yet record the conditions it was built under",
};

/**
 * The five products, each with where it came from and what limits it.
 *
 * `now` replaced a bare `tool` argument with #57. The screen has to compare a
 * stored measurement against TWO facts — the head selected and the machine's
 * acceleration — and passing them as one value is what stops a caller
 * supplying half the comparison and getting a confident answer out of it.
 */
export function productsFor(r: ToolResults, now: MachineNow, specLine: (spec: unknown) => string): WorkflowProducts {
	const fp = fingerprintOf(r);
	const captures = capturesOf(r);

	// What has changed under this file since it was written — the selected head
	// against the one it was measured for, and the machine's acceleration
	// against the one the run planned at. Both from `supersededBy`, which is
	// the only place either comparison is expressed.
	const moved: Supersede | null =
		r.measurement === null ? null : supersededBy(r.tool, r.measurement.provenance, now);

	// HOW FAR THE SUPERSEDE REACHES, which is not the same question as whether
	// there is one, and getting it wrong is how a finding starts firing on
	// things it is not about.
	//
	// A TOOL change is about the FILE. `tool0.json` is T0's file end to end —
	// its sweep is of T0's carriage and its `applied` is what was written into
	// `tpost0.g` — so with T2 selected, every one of the five is about a
	// different head and every one is superseded. That was the behaviour before
	// #57 and it is kept.
	//
	// A CONDITION change is about the MEASUREMENT and whatever was derived from
	// it. Raising `M204` does not un-write the `M593` in `tpost0.g`, and it
	// does not make a speed sweep on the card a picture of something else — the
	// sweep reads forced response across a speed ladder, and its own conditions
	// are unrecorded anyway (see UNRECORDED). Superseding those two on an
	// acceleration change would blank a correct `applied` card every time
	// somebody tuned their travel speed, which is the `axes-agree` lesson: a
	// detector that fires on things it is not about says nothing.
	const wholeFile = moved !== null && moved.kind === "tool-changed";

	const put = <T>(
		value: T | null,
		provenance: Provenance,
		fromMeasurement: boolean,
		caveats: () => readonly Caveat[],
	): Evidence<unknown> => {
		if (value === null) return { state: "absent" };
		if (moved !== null && (wholeFile || fromMeasurement)) return { state: "superseded", value, cause: moved };
		return held(value, provenance, caveats());
	};

	const measured = r.measurement?.provenance ?? UNRECORDED;
	const fingerprint = put(fp, measured, true, () => fingerprintCaveats(fp!, captures, r.sweep));
	return {
		fingerprint,
		sweep: put(r.sweep, UNRECORDED, false, () => sweepCaveats(r.sweep!, fp)),
		// Both of these ARE the measurement, arithmetically: a candidate is a
		// spec scored against the fingerprint and a verified entry is a
		// comparison with it. A baseline that no longer describes the machine
		// takes its arithmetic with it.
		candidates: put(r.candidates.length === 0 ? null : r.candidates, UNRECORDED, true, () =>
			candidateCaveats(r.candidates, fingerprint, r.verified.length)),
		verified: put(r.verified.length === 0 ? null : r.verified, UNRECORDED, true, () => verifiedCaveats(r.verified, specLine)),
		applied: put(r.applied, UNRECORDED, false, () => []),
	};
}
