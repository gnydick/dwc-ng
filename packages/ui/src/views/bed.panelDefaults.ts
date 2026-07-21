import type { PanelDefault } from "../shell/panelCanvas.ts";

/**
 * Row spans on the 4px grid (a card spanning n rows renders 4n - 8 px tall).
 * The map is the point of this view, so it takes the room; the detail panel
 * beside it is sized to its controls plus the probe result it grows.
 */
export const BED_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "heightmap", col: 0, row: 0, colSpan: 16, rowSpan: 150 },
	{ id: "probe-point", col: 16, row: 0, colSpan: 8, rowSpan: 90 },
	{ id: "console", col: 0, row: 150, colSpan: 24, rowSpan: 75 },
	{ id: "camera", col: 0, row: 225, colSpan: 8, rowSpan: 75 },
];
