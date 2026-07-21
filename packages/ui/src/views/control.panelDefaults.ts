import type { PanelDefault } from "../shell/panelCanvas.ts";

export const CONTROL_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "active-job", col: 0, row: 0, colSpan: 24, rowSpan: 8 },
	{ id: "homing", col: 0, row: 8, colSpan: 12, rowSpan: 6 },
	{ id: "tools", col: 12, row: 8, colSpan: 12, rowSpan: 6 },
	{ id: "heaters", col: 0, row: 14, colSpan: 12, rowSpan: 10 },
	{ id: "movement", col: 12, row: 14, colSpan: 12, rowSpan: 18 },
	{ id: "fans", col: 0, row: 24, colSpan: 12, rowSpan: 10 },
	{ id: "tuning", col: 0, row: 34, colSpan: 12, rowSpan: 8 },
	{ id: "console", col: 0, row: 42, colSpan: 24, rowSpan: 10 },
	{ id: "camera", col: 0, row: 52, colSpan: 8, rowSpan: 10 },
];
