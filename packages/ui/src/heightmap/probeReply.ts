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
declare const stop: unique symbol;
declare const mapped: unique symbol;

/**
 * The RAW machine Z at which the probe triggered, as RRF reported it.
 *
 * Branded as `number &` rather than an opaque object: reading one as a number
 * (formatting it, showing it beside the derived value) must stay effortless.
 * What the brand blocks is the other direction — a plain number cannot BECOME
 * one, and neither quantity can be passed where the other is wanted.
 */
export type StopHeight = number & { readonly [stop]: true };

/**
 * A height-map cell value: a stop height made relative to the probe's trigger
 * height. The only thing the map will store.
 */
export type MapValue = number & { readonly [mapped]: true };

/**
 * The object model's `sensors.probes[].lastStopHeight` is the same quantity
 * arriving by a different road — the board reports it directly, with no reply
 * text to parse. Named so the ingress is visible rather than a bare cast.
 */
export const stopHeightFromModel = (value: number): StopHeight => value as StopHeight;

/**
 * Nudge a cell by hand. An offset WITHIN the map's own units, so the result is
 * still a map value — this is the one arithmetic that stays inside the type.
 */
export const adjustMapValue = (value: MapValue, delta: number): MapValue =>
	Number((value + delta).toFixed(3)) as MapValue;

export interface ProbeResult {
	/** Machine Z at which the probe triggered, in mm, as RRF reported it - the
	 *  raw stop height, before it is made relative to the trigger height. */
	stopHeight: StopHeight;
}

/** RRF answers a probe with "Stopped at height <n> mm". */
const STOPPED = /Stopped at height\s+(-?\d+(?:\.\d+)?)\s*mm/i;

export function parseProbeReply(reply: string): ProbeResult | null {
	const match = STOPPED.exec(reply);
	if (match === null) return null;
	const stopHeight = Number(match[1]);
	// A match that somehow isn't a number is a failure to read, not a height of
	// NaN - the caller distinguishes "no trigger" from "triggered at 0.000".
	return Number.isFinite(stopHeight) ? { stopHeight: stopHeight as StopHeight } : null;
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
 * @rung 7  sole-constructor types — StopHeight and MapValue are distinct
 *          brands, and this is the ONLY StopHeight -> MapValue conversion. The
 *          map's rows are MapValue[][] and heightmap/store.ts's edit takes a
 *          MapValue, so handing it a raw stop height does not compile.
 *          Promoted from rung 5 on 2026-08-01, where both were `number` and the
 *          two lines that set them sat adjacent, taking the same type
 * @why they are different quantities in the same units. RRF reports the raw
 *      machine Z of the trigger, which sits near the configured G31 Z (~-13 on
 *      this machine), so storing it as measured put a ~13mm error into every
 *      re-probed cell — a map that then drives live compensation on a bed the
 *      probe has to survive
 */
export function heightmapValue(stopHeight: StopHeight, triggerHeight: number): MapValue {
	return (stopHeight - triggerHeight) as MapValue;
}
