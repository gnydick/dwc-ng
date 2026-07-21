/**
 * Extract the trigger height from a probe reply.
 *
 * The trigger height IS the height-map value — no conversion (confirmed by
 * Gabe, 2026-07-21). RRF has already applied the probe's G31 Z offset by the
 * time it reports, which is why a real map reads in hundredths of a millimetre
 * (-0.105 .. 0.150 on this machine) rather than around the probe's standoff.
 *
 * The UI still shows this raw reply beside the value it stores. That is no
 * longer about an unverified conversion but about the probe itself: a reading
 * that looks wrong should be visible before it is accepted into the map.
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
