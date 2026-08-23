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
import { parseComposition, slotsOf, toSlotRect, type Composition, type CustomCardId } from "./composition.ts";
import { canvasStorageKey, readCanvasOrientation, readCanvasState, writeCanvasState } from "../shell/panelCanvas.ts";
import type { OrientationState } from "../shell/panelOrientation.ts";
import { LAB_ROUTE } from "../shell/router.ts";
import type { SlotRect, UiConfig, UserScreenId } from "../config/types.ts";

export interface ScreenDef {
	/** Display name — a LABEL, never an identity (I10: renames can't orphan). */
	name: string;
	composition: Composition;
	/** Extra class on the canvas (screen-specific CSS hooks). */
	class?: string;
}

/** Machine: live DRO, tools & heaters, current job, sensors, temps. */
export const MACHINE_COMPOSITION: Composition = {
	// 95 -> 103 for the speed footer (CARD_DEFS.position.size agrees); the card
	// below it moves down by the same 8 so the column stays collision-free.
	position: { col: 0, row: 0, colSpan: 156, rowSpan: 103 },
	"tools-heaters": { col: 156, row: 0, colSpan: 156, rowSpan: 110 },
	// 40 -> 46 so Pause/Cancel are above the fold. Column 0 now ends at 149,
	// still clear of temperatures at 152, so nothing below needs to move.
	"active-job": { col: 0, row: 103, colSpan: 156, rowSpan: 46 },
	sensors: { col: 156, row: 110, colSpan: 156, rowSpan: 42 },
	temperatures: { col: 0, row: 152, colSpan: 312, rowSpan: 80 },
	console: { col: 0, row: 232, colSpan: 312, rowSpan: 75 },
	camera: { col: 0, row: 307, colSpan: 104, rowSpan: 75 },
};

/** Control: the interactive surface — every control 1:1 with G-code.
 *  atx/filament/fans are hidden-but-placed (their visibleWhen gates them). */
export const CONTROL_COMPOSITION: Composition = {
	// active-job 32 -> 46 so Pause/Cancel are above the fold. It spans the full
	// width at row 0, so EVERY card below shifts down by the same 14 — both
	// columns and the console/camera strip.
	"active-job": { col: 0, row: 0, colSpan: 312, rowSpan: 46 },
	// homing 51 -> 101 when it became a per-axis table (7 axes + the
	// machine-wide row need 338px of content at the DEFAULT pitch). The left
	// column below it shifts down by the same 50, and the full-width
	// console/camera strip follows the taller of the two columns.
	homing: { col: 0, row: 46, colSpan: 156, rowSpan: 101 },
	// heaters 62 -> 115: two setpoint fields and two Set buttons per tool make
	// every tool row two lines. The rest of the left column follows.
	heaters: { col: 0, row: 147, colSpan: 156, rowSpan: 115 },
	fans: { col: 0, row: 262, colSpan: 156, rowSpan: 62 },
	"pinned-commands": { col: 0, row: 324, colSpan: 156, rowSpan: 50 },
	tuning: { col: 0, row: 374, colSpan: 156, rowSpan: 33 },
	filament: { col: 156, row: 79, colSpan: 156, rowSpan: 50 },
	// movement 123 -> 76: the step bank left its full-width row above the jog
	// table for a column beside it, so the card no longer needs the height.
	// Measured at the default pitch, same as the card's own default.
	//
	// colSpan stays 156 even though the content fits in 99 (which IS the card's
	// standalone default now). This screen is two 156-wide columns; a 99-wide
	// card here would leave a 57-column hole beside it rather than a tidier
	// layout. The slack sits inside the card, to the right of the jog table —
	// which is what .jog-table's fixed key widths already assume.
	movement: { col: 156, row: 129, colSpan: 156, rowSpan: 76 },
	// Follows movement up by the same 47.
	atx: { col: 156, row: 205, colSpan: 156, rowSpan: 32 },
	// Left column ends at 407, right now at 237 — the strip still clears both,
	// and the left column is still the taller of the two, so the strip does not
	// move.
	console: { col: 0, row: 407, colSpan: 312, rowSpan: 75 },
	camera: { col: 0, row: 482, colSpan: 104, rowSpan: 75 },
};

/** Activity: live position + detailed job progress + the 3D toolpath.
 *  build-objects/layers are hidden-but-placed (their visibleWhen gates them)
 *  so they have somewhere to appear on a job that carries them. */
export const ACTIVITY_COMPOSITION: Composition = {
	// 95 -> 103 for the speed footer. gcode-viewer spans the full width
	// directly below, so it and everything under it shift down by the same 8.
	position: { col: 0, row: 0, colSpan: 156, rowSpan: 103 },
	// 40 -> 52 (this variant carries the est-sources row), so build-objects
	// below it moves to 52 and now ends at 105 — past gcode-viewer's old 103,
	// which therefore shifts to 105 along with everything under it.
	"active-job-detailed": { col: 156, row: 0, colSpan: 156, rowSpan: 52 },
	"build-objects": { col: 156, row: 52, colSpan: 156, rowSpan: 53 },
	"gcode-viewer": { col: 0, row: 105, colSpan: 312, rowSpan: 180 },
	layers: { col: 0, row: 285, colSpan: 312, rowSpan: 67 },
	console: { col: 0, row: 352, colSpan: 312, rowSpan: 75 },
	camera: { col: 0, row: 427, colSpan: 104, rowSpan: 75 },
};

/** Jobs: the gcodes listing + details for the selected file. */
export const JOBS_COMPOSITION: Composition = {
	"job-files": { col: 0, row: 0, colSpan: 156, rowSpan: 135 },
	"job-details": { col: 156, row: 0, colSpan: 156, rowSpan: 135 },
	console: { col: 0, row: 135, colSpan: 312, rowSpan: 75 },
	camera: { col: 0, row: 210, colSpan: 104, rowSpan: 75 },
};

/** Macros: the listing (with Run) + editor. */
export const MACROS_COMPOSITION: Composition = {
	macros: { col: 0, row: 0, colSpan: 130, rowSpan: 150 },
	"macros-editor": { col: 130, row: 0, colSpan: 182, rowSpan: 150 },
	console: { col: 0, row: 150, colSpan: 312, rowSpan: 75 },
	camera: { col: 0, row: 225, colSpan: 104, rowSpan: 75 },
};

/** System: 0:/sys listing + editor, firmware update, the OM inspector. */
export const SYSTEM_COMPOSITION: Composition = {
	"system-files": { col: 0, row: 0, colSpan: 104, rowSpan: 120 },
	"system-editor": { col: 104, row: 0, colSpan: 208, rowSpan: 120 },
	firmware: { col: 0, row: 120, colSpan: 156, rowSpan: 112 },
	"object-model": { col: 156, row: 120, colSpan: 156, rowSpan: 112 },
	console: { col: 0, row: 232, colSpan: 312, rowSpan: 75 },
	camera: { col: 0, row: 307, colSpan: 104, rowSpan: 75 },
};

/** Bed maintenance: the height map, which map is in use, tramming, and
 *  single-point re-probe. Grew from the height-map-only screen (audit item). */
export const BED_COMPOSITION: Composition = {
	heightmap: { col: 0, row: 0, colSpan: 208, rowSpan: 150 },
	mesh: { col: 208, row: 0, colSpan: 104, rowSpan: 60 },
	"bed-tram": { col: 208, row: 60, colSpan: 104, rowSpan: 40 },
	"probe-point": { col: 208, row: 100, colSpan: 104, rowSpan: 90 },
	console: { col: 0, row: 190, colSpan: 312, rowSpan: 75 },
	camera: { col: 0, row: 265, colSpan: 104, rowSpan: 75 },
};

/**
 * Shaping: the input-shaping lab, in the order the operator works through it.
 *
 * Two columns, and the pairing across them is deliberate rather than a way of
 * filling space: what you are measuring sits beside what it produced. Status
 * next to Capture (the session and the run that feeds it), Decay next to Sweep
 * (one stop, then every speed), Candidates next to Custom (the ranked list and
 * the train you build yourself), Verify next to Apply (what the machine
 * measured and the line it earns). Every rowSpan matches the card's own
 * default, so a fresh screen is each card fitted to its content.
 */
export const SHAPING_COMPOSITION: Composition = {
	"shaping-status": { col: 0, row: 0, colSpan: 156, rowSpan: 77 },
	"shaping-capture": { col: 156, row: 0, colSpan: 156, rowSpan: 66 },
	"shaping-decay": { col: 0, row: 77, colSpan: 156, rowSpan: 75 },
	"shaping-sweep": { col: 156, row: 66, colSpan: 156, rowSpan: 39 },
	"shaping-candidates": { col: 0, row: 152, colSpan: 156, rowSpan: 75 },
	"shaping-custom": { col: 156, row: 105, colSpan: 156, rowSpan: 71 },
	"shaping-verify": { col: 0, row: 227, colSpan: 156, rowSpan: 62 },
	"shaping-apply": { col: 156, row: 176, colSpan: 156, rowSpan: 50 },
	// The left column is the taller of the two (ends at 289); the full-width
	// strip clears both.
	console: { col: 0, row: 289, colSpan: 312, rowSpan: 75 },
	camera: { col: 0, row: 364, colSpan: 104, rowSpan: 75 },
};

/** Settings: config-overlay editors + the save card (the former save-bar). */
export const SETTINGS_COMPOSITION: Composition = {
	"axis-roles": { col: 0, row: 0, colSpan: 156, rowSpan: 109 },
	"camera-config": { col: 0, row: 109, colSpan: 156, rowSpan: 40 },
	"tool-dock-sensors": { col: 156, row: 0, colSpan: 156, rowSpan: 76 },
	"saved-versions": { col: 156, row: 76, colSpan: 156, rowSpan: 40 },
	"bed-probe": { col: 156, row: 116, colSpan: 156, rowSpan: 45 },
	"heater-colors": { col: 0, row: 161, colSpan: 156, rowSpan: 76 },
	"thermal-colors": { col: 156, row: 161, colSpan: 156, rowSpan: 60 },
	"sensor-names": { col: 0, row: 237, colSpan: 312, rowSpan: 72 },
	"filament-editor": { col: 0, row: 309, colSpan: 312, rowSpan: 130 },
	"config-save": { col: 0, row: 439, colSpan: 312, rowSpan: 26 },
	console: { col: 0, row: 465, colSpan: 312, rowSpan: 75 },
	camera: { col: 0, row: 540, colSpan: 104, rowSpan: 75 },
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
	// Renamed from "Bed": the screen is no longer just the height map. The ID
	// stays `bed` — it is the layout storage key, so renaming it would orphan
	// every saved layout.
	bed: { name: "Bed maintenance", composition: BED_COMPOSITION, class: "bed" },
	// Appended, not inserted: the order of this object IS the nav order, so
	// putting Shaping anywhere else would move every screen below it in a rail
	// people navigate by position.
	// No `class`: nothing in app.css keys off a shaping canvas, and an unused
	// styling hook is an invitation to write one rule against it and forget.
	shaping: { name: "Shaping", composition: SHAPING_COMPOSITION },
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

/** Where an imported screen should land, and what it displaces. */
export interface ScreenImportPlan {
	/** Screen to write the composition into; null means mint a new one. */
	target: ScreenEntry | null;
	/** Same-named user screens to delete — stale duplicates, not the target. */
	purge: string[];
}

/**
 * Decide what importing a screen called `name` should overwrite.
 *
 * Share files carry NO ids by design (share.ts: "minted ids never travel", so
 * a foreign file cannot overwrite a local screen by guessing an id) — the
 * display name is the only identity available, and it is matched against
 * `screenList`, which already resolves renamed built-ins.
 *
 * A built-in wins the match. Exporting your Control screen from one host and
 * importing it on another means *this* Control: the earlier rule skipped
 * built-ins entirely, so such an import could only ever mint a SECOND screen
 * called "Control" and the nav grew a duplicate. Built-ins take compositions
 * through the layouts overlay, so overwriting one in place is both possible
 * and correct — and it keeps the stable id everything else is keyed on.
 */
export function planScreenImport(config: UiConfig, name: string): ScreenImportPlan {
	const sameName = screenList(config).filter(s => s.def.name === name);
	const builtin = sameName.find(s => s.builtin);
	const users = sameName.filter(s => !s.builtin);
	if (builtin !== undefined) return { target: builtin, purge: users.map(s => s.id) };
	const [first, ...rest] = users;
	return { target: first ?? null, purge: rest.map(s => s.id) };
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
/** What a layout writer needs from the config store. */
export interface LayoutStore {
	config: UiConfig;
	replaceAllScreenCards: (id: string, cards: Record<string, SlotRect>) => void;
}

/**
 * Replace a screen's layout WHOLESALE — the sole route for "this layout is
 * gone, here is a different one" (import today; presets or a restore
 * tomorrow).
 *
 * A screen's geometry lives in TWO TIERS BY DESIGN (ratified 2026-07-22,
 * f426706): the per-browser canvas store is the freshest local tier and wins
 * locally, while the config overlay rides to the SD card so layouts travel
 * with the machine and seed a new browser. That is a feature — do not
 * "simplify" it to one store.
 *
 * What the tiers do NOT license is a wholesale replacement that writes only
 * one of them. `mergeCanvas` assembles a layout CARD BY CARD from whichever
 * store happens to have each id, so a half-written replacement arrives
 * shredded: cards the browser already knew keep their old spots, and only
 * cards it had never seen land where the new layout says.
 *
 * That is exactly the reported bug. Importing Control appeared to work only
 * because it carried cards this browser had never seen; importing Machine
 * changed nothing visible because every card was already known, so every one
 * of its positions lost. Same code, opposite outcome, decided by overlap.
 *
 * Both stores are therefore written here, together, or not at all. Callers
 * do not get to write one.
 */
export function replaceScreenLayout(store: LayoutStore, screenId: string, rects: Record<string, SlotRect>): void {
	store.replaceAllScreenCards(screenId, rects);
	// Orientation rides IN the slot but is stored beside the geometry, so it
	// is split out here rather than at every call site.
	const orientations: OrientationState = {};
	for (const [id, rect] of Object.entries(rects)) {
		if (rect.orientation !== undefined) orientations[id] = rect.orientation;
	}
	writeCanvasState(canvasStorageKey(screenId), rects, orientations);
}

/** The orientations an imported/replacement layout carries. */
export function orientationsOf(rects: Record<string, SlotRect>): OrientationState {
	const out: OrientationState = {};
	for (const [id, rect] of Object.entries(rects)) {
		if (rect.orientation !== undefined) out[id] = rect.orientation;
	}
	return out;
}

export function captureScreenGeometry(store: LayoutStore): void {
	for (const entry of screenList(store.config)) {
		const key = canvasStorageKey(entry.id);
		const stored = readCanvasState(key);
		if (stored === null) continue; // nothing local — the overlay copy stands
		const orientations = readCanvasOrientation(key);
		const cards: Record<string, SlotRect> = {};
		for (const [id, slot] of slotsOf(entry.def.composition)) {
			const orientation = orientations[id] ?? slot.orientation;
			cards[id] = toSlotRect({
				...(stored[id] ?? slot),
				...(orientation === undefined ? {} : { orientation }),
			});
		}
		store.replaceAllScreenCards(entry.id, cards);
	}
}

/** One screen that still shows a given custom card — a line of the delete
 *  plan's blast radius. */
export interface ScreenUse {
	id: string;
	name: string;
	/** Hidden built-ins are reported too: the card is still placed on them,
	 *  and unhiding the screen would bring it back. */
	hidden: boolean;
}

/**
 * Every screen whose composition contains `cardId`. Built-ins are checked via
 * their layouts overlay ONLY: a built-in's default composition can never name
 * a custom card (the registry and the "c-" namespace are disjoint by
 * construction — see compose/defs.ts registered-card-ids). `screenList()` is
 * deliberately not reused — it filters hidden screens out, which is exactly
 * wrong here.
 */
export function screensUsing(config: UiConfig, cardId: CustomCardId): ScreenUse[] {
	const uses: ScreenUse[] = [];
	const screens = config.screens;
	for (const [id, def] of Object.entries(BUILTIN_SCREENS) as Array<[BuiltinScreenId, ScreenDef]>) {
		const override = screens.layouts[id];
		if (override !== undefined && Object.hasOwn(override, cardId)) {
			uses.push({ id, name: screens.renames[id] ?? def.name, hidden: screens.hidden.includes(id) });
		}
	}
	for (const [id, c] of Object.entries(screens.custom)) {
		if (Object.hasOwn(c.cards, cardId)) uses.push({ id, name: c.name, hidden: false });
	}
	return uses;
}

/**
 * A checked intent to delete a custom card, carrying what would be lost —
 * the compose twin of files/browser.ts's RemovePlan.
 *
 * @invariant card-delete-carries-its-blast-radius
 * @rung 7  sole-constructor type — the armed confirm holds a CardDeletePlan,
 *          and `planCardDelete` is its only producer, deriving the screens the
 *          card is on AND the message shown from the same id in one pass. The
 *          confirm deletes `plan.id`, so the report the operator read and the
 *          deletion performed cannot disagree
 * @why a delete that removes a card from every screen at once is exactly the
 *      action whose scope the operator must see before confirming — "delete
 *      this card?" cannot precede stripping it from screens they forgot it
 *      was on. The plan freezes usage at arm time; the studio is modal over
 *      composition edits, so the frozen report cannot go stale between the
 *      two clicks
 */
export interface CardDeletePlan {
	readonly id: CustomCardId;
	readonly uses: readonly ScreenUse[];
	/** The armed line's text — built here, beside the uses it describes. */
	readonly message: string;
	readonly __plan: unique symbol;
}

export function planCardDelete(config: UiConfig, id: CustomCardId): CardDeletePlan {
	const uses: readonly ScreenUse[] = screensUsing(config, id);
	const names = uses.map(u => (u.hidden ? `${u.name} (hidden)` : u.name)).join(", ");
	const message = uses.length === 0
		? "Not on any screen."
		: `On screens: ${names} — confirm to remove it from all of them.`;
	// The brand exists only in the type system; nothing reads it.
	return { id, uses, message } as CardDeletePlan;
}
