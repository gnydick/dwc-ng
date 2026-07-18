import type { PanelDefault } from "../shell/panelCanvas.ts";

export const SETTINGS_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "axis-roles", col: 0, row: 0, colSpan: 24, rowSpan: 14 },
	{ id: "tool-dock-sensors", col: 24, row: 0, colSpan: 24, rowSpan: 14 },
	{ id: "camera-config", col: 0, row: 14, colSpan: 24, rowSpan: 10 },
	{ id: "saved-versions", col: 24, row: 14, colSpan: 24, rowSpan: 10 },
	{ id: "sensor-names", col: 0, row: 24, colSpan: 48, rowSpan: 14 },
	{ id: "console", col: 0, row: 38, colSpan: 48, rowSpan: 10 },
	{ id: "camera", col: 0, row: 48, colSpan: 16, rowSpan: 10 },
];
