import { test } from "node:test";
import assert from "node:assert/strict";
import { FileNotFoundError, InvalidPasswordError } from "@dwc-ng/connector";
import { FORCE_PARAM, forcedJobInfoError } from "../src/dev/forcedJobInfoError.ts";
import { describeFileInfoError } from "../src/files/fileInfoError.ts";

/**
 * A way to LOOK at the job-details failure state without owning a broken file.
 *
 * Deliberately a URL parameter rather than a control in Settings. A permanent
 * toggle for a state you want to see once is clutter that outlives its purpose,
 * and worse, a toggle can be left on and forgotten — this one is sitting in the
 * address bar, in plain sight, and is gone the moment the tab is reopened.
 */

test("no parameter means no forced failure — the default cannot lie about the machine", () => {
	for (const search of ["", "?", "?density=0.8", "?forceJobInfoErrors=1", "?xforceJobInfoError=1"]) {
		assert.equal(forcedJobInfoError(search), null, `${search} should not force a failure`);
	}
});

test("each kind produces the error the card describes differently", () => {
	const missing = forcedJobInfoError(`?${FORCE_PARAM}=missing`);
	assert.ok(missing instanceof FileNotFoundError);
	assert.match(describeFileInfoError(missing).summary, /no longer on the machine/i);

	const session = forcedJobInfoError(`?${FORCE_PARAM}=session`);
	assert.ok(session instanceof InvalidPasswordError);
	assert.match(describeFileInfoError(session).summary, /session/i);

	const parse = forcedJobInfoError(`?${FORCE_PARAM}=parse`);
	assert.ok(parse instanceof Error);
	assert.match(describeFileInfoError(parse).summary, /could not read/i);
});

test("a bare or unrecognised value still shows something, defaulting to the parse case", () => {
	for (const value of ["", "1", "true", "banana"]) {
		const err = forcedJobInfoError(`?${FORCE_PARAM}=${value}`);
		assert.ok(err instanceof Error, `${value} produced no error`);
	}
});

/**
 * THE SAFETY PROPERTY. A simulated failure that reads exactly like a real one is
 * a trap: the next person to see it — including me, months from now — would
 * chase a machine fault that does not exist. Every forced error says so in the
 * text the card actually renders.
 */
test("every forced error announces itself as simulated, in the text the card shows", () => {
	for (const kind of ["parse", "missing", "session", "banana"]) {
		const err = forcedJobInfoError(`?${FORCE_PARAM}=${kind}`)!;
		const shown = describeFileInfoError(err).detail;
		assert.match(shown, /SIMULATED/,
			`the ${kind} case could be mistaken for a real machine failure`);
		assert.match(shown, new RegExp(FORCE_PARAM),
			`the ${kind} case does not say how to turn itself off`);
	}
});
