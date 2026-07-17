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

import { createEffect, createSignal, onCleanup } from "solid-js";

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

function readStorage(key: string): string | null {
	if (typeof localStorage === "undefined") return null;
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeStorage(key: string, value: string): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(key, value);
	} catch {
		// Private mode / quota exceeded: the layout just won't survive a reload.
	}
}

function removeStorage(key: string): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.removeItem(key);
	} catch {
		// Private mode / quota exceeded: reset just won't survive a reload either.
	}
}

/** Matches the existing mobile breakpoint used throughout app.css. */
const NARROW_QUERY = "(max-width: 900px)";

function liveColumnCount(): 1 | 2 {
	return typeof window !== "undefined" && window.matchMedia(NARROW_QUERY).matches ? 1 : 2;
}

export interface PanelLayoutController {
	styleFor: (id: string) => Record<string, string>;
	startReorder: (id: string, event: PointerEvent) => void;
	startResize: (id: string, event: PointerEvent) => void;
	reset: () => void;
}

/**
 * Per-view panel layout controller. Call once per view; pass the result to
 * every `<Panel>` in that view. Position/size persist to
 * `localStorage["<storageKey>"]` and survive reload.
 */
export function createPanelLayout(storageKey: string, defaults: PanelDefault[]): PanelLayoutController {
	const [state, setState] = createSignal(mergeLayout(parseStoredLayout(readStorage(storageKey)), defaults));
	const [columns, setColumns] = createSignal(liveColumnCount());

	// Below the mobile breakpoint the grid has only 1 explicit column — an
	// unclamped `grid-column: span 2` there would force an implicit second
	// column and overflow the page. Track the live count so styleFor can clamp
	// what's *applied* without touching the *stored* preference.
	createEffect(() => {
		if (typeof window === "undefined") return;
		const query = window.matchMedia(NARROW_QUERY);
		const onChange = (): void => { setColumns(query.matches ? 1 : 2); };
		query.addEventListener("change", onChange);
		onCleanup(() => query.removeEventListener("change", onChange));
	});

	const persist = (next: PanelLayoutState): void => {
		setState(next);
		writeStorage(storageKey, serializeLayout(next));
	};

	const styleFor = (id: string): Record<string, string> => {
		const s = state()[id];
		if (!s) return {};
		const col = Math.min(s.colSpan, columns());
		return { order: String(s.order), "grid-column": `span ${col}`, "grid-row": `span ${s.rowSpan}` };
	};

	const startReorder = (id: string, event: PointerEvent): void => {
		event.preventDefault();
		const onMove = (moveEvent: PointerEvent): void => {
			const overCard = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)
				?.closest<HTMLElement>("[data-panel-id]");
			const overId = overCard?.dataset.panelId;
			if (overId === undefined || overId === id) return;
			const current = state();
			const a = current[id];
			const b = current[overId];
			if (!a || !b) return;
			persist({ ...current, [id]: { ...a, order: b.order }, [overId]: { ...b, order: a.order } });
		};
		const onUp = (): void => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	};

	const startResize = (id: string, event: PointerEvent): void => {
		event.preventDefault();
		event.stopPropagation();
		const card = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-panel-id]");
		const grid = card?.closest<HTMLElement>(".grid");
		const start = state()[id];
		if (!card || !grid || !start) return;
		const cardRect = card.getBoundingClientRect();
		const gridRect = grid.getBoundingClientRect();
		const gapPx = 14; // matches .grid { gap: 14px } in app.css
		const colWidthPx = (gridRect.width - gapPx) / 2;
		const rowHeightPx = cardRect.height;
		const originX = event.clientX;
		const originY = event.clientY;

		const onMove = (moveEvent: PointerEvent): void => {
			const current = state();
			const s = current[id];
			if (!s) return;
			persist({
				...current,
				[id]: {
					...s,
					colSpan: colSpanForDelta(start.colSpan, moveEvent.clientX - originX, colWidthPx),
					rowSpan: rowSpanForDelta(start.rowSpan, moveEvent.clientY - originY, rowHeightPx),
				},
			});
		};
		const onUp = (): void => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	};

	const reset = (): void => {
		removeStorage(storageKey);
		setState(defaultLayout(defaults));
	};

	return { styleFor, startReorder, startResize, reset };
}
