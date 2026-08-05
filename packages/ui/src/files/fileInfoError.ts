import { FileNotFoundError, InvalidPasswordError } from "@dwc-ng/connector";

/**
 * What the job-details card says when it could not read a file.
 *
 * `summary` is the plain-language line; `detail` is the MACHINE'S OWN WORDS,
 * verbatim. DSF answers a metadata failure with a 500 and a text body, and
 * DsfConnector.request already preserves that body into the thrown error — the
 * card used to discard all of it and print the fixed string "No metadata",
 * which is the defect this exists to fix (reported 2026-08-04).
 *
 * A pure function rather than conditions in JSX, for two reasons: the wording
 * has one place it can be got wrong, and the mapping is testable without a DOM.
 *
 * Deliberately returns NO "blocksRun" flag. Any load error is a hard no on
 * running the file (spec D1, operator's call), so blocking is unconditional —
 * and a flag whose only correct value is `true` is an invitation to set it to
 * `false` at some later call site. The card enforces D1 structurally instead, by
 * having exactly one site that renders the run actions and putting it inside the
 * loaded-metadata branch.
 */
export interface FileInfoFailure {
	summary: string;
	detail: string;
}

/**
 * NOTHING here asserts why a file could not be read.
 *
 * The obvious wording — "this file appears to be corrupt" — is unavailable, and
 * not for want of nerve: the connector maps a DSF non-ok response and a
 * network/timeout failure onto the same OperationFailedError
 * (DsfConnector.ts:536 and :547), so that sentence would accuse a perfectly good
 * file of being damaged every time the Wi-Fi hiccuped. The summary says only
 * what is known, and the detail below it carries whatever the machine actually
 * said.
 *
 * Making the two distinguishable was designed and dropped: once every error
 * blocks the run, a taxonomy buys nothing. If "corrupt" is ever wanted as a
 * fact, the change belongs at that one seam — a distinct type thrown from the
 * catch around fetch — not here.
 */
export function describeFileInfoError(err: unknown): FileInfoFailure {
	return { summary: summaryFor(err), detail: detailOf(err) };
}

function summaryFor(err: unknown): string {
	if (err instanceof FileNotFoundError) return "This file is no longer on the machine.";
	if (err instanceof InvalidPasswordError) return "The session expired.";
	return "Could not read this file.";
}

/**
 * The message, and only if there genuinely is one.
 *
 * A thrown non-Error (a string from a stray reject, a plain object) must not
 * reach the card as "[object Object]" — that is noise wearing the costume of a
 * machine diagnostic, and an operator cannot tell the difference. Anything that
 * is not an Error with a real message contributes no detail at all, and the card
 * simply shows the summary.
 */
function detailOf(err: unknown): string {
	if (err instanceof Error) return err.message;
	return typeof err === "string" ? err : "";
}
