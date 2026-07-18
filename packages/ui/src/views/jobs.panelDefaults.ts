import type { PanelDefault } from "../shell/panelCanvas.ts";

export const JOBS_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "active-job", col: 0, row: 0, colSpan: 24, rowSpan: 8 },
	{ id: "job-files", col: 0, row: 8, colSpan: 12, rowSpan: 18 },
	{ id: "job-details", col: 12, row: 8, colSpan: 12, rowSpan: 18 },
	{ id: "console", col: 0, row: 26, colSpan: 24, rowSpan: 10 },
	{ id: "camera", col: 0, row: 36, colSpan: 8, rowSpan: 10 },
];
