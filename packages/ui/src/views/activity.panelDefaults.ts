import type { PanelDefault } from "../shell/panelCanvas.ts";

export const ACTIVITY_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "position", col: 0, row: 0, colSpan: 12, rowSpan: 15 },
	{ id: "active-job", col: 12, row: 0, colSpan: 12, rowSpan: 15 },
	{ id: "gcode-viewer", col: 0, row: 15, colSpan: 24, rowSpan: 24 },
	{ id: "console", col: 0, row: 39, colSpan: 24, rowSpan: 10 },
	{ id: "camera", col: 0, row: 49, colSpan: 8, rowSpan: 10 },
];
