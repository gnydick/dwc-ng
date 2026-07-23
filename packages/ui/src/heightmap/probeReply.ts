/**
 * Extract the machine Z at which the probe triggered, from a probe reply.
 *
 * RRF answers a report-mode probe with "Stopped at height <n> mm", where <n>
 * is the RAW machine Z of the trigger - not a bed deviation. It sits near the
 * probe's configured G31 Z trigger height (e.g. ~-13 on a machine whose
 * triggerHeight is -13), so it must NOT be stored into the map as-is: doing
 * that put a ~13mm error into every re-probed cell (the bug this fixes).
 *
 * The height-map value is that stop height taken relative to the trigger
 * height - `stopHeight - triggerHeight` - computed by the caller, which holds
 * the live probe. A higher spot trips the probe sooner, so it stops at a
 * larger (more positive) Z; the subtraction then yields a POSITIVE value for a
 * high spot whatever the sign of triggerHeight. This parser stays pure: it
 * only reads the stop height out of the reply.
 *
 * The UI still shows this raw reply beside the value it stores, so a reading
 * that looks wrong is visible before it is accepted into the map.
 */
export interface ProbeResult {
	/** Machine Z at which the probe triggered, in mm, as RRF reported it - the
	 *  raw stop height, before it is made relative to the trigger height. */
	stopHeight: number;
}

/** RRF answers a probe with "Stopped at height <n> mm". */
const STOPPED = /Stopped at height\s+(-?\d+(?:\.\d+)?)\s*mm/i;

export function parseProbeReply(reply: string): ProbeResult | null {
	const match = STOPPED.exec(reply);
	if (match === null) return null;
	const stopHeight = Number(match[1]);
	// A match that somehow isn't a number is a failure to read, not a height of
	// NaN - the caller distinguishes "no trigger" from "triggered at 0.000".
	return Number.isFinite(stopHeight) ? { stopHeight } : null;
}

/**
 * The height-map value for a re-probed cell: the reported stop height taken
 * relative to the probe's trigger height (G31 Z). A spot HIGH of the reference
 * reads POSITIVE and a LOW spot NEGATIVE, for ANY sign of triggerHeight - a
 * higher spot trips the probe sooner so it stops at a larger Z, and the
 * subtraction preserves that regardless of where triggerHeight sits. Storing
 * the raw stop height instead would bake the whole trigger height (e.g. ~13mm)
 * into every cell.
 */
export function heightmapValue(stopHeight: number, triggerHeight: number): number {
	return stopHeight - triggerHeight;
}
