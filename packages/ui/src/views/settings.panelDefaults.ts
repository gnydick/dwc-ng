import type { PanelDefault } from "../shell/panelCanvas.ts";

export const SETTINGS_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "axis-roles", col: 0, row: 0, colSpan: 12, rowSpan: 14 },
	{ id: "tool-dock-sensors", col: 12, row: 0, colSpan: 12, rowSpan: 14 },
	{ id: "camera-config", col: 0, row: 14, colSpan: 12, rowSpan: 10 },
	{ id: "saved-versions", col: 12, row: 14, colSpan: 12, rowSpan: 10 },
	{ id: "console", col: 0, row: 24, colSpan: 24, rowSpan: 10 },
	{ id: "camera", col: 0, row: 34, colSpan: 8, rowSpan: 10 },
];
