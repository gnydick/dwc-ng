/**
 * Screen compositions — which cards a screen holds and where they sit.
 *
 * Design: docs/composable-cards-design.md. Invariants owned here:
 *  - I2  no duplicate card on a screen: a composition is
 *        Partial<Record<CardId, PanelRect>> — a second copy of a card has no
 *        encoding, so the picker/import layer cannot express one.
 *  - I1  (boundary half) parseComposition turns untrusted stored/imported
 *        data into slots keyed by REAL CardIds; unknown ids and malformed
 *        rects are dropped per-slot, never the whole screen — unlike
 *        mergeCanvas's discard-everything-on-collision, a user's composition
 *        degrades by at most the bad slot.
 *
 * autoPlace replaces "reject/discard" with "find room": adding a card scans
 * for the first free position at the card's natural size. Adding a card can
 * therefore never wipe or shuffle an existing layout — placement is additive
 * by construction.
 */
import { GRID_COLS, clampRect, rectsOverlap, type PanelRect } from "../shell/panelCanvas.ts";
import { CARD_DEFS, parseCardId, type CardId } from "./defs.ts";

/** One card's placement on a screen. */
export type Slot = PanelRect;

/** A user-authored card's id — the "c-" prefix IS the namespace boundary:
 *  registry CardIds never start with it, so the union below can't collide. */
export type CustomCardId = `c-${string}`;

export function isCustomCardId(id: string): id is CustomCardId {
	return id.startsWith("c-");
}

/** Everything a slot can hold: a registry card or a user-authored one. */
export type SlotId = CardId | CustomCardId;

/** I2: keyed by SlotId — duplicates unrepresentable. */
export type Composition = Partial<Record<SlotId, Slot>>;

function isSlotShape(value: unknown): value is Record<keyof PanelRect, unknown> {
	return typeof value === "object" && value !== null
		&& "col" in value && "row" in value && "colSpan" in value && "rowSpan" in value;
}

/**
 * Tolerant boundary parse (I1): anything not a plain object yields an empty
 * composition; entries survive only with a registered CardId — or, when
 * `customIds` is given, a "c-" id that actually exists in the user's card
 * definitions — and a rect that clamps to sanity. Per-slot dropping is
 * deliberate — see module doc: deleting a custom card degrades every screen
 * that held it by exactly that slot.
 */
export function parseComposition(raw: unknown, customIds?: ReadonlySet<string>): Composition {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
	const result: Composition = {};
	for (const [key, value] of Object.entries(raw)) {
		const id: SlotId | null =
			parseCardId(key) ?? (isCustomCardId(key) && customIds?.has(key) ? key : null);
		if (id === null || !isSlotShape(value)) continue;
		result[id] = clampRect({
			col: Number(value.col), row: Number(value.row),
			colSpan: Number(value.colSpan), rowSpan: Number(value.rowSpan),
		});
	}
	return result;
}

/** Slots as (id, rect) pairs without lying about the key type. */
export function slotsOf(composition: Composition): Array<[SlotId, Slot]> {
	return Object.entries(composition) as Array<[SlotId, Slot]>;
}

/**
 * First free position for a rect of the given size: scan rows top-down (4px
 * quantum), columns left-right, return the first spot that fits the grid and
 * overlaps nothing. Total — the grid is unbounded downward, so a fit below
 * everything always exists.
 */
export function findFreePosition(
	occupied: readonly Slot[],
	size: { colSpan: number; rowSpan: number },
): { col: number; row: number } {
	const colSpan = Math.min(Math.max(1, size.colSpan), GRID_COLS);
	const rowSpan = Math.max(1, size.rowSpan);
	const bottom = occupied.reduce((max, s) => Math.max(max, s.row + s.rowSpan), 0);
	for (let row = 0; row <= bottom; row++) {
		for (let col = 0; col + colSpan <= GRID_COLS; col++) {
			const candidate = { col, row, colSpan, rowSpan };
			if (!occupied.some(s => rectsOverlap(candidate, s))) return { col, row };
		}
	}
	return { col: 0, row: bottom };
}

/** A custom card's default footprint until its author resizes it. */
const CUSTOM_CARD_SIZE = { colSpan: 12, rowSpan: 40 };

/**
 * Add a card at its natural size (registry cards) or the custom default in
 * the first free spot. No-op if already present (I2 makes the duplicate
 * unrepresentable; this makes re-adding idempotent rather than an error).
 */
export function addCard(composition: Composition, id: SlotId): Composition {
	if (composition[id] !== undefined) return composition;
	const size = isCustomCardId(id) ? CUSTOM_CARD_SIZE : CARD_DEFS[id].size;
	const occupied = Object.values(composition).filter((s): s is Slot => s !== undefined);
	const { col, row } = findFreePosition(occupied, size);
	return { ...composition, [id]: { col, row, ...size } };
}

/** Remove a card. Other slots are untouched — removal never reflows. */
export function removeCard(composition: Composition, id: SlotId): Composition {
	if (composition[id] === undefined) return composition;
	const next = { ...composition };
	delete next[id];
	return next;
}
