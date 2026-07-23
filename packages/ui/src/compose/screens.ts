/**
 * The screen registry — screens as pure data (design phase A7).
 *
 * The nav rail, the hash router, and the renderer ALL derive from this one
 * list (I9): a screen that isn't here cannot be routed to or shown, and the
 * ROUTES/NAV/Switch triple hand-sync this replaced cannot drift because it
 * no longer exists. Built-in ids double as the layout storage identity
 * ("dwc-ng.canvas.<id>" — the historic keys, so saved layouts keep working).
 *
 * Slot rects are the fitted defaults the per-view *.panelDefaults.ts files
 * carried before the conversion. User screens (overlay entries with minted
 * stable ids) join this list in phase A7b.
 */
import type { Composition } from "./composition.ts";

export interface ScreenDef {
	/** Display name — a LABEL, never an identity (I10: renames can't orphan). */
	name: string;
	composition: Composition;
	/** Extra class on the canvas (screen-specific CSS hooks). */
	class?: string;
}

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

/** Jobs: the gcodes listing + details for the selected file. */
export const JOBS_COMPOSITION: Composition = {
	"job-files": { col: 0, row: 0, colSpan: 12, rowSpan: 135 },
	"job-details": { col: 12, row: 0, colSpan: 12, rowSpan: 135 },
	console: { col: 0, row: 135, colSpan: 24, rowSpan: 75 },
	camera: { col: 0, row: 210, colSpan: 8, rowSpan: 75 },
};

/** Macros: the listing (with Run) + editor. */
export const MACROS_COMPOSITION: Composition = {
	macros: { col: 0, row: 0, colSpan: 10, rowSpan: 150 },
	"macros-editor": { col: 10, row: 0, colSpan: 14, rowSpan: 150 },
	console: { col: 0, row: 150, colSpan: 24, rowSpan: 75 },
	camera: { col: 0, row: 225, colSpan: 8, rowSpan: 75 },
};

/** System: 0:/sys listing + editor, firmware update, the OM inspector. */
export const SYSTEM_COMPOSITION: Composition = {
	"system-files": { col: 0, row: 0, colSpan: 8, rowSpan: 120 },
	"system-editor": { col: 8, row: 0, colSpan: 16, rowSpan: 120 },
	firmware: { col: 0, row: 120, colSpan: 12, rowSpan: 112 },
	"object-model": { col: 12, row: 120, colSpan: 12, rowSpan: 112 },
	console: { col: 0, row: 232, colSpan: 24, rowSpan: 75 },
	camera: { col: 0, row: 307, colSpan: 8, rowSpan: 75 },
};

/** Bed: the height map + single-point re-probe. */
export const BED_COMPOSITION: Composition = {
	heightmap: { col: 0, row: 0, colSpan: 16, rowSpan: 150 },
	"probe-point": { col: 16, row: 0, colSpan: 8, rowSpan: 90 },
	console: { col: 0, row: 150, colSpan: 24, rowSpan: 75 },
	camera: { col: 0, row: 225, colSpan: 8, rowSpan: 75 },
};

/** Settings: config-overlay editors + the save card (the former save-bar). */
export const SETTINGS_COMPOSITION: Composition = {
	"axis-roles": { col: 0, row: 0, colSpan: 12, rowSpan: 109 },
	"camera-config": { col: 0, row: 109, colSpan: 12, rowSpan: 40 },
	"tool-dock-sensors": { col: 12, row: 0, colSpan: 12, rowSpan: 76 },
	"saved-versions": { col: 12, row: 76, colSpan: 12, rowSpan: 40 },
	"bed-probe": { col: 12, row: 116, colSpan: 12, rowSpan: 45 },
	"sensor-names": { col: 0, row: 161, colSpan: 24, rowSpan: 72 },
	"config-save": { col: 0, row: 233, colSpan: 24, rowSpan: 26 },
	console: { col: 0, row: 259, colSpan: 24, rowSpan: 75 },
	camera: { col: 0, row: 334, colSpan: 8, rowSpan: 75 },
};

/** The built-in screens, in nav order. Ids are stable identities. */
export const BUILTIN_SCREENS = {
	machine: { name: "Machine", composition: MACHINE_COMPOSITION },
	control: { name: "Control", composition: CONTROL_COMPOSITION, class: "control" },
	jobs: { name: "Jobs", composition: JOBS_COMPOSITION, class: "jobs" },
	macros: { name: "Macros", composition: MACROS_COMPOSITION },
	system: { name: "System", composition: SYSTEM_COMPOSITION, class: "system" },
	settings: { name: "Settings", composition: SETTINGS_COMPOSITION, class: "settings" },
	activity: { name: "Activity", composition: ACTIVITY_COMPOSITION },
	bed: { name: "Bed", composition: BED_COMPOSITION, class: "bed" },
} as const satisfies Record<string, ScreenDef>;

export type BuiltinScreenId = keyof typeof BUILTIN_SCREENS;

/** A screen with its identity attached — what nav/router/renderer consume. */
export interface ScreenEntry {
	id: string;
	def: ScreenDef;
}

/**
 * The live screen list, in nav order. Today: the built-ins. Phase A7b merges
 * user screens (and rename/hide overlays) from the config store here — this
 * accessor is already the single point every consumer reads.
 */
export function screenList(): ScreenEntry[] {
	return Object.entries(BUILTIN_SCREENS).map(([id, def]) => ({ id, def }));
}

/**
 * Resolve a route segment to a screen, or null (the caller decides the
 * fallback — Shell uses the first listed screen).
 */
export function resolveScreen(id: string): ScreenEntry | null {
	return screenList().find(s => s.id === id) ?? null;
}
