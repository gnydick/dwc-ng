/**
 * The screen registry — screens as pure data (design phase A7).
 *
 * The nav rail, the hash router, and the renderer ALL derive from this one
 * list (I9): a screen that isn't here cannot be routed to or shown, and the
 * ROUTES/NAV/Switch triple hand-sync this replaced cannot drift because it
 * no longer exists. Built-in ids double as the layout storage identity — a
 * screen's canvas record is `machineCanvasKeys(store, id)` on whichever
 * machine it was laid out on (GIT_86; the historic origin-global per-screen
 * canvas keys are retired, not migrated — see the campaign's Task 8
 * precedent: those bytes carried no proof of which machine wrote them).
 *
 * Slot rects are the fitted defaults the per-view *.panelDefaults.ts files
 * carried before the conversion. User screens (overlay entries with minted
 * stable ids) join this list in phase A7b.
 */
import { mergeComposition, parseComposition, parseTombstones, slotsOf, toSlotRect, type Composition, type CustomCardId } from "./composition.ts";
import { layoutBasis, readCanvasOrientation, readCanvasState, restampCanvas, writeCanvasState, type CanvasState } from "../shell/panelCanvas.ts";
import type { OrientationState } from "../shell/panelOrientation.ts";
import { LAB_ROUTE } from "../shell/router.ts";
import { isUserScreenId, type SlotRect, type UiConfig, type UserScreenId } from "../config/types.ts";
import type { MachineStore } from "../config/machineStore.ts";

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

/**
 * System: which machine this is, then 0:/sys listing + editor, firmware
 * update, the OM inspector. Identity leads the screen — it is the one card
 * whose whole point is to be seen, not sought.
 */
export const SYSTEM_COMPOSITION: Composition = {
	"machine-identity": { col: 0, row: 0, colSpan: 312, rowSpan: 56 },
	"system-files": { col: 0, row: 56, colSpan: 104, rowSpan: 120 },
	"system-editor": { col: 104, row: 56, colSpan: 208, rowSpan: 120 },
	firmware: { col: 0, row: 176, colSpan: 156, rowSpan: 112 },
	"object-model": { col: 156, row: 176, colSpan: 156, rowSpan: 112 },
	console: { col: 0, row: 288, colSpan: 312, rowSpan: 75 },
	camera: { col: 0, row: 363, colSpan: 104, rowSpan: 75 },
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
 * THREE columns, not two (GIT_86 — "the reset layout is just really bad", "i
 * have 3 columns with random sizing"). The two-column default above wasted a
 * third 156-wide column the owner's own hand-arranged layout used (his saved
 * screen ran cols 0 / 156 / 312), and packed the remaining two so unevenly
 * that pairing "what you measure beside what it produced" no longer read as
 * a design — it read as arbitrary. Every rowSpan below is unchanged from the
 * card's own registry size (compose/defs.ts CARD_DEFS) — that size IS the
 * measured floor (contentRowSpan() in the Card Lab against the
 * `shaping-measured` scenario, per-card comments there) and is pinned by
 * test/composition.test.ts's "every Shaping card is placed at its own
 * registry size" — so nothing here was re-guessed, only re-FLOWN. Re-run
 * 2026-08-26 (Card Lab "Audit every card" against `shaping-measured`) as a
 * spot check: seven of eight cards measured AT OR BELOW their registry span
 * that instant (Apply matched exactly; Decay/Candidates/Custom/Verify came
 * in well under, because a card's registry size is a floor checked across
 * several states, not a reading of any one of them). Status and Capture
 * measured a little over (188 vs 156, 147 vs 140) with this scenario's
 * per-tool disclosures rendered open — status's own registry comment says
 * exactly that: the floor is measured with every tpost row COLLAPSED, on
 * purpose, because reserving space for a disclosure most sessions open once
 * is worse than letting the body scroll while it's open. Not a regression,
 * the documented exception firing as designed; see task-17-report.md for the
 * full per-card table.
 *
 * COLUMN ASSIGNMENT is chosen, not measured, and the choice is this: put the
 * FIRST card of each column in workflow order — status, capture, decay are
 * steps 1, 2, 3, so the top of the screen reads left-to-right in the exact
 * order an operator starts the procedure — then let each column's own
 * remaining cards continue forward through the same procedure top to bottom
 * (col 0: status(1) -> candidates(5) -> apply(8); col 1: capture(2) ->
 * custom(6) -> verify(7); col 2: decay(3) -> sweep(4)). Every column is
 * therefore internally monotonic in workflow order — scanning down any one
 * of them always moves forward, never back — even though the three columns
 * don't reach the same step at the same row. Decay and Sweep keep the
 * original design's pairing (one stop, then every speed) by sharing a
 * column instead of sitting side by side, which is also what makes column 2
 * the tallest: Decay's chart (189) is not squeezed to balance the others.
 *
 * BALANCE: col 0 status+candidates+apply = 116+75+50 = 241 (102 -> 116 for
 * shaping-status, #128 — the tools table moved into a region of declared
 * height, plus the two rows every card gained when the header's auto margin
 * stopped being excluded from its own floor). col 1 capture+custom+verify =
 * 140+71+62 = 273. col 2 decay+sweep = 189+134 = 323 (118 -> 134 for
 * shaping-sweep, #136 — the caveat line was collapsing to zero and so was
 * contributing nothing to the card's own floor, and the sweep note grew a
 * fourth line so the physics sentence is not cut above the card's stop).
 * Range 82 rows (29% of the 279 average) — #94 already tracks this drift and
 * nothing here rebalances it.
 */
export const SHAPING_COMPOSITION: Composition = {
	"shaping-status": { col: 0, row: 0, colSpan: 156, rowSpan: 116 },
	"shaping-candidates": { col: 0, row: 116, colSpan: 156, rowSpan: 75 },
	"shaping-apply": { col: 0, row: 191, colSpan: 156, rowSpan: 50 },
	"shaping-capture": { col: 156, row: 0, colSpan: 156, rowSpan: 140 },
	"shaping-custom": { col: 156, row: 140, colSpan: 156, rowSpan: 71 },
	"shaping-verify": { col: 156, row: 211, colSpan: 156, rowSpan: 62 },
	"shaping-decay": { col: 312, row: 0, colSpan: 156, rowSpan: 189 },
	"shaping-sweep": { col: 312, row: 189, colSpan: 156, rowSpan: 134 },
	// Column 2 (decay+sweep) is the tallest at 323; the strip clears all three.
	// It moved 307 -> 323 with the Sweep card's re-measured floor (#136): a pin
	// raised without moving what sits under it puts the console inside the card
	// above it.
	console: { col: 0, row: 323, colSpan: 468, rowSpan: 75 },
	camera: { col: 0, row: 398, colSpan: 104, rowSpan: 75 },
};

/** Settings: config-overlay editors + the save card (the former save-bar). */
export const SETTINGS_COMPOSITION: Composition = {
	"axis-roles": { col: 0, row: 0, colSpan: 156, rowSpan: 109 },
	// camera-config 40 -> 49 and bed-probe 45 -> 54: both fields stacked their
	// label above their input (#138), which is +9 cells on each card. Every row
	// below them moves by the same 9 — a pin raised without re-laying the rows
	// under it puts the next card inside this one.
	"camera-config": { col: 0, row: 109, colSpan: 156, rowSpan: 49 },
	"tool-dock-sensors": { col: 156, row: 0, colSpan: 156, rowSpan: 76 },
	"saved-versions": { col: 156, row: 76, colSpan: 156, rowSpan: 40 },
	"bed-probe": { col: 156, row: 116, colSpan: 156, rowSpan: 54 },
	// Column 1 now ends at 170 (116 + 54) against column 0's 158; the pair below
	// clears the taller of the two, as before.
	"heater-colors": { col: 0, row: 170, colSpan: 156, rowSpan: 76 },
	"thermal-colors": { col: 156, row: 170, colSpan: 156, rowSpan: 60 },
	"sensor-names": { col: 0, row: 246, colSpan: 312, rowSpan: 72 },
	"filament-editor": { col: 0, row: 318, colSpan: 312, rowSpan: 130 },
	// The Shaping Lab's editor — "Settings › Input shaping", the place the lab's
	// own refusal copy sends the operator. Two stacked groups since #140 took
	// the accelerometer rows off it (box, motion).
	"settings-shaping": { col: 0, row: 448, colSpan: 156, rowSpan: 112 },
	// Beside it, not under it: the machine's sensors are read alongside the
	// shaping settings as often as they are read alone, and the pair of them
	// fills the two columns this screen has. The taller of the two (128 vs 112)
	// is what the rows below clear.
	accelerometers: { col: 156, row: 448, colSpan: 156, rowSpan: 128 },
	"config-save": { col: 0, row: 576, colSpan: 312, rowSpan: 26 },
	console: { col: 0, row: 602, colSpan: 312, rowSpan: 75 },
	camera: { col: 0, row: 677, colSpan: 104, rowSpan: 75 },
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
			return {
				id,
				builtin: true,
				def: {
					name: screens.renames[id] ?? def.name,
					class: def.class,
					// The coded composition MERGED with the override, minus what the
					// operator removed (#86). The old "an override that parsed to
					// nothing falls back to the coded composition" special case is
					// gone because the merge subsumes it and gets the case the
					// fallback got WRONG: stale or garbled stored data yields no
					// slots and no tombstones, so the merge is the coded set exactly
					// as before — but an operator who removed every card now gets an
					// empty screen instead of all of them back.
					composition: mergeComposition(
						def.composition,
						parseComposition(override, customCards),
						parseTombstones(override, customCards),
					),
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
 * The RAW rects the operator has actually SAVED for a screen — a built-in's
 * `screens.layouts[id]` override, or a custom screen's own `cards` — kept
 * separate from `composition` (screenList/resolveScreen), which for a
 * built-in with ANY override IS that override wholesale, not a merge with
 * the coded default.
 *
 * Used ONLY to seed createPanelCanvas's `seedFromOverlay` (GIT_86 task 16):
 * an upgrading machine's machine-scoped canvas key starts genuinely empty
 * (origin-global bytes carry no proof of which machine wrote them and are
 * never migrated), and without a seed a card the operator saved to the SD
 * card is indistinguishable there from one nobody ever placed. Null when the
 * screen has never been customised at all — there is nothing to seed with,
 * and an empty canvas then behaves exactly like a first-ever browser's.
 */
export function savedScreenLayout(config: UiConfig, screenId: string): CanvasState | null {
	const customCards = new Set(Object.keys(config.cards));
	const raw = isUserScreenId(screenId)
		? config.screens.custom[screenId]?.cards
		: config.screens.layouts[screenId];
	if (raw === undefined) return null;
	const parsed = parseComposition(raw, customCards);
	const state: CanvasState = {};
	for (const [id, slot] of slotsOf(parsed)) {
		state[id] = { col: slot.col, row: slot.row, colSpan: slot.colSpan, rowSpan: slot.rowSpan };
	}
	return Object.keys(state).length > 0 ? state : null;
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
export function replaceScreenLayout(store: LayoutStore, machineStore: MachineStore, screenId: string, rects: Record<string, SlotRect>): void {
	store.replaceAllScreenCards(screenId, rects);
	// Orientation rides IN the slot but is stored beside the geometry, so it
	// is split out here rather than at every call site.
	const orientations: OrientationState = {};
	for (const [id, rect] of Object.entries(rects)) {
		if (rect.orientation !== undefined) orientations[id] = rect.orientation;
	}
	// The basis is derived from the overlay AFTER the write, through the same
	// projection a mount will use (savedScreenLayout) — so the canvas record
	// names exactly what the next mount will compare it against. Deriving it
	// from `rects` instead would be subtly wrong: replaceAllScreenCards can
	// carry tombstones forward (#86), so what lands in the overlay is not
	// always what was passed in.
	writeCanvasState(machineStore, screenId, rects, orientations, layoutBasis(savedScreenLayout(store.config, screenId)));
}

/** The orientations an imported/replacement layout carries. */
export function orientationsOf(rects: Record<string, SlotRect>): OrientationState {
	const out: OrientationState = {};
	for (const [id, rect] of Object.entries(rects)) {
		if (rect.orientation !== undefined) out[id] = rect.orientation;
	}
	return out;
}

/**
 * `machineStore` is `null` when no machine is currently identified — the
 * per-browser canvas store this reads is itself now machine-scoped, so with
 * no machine there is nothing to read FROM, and this is a no-op rather than
 * a guess at whose layout is on screen. Same precedent as config/store.ts's
 * machine-half writes: identity unknown means skip, never adopt whatever
 * happens to be lying around.
 */
export function captureScreenGeometry(store: LayoutStore, machineStore: MachineStore | null): void {
	if (machineStore === null) return;
	for (const entry of screenList(store.config)) {
		const stored = readCanvasState(machineStore, entry.id);
		if (stored === null) continue; // nothing local — the overlay copy stands
		const orientations = readCanvasOrientation(machineStore, entry.id);
		const cards: Record<string, SlotRect> = {};
		for (const [id, slot] of slotsOf(entry.def.composition)) {
			const orientation = orientations[id] ?? slot.orientation;
			cards[id] = toSlotRect({
				...(stored[id] ?? slot),
				...(orientation === undefined ? {} : { orientation }),
			});
		}
		store.replaceAllScreenCards(entry.id, cards);
		// A Save reconciles the two stores, so it says so. Without this the
		// canvas still names the layout it was BUILT from, the next mount reads
		// that as a stale browser, and the operator is told a layout was
		// dropped when the two copies are identical (#87).
		restampCanvas(machineStore, entry.id, layoutBasis(savedScreenLayout(store.config, entry.id)));
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
		// `!= null` and not `hasOwn`: a tombstoned card is recorded on this
		// screen but is not ON it, and counting it would tell the operator a
		// card they removed is still placed — in the one report whose whole job
		// is the blast radius of deleting it (#86).
		if (override !== undefined && override[cardId] != null) {
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
