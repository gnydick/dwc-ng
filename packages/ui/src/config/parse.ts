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
 * never fatal. Total: no input throws.
 */
import {
	CONFIG_VERSION, isCustomCardId, isUserScreenId,
	type ConfigOverlay, type CustomScreen, type PinnedCommand, type SlotRect, type UserScreenId,
} from "./types.ts";
import { isPlainObject, safeEntries } from "../util/safeObject.ts";

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
		dockSensors: parseDockSensors(raw.dockSensors),
		camera: parseCamera(raw.camera),
		sensorNames: stringRecord(raw.sensorNames),
		macros: parseMacros(raw.macros),
		bed: parseBed(raw.bed),
		screens: parseScreens(raw.screens),
		cards: parseCards(raw.cards),
		pins: parsePins(raw.pins),
	} satisfies { [K in keyof ConfigOverlay]: ConfigOverlay[K] };
	for (const [key, value] of Object.entries(sections)) {
		if (value !== undefined) (out as Record<string, unknown>)[key] = value;
	}
	return out;
}

/**
 * Envelope text → overlay, or null (corrupt / foreign / future-versioned →
 * defaults, never a boot failure). Schema migrations hook in on `version`
 * before the gate when the schema next changes.
 */
export function parseOverlayPayload(text: string): ConfigOverlay | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	if (!isPlainObject(parsed) || parsed.version !== CONFIG_VERSION || !isPlainObject(parsed.overlay)) return null;
	return parseOverlay(parsed.overlay);
}
