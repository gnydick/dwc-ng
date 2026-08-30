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

import { createSignal, onCleanup } from "solid-js";
import {
	type Orientation, type OrientationState,
	parseOrientationState, serializeOrientationState, toggledOrientation,
} from "./panelOrientation.ts";
import { safeEntries } from "@dwc-ng/connector";
import type { MachineKeyName, MachineStore } from "../config/machineStore.ts";

/**
 * Horizontal granularity, and the same argument the rows already won.
 *
 * A column used to be 46px wide with a 6px gutter — a 52px quantum — so a card
 * could carry up to 51px of dead width that no amount of careful measuring
 * could remove: the next size down cut 52px, which was into the controls.
 * Measured 2026-07-29 on the Tools card: 35px wasted, one snap narrower would
 * have clipped the mode keys.
 *
 * Columns are now 4px with no gap, exactly like rows, and the gutter moved off
 * the grid onto the card (see .panel-canvas > * in app.css). 624 = 48 × 13,
 * and the old pitch was 13 × 4, so every previously stored layout maps onto
 * the new grid by multiplying by 13 — an EXACT mapping, no rounding, so no
 * pair of adjacent cards can round into each other.
 */
export const GRID_COLS = 624;
/** Old-grid columns to new. Exact: the old 52px pitch is 13 new 4px cells. */
export const COL_GRANULARITY_FACTOR = 13;
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

/**
 * How many PIXELS one stored grid cell renders as, on BOTH axes, at the
 * current UI scale.
 *
 * ROW_UNIT_PX / COL_UNIT_PX above are the unit stored geometry is WRITTEN
 * IN — a card's rowSpan/colSpan, the sizes in compose/defs.ts, the
 * row-granularity migration. That number is frozen: it defines the saved
 * format, and a format whose meaning depends on a display preference is not
 * a format.
 *
 * This is the unit geometry is DRAWN IN, and it tracks the scale (--u, see
 * shell/scale.ts). A card's box used to follow scale on neither axis while
 * its contents scaled inside it — measured on the Control screen, the cards'
 * content fell away from the bottom edge because only the CONTENT scaled
 * while the box stayed put. Scaling the DRAWN unit instead means the stored
 * layout is never touched and every card's box scales along with its
 * contents, on both axes at once.
 *
 * The value lives in index.css beside the other scale tokens, so the
 * stylesheet stays the single authority on what a scale step IS (see
 * shell/scale.ts) and this cannot drift from the spacing it has to match.
 *
 * There is one rate for both axes and no compromise to make: every
 * layout-space length in the UI is now n × --u (test/unit-lengths.test.ts),
 * so nothing shrinks relative to anything else and there is no
 * least-shrinking card to be conservative about.
 */
export function unitPx(): number {
	if (typeof document === "undefined") return ROW_UNIT_PX;
	const raw = getComputedStyle(document.documentElement).getPropertyValue("--u");
	const px = parseFloat(raw);
	// A stylesheet that hasn't loaded, or a scale block missing the token, must
	// fall back to the stored unit rather than to NaN — which would silently
	// collapse every card to a single row.
	return Number.isFinite(px) && px > 0 ? px : ROW_UNIT_PX;
}
/** Both gutters now live on the card, not on the grid — see GRID_COLS. */
export const GAP_PX = 0;
/**
 * The stored-format column unit — same role as ROW_UNIT_PX, just the other
 * axis: a card's colSpan, the sizes in compose/defs.ts and the
 * col-granularity migration are all written in this unit, and it is frozen
 * for the same reason ROW_UNIT_PX is. It does NOT track viewport width — a
 * card's cell size only ever depends on its own colSpan; a narrower window
 * scrolls horizontally instead of shrinking every card to fit. What it DOES
 * track is drawn through unitPx() at scale 1, same as rows (see PanelCanvas.tsx).
 *
 * NOTHING DRAWS FROM IT. Since PanelCanvas.tsx emits `repeat(GRID_COLS,
 * var(--u))`, this constant has no runtime consumer at all — it is
 * documentation of the stored format, and the assertion in test/scale.test.ts
 * that it equals ROW_UNIT_PX (and the default --u) is what keeps that
 * documentation true. Kept rather than deleted because the saved format's
 * column unit is a real fact that deserves a name; do not reach for it as if
 * it were a drawing metric.
 *
 * @invariant grid-metrics-single-source
 * @rung 7  generated, not mirrored — PanelCanvas.tsx emits
 *          `repeat(${GRID_COLS}, var(--u))` and `grid-auto-rows: var(--u)`,
 *          so the stylesheet has no column or row figures of its own to
 *          disagree with. app.css declares only `display: grid`
 * @why the geometry engine computes spans in cells while the browser lays them
 *      out in pixels. When those were two facts, a card's computed position and
 *      its painted position could differ by a whole column with nothing failing
 *      — and the arithmetic looks right in both places
 */
export const COL_UNIT_PX = 4;

export interface PanelRect {
	col: number;
	row: number;
	colSpan: number;
	rowSpan: number;
}

export type CanvasState = Record<string, PanelRect>;

export interface PanelDefault extends PanelRect {
	id: string;
	/** From the composition. Seeds a browser that has none stored yet. */
	orientation?: Orientation;
	/**
	 * A floor for a card whose CONTENT CAN BE ABSENT.
	 *
	 * Every card's minimum is measured from what it draws, uniformly. That rule
	 * breaks for the handful whose body has an empty state: the Printing card
	 * with no job renders one line and a button, so its measured minimum
	 * collapses to 48 columns — drag it small while idle and it cannot hold the
	 * print when one starts. The measurement is not wrong, it is measuring a
	 * card that is temporarily nearly empty.
	 *
	 * So those cards declare what they need when FULL, and the stop is the
	 * larger of the two. Cards whose content is always present declare nothing
	 * and are governed entirely by measurement — one rule, with a floor that
	 * defaults to none.
	 *
	 * In stored row/column units, like every other span here, which makes it
	 * scale-correct for free: the drawn unit shrinks with the UI scale (see
	 * unitPx), so a span floor is physically smaller at a smaller scale —
	 * exactly as the full content it stands in for would be.
	 */
	minColSpan?: number;
	minRowSpan?: number;
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

/**
 * `exclude` is the panel (or panels) the candidate rect BELONGS to, so they do
 * not collide with themselves. A set rather than a single id because a group
 * move carries several rects at once: every member has to be excluded for all
 * of them, or the second card tested would collide with where the first one
 * still is.
 *
 * Deliberately one function taking both shapes instead of a `collidesWithAll`
 * beside it. A second collision routine is a second definition of "overlap",
 * and the group path would be the one that drifted — it is the one with no
 * years of use behind it.
 */
export function collidesWithAny(
	state: CanvasState,
	exclude: string | ReadonlySet<string>,
	rect: PanelRect,
): boolean {
	const excluded = typeof exclude === "string" ? null : exclude;
	for (const [otherId, otherRect] of safeEntries(state)) {
		if (excluded === null ? otherId === exclude : excluded.has(otherId)) continue;
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
 * Move SEVERAL panels rigidly by one shared delta — "pick up these three and
 * put them there".
 *
 * Rigid is the whole contract: every member shifts by the same (dCol, dRow), so
 * their positions relative to each other are identical before and after. Two
 * consequences fall out of that and are worth stating, because they are why
 * this is short:
 *
 *   · Members can never collide with EACH OTHER. They did not overlap at the
 *     start and a common translation preserves that, so only non-members need
 *     testing — which is exactly what passing the whole selection to
 *     collidesWithAny expresses.
 *   · The group either lands or it does not. There is no partial move where two
 *     cards travel and the third stays: that would silently rearrange the very
 *     relationship the operator selected them to preserve.
 *
 * Steps one cell at a time toward the target, dominant axis first, like
 * resolveMove — so a group dragged into a wall slides along it instead of
 * freezing, and the blocked axis stops while the free one keeps tracking. A
 * step is taken only if EVERY member's candidate is legal.
 *
 * Null when the group cannot move at all; otherwise a patch of just the moved
 * panels, ready to spread over the state.
 */
export function resolveGroupMove(
	state: CanvasState,
	ids: readonly string[],
	targetDeltaCol: number,
	targetDeltaRow: number,
): CanvasState | null {
	const members = ids.filter(id => state[id] !== undefined);
	if (members.length === 0) return null;
	if (members.length === 1) {
		const only = state[members[0]!]!;
		const moved = resolveMove(state, members[0]!, only.col + targetDeltaCol, only.row + targetDeltaRow);
		return moved === null ? null : { [members[0]!]: moved };
	}

	const selection = new Set(members);
	const rects = members.map(id => ({ id, rect: state[id]! }));

	// Clamp the delta so the whole group stays on the grid: the leftmost member
	// bounds how far left it can go, the rightmost how far right. Clamping the
	// GROUP rather than each card is what keeps the formation rigid at an edge —
	// per-card clamping would squash them together against the wall.
	const minCol = Math.min(...rects.map(r => r.rect.col));
	const maxRight = Math.max(...rects.map(r => r.rect.col + r.rect.colSpan));
	const minRow = Math.min(...rects.map(r => r.rect.row));
	const wantCol = Math.round(safeNum(targetDeltaCol, 0));
	const wantRow = Math.round(safeNum(targetDeltaRow, 0));
	const tc = Math.min(Math.max(wantCol, -minCol), GRID_COLS - maxRight);
	const tr = Math.max(wantRow, -minRow);

	let dc = 0;
	let dr = 0;
	const stepTo = (nextCol: number, nextRow: number): boolean => {
		for (const { rect } of rects) {
			const candidate: PanelRect = {
				col: rect.col + nextCol, row: rect.row + nextRow,
				colSpan: rect.colSpan, rowSpan: rect.rowSpan,
			};
			if (!inBounds(candidate)) return false;
			if (collidesWithAny(state, selection, candidate)) return false;
		}
		dc = nextCol;
		dr = nextRow;
		return true;
	};

	// The pointer's own offset wins outright when it is legal — dragging a group
	// OVER an obstacle onto free space beyond it works, same as one card.
	if (!stepTo(tc, tr)) {
		let moved = true;
		while (moved && (dc !== tc || dr !== tr)) {
			moved = false;
			const dCol = Math.abs(tc - dc);
			const dRow = Math.abs(tr - dr);
			const colFirst = dCol >= dRow;
			if (colFirst && dc !== tc && stepTo(dc + Math.sign(tc - dc), dr)) moved = true;
			else if (dr !== tr && stepTo(dc, dr + Math.sign(tr - dr))) moved = true;
			else if (colFirst && dc !== tc && stepTo(dc + Math.sign(tc - dc), dr)) moved = true;
			else if (dc !== tc && stepTo(dc + Math.sign(tc - dc), dr)) moved = true;
		}
	}

	if (dc === 0 && dr === 0) return null;
	const patch: CanvasState = {};
	for (const { id, rect } of rects) {
		patch[id] = { col: rect.col + dc, row: rect.row + dr, colSpan: rect.colSpan, rowSpan: rect.rowSpan };
	}
	return patch;
}


/**
 * The content fit is a WALL, not a detent (operator's call, 2026-07-29).
 *
 * It used to hold at the minimum and then release if you pulled a further five
 * cells, on the reasoning that a card allowed to scroll its own content is
 * harmless. In practice the release is the whole problem: the card you were
 * sizing suddenly gave way and swallowed its own controls, and the only way to
 * find the fit again was to overshoot and creep back. A stop that cannot be
 * pulled through means the edge you are dragging always lands on a size that
 * shows everything.
 *
 * Stateless by construction — there is no "have I broken away yet" to carry
 * across frames, which is what made the old version need a state object and a
 * continuity correction on release.
 *
 * `atLimit` is true exactly while the pointer is asking for less than the
 * minimum: the edge is standing still under a moving finger, which is what the
 * gold outline reports. False at rest, and false on an axis that isn't being
 * pushed — so a width-only drag never lights it for the height.
 */
export function clampToStop(rawSpan: number, minSpan: number): { span: number; atLimit: boolean } {
	if (rawSpan >= minSpan) return { span: rawSpan, atLimit: false };
	return { span: minSpan, atLimit: true };
}

/** The grip's height expressed in units, NOT measured off the element.
 *  `.panel-resize-grip` is a deliberately non-scaling 16px pointer target
 *  (`px-ok` in app.css), so measuring it puts a constant into a floor that is
 *  otherwise all `u` — and the floor then lands on a different number of
 *  stored cells at every scale. 4u is 16px at the default unit, so the stop
 *  is unchanged at scale 1 and now genuinely invariant across steps. */
const GRIP_U = 4;

/**
 * The chrome floor for a vertical resize, in STORED GRID CELLS: the header
 * plus the resize-grip foot plus 50% (operator's spec), plus the card's own
 * bottom gutter, divided by the drawn unit.
 *
 * That gutter term is 1u as of GIT_170 (`--sp-card-gutter`, index.css), down
 * from 2u and briefly 0. The parameter is what makes those three edits cost
 * nothing here: callers do not assume the value, they read it back off the
 * element (`getComputedStyle(cardEl).marginBottom`), so there is exactly one
 * place the gutter is stated and this arithmetic follows it wherever it goes.
 * Hard-coding today's number here would be the second copy, and the one that
 * goes stale silently.
 *
 * Pure and exported so the arithmetic can be checked without a DOM. THE
 * point of it: every term is either a measured length that scales with `u`
 * (the header) or a multiple of `u` itself, so the quotient — and therefore
 * the stop in cells — is the same number at every scale step.
 *
 * NOT a separate @invariant declaration: this is the resize stop's half of
 * `dev/card-floor-scale-invariant` (dev/layoutAudit.ts), which already states
 * the property and carries its own debt. What is new here is the enforcement
 * — test/panel-canvas.test.ts drives this at three units with proportional
 * headers and asserts ONE cell count, plus a source-text guard that
 * startResize does not reintroduce a `.panel-resize-grip` measurement.
 */
export function resizeHardFloor(headPx: number, unit: number, gutterPx: number): number {
	const floorPx = (headPx + GRIP_U * unit) * 1.5;
	return Math.max(1, Math.ceil((floorPx + gutterPx) / unit));
}

/** How near a scroll container's edge the pointer must be before a resize
 *  drag starts scrolling for it. */
export const EDGE_ZONE_PX = 36;
/**
 * The most one frame of edge-scrolling may move, at the very edge.
 *
 * 2.5px, down from a flat 18px. The old number was not merely fast, it was the
 * engine of a runaway: the scroll offset it produced is an INPUT to the size
 * the same loop computes, so scrolling grew the card, a taller card made a
 * taller canvas, and a taller canvas left room to scroll again — about
 * 1080 px/s at 60fps with nothing bounding it (reported 2026-08-04, "resizing
 * 1000-2000 pixels in < 1 second").
 *
 * Halved again from 5px on the operator's call after driving it on the machine
 * (2026-08-05: "works much better, but make it about half the speed"). The rate
 * is a feel judgement and belongs to whoever uses it; what code can hold is that
 * it stays a bounded one, which test/resize-edge-scroll.test.ts pins as a budget.
 */
export const EDGE_MAX_STEP_PX = 2.5;

/**
 * Pixels to auto-scroll this frame, RAMPED by how far the pointer has pushed
 * past the zone boundary — zero at the boundary itself, the full step only at
 * the very edge.
 *
 * The ramp is the part that matters, not the smaller constant. A flat step
 * fires at full speed the instant the pointer enters the zone, which is why the
 * move drag deleted its own auto-scroll outright ("any tiny involuntary
 * movement past the origin while starting a drag near an edge was enough to
 * trigger a runaway scroll" — see startMove). Ramping means resting near the
 * edge does nothing at all and the operator has to keep pushing to keep
 * scrolling, so the gesture stays theirs to stop.
 *
 * Clamped at both ends: a pointer dragged off the screen reports coordinates
 * past the edge, and an unclamped depth would hand back an ever-larger step —
 * the runaway again, wearing the fix's clothes.
 */
export function edgeScrollStep(
	pointer: number,
	edge: number,
	zonePx: number = EDGE_ZONE_PX,
	maxStepPx: number = EDGE_MAX_STEP_PX,
): number {
	if (!Number.isFinite(pointer) || !Number.isFinite(edge) || !(zonePx > 0)) return 0;
	const depth = (pointer - (edge - zonePx)) / zonePx;
	return Math.min(1, Math.max(0, depth)) * maxStepPx;
}

/**
 * The signed scroll for one axis: positive toward the end (down / right),
 * negative toward the start (up / left).
 *
 * Both directions are needed and only one was built. Auto-scroll existed to let
 * a card GROW past the viewport, so it watched the bottom and right edges only —
 * which left shrinking with no way to reach past the screen at all, and after
 * the reservation froze the scroll frame that was the whole of it: the card
 * "just shrinks as far as the mouse can reach" (reported 2026-08-05). Dragging
 * up to shrink has exactly the same problem dragging down to grow does, and now
 * the same answer.
 *
 * The backward direction is the forward ramp MIRRORED — the axis negated rather
 * than a second ramp written out — so the two cannot drift apart, and a change
 * to the feel of one is a change to the feel of both. Subtracting instead of
 * branching also keeps it continuous on a scroller narrower than two zones,
 * where both ends are in range at once: they cancel toward the middle rather
 * than one arbitrarily winning.
 *
 * Bounded without needing to say so: the browser clamps scrollTop at 0, so
 * shrinking runs out of scroll at the top of the canvas and simply stops.
 */
export function axisScrollStep(
	pointer: number,
	start: number,
	end: number,
	zonePx: number = EDGE_ZONE_PX,
	maxStepPx: number = EDGE_MAX_STEP_PX,
): number {
	return edgeScrollStep(pointer, end, zonePx, maxStepPx)
		- edgeScrollStep(-pointer, -start, zonePx, maxStepPx);
}

/**
 * The lowest grid row a drag has reached SO FAR — monotonic, and that is the
 * entire point.
 *
 * A resize reads the container's scroll offset to convert the pointer into a
 * size, and the browser clamps scrollTop to `scrollHeight - clientHeight`. So
 * shrinking a tall card shortens the canvas, the clamp yanks the scroll
 * position down by exactly the height just lost, and that displacement arrives
 * back at the next frame as MORE shrink. It compounds rather than accumulating:
 * measured 2026-08-05, dropping a card 800px pulled scrollTop 1700 -> 900, so
 * the card collapsed to its stop in a few frames (reported the same day, "when
 * shrinking the card back into the page it exhibits the same super fast
 * behavior").
 *
 * Holding a hidden spacer at the reach keeps the canvas from ever getting
 * SHORTER mid-drag, which leaves the clamp nothing to do: same measurement with
 * the spacer in place, scrollTop 1704 -> 1704. startMove has carried one for the
 * same reason since it was written; the resize path never got one.
 *
 * Never decreases, so the reservation cannot be walked back by a frame that
 * shrank — which is what makes the scroll frame stable for the whole gesture
 * rather than only while growing.
 */
export function reservedReach(previous: number, rect: PanelRect): number {
	const bottom = rect.row + rect.rowSpan;
	return Number.isFinite(bottom) ? Math.max(previous, bottom) : previous;
}

/**
 * How many rows the canvas must keep to leave the CURRENT view untouched —
 * the scroll position already on screen, expressed in grid rows.
 *
 * This is what a drag's reservation recedes TO when the pointer comes up,
 * rather than being removed outright. Removing it lets the canvas snap back to
 * the real content height, and the browser then clamps scrollTop to fit, which
 * slides the whole view by exactly the distance from the pointer to the bottom
 * of the viewport — measured 2026-08-05 at 20px, 148px and 260px for a pointer
 * 20, 150 and 260px above a 300px viewport's bottom. Holding this many rows
 * instead moves nothing at all: 0px in all three cases.
 *
 * The result is phantom space and must not outlive its purpose, so the caller
 * drops it as soon as scrolling makes it redundant — by which time it is below
 * the fold, and its removal is invisible.
 */
export function scrollFloorRows(scrollTop: number, clientHeight: number, unitPx: number): number {
	const px = scrollTop + clientHeight;
	if (!Number.isFinite(px) || !(unitPx > 0)) return 0;
	return Math.max(0, Math.ceil(px / unitPx));
}

/**
 * WHICH of the body's children a floor is computed over.
 *
 * Two named questions rather than a caller-supplied predicate, because there
 * are exactly two and a third would be a mistake: "how tall is this card's
 * content" (the resize stop) and "how tall would this card be with NO content"
 * (the audit's body-in-floor check, which subtracts the second from the first).
 *
 * It is a parameter of contentRowSpan rather than something a caller arranges
 * beforehand, and that is the whole point. The audit used to empty the body by
 * setting `display: none` on every non-header child and calling this function
 * again — which does not work, because `display: none` leaves `flex-grow` and
 * `min-height` untouched in computed style and those two ARE the inputs this
 * function uses for a slack-absorbing child. The hidden child kept contributing
 * its declared floor, the subtraction came out zero, and every card that
 * correctly DECLARES its minimum was reported as ignoring its own body
 * (verified 2026-07-31: temperatures at min-height 150/400/20px reported
 * 65/154/18 rows and "IGNORES BODY" at all three).
 *
 * Selecting the children inside the one loop that knows how to weigh a child
 * means the caller cannot get that wrong: there is no second place where "what
 * counts as content" is written down.
 */
export type FloorContent = "as-rendered" | "header-only";

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
export function contentRowSpan(
	cardEl: HTMLElement,
	gutterPx: number,
	content: FloorContent = "as-rendered",
): number {
	const body = cardEl.querySelector<HTMLElement>(".panel-body");
	if (!body) return 1;
	// SUMMED, not taken from the lowest child's offset. Offsets are where things
	// sit RIGHT NOW, so a filler child that is currently 189px tall pushes every
	// sibling below it down by 189 and the card measures its own height back as
	// its minimum — even with that child's own height correctly counted as zero.
	// The console proved it: history counted 0, and the card still reported
	// rowStop 75 against a span of 75, so it could not be dragged shorter at all.
	// Stacking the children's own heights asks the right question — "how tall is
	// this content" — instead of "where does it currently end".
	let contentBottom = 0;
	// How many children the gap term below spans. Incremented for every child
	// the CONTENT FILTER admits and BEFORE the out-of-flow skip below, which is
	// deliberate on both counts: "as-rendered" therefore still counts exactly
	// body.children.length, as the old `children.length - 1` did, so this
	// parameter cannot quietly change the resize stop of a card with an
	// absolutely-positioned child (the toolpath canvas is one); and an emptied
	// body counts its single header and so spans no gaps at all.
	let counted = 0;
	for (const child of Array.from(body.children)) {
		// The audit's "with the body emptied" measurement. `.card-head` is the
		// header by the same selector headerColSpan uses, so "the header" means
		// one thing in both directions.
		if (content === "header-only" && !child.classList.contains("card-head")) continue;
		counted++;
		const rect = child.getBoundingClientRect();
		const style = getComputedStyle(child);
		// Absolutely positioned children are out of the flow and contribute
		// nothing to a stack's height (the toolpath canvas is one).
		if (style.position === "absolute" || style.position === "fixed") continue;
		// A child that ABSORBS SLACK draws whatever height it is handed, so its
		// rendered height is not a minimum — its declared min-height is. Without
		// this a filler child hands the card its own current height back as a
		// floor: the toolpath viewport measured a rowStop of 180 against a span
		// of 180, because its canvas is sized from the element being measured.
		const grows = (parseFloat(style.flexGrow) || 0) > 0;
		const floor = parseFloat(style.minHeight);
		const height = grows ? (Number.isFinite(floor) ? floor : 0) : rect.height;
		// Margins are summed UNCONDITIONALLY, and that is only safe because no
		// direct child of a body can carry a vertical `auto` one.
		//
		// getComputedStyle resolves `margin: auto` to its USED value — the card's
		// own free space — so when the card header carried `margin-bottom: auto`
		// to push contents to the bottom, this loop added 333px of the sensors
		// card's slack to the sensors card's own minimum. The reported minimum
		// then equalled the card's current height and cards grew but would not
		// shrink back (reported 2026-07-30). A `--absorbs-slack: 1` marker beside
		// the margin bought that back by hand.
		//
		// #128 deleted the margin instead: card content is anchored to the TOP and
		// slack accumulates below it, so there is no auto margin here to discount
		// and the marker went with it (app.css, "card contents sit at the TOP").
		// test/panel-anchoring.test.ts fails the suite if one is written back,
		// which is what makes the unconditional sum above correct rather than
		// merely currently true.
		contentBottom += height
			+ (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
	}
	const bodyStyle = getComputedStyle(body);
	// The gaps a flex/grid body puts BETWEEN its children are part of the stack.
	const rowGap = parseFloat(bodyStyle.rowGap);
	const spans = Math.max(0, counted - 1);
	if (Number.isFinite(rowGap)) contentBottom += rowGap * spans;
	contentBottom += (parseFloat(bodyStyle.paddingTop) || 0) + (parseFloat(bodyStyle.paddingBottom) || 0);
	// The card's chrome around the body's content box (borders, outer padding)
	// — measured, not assumed, and size-invariant since card and body grow
	// together. Card border-box height == unitPx()*rowSpan - gutter.
	//
	// unitPx(), not the constant: this converts MEASURED PIXELS into stored
	// row units, and how many pixels a unit draws as depends on the scale. With
	// the constant, a fit measured at a smaller scale would come back too large
	// and the resize stop would refuse to let the card near its own content.
	const chrome = cardEl.getBoundingClientRect().height - body.clientHeight;
	return Math.max(1, Math.ceil((contentBottom + chrome + gutterPx) / unitPx()));
}

/**
 * An element's intrinsic width in px, at the given sizing keyword.
 *
 * Not clientWidth or scrollWidth. Both report the BOX on an element wider than
 * its contents, which is the normal case for a card you are about to make
 * narrower: the stop would then catch at whatever width the card already had,
 * and the true fit would be unreachable. This asks the layout engine the
 * question directly.
 *
 * Synchronous — set, read, restore inside one call, with no yield in between,
 * so the browser never paints the intermediate size. It does force a reflow,
 * which is why it is called ONCE at the start of a drag and never per frame.
 */
function intrinsicWidthPx(el: HTMLElement, sizing: "min-content" | "max-content"): number {
	const previous = el.style.width;
	el.style.width = sizing;
	const width = el.getBoundingClientRect().width;
	el.style.width = previous;
	return width;
}

/**
 * The smallest colSpan that still contains a card's content — the horizontal
 * twin of contentRowSpan, and the width the stop holds at.
 *
 * MIN-content, not max-content. Max-content is the width at which nothing has
 * to wrap, which is not a limit at all for prose: the Chart colours card
 * measured 1026px that way against a true minimum of 302px, so its stop sat
 * miles wide of anything real and the card simply refused to be narrowed.
 * Min-content is the actual wall — the narrowest the contents can be without
 * overflowing — and it still protects the controls, because a fixed-width
 * button or input contributes its full width to min-content while a sentence
 * contributes only its longest word.
 *
 * Honest only insofar as the content is honest: a control with `min-width: 0`
 * (a select, an ellipsising name) will happily report that it can be a few
 * pixels wide. Such controls carry an explicit min-width in app.css for
 * exactly this reason — the number this returns is only ever as meaningful as
 * the narrowest legible width the contents are willing to declare.
 */
export function contentColSpan(cardEl: HTMLElement, gutterPx: number): number {
	const body = cardEl.querySelector<HTMLElement>(".panel-body");
	if (!body) return 1;
	// Chrome around the body's content box (borders, the card's own padding),
	// measured rather than assumed — card and body widen together.
	const chrome = cardEl.getBoundingClientRect().width - body.clientWidth;
	return Math.max(1, Math.ceil((intrinsicWidthPx(body, "min-content") + chrome + gutterPx) / unitPx()));
}

/**
 * The narrowest a card may EVER be: its own header laid out without clipping.
 * A wall, not a detent — below this the title and its tip start disappearing,
 * which is chrome loss rather than content scrolling, and no amount of pulling
 * should be able to do it.
 */
export function headerColSpan(cardEl: HTMLElement, gutterPx: number): number {
	const head = cardEl.querySelector<HTMLElement>(".card-head");
	if (!head) return 1;
	const chrome = cardEl.getBoundingClientRect().width - head.clientWidth;
	// MIN-content here too. The header is one nowrap line, so the two usually
	// agree — but a long title would otherwise set a floor no card could be
	// narrowed past, and a title is the one thing that may ellipsise.
	return Math.max(1, Math.ceil((intrinsicWidthPx(head, "min-content") + chrome + gutterPx) / unitPx()));
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
const CANVAS_FORMAT_VERSION = 4;

interface StoredCanvasEnvelope {
	v: number;
	state: unknown;
	/**
	 * The overlay layout this record was last reconciled against — see
	 * {@link layoutBasis}. Absent on every record written before #87, which is
	 * exactly what "this copy has never been reconciled" looks like.
	 */
	basis?: string;
	/** The operator RESET this canvas. See {@link readStoredCanvasRecord}. */
	cleared?: true;
	/**
	 * The ids whose SPAN an operator gesture set — see
	 * {@link StoredCanvasRecord.sized}. Absent on every record written before
	 * #132, which is exactly what "nothing here is known to be the operator's"
	 * looks like.
	 */
	sized?: string[];
}

/** A stored canvas as the construction path needs to read it: the geometry,
 *  plus the two facts about the record itself that decide whether it wins. */
export interface StoredCanvasRecord {
	/** Parsed and migrated geometry, or null when nothing was ever written. */
	state: unknown;
	basis: string | null;
	cleared: boolean;
	/**
	 * The ids whose SPAN this browser's OPERATOR set, by a gesture.
	 *
	 * The fact `growToDefaults` needed and did not have (#132). Its own doc
	 * said so: "stored spans carry no record of who set them, so the two cases
	 * are indistinguishable here". A span the operator deliberately shrank and
	 * a fossil of an older release's coded default were byte-identical, so the
	 * merge had to pick one rule for both — and picking "stored wins" left
	 * `shaping-status` at the 102 it had before #128 raised the coded floor to
	 * 116, drawing 452 px of body into a 400 px box.
	 *
	 * EMPTY, never absent, for a record that predates the field: "no proof an
	 * operator sized this" is the correct reading of a record that could not
	 * have carried the proof, and it is what makes those spans grow once.
	 */
	sized: ReadonlySet<string>;
}

/**
 * A digest of the layout the CARD holds for a screen — the thing a browser's
 * canvas can be stale against.
 *
 * @invariant a-stored-canvas-carries-what-it-was-reconciled-against
 * @rung 6  choke-point — every write of the "layout" key goes through
 *          `serializeCanvas`, which takes the basis as a REQUIRED argument
 *          rather than defaulting it, so a canvas cannot be persisted without
 *          saying which saved layout it was built from. Not rung 7: the
 *          argument is a plain string a caller could compute from the wrong
 *          seed; test/canvas-provenance.test.ts pins the call sites
 * @why the canvas record and the config overlay hold the same fact with no
 *      ordering between them, so "which is right" was decided by whichever
 *      path ran first. A browser carrying rects from before someone else
 *      saved a new layout to this machine kept them, and its next Save
 *      uploaded them over the good copy (#87). The basis is what turns
 *      "probably the same" into a question with an answer
 * @why-not-a-counter a content digest needs no second field in the overlay to
 *      keep in step, and cannot drift from what it describes: it IS the
 *      layout, projected. A generation counter is a second writer's
 *      opportunity to be wrong
 * @limit `null` (no saved layout at all) is deliberately NOT the digest of an
 *      empty layout — "the card has nothing for this screen" and "the card
 *      says this screen is empty" are different, and only the first means
 *      there is nothing for a local copy to be stale against
 */
export function layoutBasis(seed: CanvasState | null): string {
	if (seed === null) return "none";
	const parts = Object.keys(seed).sort().map(id => {
		const r = seed[id]!;
		return `${id}:${r.col},${r.row},${r.colSpan},${r.rowSpan}`;
	});
	return parts.length === 0 ? "empty" : parts.join("|");
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

/**
 * One-time migration for canvases saved against the old 46px column + 6px gap
 * grid (a 52px pitch) now that columns are 4px with no gap.
 *
 * Unlike the row regranulation this needs no edge-wise care: 52 is exactly 13
 * new cells, so col and colSpan can be scaled independently and adjacency
 * survives by arithmetic — "B starts where A ends" stays true because
 * 13(a + s) == 13a + 13s with no rounding anywhere.
 */
export function migrateColGranularity(value: unknown): unknown {
	if (typeof value !== "object" || value === null) return value;
	const out: Record<string, unknown> = {};
	for (const [id, entry] of safeEntries(value as Record<string, unknown>)) {
		out[id] = isPanelRect(entry)
			? {
				...entry,
				col: entry.col * COL_GRANULARITY_FACTOR,
				colSpan: entry.colSpan * COL_GRANULARITY_FACTOR,
			}
			: entry;
	}
	return out;
}

/** Tolerant parse: anything unexpected yields null, never a throw. Older
 *  envelopes fall through the migrations they still owe, newest last. */
export function parseStoredCanvas(raw: string | null): unknown {
	if (raw === null || raw === "") return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (isEnvelope(parsed) && parsed.v === CANVAS_FORMAT_VERSION) return parsed.state;
	// Each older version owes every migration introduced after it, in order.
	if (isEnvelope(parsed) && parsed.v === 3) return migrateColGranularity(parsed.state);
	if (isEnvelope(parsed) && parsed.v === 2) return migrateColGranularity(migrateRowGranularity(parsed.state));
	// Unversioned = pre-v2: owes the column doubling and both regranulations.
	return migrateColGranularity(migrateRowGranularity(migrateLegacyDoubleWidth(parsed)));
}

/**
 * `basis` is REQUIRED, not defaulted: a canvas written without saying which
 * saved layout it was reconciled against is precisely the record #87 could not
 * judge, and making it omittable would let the next writer recreate one.
 *
 * `sized` is REQUIRED for exactly the same reason one layer down (#132). A
 * canvas written without saying which of its spans an operator chose is the
 * record `growToDefaults` could not judge, and a default of "none" or "all"
 * would be a guess baked into every future write. Sorted so a re-serialised
 * record is byte-stable.
 */
export function serializeCanvas(
	state: CanvasState,
	basis: string,
	sized: ReadonlySet<string>,
	cleared?: true,
): string {
	return JSON.stringify({
		v: CANVAS_FORMAT_VERSION, state, basis,
		...(cleared === true ? { cleared } : {}),
		sized: [...sized].sort(),
	} satisfies StoredCanvasEnvelope);
}

/**
 * The stored record, geometry and provenance together.
 *
 * `cleared` is a POSITIVE fact and that is the whole point of it: `reset()`
 * used to remove the key, so a deliberately cleared canvas was byte-identical
 * to a browser that had never opened the screen — and the seed-from-overlay
 * path then undid the reset on the next mount (#87 requirement 2). The same
 * move as #86's tombstones, one layer down.
 */
/** The parked-spots record. Same envelope, no basis: parked rects describe
 *  cards that are OFF the screen, so they are not a copy of the layout and
 *  cannot be stale against the card's copy of one. */
export function serializeParked(state: CanvasState): string {
	return JSON.stringify({ v: CANVAS_FORMAT_VERSION, state } satisfies StoredCanvasEnvelope);
}

export function readStoredCanvasRecord(raw: string | null): StoredCanvasRecord {
	const state = parseStoredCanvas(raw);
	let basis: string | null = null;
	let cleared = false;
	const sized = new Set<string>();
	if (raw !== null && raw !== "") {
		try {
			const parsed: unknown = JSON.parse(raw);
			if (isEnvelope(parsed)) {
				const e = parsed as StoredCanvasEnvelope;
				if (typeof e.basis === "string") basis = e.basis;
				cleared = e.cleared === true;
				// Element-checked, not merely Array.isArray'd: this comes off
				// localStorage, and a non-string leaking into the set would make
				// `sized.has(id)` answer a question about a value nobody wrote.
				if (Array.isArray(e.sized)) {
					for (const id of e.sized) if (typeof id === "string") sized.add(id);
				}
			}
		} catch {
			// Same tolerance as parseStoredCanvas: unreadable storage is
			// "nothing was written here", never a throw out of a mount.
		}
	}
	return { state, basis, cleared, sized };
}

/**
 * Reconcile parsed storage against a view's current panel defaults. A
 * known id keeps its stored rect (clamped); a default id missing from
 * storage (a panel added since the last save) gets its own coded
 * default — unlike the old order-based system, there's no "append after
 * the highest known order" step, because position is absolute, not
 * relative. A stored id no longer in defaults is dropped.
 *
 * A stored rect whose SPAN the composition has since grown, AND WHICH NO
 * OPERATOR GESTURE SET, adopts the larger span (growToDefaults) and the cards
 * it now overlaps are pushed clear (reflow) — otherwise a card redesigned to
 * be taller stays at its old height on every browser that has ever laid the
 * screen out, and its new content renders below the fold with no way out but
 * Reset Layout. Observed 2026-07-24: position 95 -> 103 and active-job 40 -> 46
 * changed nothing on a machine with a stored canvas.
 *
 * The "no operator gesture set it" half is #132 and is load-bearing: between
 * 2026-07-30 and #132 this paragraph described intent the code did not
 * implement. The Math.max was deleted, `grew` was never assigned true, and
 * `return grew ? reflow(state) : state` below was a constant. Gabe found the
 * hole on his Shaping screen — the one screen with no saved SD layout, so the
 * one where nothing else reconciled the fossil. If this paragraph and
 * growToDefaults disagree again, growToDefaults is the answer.
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
	// safeEntries, not Object.entries: `stored` is JSON.parse output from
	// localStorage, which creates "__proto__" as an OWN property, and `out[id] =`
	// on that key runs the prototype SETTER instead of adding an entry.
	// Measured 2026-08-01 with the raw walk: a stored {"__proto__":{col,row,
	// colSpan,rowSpan}} left sanitizeCanvas returning an object whose prototype
	// was the attacker's, while Object.keys showed nothing amiss.
	for (const [id, rect] of safeEntries(stored as Record<string, unknown>)) {
		if (isPanelRect(rect)) out[id] = clampRect(rect);
	}
	return out;
}

/**
 * Adopt any span the composition has GROWN since this browser last stored a
 * layout, per axis, without moving anything.
 *
 * Grow-only by decision (spec D1): position is never touched, and a span the
 * user enlarged past the coded default is kept, so an ordinary load changes
 * nothing.
 *
 * WHO SET THE SPAN decides which rule applies (#132). `sized` names the ids an
 * operator gesture sized in this browser, or that reached it as a layout the
 * operator saved to the card; those win outright, in BOTH directions, which is
 * what keeps the 2026-07-30 fix alive (shrink a card, reload, and it stays
 * shrunk — see the paragraph in the loop below). Every other stored span is a
 * fossil of whatever the coded default was when this browser last laid the
 * screen out, and is raised to the current one per axis.
 *
 * The one-time cost, chosen deliberately: records written before this field
 * existed carry no marks, so a card the operator really had shrunk grows back
 * ONCE and must be dragged down again — after which it is marked and sticks.
 * The alternative failure is a card that clips its own content on a
 * machine-control surface with no way out but Reset Layout, and between a card
 * that is slightly too tall and a card that hides what it draws, the too-tall
 * one is the one an operator can undo by dragging.
 *
 * `grew` reports whether any span actually increased. It is the gate that
 * decides whether a reflow may run at all, and it is deliberately FALSE for a
 * card falling back to its coded default (never stored, or stored corrupt):
 * that is placement, not growth, and adding a card to a screen must not
 * rearrange the cards already on it.
 */
export function growToDefaults(
	stored: unknown,
	defaults: PanelDefault[],
	/**
	 * REQUIRED, like `serializeCanvas`'s: the ids whose span the operator set.
	 * Not defaulted, because both defaults are wrong — "none" grows spans the
	 * operator chose, "all" preserves fossils — and a caller that has not
	 * thought about which set it holds is the caller this parameter exists to
	 * stop. `readStoredCanvasRecord` produces it; nothing else may invent one.
	 */
	sized: ReadonlySet<string>,
): { state: CanvasState; grew: boolean } {
	const fallback = defaultCanvas(defaults);
	const record = typeof stored === "object" && stored !== null
		? stored as Record<string, unknown>
		: {};
	const state: CanvasState = {};
	let grew = false;
	// Ids the composition has GAINED since this canvas was saved. Their coded
	// position was chosen against the CODED layout, not against whatever this
	// browser stored, so placing them blind lands them on top of a card already
	// sitting there — invisible, with Reset Layout the only way out. Observed
	// 2026-07-29 adding two colour cards to Settings: both landed under Sensor
	// names. They are placed in a second pass, once every stored rect is known,
	// via slideDownToFree — which keeps the coded COLUMN (so a pair designed to
	// sit side by side still does) and finds the first free row below.
	const added: string[] = [];
	for (const d of defaults) {
		const entry = record[d.id];
		if (!isPanelRect(entry)) {
			added.push(d.id);
			continue;
		}
		// An OPERATOR-SIZED span wins outright. Taking Math.max here made a card
		// spring back to its coded size across a reload: shrink it, reload, and
		// growing was remembered while shrinking was not (reported 2026-07-30,
		// Tools & heaters at rowSpan 77 against a coded 110).
		//
		// The max existed so a card that GAINED content in a release would adopt
		// the bigger coded size instead of clipping, and 2026-07-30's fix argued
		// that was now covered by the thing that actually knows: the resize stop
		// measures content and refuses to go under it, so any size the operator
		// can set already contains what the card draws.
		//
		// True at RESIZE time, false ACROSS RELEASES (#132). The stop measured
		// the card as it was drawn THEN; a span legal in release N sits below the
		// content floor of release N+1, and nothing re-checked it. shaping-status
		// went 102 -> 116 in #128 and every browser holding 102 kept it, clipping
		// 452 px of body into a 400 px box on a screen with no saved SD layout to
		// be reconciled against.
		//
		// So the max is back, for UNMARKED spans only. A coded default is a floor
		// under a span nobody is known to have chosen, and a starting point for a
		// card that has none (the `added` pass below) — never a floor under one
		// the operator placed.
		if (sized.has(d.id)) {
			state[d.id] = clampRect(entry);
			continue;
		}
		const raised = clampRect({
			col: entry.col,
			row: entry.row,
			colSpan: Math.max(entry.colSpan, d.colSpan),
			rowSpan: Math.max(entry.rowSpan, d.rowSpan),
		});
		// Read off the CLAMPED result, not the raw max: a colSpan raised past
		// GRID_COLS is pulled back by clampRect, and reporting growth the state
		// does not contain would reflow the screen around a change nobody made.
		if (raised.colSpan > entry.colSpan || raised.rowSpan > entry.rowSpan) grew = true;
		state[d.id] = raised;
	}
	// Second pass, after every stored rect is placed: a new card can now be
	// sited against the WHOLE canvas rather than against a partial one, so the
	// order defaults happen to be listed in cannot change where it lands.
	// Deliberately NOT counted as `grew`: reflow() would rearrange the user's
	// existing cards to accommodate the newcomer, and a card appearing is not
	// a reason to move the ones they placed themselves.
	for (const id of added) {
		state[id] = slideDownToFree(Object.values(state), fallback[id]!);
	}
	return { state, grew };
}

/**
 * Resolve every overlap by pushing cards RIGHT or DOWN — never up or left.
 *
 * Cards are placed in reading order (row, then col, then id purely for
 * determinism), so the topmost-leftmost card can never be displaced and a card
 * whose span just grew keeps its spot while its neighbours yield. That falls
 * out of the ordering rather than needing a "the grown one wins" special case:
 * a grown card is already placed by the time anything below or right of it is
 * considered.
 *
 * The axis is whichever penetration is fewer GRID CELLS (spec D2 — cells, not
 * pixels, which is the operator's call; the grid is anisotropic at 46px per
 * column against 4px per row, so equal cell counts are an 11.5x difference on
 * screen). Ties go right, the bounded axis, keeping the layout compact while
 * the unbounded one stays available.
 *
 * @invariant reflow-preserves-reading-order
 * @rung 6  choke-point over a total order — cards are placed in reading order
 *          (row, then col, then id for determinism), so the topmost-leftmost
 *          card cannot be displaced and a card whose span just grew keeps its
 *          spot while neighbours yield. That FALLS OUT of the ordering; there
 *          is no "the grown one wins" branch to get wrong
 * @why the operator's layout is their work. A redesign that shuffles everything
 *      because one card got taller reads as the app having lost their screen
 * @debt promote by making the placement order a value produced once and
 *       consumed by the loop, so a future caller cannot iterate the state
 *       directly and place out of order.
 *
 * @invariant reflow-terminates
 * @rung 3  tests — the argument is sound (every push strictly increases col or
 *          row; col is bounded by GRID_COLS and forces the down branch once a
 *          rightward push no longer fits; a row below every placed rect is
 *          always free), and idempotence follows from the output being
 *          collision-free. But it is an argument in prose over a `for(;;)`
 *          loop: nothing STRUCTURAL stops an edit from making a push that
 *          advances neither axis
 * @why this runs at mount on every screen. A non-terminating pass is not a
 *      wrong layout, it is a browser tab that never paints again
 * @debt make the loop consume a bounded, strictly-increasing cursor rather than
 *       mutating a candidate in place — then "a push that advances nothing" has
 *       no encoding and the argument stops needing to be believed.
 */
export function reflow(state: CanvasState): CanvasState {
	const order = Object.keys(state).sort((x, y) => {
		const a = state[x]!;
		const b = state[y]!;
		return a.row - b.row || a.col - b.col || (x < y ? -1 : x > y ? 1 : 0);
	});
	const out: CanvasState = {};
	const placed: PanelRect[] = [];
	for (const id of order) {
		let candidate: PanelRect = { ...state[id]! };
		for (;;) {
			const hit = placed.find(p => rectsOverlap(candidate, p));
			if (hit === undefined) break;
			const rightCells = hit.col + hit.colSpan - candidate.col;
			const downCells = hit.row + hit.rowSpan - candidate.row;
			const fitsRight = candidate.col + rightCells + candidate.colSpan <= GRID_COLS;
			candidate = fitsRight && rightCells <= downCells
				? { ...candidate, col: candidate.col + rightCells }
				: { ...candidate, row: candidate.row + downCells };
		}
		out[id] = candidate;
		placed.push(candidate);
	}
	return out;
}

/**
 * Every rect back to the origin, sizes untouched — the bench's normal form.
 * See the `bench` parameter of createPanelCanvas for why position is not the
 * operator's to own on a one-card surface.
 */
export function benchOrigin(state: CanvasState): CanvasState {
	const out: CanvasState = {};
	for (const [id, r] of safeEntries(state)) {
		out[id] = { col: 0, row: 0, colSpan: r.colSpan, rowSpan: r.rowSpan };
	}
	return out;
}

export function mergeCanvas(
	stored: unknown,
	defaults: PanelDefault[],
	/** Required for the same reason growToDefaults' is — this only forwards it. */
	sized: ReadonlySet<string>,
): CanvasState {
	const { state, grew } = growToDefaults(stored, defaults, sized);
	// Gated on an ACTUAL growth, which is a correctness requirement and not an
	// optimisation: see the paragraph above about hidden cards storing a legal
	// overlap. Reflowing unconditionally would shove cards around to "fix"
	// overlaps that are intentional and invisible — a variant of the very bug
	// the discard-on-collision removal fixed. Only a redesign disturbs the
	// arrangement, which is exactly what was asked for.
	return grew ? reflow(state) : state;
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

/**
 * What a canvas persists: the layout itself, plus the three records that
 * ride alongside it under the historic `<key>.parked` / `.orientation` /
 * `.nolabels` siblings — hidden cards' remembered spots, per-card content
 * direction, and which cards have their label column off. One interface
 * with THREE producers, deliberately: `machineCanvasKeys` is the ONLY one
 * backed by a real machine's store (config/machineStore.ts's closed
 * MachineKeyName union), so a screen's saved layout can never be read back
 * under the wrong machine. `devCanvasKeys` is the Card Lab's own carve-out —
 * a bench with no machine behind it (Ruling 2, storage-keys.test.ts) that
 * was never machine-scoped and stays that way, isolated under its own fixed
 * key rather than pretending to be a `MachineStore`. `nullCanvasKeys` (GIT_86
 * finding 1) is the third: a screen rendered before identity resolves at
 * all, which has neither a machine store NOR a fixed bench key to fall back
 * on — the only honest answer is to persist nowhere.
 */
export type CanvasKeyKind = "layout" | "parked" | "orientation" | "labels";

export interface CanvasKeys {
	get(kind: CanvasKeyKind): string | null;
	set(kind: CanvasKeyKind, value: string): void;
	remove(kind: CanvasKeyKind): void;
}

/**
 * The real door: a screen's canvas, keyed by the caller's OWN machine and
 * this screen's id. `canvas`/`canvasParked`/`canvasOrientation`/
 * `canvasLabels` are four independent records rather than one record whose
 * suffix encodes both the screen id and which of the four this is — see
 * config/machineStore.ts's MachineKeyName doc for why folding them into one
 * suffix string is the ambiguity safeSuffix exists to rule out, one level up.
 */
export function machineCanvasKeys(store: MachineStore, screenId: string): CanvasKeys {
	const name = (kind: CanvasKeyKind): MachineKeyName => (
		kind === "layout" ? "canvas"
		: kind === "parked" ? "canvasParked"
		: kind === "orientation" ? "canvasOrientation"
		: "canvasLabels"
	);
	return {
		get: kind => store.get(name(kind), screenId),
		set: (kind, value) => store.set(name(kind), value, screenId),
		remove: kind => store.remove(name(kind), screenId),
	};
}

/**
 * The Card Lab's own carve-out (dev/CardLab.tsx, allowlisted in
 * storage-keys.test.ts): a fixed, origin-global key with no machine behind
 * it. `baseKey` is a literal the caller writes out in full (never built from
 * a shared prefix here), so this function itself carries no
 * machine-scoped-looking literal for the lint to ever need to know about.
 */
export function devCanvasKeys(baseKey: string): CanvasKeys {
	const key = (kind: CanvasKeyKind): string => (
		kind === "layout" ? baseKey
		: kind === "parked" ? `${baseKey}.parked`
		: kind === "orientation" ? `${baseKey}.orientation`
		: `${baseKey}.nolabels`
	);
	return {
		get: kind => readStorage(key(kind)),
		set: (kind, value) => writeStorage(key(kind), value),
		remove: kind => removeStorage(key(kind)),
	};
}

/**
 * A canvas with no machine to belong to (GIT_86 finding 1): the render for a
 * screen visited before identity resolves, or on a board that never
 * identifies at all (unreachable, or reporting neither a `uniqueId` nor an
 * interface MAC — spec §3 treats this as a supported operating mode, not an
 * error). There is no `IdentifiedMachine` here to open a `MachineStore`
 * for, and machine-scoped storage's one door (`openMachineStore`,
 * config/machineStore.ts) takes nothing else — so this is deliberately NOT
 * a fourth way to reach `localStorage` under a made-up or shared key. It is
 * a plain in-memory record, alive for exactly as long as whatever created
 * it: ComposedScreen constructs one fresh per mount of its unidentified
 * branch, and the moment identity lands, its keyed `<Show>` tears that
 * branch down and mounts a new one against `machineCanvasKeys` instead —
 * this map, and anything written to it, is discarded with it, never
 * migrated or merged into the real store. A card the operator drags while
 * unidentified stays where they put it for as long as that render lives,
 * exactly like any other canvas; it simply cannot outlive the render,
 * because there is no machine yet for it to belong to.
 */
export function nullCanvasKeys(): CanvasKeys {
	const values = new Map<CanvasKeyKind, string>();
	return {
		get: kind => values.get(kind) ?? null,
		set: (kind, value) => { values.set(kind, value); },
		remove: kind => { values.delete(kind); },
	};
}

/**
 * WHO moved the card — the distinction the dirty flag actually needs.
 *
 * `"operator-gesture"`: a person did this. A drag, a resize, an import, a
 * reset of one slot. It is unsaved work, and Save to machine must light up.
 *
 * `"composition-reconcile"`: the canvas catching up to a fact the config
 * already holds — a slot the composition gained or lost since this canvas was
 * built (ComposedScreen's sync effect). The overlay edit that CAUSED it has
 * already marked itself dirty through the config store's own `commit`, so
 * reporting it a second time here can only ever be double-counting; at boot,
 * where there was no edit at all, it is a plain falsehood.
 */
export type LayoutOrigin = "operator-gesture" | "composition-reconcile";

export interface PanelCanvasController {
	styleFor: (id: string) => Record<string, string>;
	startMove: (id: string, event: PointerEvent) => void;
	/**
	 * Cards picked up together, moved rigidly by one drag on any member.
	 * Reactive; never persisted — a selection is a gesture, not a setting.
	 */
	isSelected: (id: string) => boolean;
	/** Add or remove one card from the pick-up (modifier-click on its grip). */
	toggleSelected: (id: string) => void;
	/** Put everything down — Escape, a drop, or a drag on a card outside it. */
	clearSelection: () => void;
	/** How many are held, so a surface can say so without reading the set. */
	selectedCount: () => number;
	startResize: (id: string, event: PointerEvent) => void;
	reset: () => void;
	/** Content layout direction for a panel that opts into the toggle
	 *  (Panel's orientationToggle prop) — "vertical" for anything never set. */
	orientationFor: (id: string) => Orientation;
	toggleOrientation: (id: string) => void;
	/**
	 * Whether this slot shows its LABEL column/row — the axis letters beside a
	 * Homing row, the names beside a jog pad. True for anything never toggled.
	 *
	 * A label is redundant the moment the control beside it already says the
	 * same thing, and on a machine you use every day that redundancy is width
	 * you paid for once and read never. Per-slot, because the same card can be
	 * self-evident on one screen and unlabelled-and-confusing on another.
	 */
	labelsFor: (id: string) => boolean;
	toggleLabels: (id: string) => void;
	/** Ids currently tracked (reactive). */
	slotIds: () => string[];
	/** Adopt a slot added after mount (composition editing) at the given rect;
	 *  no-op if already tracked. Persists, but as a RECONCILE, never as a
	 *  gesture: the composition edit that added the card already marked the
	 *  config dirty through `setScreenCard` -> apply -> commit, and at boot
	 *  there is no edit at all. See LayoutOrigin. */
	ensureSlot: (id: string, rect: PanelRect) => void;
	/** Forget a slot removed after mount. Persists as a RECONCILE — same
	 *  reasoning as ensureSlot above. */
	removeSlot: (id: string) => void;
	/**
	 * Rebuild the layout wholesale from `rects` — the live half of an import.
	 * Distinct from ensureSlot/removeSlot, which evolve the CURRENT layout one
	 * card at a time: this one says "that layout is gone, here is a different
	 * one", which is the operation an import performs and the one that was
	 * missing.
	 */
	adoptLayout: (rects: CanvasState, orientations?: OrientationState) => void;
	/**
	 * Restore ONE slot to its coded default, leaving every other slot alone.
	 *
	 * reset() is the whole-canvas hammer, which is wrong for a surface showing
	 * a single card at a time: there, "reset the layout" can only sanely mean
	 * the card in front of you, not all 36 the lab tracks.
	 */
	resetSlot: (id: string) => void;
}

/**
 * Per-view grid canvas controller. Call once per view; pass the result to
 * every <Panel> in it. Position/size persist through `keys` (CanvasKeys —
 * machineCanvasKeys for a real screen, devCanvasKeys for the Card Lab bench)
 * and survive reload.
 *
 * `isActive`, when given, excludes currently-not-rendered panels (e.g. a
 * `<Show>`-gated Camera or Fans panel, or Jobs' conditional Active-job/
 * Job-details cards) from collision checks during move/resize — their
 * position is still tracked in state so they reappear where they were
 * once shown again, but an invisible panel can't block a visible one from
 * moving into the space it would otherwise occupy.
 */
export function createPanelCanvas(
	keys: CanvasKeys,
	defaults: PanelDefault[],
	isActive?: (id: string) => boolean,
	/**
	 * Called when an OPERATOR changes this canvas's geometry — a drag, a
	 * resize, an import, a per-slot reset. A screen passes the config store's
	 * markLayoutDirty, because a moved card is an unsaved change and Save to
	 * machine is gated on the dirty flag — without this a rearranged screen
	 * could never be pushed to the SD card at all. Surfaces whose geometry is
	 * device-only (the Card Lab) pass nothing.
	 *
	 * NOT called for a composition reconcile or for the construction-time
	 * repair: see LayoutOrigin and `persist` below for why those two facts
	 * had to stop sharing one notifier (#120 defect B).
	 */
	onLayoutChange?: () => void,
	/**
	 * A BENCH: one card visible at a time, every card parked at the origin, and
	 * the overlaps between them deliberate. The Card Lab is the only one.
	 *
	 * Two things follow, and both are corrections of real damage. reflow() must
	 * not run — its job is to push overlapping cards right and down, and here
	 * every card overlaps every other on purpose. It fired on 2026-07-30 when
	 * the type bump grew the cards' default sizes, setting `grew` and scattering
	 * all fifty across the grid; `position` ended up at row 2291, which is what
	 * "way off to the right and down" looked like from the outside.
	 *
	 * And positions are normalised back to the origin on load, because on a
	 * bench a card's col/row is not a thing the operator owns — only its SIZE
	 * is. That also repairs the storage the scattering already wrote, without
	 * anyone having to clear localStorage.
	 */
	bench?: boolean,
	/**
	 * The config overlay's saved rects for THIS screen (GIT_86 task 16),
	 * consulted ONLY when the canvas store has no record at all for it — a
	 * genuinely empty key, not merely one missing an id `defaults` names.
	 * That is exactly the upgrading-machine case: the machine-scoped canvas
	 * store starts empty by policy (origin-global bytes carry no proof of
	 * which machine wrote them and are never migrated), so without this a
	 * card the operator actually placed on the SD card would be
	 * indistinguishable from one nobody ever placed, and growToDefaults'
	 * `added` pass would re-site it — which is exactly what b9bdcbf's
	 * verbatim-defaults branch tried and failed to prevent (it also
	 * protected coded-only cards that were never the operator's to protect).
	 *
	 * Seeding instead of returning this verbatim keeps growToDefaults' own
	 * contract intact: an id present here is STORED (honoured exactly,
	 * overlaps and all), an id absent from it but present in `defaults` is
	 * still ADDED (slid clear via slideDownToFree) — so a coded-only card can
	 * never land on top of one the operator actually placed, whether or not
	 * the operator has ever opened this browser before.
	 *
	 * Read exactly once, at construction, and used only to pick WHICH value
	 * feeds the same `mergeCanvas`/`growToDefaults` call this already made —
	 * never as a second writer. The settle-write below persists whatever that
	 * call returns exactly as it always has, so a seeded load behaves for
	 * every purpose (including "does this mark the layout dirty") like any
	 * other repaired canvas, not like a save.
	 */
	seedFromOverlay?: CanvasState | null,
	/**
	 * Called at construction when this browser's stored canvas was DISCARDED in
	 * favour of the card's copy — never for an ordinary seed of a browser that
	 * had nothing. #87 requirement 4: if a layout could not be carried across,
	 * that is told to the operator through the same channel as the rest of the
	 * campaign's dropped data, rather than being a silent correction.
	 */
	onLayoutSuperseded?: (why: string) => void,
): PanelCanvasController {
	const record = readStoredCanvasRecord(keys.get("layout"));
	const storedRaw = record.state;
	// The basis this canvas will be written under from now on: what the CARD
	// currently says about this screen.
	const basisNow = layoutBasis(seedFromOverlay ?? null);
	// "No record at all" — nothing was ever persisted under this key, or it
	// parsed to an object with zero entries. NOT "no entry for every default
	// id": that finer-grained question is growToDefaults' own to answer, per
	// id, via its ordinary stored-vs-added split — this seed only stands in
	// for storage that was never written, so a canvas holding even one real
	// entry is left alone rather than second-guessed.
	//
	// `cleared` is excluded on purpose: a reset canvas HAS a record, it just
	// has no rects, and treating it as empty is the bug (#87 requirement 2).
	const isWhollyEmpty = !record.cleared && (storedRaw === null
		|| (typeof storedRaw === "object" && Object.keys(storedRaw as object).length === 0));
	// Is this browser's copy entitled to win?
	//
	// It is when there is nothing to be stale against (the card holds no layout
	// for this screen), or when it was reconciled against the layout the card
	// holds RIGHT NOW — in which case its rects are local edits made since that
	// save, which must survive a reload or a drag could never be saved at all.
	//
	// It is not when it carries a different basis, or none: a record written
	// before #87 cannot show it was ever reconciled, and #76's precedent for
	// this campaign is that bytes with no proof of origin are dropped rather
	// than guessed at.
	const proofCarrying = seedFromOverlay != null;
	const localIsCurrent = !proofCarrying || record.basis === basisNow;
	const supersede = proofCarrying && !localIsCurrent && !isWhollyEmpty;
	if (supersede) {
		onLayoutSuperseded?.(
			record.basis === null
				? "a layout this browser saved before it tracked which saved layout it came from"
				: "a layout this browser saved against an older version of this screen",
		);
	}
	const effectiveStored = supersede || isWhollyEmpty
		? (seedFromOverlay ?? storedRaw)
		: record.cleared ? {} : storedRaw;
	/**
	 * Which spans are the OPERATOR'S, for this mount (#132).
	 *
	 * Two sources, and both really are operator gestures:
	 *
	 *  - what this browser recorded at `persist(…, "operator-gesture")`, and
	 *  - every id in the layout the operator SAVED TO THE CARD. Saving is the
	 *    strongest statement about a layout there is — stronger than a drag,
	 *    which is local and unsaved — so a span that reached this browser from
	 *    the card is not a fossil of a coded default, whichever release wrote
	 *    it. That is also why this fix touches exactly one screen on Gabe's
	 *    machine: Shaping is the only one with no `screens.layouts` entry, so
	 *    it is the only one whose stored spans nothing endorses.
	 *
	 * Union rather than either alone: the seed governs the ids the card knows
	 * about, and the record governs edits made since that save, and a screen
	 * routinely has both.
	 */
	const sizedNow = new Set<string>(record.sized);
	if (seedFromOverlay != null) for (const id of Object.keys(seedFromOverlay)) sizedNow.add(id);
	const [state, setState] = createSignal(
		bench === true
			? benchOrigin(growToDefaults(storedRaw, defaults, sizedNow).state)
			: mergeCanvas(effectiveStored, defaults, sizedNow),
	);
	// Settle a redesign repair once rather than recomputing it on every load.
	// Deliberately NOT persist(): a repair is not a user edit, and mutating the
	// config store during signal initialisation is not safe either. Kept as a
	// direct keys.set even though persist(…, "composition-reconcile") would now
	// also be silent — the second reason still stands on its own. Correctness never depends on this landing:
	// growToDefaults + reflow are deterministic and idempotent, so a browser
	// where the write no-ops (private mode, quota) rebuilds the identical
	// layout every time.
	// `cleared` is carried through: the settle write is a deterministic repair,
	// not an edit, so it must not quietly retract the operator's reset. The flag
	// is dropped by `persist` below — a drag IS an edit, and a canvas with rects
	// the operator placed is no longer a cleared one.
	keys.set("layout", serializeCanvas(state(), basisNow, sizedNow, record.cleared ? true : undefined));

	// Stored wins (this browser's own toggles); otherwise seed from the
	// composition, which is how orientation reaches a browser that has never
	// seen this screen — the same tiering geometry uses.
	const [orientationState, setOrientationState] = createSignal(((): OrientationState => {
		const stored = parseOrientationState(keys.get("orientation"));
		if (Object.keys(stored).length > 0) return stored;
		const seeded: OrientationState = {};
		for (const d of defaults) {
			if (d.orientation !== undefined) seeded[d.id] = d.orientation;
		}
		return seeded;
	})());

	// Where hidden cards' rects go so a hide→show round-trip restores the spot.
	// Persisted (same format as the canvas) so it survives a reload while the
	// card is off the screen — a hidden card is not in the composition, so
	// nothing else remembers where it was.
	const [parked, setParked] = createSignal<CanvasState>(sanitizeCanvas(parseStoredCanvas(keys.get("parked"))));

	/**
	 * Cards picked up together. Deliberately NOT persisted: a selection is a
	 * gesture in progress, and finding three cards still lit from yesterday
	 * would be a puzzle, not a convenience. Cleared on drop, on Escape, and by
	 * dragging something outside it.
	 */
	const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set<string>());
	const isSelected = (id: string): boolean => selected().has(id);
	const clearSelection = (): void => { if (selected().size > 0) setSelected(new Set<string>()); };
	const toggleSelected = (id: string): void => {
		const next = new Set(selected());
		if (!next.delete(id)) next.add(id);
		setSelected(next);
	};
	// Escape puts everything down. Installed with the controller rather than in
	// each view, so a surface that renders a canvas cannot forget the only way
	// out of a selection that is otherwise cleared solely by dragging.
	// Guarded: this controller is constructed headless in node:test, where the
	// whole point is to exercise the layout arithmetic without a DOM. An
	// unguarded listener made four existing tests fail on `window is not
	// defined` — the storage helpers in this file already take the same care.
	if (typeof window !== "undefined") {
		const onKeyDown = (e: KeyboardEvent): void => { if (e.key === "Escape") clearSelection(); };
		window.addEventListener("keydown", onKeyDown);
		onCleanup(() => window.removeEventListener("keydown", onKeyDown));
	}
	const persistParked = (next: CanvasState): void => {
		setParked(next);
		keys.set("parked", serializeParked(next));
	};

	/**
	 * Write geometry, and say WHERE IT CAME FROM.
	 *
	 * @invariant only-an-operator-gesture-reports-unsaved-work
	 * @rung 6  choke-point with a mandatory discriminator — `persist` is the
	 *          only function that writes the "layout" key, `onLayoutChange` is
	 *          named at exactly one line in the program (the one below), and
	 *          `origin` has no default, so a geometry write that never decided
	 *          whose act it was does not COMPILE. A new call site added by
	 *          someone who read nothing still has to answer the only question
	 *          that matters here. Not rung 7: the two origins are string
	 *          literals a caller could still pick wrongly, which is what
	 *          test/layout-dirty-origin.test.ts's per-call-site scan pins
	 * @why one flag used to carry two different facts — "the operator
	 *          rearranged the screen" and "the canvas emitted a geometry
	 *          event". `ensureSlot`/`removeSlot` run from ComposedScreen's
	 *          composition-sync effect, which fires as the screen is being
	 *          brought up to date with a config change nobody dragged; routing
	 *          those through the same notifier as a drag is what let a plain
	 *          reload report unsaved work that did not exist (#120 defect B).
	 *          The fix is NOT to stop marking dirty: geometry only reaches the
	 *          overlay at save time (captureScreenGeometry) and Save is gated
	 *          on the flag, so a canvas that never marks dirty is one whose
	 *          rearrangement can never be saved at all
	 * @enumerated the geometry writers NOT on this route, and why: `reset()`
	 *          REMOVES the key rather than writing one (the next mount re-seeds
	 *          from defaults) and has never notified; the construction-time
	 *          settle write at the top of this function is a deterministic
	 *          repair, not an edit, and deliberately calls `keys.set` directly.
	 *          Both are unchanged by #120 and neither can express a notify.
	 */
	/**
	 * Record which spans the OPERATOR set. The sole writer of `sizedNow`.
	 *
	 * @invariant a-stored-span-is-honoured-verbatim-only-if-the-operator-set-it
	 * @rung 6  choke-point over a required parameter — every write of the
	 *          "layout" key goes through `serializeCanvas`, which takes the set
	 *          as a REQUIRED argument, and `growToDefaults`/`mergeCanvas` take
	 *          it the same way, so neither a write nor a merge can be expressed
	 *          without stating whose spans these are. Inside this controller the
	 *          set has exactly one mutator, this function, reached only from
	 *          `persist(…, "operator-gesture")` — a composition reconcile cannot
	 *          mark anything, which is the property that stops a boot from
	 *          fossilising the very spans it just repaired
	 * @why a card whose coded floor grew in a release renders CLIPPED forever on
	 *          every browser holding the old span, with Reset Layout the only way
	 *          out. Honouring every stored span instead makes the operator's own
	 *          deliberate shrink spring back on the next reload. Both are real
	 *          reports (2026-08-28 and 2026-07-30); only knowing WHICH kind of
	 *          span this is lets one rule serve both
	 * @debt promote by minting a branded OperatorSized value here and accepting
	 *          only that at serializeCanvas and growToDefaults, so a caller cannot
	 *          hand over a set it assembled from the wrong side. Records written
	 *          before #132 carry no marks and cannot be reconstructed — those spans
	 *          are byte-identical either way — so they grow once, by decision; see
	 *          growToDefaults' doc. test/canvas-span-provenance.test.ts pins the
	 *          behaviour meanwhile.
	 *
	 * A MOVE deliberately marks nothing: dragging a card across the screen says
	 * nothing about how tall it should be, and marking on any gesture at all
	 * would let an operator freeze a clipped fossil by nudging it.
	 *
	 * A span landing exactly on its coded default UNMARKS instead. That is
	 * resetSlot's entire gesture ("put this one back"), and an operator dragging
	 * a card onto its default size is saying the same thing — in both cases
	 * there is no longer a chosen span to protect, and a later release that
	 * raises the default should be free to raise this too.
	 */
	/**
	 * The canvas as it was at the last PERSISTED write — the state a gesture
	 * started from.
	 *
	 * Not `state()`, and that distinction is the whole of it: a drag and a
	 * resize write live PREVIEWS straight to `setState` on every frame and call
	 * `persist` once, on drop. By then `state()` already holds the result, so
	 * comparing `next` against it compares the gesture to itself and finds
	 * nothing changed — measured 2026-08-28 driving a real pointer drag on the
	 * mock: shaping-decay went 189 -> 155, `sized` stayed `[]`, and the shrink
	 * sprang back on reload. That is the 2026-07-30 regression, reintroduced.
	 *
	 * `persist` is its only writer, so it cannot drift out of step with what is
	 * in storage, and the comparison is against the right state without any
	 * gesture having to snapshot one for it.
	 */
	let lastPersisted: CanvasState = state();

	const markOperatorSized = (prev: CanvasState, next: CanvasState): void => {
		for (const id of [...sizedNow]) if (next[id] === undefined) sizedNow.delete(id);
		for (const [id, rect] of safeEntries(next)) {
			const was = prev[id];
			if (was === undefined) {
				// Only an import reaches here with an id the canvas did not have
				// (ensureSlot is a composition-reconcile). An imported layout is
				// one a person chose and applied, so its spans are theirs.
				sizedNow.add(id);
				continue;
			}
			if (was.colSpan === rect.colSpan && was.rowSpan === rect.rowSpan) continue;
			const coded = defaults.find(d => d.id === id);
			if (coded !== undefined && coded.colSpan === rect.colSpan && coded.rowSpan === rect.rowSpan) {
				sizedNow.delete(id);
			} else {
				sizedNow.add(id);
			}
		}
	};

	const persist = (next: CanvasState, origin: LayoutOrigin): void => {
		if (origin === "operator-gesture") markOperatorSized(lastPersisted, next);
		lastPersisted = next;
		setState(next);
		keys.set("layout", serializeCanvas(next, basisNow, sizedNow));
		if (origin === "operator-gesture") onLayoutChange?.();
	};

	// Hidden labels, stored as the EXCEPTION set rather than a value per card:
	// labels are on unless a slot says otherwise, so a card added later is
	// labelled by default and an empty store means "everything as shipped".
	const [hiddenLabels, setHiddenLabels] = createSignal<ReadonlySet<string>>(((): ReadonlySet<string> => {
		try {
			const raw = keys.get("labels");
			const parsed: unknown = raw === null ? null : JSON.parse(raw);
			return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
		} catch {
			return new Set<string>();
		}
	})());
	const labelsFor = (id: string): boolean => !hiddenLabels().has(id);
	const toggleLabels = (id: string): void => {
		const next = new Set(hiddenLabels());
		if (!next.delete(id)) next.add(id);
		setHiddenLabels(next);
		keys.set("labels", JSON.stringify([...next]));
	};

	const orientationFor = (id: string): Orientation => orientationState()[id] ?? "vertical";

	const toggleOrientation = (id: string): void => {
		const next: OrientationState = { ...orientationState(), [id]: toggledOrientation(orientationFor(id)) };
		setOrientationState(next);
		keys.set("orientation", serializeOrientationState(next));
	};

	/** state(), minus any currently-inactive panel other than the one being dragged/resized. */
	const collidableState = (selfId: string): CanvasState => {
		if (!isActive) return state();
		const filtered: CanvasState = {};
		for (const [pid, rect] of safeEntries(state())) {
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
		persist({ ...state(), [id]: placed }, "composition-reconcile");
	};

	const removeSlot = (id: string): void => {
		const rect = state()[id];
		if (rect === undefined) return;
		// Remember the spot BEFORE dropping it, so showing the card again can put
		// it back. This is what fixes the "hiding a card forgets its position" bug.
		persistParked({ ...parked(), [id]: rect });
		const next = { ...state() };
		delete next[id];
		persist(next, "composition-reconcile");
	};

	/**
	 * THE CANVAS FLOOR — one hidden grid cell that stops the canvas becoming
	 * SHORTER than something that currently matters.
	 *
	 * It has two jobs across a drag's life, and they are the same mechanism:
	 * while the pointer is down it holds the drag's reach, so shrinking a card
	 * cannot pull the scroll position out from under the measurement that sizes
	 * it (see reservedReach); when the pointer comes up it recedes to the scroll
	 * position already on screen (scrollFloorRows), so releasing changes nothing
	 * visible. It is then dropped the moment scrolling up makes it redundant —
	 * below the fold, where its removal cannot be seen.
	 *
	 * ONE floor, owned here, because two would fight: a drag that created its
	 * own would leave the previous drag's still holding, and the pair would
	 * accumulate a taller and taller phantom canvas across a session. Reusing
	 * the element also means a second drag never has to remove the first's
	 * floor — removing it is precisely the jump this exists to avoid.
	 */
	let floor: { el: HTMLElement; scroller: HTMLElement | null; onScroll: (() => void) | null } | null = null;

	/** The lowest row any tracked panel occupies — the canvas's real height. */
	const contentRows = (): number =>
		Object.values(state()).reduce((max, r) => Math.max(max, r.row + r.rowSpan), 0);

	const dropFloor = (): void => {
		if (floor === null) return;
		if (floor.onScroll !== null && floor.scroller !== null) {
			floor.scroller.removeEventListener("scroll", floor.onScroll);
		}
		floor.el.remove();
		floor = null;
	};

	/** Hold the canvas at `rows`, creating the floor if this is the first drag. */
	const holdFloor = (canvasEl: HTMLElement, scroller: HTMLElement | null, rows: number): void => {
		if (floor === null) {
			const el = document.createElement("div");
			el.style.gridColumn = "1 / span 1";
			el.style.visibility = "hidden";
			canvasEl.appendChild(el);
			floor = { el, scroller, onScroll: null };
		} else if (floor.onScroll !== null && floor.scroller !== null) {
			// Re-entering a drag: the settle listener must not fire mid-gesture and
			// pull the floor away while it is doing its first job.
			floor.scroller.removeEventListener("scroll", floor.onScroll);
			floor.onScroll = null;
			floor.scroller = scroller;
		}
		floor.el.style.gridRow = `${Math.max(1, rows)} / span 1`;
	};

	/** Pointer up: recede to what the view needs, or let go if it needs nothing. */
	const settleFloor = (unitPx: number): void => {
		if (floor === null) return;
		const scroller = floor.scroller;
		if (scroller === null) {
			dropFloor();
			return;
		}
		const needed = scrollFloorRows(scroller.scrollTop, scroller.clientHeight, unitPx);
		if (needed <= contentRows()) {
			// The real cards already reach past the bottom of the view; the floor is
			// holding nothing up and can go now, unnoticed.
			dropFloor();
			return;
		}
		floor.el.style.gridRow = `${needed} / span 1`;
		const onScroll = (): void => {
			if (scroller.scrollTop + scroller.clientHeight <= contentRows() * unitPx) dropFloor();
		};
		floor.onScroll = onScroll;
		scroller.addEventListener("scroll", onScroll, { passive: true });
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
		// Read ONCE per drag, not per frame: it cannot change while a pointer is
		// down, and getComputedStyle in a rAF loop is a style flush per frame.
		// Named `unit`, not `unitPx`, so the local read cannot shadow the
		// exported function of the same drawn quantity.
		const unit = unitPx();
		let pointerX = event.clientX;
		let pointerY = event.clientY;
		// Dragging a card that is NOT in the selection means the operator has
		// moved on — the old pick-up is abandoned rather than dragged along
		// invisibly behind the card under the pointer.
		if (!isSelected(id)) clearSelection();
		// Frozen for the drag: the group is whatever was picked up when the
		// pointer went down, so a selection change mid-drag cannot make cards
		// join or leave the formation halfway across the canvas.
		const group = isSelected(id) ? [...selected()] : [];
		// Snapshotted with the group, for the same reason: every frame resolves
		// the delta against where the cards STARTED. Resolving against the live
		// state would compound each frame's move into the next one's baseline.
		const groupOrigin = collidableState(id);
		let lastValid = start;
		let lastPatch: CanvasState | null = null;

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
			const deltaCol = Math.round((pointerX - originX) / (unit + GAP_PX));
			const deltaRow = Math.round((effectiveY - originY) / (unit + ROW_GAP_PX));
			const reachRow = Math.max(0, start.row + deltaRow) + start.rowSpan;
			spacer.style.gridRow = `${reachRow + 1} / span 1`;

			// resolveMove slides per axis: a blocked component stops at the
			// obstacle (or edge) while the free component keeps tracking the
			// pointer — a diagonal never freezes the whole card.
			if (group.length > 1) {
				// The whole formation, rigidly, or nothing — see resolveGroupMove.
				// Resolved from the drag's ORIGIN state, not the live previewed
				// one, so the delta is always measured against where the cards
				// were picked up rather than accumulating frame over frame.
				const patch = resolveGroupMove(groupOrigin, group, deltaCol, deltaRow);
				if (patch) {
					lastPatch = patch;
					setState({ ...state(), ...patch }); // live preview, not yet persisted
				}
			} else {
				const candidate = resolveMove(collidableState(id), id, start.col + deltaCol, start.row + deltaRow);
				if (candidate) {
					lastValid = candidate;
					setState({ ...state(), [id]: candidate }); // live preview, not yet persisted
				}
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
			if (group.length > 1) {
				// lastPatch may be null: a group picked up and put back down
				// without ever finding a legal delta. Persist the state as it
				// stands rather than an empty patch, so the drop is still a
				// no-op and not a write of stale rects.
				persist(lastPatch === null ? state() : { ...state(), ...lastPatch }, "operator-gesture");
				// The formation has landed. Keeping it lit would make the next
				// unrelated drag pick all of them up again.
				clearSelection();
			} else {
				persist({ ...state(), [id]: lastValid }, "operator-gesture");
			}
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
		// The horizontal twin, which was missing. The loop scrolled scrollLeft and
		// then measured the width delta from clientX alone, so sideways the view ran
		// to the end of the canvas while the card never changed width at all — the
		// card appearing to fly off the edge of the screen (reported 2026-08-04).
		// Scrolling right moves the card's left edge left under a stationary
		// pointer, which IS width the operator has dragged out; not counting it
		// measures the wrong distance.
		const originScrollLeft = scroller?.scrollLeft ?? 0;
		const originScrollX = window.scrollX;

		// One hard stop per axis, both measured once at the start of the drag.
		// A card can be dragged down to the size that exactly contains what it
		// draws, and no further — the edge simply stops, and the gold outline
		// says why. Nothing here can be pulled through.
		//
		// Each stop is the LARGER of two floors, so it is honest for both a
		// content-heavy card and an almost-empty one:
		//   · the content fit itself;
		//   · the chrome — vertically the header + resize-grip foot plus 50%
		//     (operator's spec), horizontally the header laid out unclipped —
		//     which is what a card with almost nothing in it bottoms out on.
		const cardEl = grip.closest<HTMLElement>(".card");
		const gutterPx = cardEl ? parseFloat(getComputedStyle(cardEl).marginBottom || "0") : 0;
		const headPx = cardEl?.querySelector<HTMLElement>(".card-head")?.getBoundingClientRect().height ?? 0;
		// Read once per drag; same reason as startMove. Named `unit`, not
		// `unitPx`, so the local read cannot shadow the exported function.
		const unit = unitPx();
		// The grip term is DECLARED in units (resizeHardFloor's GRIP_U), not
		// measured off `.panel-resize-grip`. The grip is a fixed 16px pointer
		// target on purpose, so measuring it wrote a scale-independent constant
		// into a floor whose other terms all scale — and the stop then landed on
		// a different cell count at every step (22/20/18 at 0.75/1/1.5). The
		// header IS measured, and it does scale, so the quotient holds.
		const hardFloor = resizeHardFloor(headPx, unit, gutterPx);
		// The declared floor for cards whose content can be absent — see
		// PanelDefault.minRowSpan. Every rung is a Math.max, so the order they
		// are written in does not matter and the header floor is genuinely the
		// LAST resort: it only decides the stop when neither the measurement nor
		// the declaration asks for more.
		const declared = defaults.find(d => d.id === id);
		const rowStop = Math.max(
			cardEl ? contentRowSpan(cardEl, gutterPx) : 1,
			hardFloor,
			declared?.minRowSpan ?? 1,
		);

		// The same on the horizontal axis, which had no limit at all: a card
		// could be dragged narrower than its own controls, which then simply
		// disappeared off the side with nothing shown and nothing felt.
		const sideGutterPx = cardEl ? parseFloat(getComputedStyle(cardEl).marginRight || "0") : 0;
		// headerColSpan is the title + the G-code/macro hint laid out unclipped:
		// the absolute floor, below which a card stops being able to say what it
		// is. .card-title is white-space: nowrap precisely so this number means
		// something — a title that folded would shrink the very wall meant to
		// protect it.
		const hardWall = cardEl ? headerColSpan(cardEl, sideGutterPx) : 1;
		const colStop = Math.max(
			cardEl ? contentColSpan(cardEl, sideGutterPx) : 1,
			hardWall,
			declared?.minColSpan ?? 1,
		);
		let pointerX = event.clientX;
		let pointerY = event.clientY;

		// Auto-scroll while the pointer pushes into any of the container's edges.
		// Without it "drag to resize" is capped by the window in BOTH directions:
		// you cannot move the pointer below the screen, so a card that fills the
		// viewport can never be made taller — nor, pushing up, any shorter than
		// one screenful of pointer travel.
		//
		// Speed comes from edgeScrollStep, which ramps it from zero at the edge
		// of the zone — an ordinary resize is unaffected, and a pointer merely
		// RESTING near the edge does nothing. That is the correction: this loop
		// feeds its own scroll offset back in as a size input below, so a flat
		// step made the drag accelerate itself off the screen.
		//
		// The floor holds the canvas at the lowest extent this drag has reached, so
		// it can grow but never SHORTEN while the pointer is down — see
		// reservedReach. Without it a shrinking card pulls the scroll position out
		// from under its own measurement. It is NOT removed on drop; it recedes.
		let reach = start.row + start.rowSpan;
		holdFloor(canvasEl, scroller, reach + 1);

		let raf = 0;
		const tick = (): void => {
			if (scroller) {
				const box = scroller.getBoundingClientRect();
				scroller.scrollTop += axisScrollStep(pointerY, box.top, box.bottom);
				scroller.scrollLeft += axisScrollStep(pointerX, box.left, box.right);
			}
			// Both axes measured in the CONTENT's frame, not the viewport's: the
			// pointer stands still while the container scrolls under it, and that
			// relative motion is size the operator has dragged out. Symmetric on
			// purpose — the vertical term existed and the horizontal one did not,
			// which is precisely how the two axes came to behave differently.
			const scrolledY = (window.scrollY - originScrollY) + ((scroller?.scrollTop ?? 0) - originScrollTop);
			const scrolledX = (window.scrollX - originScrollX) + ((scroller?.scrollLeft ?? 0) - originScrollLeft);
			const effectiveY = pointerY + scrolledY;
			const effectiveX = pointerX + scrolledX;
			const deltaColSpan = Math.round((effectiveX - originX) / (unit + GAP_PX));
			const deltaRowSpan = Math.round((effectiveY - originY) / (unit + ROW_GAP_PX));
			// Detent at the content fit (snaps, then breaks away), THEN the hard
			// floor clamps whatever the detent produced so a released card still
			// can't shrink past the wall. The gold cue lights only while the
			// detent is actively holding — never for a width-only resize.
			const rows = clampToStop(start.rowSpan + deltaRowSpan, rowStop);
			const cols = clampToStop(start.colSpan + deltaColSpan, colStop);
			// One cue for both axes: this edge has stopped. A diagonal drag pinned
			// on both lights it once, which is the truth — "this is as small as it
			// goes" — rather than two competing signals.
			cardEl?.classList.toggle("at-limit", rows.atLimit || cols.atLimit);
			const next = tryResize(collidableState(id), id, cols.span, rows.span);
			// Reserve BEFORE the preview lands, so the frame that shrinks the card
			// never presents the browser with a shorter canvas to clamp against.
			reach = reservedReach(reach, next);
			holdFloor(canvasEl, scroller, reach + 1);
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
			// NOT a removal. Dropping the reservation outright lets the canvas snap
			// back to the content height, and the browser then clamps scrollTop to
			// fit — sliding the whole view by the distance from the pointer to the
			// bottom of the viewport (reported 2026-08-05: "when you shrink the
			// camera the screen position jumps"). Receding to what the view actually
			// needs moves nothing; see settleFloor.
			settleFloor(unit);
			cardEl?.classList.remove("at-limit");
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			persist(state(), "operator-gesture");
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	};

	const reset = (): void => {
		// WRITTEN, not removed (#87 requirement 2). Removing the key made a
		// deliberately cleared canvas byte-identical to a browser that had
		// never opened this screen — and the seed-from-overlay path then
		// restored the card's saved layout on the next mount, undoing the
		// reset. `cleared` is the positive record of the operator's act, the
		// same move #86 made for a removed card one layer up. It is written
		// under the CURRENT basis, so a layout saved to the card after this
		// reset still supersedes it, which is right: that is a newer fact
		// about the screen than this clear.
		// The marks go with the geometry. Reset means "back to the coded
		// layout", and a mark is a claim about a span the operator chose — there
		// are none left to claim once every rect is the coded one.
		sizedNow.clear();
		keys.set("layout", serializeCanvas({}, basisNow, sizedNow, true));
		lastPersisted = defaultCanvas(defaults);
		setState(lastPersisted);
		keys.remove("orientation");
		setOrientationState({});
		// Reset is "back to the default layout" — remembered hidden spots are
		// part of the deviation it clears.
		keys.remove("parked");
		setParked({});
	};

	// Storage is rewritten by replaceScreenLayout; this updates the state
	// already in memory, because importing the screen you are LOOKING at does
	// not change the route and so never remounts.
	const adoptLayout = (rects: CanvasState, orientations?: OrientationState): void => {
		persist(sanitizeCanvas(rects), "operator-gesture");
		persistParked({});
		// The incoming layout brings its own directions; it does not inherit
		// the replaced layout's, and it does not lose its own either.
		const next = orientations ?? {};
		setOrientationState(next);
		if (Object.keys(next).length === 0) keys.remove("orientation");
		else keys.set("orientation", serializeOrientationState(next));
	};

	const resetSlot = (id: string): void => {
		const coded = defaults.find(d => d.id === id);
		if (coded === undefined) return;
		persist({ ...state(), [id]: clampRect({ col: coded.col, row: coded.row, colSpan: coded.colSpan, rowSpan: coded.rowSpan }) }, "operator-gesture");
		// A slot's remembered hidden spot and its content direction are part of
		// the deviation being undone, same as in reset() — but only this one's.
		const nextParked = { ...parked() };
		delete nextParked[id];
		persistParked(nextParked);
		const nextOrientation = { ...orientationState() };
		delete nextOrientation[id];
		setOrientationState(nextOrientation);
		keys.set("orientation", serializeOrientationState(nextOrientation));
	};

	return {
		styleFor, startMove, startResize, reset, orientationFor, toggleOrientation,
		slotIds, ensureSlot, removeSlot, adoptLayout, resetSlot,
		labelsFor, toggleLabels,
		isSelected, toggleSelected, clearSelection, selectedCount: () => selected().size,
	};
}

/**
 * Read a canvas's persisted state without a controller (the SD-capture path:
 * Save-to-machine snapshots every screen's current local geometry into the
 * config overlay). Same parse + migrations the controller uses; null when
 * nothing (usable) is stored.
 *
 * `canvasStorageKey` (a bare string template) is gone — a screen's canvas
 * bytes belong to whichever machine they were laid out on, so the ONLY way
 * to name a screen's canvas record now is `machineCanvasKeys(store,
 * screenId)`, built by the caller and threaded through these three
 * functions rather than assembled here from a raw key.
 */

/**
 * Overwrite a screen's remembered geometry, mounted or not.
 *
 * NOT for general use — reach for replaceScreenLayout (compose/screens.ts),
 * which writes this AND the config overlay together. A layout written to only
 * one of the two stores is the bug this exists to prevent.
 */
/**
 * Re-stamp a screen's stored canvas with the basis it has just been reconciled
 * against, leaving its geometry alone.
 *
 * Save to machine (`captureScreenGeometry`) copies the canvas INTO the overlay,
 * so afterwards the two stores agree — but the canvas record still names the
 * older layout it was built from, and the next mount would read that as "this
 * browser is stale", discard a canvas identical to the overlay, and tell the
 * operator a layout was dropped when none was. Saving IS a reconciliation, so
 * it records one.
 */
export function restampCanvas(store: MachineStore, screenId: string, basis: string): void {
	const keys = machineCanvasKeys(store, screenId);
	const record = readStoredCanvasRecord(keys.get("layout"));
	if (record.state === null && !record.cleared) return;
	// The marks are geometry provenance, not basis provenance: a re-stamp says
	// which saved layout this record was reconciled against and changes not one
	// rect, so who sized those rects is exactly as true afterwards.
	keys.set("layout", serializeCanvas(sanitizeCanvas(record.state), basis, record.sized, record.cleared ? true : undefined));
}

export function writeCanvasState(store: MachineStore, screenId: string, rects: CanvasState, orientations: OrientationState | undefined, basis: string): void {
	const keys = machineCanvasKeys(store, screenId);
	// Every id in an IMPORTED layout is operator-sized. An import is a layout a
	// person chose and applied wholesale — the same standing as a save to the
	// card — so its spans are nobody's coded default to raise.
	keys.set("layout", serializeCanvas(sanitizeCanvas(rects), basis, new Set(Object.keys(rects))));
	// Parked spots describe the layout being REPLACED — a hidden card's
	// remembered position from the old layout would drop it somewhere
	// arbitrary in the new one.
	keys.remove("parked");
	// Orientation, by contrast, belongs to the incoming layout and arrives
	// WITH it (it is part of the slot). Deleting it unconditionally is what
	// made an import reset every card's direction.
	const next = orientations ?? {};
	if (Object.keys(next).length === 0) keys.remove("orientation");
	else keys.set("orientation", serializeOrientationState(next));
}

/** A screen's stored orientations, for capture into the config overlay. */
export function readCanvasOrientation(store: MachineStore, screenId: string): OrientationState {
	return parseOrientationState(machineCanvasKeys(store, screenId).get("orientation"));
}

export function readCanvasState(store: MachineStore, screenId: string): CanvasState | null {
	const parsed = parseStoredCanvas(machineCanvasKeys(store, screenId).get("layout"));
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
	const out: CanvasState = {};
	for (const [id, rect] of safeEntries(parsed as Record<string, unknown>)) {
		if (isPanelRect(rect)) out[id] = clampRect(rect);
	}
	return Object.keys(out).length > 0 ? out : null;
}
