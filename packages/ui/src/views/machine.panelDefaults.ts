import type { PanelDefault } from "../shell/panelCanvas.ts";

export const MACHINE_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "position", col: 0, row: 0, colSpan: 12, rowSpan: 113 },
	{ id: "tools-heaters", col: 12, row: 0, colSpan: 12, rowSpan: 113 },
	{ id: "active-job", col: 0, row: 113, colSpan: 12, rowSpan: 60 },
	{ id: "sensors", col: 12, row: 113, colSpan: 12, rowSpan: 45 },
	{ id: "temperatures", col: 0, row: 173, colSpan: 24, rowSpan: 90 },
	{ id: "console", col: 0, row: 263, colSpan: 24, rowSpan: 75 },
	{ id: "camera", col: 0, row: 338, colSpan: 8, rowSpan: 75 },
];
