/**
 * Per-view panel layout: order + grid-span for the cards inside a view's
 * `.grid`, persisted per browser (workspace preference, not machine config —
 * same reasoning as the console/camera tile placement in floatingTile.ts).
 *
 * This file's pure logic (merge/clamp/persist math) is separated from the
 * reactive primitive (createPanelLayout, added in a later task) so it's
 * testable without a DOM and so a corrupt/blocked store can never break a
 * view's grid.
 */

export interface PanelDefault {
	id: string;
	/** Columns to span by default (this is a 2-column grid). Default 1. */
	colSpan?: number;
	/** Rows to span by default. Default 1. */
	rowSpan?: number;
}

export interface PanelSpanState {
	order: number;
	colSpan: number;
	rowSpan: number;
}

export type PanelLayoutState = Record<string, PanelSpanState>;

export const MAX_COL_SPAN = 2;
export const MAX_ROW_SPAN = 4;

/** Clamp to [1, max], rounding fractional drags to whole steps. Never throws
 *  and never returns NaN/Infinity — a corrupted stored value just becomes 1. */
export function clampSpan(value: number, max: number): number {
	if (!Number.isFinite(value)) return 1;
	return Math.min(Math.max(1, Math.round(value)), max);
}

/** A view's coded layout: order = array index, spans from PanelDefault. */
export function defaultLayout(defaults: PanelDefault[]): PanelLayoutState {
	const state: PanelLayoutState = {};
	defaults.forEach((d, index) => {
		state[d.id] = {
			order: index,
			colSpan: clampSpan(d.colSpan ?? 1, MAX_COL_SPAN),
			rowSpan: clampSpan(d.rowSpan ?? 1, MAX_ROW_SPAN),
		};
	});
	return state;
}

/** Tolerant parse: anything unexpected yields null, never a throw. */
export function parseStoredLayout(raw: string | null): unknown {
	if (raw === null || raw === "") return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export function serializeLayout(state: PanelLayoutState): string {
	return JSON.stringify(state);
}

function isSpanState(value: unknown): value is PanelSpanState {
	return typeof value === "object" && value !== null
		&& typeof (value as PanelSpanState).order === "number"
		&& typeof (value as PanelSpanState).colSpan === "number"
		&& typeof (value as PanelSpanState).rowSpan === "number";
}

/**
 * Reconcile parsed storage against the view's current panel defaults:
 * - A default id present in storage keeps its stored order/span, clamped.
 * - A default id missing from storage (a panel added since the last save)
 *   gets its own default span, appended after every currently-known order.
 * - A stored id no longer in defaults (a panel removed from the view) is
 *   dropped silently.
 * Malformed/wrong-shape storage falls back to defaultLayout entirely.
 */
export function mergeLayout(stored: unknown, defaults: PanelDefault[]): PanelLayoutState {
	const fallback = defaultLayout(defaults);
	if (typeof stored !== "object" || stored === null) return fallback;
	const storedRecord = stored as Record<string, unknown>;

	let nextOrder = 0;
	for (const d of defaults) {
		const entry = storedRecord[d.id];
		if (isSpanState(entry)) nextOrder = Math.max(nextOrder, entry.order + 1);
	}

	const result: PanelLayoutState = {};
	for (const d of defaults) {
		const entry = storedRecord[d.id];
		if (isSpanState(entry)) {
			result[d.id] = {
				order: entry.order,
				colSpan: clampSpan(entry.colSpan, MAX_COL_SPAN),
				rowSpan: clampSpan(entry.rowSpan, MAX_ROW_SPAN),
			};
		} else {
			result[d.id] = { ...fallback[d.id]!, order: nextOrder };
			nextOrder += 1;
		}
	}
	return result;
}

/** Pixel delta -> column-span steps, snapping once a drag passes half a
 *  column's width. A not-yet-measured (zero/negative) column width never
 *  divides by zero — it just returns the clamped starting span. */
export function colSpanForDelta(startSpan: number, deltaPx: number, colWidthPx: number): number {
	if (!(colWidthPx > 0)) return clampSpan(startSpan, MAX_COL_SPAN);
	return clampSpan(startSpan + Math.round(deltaPx / colWidthPx), MAX_COL_SPAN);
}

/** Same as colSpanForDelta, for row-span steps against a row-height unit. */
export function rowSpanForDelta(startSpan: number, deltaPx: number, rowHeightPx: number): number {
	if (!(rowHeightPx > 0)) return clampSpan(startSpan, MAX_ROW_SPAN);
	return clampSpan(startSpan + Math.round(deltaPx / rowHeightPx), MAX_ROW_SPAN);
}
