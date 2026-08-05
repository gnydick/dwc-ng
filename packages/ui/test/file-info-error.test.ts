import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FileNotFoundError, InvalidPasswordError, OperationFailedError } from "@dwc-ng/connector";
import { describeFileInfoError } from "../src/files/fileInfoError.ts";

/**
 * Selecting a job file whose metadata cannot be read used to show the fixed
 * string "No metadata" — in the same muted style as "No selection", with no
 * sign anything had gone wrong and no way to try again (reported 2026-08-04,
 * "jobs card is failing to load the job file").
 *
 * The machine's own explanation was already reaching the card: DSF answers a
 * metadata failure with a 500 and a text body, which DsfConnector.request
 * preserves verbatim into OperationFailedError. The card discarded it.
 *
 * See docs/superpowers/specs/2026-08-05-job-details-load-failure-design.md.
 */

test("a missing file says so, rather than blaming the file's contents", () => {
	const d = describeFileInfoError(new FileNotFoundError("0:/gcodes/gone.gcode"));
	assert.match(d.summary, /no longer on the machine/i);
});

test("a dead session is reported as a session problem, not a bad file", () => {
	const d = describeFileInfoError(new InvalidPasswordError());
	assert.match(d.summary, /session/i);
});

/**
 * DELIBERATELY NOT "corrupt". The connector maps a DSF non-ok response and a
 * network/timeout failure to the SAME OperationFailedError, so any wording that
 * asserts something about the file's contents would accuse a healthy file after
 * a Wi-Fi blip. The summary states only what is known; the machine's words carry
 * the specifics.
 */
test("an unreadable file claims nothing about WHY it is unreadable", () => {
	const d = describeFileInfoError(new OperationFailedError("Failed to parse G-code file"));
	assert.match(d.summary, /could not read/i);
	assert.doesNotMatch(d.summary, /corrupt|damaged|invalid/i,
		"the summary must not assert a cause the connector cannot distinguish");
});

/**
 * The whole point of the change: the machine's explanation reaches the operator
 * intact. Trimming, prettifying or truncating it is the failure being fixed.
 */
test("the machine's own words survive verbatim", () => {
	const raw = "Failed to parse G-code file 0:/gcodes/x.gcode: unexpected end of file at offset 4673248";
	assert.equal(describeFileInfoError(new OperationFailedError(raw)).detail, raw);
});

test("a thrown non-Error still yields a usable card, never [object Object]", () => {
	for (const thrown of [undefined, null, "boom", 42, {}]) {
		const d = describeFileInfoError(thrown);
		assert.ok(d.summary.length > 0, `no summary for ${String(thrown)}`);
		assert.doesNotMatch(d.detail, /\[object/, `leaked a stringified object for ${String(thrown)}`);
	}
});

/**
 * An error with no message must not leave a heading floating over an empty
 * line. The detail is allowed to be empty; the card renders it only when it is
 * not, and this pins that there is something to make that decision from.
 */
test("an empty message yields an empty detail, not the word undefined", () => {
	assert.equal(describeFileInfoError(new OperationFailedError("")).detail, "");
});

/**
 * THE STRUCTURAL HALF of D1 (any load error is a hard no on action).
 *
 * The run actions live in exactly one place — inside the branch that renders
 * loaded metadata — so "an error is showing" and "Start print is offered" are
 * not states that can both hold. This is not a style assertion: a second action
 * site is precisely how the gate would come back off, and no condition in the
 * error branch would be wrong-looking enough to catch in review.
 */
const cardSrc = readFileSync(
	fileURLToPath(new URL("../src/cards/FileCards.tsx", import.meta.url)), "utf8");

test("the run actions have exactly one site, and it is not the error branch", () => {
	const starts = cardSrc.match(/>Start print</g) ?? [];
	assert.equal(starts.length, 1, `Start print is rendered from ${starts.length} places`);
	const errorBranch = /<Match when=\{svc\.info\.error\}>([\s\S]*?)<\/Match>/.exec(cardSrc);
	assert.ok(errorBranch, "the error state must be a real branch, not a bare string");
	assert.doesNotMatch(errorBranch[1]!, /Start print|Simulate/,
		"a failed read must never offer to run the file");
	assert.match(errorBranch[1]!, /Retry/, "a failed read must offer a way to try again");
});
