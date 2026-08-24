/**
 * One small state machine, instantiated once per product the Shaping workflow
 * makes: fingerprint, sweep, candidates, verified, applied.
 *
 * WHY THIS EXISTS. The workflow used to ask eight booleans — `hasFingerprint`,
 * `hasSweep` and so on. A boolean makes "a fingerprint exists" and "a
 * fingerprint valid for ranking" THE SAME VALUE, so a fingerprint measured
 * through an active shaper, or taken at an acceleration you do not print at, or
 * judged against a sweep that never excited the modes, all read `true` exactly
 * like a clean one. And nothing ever went back to `false`: a tool change left
 * every product looking as fresh as the moment it was measured. On 2026-08-23
 * that produced a wrong conclusion on real hardware — a sweep whose ladder ran
 * 25–200 mm/s (forcing 125–1000 Hz at 5 full steps/mm) was read as evidence
 * against modes at 38.7 and 41.5 Hz that nothing in it could have driven.
 *
 * @invariant a-product-cannot-be-consumed-by-a-step-it-is-not-valid-for
 * @rung 8  illegal state unrepresentable — a consumer's parameter type is
 *          `Evidence<T>`, and the arms that hold no usable value hold no value
 *          at all. There is no boolean left in any signature to erase the
 *          distinction, so a step written by someone who read nothing must
 *          still narrow the union before it can reach a number
 * @why every finding in issue #68 is one sentence — evidence exists but is not
 *      valid for its consumer, and nothing could say so
 *
 * @invariant verdict-is-derived-never-stored
 * @rung 7  derive, don't duplicate — `verdictOf` is a pure function OF the
 *          caveat list and the provenance. A held product with an empty caveat
 *          list and a "caveated" verdict is not a state anything can build,
 *          because the verdict is not a field
 */
import { type Caveat, severityOf } from "./caveat.ts";

/**
 * The two sentences this module needs, passed IN rather than imported.
 *
 * copy.ts already imports this module's types, and having the machine reach
 * back for its prose would make the pair a cycle whose direction depends on
 * which file a reader opens first. Injecting keeps the arrow one-way — the
 * machine decides, the copy table speaks — and it is what lets a test assert
 * the LIFECYCLE without asserting the wording.
 */
export type CaveatCopy = {
	readonly caveat: (c: Caveat) => string;
	readonly supersede: (s: Supersede) => string;
};

/**
 * Where a product came from.
 *
 * A union with an `unknown` arm rather than an optional field, so a product
 * cannot be held without SAYING where it came from. Hand-assembled captures
 * stay usable — that is deliberate, they are the only reason 259 prototype
 * captures are usable at all — but they stop looking identical to measured
 * ones, which is the requirement #57 states.
 */
export type Provenance =
	| { readonly kind: "measured"; readonly at: string; readonly tool: number }
	| { readonly kind: "assembled"; readonly n: number }
	| { readonly kind: "loaded"; readonly path: string }
	| { readonly kind: "unknown"; readonly why: string };

/** What changed under a product after it was made. */
export type Supersede =
	| { readonly kind: "tool-changed"; readonly was: number; readonly now: number }
	| { readonly kind: "shaper-changed"; readonly was: string; readonly now: string }
	| { readonly kind: "accel-changed"; readonly was: number; readonly now: number };

export type Held<T> = {
	readonly state: "held";
	readonly value: T;
	readonly provenance: Provenance;
	readonly caveats: readonly Caveat[];
};

export type Evidence<T> =
	| { readonly state: "absent" }
	| { readonly state: "running"; readonly what: string }
	| { readonly state: "failed"; readonly why: string }
	| Held<T>
	| { readonly state: "superseded"; readonly value: T; readonly cause: Supersede };

/**
 * The sole way to build a `held`, so provenance can never be omitted.
 *
 * Returns `Evidence<T>` rather than `Held<T>` deliberately: a caller that wants
 * the held-only shape must narrow for it, which keeps the invariant's story the
 * same at every call site.
 */
export const held = <T>(value: T, provenance: Provenance, caveats: readonly Caveat[]): Evidence<T> => ({
	state: "held",
	value,
	provenance,
	caveats,
});

export type Verdict = "sound" | "caveated" | "unusable" | "unattributable";

/**
 * What a held product is good for.
 *
 * ONE total function evaluated in ONE order, and the order is the operator's:
 *
 *  1. `unusable` — there is something to go and fix, and that outranks
 *     everything because it is the only arm with an action attached.
 *  2. `unattributable` — it cannot be checked, so the caveat list cannot be
 *     trusted to be COMPLETE. An empty list on an unattributable product is
 *     not evidence of soundness, which is why this sits above `caveated`
 *     rather than below it.
 *  3. `caveated` — trustworthy, with stated limits.
 *  4. `sound`.
 *
 * The order is written once, here. A second expression choosing a verdict is
 * the drift `step-readiness-has-one-answer` already exists to prevent one level
 * down, and its failure mode is worse here: a card reading "sound" over a
 * product another card calls unusable.
 */
export function verdictOf<T>(h: Held<T>): Verdict {
	if (h.caveats.some((c) => severityOf(c) === "disqualifying")) return "unusable";
	if (h.provenance.kind === "unknown") return "unattributable";
	return h.caveats.length > 0 ? "caveated" : "sound";
}

/**
 * The value, or null where the state does not carry one.
 *
 * `superseded` DOES carry its value: the numbers are still on the card and
 * still worth showing — what changed is whether they describe the machine in
 * front of you. Dropping the value would turn "this is out of date" into "this
 * never happened".
 */
export function valueFor<T>(e: Evidence<T>): T | null {
	switch (e.state) {
		case "held":
		case "superseded":
			return e.value;
		case "absent":
		case "running":
		case "failed":
			return null;
		default: {
			const unhandled: never = e;
			throw new Error(`unknown evidence state: ${String((unhandled as { state: unknown }).state)}`);
		}
	}
}

/**
 * What a control over this product may do, as one value.
 *
 * `armed` is not a new invention: `createArmed` is already how this screen asks
 * for confirmation before writing to the card. Routing a caveat into it rather
 * than into `disabled` is deliberate — a caveat must never take away a control
 * that sends G-code, because the firmware and the planner are the authorities
 * on what the machine may do. What a caveat buys is one sentence the operator
 * has to read first.
 *
 * `disabled` is reserved for the two cases where there is nothing to confirm:
 * no product at all, and a product shaping demonstrably cannot act on.
 *
 * A note on where this IS and IS NOT used, because the difference is a
 * decision rather than an oversight. The five workflow steps take the
 * `stepReadiness` treatment instead — enabled, with the caveat as the sentence
 * beside the button — because Rank is arithmetic and Measure is the remedy for
 * most caveats, and arming a control whose whole purpose is to fix the problem
 * it is warning about is friction with no safety in it. This is for the
 * controls that CHANGE THE MACHINE from a product: Apply, which writes `M593`
 * or `tpost<N>.g`.
 */
export type Lifecycle =
	| { readonly kind: "enabled" }
	| { readonly kind: "armed"; readonly confirm: string }
	| { readonly kind: "disabled"; readonly note: string };

export function lifecycleOf<T>(e: Evidence<T>, text: CaveatCopy): Lifecycle {
	switch (e.state) {
		case "absent":
			return { kind: "disabled", note: "nothing measured yet" };
		case "running":
			return { kind: "disabled", note: `${e.what}…` };
		case "failed":
			return { kind: "disabled", note: e.why };
		case "superseded":
			return { kind: "armed", confirm: text.supersede(e.cause) };
		case "held":
			switch (verdictOf(e)) {
				case "sound":
					return { kind: "enabled" };
				case "unusable": {
					// Non-null by construction: `unusable` is returned only when
					// verdictOf found a disqualifying caveat in this very list.
					const bad = e.caveats.find((c) => severityOf(c) === "disqualifying")!;
					return { kind: "disabled", note: text.caveat(bad) };
				}
				case "unattributable":
					return {
						kind: "armed",
						confirm: `${e.provenance.kind === "unknown" ? e.provenance.why : ""} — so this cannot be checked against the machine in front of you`,
					};
				case "caveated":
					return { kind: "armed", confirm: text.caveat(e.caveats[0]!) };
			}
		// falls through only if verdictOf gained an arm without one here
		default: {
			const unhandled: never = e;
			throw new Error(`unknown evidence state: ${String((unhandled as { state: unknown }).state)}`);
		}
	}
}
