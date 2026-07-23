/**
 * Card definitions — the data half of the registry, and the source of CardId.
 *
 * Design: docs/composable-cards-design.md. Invariants owned here:
 *  - I1  `CardId = keyof typeof CARD_DEFS`: an unregistered id is a compile
 *        error in code; runtime strings pass parseCardId() or cease to exist.
 *  - I3  `visibleWhen` is the ONE visibility predicate — ComposedView derives
 *        BOTH the JSX mount and the canvas isActive cell-release from it.
 *  - I4  `size` is THE natural geometry; screens only place cards.
 *
 * Bodies (JSX) live in ./cards.tsx as a Record<CardId, body> — the compiler
 * makes the two halves total over each other in both directions: a def
 * without a body, or a body without a def, is a type error, not a review
 * item. Kept apart so this module stays pure and node-testable (type
 * stripping cannot load JSX).
 */
import type { CardCtx } from "./ctx.ts";

export interface CardSize {
	colSpan: number;
	rowSpan: number;
}

export interface CardMeta {
	title: string;
	ariaLabel: string;
	/** What powers the card (OM path, G-code, endpoint) — the CardTip text. */
	tip?: string;
	class?: string;
	orientationToggle?: boolean;
	/** THE natural geometry (I4). */
	size: CardSize;
	/** THE visibility predicate (I3). Absent = always visible. */
	visibleWhen?: (ctx: CardCtx) => boolean;
}

/** Identity constructor — the single throat future cross-field rules live in. */
function defineCard(meta: CardMeta): CardMeta {
	return meta;
}

/**
 * The registry's data half. Entries land here as views convert (design
 * phases A2–A6); the starting entry proves the mechanism end to end.
 */
export const CARD_DEFS = {
	/** Per-object cancel (M486) — already content-only, zero props. */
	"build-objects": defineCard({
		title: "Objects",
		ariaLabel: "Objects",
		tip: "M486 · job.build",
		size: { colSpan: 12, rowSpan: 53 },
		visibleWhen: ctx => (ctx.om.om.job.build?.objects.length ?? 0) > 0,
	}),
} as const satisfies Record<string, CardMeta>;

/** I1: the only card identity that exists past a boundary. */
export type CardId = keyof typeof CARD_DEFS;

const CARD_IDS = Object.keys(CARD_DEFS) as CardId[];

export function allCardIds(): readonly CardId[] {
	return CARD_IDS;
}

/**
 * Parse, don't validate: a runtime string (storage, import, URL) becomes a
 * CardId here or nowhere. Unknown ids yield null — callers drop the slot
 * tolerantly, never the screen.
 */
export function parseCardId(raw: string): CardId | null {
	return (CARD_IDS as string[]).includes(raw) ? (raw as CardId) : null;
}
