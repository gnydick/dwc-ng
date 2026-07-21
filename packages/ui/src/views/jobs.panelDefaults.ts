import type { PanelDefault } from "../shell/panelCanvas.ts";

export const JOBS_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "job-files", col: 0, row: 0, colSpan: 12, rowSpan: 135 },
	{ id: "job-details", col: 12, row: 0, colSpan: 12, rowSpan: 135 },
	{ id: "console", col: 0, row: 135, colSpan: 24, rowSpan: 75 },
	{ id: "camera", col: 0, row: 210, colSpan: 8, rowSpan: 75 },
];
