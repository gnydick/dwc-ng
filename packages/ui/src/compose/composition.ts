/**
 * Screen compositions — which cards a screen holds and where they sit.
 *
 * Design: docs/composable-cards-design.md (its I-numbers are superseded by the
 * ids below — see docs/invariant-register.md).
 *
 * @invariant no-duplicate-card
 * @rung 8  illegal state unrepresentable — a composition is
 *          Partial<Record<CardId, PanelRect>>, so a second copy of a card has
 *          nowhere to live. The picker and the import layer cannot express one
 *          even by trying. Was design I2
 * @why two copies of a card would each poll, each subscribe, and each claim
 *      cells, and the operator could delete only whichever one the DOM handed
 *      the click to
 *
 * @invariant composition-degrades-per-slot
 * @rung 6  choke-point — parseComposition is the only route from stored or
 *          imported data into slots, and it drops per-slot: an unknown id or a
 *          malformed rect costs that slot and nothing else. Was design I1's
 *          boundary half
 * @why the alternative is on record as a bug. mergeCanvas used to discard
 *      everything on collision, which erased whole user layouts on reload;
 *      a screen should degrade by at most the bad slot
 * @debt promote by branding the parsed composition so a stored blob cannot be
 *       cast into slot position at a future load site.
 *
 * @invariant additive-placement
 * @rung 6  choke-point — autoPlace scans for the first free position at the
 *          card's natural size, and it is the only way a card enters a screen.
 *          There is no reject-or-discard branch to reach
 * @why adding a card must never wipe or shuffle what is already placed. The
 *      operator's layout is their work, and losing it to an unrelated action is
 *      the failure they will not forgive
 * @debt promote by returning a placement that carries proof it collided with
 *       nothing, so a caller cannot write a rect it did not obtain from here.
 */
import { clampRect, findFreePosition, type PanelRect } from "../shell/panelCanvas.ts";
import { CARD_DEFS, parseCardId, type CardId } from "./defs.ts";
import { isCustomCardId, type CustomCardId, type SlotRect, type UiConfig } from "../config/types.ts";

/** Placement is geometry — it lives in panelCanvas.ts (one implementation,
 *  shared with the controller's own slot adoption); re-exported here for
 *  the compose layer's consumers. */
export { findFreePosition };

/** One card's placement on a screen, plus its content direction. Geometry
 *  stays pure PanelRect for the collision math; orientation rides alongside
 *  so it persists and travels with the slot rather than in a parallel store. */
export type Slot = PanelRect & { orientation?: "vertical" | "horizontal" };

/** A user-authored card's id and its guard — defined once in
 *  config/types.ts (the layer that mints them); re-exported here for the
 *  compose layer's consumers. */
export { isCustomCardId };
export type { CustomCardId };

/** Everything a slot can hold: a registry card or a user-authored one. */
export type SlotId = CardId | CustomCardId;

// The namespace boundary, compile-checked: if a registry card were ever
// named "c-…", it would be silently hijacked into the custom-card render
// branch. This line makes that a type error instead of a runtime mystery.
const _cardIdNeverCustom: Extract<CardId, CustomCardId> extends never ? true : never = true;
void _cardIdNeverCustom;

/** The user's custom card ids, parsed (never cast) from the config record. */
export function customCardIds(config: UiConfig): CustomCardId[] {
	return Object.keys(config.cards).filter(isCustomCardId);
}

/** I2: keyed by SlotId — duplicates unrepresentable. Slots are Readonly so
 *  a built-in composition literal cannot be mutated at runtime (I12) —
 *  layout changes go through the canvas/overlay, never the code defaults. */
export type Composition = Partial<Record<SlotId, Readonly<Slot>>>;

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
		const orientation = (value as { orientation?: unknown }).orientation;
		result[id] = {
			...clampRect({
				col: Number(value.col), row: Number(value.row),
				colSpan: Number(value.colSpan), rowSpan: Number(value.rowSpan),
			}),
			// Anything that isn't one of the two literals simply drops, like
			// every other field crossing this boundary.
			...(orientation === "vertical" || orientation === "horizontal" ? { orientation } : {}),
		};
	}
	return result;
}

/** Slots as (id, rect) pairs without lying about the key type. */
export function slotsOf(composition: Composition): Array<[SlotId, Slot]> {
	return Object.entries(composition) as Array<[SlotId, Slot]>;
}

/** Project a slot to the plain rect the config overlay stores — the ONE
 *  Slot→SlotRect projection (it was inlined at two call sites before). */
export function toSlotRect(slot: Readonly<Slot>): SlotRect {
	return {
		col: slot.col, row: slot.row, colSpan: slot.colSpan, rowSpan: slot.rowSpan,
		...(slot.orientation === undefined ? {} : { orientation: slot.orientation }),
	};
}

/** A whole composition as the overlay's rect record. */
export function compositionRects(composition: Composition): Record<string, SlotRect> {
	return Object.fromEntries(slotsOf(composition).map(([id, slot]) => [id, toSlotRect(slot)]));
}

/** A custom card's default footprint until its author resizes it. */
const CUSTOM_CARD_SIZE = { colSpan: 156, rowSpan: 40 };

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
