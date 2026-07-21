import type { PanelDefault } from "../shell/panelCanvas.ts";

/**
 * Fitted to measured content on the 4px grid (card height = 4n - 6).
 *
 * Position, Tools & heaters and Sensors are sized to what they draw on the
 * 7-axis / 4-tool machine. Printing keeps headroom for the progress block it
 * grows mid-job, and Temperatures is a chart whose height IS its usefulness -
 * neither is trimmed to its idle size.
 */
export const MACHINE_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "position", col: 0, row: 0, colSpan: 12, rowSpan: 89 },
	{ id: "tools-heaters", col: 12, row: 0, colSpan: 12, rowSpan: 89 },
	// Headroom: gains progress, file name and time estimates while printing.
	{ id: "active-job", col: 0, row: 89, colSpan: 12, rowSpan: 40 },
	{ id: "sensors", col: 12, row: 89, colSpan: 12, rowSpan: 40 },
	{ id: "temperatures", col: 0, row: 129, colSpan: 24, rowSpan: 80 },
	{ id: "console", col: 0, row: 209, colSpan: 24, rowSpan: 75 },
	{ id: "camera", col: 0, row: 284, colSpan: 8, rowSpan: 75 },
];
