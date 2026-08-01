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
 *
 * @invariant stop-height-is-not-a-map-value
 * @rung 5  shared helper — the sole implementation of the conversion, and the
 *          sole consumer (cards/BedCards.tsx:430) does call it. But both
 *          quantities are `number`: setRawStop(stopHeight) and
 *          setProbed(heightmapValue(...)) sit on ADJACENT lines taking the same
 *          type, and store.edit accepts either
 * @why they are different quantities in the same units. RRF reports the raw
 *      machine Z of the trigger, which sits near the configured G31 Z (~-13 on
 *      this machine), so storing it as measured put a ~13mm error into every
 *      re-probed cell — a map that then drives live compensation on a bed the
 *      probe has to survive
 * @debt this is technique 7 (units as types) left undone. Promote by branding
 *       both: parseProbeReply produces a StopHeight, this is the only
 *       StopHeight -> MapValue, and heightmap/store.ts's edit() accepts only a
 *       MapValue — then handing the raw reading to the map stops compiling
 *       instead of merely looking wrong. nudge() composes because valueAt()
 *       already returns a MapValue and the delta is an offset within it.
 */
export function heightmapValue(stopHeight: number, triggerHeight: number): number {
	return stopHeight - triggerHeight;
}
