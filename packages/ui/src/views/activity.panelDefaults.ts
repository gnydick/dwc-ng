import type { PanelDefault } from "../shell/panelCanvas.ts";

/**
 * Fitted to measured content on the 4px grid, re-measured for the 36px header.
 * The toolpath viewer is the point of this view, so it keeps its height; the
 * status cards beside it are trimmed to what they draw. Printing carries
 * headroom for the progress block it grows mid-job.
 */
export const ACTIVITY_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "position", col: 0, row: 0, colSpan: 12, rowSpan: 95 },
	{ id: "active-job", col: 12, row: 0, colSpan: 12, rowSpan: 40 },
	// Hidden unless the job carries M486 objects; still needs a placement, or the
	// canvas has nowhere to put it on a job that does.
	{ id: "build-objects", col: 12, row: 40, colSpan: 12, rowSpan: 53 },
	{ id: "gcode-viewer", col: 0, row: 95, colSpan: 24, rowSpan: 180 },
	// Hidden until a print has completed a layer; full width below the viewer,
	// so the per-layer chart reads as detail on the print above it.
	{ id: "layers", col: 0, row: 275, colSpan: 24, rowSpan: 67 },
	{ id: "console", col: 0, row: 342, colSpan: 24, rowSpan: 75 },
	{ id: "camera", col: 0, row: 417, colSpan: 8, rowSpan: 75 },
];
