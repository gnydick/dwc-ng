import type { PanelDefault } from "../shell/panelCanvas.ts";

export const MACHINE_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "position", col: 0, row: 0, colSpan: 24, rowSpan: 15 },
	{ id: "tools-heaters", col: 24, row: 0, colSpan: 24, rowSpan: 15 },
	{ id: "job", col: 0, row: 15, colSpan: 24, rowSpan: 6 },
	{ id: "sensors", col: 24, row: 15, colSpan: 24, rowSpan: 6 },
	{ id: "temperatures", col: 0, row: 21, colSpan: 48, rowSpan: 12 },
	{ id: "console", col: 0, row: 33, colSpan: 48, rowSpan: 10 },
	{ id: "camera", col: 0, row: 43, colSpan: 16, rowSpan: 10 },
];
