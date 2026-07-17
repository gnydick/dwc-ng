import type { PanelDefault } from "../shell/panelCanvas.ts";

export const SYSTEM_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "system-files", col: 0, row: 0, colSpan: 8, rowSpan: 16 },
	{ id: "editor", col: 8, row: 0, colSpan: 16, rowSpan: 16 },
	{ id: "object-model", col: 0, row: 16, colSpan: 24, rowSpan: 14 },
	{ id: "console", col: 0, row: 30, colSpan: 24, rowSpan: 10 },
	{ id: "camera", col: 0, row: 40, colSpan: 8, rowSpan: 10 },
];
