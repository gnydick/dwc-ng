/**
 * "Is a job active" is a function of STATUS alone. Regression pin for the
 * bug the DSF transport exposed: DSF keeps the selected file in job.file
 * while fully idle, so keying activeness off job.file presence reported a
 * phantom running job (and disabled Start Print) on an idle SBC.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isJobActive, jobFileOf, ACTIVE_STATUSES } from "../src/om/job.ts";
import type { Job } from "../src/om/types.ts";

test("every printing status is active; idle/halted are not", () => {
	for (const s of ACTIVE_STATUSES) assert.equal(isJobActive(s), true, s);
	for (const s of ["idle", "halted", "off", "busy", "disconnected"]) {
		assert.equal(isJobActive(s), false, s);
	}
});

test("an idle machine with a SELECTED file is not an active job (the DSF case)", () => {
	// DSF's idle model: status idle, job.file names the selected file, no
	// run fields. The UI must read this as "not running".
	const status = "idle";
	const job = {
		file: { fileName: "0:/gcodes/10deg - PLA.gcode", size: 123456, printTime: null, numLayers: 40 },
		filePosition: 0,
		duration: null,
	} as unknown as Job;
	assert.notEqual(jobFileOf(job), null, "the file is genuinely selected");
	assert.equal(isJobActive(status), false, "…but no job is running");
});

test("jobFileOf still ignores an idle null-fielded job.file (the rr_ case)", () => {
	const job = { file: { fileName: "", size: 0 } } as unknown as Job;
	assert.equal(jobFileOf(job), null);
});
