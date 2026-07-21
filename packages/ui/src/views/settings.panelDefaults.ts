import type { PanelDefault } from "../shell/panelCanvas.ts";

export const SETTINGS_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "axis-roles", col: 0, row: 0, colSpan: 12, rowSpan: 105 },
	{ id: "tool-dock-sensors", col: 12, row: 0, colSpan: 12, rowSpan: 105 },
	{ id: "camera-config", col: 0, row: 105, colSpan: 12, rowSpan: 75 },
	{ id: "saved-versions", col: 12, row: 105, colSpan: 12, rowSpan: 75 },
	{ id: "sensor-names", col: 0, row: 180, colSpan: 24, rowSpan: 105 },
	{ id: "console", col: 0, row: 285, colSpan: 24, rowSpan: 75 },
	{ id: "camera", col: 0, row: 360, colSpan: 8, rowSpan: 75 },
];
