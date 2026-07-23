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

/** A job is on the machine: an active status, or a named file still loaded. */
export function isJobActive(status: string, jobFile: Job["file"]): boolean {
	return ACTIVE_STATUSES.has(status) || jobFile !== null;
}
