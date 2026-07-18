/**
 * 48-column collision-based grid canvas: panels sit at explicit
 * (col, row, colSpan, rowSpan) and never move or resize except by direct
 * drag — a move is rejected outright if it would collide or run off-grid,
 * a resize stops dead at the first collision or boundary, and nothing
 * else on the canvas ever shifts as a side effect. Pure logic here (no
 * DOM, no Solid) so it's testable without a browser and a corrupt/blocked
 * store can never break a view's layout — see
 * docs/superpowers/specs/2026-07-17-grid-canvas-design.md.
 */

import { createSignal } from "solid-js";
import {
	type Orientation, type OrientationState,
	parseOrientationState, serializeOrientationState, toggledOrientation,
} from "./panelOrientation.ts";

export const GRID_COLS = 48;
export const ROW_UNIT_PX = 24;
export const GAP_PX = 6;

export interface PanelRect {
	col: number;
	row: number;
	colSpan: number;
	rowSpan: number;
}

export type CanvasState = Record<string, PanelRect>;

export interface PanelDefault extends PanelRect {
	id: string;
}

function safeNum(n: number, fallback: number): number {
	return Number.isFinite(n) ? n : fallback;
}

/** Clamp a rect into valid, in-bounds values. Never throws, never returns
 *  NaN/Infinity — a corrupted stored value just becomes a safe 1x1 at 0,0. */
export function clampRect(rect: PanelRect): PanelRect {
	const colSpan = Math.max(1, Math.min(GRID_COLS, Math.round(safeNum(rect.colSpan, 1))));
	const col = Math.max(0, Math.min(GRID_COLS - colSpan, Math.round(safeNum(rect.col, 0))));
	const rowSpan = Math.max(1, Math.round(safeNum(rect.rowSpan, 1)));
	const row = Math.max(0, Math.round(safeNum(rect.row, 0)));
	return { col, row, colSpan, rowSpan };
}

export function rectsOverlap(a: PanelRect, b: PanelRect): boolean {
	return a.col < b.col + b.colSpan && b.col < a.col + a.colSpan
		&& a.row < b.row + b.rowSpan && b.row < a.row + a.rowSpan;
}

export function collidesWithAny(state: CanvasState, id: string, rect: PanelRect): boolean {
	for (const [otherId, otherRect] of Object.entries(state)) {
		if (otherId === id) continue;
		if (rectsOverlap(rect, otherRect)) return true;
	}
	return false;
}

export function hasCollisions(state: CanvasState): boolean {
	const ids = Object.keys(state);
	for (let i = 0; i < ids.length; i++) {
		for (let j = i + 1; j < ids.length; j++) {
			if (rectsOverlap(state[ids[i]!]!, state[ids[j]!]!)) return true;
		}
	}
	return false;
}

export function inBounds(rect: PanelRect): boolean {
	return rect.col >= 0 && rect.col + rect.colSpan <= GRID_COLS && rect.row >= 0;
}

/** Returns the candidate rect if the move is valid, else null (reject —
 *  caller leaves the panel exactly where it started). Never displaces
 *  anything else. */
export function tryMove(state: CanvasState, id: string, candidateCol: number, candidateRow: number): PanelRect | null {
	const current = state[id];
	if (!current) return null;
	const col = Math.round(safeNum(candidateCol, current.col));
	const row = Math.round(safeNum(candidateRow, current.row));
	if (row < 0) return null;
	const candidate: PanelRect = { col, row, colSpan: current.colSpan, rowSpan: current.rowSpan };
	if (!inBounds(candidate)) return null;
	if (collidesWithAny(state, id, candidate)) return null;
	return candidate;
}

/**
 * Grows colSpan/rowSpan toward the desired size, one cell at a time,
 * stopping at the first collision or grid boundary in that direction —
 * independently per axis, each measured against the panel's ORIGINAL
 * other dimension (a diagonal drag doesn't compound). Shrinking is
 * always safe (a smaller rect can't newly collide) and never blocked.
 */
export function tryResize(state: CanvasState, id: string, desiredColSpan: number, desiredRowSpan: number): PanelRect {
	const current = state[id];
	if (!current) return clampRect({ col: 0, row: 0, colSpan: 1, rowSpan: 1 });
	const blockedByOthers = (rect: PanelRect): boolean => collidesWithAny(state, id, rect);

	let colSpan = Math.max(1, current.colSpan);
	const targetCol = Math.max(1, Math.round(safeNum(desiredColSpan, current.colSpan)));
	if (targetCol < colSpan) {
		colSpan = targetCol;
	} else {
		while (colSpan < targetCol) {
			const next = { ...current, colSpan: colSpan + 1 };
			if (!inBounds(next) || blockedByOthers(next)) break;
			colSpan += 1;
		}
	}

	let rowSpan = Math.max(1, current.rowSpan);
	const targetRow = Math.max(1, Math.round(safeNum(desiredRowSpan, current.rowSpan)));
	if (targetRow < rowSpan) {
		rowSpan = targetRow;
	} else {
		while (rowSpan < targetRow) {
			const next = { ...current, rowSpan: rowSpan + 1 };
			if (blockedByOthers(next)) break;
			rowSpan += 1;
		}
	}

	return clampRect({ col: current.col, row: current.row, colSpan, rowSpan });
}

/** A view's coded layout: every default clamped into valid bounds. */
export function defaultCanvas(defaults: PanelDefault[]): CanvasState {
	const state: CanvasState = {};
	for (const d of defaults) {
		state[d.id] = clampRect({ col: d.col, row: d.row, colSpan: d.colSpan, rowSpan: d.rowSpan });
	}
	return state;
}

function isPanelRect(value: unknown): value is PanelRect {
	return typeof value === "object" && value !== null
		&& typeof (value as PanelRect).col === "number"
		&& typeof (value as PanelRect).row === "number"
		&& typeof (value as PanelRect).colSpan === "number"
		&& typeof (value as PanelRect).rowSpan === "number";
}

/** Bump whenever a stored canvas needs a one-time migration to stay valid
 *  under a new grid shape (see migrateLegacyDoubleWidth below). */
const CANVAS_FORMAT_VERSION = 2;

interface StoredCanvasEnvelope {
	v: number;
	state: unknown;
}

function isEnvelope(value: unknown): value is StoredCanvasEnvelope {
	return typeof value === "object" && value !== null && "v" in value && "state" in value;
}

/**
 * One-time migration for canvases saved before GRID_COLS doubled (24 -> 48):
 * every stored col/colSpan was chosen against the old, wider-celled grid, so
 * doubling both lands each panel in the same visual spot at the new, finer
 * resolution. Only the legacy unwrapped shape (no version envelope) is
 * migrated — anything already carrying the current envelope is left as-is.
 */
function migrateLegacyDoubleWidth(value: unknown): unknown {
	if (typeof value !== "object" || value === null) return value;
	const out: Record<string, unknown> = {};
	for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
		out[id] = isPanelRect(entry) ? { ...entry, col: entry.col * 2, colSpan: entry.colSpan * 2 } : entry;
	}
	return out;
}

/** Tolerant parse: anything unexpected yields null, never a throw. Applies
 *  migrateLegacyDoubleWidth to anything not already carrying the current
 *  version envelope. */
export function parseStoredCanvas(raw: string | null): unknown {
	if (raw === null || raw === "") return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (isEnvelope(parsed) && parsed.v === CANVAS_FORMAT_VERSION) return parsed.state;
	return migrateLegacyDoubleWidth(parsed);
}

export function serializeCanvas(state: CanvasState): string {
	return JSON.stringify({ v: CANVAS_FORMAT_VERSION, state } satisfies StoredCanvasEnvelope);
}

/**
 * Reconcile parsed storage against a view's current panel defaults. A
 * known id keeps its stored rect (clamped); a default id missing from
 * storage (a panel added since the last save) gets its own coded
 * default — unlike the old order-based system, there's no "append after
 * the highest known order" step, because position is absolute, not
 * relative. A stored id no longer in defaults is dropped. If the merged
 * result collides anywhere, the WHOLE stored layout is discarded in
 * favor of defaults — never a partial repair of just the offending pair.
 */
export function mergeCanvas(stored: unknown, defaults: PanelDefault[]): CanvasState {
	const fallback = defaultCanvas(defaults);
	if (typeof stored !== "object" || stored === null) return fallback;
	const storedRecord = stored as Record<string, unknown>;
	const result: CanvasState = {};
	for (const d of defaults) {
		const entry = storedRecord[d.id];
		result[d.id] = isPanelRect(entry) ? clampRect(entry) : fallback[d.id]!;
	}
	return hasCollisions(result) ? fallback : result;
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

export interface PanelCanvasController {
	styleFor: (id: string) => Record<string, string>;
	startMove: (id: string, event: PointerEvent) => void;
	startResize: (id: string, event: PointerEvent) => void;
	reset: () => void;
	/** Content layout direction for a panel that opts into the toggle
	 *  (Panel's orientationToggle prop) — "vertical" for anything never set. */
	orientationFor: (id: string) => Orientation;
	toggleOrientation: (id: string) => void;
}

/**
 * Per-view grid canvas controller. Call once per view; pass the result to
 * every <Panel> in it. Position/size persist to
 * localStorage["<storageKey>"] and survive reload.
 *
 * `isActive`, when given, excludes currently-not-rendered panels (e.g. a
 * `<Show>`-gated Camera or Fans panel, or Jobs' conditional Active-job/
 * Job-details cards) from collision checks during move/resize — their
 * position is still tracked in state so they reappear where they were
 * once shown again, but an invisible panel can't block a visible one from
 * moving into the space it would otherwise occupy.
 */
export function createPanelCanvas(storageKey: string, defaults: PanelDefault[], isActive?: (id: string) => boolean): PanelCanvasController {
	const [state, setState] = createSignal(mergeCanvas(parseStoredCanvas(readStorage(storageKey)), defaults));

	const orientationStorageKey = `${storageKey}.orientation`;
	const [orientationState, setOrientationState] = createSignal(parseOrientationState(readStorage(orientationStorageKey)));

	const persist = (next: CanvasState): void => {
		setState(next);
		writeStorage(storageKey, serializeCanvas(next));
	};

	const orientationFor = (id: string): Orientation => orientationState()[id] ?? "vertical";

	const toggleOrientation = (id: string): void => {
		const next: OrientationState = { ...orientationState(), [id]: toggledOrientation(orientationFor(id)) };
		setOrientationState(next);
		writeStorage(orientationStorageKey, serializeOrientationState(next));
	};

	/** state(), minus any currently-inactive panel other than the one being dragged/resized. */
	const collidableState = (selfId: string): CanvasState => {
		if (!isActive) return state();
		const filtered: CanvasState = {};
		for (const [pid, rect] of Object.entries(state())) {
			if (pid === selfId || isActive(pid)) filtered[pid] = rect;
		}
		return filtered;
	};

	const styleFor = (id: string): Record<string, string> => {
		const r = state()[id];
		if (!r) return {};
		return {
			"grid-column": `${r.col + 1} / span ${r.colSpan}`,
			"grid-row": `${r.row + 1} / span ${r.rowSpan}`,
		};
	};

	const cellSize = (canvasEl: HTMLElement): { colWidthPx: number; rowHeightPx: number } => {
		const width = canvasEl.getBoundingClientRect().width;
		const colWidthPx = (width - (GRID_COLS - 1) * GAP_PX) / GRID_COLS;
		return { colWidthPx, rowHeightPx: ROW_UNIT_PX };
	};

	const startMove = (id: string, event: PointerEvent): void => {
		const grip = event.currentTarget as HTMLElement;
		const canvasEl = grip.closest<HTMLElement>(".panel-canvas");
		const start = state()[id];
		if (!canvasEl || !start) return;
		event.preventDefault();
		const { colWidthPx, rowHeightPx } = cellSize(canvasEl);
		const originX = event.clientX;
		const originY = event.clientY;
		const originScrollY = window.scrollY;
		let pointerX = event.clientX;
		let pointerY = event.clientY;
		let lastValid = start;

		// A move only ever commits a fully-valid candidate, so a run of
		// rejected candidates (dragging toward a spot that's currently
		// blocked, before the path clears) never grows the grid — but
		// auto-scroll can only scroll as far as the page is already tall.
		// This spacer reserves scroll room up to wherever the drag is
		// currently reaching, valid or not, so scrolling can keep pace with
		// the drag instead of hitting a wall the moment a candidate is
		// rejected. Purely a scroll aid — invisible, not part of any state,
		// removed the instant the drag ends.
		const spacer = document.createElement("div");
		spacer.style.gridColumn = "1 / span 1";
		spacer.style.visibility = "hidden";
		canvasEl.appendChild(spacer);

		// No programmatic auto-scroll — that turned out too fragile against
		// real pointer jitter (any tiny involuntary movement past the origin
		// while starting a drag near an edge was enough to trigger a runaway
		// scroll). Scrolling the page during a drag is the browser's job:
		// the mouse wheel / trackpad already works while a button is held
		// down, and this rAF loop just keeps recomputing against whatever
		// window.scrollY currently is, every frame, so the panel correctly
		// follows if the user scrolls manually mid-drag — without this code
		// ever touching scroll position itself.
		let raf = 0;
		const tick = (): void => {
			const effectiveY = pointerY + (window.scrollY - originScrollY);
			const deltaCol = Math.round((pointerX - originX) / (colWidthPx + GAP_PX));
			const deltaRow = Math.round((effectiveY - originY) / (rowHeightPx + GAP_PX));
			const reachRow = Math.max(0, start.row + deltaRow) + start.rowSpan;
			spacer.style.gridRow = `${reachRow + 1} / span 1`;

			const candidate = tryMove(collidableState(id), id, start.col + deltaCol, start.row + deltaRow);
			if (candidate) {
				lastValid = candidate;
				setState({ ...state(), [id]: candidate }); // live preview, not yet persisted
			}
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);

		const onMove = (moveEvent: PointerEvent): void => {
			pointerX = moveEvent.clientX;
			pointerY = moveEvent.clientY;
		};
		const onUp = (): void => {
			cancelAnimationFrame(raf);
			spacer.remove();
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			persist({ ...state(), [id]: lastValid });
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	};

	const startResize = (id: string, event: PointerEvent): void => {
		const grip = event.currentTarget as HTMLElement;
		const canvasEl = grip.closest<HTMLElement>(".panel-canvas");
		const start = state()[id];
		if (!canvasEl || !start) return;
		event.preventDefault();
		event.stopPropagation();
		const { colWidthPx, rowHeightPx } = cellSize(canvasEl);
		const originX = event.clientX;
		const originY = event.clientY;
		const originScrollY = window.scrollY;
		let pointerX = event.clientX;
		let pointerY = event.clientY;

		// No programmatic auto-scroll — see startMove's comment. Growing
		// taller than the viewport is handled by tryResize's own achieved
		// size being applied every tick (unconditionally, clamped rather than
		// rejected), which already grows the grid in step with the resize;
		// the user scrolls manually if they need to see further down.
		let raf = 0;
		const tick = (): void => {
			const effectiveY = pointerY + (window.scrollY - originScrollY);
			const deltaColSpan = Math.round((pointerX - originX) / (colWidthPx + GAP_PX));
			const deltaRowSpan = Math.round((effectiveY - originY) / (rowHeightPx + GAP_PX));
			const next = tryResize(collidableState(id), id, start.colSpan + deltaColSpan, start.rowSpan + deltaRowSpan);
			setState({ ...state(), [id]: next }); // live preview, persisted only on drop
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);

		const onMove = (moveEvent: PointerEvent): void => {
			pointerX = moveEvent.clientX;
			pointerY = moveEvent.clientY;
		};
		const onUp = (): void => {
			cancelAnimationFrame(raf);
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			persist(state());
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	};

	const reset = (): void => {
		removeStorage(storageKey);
		setState(defaultCanvas(defaults));
		removeStorage(orientationStorageKey);
		setOrientationState({});
	};

	return { styleFor, startMove, startResize, reset, orientationFor, toggleOrientation };
}
