/**
 * Chart series (label + colour) for the heaters, derived from the object model.
 *
 * @invariant no-confusable-heater-lines
 * @rung 8  illegal state unrepresentable — the bed's and chamber's colours are
 *          not members of TOOL_COLORS, so "a tool drawing in the bed's colour"
 *          has no way to be produced. Not achieved by choosing colours
 *          carefully, which would be rung 1
 * @why the chart is how the operator tells a runaway tool from a heating bed at
 *      a glance. The previous version indexed TOOL_COLORS by HEATER index,
 *      which on a bed-at-0 machine pushed the fourth tool onto a gold measuring
 *      dE 9.4 from the bed — indistinguishable in a moving line (The previous version indexed TOOL_COLORS by
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

/**
 * Per-heater colour overrides, keyed by heater index as a string (the config
 * overlay's shape).
 *
 * Applied AFTER the derived colour, deliberately. The derivation still holds
 * its no-two-lines-alike invariant for everything the user has not touched, so
 * an override replaces exactly one line and cannot disturb the rest. An
 * override is free to collide — the picker warns at ΔE < 25 and does not
 * block, because the guarantee is about the palette we ship, not about
 * forbidding an operator their own choice.
 */
export type HeaterColorOverrides = Readonly<Record<string, string>>;

export interface HeaterSeries {
	label: string;
	stroke: string;
}

/**
 * One series per heater, in heater order — the chart aligns series to column
 * index, so a null heater still occupies its slot.
 */
export function heaterSeries(
	model: HeaterSeriesModel,
	overrides: HeaterColorOverrides = {},
): HeaterSeries[] {
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
		// The tool slot advances for every non-bed, non-chamber heater whether
		// or not it is overridden — otherwise clearing one override would
		// renumber the palette and recolour every line after it.
		const derived = beds.has(i)
			? { label: "Bed", stroke: BED_COLOR }
			: chambers.has(i)
				? { label: "Chamber", stroke: CHAMBER_COLOR }
				: { label: nameByHeater.get(i) ?? `Heater ${i}`, stroke: TOOL_COLORS[toolSlot++ % TOOL_COLORS.length]! };
		const override = overrides[String(i)];
		return override === undefined ? derived : { label: derived.label, stroke: override };
	});
}
