/**
 * 24-column collision-based grid canvas: panels sit at explicit
 * (col, row, colSpan, rowSpan), never displace each other on move or
 * resize, and settle into freed space only after a move commits. Pure
 * logic here (no DOM, no Solid) so it's testable without a browser and a
 * corrupt/blocked store can never break a view's layout — see
 * docs/superpowers/specs/2026-07-17-grid-canvas-design.md.
 */

export const GRID_COLS = 24;
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

/**
 * After a move frees space, pull every panel up then left into it: a
 * single deterministic pass, panels processed in ascending (row, col)
 * order so earlier (higher, more left) panels settle first and form a
 * stable floor/wall for later ones. Never called after a resize.
 */
export function settle(state: CanvasState): CanvasState {
	const ids = Object.keys(state).sort((a, b) => {
		const ra = state[a]!, rb = state[b]!;
		return ra.row - rb.row || ra.col - rb.col;
	});
	const result: CanvasState = {};
	for (const id of ids) {
		let current = state[id]!;
		while (current.row > 0) {
			const candidate = { ...current, row: current.row - 1 };
			if (collidesWithAny(result, id, candidate)) break;
			current = candidate;
		}
		while (current.col > 0) {
			const candidate = { ...current, col: current.col - 1 };
			if (collidesWithAny(result, id, candidate)) break;
			current = candidate;
		}
		result[id] = current;
	}
	return result;
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

/** Tolerant parse: anything unexpected yields null, never a throw. */
export function parseStoredCanvas(raw: string | null): unknown {
	if (raw === null || raw === "") return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export function serializeCanvas(state: CanvasState): string {
	return JSON.stringify(state);
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
