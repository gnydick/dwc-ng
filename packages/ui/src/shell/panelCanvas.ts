/**
 * 48-column collision-based grid canvas: panels sit at explicit
 * (col, row, colSpan, rowSpan) and never move or resize except by direct
 * drag — a move lands on the pointer's cell when it's valid and otherwise
 * SLIDES per axis (a blocked diagonal component stops at the obstacle or
 * edge while the free component keeps tracking), a resize stops dead at
 * the first collision or boundary, and nothing else on the canvas ever
 * shifts as a side effect. Pure logic here (no DOM, no Solid) so it's
 * testable without a browser and a corrupt/blocked store can never break
 * a view's layout — see
 * docs/superpowers/specs/2026-07-17-grid-canvas-design.md.
 */

import { createSignal } from "solid-js";
import {
	type Orientation, type OrientationState,
	parseOrientationState, serializeOrientationState, toggledOrientation,
} from "./panelOrientation.ts";
import { safeEntries } from "../util/safeObject.ts";

export const GRID_COLS = 48;
/**
 * Vertical granularity. Set to the greatest common divisor of the control
 * heights the UI actually draws (every control is a multiple of 4px), so a
 * card can be sized to its content instead of to the nearest coarse row.
 *
 * It used to be 24px with a 6px row gap - a 30px quantum - which meant up to
 * 29px of dead space per card was baked in by construction, no matter how
 * carefully the contents were measured. The row gap is now 0 and the visual
 * separation between stacked cards comes from a margin on the card itself, so
 * the gap no longer contributes to the quantum.
 */
export const ROW_UNIT_PX = 4;
export const ROW_GAP_PX = 0;
/** Horizontal gap only (columns still carry a visible gutter). */
export const GAP_PX = 6;
/** Fixed column width (matches app.css's .panel-canvas grid-template-columns)
 *  — columns don't scale with viewport width, so a card's pixel size only
 *  ever depends on its own colSpan. A narrower window scrolls horizontally
 *  instead of shrinking every card to fit. */
export const COL_UNIT_PX = 46;

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

/**
 * First free position for a rect of the given size: scan rows top-down (4px
 * quantum), columns left-right, return the first spot that fits the grid and
 * overlaps nothing. Total — the grid is unbounded downward, so a fit below
 * everything always exists.
 */
export function findFreePosition(
	occupied: readonly PanelRect[],
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

/**
 * Place `preferred` where it wants to be, but if that spot is taken KEEP THE
 * COLUMN and slide the row DOWN until it fits. Used when a hidden card is
 * shown again: it returns to exactly where it was, or the next open row
 * straight below — never hops to a different column, which is what makes it
 * feel like the card "came back" rather than being re-flowed somewhere new.
 */
export function slideDownToFree(occupied: readonly PanelRect[], preferred: PanelRect): PanelRect {
	const base = clampRect(preferred);
	let row = base.row;
	// Terminates: a row below every occupied rect's bottom is always free.
	for (;;) {
		const candidate = { ...base, row };
		if (!occupied.some(r => rectsOverlap(candidate, r))) return candidate;
		row++;
	}
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
 * Resolve a move drag toward the pointer's target cell — the SOLE
 * resolution route for move drags (Panel grips call it via the
 * controller; tryMove stays the single-candidate validity primitive).
 *
 * Motion is per-axis, one cell at a time, dominant axis first: a diagonal
 * whose horizontal component is blocked (another card, or the grid edge —
 * the target is clamped into bounds first) keeps moving vertically instead
 * of freezing, and a step that frees up mid-drag resumes on the next
 * iteration, so the card slides along and around obstacles. Never
 * displaces anything else, and every landed cell was individually
 * validated — a drag cannot express an overlapping or out-of-bounds rect
 * any more than tryMove could.
 *
 * Null when no movement at all is possible (caller keeps the panel put).
 */
export function resolveMove(state: CanvasState, id: string, targetCol: number, targetRow: number): PanelRect | null {
	const current = state[id];
	if (!current) return null;
	// Clamp the target into the grid: a pointer past an edge means "as far
	// as the grid allows", not "stop moving on both axes".
	const tc = Math.min(Math.max(0, Math.round(safeNum(targetCol, current.col))), GRID_COLS - current.colSpan);
	const tr = Math.max(0, Math.round(safeNum(targetRow, current.row)));
	let col = current.col;
	let row = current.row;
	const stepTo = (nextCol: number, nextRow: number): boolean => {
		const candidate: PanelRect = { col: nextCol, row: nextRow, colSpan: current.colSpan, rowSpan: current.rowSpan };
		if (!inBounds(candidate) || collidesWithAny(state, id, candidate)) return false;
		col = nextCol;
		row = nextRow;
		return true;
	};
	// The pointer's own cell wins outright when it's valid — dragging OVER
	// an obstacle to a free spot beyond it still works (the pre-slide
	// behavior); sliding is only for when the target itself is blocked.
	if (stepTo(tc, tr)) {
		return col === current.col && row === current.row ? null : { col, row, colSpan: current.colSpan, rowSpan: current.rowSpan };
	}
	let moved = true;
	while (moved && (col !== tc || row !== tr)) {
		moved = false;
		// Dominant remaining axis first — the path hugs the pointer's intent.
		const colFirst = Math.abs(tc - col) >= Math.abs(tr - row);
		for (const axis of colFirst ? ["col", "row"] : ["row", "col"]) {
			if (axis === "col" && col !== tc) {
				if (stepTo(col + Math.sign(tc - col), row)) moved = true;
			} else if (axis === "row" && row !== tr) {
				if (stepTo(col, row + Math.sign(tr - row))) moved = true;
			}
		}
	}
	if (col === current.col && row === current.row) return null;
	return { col, row, colSpan: current.colSpan, rowSpan: current.rowSpan };
}


/**
 * How far past the content-fit minimum you must drag before a card will shrink
 * below it, in rows (5 x 4px = 20px of travel).
 */
export const DETENT_BREAKAWAY_ROWS = 5;

/** Carried across frames of a single resize drag. */
export interface DetentState {
	/** True once the operator has pulled past the minimum this drag. */
	broken: boolean;
}

/**
 * A sticky detent at the card's exact content fit.
 *
 * Resizing down, the bottom edge STOPS at the minimum and stays there while
 * the pointer keeps moving — so the exact fit is something you feel, not
 * something you have to see. Pull a further DETENT_BREAKAWAY_ROWS and it
 * releases and keeps shrinking (the content then scrolls, which is allowed —
 * this is a detent, not a wall). A separate HARD floor below it (header + foot
 * + 50%, applied by the caller) is what finally stops the shrink so the
 * grabbers and controls can never overlap.
 *
 * The release is CONTINUOUS: at the moment it breaks away the span is exactly
 * the minimum, and from there it tracks the pointer again with the breakaway
 * distance subtracted. Without that the card would jump by the breakaway
 * amount the instant it let go.
 *
 * Growing back up it re-arms at the same point, so the detent is felt in both
 * directions rather than only on the way down.
 */
export function applyDetent(
	rawSpan: number,
	minSpan: number,
	state: DetentState,
): { span: number; state: DetentState; held: boolean } {
	if (state.broken) {
		const span = rawSpan + DETENT_BREAKAWAY_ROWS;
		// Re-arm on the way back up, at exactly the point it released.
		if (span >= minSpan) return { span: minSpan, state: { broken: false }, held: false };
		return { span, state, held: false };
	}
	if (rawSpan >= minSpan) return { span: rawSpan, state, held: false };
	// Pushed below the content fit but not yet past breakaway: the edge is being
	// HELD at the minimum against the pointer. `held` is true ONLY here — this is
	// the one state that means "you are on the exact fit and it is resisting". It
	// is false at rest (rawSpan >= minSpan) and during a width-only resize (the
	// row span never dips below min then), which is precisely why the visible cue
	// no longer flashes spuriously the way the old at-min border did.
	if (minSpan - rawSpan < DETENT_BREAKAWAY_ROWS) return { span: minSpan, state, held: true };
	return { span: rawSpan + DETENT_BREAKAWAY_ROWS, state: { broken: true }, held: false };
}

/**
 * The smallest rowSpan that still contains a card's content, measured from the
 * live DOM at resize start.
 *
 * NOT body.scrollHeight: scrollHeight is max(box, content), so on a card
 * currently TALLER than its content it reports the BOX — the detent then
 * caught wherever the card happened to be, far below the content, and the
 * true fit was unreachable (live repro: an oversized card measured 80 rows
 * for 34 rows of content). Instead, measure the content itself: the lowest
 * child edge plus its bottom margin (a scroll container includes it),
 * shifted back by scrollTop so a currently-scrolled card (the earlier bug
 * this function was rewritten for) still measures full content — immune to
 * both the box size and the scroll position.
 */
export function contentRowSpan(cardEl: HTMLElement, gutterPx: number): number {
	const body = cardEl.querySelector<HTMLElement>(".panel-body");
	if (!body) return 1;
	const bodyRect = body.getBoundingClientRect();
	let contentBottom = 0;
	for (const child of Array.from(body.children)) {
		const rect = child.getBoundingClientRect();
		const marginBottom = parseFloat(getComputedStyle(child).marginBottom) || 0;
		contentBottom = Math.max(contentBottom, rect.bottom + marginBottom - bodyRect.top + body.scrollTop);
	}
	contentBottom += parseFloat(getComputedStyle(body).paddingBottom) || 0;
	// The card's chrome around the body's content box (borders, outer padding)
	// — measured, not assumed, and size-invariant since card and body grow
	// together. Card border-box height == ROW_UNIT_PX*rowSpan - gutter.
	const chrome = cardEl.getBoundingClientRect().height - body.clientHeight;
	return Math.max(1, Math.ceil((contentBottom + chrome + gutterPx) / ROW_UNIT_PX));
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
const CANVAS_FORMAT_VERSION = 3;

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
	for (const [id, entry] of safeEntries(value as Record<string, unknown>)) {
		out[id] = isPanelRect(entry) ? { ...entry, col: entry.col * 2, colSpan: entry.colSpan * 2 } : entry;
	}
	return out;
}


/**
 * One-time migration for canvases saved against the old 24px row + 6px gap
 * grid (a 30px pitch) now that rows are 4px with no gap.
 *
 * Positions are converted EDGE-WISE - the new top is derived from the old top
 * and the new bottom from the old bottom, with the span taken as the
 * difference - rather than scaling row and rowSpan independently. Scaling them
 * separately would round each to its own nearest cell, and two panels that
 * were exactly adjacent could round into each other, producing the one thing
 * this grid forbids: an overlap. Deriving both edges from the same mapping
 * keeps "B starts where A ends" exactly true.
 */
function migrateRowGranularity(value: unknown): unknown {
	if (typeof value !== "object" || value === null) return value;
	const OLD_PITCH = 30; // 24px row + 6px gap
	const toNewEdge = (oldEdge: number): number => Math.round((oldEdge * OLD_PITCH) / ROW_UNIT_PX);
	const out: Record<string, unknown> = {};
	for (const [id, entry] of safeEntries(value as Record<string, unknown>)) {
		if (!isPanelRect(entry)) {
			out[id] = entry;
			continue;
		}
		const top = toNewEdge(entry.row);
		const bottom = toNewEdge(entry.row + entry.rowSpan);
		out[id] = { ...entry, row: top, rowSpan: Math.max(1, bottom - top) };
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
	// Unversioned = pre-v2: needs the column doubling AND the row regranulation.
	// A v2 envelope only needs the rows.
	if (isEnvelope(parsed) && parsed.v === 2) return migrateRowGranularity(parsed.state);
	return migrateRowGranularity(migrateLegacyDoubleWidth(parsed));
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
 * relative. A stored id no longer in defaults is dropped.
 *
 * Stored rects are NEVER discarded for overlapping each other (the old
 * "collision = corruption, reset everything" verdict): a hidden card
 * (visibleWhen false) releases its grid cells precisely so visible cards
 * can be resized into that space, which stores a legal overlap — the
 * mount-time discard then silently erased the user's whole layout on
 * every reload ("card sizes not remembered"). Overlap among VISIBLE
 * cards is prevented where it can be: at drag time, against the live
 * collidable state; a visibility flip that reveals an overlap is the
 * operator's to rearrange, exactly as it already was at runtime.
 */
/**
 * A CanvasState from untrusted parsed storage, WITHOUT a defaults list — for
 * the parked (hidden-card) store, whose ids are exactly the ones not in the
 * composition. Keeps only entries that are valid rects; anything else drops.
 */
export function sanitizeCanvas(stored: unknown): CanvasState {
	const out: CanvasState = {};
	if (typeof stored !== "object" || stored === null) return out;
	for (const [id, rect] of Object.entries(stored as Record<string, unknown>)) {
		if (isPanelRect(rect)) out[id] = clampRect(rect);
	}
	return out;
}

export function mergeCanvas(stored: unknown, defaults: PanelDefault[]): CanvasState {
	const fallback = defaultCanvas(defaults);
	if (typeof stored !== "object" || stored === null) return fallback;
	const storedRecord = stored as Record<string, unknown>;
	const result: CanvasState = {};
	for (const d of defaults) {
		const entry = storedRecord[d.id];
		result[d.id] = isPanelRect(entry) ? clampRect(entry) : fallback[d.id]!;
	}
	return result;
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
	/** Ids currently tracked (reactive). */
	slotIds: () => string[];
	/** Adopt a slot added after mount (composition editing) at the given rect;
	 *  no-op if already tracked. Persists like a drop. */
	ensureSlot: (id: string, rect: PanelRect) => void;
	/** Forget a slot removed after mount. Persists like a drop. */
	removeSlot: (id: string) => void;
	/**
	 * Rebuild the layout wholesale from `rects` — the live half of an import.
	 * Distinct from ensureSlot/removeSlot, which evolve the CURRENT layout one
	 * card at a time: this one says "that layout is gone, here is a different
	 * one", which is the operation an import performs and the one that was
	 * missing.
	 */
	adoptLayout: (rects: CanvasState) => void;
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

	// Where hidden cards' rects go so a hide→show round-trip restores the spot.
	// Persisted (same format as the canvas) so it survives a reload while the
	// card is off the screen — a hidden card is not in the composition, so
	// nothing else remembers where it was.
	const parkedKey = `${storageKey}.parked`;
	const [parked, setParked] = createSignal<CanvasState>(sanitizeCanvas(parseStoredCanvas(readStorage(parkedKey))));
	const persistParked = (next: CanvasState): void => {
		setParked(next);
		writeStorage(parkedKey, serializeCanvas(next));
	};

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

	const slotIds = (): string[] => Object.keys(state());

	const ensureSlot = (id: string, rect: PanelRect): void => {
		if (state()[id] !== undefined) return;
		const occupied = Object.values(collidableState(id));
		const remembered = parked()[id];
		let placed: PanelRect;
		if (remembered !== undefined) {
			// Shown again after a hide: return it to where it was. If that spot is
			// now taken, slide it straight down (same column) to the next opening —
			// don't scatter it to the first free cell somewhere else.
			placed = slideDownToFree(occupied, remembered);
			const nextParked = { ...parked() };
			delete nextParked[id];
			persistParked(nextParked);
		} else {
			// A card with no remembered spot (first placement). Adoption obeys the
			// same collision contract as a drag (audit H6): the requested rect may
			// overlap LIVE geometry (composition and canvas tiers diverge after
			// drags), and persisting an overlap would make the next mount's
			// collision check discard the user's entire stored layout. Overlapping
			// rects get the first free spot instead.
			const wanted = clampRect(rect);
			placed = occupied.some(r => rectsOverlap(wanted, r))
				? { ...wanted, ...findFreePosition(occupied, wanted) }
				: wanted;
		}
		persist({ ...state(), [id]: placed });
	};

	const removeSlot = (id: string): void => {
		const rect = state()[id];
		if (rect === undefined) return;
		// Remember the spot BEFORE dropping it, so showing the card again can put
		// it back. This is what fixes the "hiding a card forgets its position" bug.
		persistParked({ ...parked(), [id]: rect });
		const next = { ...state() };
		delete next[id];
		persist(next);
	};

	const startMove = (id: string, event: PointerEvent): void => {
		const grip = event.currentTarget as HTMLElement;
		const canvasEl = grip.closest<HTMLElement>(".panel-canvas");
		const start = state()[id];
		if (!canvasEl || !start) return;
		event.preventDefault();
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
			const deltaCol = Math.round((pointerX - originX) / (COL_UNIT_PX + GAP_PX));
			const deltaRow = Math.round((effectiveY - originY) / (ROW_UNIT_PX + ROW_GAP_PX));
			const reachRow = Math.max(0, start.row + deltaRow) + start.rowSpan;
			spacer.style.gridRow = `${reachRow + 1} / span 1`;

			// resolveMove slides per axis: a blocked component stops at the
			// obstacle (or edge) while the free component keeps tracking the
			// pointer — a diagonal never freezes the whole card.
			const candidate = resolveMove(collidableState(id), id, start.col + deltaCol, start.row + deltaRow);
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
		const originX = event.clientX;
		const originY = event.clientY;
		const originScrollY = window.scrollY;
		// The canvas scrolls INSIDE .view-scroll, not the document, so
		// window.scrollY alone is always 0 and compensates for nothing. Track the
		// real scroll container too, or a card can never be grown past the
		// viewport: the pointer runs out of screen and scrolling goes unnoticed.
		const scroller = canvasEl.closest<HTMLElement>(".view-scroll");
		const originScrollTop = scroller?.scrollTop ?? 0;

		// Two independent limits, both measured once at the start of the drag:
		//
		//  • detentMin — the CONTENT-FIT height. The bottom edge snaps here (the
		//    gold cue) and holds against the pointer until you pull past the
		//    breakaway, then releases and the body scrolls. A felt "exact fit",
		//    not a wall.
		//  • hardFloor — the header + resize-grip foot, plus 50% of that
		//    (operator's spec). The absolute smallest the card may ever get, so
		//    the grabbers and controls can never overlap. This is a WALL: no
		//    breakaway. It sits BELOW the detent — you only meet it after the
		//    detent has released and the content has scrolled away.
		const cardEl = grip.closest<HTMLElement>(".card");
		const gutterPx = cardEl ? parseFloat(getComputedStyle(cardEl).marginBottom || "0") : 0;
		const headPx = cardEl?.querySelector<HTMLElement>(".card-head")?.getBoundingClientRect().height ?? 0;
		const footPx = cardEl?.querySelector<HTMLElement>(".panel-resize-grip")?.getBoundingClientRect().height ?? 0;
		const floorPx = (headPx + footPx) * 1.5;
		const hardFloor = Math.max(1, Math.ceil((floorPx + gutterPx) / ROW_UNIT_PX));
		// The detent never sits below the wall — a snap point you can't reach is
		// pointless, and it keeps the gold cue honest on tiny-content cards.
		const contentMin = cardEl ? contentRowSpan(cardEl, gutterPx) : 1;
		const detentMin = Math.max(contentMin, hardFloor);
		let detent: DetentState = { broken: false };
		let pointerX = event.clientX;
		let pointerY = event.clientY;

		// Auto-scroll while the pointer sits near the container's bottom/right
		// edge. Without it "drag to resize" is capped by the window: you cannot
		// move the pointer below the screen, so a card that already fills the
		// viewport can never be made taller. Only engages at the edge, so an
		// ordinary resize is unaffected.
		const EDGE_PX = 36;
		const EDGE_STEP_PX = 18;
		let raf = 0;
		const tick = (): void => {
			if (scroller) {
				const box = scroller.getBoundingClientRect();
				if (pointerY > box.bottom - EDGE_PX) scroller.scrollTop += EDGE_STEP_PX;
				if (pointerX > box.right - EDGE_PX) scroller.scrollLeft += EDGE_STEP_PX;
			}
			const scrolled = (window.scrollY - originScrollY)
				+ ((scroller?.scrollTop ?? 0) - originScrollTop);
			const effectiveY = pointerY + scrolled;
			const deltaColSpan = Math.round((pointerX - originX) / (COL_UNIT_PX + GAP_PX));
			const deltaRowSpan = Math.round((effectiveY - originY) / (ROW_UNIT_PX + ROW_GAP_PX));
			// Detent at the content fit (snaps, then breaks away), THEN the hard
			// floor clamps whatever the detent produced so a released card still
			// can't shrink past the wall. The gold cue lights only while the
			// detent is actively holding — never for a width-only resize.
			const rawRowSpan = start.rowSpan + deltaRowSpan;
			const detented = applyDetent(rawRowSpan, detentMin, detent);
			detent = detented.state;
			const clampedRowSpan = Math.max(hardFloor, detented.span);
			cardEl?.classList.toggle("at-detent", detented.held);
			const next = tryResize(collidableState(id), id, start.colSpan + deltaColSpan, clampedRowSpan);
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
			cardEl?.classList.remove("at-detent");
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
		// Reset is "back to the default layout" — remembered hidden spots are
		// part of the deviation it clears.
		removeStorage(parkedKey);
		setParked({});
	};

	// Storage is rewritten by replaceScreenLayout; this updates the state
	// already in memory, because importing the screen you are LOOKING at does
	// not change the route and so never remounts.
	const adoptLayout = (rects: CanvasState): void => {
		persist(sanitizeCanvas(rects));
		persistParked({});
		setOrientationState({});
		removeStorage(orientationStorageKey);
	};

	return { styleFor, startMove, startResize, reset, orientationFor, toggleOrientation, slotIds, ensureSlot, removeSlot, adoptLayout };
}

/**
 * Read a canvas's persisted state without a controller (the SD-capture path:
 * Save-to-machine snapshots every screen's current local geometry into the
 * config overlay). Same parse + migrations the controller uses; null when
 * nothing (usable) is stored.
 */
/**
 * The canvas storage key for a screen. ONE definition — it was being built
 * from the same template at two call sites, which is the duplication that
 * lets the two copies of a layout drift apart in the first place.
 */
export const canvasStorageKey = (screenId: string): string => `dwc-ng.canvas.${screenId}`;

/**
 * Overwrite a screen's remembered geometry, mounted or not.
 *
 * NOT for general use — reach for replaceScreenLayout (compose/screens.ts),
 * which writes this AND the config overlay together. A layout written to only
 * one of the two stores is the bug this exists to prevent.
 */
export function writeCanvasState(storageKey: string, rects: CanvasState): void {
	writeStorage(storageKey, serializeCanvas(sanitizeCanvas(rects)));
	removeStorage(`${storageKey}.parked`);
	removeStorage(`${storageKey}.orientation`);
}

export function readCanvasState(storageKey: string): CanvasState | null {
	const parsed = parseStoredCanvas(readStorage(storageKey));
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
	const out: CanvasState = {};
	for (const [id, rect] of safeEntries(parsed as Record<string, unknown>)) {
		if (isPanelRect(rect)) out[id] = clampRect(rect);
	}
	return Object.keys(out).length > 0 ? out : null;
}
