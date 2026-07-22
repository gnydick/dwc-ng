import type { PanelDefault } from "../shell/panelCanvas.ts";

export const SYSTEM_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "system-files", col: 0, row: 0, colSpan: 8, rowSpan: 120 },
	{ id: "editor", col: 8, row: 0, colSpan: 16, rowSpan: 120 },
	{ id: "firmware", col: 0, row: 120, colSpan: 12, rowSpan: 110 },
	{ id: "object-model", col: 12, row: 120, colSpan: 12, rowSpan: 110 },
	{ id: "console", col: 0, row: 230, colSpan: 24, rowSpan: 75 },
	{ id: "camera", col: 0, row: 305, colSpan: 8, rowSpan: 75 },
];
