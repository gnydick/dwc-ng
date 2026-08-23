/**
 * The Shaping settings card's draft state, and the words it reports.
 *
 * Pure and DOM-free so node can test every verdict, and separate from the card
 * for the same reason the refusal table is separate from the cards that render
 * refusals: the sentence an operator reads about a refused box is a fact about
 * the gate, not about a <span>.
 *
 * NOTHING HERE DECIDES WHETHER A BOX IS LEGAL.
 *
 * `asEnvelope` (config/parse.ts) is the sole producer of a non-null Envelope
 * and the sole judge of `lo < hi` — the SD boundary and the store's setShaping
 * both call it, and a second opinion living in an editor is precisely the
 * duplicated-processing-step this repo treats as a design fault. So the editor
 * does not re-derive the rule; it ASKS the gate, once per axis, and reports the
 * answer. `gateAccepts` below is that question, and it is the only thing
 * standing between a typed field and a sentence about it.
 *
 * @invariant editor-adds-no-second-envelope-gate
 * @rung 6  choke-point — `asEnvelope` is the only thing here that can say
 *          anything about a range, and it is called with the draft's own
 *          numbers rather than consulted about a rule this module re-states.
 *          A test pins the two together: over a table of drafts,
 *          `rejectedAxes` is empty exactly when `draftEnvelope(d)` — which is
 *          the gate's own return value — is non-null
 * @why the gate is whole-or-nothing by design (one good axis is not a box), so
 *      an editor carrying its own per-axis rule would eventually disagree with
 *      it about which halves are acceptable, and the operator would be told a
 *      box was fine while `null` is what got stored
 * @debt rung 7 would be `asRange` exported as the axis-level gate and this
 *       module unable to express a range question any other way. Not done
 *       today because exporting it widens the surface that can mint a Range,
 *       which is the thing config/types.ts deliberately keeps to one function.
 */
import { asEnvelope } from "../config/parse.ts";
import type { Envelope } from "../config/types.ts";

/** The four bounds as the inputs hold them: text, because that is what a
 *  field contains and because "" must not silently become 0. */
export interface EnvelopeDraft {
	readonly xLo: string;
	readonly xHi: string;
	readonly yLo: string;
	readonly yHi: string;
}

export const BLANK_DRAFT: EnvelopeDraft = { xLo: "", xHi: "", yLo: "", yHi: "" };

/**
 * Text to number. A blank or unparseable field becomes NaN — NOT 0 — so the
 * gate sees a non-finite bound and refuses, instead of accepting a box whose
 * missing edge was quietly read as the origin.
 *
 * A text conversion, not a validation: it decides nothing about what makes a
 * range legal. `Number("")` being 0 is the only reason it exists.
 */
function boundOf(text: string): number {
	const trimmed = text.trim();
	return trimmed === "" ? Number.NaN : Number(trimmed);
}

/**
 * The four fields as a box, or `null` when they are not one.
 *
 * It returns an `Envelope` WITHOUT a cast because it does not build one: it
 * hands the numbers to `asEnvelope` and returns whatever the gate minted. The
 * store's `setShaping` then runs the same gate over the same value — which is
 * idempotent and therefore free — so the editor's call site has no type
 * assertion in it and `ShapingPatch.envelope` keeps its whole-box declaration.
 * There is still exactly one function in this repo that can produce a non-null
 * Envelope, and this is a caller of it, not a rival.
 */
export function draftEnvelope(d: EnvelopeDraft): Envelope | null {
	return asEnvelope({ x: [boundOf(d.xLo), boundOf(d.xHi)], y: [boundOf(d.yLo), boundOf(d.yHi)] });
}

/** The stored box as editable text, and "" everywhere when there is none. */
export function draftOf(envelope: Envelope | null): EnvelopeDraft {
	if (envelope === null) return BLANK_DRAFT;
	return {
		xLo: String(envelope.x[0]), xHi: String(envelope.x[1]),
		yLo: String(envelope.y[0]), yHi: String(envelope.y[1]),
	};
}

export function sameDraft(a: EnvelopeDraft, b: EnvelopeDraft): boolean {
	return a.xLo === b.xLo && a.xHi === b.xHi && a.yLo === b.yLo && a.yHi === b.yHi;
}

export function isBlankDraft(d: EnvelopeDraft): boolean {
	return sameDraft(d, BLANK_DRAFT);
}

/**
 * Would the ONE gate accept this pair as a range?
 *
 * Asked by handing the pair to `asEnvelope` on BOTH axes, so the answer comes
 * from `asRange` itself — which is not exported, and must not be rewritten
 * here to get at it. An envelope of two identical ranges is accepted exactly
 * when that range is acceptable, which makes this a faithful single-axis probe
 * of a whole-or-nothing gate.
 */
function gateAccepts(lo: string, hi: string): boolean {
	const range = [boundOf(lo), boundOf(hi)];
	return asEnvelope({ x: range, y: range }) !== null;
}

export type EnvelopeAxis = "X" | "Y";

/**
 * Which axes the gate refuses — in axis order, so the message reads X before Y.
 *
 * Empty exactly when `draftEnvelope(d)` is non-null, because the gate is the
 * conjunction of its two ranges and this asks it about each one.
 */
export function rejectedAxes(d: EnvelopeDraft): readonly EnvelopeAxis[] {
	const out: EnvelopeAxis[] = [];
	if (!gateAccepts(d.xLo, d.xHi)) out.push("X");
	if (!gateAccepts(d.yLo, d.yHi)) out.push("Y");
	return out;
}

export type EnvelopeVerdict =
	/** A box is stored. Nothing was refused. */
	| { readonly kind: "set"; readonly envelope: Envelope }
	/** Nothing stored and nothing typed — the shipped state (spec I8). */
	| { readonly kind: "unset" }
	/** Typed, not committed: the fields do not describe what is stored. */
	| { readonly kind: "pending" }
	/** The gate refused the committed draft, so the WHOLE envelope is unset. */
	| { readonly kind: "rejected"; readonly axes: readonly EnvelopeAxis[] };

/**
 * What the card says about the envelope, from the last COMMITTED draft and
 * what the store actually holds afterwards.
 *
 * `stored` is read after the write, so "set" is never a hope: it is the box
 * that came back out of the config. A rejection is reported only when the
 * store is empty, which is the same fact from the other side — no arrangement
 * of arguments claims a box was refused while one is stored.
 */
export function judgeDraft(committed: EnvelopeDraft | null, stored: Envelope | null): EnvelopeVerdict {
	if (stored !== null) return { kind: "set", envelope: stored };
	if (committed === null || isBlankDraft(committed)) return { kind: "unset" };
	return { kind: "rejected", axes: rejectedAxes(committed) };
}

/** "X" · "Y" · "X and Y". */
function axisList(axes: readonly EnvelopeAxis[]): string {
	return axes.length === 2 ? "X and Y" : (axes[0] ?? "");
}

/** A length with at most one decimal and no trailing ".0". */
function mm(n: number): string {
	return String(Math.round(n * 10) / 10);
}

/**
 * One sentence per verdict, closed by a `never` arm so a verdict added later
 * cannot reach the card as the empty string.
 *
 * The rejected sentence names TWO things on purpose: which side is wrong, and
 * that the envelope is now unset. Naming only the axis would leave the
 * operator believing the other one survived — it did not, and cannot: the gate
 * is whole-or-nothing, so one bad range takes the box with it.
 */
export function envelopeStatusText(v: EnvelopeVerdict): string {
	switch (v.kind) {
		case "set":
			return `Set — ${mm(v.envelope.x[1] - v.envelope.x[0])} × ${mm(v.envelope.y[1] - v.envelope.y[0])} mm of travel.`;
		case "unset":
			return "Not set — shaping cannot move until you draw this box.";
		case "pending":
			return "Not applied — press Enter or leave the field.";
		case "rejected":
			return `${axisList(v.axes)} refused — low must be below high. Envelope unset.`;
		default: {
			const unhandled: never = v;
			throw new Error(`unhandled envelope verdict: ${JSON.stringify(unhandled)}`);
		}
	}
}

export type AccelStatus =
	/** Mapped, and the machine reports an accelerometer there. */
	| { readonly kind: "ok"; readonly addr: string }
	/** Mapped, and nothing answers at that address right now. */
	| { readonly kind: "no-sensor"; readonly addr: string }
	/** No entry for this tool. */
	| { readonly kind: "unmapped" }
	/** Typed, not committed. */
	| { readonly kind: "pending" }
	/** The committed text was not `board.device`, so nothing was written. */
	| { readonly kind: "refused" };

/**
 * What one tool's accelerometer row says.
 *
 * `stored` is read back AFTER `setAccelAddr`, which ignores an address
 * `isAccelAddr` refuses — so "the field does not match the config" is the whole
 * definition of a problem here, and this module never re-tests the address
 * format. Which KIND of problem is then decided by whether the operator has
 * committed that exact text: if they have, the gate refused it; if they have
 * not, they are still typing. `present` likewise comes from `accelerometerOf`,
 * the same lookup the preconditions read makes, so a settings row cannot
 * disagree with a run about whether a sensor is there.
 */
export function judgeAccel(
	field: string,
	committed: string | null,
	stored: string | undefined,
	present: boolean,
): AccelStatus {
	const typed = field.trim();
	// Out of sync with the config: either the operator is still typing, or the
	// gate refused what they committed. Anchoring on the STORED value rather
	// than on the last commit is what stops a row describing a mapping the
	// field no longer shows — typing over a working address used to leave the
	// old address's verdict standing beside the new text.
	if (typed !== (stored ?? "")) {
		return committed !== null && committed.trim() === typed
			? { kind: "refused" }
			: { kind: "pending" };
	}
	if (stored === undefined) return { kind: "unmapped" };
	return present ? { kind: "ok", addr: stored } : { kind: "no-sensor", addr: stored };
}

/** The row's sentence. Empty for a working mapping — the address is already
 *  in the field beside it, and a row saying "ok" is noise on four tools. */
export function accelStatusText(s: AccelStatus): string {
	switch (s.kind) {
		case "ok":
			return "";
		case "no-sensor":
			// The same words the run's own refusal uses, so the settings row and
			// the disabled button name one condition rather than two.
			return `no sensor at ${s.addr}`;
		case "unmapped":
			return "not mapped";
		case "pending":
			return "not applied";
		case "refused":
			return "needs board.device";
		default: {
			const unhandled: never = s;
			throw new Error(`unhandled accelerometer status: ${JSON.stringify(unhandled)}`);
		}
	}
}
