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
import { parseComposition, slotsOf, toSlotRect, type Composition } from "./composition.ts";
import { readCanvasState } from "../shell/panelCanvas.ts";
import { LAB_ROUTE } from "../shell/router.ts";
import type { SlotRect, UiConfig, UserScreenId } from "../config/types.ts";

export interface ScreenDef {
	/** Display name — a LABEL, never an identity (I10: renames can't orphan). */
	name: string;
	composition: Composition;
	/** Extra class on the canvas (screen-specific CSS hooks). */
	class?: string;
}

/** Machine: live DRO, current job, sensors, temps.
 *  Tools & heaters now carries the per-tool CONTROLS (heat, filament, select),
 *  so it lives on Control; Machine stays a monitoring surface and reads tool
 *  temperatures from the Temperatures chart. Anyone who wants it here can
 *  compose it back — the card is unchanged, only its default home moved. */
export const MACHINE_COMPOSITION: Composition = {
	position: { col: 0, row: 0, colSpan: 12, rowSpan: 95 },
	sensors: { col: 12, row: 0, colSpan: 12, rowSpan: 42 },
	"active-job": { col: 0, row: 95, colSpan: 12, rowSpan: 40 },
	temperatures: { col: 0, row: 135, colSpan: 24, rowSpan: 80 },
	console: { col: 0, row: 215, colSpan: 24, rowSpan: 75 },
	camera: { col: 0, row: 290, colSpan: 8, rowSpan: 75 },
};

/** Control: the interactive surface — every control 1:1 with G-code.
 *  "tools-heaters" is the per-tool hub: heater setpoints (M568), filament
 *  load/unload (M701/M702/M703) and tool select all live on the tool they act
 *  on, which is why the separate heaters/tools/filament cards are no longer
 *  placed here — they duplicated it. They remain in the registry, so they can
 *  still be composed in by hand.
 *  atx/fans are hidden-but-placed (their visibleWhen gates them). */
export const CONTROL_COMPOSITION: Composition = {
	"active-job": { col: 0, row: 0, colSpan: 24, rowSpan: 32 },
	"tools-heaters": { col: 0, row: 32, colSpan: 12, rowSpan: 160 },
	fans: { col: 0, row: 192, colSpan: 12, rowSpan: 62 },
	tuning: { col: 0, row: 254, colSpan: 12, rowSpan: 33 },
	homing: { col: 12, row: 32, colSpan: 12, rowSpan: 51 },
	movement: { col: 12, row: 83, colSpan: 12, rowSpan: 123 },
	atx: { col: 12, row: 206, colSpan: 12, rowSpan: 32 },
	console: { col: 0, row: 290, colSpan: 24, rowSpan: 75 },
	camera: { col: 0, row: 365, colSpan: 8, rowSpan: 75 },
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

// Route-namespace walls, compile-checked: a built-in screen id must never
// equal the lab route (the DEV lab would shadow it) and can never wear the
// minted "u-" prefix. Violations are type errors here, not runtime mysteries.
const _labRouteNeverScreen: Extract<BuiltinScreenId, typeof LAB_ROUTE> extends never ? true : never = true;
void _labRouteNeverScreen;
const _builtinNeverUser: Extract<BuiltinScreenId, UserScreenId> extends never ? true : never = true;
void _builtinNeverUser;

/** A screen with its identity attached — what nav/router/renderer consume. */
export interface ScreenEntry {
	id: string;
	builtin: boolean;
	def: ScreenDef;
}

/**
 * The live screen list, in nav order: built-ins (minus hidden, renamed and
 * layout-overridden per the config overlay) followed by the user's custom
 * screens. This is the ONE list nav/router/renderer read (I9). Config-sourced
 * compositions pass the parseComposition boundary (I1) — a stored slot naming
 * a removed card drops, never crashes.
 *
 * Never empty by construction: hiding every built-in still leaves the first
 * one, so the shell always has a screen to land on.
 */
export function screenList(config: UiConfig): ScreenEntry[] {
	const screens = config.screens;
	// "c-" slots survive the composition parse only while their card
	// definition exists — deleting a custom card degrades screens by exactly
	// that slot.
	const customCards = new Set(Object.keys(config.cards));
	const builtins = (Object.entries(BUILTIN_SCREENS) as Array<[BuiltinScreenId, ScreenDef]>)
		.filter(([id]) => !screens.hidden.includes(id))
		.map(([id, def]): ScreenEntry => {
			const override = screens.layouts[id];
			const overridden = override !== undefined ? parseComposition(override, customCards) : null;
			return {
				id,
				builtin: true,
				def: {
					name: screens.renames[id] ?? def.name,
					class: def.class,
					// An override that parsed to nothing (all slots dropped) falls
					// back to the built-in composition — a screen is never blank
					// because of stale stored data.
					composition: overridden !== null && Object.keys(overridden).length > 0 ? overridden : def.composition,
				},
			};
		});
	const custom = Object.entries(screens.custom).map(([id, c]): ScreenEntry => ({
		id,
		builtin: false,
		def: { name: c.name, composition: parseComposition(c.cards, customCards) },
	}));
	const list = [...builtins, ...custom];
	if (list.length > 0) return list;
	const [id, def] = Object.entries(BUILTIN_SCREENS)[0]!;
	return [{ id, builtin: true, def }];
}

/**
 * Resolve a route segment to a screen, or null (the caller decides the
 * fallback — Shell uses the first listed screen).
 */
export function resolveScreen(config: UiConfig, id: string): ScreenEntry | null {
	return screenList(config).find(s => s.id === id) ?? null;
}

/**
 * Snapshot every screen's CURRENT geometry — the fast local tier (per-drop
 * localStorage) joined with its composition — into the config overlay, so
 * Save-to-machine carries screens AND layouts to the SD card (the ratified
 * "all to SD" decision). Locally the localStorage tier still wins (it is the
 * freshest); the overlay copy is what a NEW browser seeds from. This is also
 * the whole migration story for pre-conversion layouts: their historic keys
 * are read here and captured on the first save.
 */
export function captureScreenGeometry(store: {
	config: UiConfig;
	updateScreenCards: (id: string, cards: Record<string, SlotRect>) => void;
}): void {
	for (const entry of screenList(store.config)) {
		const stored = readCanvasState(`dwc-ng.canvas.${entry.id}`);
		if (stored === null) continue; // nothing local — the overlay copy stands
		const cards: Record<string, SlotRect> = {};
		for (const [id, slot] of slotsOf(entry.def.composition)) {
			cards[id] = toSlotRect(stored[id] ?? slot);
		}
		store.updateScreenCards(entry.id, cards);
	}
}
