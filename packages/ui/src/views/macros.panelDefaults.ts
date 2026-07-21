import type { PanelDefault } from "../shell/panelCanvas.ts";

export const MACROS_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "macros", col: 0, row: 0, colSpan: 10, rowSpan: 150 },
	{ id: "editor", col: 10, row: 0, colSpan: 14, rowSpan: 150 },
	{ id: "console", col: 0, row: 150, colSpan: 24, rowSpan: 75 },
	{ id: "camera", col: 0, row: 225, colSpan: 8, rowSpan: 75 },
];
