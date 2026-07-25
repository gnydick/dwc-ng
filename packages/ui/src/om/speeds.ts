/**
 * move.currentMove → display cells. The ONE place raw speed values become
 * rendered text.
 *
 * Field meanings are the RRF 3.6 Object Model Documentation's, verified
 * 2026-07-25 (the vendored class at reference/objectmodel/src/move/index.ts
 * :13-20 declares the fields but documents none of them):
 *   requestedSpeed  "Requested speed of the current move (in mm/s)"
 *   topSpeed        "Top speed of the current move (in mm/s)"
 *   extrusionRate   "Current extrusion rate (in mm/s)"  — filament, not travel
 *
 * RRF exposes no instantaneous velocity. topSpeed is the achieved speed of
 * the move executing right now, re-sampled every poll, which is why it is
 * labelled "Actual" here rather than DWC's "Top Speed" — the latter reads as
 * a high-water mark that only climbs.
 *
 * I-A: this module PARSES rather than trusting the declared type. conform is
 * not the OM's single entry — store.ts:89 routes the live d99fn patch (which
 * is what updates currentMove at 2 Hz) straight into deepMergeInto, bypassing
 * conformModelKey entirely. The two ingress routes reconverge here, so here is
 * where the guarantee has to live.
 *
 * I-B: the return type is a fixed 3-tuple. "Two cells" and "four cells" have
 * no representation, so machine state cannot reflow the footer.
 */

import type { ObjectModel } from "./types.ts";

export type FlowMode = "linear" | "volumetric";

export interface SpeedCell {
	key: "requested" | "actual" | "flow";
	label: string;
	/** Already formatted — "120.0", or EM_DASH when there is no usable value. */
	value: string;
	unit: string;
	/** OM path, surfaced as the cell's title attribute. */
	source: string;
}

/** Exactly three cells, always (I-B). */
export type SpeedRow = readonly [SpeedCell, SpeedCell, SpeedCell];

/** Shown when a value is absent or unusable — never "0.0", which would assert
 *  the machine is stopped on no evidence (I-D). */
const EM_DASH = "—";

/** The I-A gate. Anything that is not a finite number becomes null. */
export function numberOrNull(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function format(value: number | null): string {
	return value === null ? EM_DASH : value.toFixed(1);
}

/** Cross-sectional area of the loaded filament, or null when unknowable. */
function filamentArea(om: ObjectModel): number | null {
	const tool = om.tools[om.state.currentTool];
	if (!tool || tool.filamentExtruder < 0) return null;
	const extruder = om.move.extruders[tool.filamentExtruder];
	const diameter = numberOrNull(extruder?.filamentDiameter);
	if (diameter === null || diameter <= 0) return null;
	const radius = diameter / 2;
	return Math.PI * radius * radius;
}

export function speedRow(om: ObjectModel, mode: FlowMode): SpeedRow {
	// Read as unknown: the declared type is not load-bearing here (I-A).
	const raw = om.move.currentMove as unknown;
	const cm: Record<string, unknown> =
		typeof raw === "object" && raw !== null && !Array.isArray(raw)
			? raw as Record<string, unknown>
			: {};

	const extrusionRate = numberOrNull(cm.extrusionRate);
	// Volumetric is DERIVED at use time, never stored (I-C). No fallback to the
	// linear number: showing mm/s under a mm³/s unit is worse than a dash.
	const area = mode === "volumetric" ? filamentArea(om) : null;
	const flow: SpeedCell = mode === "volumetric"
		? {
			key: "flow",
			label: "Flow",
			value: area === null || extrusionRate === null ? EM_DASH : format(area * extrusionRate),
			unit: "mm³/s",
			source: "move.currentMove.extrusionRate",
		}
		: {
			key: "flow",
			label: "Extrusion",
			value: format(extrusionRate),
			unit: "mm/s",
			source: "move.currentMove.extrusionRate",
		};

	return [
		{
			key: "requested",
			label: "Requested",
			value: format(numberOrNull(cm.requestedSpeed)),
			unit: "mm/s",
			source: "move.currentMove.requestedSpeed",
		},
		{
			key: "actual",
			label: "Actual",
			value: format(numberOrNull(cm.topSpeed)),
			unit: "mm/s",
			source: "move.currentMove.topSpeed",
		},
		flow,
	];
}
