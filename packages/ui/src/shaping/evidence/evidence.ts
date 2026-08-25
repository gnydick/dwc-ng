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
 * @why a stored verdict is a second copy of what the caveats already say, and
 *      the two part company the moment a caveat is added, dropped or re-graded
 *      — the copy keeps reading clean after the thing it describes stopped
 *      being clean. That is the 2026-08-23 failure in miniature, at one field
 *      instead of eight booleans, and it would be invisible for the same
 *      reason: nothing looks wrong about a verdict that used to be true
 */
import { type Caveat, severityOf } from "./caveat.ts";
import type { ShaperSpec } from "../engine/shapers.ts";

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
	/**
	 * Why a product cannot be checked against the machine in front of you.
	 *
	 * Added with #57. Before it, `lifecycleOf` spoke for the `unknown` arm by
	 * reaching into `provenance.why` and appended the empty string for every
	 * other arm — which was harmless only while `unknown` was the sole arm that
	 * could be unattributable. Now that `assembled` and `loaded` are reachable
	 * and unattributable too, a sentence per arm has to exist somewhere, and it
	 * belongs in the copy table with every other sentence rather than in the
	 * state machine.
	 */
	readonly provenance: (p: Provenance) => string;
};

/**
 * The machine state a measurement was taken under.
 *
 * Gabe, 2026-08-23, reading `tool0.json`: "is there some sort of session
 * there? because there's no notion of session for the UI." Right on both
 * counts — the file read as one coherent session and nothing in its
 * construction made it one. This type is that session, and every field in it
 * is a quantity that changes the numbers beside it.
 *
 * WHAT IS HERE, AND WHY EACH ONE. `shaper` is what the run STATED it would
 * measure through, taken from `measuredThrough` (procedure.ts) and nowhere
 * else — the same value the `M593` was built from, so the label and the
 * command cannot disagree. Read the note at the bottom before treating it as a
 * guarantee. `accelMmPerS2` is `move.travelAcceleration` as the board reported
 * it at the moment the run was planned: it is what decelerates the carriage,
 * so it sets how hard the ring-down was struck, and it is the one condition
 * Phase 3 of the interpretation spec names as superseding. `speedMmPerS` and
 * `distMm` decide how long the move was and therefore how much of the decay
 * the analysis window holds — a 25 mm/s pass and a 200 mm/s pass over the same
 * 100 mm are not the same measurement, which is the whole content of #68.
 * `repeats` is how many times each direction was struck, and it is the
 * denominator the `few-fits` and `one-direction-only` findings are read
 * against.
 *
 * WHAT IS NOT HERE, DECIDED RATHER THAN FORGOTTEN.
 *
 *  - The TOOL. It is `ToolResults.tool` — the file this measurement lives in —
 *    and a second copy here would be one bound stated in two places, which is
 *    the drift "derive, don't duplicate" exists to prevent. `supersededBy`
 *    compares the file's tool against the head selected now, and that is the
 *    only comparison anything makes.
 *  - The accelerometer SAMPLING RATE. It is a real condition — Nyquist bounds
 *    what the fitter can see at all — but no `Supersede` arm and no finding
 *    consumes it today, and a field recorded for nobody is a field that goes
 *    stale unnoticed and is believed anyway. `locus-above-nyquist` already
 *    speaks for the sweep. Left for the ticket that gives it a consumer.
 *
 * A NOTE ON `shaper`, because #53 is explicit about it. This is a LABEL, not
 * the guarantee that a baseline was measured unshaped. That guarantee is
 * structural: `shaperStep` switches over the plan kinds with a `never` arm, so
 * a plan that says nothing about its shaper does not compile, and every ring
 * and every sweep sends `M593 P"none"` before it records anything. A
 * self-reported flag can be forged by a hand-edited card file; the code path
 * that wrote it cannot. What the label buys is the ability to READ a file
 * months later and see that this one is a verify pass through `ei2 F52` and
 * that one is a baseline — which is exactly what `tool0.json` could not say.
 */
export type Conditions = {
	/** The shaper the run installed before recording. `null` is `M593 P"none"`. */
	readonly shaper: ShaperSpec | null;
	readonly accelMmPerS2: number;
	readonly speedMmPerS: number;
	readonly distMm: number;
	readonly repeats: number;
};

/**
 * The machine in front of you, as the facts a stored measurement is checked
 * against.
 *
 * ONE value rather than two parameters, because "the machine in front of you"
 * is the phrase this whole layer is written in, and a caller that passed the
 * selected tool but forgot the acceleration would silently lose half the check
 * while still compiling. `accelMmPerS2` is nullable because the object model
 * genuinely may not carry `move.travelAcceleration` — and a missing reading is
 * not a mismatch, so nothing supersedes on it.
 */
export type MachineNow = {
	readonly tool: number;
	readonly accelMmPerS2: number | null;
};

/**
 * Where a product came from.
 *
 * A union with an `unknown` arm rather than an optional field, so a product
 * cannot be held without SAYING where it came from. Hand-assembled captures
 * stay usable — that is deliberate, they are the only reason 259 prototype
 * captures are usable at all — but they stop looking identical to measured
 * ones, which is the requirement #57 states.
 *
 * `measured` is the only arm that carries conditions, and that asymmetry IS
 * the distinction. A run holds the shaper it stated, the acceleration it
 * planned against and the plan itself at the moment it captures, so it records
 * what it knows. A batch of files ticked off the SD card holds none of that —
 * the file name is a label, not a schema (#57's design constraint), and
 * re-deriving conditions from it afterwards would be a second producer of a
 * fact the run once had and threw away. So a ticked batch is `assembled` and
 * says so, rather than being handed a plausible set of conditions nobody
 * measured.
 */
export type Provenance =
	| { readonly kind: "measured"; readonly at: string; readonly under: Conditions }
	| { readonly kind: "assembled"; readonly n: number }
	| { readonly kind: "loaded"; readonly path: string }
	| { readonly kind: "unknown"; readonly why: string };

/** What changed under a product after it was made. */
export type Supersede =
	| { readonly kind: "tool-changed"; readonly was: number; readonly now: number }
	| { readonly kind: "shaper-changed"; readonly was: string; readonly now: string }
	| { readonly kind: "accel-changed"; readonly was: number; readonly now: number };

/**
 * How far two accelerations may differ before this is a different measurement.
 *
 * A FRACTION rather than an absolute, because the machines this runs on span
 * 500 mm/s² bed slingers and 20 000 mm/s² CoreXY: 200 mm/s² is the whole
 * difference on one and rounding on the other. Five per cent is below anything
 * an operator types — `M204` is set in round hundreds — so it absorbs a float
 * round-tripping through the object model and JSON without swallowing a change
 * anybody made on purpose.
 */
const ACCEL_TOLERANCE = 0.05;

/**
 * What has changed under a stored measurement since it was made, or null.
 *
 * The SOLE producer of a `Supersede` for a stored product, so the tool check
 * and the acceleration check cannot end up in two places with two answers.
 * That is the shape `step-readiness-has-one-answer` already exists to prevent
 * one level down, and the failure would be worse here: one card reading
 * "measured on T0, T2 is mounted now" while another shows the same numbers as
 * current.
 *
 * The order is the operator's, as it is in `verdictOf`. A tool change outranks
 * an acceleration change because carriage mass moves the FREQUENCY — the very
 * number a shaper is tuned to — while acceleration changes how hard the mode
 * was struck. When both have changed, the tool is the sentence worth reading.
 *
 * `shaper-changed` is deliberately NOT produced here, and the reason is that
 * it would fire on every machine that has ever been tuned. A baseline is
 * unshaped by construction (`shaperStep`, #53), so installing a shaper
 * afterwards does not make it describe a different machine — it measured the
 * bare structure and it still does. A detector that fires on a correct
 * baseline says nothing, which is the lesson `axes-agree` was written under.
 * The arm survives because a verify result IS about one specific shaper, and
 * checking it against what the machine now has is a real question; it needs
 * the `applied` product to carry its own provenance first. That is a later
 * ticket, not something to approximate.
 */
export function supersededBy(fileTool: number, provenance: Provenance, now: MachineNow): Supersede | null {
	if (fileTool !== now.tool) return { kind: "tool-changed", was: fileTool, now: now.tool };
	if (provenance.kind !== "measured") return null;
	const was = provenance.under.accelMmPerS2;
	const is = now.accelMmPerS2;
	// A machine reporting no acceleration has not changed it; it has failed to
	// say. Superseding on a missing reading would blank a good fingerprint
	// every time the object model dropped a field.
	if (is === null || !Number.isFinite(is) || !Number.isFinite(was) || was <= 0) return null;
	if (Math.abs(is - was) <= ACCEL_TOLERANCE * was) return null;
	return { kind: "accel-changed", was, now: is };
}

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
 * The `unattributable` test is `kind !== "measured"` rather than
 * `kind === "unknown"`, and that widening is #57's requirement 2 made
 * mechanical. `assembled` — a batch of files ticked off the SD card — carries
 * no conditions, so nothing about it can be compared to the machine in front
 * of you, and reading it as `sound` is precisely the failure the ticket is
 * named for: "I measured this" and "I gathered these" looking identical
 * afterwards. It stays USABLE, which is deliberate and is the only reason 259
 * prototype captures are worth anything — `unattributable` arms a control, it
 * never disables one.
 *
 * The order is written once, here. A second expression choosing a verdict is
 * the drift `step-readiness-has-one-answer` already exists to prevent one level
 * down, and its failure mode is worse here: a card reading "sound" over a
 * product another card calls unusable.
 */
export function verdictOf<T>(h: Held<T>): Verdict {
	if (h.caveats.some((c) => severityOf(c) === "disqualifying")) return "unusable";
	if (h.provenance.kind !== "measured") return "unattributable";
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
					// The sentence comes from the copy table, like every other
					// sentence on this screen. It used to be assembled here out
					// of `provenance.why` and an em dash, which worked only
					// while `unknown` was the sole unattributable arm — the
					// moment `assembled` became reachable that expression would
					// have rendered a bare em dash over a usable fingerprint.
					return { kind: "armed", confirm: text.provenance(e.provenance) };
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
