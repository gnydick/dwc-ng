import type { Job } from "./types.ts";

/** RRF statuses where a job is on the machine and controllable. */
export const ACTIVE_STATUSES = new Set(["processing", "paused", "pausing", "resuming", "cancelling", "simulating"]);

/**
 * The job's file, or null. An idle machine can still carry a job.file object
 * whose fields are null — only a file that names itself is real. One
 * definition (it was copied verbatim in three components before the compose
 * conversion).
 */
export function jobFileOf(job: Job): Job["file"] {
	const f = job.file;
	return f !== null && typeof f.fileName === "string" && f.fileName.length > 0 ? f : null;
}

/**
 * A job is on the machine: determined by STATUS alone, which is the
 * authoritative run state and covers every printing state (processing,
 * paused, …). NOT by job.file presence: DSF keeps the SELECTED file in
 * job.file while fully idle, so a "named file loaded" test reports a phantom
 * job on an idle SBC — and, via JobDetailsBody, disables Start Print because
 * the UI believes a print is already running. Standalone rr_ merely hid this
 * by null-fielding job.file when idle. Selection is a separate concept from
 * running; only the status says a job is active.
 */
export function isJobActive(status: string): boolean {
	return ACTIVE_STATUSES.has(status);
}
