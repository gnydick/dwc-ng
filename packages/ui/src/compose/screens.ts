/**
 * Built-in screen compositions — pure data (design phase A3+; grows a full
 * screen registry with user screens and derived nav in phase A7).
 *
 * Slot rects are the fitted defaults the per-view *.panelDefaults.ts files
 * carried; a view converts by deleting its defaults file and gaining an entry
 * here. Storage keys stay the historic "dwc-ng.canvas.<view>" strings so
 * existing saved layouts keep working unchanged.
 */
import type { Composition } from "./composition.ts";

/** Machine: live DRO, tools & heaters, current job, sensors, temps. */
export const MACHINE_COMPOSITION: Composition = {
	position: { col: 0, row: 0, colSpan: 12, rowSpan: 95 },
	"tools-heaters": { col: 12, row: 0, colSpan: 12, rowSpan: 89 },
	"active-job": { col: 0, row: 95, colSpan: 12, rowSpan: 40 },
	sensors: { col: 12, row: 89, colSpan: 12, rowSpan: 42 },
	temperatures: { col: 0, row: 135, colSpan: 24, rowSpan: 80 },
	console: { col: 0, row: 215, colSpan: 24, rowSpan: 75 },
	camera: { col: 0, row: 290, colSpan: 8, rowSpan: 75 },
};
