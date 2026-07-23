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

/** Control: the interactive surface — every control 1:1 with G-code.
 *  atx/filament/fans are hidden-but-placed (their visibleWhen gates them). */
export const CONTROL_COMPOSITION: Composition = {
	"active-job": { col: 0, row: 0, colSpan: 24, rowSpan: 32 },
	homing: { col: 0, row: 32, colSpan: 12, rowSpan: 51 },
	heaters: { col: 0, row: 83, colSpan: 12, rowSpan: 62 },
	fans: { col: 0, row: 145, colSpan: 12, rowSpan: 62 },
	tuning: { col: 0, row: 207, colSpan: 12, rowSpan: 33 },
	tools: { col: 12, row: 32, colSpan: 12, rowSpan: 33 },
	filament: { col: 12, row: 65, colSpan: 12, rowSpan: 50 },
	movement: { col: 12, row: 115, colSpan: 12, rowSpan: 123 },
	atx: { col: 12, row: 238, colSpan: 12, rowSpan: 32 },
	console: { col: 0, row: 270, colSpan: 24, rowSpan: 75 },
	camera: { col: 0, row: 345, colSpan: 8, rowSpan: 75 },
};

/** Activity: live position + detailed job progress + the 3D toolpath.
 *  build-objects/layers are hidden-but-placed (their visibleWhen gates them)
 *  so they have somewhere to appear on a job that carries them. */
export const ACTIVITY_COMPOSITION: Composition = {
	position: { col: 0, row: 0, colSpan: 12, rowSpan: 95 },
	"active-job-detailed": { col: 12, row: 0, colSpan: 12, rowSpan: 40 },
	"build-objects": { col: 12, row: 40, colSpan: 12, rowSpan: 53 },
	"gcode-viewer": { col: 0, row: 95, colSpan: 24, rowSpan: 180 },
	layers: { col: 0, row: 275, colSpan: 24, rowSpan: 67 },
	console: { col: 0, row: 342, colSpan: 24, rowSpan: 75 },
	camera: { col: 0, row: 417, colSpan: 8, rowSpan: 75 },
};
