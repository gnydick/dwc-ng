import type { PanelDefault } from "../shell/panelCanvas.ts";

export const MACROS_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "macros", col: 0, row: 0, colSpan: 20, rowSpan: 20 },
	{ id: "editor", col: 20, row: 0, colSpan: 28, rowSpan: 20 },
	{ id: "console", col: 0, row: 20, colSpan: 48, rowSpan: 10 },
	{ id: "camera", col: 0, row: 30, colSpan: 16, rowSpan: 10 },
];
