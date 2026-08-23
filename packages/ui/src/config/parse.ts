/**
 * The untrusted boundary for the config overlay (audit H5). The SD file and
 * the localStorage cache are hand-editable JSON; before this module they
 * were CAST to ConfigOverlay after a top-level shape check, so well-formed
 * but mis-typed JSON ({"screens": "x"}) flowed into typed code — and
 * because the bad overlay was re-cached, it crashed every subsequent boot.
 *
 * parse-don't-validate: every section is rebuilt field by field against the
 * shape DEFAULT_CONFIG promises; anything mis-typed is DROPPED (that leaf
 * behaves as never-customized — the overlay philosophy), never trusted and
 * never fatal.
 *
 * @invariant untrusted-overlay-boundary
 * @rung 6  choke-point — this module is the only route from untrusted JSON to
 *          ConfigOverlay, rebuilding every section field by field rather than
 *          casting, and it is TOTAL: no input throws
 * @why the SD file and the localStorage cache are hand-editable JSON. Casting
 *      after a top-level shape check let well-formed but mis-typed input
 *      ({"screens": "x"}) reach typed code — and because the bad overlay was
 *      re-cached, it then crashed every subsequent boot, which is a bricked UI
 *      recoverable only by clearing storage
 * @debt promote by branding ConfigOverlay so the parsed shape and a
 *       hand-written object literal are different types, making a future cast
 *       at a new load site a compile error instead of merely absent.
 */
import {
	CONFIG_VERSION, isCustomCardId, isUserScreenId,
	type ConfigOverlay, type CustomScreen, type Envelope, type PinnedCommand,
	type Range, type ShapingDefaults, type SlotRect,
	type ThermalColors, type UserScreenId,
} from "./types.ts";
import { isPlainObject, safeEntries } from "@dwc-ng/connector";
import { COL_GRANULARITY_FACTOR } from "../shell/panelCanvas.ts";
import { isHexColor } from "../util/colorDistance.ts";

/** A slot rect is exactly four finite numbers. */
export function asSlotRect(value: unknown): SlotRect | null {
	if (!isPlainObject(value)) return null;
	const { col, row, colSpan, rowSpan } = value;
	if ([col, row, colSpan, rowSpan].some(v => typeof v !== "number" || !Number.isFinite(v))) return null;
	return { col: col as number, row: row as number, colSpan: colSpan as number, rowSpan: rowSpan as number };
}

function stringRecord(raw: unknown): Record<string, string> | undefined {
	if (!isPlainObject(raw)) return undefined;
	const out: Record<string, string> = {};
	for (const [key, value] of safeEntries(raw)) {
		if (typeof value === "string") out[key] = value;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function rectRecord(raw: unknown): Record<string, SlotRect> | undefined {
	if (!isPlainObject(raw)) return undefined;
	const out: Record<string, SlotRect> = {};
	for (const [key, value] of safeEntries(raw)) {
		const rect = asSlotRect(value);
		if (rect !== null) out[key] = rect;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function parseAxisRoles(raw: unknown): ConfigOverlay["axisRoles"] {
	return stringRecord(raw);
}

/**
 * Heater index → colour. Values are gated on isHexColor rather than merely
 * being strings: these land in a CSS colour slot and as a uPlot stroke, and
 * an arbitrary string there is a silently invisible line, not an error.
 */
function parseHeaterColors(raw: unknown): ConfigOverlay["heaterColors"] {
	if (!isPlainObject(raw)) return undefined;
	const out: Record<string, string> = {};
	for (const [key, value] of safeEntries(raw)) {
		if (isHexColor(value)) out[key] = value;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

/** Field-by-field like parseCamera: one bad channel drops itself, not the set. */
function parseThermalColors(raw: unknown): ConfigOverlay["thermalColors"] {
	if (!isPlainObject(raw)) return undefined;
	const out: Partial<ThermalColors> = {};
	if (isHexColor(raw.cold)) out.cold = raw.cold;
	if (isHexColor(raw.warm)) out.warm = raw.warm;
	if (isHexColor(raw.hot)) out.hot = raw.hot;
	return Object.keys(out).length > 0 ? out : undefined;
}

function parseDockSensors(raw: unknown): ConfigOverlay["dockSensors"] {
	if (!isPlainObject(raw)) return undefined;
	const out: NonNullable<ConfigOverlay["dockSensors"]> = {};
	for (const [key, value] of safeEntries(raw)) {
		if (!isPlainObject(value) || typeof value.gpIn !== "number") continue;
		out[key] = {
			gpIn: value.gpIn,
			...(typeof value.inverted === "boolean" ? { inverted: value.inverted } : {}),
		};
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function parseCamera(raw: unknown): ConfigOverlay["camera"] {
	if (!isPlainObject(raw)) return undefined;
	const out: NonNullable<ConfigOverlay["camera"]> = {};
	if (typeof raw.streamUrl === "string") out.streamUrl = raw.streamUrl;
	if (typeof raw.pinned === "boolean") out.pinned = raw.pinned;
	return Object.keys(out).length > 0 ? out : undefined;
}

function parseMacros(raw: unknown): ConfigOverlay["macros"] {
	if (!isPlainObject(raw) || typeof raw.autoConfirmRun !== "boolean") return undefined;
	return { autoConfirmRun: raw.autoConfirmRun };
}

/**
 * An inclusive bound: exactly two finite numbers, low strictly below high.
 *
 * `lo >= hi` is rejected rather than repaired. An empty (or reversed) span
 * would still be a box the containment test accepts as a question — and it
 * would answer "outside" for every point, so a run would refuse with
 * `outside-envelope`, which tells the operator their coordinates are wrong
 * when what is actually wrong is the box. Dropping to unset says the true
 * thing, and points at the Settings editor that fixes it.
 */
function asRange(value: unknown): Range | null {
	if (!Array.isArray(value) || value.length !== 2) return null;
	const [lo, hi] = value as unknown[];
	if (typeof lo !== "number" || typeof hi !== "number") return null;
	if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi) return null;
	return [lo, hi];
}

/**
 * The SOLE producer of a non-null Envelope (spec I8) — called by the overlay
 * boundary below and by the config store's setShaping, so a box entered in
 * Settings and a box hand-edited into the SD file pass the identical gate.
 *
 * Whole-or-nothing, unlike the field-by-field sections around it: one good
 * axis is not a box, and half an envelope cannot answer "is this point
 * inside?", which is the only question it exists to answer.
 */
export function asEnvelope(value: unknown): Envelope | null {
	if (!isPlainObject(value)) return null;
	const x = asRange(value.x);
	const y = asRange(value.y);
	if (x === null || y === null) return null;
	return { x, y };
}

/** An accelerometer address as M955/M956 P wants it: "board.slot". */
export function isAccelAddr(value: unknown): value is string {
	return typeof value === "string" && /^\d+\.\d+$/.test(value);
}

/**
 * Capture-run motion defaults, per field. Each is a positive quantity in a
 * G-code parameter slot — a zero or negative distance, feed, repeat count or
 * sample count has no move to describe, so it falls back to the shipped
 * default rather than reaching a builder.
 */
export function parseShapingDefaults(raw: unknown): Partial<ShapingDefaults> | undefined {
	if (!isPlainObject(raw)) return undefined;
	const positive = (v: unknown): number | undefined =>
		typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
	const count = (v: unknown): number | undefined =>
		typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : undefined;
	const out: { -readonly [K in keyof ShapingDefaults]?: number } = {};
	const distMm = positive(raw.distMm);
	if (distMm !== undefined) out.distMm = distMm;
	const speedMmS = positive(raw.speedMmS);
	if (speedMmS !== undefined) out.speedMmS = speedMmS;
	const repeats = count(raw.repeats);
	if (repeats !== undefined) out.repeats = repeats;
	const samples = count(raw.samples);
	if (samples !== undefined) out.samples = samples;
	return Object.keys(out).length > 0 ? out : undefined;
}

/** Tool number → accelerometer address. The key must be the canonical
 *  spelling of a non-negative whole tool number, so "01"/"1.5"/"x" drop. */
function parseAccelByTool(raw: unknown): Record<number, string> | undefined {
	if (!isPlainObject(raw)) return undefined;
	const out: Record<number, string> = {};
	for (const [key, value] of safeEntries(raw)) {
		const tool = Number(key);
		if (!Number.isInteger(tool) || tool < 0 || String(tool) !== key) continue;
		if (!isAccelAddr(value)) continue;
		out[tool] = value;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The shaping section. A malformed envelope leaves the key ABSENT, which is
 * how the overlay spells "never customized" — and the default it falls back
 * to is `null`, so a mangled box can only ever become "unset", never a
 * repaired or partial one (spec I8).
 */
function parseShaping(raw: unknown): ConfigOverlay["shaping"] {
	if (!isPlainObject(raw)) return undefined;
	const out: {
		envelope?: Envelope;
		defaults?: Partial<ShapingDefaults>;
		accelByTool?: Record<number, string>;
	} = {};
	const envelope = asEnvelope(raw.envelope);
	if (envelope !== null) out.envelope = envelope;
	const defaults = parseShapingDefaults(raw.defaults);
	if (defaults !== undefined) out.defaults = defaults;
	const accelByTool = parseAccelByTool(raw.accelByTool);
	if (accelByTool !== undefined) out.accelByTool = accelByTool;
	return Object.keys(out).length > 0 ? out : undefined;
}

function parseBed(raw: unknown): ConfigOverlay["bed"] {
	if (!isPlainObject(raw) || typeof raw.probePointCommand !== "string") return undefined;
	return { probePointCommand: raw.probePointCommand };
}

function parseCustomScreens(raw: unknown): Record<UserScreenId, CustomScreen> | undefined {
	if (!isPlainObject(raw)) return undefined;
	const out: Record<UserScreenId, CustomScreen> = {};
	for (const [key, value] of safeEntries(raw)) {
		// Foreign keys can't enter the minted namespace: a hand-edited id of
		// "machine" (or anything un-prefixed) is dropped, so a custom screen
		// can never shadow a built-in or the lab route.
		if (!isUserScreenId(key)) continue;
		if (!isPlainObject(value) || typeof value.name !== "string") continue;
		out[key] = { name: value.name, cards: rectRecord(value.cards) ?? {} };
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function parseScreens(raw: unknown): ConfigOverlay["screens"] {
	if (!isPlainObject(raw)) return undefined;
	const out: NonNullable<ConfigOverlay["screens"]> = {};
	const custom = parseCustomScreens(raw.custom);
	if (custom !== undefined) out.custom = custom;
	const renames = stringRecord(raw.renames);
	if (renames !== undefined) out.renames = renames;
	if (Array.isArray(raw.hidden)) {
		const hidden = raw.hidden.filter((v): v is string => typeof v === "string");
		if (hidden.length > 0) out.hidden = hidden;
	}
	if (isPlainObject(raw.layouts)) {
		const layouts: Record<string, Record<string, SlotRect>> = {};
		for (const [id, cards] of safeEntries(raw.layouts)) {
			const rects = rectRecord(cards);
			if (rects !== undefined) layouts[id] = rects;
		}
		if (Object.keys(layouts).length > 0) out.layouts = layouts;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function parseCards(raw: unknown): ConfigOverlay["cards"] {
	if (!isPlainObject(raw)) return undefined;
	const out: NonNullable<ConfigOverlay["cards"]> = {};
	for (const [key, value] of safeEntries(raw)) {
		if (!isCustomCardId(key)) continue;
		if (!isPlainObject(value) || typeof value.name !== "string" || typeof value.spec !== "string") continue;
		// The spec STAYS opaque text here — it re-passes its own boundary
		// (compose/controls/parse.ts) at the use site, where a broken spec
		// costs that card an error body, never the screen.
		out[key] = { name: value.name, spec: value.spec };
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function parsePins(raw: unknown): ConfigOverlay["pins"] {
	if (!Array.isArray(raw)) return undefined;
	const out: PinnedCommand[] = [];
	for (const value of raw) {
		if (!isPlainObject(value)) continue;
		if (typeof value.id !== "string" || typeof value.command !== "string" || typeof value.enabled !== "boolean") continue;
		const pin: PinnedCommand = { id: value.id, command: value.command, enabled: value.enabled };
		if (typeof value.key === "string") pin.key = value.key;
		out.push(pin);
	}
	// An empty array survives (arrays replace wholesale) but says nothing, so
	// treat it as never-customized like every other section.
	return out.length > 0 ? out : undefined;
}

/** Rebuild an overlay from untrusted parsed JSON, dropping bad leaves. */
export function parseOverlay(raw: unknown): ConfigOverlay {
	if (!isPlainObject(raw)) return {};
	const out: ConfigOverlay = {};
	const sections = {
		axisRoles: parseAxisRoles(raw.axisRoles),
		heaterColors: parseHeaterColors(raw.heaterColors),
		thermalColors: parseThermalColors(raw.thermalColors),
		dockSensors: parseDockSensors(raw.dockSensors),
		camera: parseCamera(raw.camera),
		sensorNames: stringRecord(raw.sensorNames),
		macros: parseMacros(raw.macros),
		bed: parseBed(raw.bed),
		screens: parseScreens(raw.screens),
		cards: parseCards(raw.cards),
		pins: parsePins(raw.pins),
		shaping: parseShaping(raw.shaping),
	} satisfies { [K in keyof ConfigOverlay]: ConfigOverlay[K] };
	for (const [key, value] of safeEntries(sections)) {
		if (value !== undefined) (out as Record<string, unknown>)[key] = value;
	}
	return out;
}

/**
 * v1 → v2: the canvas grid went from 46px columns with a 6px gutter to 4px
 * columns with none, so every stored col/colSpan is in units 13× too coarse.
 * The overlay holds rects in two places — a built-in screen's layout override
 * and a custom screen's own cards — and BOTH have to move, or a user's saved
 * layouts would land at a thirteenth of their width on the new grid.
 *
 * Deliberately a transform on the RAW json, ahead of parseOverlay: it must not
 * assume the shape is already valid. Anything that isn't a number is passed
 * through untouched and the parser drops it exactly as it always would, so a
 * hand-mangled config still cannot make this throw.
 */
function scaleRectRecord(raw: unknown): unknown {
	if (!isPlainObject(raw)) return raw;
	const out: Record<string, unknown> = {};
	for (const [id, rect] of safeEntries(raw)) {
		if (!isPlainObject(rect)) { out[id] = rect; continue; }
		const scale = (v: unknown): unknown =>
			typeof v === "number" && Number.isFinite(v) ? v * COL_GRANULARITY_FACTOR : v;
		out[id] = { ...rect, col: scale(rect.col), colSpan: scale(rect.colSpan) };
	}
	return out;
}

function migrateOverlayColumns(raw: unknown): unknown {
	if (!isPlainObject(raw) || !isPlainObject(raw.screens)) return raw;
	const screens = { ...raw.screens };

	if (isPlainObject(screens.layouts)) {
		const layouts: Record<string, unknown> = {};
		for (const [id, cards] of safeEntries(screens.layouts)) layouts[id] = scaleRectRecord(cards);
		screens.layouts = layouts;
	}
	if (isPlainObject(screens.custom)) {
		const custom: Record<string, unknown> = {};
		for (const [id, screen] of safeEntries(screens.custom)) {
			custom[id] = isPlainObject(screen) ? { ...screen, cards: scaleRectRecord(screen.cards) } : screen;
		}
		screens.custom = custom;
	}
	return { ...raw, screens };
}

/**
 * Envelope text → overlay, or null (corrupt / foreign / future-versioned →
 * defaults, never a boot failure). Older versions are migrated forward rather
 * than discarded — a version bump that silently dropped the whole overlay
 * would lose every saved layout, rename and pin on the next boot.
 */
export function parseOverlayPayload(text: string): ConfigOverlay | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	if (!isPlainObject(parsed) || !isPlainObject(parsed.overlay)) return null;
	if (parsed.version === CONFIG_VERSION) return parseOverlay(parsed.overlay);
	if (parsed.version === 1) return parseOverlay(migrateOverlayColumns(parsed.overlay));
	// Foreign or from a future build: defaults, never a guess.
	return null;
}
