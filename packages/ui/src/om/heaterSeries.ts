/**
 * Chart series (label + colour) for the heaters, derived from the object model.
 *
 * The invariant this module exists to hold: **no two heater lines on the chart
 * are perceptually confusable**, and in particular no tool ever draws in the
 * bed's colour.
 *
 * That is enforced by construction rather than by picking colours carefully:
 * the bed's and chamber's colours are simply not members of TOOL_COLORS, so a
 * tool cannot be assigned one. (The previous version indexed TOOL_COLORS by
 * HEATER index, which on a bed-at-0 machine both wasted the palette's first
 * colour and pushed the fourth tool onto a gold measuring ΔE 9.4 from the bed —
 * indistinguishable on screen. Tools are now indexed densely by their position
 * among non-bed, non-chamber heaters, so where the bed sits cannot shift them.)
 */
import type { Heater, Tool } from "./types.ts";

/** Gold — reserved for the bed, deliberately absent from TOOL_COLORS. */
export const BED_COLOR = "#c9a227";
/** Slate — reserved for a chamber heater, likewise absent from TOOL_COLORS. */
export const CHAMBER_COLOR = "#7f8ea3";

/**
 * Tool line colours, in assignment order. Contains no gold: gold belongs to the
 * bed, and a palette that cannot express it cannot collide with it.
 *
 * Chosen by solving for maximum minimum perceptual separation rather than by
 * eye — six hues evenly spaced in CIELCh at L=76, C=34, with the ring rotated
 * clear of the bed's gold and the chamber's slate. Every pair in the palette
 * (bed and chamber included) is at least ΔE 29 apart; heater-series.test.ts
 * asserts that floor, so a future palette edit cannot quietly reintroduce two
 * lines that look alike.
 */
export const TOOL_COLORS = ["#edae88", "#b4c283", "#6bccb7", "#61c8ef", "#bbb4f3", "#f6a4c0"];

export interface HeaterSeriesModel {
	heaters: (Heater | null)[];
	bedHeaters: number[];
	chamberHeaters: number[];
	tools: (Tool | null)[];
}

export interface HeaterSeries {
	label: string;
	stroke: string;
}

/**
 * One series per heater, in heater order — the chart aligns series to column
 * index, so a null heater still occupies its slot.
 */
export function heaterSeries(model: HeaterSeriesModel): HeaterSeries[] {
	// RRF pads these arrays with -1 for "no heater"; a bare Set would then treat
	// index -1 as meaningful, which is harmless, but filtering keeps the intent
	// obvious and guards against a stray -1 ever being compared against a real index.
	const beds = new Set(model.bedHeaters.filter(i => i >= 0));
	const chambers = new Set(model.chamberHeaters.filter(i => i >= 0));

	const nameByHeater = new Map<number, string>();
	for (const tool of model.tools) {
		if (tool === null) continue;
		for (const h of tool.heaters) {
			nameByHeater.set(h, tool.name || `Tool ${tool.number}`);
		}
	}

	// Dense counter over tool heaters only: the palette is consumed from its
	// first entry regardless of which index the bed happens to occupy.
	let toolSlot = 0;

	return model.heaters.map((_, i) => {
		if (beds.has(i)) return { label: "Bed", stroke: BED_COLOR };
		if (chambers.has(i)) return { label: "Chamber", stroke: CHAMBER_COLOR };
		const stroke = TOOL_COLORS[toolSlot % TOOL_COLORS.length]!;
		toolSlot++;
		return { label: nameByHeater.get(i) ?? `Heater ${i}`, stroke };
	});
}
