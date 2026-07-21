import type { PanelDefault } from "../shell/panelCanvas.ts";

/**
 * Fitted to measured content on the 4px grid, re-measured for the 36px header
 * (a card spanning n rows renders 4n - 8 px tall). Position, Tools & heaters
 * and Sensors are sized to the 7-axis / 4-tool machine; Temperatures is a chart
 * whose height is its usefulness; Printing keeps headroom for the progress
 * block it grows mid-job.
 */
export const MACHINE_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "position", col: 0, row: 0, colSpan: 12, rowSpan: 95 },
	{ id: "tools-heaters", col: 12, row: 0, colSpan: 12, rowSpan: 89 },
	{ id: "active-job", col: 0, row: 95, colSpan: 12, rowSpan: 40 },
	{ id: "sensors", col: 12, row: 89, colSpan: 12, rowSpan: 42 },
	{ id: "temperatures", col: 0, row: 135, colSpan: 24, rowSpan: 80 },
	{ id: "console", col: 0, row: 215, colSpan: 24, rowSpan: 75 },
	{ id: "camera", col: 0, row: 290, colSpan: 8, rowSpan: 75 },
];
