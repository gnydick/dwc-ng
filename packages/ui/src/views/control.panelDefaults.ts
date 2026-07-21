import type { PanelDefault } from "../shell/panelCanvas.ts";

/**
 * Row spans fitted to each card's measured content on the 4px grid, re-measured
 * for the 36px header (a card spanning n rows renders 4n - 8 px tall).
 *
 * Two columns below the full-width Printing card: the left holds Homing,
 * Heaters, Fans, Tuning; the right holds Tools, Filament, Movement, ATX. Cards
 * that grow with the machine (Heaters/Fans gain a row per tool/fan) are
 * measured at the real 4-tool machine; the rest are trimmed to what they draw.
 */
export const CONTROL_PANEL_DEFAULTS: PanelDefault[] = [
	// Full width. Fits the idle "no job" state; gains a progress block mid-print.
	{ id: "active-job", col: 0, row: 0, colSpan: 24, rowSpan: 32 },

	// --- left column ---
	{ id: "homing", col: 0, row: 32, colSpan: 12, rowSpan: 51 },
	{ id: "heaters", col: 0, row: 83, colSpan: 12, rowSpan: 62 },
	{ id: "fans", col: 0, row: 145, colSpan: 12, rowSpan: 62 },
	{ id: "tuning", col: 0, row: 207, colSpan: 12, rowSpan: 33 },

	// --- right column ---
	{ id: "tools", col: 12, row: 32, colSpan: 12, rowSpan: 33 },
	// Hidden when no tool feeds an extruder; still needs a placement, or the
	// canvas has nowhere to put it on a machine that does.
	{ id: "filament", col: 12, row: 65, colSpan: 12, rowSpan: 50 },
	{ id: "movement", col: 12, row: 115, colSpan: 12, rowSpan: 123 },
	// Rendered only when the board reports an ATX port (state.atxPower !== null),
	// but it needs a placement regardless: a panel the canvas has never heard of
	// has nowhere to go.
	{ id: "atx", col: 12, row: 238, colSpan: 12, rowSpan: 32 },

	// --- full width again, below both columns ---
	{ id: "console", col: 0, row: 270, colSpan: 24, rowSpan: 75 },
	{ id: "camera", col: 0, row: 345, colSpan: 8, rowSpan: 75 },
];
