import type { PanelDefault } from "../shell/panelCanvas.ts";

/**
 * Fitted to measured content on the 4px grid (card height = 4n - 6).
 *
 * The toolpath viewer is the point of this view, so it keeps its height; the
 * two status cards above it are trimmed to what they draw. Printing was 446px
 * tall to render "No job running" - it now carries headroom for the progress
 * block, not four hundred pixels of nothing.
 */
export const ACTIVITY_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "position", col: 0, row: 0, colSpan: 12, rowSpan: 89 },
	{ id: "active-job", col: 12, row: 0, colSpan: 12, rowSpan: 40 },
	{ id: "gcode-viewer", col: 0, row: 89, colSpan: 24, rowSpan: 180 },
	{ id: "console", col: 0, row: 269, colSpan: 24, rowSpan: 75 },
	{ id: "camera", col: 0, row: 344, colSpan: 8, rowSpan: 75 },
];
