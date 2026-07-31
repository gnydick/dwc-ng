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
import { safeEntries } from "../util/safeObject.ts";

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
 * How many PIXELS one stored row unit renders as at the current density pitch.
 *
 * ROW_UNIT_PX above is the unit stored geometry is WRITTEN IN — a card's
 * rowSpan, the sizes in compose/defs.ts, the row-granularity migration. That
 * number is frozen: it defines the saved format, and a format whose meaning
 * depends on a display preference is not a format.
 *
 * This is the unit geometry is DRAWN IN, and it tracks the pitch. Density
 * shrinks the spacing inside a card but used to leave the card's box alone, so
 * every card kept the height it had at 1.27 while its contents pulled away from
 * the bottom edge — measured on the Control screen, the cards' content fell to
 * 0.63–0.73 of its default-pitch height while the boxes did not move at all.
 * Tightening the pitch therefore meant re-dragging every card by hand. Scaling
 * the DRAWN unit instead means the stored layout is never touched and every
 * card scales at once.
 *
 * The value lives in index.css beside the other density tokens, so the
 * stylesheet stays the single authority on what a pitch IS (see
 * shell/density.ts) and this cannot drift from the spacing it has to match.
 *
 * Deliberately CONSERVATIVE — the least-shrinking card sets it, not the
 * average. Cards shrink at different rates (a card is n control-heights plus
 * fixed chrome, so its ratio depends on n), and one unit cannot be right for
 * all of them. Erring large leaves some slack; erring small CLIPS, and a
 * clipped control is not a cosmetic problem. Measured maxima excluding the
 * console: 0.867 at 0.80, 0.733 at 0.50, 0.700 at 0.40.
 */
export function rowUnitPx(): number {
	if (typeof document === "undefined") return ROW_UNIT_PX;
	const raw = getComputedStyle(document.documentElement).getPropertyValue("--row-unit");
	const px = parseFloat(raw);
	// A stylesheet that hasn't loaded, or a pitch block missing the token, must
	// fall back to the stored unit rather than to NaN — which would silently
	// collapse every card to a single row.
	return Number.isFinite(px) && px > 0 ? px : ROW_UNIT_PX;
}
/** Both gutters now live on the card, not on the grid — see GRID_COLS. */
export const GAP_PX = 0;
/** Fixed column width (matches app.css's .panel-canvas grid-template-columns)
 *  — columns don't scale with viewport width, so a card's pixel size only
 *  ever depends on its own colSpan. A narrower window scrolls horizontally
 *  instead of shrinking every card to fit. */
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
	 * pitch-correct for free: the row unit shrinks with the density (see
	 * rowUnitPx), so a span floor is physically smaller at a tighter pitch —
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
	for (const [otherId, otherRect] of Object.entries(state)) {
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
	// SUMMED, not taken from the lowest child's offset. Offsets are where things
	// sit RIGHT NOW, so a filler child that is currently 189px tall pushes every
	// sibling below it down by 189 and the card measures its own height back as
	// its minimum — even with that child's own height correctly counted as zero.
	// The console proved it: history counted 0, and the card still reported
	// rowStop 75 against a span of 75, so it could not be dragged shorter at all.
	// Stacking the children's own heights asks the right question — "how tall is
	// this content" — instead of "where does it currently end".
	let contentBottom = 0;
	for (const child of Array.from(body.children)) {
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
		// An AUTO margin is slack, not content, and must contribute nothing.
		//
		// getComputedStyle resolves `margin: auto` to its USED value, so once the
		// card header took `margin-bottom: auto` to push contents to the bottom,
		// this loop started adding the card's own free space to its own content
		// sum — 333px of it on the sensors card. The reported minimum then equalled
		// the card's current height, so cards grew and would not shrink back
		// (reported 2026-07-30). That is exactly the self-reference Invariant A
		// exists to detect, introduced hours after the detector was built.
		//
		// The keyword is unrecoverable from the used value, so the rule that
		// creates the slack DECLARES it: --absorbs-slack: 1 travels with the
		// `margin: auto` in the same declaration block, and the two cannot drift
		// apart the way a selector list here would.
		const absorbsSlack = style.getPropertyValue("--absorbs-slack").trim() === "1";
		contentBottom += height
			+ (absorbsSlack ? 0 : (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0));
	}
	const bodyStyle = getComputedStyle(body);
	// The gaps a flex/grid body puts BETWEEN its children are part of the stack.
	const rowGap = parseFloat(bodyStyle.rowGap);
	const spans = Math.max(0, body.children.length - 1);
	if (Number.isFinite(rowGap)) contentBottom += rowGap * spans;
	contentBottom += (parseFloat(bodyStyle.paddingTop) || 0) + (parseFloat(bodyStyle.paddingBottom) || 0);
	// The card's chrome around the body's content box (borders, outer padding)
	// — measured, not assumed, and size-invariant since card and body grow
	// together. Card border-box height == rowUnitPx()*rowSpan - gutter.
	//
	// rowUnitPx(), not the constant: this converts MEASURED PIXELS into stored
	// row units, and how many pixels a unit draws as depends on the pitch. With
	// the constant, a fit measured at 0.50 would come back ~33% too large and
	// the resize stop would refuse to let the card near its own content.
	const chrome = cardEl.getBoundingClientRect().height - body.clientHeight;
	return Math.max(1, Math.ceil((contentBottom + chrome + gutterPx) / rowUnitPx()));
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
	return Math.max(1, Math.ceil((intrinsicWidthPx(body, "min-content") + chrome + gutterPx) / COL_UNIT_PX));
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
	return Math.max(1, Math.ceil((intrinsicWidthPx(head, "min-content") + chrome + gutterPx) / COL_UNIT_PX));
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
 * A stored rect whose SPAN the composition has since grown adopts the larger
 * span (growToDefaults) and the cards it now overlaps are pushed clear
 * (reflow) — otherwise a card redesigned to be taller stays at its old height
 * on every browser that has ever laid the screen out, and its new content
 * renders below the fold with no way out but Reset Layout. Observed
 * 2026-07-24: position 95 -> 103 and active-job 40 -> 46 changed nothing on a
 * machine with a stored canvas.
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

/**
 * Adopt any span the composition has GROWN since this browser last stored a
 * layout, per axis, without moving anything.
 *
 * Grow-only by decision (spec D1): position is never touched, and a span the
 * user enlarged past the coded default is kept, so an ordinary load changes
 * nothing. The accepted cost is that a card deliberately shrunk below its
 * default (via the detent breakaway) is grown back the next time that default
 * moves — stored spans carry no record of who set them, so the two cases are
 * indistinguishable here.
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
		// The STORED size wins outright. This used to be
		// Math.max(entry, coded) per axis, so a card could never be smaller than
		// its coded default across a reload: shrink it, reload, and it sprang
		// back — growing was remembered and shrinking was not (reported
		// 2026-07-30, Tools & heaters at rowSpan 77 against a coded 110).
		//
		// The max existed so a card that GAINED content in a release would adopt
		// the bigger coded size instead of clipping. That is now covered better
		// by the thing that actually knows: the resize stop measures content and
		// refuses to go under it, so any size the operator can set already
		// contains what the card draws. A default is a starting point for a card
		// that has none — see the `added` pass below — not a floor under one the
		// operator has already placed.
		state[d.id] = clampRect(entry);
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
 * Terminates: every push strictly increases col or row; col is bounded by
 * GRID_COLS and forces the down branch once a rightward push no longer fits,
 * and a row below every placed rect is always free — the same argument
 * slideDownToFree rests on. Idempotent: the output is collision-free, so a
 * second pass never enters the push loop.
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
	for (const [id, r] of Object.entries(state)) {
		out[id] = { col: 0, row: 0, colSpan: r.colSpan, rowSpan: r.rowSpan };
	}
	return out;
}

export function mergeCanvas(stored: unknown, defaults: PanelDefault[]): CanvasState {
	const { state, grew } = growToDefaults(stored, defaults);
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
export function createPanelCanvas(
	storageKey: string,
	defaults: PanelDefault[],
	isActive?: (id: string) => boolean,
	/**
	 * Called whenever this canvas's geometry changes. A screen passes the
	 * config store's markLayoutDirty, because a moved card is an unsaved
	 * change and Save to machine is gated on the dirty flag — without this a
	 * rearranged screen could never be pushed to the SD card at all. Surfaces
	 * whose geometry is device-only (the Card Lab) pass nothing.
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
): PanelCanvasController {
	const [state, setState] = createSignal(
		bench === true
			? benchOrigin(growToDefaults(parseStoredCanvas(readStorage(storageKey)), defaults).state)
			: mergeCanvas(parseStoredCanvas(readStorage(storageKey)), defaults),
	);
	// Settle a redesign repair once rather than recomputing it on every load.
	// Deliberately NOT persist(): that fires onLayoutChange -> markLayoutDirty,
	// and a repair is not a user edit — nor is mutating the config store during
	// signal initialisation safe. Correctness never depends on this landing:
	// growToDefaults + reflow are deterministic and idempotent, so a browser
	// where writeStorage no-ops (private mode, quota) rebuilds the identical
	// layout every time.
	writeStorage(storageKey, serializeCanvas(state()));

	const orientationStorageKey = `${storageKey}.orientation`;
	// Stored wins (this browser's own toggles); otherwise seed from the
	// composition, which is how orientation reaches a browser that has never
	// seen this screen — the same tiering geometry uses.
	const [orientationState, setOrientationState] = createSignal(((): OrientationState => {
		const stored = parseOrientationState(readStorage(orientationStorageKey));
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
	const parkedKey = `${storageKey}.parked`;
	const [parked, setParked] = createSignal<CanvasState>(sanitizeCanvas(parseStoredCanvas(readStorage(parkedKey))));

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
		writeStorage(parkedKey, serializeCanvas(next));
	};

	const persist = (next: CanvasState): void => {
		setState(next);
		writeStorage(storageKey, serializeCanvas(next));
		onLayoutChange?.();
	};

	// Hidden labels, stored as the EXCEPTION set rather than a value per card:
	// labels are on unless a slot says otherwise, so a card added later is
	// labelled by default and an empty store means "everything as shipped".
	const labelsStorageKey = `${storageKey}.nolabels`;
	const [hiddenLabels, setHiddenLabels] = createSignal<ReadonlySet<string>>(((): ReadonlySet<string> => {
		try {
			const raw = readStorage(labelsStorageKey);
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
		writeStorage(labelsStorageKey, JSON.stringify([...next]));
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
		// Read ONCE per drag, not per frame: it cannot change while a pointer is
		// down, and getComputedStyle in a rAF loop is a style flush per frame.
		const unitPx = rowUnitPx();
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
			const deltaCol = Math.round((pointerX - originX) / (COL_UNIT_PX + GAP_PX));
			const deltaRow = Math.round((effectiveY - originY) / (unitPx + ROW_GAP_PX));
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
				persist(lastPatch === null ? state() : { ...state(), ...lastPatch });
				// The formation has landed. Keeping it lit would make the next
				// unrelated drag pick all of them up again.
				clearSelection();
			} else {
				persist({ ...state(), [id]: lastValid });
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
		const footPx = cardEl?.querySelector<HTMLElement>(".panel-resize-grip")?.getBoundingClientRect().height ?? 0;
		const floorPx = (headPx + footPx) * 1.5;
		// Read once per drag; same reason as startMove. Both floors are measured
		// in pixels and converted here, so both track the pitch: at a tighter
		// pitch the header is shorter AND the unit is smaller, and the stop
		// stays the same physical size rather than drifting.
		const unitPx = rowUnitPx();
		const hardFloor = Math.max(1, Math.ceil((floorPx + gutterPx) / unitPx));
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
			const deltaRowSpan = Math.round((effectiveY - originY) / (unitPx + ROW_GAP_PX));
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
			cardEl?.classList.remove("at-limit");
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
	const adoptLayout = (rects: CanvasState, orientations?: OrientationState): void => {
		persist(sanitizeCanvas(rects));
		persistParked({});
		// The incoming layout brings its own directions; it does not inherit
		// the replaced layout's, and it does not lose its own either.
		const next = orientations ?? {};
		setOrientationState(next);
		if (Object.keys(next).length === 0) removeStorage(orientationStorageKey);
		else writeStorage(orientationStorageKey, serializeOrientationState(next));
	};

	const resetSlot = (id: string): void => {
		const coded = defaults.find(d => d.id === id);
		if (coded === undefined) return;
		persist({ ...state(), [id]: clampRect({ col: coded.col, row: coded.row, colSpan: coded.colSpan, rowSpan: coded.rowSpan }) });
		// A slot's remembered hidden spot and its content direction are part of
		// the deviation being undone, same as in reset() — but only this one's.
		const nextParked = { ...parked() };
		delete nextParked[id];
		persistParked(nextParked);
		const nextOrientation = { ...orientationState() };
		delete nextOrientation[id];
		setOrientationState(nextOrientation);
		writeStorage(orientationStorageKey, serializeOrientationState(nextOrientation));
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
export function writeCanvasState(storageKey: string, rects: CanvasState, orientations?: OrientationState): void {
	writeStorage(storageKey, serializeCanvas(sanitizeCanvas(rects)));
	// Parked spots describe the layout being REPLACED — a hidden card's
	// remembered position from the old layout would drop it somewhere
	// arbitrary in the new one.
	removeStorage(`${storageKey}.parked`);
	// Orientation, by contrast, belongs to the incoming layout and arrives
	// WITH it (it is part of the slot). Deleting it unconditionally is what
	// made an import reset every card's direction.
	const next = orientations ?? {};
	if (Object.keys(next).length === 0) removeStorage(`${storageKey}.orientation`);
	else writeStorage(`${storageKey}.orientation`, serializeOrientationState(next));
}

/** A screen's stored orientations, for capture into the config overlay. */
export function readCanvasOrientation(storageKey: string): OrientationState {
	return parseOrientationState(readStorage(`${storageKey}.orientation`));
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
