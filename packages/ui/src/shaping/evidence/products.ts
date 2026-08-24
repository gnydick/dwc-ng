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
import { type Evidence, held, type Provenance, type Supersede } from "./evidence.ts";
import { candidateCaveats, fingerprintCaveats, sweepCaveats, verifiedCaveats } from "./findings.ts";
import type { WorkflowProducts } from "../steps.ts";
import type { ToolResults } from "../results.ts";

/**
 * Provenance for everything, at this phase.
 *
 * Not a placeholder: it is the honest answer until #57 records what a run was
 * taken under, and it is what makes the screen say "this cannot be checked"
 * rather than implying it was.
 */
const UNRECORDED: Provenance = {
	kind: "unknown",
	why: "measurements do not yet record the conditions they were taken under",
};

export function productsFor(r: ToolResults, tool: number, specLine: (spec: unknown) => string): WorkflowProducts {
	// `ToolResults.tool` is the head this file was written for. Selecting a
	// different one does not make the numbers wrong — it makes them about a
	// different carriage, and carriage mass is what moves the frequency.
	const moved: Supersede | null =
		r.fingerprint !== null && r.tool !== tool ? { kind: "tool-changed", was: r.tool, now: tool } : null;

	const put = <T>(value: T | null, caveats: () => readonly Caveat[]): Evidence<unknown> => {
		if (value === null) return { state: "absent" };
		if (moved !== null) return { state: "superseded", value, cause: moved };
		return held(value, UNRECORDED, caveats());
	};

	const fingerprint = put(r.fingerprint, () => fingerprintCaveats(r.fingerprint!, r.captures, r.sweep));
	return {
		fingerprint,
		sweep: put(r.sweep, () => sweepCaveats(r.sweep!, r.fingerprint)),
		candidates: put(r.candidates.length === 0 ? null : r.candidates, () =>
			candidateCaveats(r.candidates, fingerprint, r.verified.length)),
		verified: put(r.verified.length === 0 ? null : r.verified, () => verifiedCaveats(r.verified, specLine)),
		applied: put(r.applied, () => []),
	};
}
