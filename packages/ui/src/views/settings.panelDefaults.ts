import type { PanelDefault } from "../shell/panelCanvas.ts";

/**
 * Fitted to measured content on the 4px grid (card height = 4n - 6).
 *
 * These are forms, so their height is knowable - but the ones that gain a row
 * per axis, tool or sensor carry a little headroom so a machine with more of
 * them does not immediately scroll.
 */
export const SETTINGS_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "axis-roles", col: 0, row: 0, colSpan: 12, rowSpan: 105 },
	{ id: "tool-dock-sensors", col: 12, row: 0, colSpan: 12, rowSpan: 76 },
	{ id: "camera-config", col: 0, row: 105, colSpan: 12, rowSpan: 38 },
	{ id: "saved-versions", col: 12, row: 76, colSpan: 12, rowSpan: 32 },
	// Ends exactly where sensor-names begins (row 143), which spans the full width.
	{ id: "bed-probe", col: 12, row: 108, colSpan: 12, rowSpan: 35 },
	{ id: "sensor-names", col: 0, row: 143, colSpan: 24, rowSpan: 72 },
	{ id: "console", col: 0, row: 215, colSpan: 24, rowSpan: 75 },
	{ id: "camera", col: 0, row: 290, colSpan: 8, rowSpan: 75 },
];
