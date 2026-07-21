/**
 * Extract the trigger height from a probe reply.
 *
 * This deliberately does ONLY the verifiable half. Turning a trigger height
 * into a height-map value depends on the probe's G31 trigger height and the
 * reference plane, and that relationship is not covered by anything vendored
 * under reference/ — so it is not guessed at here. The UI shows this raw reply
 * next to whatever value it computes, so a wrong conversion is visible on the
 * first probe rather than after a map has been corrupted.
 */
export interface ProbeResult {
	/** Machine Z at which the probe triggered, in mm, as RRF reported it. */
	triggerHeight: number;
}

/** RRF answers a probe with "Stopped at height <n> mm". */
const TRIGGER = /Stopped at height\s+(-?\d+(?:\.\d+)?)\s*mm/i;

export function parseProbeReply(reply: string): ProbeResult | null {
	const match = TRIGGER.exec(reply);
	if (match === null) return null;
	const triggerHeight = Number(match[1]);
	// A match that somehow isn't a number is a failure to read, not a height of
	// NaN — the caller distinguishes "no trigger" from "triggered at 0.000".
	return Number.isFinite(triggerHeight) ? { triggerHeight } : null;
}
