import type { PanelDefault } from "../shell/panelCanvas.ts";

export const ACTIVITY_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "position", col: 0, row: 0, colSpan: 12, rowSpan: 113 },
	{ id: "active-job", col: 12, row: 0, colSpan: 12, rowSpan: 113 },
	{ id: "gcode-viewer", col: 0, row: 113, colSpan: 24, rowSpan: 180 },
	{ id: "console", col: 0, row: 293, colSpan: 24, rowSpan: 75 },
	{ id: "camera", col: 0, row: 368, colSpan: 8, rowSpan: 75 },
];
