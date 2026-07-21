import type { PanelDefault } from "../shell/panelCanvas.ts";

export const SYSTEM_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "system-files", col: 0, row: 0, colSpan: 8, rowSpan: 120 },
	{ id: "editor", col: 8, row: 0, colSpan: 16, rowSpan: 120 },
	{ id: "object-model", col: 0, row: 120, colSpan: 24, rowSpan: 105 },
	{ id: "console", col: 0, row: 225, colSpan: 24, rowSpan: 75 },
	{ id: "camera", col: 0, row: 300, colSpan: 8, rowSpan: 75 },
];
