import type { PanelDefault } from "../shell/panelCanvas.ts";

export const CONTROL_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "homing", col: 0, row: 0, colSpan: 12, rowSpan: 6 },
	{ id: "tools", col: 12, row: 0, colSpan: 12, rowSpan: 6 },
	{ id: "heaters", col: 0, row: 6, colSpan: 12, rowSpan: 10 },
	{ id: "movement", col: 12, row: 6, colSpan: 12, rowSpan: 18 },
	{ id: "fans", col: 0, row: 16, colSpan: 12, rowSpan: 10 },
	{ id: "tuning", col: 0, row: 26, colSpan: 12, rowSpan: 8 },
	{ id: "console", col: 0, row: 34, colSpan: 24, rowSpan: 10 },
	{ id: "camera", col: 0, row: 44, colSpan: 8, rowSpan: 10 },
];
