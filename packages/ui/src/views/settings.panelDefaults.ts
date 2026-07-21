import type { PanelDefault } from "../shell/panelCanvas.ts";

/**
 * Fitted to measured content on the 4px grid, re-measured for the 36px header.
 * These are forms, so their height is knowable — but the ones that gain a row
 * per axis, tool or saved version carry a little headroom so a machine with
 * more of them does not immediately scroll.
 */
export const SETTINGS_PANEL_DEFAULTS: PanelDefault[] = [
	// --- left column ---
	{ id: "axis-roles", col: 0, row: 0, colSpan: 12, rowSpan: 109 },
	{ id: "camera-config", col: 0, row: 109, colSpan: 12, rowSpan: 40 },

	// --- right column ---
	{ id: "tool-dock-sensors", col: 12, row: 0, colSpan: 12, rowSpan: 76 },
	{ id: "saved-versions", col: 12, row: 76, colSpan: 12, rowSpan: 40 },
	{ id: "bed-probe", col: 12, row: 116, colSpan: 12, rowSpan: 45 },

	// --- full width, below both columns ---
	{ id: "sensor-names", col: 0, row: 161, colSpan: 24, rowSpan: 72 },
	{ id: "console", col: 0, row: 233, colSpan: 24, rowSpan: 75 },
	{ id: "camera", col: 0, row: 308, colSpan: 8, rowSpan: 75 },
];
