/**
 * The things that can be wrong with a measurement, as DATA rather than as
 * prose.
 *
 * Every entry answers one question the Shaping screen could previously only
 * answer in an operator's head, and each carries the numbers it was derived
 * from so the sentence can cite them. Nothing here decides anything: a caveat
 * describes evidence, and the machine (evidence.ts) decides what a product
 * carrying it is good for.
 *
 * @invariant every-caveat-has-copy
 * @rung 7  totality — `caveatText` (copy.ts) and `severityOf` below both switch
 *          on the discriminant with a `never` arm and no default, so a reason
 *          added here stops compilation in two places until someone has written
 *          its sentence AND decided whether shaping can act on it
 * @why the failure this whole layer exists to prevent is CONFIDENT WRONG
 *      ACTION. A caveat that rendered as the empty string would be worse than
 *      no caveat at all: the operator would read a clean card and act on it
 */
import type { Axis, NoFit } from "../engine/fit.ts";
import type { Hz } from "../engine/units.ts";

export type Caveat =
	/** The ladder never drove this mode: it lies outside the forcing band. */
	| {
			readonly kind: "forcing-band-excludes-mode";
			readonly axis: Axis;
			readonly modeHz: Hz;
			readonly bandHz: readonly [Hz, Hz];
			/** The speed that WOULD have driven it: modeHz / fullStepsPerMm. */
			readonly needMmPerS: number;
	  }
	/** Rows the transform could not use, which a heat map would paint as silence. */
	| { readonly kind: "rows-not-analysed"; readonly analysed: number; readonly rows: number }
	/** The fitted mode sits where motor ripple would be. Shaping cannot move it. */
	| { readonly kind: "mode-on-forcing-locus"; readonly axis: Axis; readonly modeHz: Hz; readonly speedMmPerS: number }
	/**
	 * The locus question needs a sweep, and there is none.
	 *
	 * NOT the same as "checked, and fine", which is exactly why it is a caveat
	 * rather than an absence. A fingerprint card that stayed silent about a
	 * check nobody ran reads as a card that ran it.
	 */
	| { readonly kind: "mode-locus-unknown" }
	/** One direction's spread eats the shaper's robustness band and the other does not. */
	| {
			readonly kind: "direction-spread";
			readonly axis: Axis;
			readonly plusHz: Hz;
			readonly minusHz: Hz;
			readonly modeHz: Hz;
	  }
	/**
	 * Captures the fitter refused, and why.
	 *
	 * Generalised from a damping-cap-only arm on 2026-08-24. It matched only
	 * `damping-out-of-range`, so when ten of Gabe's twenty Y captures were
	 * refused as `short-decay` the card said nothing and his Y frequency rested
	 * on the other half without a word about it. A finding that covers one
	 * reason out of four is a finding that stays silent three times in four.
	 *
	 * `cyclesFit` is present only where the fitter reported it (the two
	 * decay-length reasons); it is the measured quantity, never a ζ
	 * back-computed from the cap.
	 */
	| {
			readonly kind: "fits-refused";
			readonly axis: Axis;
			readonly refused: number;
			readonly of: number;
			readonly reason: NoFit["reason"];
			readonly cyclesFit: number | null;
			readonly cap: number;
	  }
	/**
	 * Every surviving fit on this axis came from one direction of travel.
	 *
	 * Not the same as `direction-spread`, which compares two directions that
	 * both produced numbers. This is the case where one direction produced NONE
	 * — and it matters because the ring-down happens at the opposite end of the
	 * axis each way, so a one-directional fingerprint has characterised one END
	 * of the travel and is being read as the whole axis.
	 */
	| { readonly kind: "one-direction-only"; readonly axis: Axis; readonly dir: "+" | "-"; readonly n: number; readonly refused: number }
	| { readonly kind: "few-fits"; readonly axis: Axis; readonly n: number; readonly of: number }
	/**
	 * X and Y came back at the same frequency.
	 *
	 * Two axes of one machine carry different effective masses and normally
	 * ring at clearly different frequencies — the prototype baseline on this
	 * machine reads X 18.14 Hz against Y 51.68 Hz. When they AGREE, one of two
	 * things is true, and the tool cannot yet tell which: either there is a
	 * shared frame mode dominating both, or a shaper was active during the
	 * measurement and suppressed each axis's own mode, leaving the same
	 * residual on both.
	 *
	 * Advisory rather than disqualifying precisely because both readings are
	 * legitimate. What is NOT legitimate is saying nothing: the second case is
	 * #53, the worst bug currently open, and it is silent and self-reinforcing.
	 * On the 2026-08-23 run that bug produced X 14.78 / Y 14.99 — 1.4 % apart —
	 * and every capture fitted cleanly, so no other quality finding fires.
	 */
	| { readonly kind: "axes-agree"; readonly xHz: Hz; readonly yHz: Hz; readonly apartFraction: number }
	/** The ranked list is arithmetic over a fingerprint, not a measurement. */
	| { readonly kind: "predicted-not-measured"; readonly n: number }
	/**
	 * A caveat on the thing this was derived FROM.
	 *
	 * Recursive on purpose, and it is the load-bearing arm of the whole layer:
	 * candidates are derived from a fingerprint, so a caveated fingerprint makes
	 * every candidate caveated without anyone remembering to check. "The
	 * top-ranked candidate previously introduced a 38 Hz mode" is not fixable by
	 * better arithmetic — only by inheritance stopping Apply from ever showing a
	 * clean button over dirty evidence.
	 */
	| { readonly kind: "inherited"; readonly from: "fingerprint"; readonly caveat: Caveat };

/**
 * Can shaping act on the thing this describes?
 *
 * `disqualifying` means the answer is no whatever the operator does next —
 * motor ripple is not a mode, and no `M593` moves it. Everything else is
 * advisory: it changes how much the number should be TRUSTED, not whether the
 * step is meaningful.
 */
export type Severity = "advisory" | "disqualifying";

export function severityOf(c: Caveat): Severity {
	switch (c.kind) {
		case "mode-on-forcing-locus":
			return "disqualifying";
		case "inherited":
			// The wrapper cannot be gentler than what it wraps; a disqualifying
			// fingerprint caveat must still disqualify the candidates ranked
			// from it, which is the entire point of inheritance.
			return severityOf(c.caveat);
		case "forcing-band-excludes-mode":
		case "rows-not-analysed":
		case "mode-locus-unknown":
		case "direction-spread":
		case "fits-refused":
		case "one-direction-only":
		case "few-fits":
		case "axes-agree":
		case "predicted-not-measured":
			return "advisory";
		default: {
			const unhandled: never = c;
			throw new Error(`unknown caveat: ${String((unhandled as { kind: unknown }).kind)}`);
		}
	}
}
