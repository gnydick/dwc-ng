# Grid Canvas Panel Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed-2-column panel system (Tasks 1-7 of the same-day `2026-07-17-rearrangeable-panels.md` plan) with a 24-column collision-based grid canvas: panels sit at explicit `(col, row, colSpan, rowSpan)`, move only into empty space, resize only until blocked, settle into freed space after a move — and console/camera stop being global floating overlays and become regular per-view panels.

**Architecture:** A pure, unit-tested collision/placement engine (`panelCanvas.ts`) underneath a Solid reactive primitive (`createPanelCanvas`), consumed by a rewritten `Panel.tsx` + new `PanelCanvas.tsx` grid container. `ConsolePanel.tsx`/`CameraPanel.tsx` extract the existing console/camera markup out of `Shell.tsx` so every view can place them as ordinary panels. All six views get rewired; `panelLayout.ts`, `floatingTile.ts`, and the old `.grid`-based CSS are deleted.

**Tech Stack:** SolidJS + TypeScript, hand-rolled CSS, `node:test`, Chrome browser automation for live verification against `mock-duet`. No new dependencies.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-17-grid-canvas-design.md` (committed `b7b3dac`) — read it first.
- Never destructure props — use `props.x`.
- Use `<Show>`/`<For>`/`<Switch>` for conditional/list rendering, not early returns or `.map` in JSX.
- **A move never displaces another panel** — it only commits if the target rect collides with nothing and stays in bounds; otherwise it's rejected (the panel stays put).
- **A resize never displaces another panel** — it grows one cell at a time, hard-stopped at the first collision or grid boundary.
- **Settle (compaction) only runs after a move commits, never after a resize.** Single deterministic pass, panels processed in ascending `(row, col)` order, each rising then drifting left as far as clear space allows relative to already-settled panels.
- Grid: `repeat(24, minmax(0, 1fr))` columns (`GRID_COLS = 24`), fixed `24px` rows (`ROW_UNIT_PX = 24`), `6px` gap (`GAP_PX = 6`). Rows are unbounded.
- Every view's default panel set is collision-free by construction — verified by a unit test per view asserting `hasCollisions(defaultCanvas(VIEW_DEFAULTS)) === false`.
- localStorage per view (`dwc-ng.canvas.<view>`), tolerant parse/merge/clamp: wrong-shape stored data, or stored data that collides once merged, falls back to the view's full coded defaults (never a partial repair).
- Run `pnpm --filter @dwc-ng/ui test` after every task; all tests must stay green. Run `node ../../node_modules/typescript/bin/tsc -b` from `packages/ui` for typecheck — 3 pre-existing errors predate this work (`writeGuard.ts:48`, `editor/setup.ts:11`, `Shell.tsx` unused `app` var — this last one disappears once Task 4 removes the unused `app` from `Shell()`, so after Task 4 expect only 2 pre-existing errors); do not introduce new ones beyond that.
- Live verification uses `mock-duet` (`node src/cli.ts --snapshot ../mock-duet/captures/om-snapshot-2026-07-12.json`, from `packages/mock-duet`, port 8970) and the Vite dev server (`pnpm --filter @dwc-ng/ui dev`, port 5173). **Always confirm the backend toggle reads `MOCK` before interacting** — it's shared `localStorage` across every tab on `localhost:5173`, and `REAL` means the physical printer.
- When a task instructs you to preserve a view's existing inner panel content unchanged, Read the current file first — the plan gives you the new header/wrapper code and the exact panel `id`s in order; the JSX *inside* each existing `<Panel>`/`<section>` is copied verbatim from what's already in the file, not retyped from memory.

---

### Task 1: `panelCanvas.ts` — collision, move, resize, settle, persistence

**Files:**
- Create: `packages/ui/src/shell/panelCanvas.ts`
- Test: `packages/ui/test/panel-canvas.test.ts`

**Interfaces:**
- Produces: `GRID_COLS = 24`, `ROW_UNIT_PX = 24`, `GAP_PX = 6`, `PanelRect { col: number; row: number; colSpan: number; rowSpan: number }`, `CanvasState = Record<string, PanelRect>`, `PanelDefault extends PanelRect { id: string }`, `clampRect(rect: PanelRect): PanelRect`, `rectsOverlap(a: PanelRect, b: PanelRect): boolean`, `collidesWithAny(state: CanvasState, id: string, rect: PanelRect): boolean`, `hasCollisions(state: CanvasState): boolean`, `inBounds(rect: PanelRect): boolean`, `tryMove(state: CanvasState, id: string, candidateCol: number, candidateRow: number): PanelRect | null`, `tryResize(state: CanvasState, id: string, desiredColSpan: number, desiredRowSpan: number): PanelRect`, `settle(state: CanvasState): CanvasState`, `defaultCanvas(defaults: PanelDefault[]): CanvasState`, `parseStoredCanvas(raw: string | null): unknown`, `serializeCanvas(state: CanvasState): string`, `mergeCanvas(stored: unknown, defaults: PanelDefault[]): CanvasState`. Task 2 builds `createPanelCanvas` on top of these; every view's `PANEL_DEFAULTS` array (Tasks 5-10) uses `PanelDefault`.

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/test/panel-canvas.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	GRID_COLS, clampRect, rectsOverlap, collidesWithAny, hasCollisions, inBounds,
	tryMove, tryResize, settle, defaultCanvas, parseStoredCanvas, serializeCanvas, mergeCanvas,
} from "../src/shell/panelCanvas.ts";

const rect = (col: number, row: number, colSpan: number, rowSpan: number) => ({ col, row, colSpan, rowSpan });

test("clampRect clamps span/position into bounds and falls back to safe values on non-finite input", () => {
	assert.deepEqual(clampRect(rect(0, 0, 1, 1)), rect(0, 0, 1, 1));
	assert.deepEqual(clampRect(rect(20, 0, 10, 1)), rect(14, 0, 10, 1), "col pulled back so col+colSpan stays <= GRID_COLS");
	assert.deepEqual(clampRect(rect(0, 0, 30, 1)), rect(0, 0, GRID_COLS, 1), "colSpan clamped to GRID_COLS");
	assert.deepEqual(clampRect(rect(-5, -5, 1, 1)), rect(0, 0, 1, 1), "negative col/row clamp to 0");
	assert.deepEqual(clampRect(rect(0, 0, 0, 0)), rect(0, 0, 1, 1), "span below 1 clamps to 1");
	assert.deepEqual(clampRect({ col: Number.NaN, row: Number.NaN, colSpan: Number.NaN, rowSpan: Number.NaN }), rect(0, 0, 1, 1));
});

test("rectsOverlap detects overlap and touching-but-not-overlapping edges", () => {
	assert.equal(rectsOverlap(rect(0, 0, 2, 2), rect(1, 1, 2, 2)), true);
	assert.equal(rectsOverlap(rect(0, 0, 2, 2), rect(2, 0, 2, 2)), false, "touching edge, not overlapping");
	assert.equal(rectsOverlap(rect(0, 0, 2, 2), rect(0, 2, 2, 2)), false, "touching edge vertically");
	assert.equal(rectsOverlap(rect(0, 0, 5, 5), rect(1, 1, 1, 1)), true, "fully contained counts as overlap");
});

test("collidesWithAny ignores the panel's own id and checks every other panel", () => {
	const state = { a: rect(0, 0, 2, 2), b: rect(5, 5, 2, 2) };
	assert.equal(collidesWithAny(state, "a", rect(0, 0, 2, 2)), false, "a against its own unchanged rect, excluded");
	assert.equal(collidesWithAny(state, "a", rect(5, 5, 2, 2)), true, "a's candidate collides with b");
	assert.equal(collidesWithAny(state, "c", rect(0, 0, 2, 2)), true, "a new id c colliding with existing a");
});

test("hasCollisions scans every pair", () => {
	assert.equal(hasCollisions({ a: rect(0, 0, 2, 2), b: rect(5, 5, 2, 2) }), false);
	assert.equal(hasCollisions({ a: rect(0, 0, 2, 2), b: rect(1, 1, 2, 2) }), true);
	assert.equal(hasCollisions({}), false);
	assert.equal(hasCollisions({ a: rect(0, 0, 2, 2) }), false);
});

test("inBounds rejects negative col/row and columns past GRID_COLS", () => {
	assert.equal(inBounds(rect(0, 0, GRID_COLS, 1)), true);
	assert.equal(inBounds(rect(1, 0, GRID_COLS, 1)), false, "1 + 24 > GRID_COLS");
	assert.equal(inBounds(rect(-1, 0, 1, 1)), false);
	assert.equal(inBounds(rect(0, -1, 1, 1)), false);
	assert.equal(inBounds(rect(0, 1000, 1, 1)), true, "rows are unbounded above");
});

test("tryMove commits only when the target is in bounds and collision-free", () => {
	const state = { a: rect(0, 0, 4, 4), b: rect(10, 10, 4, 4) };
	assert.deepEqual(tryMove(state, "a", 5, 5), rect(5, 5, 4, 4), "free space, keeps a's own span");
	assert.equal(tryMove(state, "a", 10, 10), null, "would collide with b");
	assert.equal(tryMove(state, "a", 22, 0), null, "22 + 4 > GRID_COLS, out of bounds");
	assert.equal(tryMove(state, "a", 0, -3), null, "negative row rejected outright, not clamped");
	assert.equal(tryMove(state, "ghost", 0, 0), null, "unknown id");
});

test("tryResize grows one cell at a time and stops at the first collision or boundary", () => {
	const state = { a: rect(0, 0, 4, 4), blockerRight: rect(10, 0, 4, 4), blockerBelow: rect(0, 10, 4, 4) };
	assert.deepEqual(tryResize(state, "a", 8, 4), rect(0, 0, 8, 4), "grows freely up to the desired span");
	assert.deepEqual(tryResize(state, "a", 20, 4), rect(0, 0, 10, 4), "stopped by blockerRight at col 10");
	assert.deepEqual(tryResize(state, "a", 4, 20), rect(0, 0, 4, 10), "stopped by blockerBelow at row 10");
	assert.deepEqual(tryResize(state, "a", 30, 4), rect(0, 0, GRID_COLS, 4), "also can't exceed the grid boundary");
	assert.deepEqual(tryResize(state, "a", 1, 1), rect(0, 0, 1, 1), "shrinking is always safe, never blocked");
});

test("settle rises then drifts left, processed in (row, col) order, only against already-settled panels", () => {
	// b sits directly below a with a gap; moving a away should let b rise into the freed space.
	const state = { a: rect(0, 10, 4, 4), b: rect(0, 20, 4, 4) };
	const settled = settle(state);
	assert.deepEqual(settled.a, rect(0, 0, 4, 4), "a rises to the top, nothing above it");
	assert.deepEqual(settled.b, rect(0, 4, 4, 4), "b rises to rest just below settled a, not through it");
});

test("settle drifts left after rising, stopping against an already-settled neighbor", () => {
	const state = { a: rect(0, 0, 4, 4), b: rect(10, 0, 4, 4) };
	const settled = settle(state);
	assert.deepEqual(settled.a, rect(0, 0, 4, 4));
	assert.deepEqual(settled.b, rect(4, 0, 4, 4), "b drifts left to rest against a, not through it");
});

test("defaultCanvas orders by the defaults array and clamps each rect", () => {
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: 4, rowSpan: 4 }, { id: "b", col: 30, row: 0, colSpan: 4, rowSpan: 4 }];
	const canvas = defaultCanvas(defaults);
	assert.deepEqual(canvas.a, rect(0, 0, 4, 4));
	assert.deepEqual(canvas.b, rect(20, 0, 4, 4), "out-of-bounds default col gets clamped");
});

test("parseStoredCanvas tolerates missing or corrupt storage", () => {
	assert.equal(parseStoredCanvas(null), null);
	assert.equal(parseStoredCanvas(""), null);
	assert.equal(parseStoredCanvas("{not json"), null);
});

test("mergeCanvas falls back to defaults when storage is corrupt, empty, or the wrong shape", () => {
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: 4, rowSpan: 4 }];
	assert.deepEqual(mergeCanvas(null, defaults), defaultCanvas(defaults));
	assert.deepEqual(mergeCanvas("a string", defaults), defaultCanvas(defaults));
	assert.deepEqual(mergeCanvas(42, defaults), defaultCanvas(defaults));
});

test("mergeCanvas keeps a valid stored rect for a known id, clamped", () => {
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: 4, rowSpan: 4 }];
	const stored = { a: rect(2, 3, 30, 2) };
	assert.deepEqual(mergeCanvas(stored, defaults).a, rect(2, 3, 22, 2), "stored position kept, oversized span clamped");
});

test("mergeCanvas drops a stored id no longer in defaults and defaults a new id missing from storage", () => {
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: 4, rowSpan: 4 }, { id: "b", col: 10, row: 0, colSpan: 4, rowSpan: 4 }];
	const stored = { a: rect(1, 1, 4, 4), ghost: rect(0, 0, 1, 1) };
	const merged = mergeCanvas(stored, defaults);
	assert.deepEqual(Object.keys(merged).sort(), ["a", "b"]);
	assert.deepEqual(merged.a, rect(1, 1, 4, 4));
	assert.deepEqual(merged.b, rect(10, 0, 4, 4), "b missing from storage, uses its own coded default");
});

test("mergeCanvas discards the whole stored layout, not just the offending panel, if the merged result collides", () => {
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: 4, rowSpan: 4 }, { id: "b", col: 10, row: 0, colSpan: 4, rowSpan: 4 }];
	const stored = { a: rect(0, 0, 4, 4), b: rect(1, 1, 4, 4) }; // b now overlaps a
	assert.deepEqual(mergeCanvas(stored, defaults), defaultCanvas(defaults));
});

test("serializeCanvas round-trips through parseStoredCanvas and mergeCanvas", () => {
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: 4, rowSpan: 4 }];
	const canvas = defaultCanvas(defaults);
	assert.deepEqual(mergeCanvas(parseStoredCanvas(serializeCanvas(canvas)), defaults), canvas);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @dwc-ng/ui test`
Expected: FAIL — `panel-canvas.test.ts` errors with a module-not-found for `../src/shell/panelCanvas.ts`. Pre-existing tests still pass.

- [ ] **Step 3: Write the minimal implementation**

Create `packages/ui/src/shell/panelCanvas.ts`:

```ts
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
	if (candidateRow < 0) return null;
	const candidate: PanelRect = { col: candidateCol, row: candidateRow, colSpan: current.colSpan, rowSpan: current.rowSpan };
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @dwc-ng/ui test`
Expected: PASS — all new `panel-canvas.test.ts` tests green, plus every pre-existing test.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/shell/panelCanvas.ts packages/ui/test/panel-canvas.test.ts
git commit -m "feat(ui): 24-column collision-based grid canvas engine

Pure, unit-tested foundation replacing panelLayout.ts's fixed-2-column
order+span model: explicit (col,row,colSpan,rowSpan) per panel, collision-
blocked move (rejected if it would overlap or run off-grid) and resize
(grows one cell at a time, stops at the first collision or boundary), and
a settle pass that pulls panels up-then-left into space freed by a move
(never triggered by a resize). Tolerant load/merge discards the whole
stored layout in favor of defaults if it would ever collide, rather than
partially repairing it. Not yet wired to any UI."
```

---

### Task 2: `createPanelCanvas` reactive primitive + `Panel.tsx`/`PanelCanvas.tsx` rewrite

**Files:**
- Modify: `packages/ui/src/shell/panelCanvas.ts` (append the reactive primitive)
- Modify: `packages/ui/src/shell/Panel.tsx` (rewrite to use it)
- Create: `packages/ui/src/shell/PanelCanvas.tsx`
- Modify: `packages/ui/src/app.css` (replace `.grid`/`.panel-grip`/`.panel-resize-grip`/`.layout-toolbar`/`.layout-reset` rules with the new canvas equivalents)

**Interfaces:**
- Consumes: everything from Task 1.
- Produces: `PanelCanvasController { styleFor(id: string): Record<string,string>; startMove(id: string, event: PointerEvent): void; startResize(id: string, event: PointerEvent): void; reset(): void }`, `createPanelCanvas(storageKey: string, defaults: PanelDefault[]): PanelCanvasController`. `Panel(props: { id: string; canvas: PanelCanvasController; ariaLabel: string; class?: string; children: JSX.Element })`. `PanelCanvas(props: { class?: string; children: JSX.Element })` — the `repeat(24, ...)` grid container, a drop-in replacement for `<div class="grid ...">`. Tasks 3-10 all consume these.

- [ ] **Step 1: Append the reactive primitive to `panelCanvas.ts`**

Add this import at the top of `packages/ui/src/shell/panelCanvas.ts`:

```ts
import { createSignal } from "solid-js";
```

Append to the end of the file:

```ts
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
}

/**
 * Per-view grid canvas controller. Call once per view; pass the result to
 * every <Panel> in it. Position/size persist to
 * localStorage["<storageKey>"] and survive reload.
 */
export function createPanelCanvas(storageKey: string, defaults: PanelDefault[]): PanelCanvasController {
	const [state, setState] = createSignal(mergeCanvas(parseStoredCanvas(readStorage(storageKey)), defaults));

	const persist = (next: CanvasState): void => {
		setState(next);
		writeStorage(storageKey, serializeCanvas(next));
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
		let lastValid = start;

		const onMove = (moveEvent: PointerEvent): void => {
			const deltaCol = Math.round((moveEvent.clientX - originX) / (colWidthPx + GAP_PX));
			const deltaRow = Math.round((moveEvent.clientY - originY) / (rowHeightPx + GAP_PX));
			const candidate = tryMove(state(), id, start.col + deltaCol, start.row + deltaRow);
			if (candidate) {
				lastValid = candidate;
				setState({ ...state(), [id]: candidate }); // live preview, not yet persisted
			}
		};
		const onUp = (): void => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			const withMove = { ...state(), [id]: lastValid };
			persist(settle(withMove));
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

		const onMove = (moveEvent: PointerEvent): void => {
			const deltaColSpan = Math.round((moveEvent.clientX - originX) / (colWidthPx + GAP_PX));
			const deltaRowSpan = Math.round((moveEvent.clientY - originY) / (rowHeightPx + GAP_PX));
			const next = tryResize(state(), id, start.colSpan + deltaColSpan, start.rowSpan + deltaRowSpan);
			setState({ ...state(), [id]: next }); // live preview, no settle on resize
		};
		const onUp = (): void => {
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
	};

	return { styleFor, startMove, startResize, reset };
}
```

- [ ] **Step 2: Rewrite `Panel.tsx`**

Replace the entire contents of `packages/ui/src/shell/Panel.tsx`:

```tsx
import type { JSX } from "solid-js";
import type { PanelCanvasController } from "./panelCanvas.ts";

/**
 * Wraps a view's card section so it sits on that view's grid canvas at an
 * explicit (col, row, colSpan, rowSpan). The move/resize grips are small
 * tabs straddling the card's border, independent of whatever a view puts
 * inside — some cards (e.g. System's Editor) don't always render their
 * own card-head.
 */
export function Panel(props: {
	id: string;
	canvas: PanelCanvasController;
	ariaLabel: string;
	class?: string;
	children: JSX.Element;
}) {
	return (
		<section
			class={props.class ? `card panel ${props.class}` : "card panel"}
			aria-label={props.ariaLabel}
			data-panel-id={props.id}
			style={props.canvas.styleFor(props.id)}
		>
			<button
				type="button"
				class="panel-grip"
				title="Drag to move"
				aria-label={`Move ${props.ariaLabel}`}
				onPointerDown={event => props.canvas.startMove(props.id, event)}
			>
				⠿
			</button>
			{props.children}
			<div
				class="panel-resize-grip"
				title="Drag to resize"
				aria-label={`Resize ${props.ariaLabel}`}
				onPointerDown={event => props.canvas.startResize(props.id, event)}
			/>
		</section>
	);
}
```

- [ ] **Step 3: Create `PanelCanvas.tsx`**

Create `packages/ui/src/shell/PanelCanvas.tsx`:

```tsx
import type { JSX } from "solid-js";

/** The 24-column grid container a view renders its <Panel>s into. */
export function PanelCanvas(props: { class?: string; children: JSX.Element }) {
	return (
		<div class={props.class ? `panel-canvas ${props.class}` : "panel-canvas"}>
			{props.children}
		</div>
	);
}
```

- [ ] **Step 4: Replace the old grid/panel CSS in `app.css`**

In `packages/ui/src/app.css`, find the `.grid { ... }` rule (currently around line 136-144, right after the `/* ---------- cards ---------- */` comment) and replace it, together with the `/* ---------- rearrangeable panels ---------- */` block that follows it (the `.card.panel`, `.panel-grip`, `.panel-resize-grip`, `.layout-toolbar`, `.layout-reset` rules), with:

```css
.panel-canvas {
	display: grid;
	grid-template-columns: repeat(24, minmax(0, 1fr));
	grid-auto-rows: 24px;
	gap: 6px;
}

.card.panel { position: relative; }

.panel-grip {
	position: absolute;
	top: -9px;
	right: 10px;
	z-index: 2;
	background: var(--mask-700);
	border: 1px solid var(--hairline);
	border-radius: 4px;
	color: var(--silk-dim);
	font-size: 11px;
	line-height: 1;
	padding: 2px 6px;
	cursor: grab;
	touch-action: none;
}
.panel-grip:hover { color: var(--silk); border-color: var(--copper); }
.panel-grip:active { cursor: grabbing; }

.panel-resize-grip {
	position: absolute;
	right: -1px;
	bottom: -1px;
	width: 16px;
	height: 16px;
	z-index: 2;
	cursor: nwse-resize;
	touch-action: none;
}
.panel-resize-grip::before {
	content: "";
	position: absolute;
	right: 4px;
	bottom: 4px;
	width: 8px;
	height: 8px;
	border-right: 2px solid var(--silk-dim);
	border-bottom: 2px solid var(--silk-dim);
	opacity: 0.5;
}
.panel-resize-grip:hover::before { opacity: 1; border-color: var(--copper-bright); }

.layout-toolbar { display: flex; justify-content: flex-end; margin-bottom: 8px; }
.layout-reset {
	font-family: var(--font-display);
	font-weight: 600;
	font-size: 11px;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--silk-dim);
	padding: 4px 2px;
}
.layout-reset:hover { color: var(--silk); }
```

Also find `.main > .grid { flex: 1; align-content: start; }` (near the top of the file, in the `.main`/`.rail` section) and change the selector to `.main > .panel-canvas { flex: 1; align-content: start; }`.

Also find the mobile breakpoint rule `.grid { grid-template-columns: minmax(0, 1fr); }` (inside the `@media (max-width: 900px)` block) and delete it — the 24-column grid already scales proportionally with viewport width, so no override is needed at the mobile breakpoint (this is a real simplification over the old system, which needed a JS-driven column-count clamp to avoid overflow; a proportional `1fr` grid can't overflow that way).

- [ ] **Step 5: Typecheck and run tests**

Run (from `packages/ui`): `node ../../node_modules/typescript/bin/tsc -b`
Expected: same pre-existing errors as before this task (nothing in this task touches `Shell.tsx`, `writeGuard.ts`, or `editor/setup.ts`), plus no new ones. Note: no view imports the new `Panel`/`PanelCanvas` yet, and the *old* `panelLayout.ts`/views still compile against the old `Panel.tsx` API — **this will break**, because `Panel.tsx` no longer has a `layout` prop. This is expected and temporary: Tasks 5-10 fix each view as they're migrated. If you want a clean intermediate typecheck, that's not achievable until Task 10 finishes — don't chase it here.

Run: `pnpm --filter @dwc-ng/ui test`
Expected: `panel-canvas.test.ts` and all Task 1 tests still pass. Tests for views (none exist as component tests currently) aren't affected.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/shell/panelCanvas.ts packages/ui/src/shell/Panel.tsx packages/ui/src/shell/PanelCanvas.tsx packages/ui/src/app.css
git commit -m "feat(ui): createPanelCanvas + Panel/PanelCanvas rewrite

Panel.tsx now takes a PanelCanvasController (startMove/startResize) instead
of the old order-swap/span-step PanelLayoutController. PanelCanvas.tsx is
the new repeat(24,1fr) grid container replacing the old .grid div. Move
live-previews then settles+persists on drop; resize live-previews then
just persists (no settle) on drop. This intentionally breaks every view
that still imports the old Panel API — expected until Tasks 5-10 migrate
each one."
```

---

### Task 3: `ConsolePanel.tsx` + `CameraPanel.tsx`

**Files:**
- Create: `packages/ui/src/shell/ConsolePanel.tsx`
- Create: `packages/ui/src/shell/CameraPanel.tsx`

**Interfaces:**
- Consumes: `Panel` (Task 2), `useApp` (`../shell/context.ts`).
- Produces: `ConsolePanel(props: { canvas: PanelCanvasController })` and `CameraPanel(props: { canvas: PanelCanvasController })` — each view (Tasks 5-10) renders one of each inside its `<PanelCanvas>`, passing its own canvas controller. `CameraPanel` internally gates on `app.config.config.camera.pinned` (same condition as today) — a view includes `<CameraPanel canvas={canvas} />` unconditionally in its JSX, and the component itself decides whether to render anything.

This extracts `ConsoleHistory`/`ConsoleForm`/the camera body markup out of `Shell.tsx` verbatim (Task 4 removes them from `Shell.tsx`) — read `packages/ui/src/shell/Shell.tsx`'s current `ConsoleHistory`, `ConsoleForm`, and `CameraTile` functions before writing this task; the JSX inside `<ConsolePanel>`/`<CameraPanel>` below is that same markup, just re-hosted inside a `<Panel>` instead of a floating `<aside>`.

- [ ] **Step 1: Create `ConsolePanel.tsx`**

Create `packages/ui/src/shell/ConsolePanel.tsx`:

```tsx
import { For, Show, createEffect, createSignal } from "solid-js";
import { useApp } from "./context.ts";
import { Panel } from "./Panel.tsx";
import type { PanelCanvasController } from "./panelCanvas.ts";

/**
 * Console as a regular panel — no more global docked/floating toggle.
 * Gabe's macros emit M118 messages that are the reason to run them, so the
 * history (localStorage-persisted, see om/consoleLog.ts) stays visible
 * rather than scrolling past in a one-line drawer.
 */
export function ConsolePanel(props: { canvas: PanelCanvasController }) {
	return (
		<Panel id="console" canvas={props.canvas} ariaLabel="Console" class="console-panel">
			<div class="card-head"><h2 class="card-title">Console</h2></div>
			<ConsoleHistory />
			<ConsoleForm />
		</Panel>
	);
}

function ConsoleHistory() {
	const app = useApp();
	let el!: HTMLDivElement;
	// Follow the tail: watching messages arrive is the whole point, and a macro
	// that emits faster than you scroll is useless if it doesn't stick to the end.
	createEffect(() => {
		app.om.console.length; // track
		el.scrollTop = el.scrollHeight;
	});
	return (
		<div class="console-history" ref={el}>
			<Show when={app.om.console.length} fallback={<p class="console-empty">No replies yet.</p>}>
				<For each={app.om.console}>
					{line => (
						<div class="console-line">
							<time>{new Date(line.receivedAt).toLocaleTimeString(undefined, { hour12: false })}</time>
							<span>{line.text}</span>
						</div>
					)}
				</For>
			</Show>
		</div>
	);
}

function ConsoleForm() {
	const app = useApp();
	const [code, setCode] = createSignal("");
	const send = (event: SubmitEvent): void => {
		event.preventDefault();
		const value = code().trim();
		if (value === "") return;
		setCode("");
		void app.connector.sendCode(value).catch(() => undefined);
	};
	return (
		<form class="console-form" onSubmit={send}>
			<input
				type="text"
				placeholder="Send G-code — e.g. M114"
				aria-label="G-code command"
				value={code()}
				onInput={e => setCode(e.currentTarget.value)}
			/>
			<button type="submit">Send</button>
		</form>
	);
}
```

- [ ] **Step 2: Create `CameraPanel.tsx`**

Create `packages/ui/src/shell/CameraPanel.tsx`:

```tsx
import { Show } from "solid-js";
import { useApp } from "./context.ts";
import { Panel } from "./Panel.tsx";
import type { PanelCanvasController } from "./panelCanvas.ts";

/** Camera as a regular panel, gated on the same pinned flag Settings edits. */
export function CameraPanel(props: { canvas: PanelCanvasController }) {
	const app = useApp();
	return (
		<Show when={app.config.config.camera.pinned}>
			<Panel id="camera" canvas={props.canvas} ariaLabel="Camera" class="cam-panel">
				<div class="card-head">
					<h2 class="card-title">Camera</h2>
					<button title="Hide camera" onClick={() => app.config.setCamera({ pinned: false })}>✕</button>
				</div>
				<div class="cam-body">
					<Show
						when={app.config.config.camera.streamUrl !== ""}
						fallback={<span>Set a stream URL in <a href="#/settings">Settings</a></span>}
					>
						<img src={app.config.config.camera.streamUrl} alt="Machine camera stream" />
					</Show>
				</div>
			</Panel>
		</Show>
	);
}
```

- [ ] **Step 3: Add CSS for the console/camera panel bodies**

In `packages/ui/src/app.css`, find the existing `/* ---------- console drawer ---------- */` section (has `.console-history`, `.console-line`, `.console-form`, etc. — these class names are reused verbatim by `ConsolePanel`, no change needed there) and the `/* ---------- camera tile ---------- */` section (`.cam-body`, `.cam-body img`, etc. — also reused as-is). Add just these two new rules near the `.card.panel` rule (from Task 2) to make the console/camera panel bodies fill their card height:

```css
.console-panel .console-history { flex: 1; max-height: none; min-height: 0; margin-bottom: 8px; }
.console-panel { display: flex; flex-direction: column; }
.cam-panel .cam-body { flex: 1; min-height: 0; }
.cam-panel { display: flex; flex-direction: column; }
```

- [ ] **Step 4: Typecheck and run tests**

Run (from `packages/ui`): `node ../../node_modules/typescript/bin/tsc -b`
Expected: same as Task 2's end state (nothing new breaks; `ConsolePanel.tsx`/`CameraPanel.tsx` aren't imported anywhere yet, but must typecheck standalone).

Run: `pnpm --filter @dwc-ng/ui test`
Expected: unchanged from Task 2.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/shell/ConsolePanel.tsx packages/ui/src/shell/CameraPanel.tsx packages/ui/src/app.css
git commit -m "feat(ui): ConsolePanel + CameraPanel

Extracts the console history/form and camera body markup out of Shell.tsx
into two reusable Panel-wrapped components, ready for each view to place
independently on its own grid canvas. Not yet wired into Shell.tsx or any
view — Task 4 removes the old global versions, Tasks 5-10 add these."
```

---

### Task 4: Clean up `Shell.tsx`, delete `floatingTile.ts`, drop dead `consoleLog.ts` exports

**Files:**
- Modify: `packages/ui/src/shell/Shell.tsx`
- Delete: `packages/ui/src/shell/floatingTile.ts`
- Modify: `packages/ui/src/om/consoleLog.ts`
- Modify: `packages/ui/src/app.css` (remove now-dead `.console-drawer`/`.console-tile`/`.cam-tile` positioning rules — keep the class names reused by `ConsolePanel`/`CameraPanel` bodies)

**Interfaces:**
- Consumes: nothing new.
- Produces: `Shell.tsx` keeps only global chrome (nav rail, preflight header, backend toggle, e-stop) and the route switch — no console/camera rendering at all. Tasks 5-10 add `ConsolePanel`/`CameraPanel` to each view directly.

- [ ] **Step 1: Rewrite `Shell.tsx`**

Replace the entire contents of `packages/ui/src/shell/Shell.tsx`:

```tsx
import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js";
import { useApp } from "./context.ts";
import { createRouter, type Route } from "./router.ts";
import {
	BACKENDS, type Backend, rememberBackend,
	currentBackendId, setCurrentBackendId, writesArmed, setWritesArmed,
} from "../dev/backend.ts";
import Machine from "../views/Machine.tsx";
import Control from "../views/Control.tsx";
import Jobs from "../views/Jobs.tsx";
import Macros from "../views/Macros.tsx";
import System from "../views/System.tsx";
import Settings from "../views/Settings.tsx";

const NAV: Array<{ route: Route; label: string }> = [
	{ route: "machine", label: "Machine" },
	{ route: "control", label: "Control" },
	{ route: "jobs", label: "Jobs" },
	{ route: "macros", label: "Macros" },
	{ route: "system", label: "System" },
	{ route: "settings", label: "Settings" },
];

export default function Shell() {
	const app = useApp();
	const route = createRouter();

	const visibleAxes = createMemo(() => app.om.om.move.axes.filter(a => a.visible));
	const unhomedCount = createMemo(() => visibleAxes().filter(a => !a.homed).length);
	const anyHeaterHot = createMemo(() =>
		app.om.om.heat.heaters.some(h => h !== null && h.current >= 45));
	const anyHeaterFault = createMemo(() =>
		app.om.om.heat.heaters.some(h => h !== null && h.state === "fault"));

	const emergencyStop = (): void => {
		// M112 halts immediately; M999 resets so the board comes back
		void app.connector.sendCode("M112").catch(() => undefined);
		void app.connector.sendCode("M999").catch(() => undefined);
	};

	return (
		<div class="app">
			<aside class="rail">
				<div class="wordmark">dwc<span>·</span>ng</div>
				<nav aria-label="Main">
					<For each={NAV}>
						{item => (
							<a href={`#/${item.route}`} aria-current={route() === item.route ? "page" : undefined}>
								{item.label}
							</a>
						)}
					</For>
				</nav>
				<p class="machine-id">
					<Show when={app.om.om.boards[0]}>
						{board => <>{board().name}<br /></>}
					</Show>
					<Switch fallback="RRF">
						<Match when={app.om.connection.emulated === true}>SBC · DSF</Match>
						<Match when={app.om.connection.emulated === false}>RRF · standalone</Match>
					</Switch>
				</p>
			</aside>

			<div class="main">
				<header class="preflight" aria-label="Machine preflight">
					<Switch>
						<Match when={app.om.connection.status === "connected"}>
							<span class="chip" classList={{
								"chip-ok": app.om.om.state.status === "idle",
								"chip-busy": app.om.om.state.status === "processing" || app.om.om.state.status === "busy",
								"chip-warn": app.om.om.state.status === "paused",
								"chip-fault": app.om.om.state.status === "halted",
							}}>
								<span class="dot" />{app.om.om.state.status}
							</span>
						</Match>
						<Match when={app.om.connection.status === "connecting" || app.om.connection.status === "reconnecting"}>
							<span class="chip chip-warn"><span class="dot" />{app.om.connection.status}…</span>
						</Match>
						<Match when={true}>
							<span class="chip chip-fault"><span class="dot" />disconnected</span>
						</Match>
					</Switch>

					<Show when={anyHeaterFault()}>
						<span class="chip chip-fault">heater fault</span>
					</Show>
					<Show when={unhomedCount() > 0}>
						<span class="chip chip-warn">
							unhomed · {unhomedCount() === visibleAxes().length ? "all axes" : `${unhomedCount()} axes`}
						</span>
					</Show>
					<Show when={anyHeaterHot()}>
						<span class="chip chip-hot">hot</span>
					</Show>
					<Show when={app.om.om.state.currentTool >= 0}>
						<span class="chip chip-quiet">T{app.om.om.state.currentTool}</span>
					</Show>

					<div class="preflight-actions">
						<Show when={import.meta.env.DEV}><BackendToggle /></Show>
						<button
							class="ghost-btn"
							aria-pressed={app.config.config.camera.pinned}
							title="Show the camera panel on the current view"
							onClick={() => app.config.setCamera({ pinned: !app.config.config.camera.pinned })}
						>
							Camera
						</button>
						<Show when={app.om.connection.status === "disconnected"}>
							<button class="ghost-btn" onClick={() => void app.connector.connect().catch(() => undefined)}>
								Connect
							</button>
						</Show>
						<button class="estop" title="Emergency stop — sends M112 + M999" onClick={emergencyStop}>
							STOP<small>M112</small>
						</button>
					</div>
				</header>

				<Switch>
					<Match when={route() === "machine"}><Machine /></Match>
					<Match when={route() === "control"}><Control /></Match>
					<Match when={route() === "jobs"}><Jobs /></Match>
					<Match when={route() === "macros"}><Macros /></Match>
					<Match when={route() === "system"}><System /></Match>
					<Match when={route() === "settings"}><Settings /></Match>
				</Switch>
			</div>
		</div>
	);
}

/** Dev-only Mock/Real backend switcher + write arming (see src/dev/writeGuard.ts). */
function BackendToggle() {
	const app = useApp();
	const [busy, setBusy] = createSignal(false);

	const switchTo = async (b: Backend): Promise<void> => {
		if (busy() || b.id === currentBackendId() || app.connector.switchEndpoint === undefined) return;
		setBusy(true);
		setCurrentBackendId(b.id);
		setWritesArmed(false); // an arm never survives a backend switch
		rememberBackend(b.id);
		try {
			await app.connector.switchEndpoint(b.baseUrl, b.password);
			await app.config.loadFromMachine(app.connector);
		} catch {
			// Failure shows in the connection chip (e.g. bad password / offline).
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			<div class="backend-toggle" role="group" aria-label="Backend" title="Dev: which board the UI talks to">
				<For each={BACKENDS}>
					{b => (
						<button
							class="backend-opt"
							classList={{ active: currentBackendId() === b.id, real: b.id === "real" }}
							aria-pressed={currentBackendId() === b.id}
							disabled={busy()}
							onClick={() => void switchTo(b)}
						>
							{b.label}
						</button>
					)}
				</For>
			</div>
			<Show when={currentBackendId() === "real"}>
				<button
					class="arm-btn"
					classList={{ armed: writesArmed() }}
					aria-pressed={writesArmed()}
					title={
						writesArmed()
							? "Writes to the REAL board are ARMED — G-code and uploads will reach the machine. Click to disarm."
							: "Writes to the REAL board are blocked. Reads still work. Click to arm deliberately."
					}
					onClick={() => setWritesArmed(v => !v)}
				>
					{writesArmed() ? "⚠ Writes armed" : "Writes locked"}
				</button>
			</Show>
		</>
	);
}
```

Note this removes the `app` unused-variable warning that was one of the 3 pre-existing typecheck errors — `app` is now used (`app.config.config.camera.pinned` etc., already was, but the OLD file's `ConsoleTile`/`CameraTile` functions each called `useApp()` again redundantly and the top-level `Shell()`'s `app` binding was in fact used; re ‑verify by running tsc after this step — the plan's Global Constraints section already anticipates this dropping to 2 pre-existing errors).

- [ ] **Step 2: Delete `floatingTile.ts`**

```bash
git rm packages/ui/src/shell/floatingTile.ts
```

- [ ] **Step 3: Remove the now-dead floating-state exports from `consoleLog.ts`**

Read `packages/ui/src/om/consoleLog.ts`. Remove the `loadConsoleFloating`/`saveConsoleFloating` functions and the `FLOATING_KEY` constant (the docked/floating toggle concept no longer exists — console is always just a panel now). Keep `ConsoleLine`, `CONSOLE_LIMIT`, `capLines`, `parseConsole`, `serializeConsole`, `loadConsole`, `saveConsole` — those are unrelated to placement and still used by `om/store.ts`.

- [ ] **Step 4: Remove now-dead CSS**

In `packages/ui/src/app.css`, delete the `/* ---------- snapped-out console ---------- */` section (`.console-tile`, `.console-tile-head`, `.console-tile-title`, the `@media (max-width: 900px) { .console-tile { ... } }` block) and delete the `.console-drawer`, `.console-row`, `.console-last`, `.console-expand` rules (the docked-bar-specific ones — but keep `.console-history`, `.console-line`, `.console-empty`, `.console-form` and its children, since `ConsolePanel` still uses those). Similarly delete the camera tile's positioning rules — `.cam-tile`, `.cam-head` (and its `cursor`/`touch-action` additions), `.cam-title`, `.cam-actions` — but keep `.cam-body`, `.cam-body a`, `.cam-body img` (still used by `CameraPanel`), and keep the `.cam-tile { display: none; }` mobile-breakpoint rule's *absence* in mind — it's being deleted along with `.cam-tile` itself, no replacement needed since `CameraPanel` is an ordinary panel now and the 24-column grid already handles narrow viewports without a special override.

- [ ] **Step 5: Typecheck and run tests**

Run (from `packages/ui`): `node ../../node_modules/typescript/bin/tsc -b`
Expected: `writeGuard.ts:48` and `editor/setup.ts:11` only (2 errors) — plus errors in every view file that still imports the old `panelLayout.ts`/old `Panel` API (expected and temporary, per Task 2's note; Tasks 5-10 fix these one view at a time). Confirm no *new* category of error beyond "old views don't match the new Panel API" and the 2 pre-existing ones.

Run: `pnpm --filter @dwc-ng/ui test`
Expected: all pure-logic tests (Task 1, plus every pre-existing suite) still pass — `node:test` doesn't typecheck, so the views' stale imports don't fail tests, only `tsc -b`.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/shell/Shell.tsx packages/ui/src/om/consoleLog.ts packages/ui/src/app.css
git rm packages/ui/src/shell/floatingTile.ts
git commit -m "refactor(ui): remove global console/camera chrome from Shell.tsx

Shell.tsx keeps only the nav rail, preflight header, backend toggle, and
e-stop — console and camera no longer render globally. floatingTile.ts is
deleted (its drag/resize job is now panelCanvas.ts's, shared with every
other panel). consoleLog.ts drops the now-meaningless docked/floating
toggle exports. Every view still references the old Panel/panelLayout API
at this point — expected, fixed one view at a time starting next task."
```

---

### Task 5: Wire `Machine.tsx` (first view — establishes the pattern)

**Files:**
- Create: `packages/ui/src/views/machine.panelDefaults.ts`
- Modify: `packages/ui/src/views/Machine.tsx`

**Interfaces:**
- Consumes: `Panel`, `PanelCanvas` (Task 2), `ConsolePanel`, `CameraPanel` (Task 3), `createPanelCanvas`, `type PanelDefault` (Task 1/2).
- Produces: the template every later view task follows — a plain `.ts` companion file exporting that view's `PANEL_DEFAULTS` (kept out of the `.tsx` file specifically so `panel-canvas.test.ts` can import it directly — Node's native TypeScript stripping erases type annotations but does **not** transform JSX, so a test file can never `import` a `.tsx` file that contains actual JSX syntax; every view's defaults live in a JSX-free sibling module instead), plus the same view-wiring shape (`createPanelCanvas` call, `<PanelCanvas>` wrapper, `<ConsolePanel>`/`<CameraPanel>` added, reset button unchanged).

- [ ] **Step 1: Create the companion defaults file**

Create `packages/ui/src/views/machine.panelDefaults.ts`:

```ts
import type { PanelDefault } from "../shell/panelCanvas.ts";

export const MACHINE_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "position", col: 0, row: 0, colSpan: 12, rowSpan: 15 },
	{ id: "tools-heaters", col: 12, row: 0, colSpan: 12, rowSpan: 15 },
	{ id: "job", col: 0, row: 15, colSpan: 12, rowSpan: 6 },
	{ id: "temperatures", col: 0, row: 21, colSpan: 24, rowSpan: 12 },
	{ id: "console", col: 0, row: 33, colSpan: 24, rowSpan: 10 },
	{ id: "camera", col: 0, row: 43, colSpan: 8, rowSpan: 10 },
];
```

- [ ] **Step 2: Wire the view**

In `packages/ui/src/views/Machine.tsx`, replace the import block and old inline `PANEL_DEFAULTS` (currently lines 1-13):

```tsx
import { For, Show, createMemo } from "solid-js";
import { useApp } from "../shell/context.ts";
import type { Heater } from "../om/types.ts";
import { TemperatureChart, type ChartSeries } from "../charts/TemperatureChart.tsx";
import { Panel } from "../shell/Panel.tsx";
import { PanelCanvas } from "../shell/PanelCanvas.tsx";
import { ConsolePanel } from "../shell/ConsolePanel.tsx";
import { CameraPanel } from "../shell/CameraPanel.tsx";
import { createPanelCanvas } from "../shell/panelCanvas.ts";
import { MACHINE_PANEL_DEFAULTS } from "./machine.panelDefaults.ts";
```

Replace `const layout = createPanelLayout("dwc-ng.layout.machine", PANEL_DEFAULTS);` (currently line 21) with:

```tsx
	const canvas = createPanelCanvas("dwc-ng.canvas.machine", MACHINE_PANEL_DEFAULTS);
```

Replace every `layout={layout}` prop on the four existing `<Panel>` elements (position, tools-heaters, job, temperatures) with `canvas={canvas}` — the `id`, `ariaLabel`, and all inner JSX are unchanged from the current file.

Replace the outer wrapper: change `<div class="grid">` to `<PanelCanvas>`, its matching closing `</div>` to `</PanelCanvas>`, and add `<ConsolePanel canvas={canvas} />` and `<CameraPanel canvas={canvas} />` as the last two children before the closing tag, so the full return becomes:

```tsx
	return (
		<>
			<div class="layout-toolbar">
				<button class="layout-reset" onClick={() => canvas.reset()}>↺ Reset layout</button>
			</div>
			<PanelCanvas>
				<Panel id="position" canvas={canvas} ariaLabel="Position">
					{/* ...unchanged inner JSX from the current file... */}
				</Panel>

				<Panel id="tools-heaters" canvas={canvas} ariaLabel="Tools and heaters">
					{/* ...unchanged inner JSX... */}
				</Panel>

				<Panel id="job" canvas={canvas} ariaLabel="Job">
					{/* ...unchanged inner JSX... */}
				</Panel>

				<Panel id="temperatures" canvas={canvas} ariaLabel="Temperatures">
					{/* ...unchanged inner JSX... */}
				</Panel>

				<ConsolePanel canvas={canvas} />
				<CameraPanel canvas={canvas} />
			</PanelCanvas>
		</>
	);
}
```

(The `{/* ...unchanged inner JSX... */}` markers above are for this plan's readability only — copy the real JSX from the current file's four `<Panel>` bodies verbatim; do not leave a comment placeholder in the actual code.)

- [ ] **Step 3: Typecheck and run tests**

Run (from `packages/ui`): `node ../../node_modules/typescript/bin/tsc -b`
Expected: `Machine.tsx` no longer errors. The 5 remaining unmigrated views (Jobs, Macros, System, Control, Settings) still do — expected until their own tasks land.

Run: `pnpm --filter @dwc-ng/ui test`
Expected: unchanged, all passing.

- [ ] **Step 4: Add a collision-free-defaults test**

At the top of `packages/ui/test/panel-canvas.test.ts`, add `MACHINE_PANEL_DEFAULTS` to the import from `panelCanvas.ts`'s sibling defaults file — as a **static** import, not a dynamic one: `MACHINE_PANEL_DEFAULTS` lives in `machine.panelDefaults.ts`, a plain `.ts` module with no JSX, so it imports cleanly into a `node:test` file the same way every other pure-logic import in this suite does.

```ts
import { MACHINE_PANEL_DEFAULTS } from "../src/views/machine.panelDefaults.ts";
```

Append:

```ts
test("Machine view's default panel layout is collision-free", () => {
	assert.equal(hasCollisions(defaultCanvas(MACHINE_PANEL_DEFAULTS)), false);
});
```

Every later view task does the same: its own `<view>.panelDefaults.ts` companion file, statically imported at the top of `panel-canvas.test.ts` alongside this one, one collision test appended per view. Never import a `.tsx` file from a test — Node's native TypeScript stripping erases type annotations only; it does not transform JSX, so a `.tsx` file containing real JSX syntax fails to parse when imported directly by `node --test`.

Run: `pnpm --filter @dwc-ng/ui test`
Expected: PASS — new collision test green, everything else unchanged.

- [ ] **Step 5: Live-verify in the browser**

Start `mock-duet` (from `packages/mock-duet`, if not already running): `node src/cli.ts --snapshot ../mock-duet/captures/om-snapshot-2026-07-12.json`
Start the dev server (from the repo root, if not already running): `pnpm --filter @dwc-ng/ui dev`

Using Chrome browser automation:
1. Navigate to `http://localhost:5173/#/machine`. **Confirm the backend toggle reads `MOCK`** before any interaction.
2. Screenshot: confirm Position/Tools & Heaters sit side by side, Job below Position, Temperatures full-width below both, Console below that, and (if you pin the camera via the header's "Camera" button) Camera panel appears below Console.
3. Drag Position onto empty space to the right of Job; confirm it lands there and stays (doesn't swap with anything).
4. Drag Position onto Tools & Heaters (an occupied cell); confirm it's rejected — Position snaps back to where it started, Tools & Heaters is untouched.
5. Resize Job's corner grip to grow right; confirm it stops growing once it would collide with Tools & Heaters or Temperatures, rather than overlapping them.
6. Drag Tools & Heaters away to open space; confirm Temperatures (or whatever was resting against the freed space) settles up/left into it.
7. Reload; confirm the dragged/resized state persisted.
8. Click "↺ Reset layout"; confirm everything returns to the coded defaults.
9. Resize the browser to a narrow width (or note that `resize_window` may not actually change the viewport per prior tasks' tooling limitation — if so, do a static check instead: confirm `packages/ui/src/app.css`'s `.panel-canvas` rule has no mobile-breakpoint override, relying on the proportional `1fr` columns to never overflow, and note this substitution in your report if the live check isn't possible).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/Machine.tsx packages/ui/src/views/machine.panelDefaults.ts packages/ui/test/panel-canvas.test.ts
git commit -m "feat(ui): migrate Machine view to the grid canvas

First view on the new engine — Position, Tools & Heaters, Job, Temperatures,
plus Console and Camera as regular panels now. Verified live: move
(collision-rejected onto occupied cells), resize (blocked by neighbors),
settle (freed space gets filled after a move), reload-persistence, and
reset. Defaults live in a JSX-free machine.panelDefaults.ts companion file
(not inline in Machine.tsx) so panel-canvas.test.ts can statically import
and collision-check them — a .tsx file with real JSX can't be imported by
node:test, since Node's native TS stripping doesn't transform JSX. Every
later view task repeats this pattern."
```

---

### Task 6: Wire `Jobs.tsx`

**Files:**
- Create: `packages/ui/src/views/jobs.panelDefaults.ts`
- Modify: `packages/ui/src/views/Jobs.tsx`
- Modify: `packages/ui/test/panel-canvas.test.ts` (append its defaults collision test)

**Interfaces:** same as Task 5.

- [ ] **Step 1: Create the companion defaults file**

Create `packages/ui/src/views/jobs.panelDefaults.ts`:

```ts
import type { PanelDefault } from "../shell/panelCanvas.ts";

export const JOBS_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "active-job", col: 0, row: 0, colSpan: 24, rowSpan: 8 },
	{ id: "job-files", col: 0, row: 8, colSpan: 12, rowSpan: 18 },
	{ id: "job-details", col: 12, row: 8, colSpan: 12, rowSpan: 18 },
	{ id: "console", col: 0, row: 26, colSpan: 24, rowSpan: 10 },
	{ id: "camera", col: 0, row: 36, colSpan: 8, rowSpan: 10 },
];
```

- [ ] **Step 2: Wire the view**

Follow Task 5's exact pattern. Replace the import block and old `PANEL_DEFAULTS` in `packages/ui/src/views/Jobs.tsx` with:

```tsx
import { For, Show, Switch, Match, createMemo, createResource, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { Thumbnail } from "../thumbnails/Thumbnail.tsx";
import type { FileListEntry } from "../connector/types.ts";
import { Panel } from "../shell/Panel.tsx";
import { PanelCanvas } from "../shell/PanelCanvas.tsx";
import { ConsolePanel } from "../shell/ConsolePanel.tsx";
import { CameraPanel } from "../shell/CameraPanel.tsx";
import { createPanelCanvas } from "../shell/panelCanvas.ts";
import { JOBS_PANEL_DEFAULTS } from "./jobs.panelDefaults.ts";
```

Replace `const layout = createPanelLayout("dwc-ng.layout.jobs", PANEL_DEFAULTS);` with:

```tsx
	const canvas = createPanelCanvas("dwc-ng.canvas.jobs", JOBS_PANEL_DEFAULTS);
```

Replace `layout={layout}` with `canvas={canvas}` on the three existing `<Panel>` elements (`active-job`, `job-files`, `job-details`) — their `<Show>`-wraps-`<Panel>` nesting (for `active-job` and `job-details`, both conditionally rendered) and all inner JSX stay exactly as they are in the current file. Change `<div class="grid jobs">` to `<PanelCanvas class="jobs">`, its closing `</div>` to `</PanelCanvas>`, and add `<ConsolePanel canvas={canvas} />` + `<CameraPanel canvas={canvas} />` as the last two children (outside both `<Show>`s, alongside `job-files`, so they're always present regardless of whether a job is active or a file is selected).

- [ ] **Step 3: Add the collision test**

At the top of `packages/ui/test/panel-canvas.test.ts`, add a static import alongside `MACHINE_PANEL_DEFAULTS`:

```ts
import { JOBS_PANEL_DEFAULTS } from "../src/views/jobs.panelDefaults.ts";
```

Append:

```ts
test("Jobs view's default panel layout is collision-free", () => {
	assert.equal(hasCollisions(defaultCanvas(JOBS_PANEL_DEFAULTS)), false);
});
```

- [ ] **Step 4: Typecheck and run tests**

Run (from `packages/ui`): `node ../../node_modules/typescript/bin/tsc -b`
Expected: `Jobs.tsx` no longer errors; Macros/System/Control/Settings still do (expected).

Run: `pnpm --filter @dwc-ng/ui test`
Expected: PASS, including the new collision test.

- [ ] **Step 5: Live-verify in the browser**

Same shape as Task 5's Step 5, on `http://localhost:5173/#/jobs`: confirm backend is `MOCK`; verify move/resize/settle/reload-persistence/reset; specifically re-confirm the conditional-panel behavior (select a file → Job details appears at its coded position; deselect → it disappears without disturbing Console/Camera below; reselect → reappears — this was already proven for the *old* system in the prior plan's Task 5, re-verify it still holds with the new engine).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/views/Jobs.tsx packages/ui/src/views/jobs.panelDefaults.ts packages/ui/test/panel-canvas.test.ts
git commit -m "feat(ui): migrate Jobs view to the grid canvas"
```

---

### Task 7: Wire `Macros.tsx` and `System.tsx`

**Files:**
- Create: `packages/ui/src/views/macros.panelDefaults.ts`
- Create: `packages/ui/src/views/system.panelDefaults.ts`
- Modify: `packages/ui/src/views/Macros.tsx`
- Modify: `packages/ui/src/views/System.tsx`
- Modify: `packages/ui/test/panel-canvas.test.ts`

**Interfaces:** same as Task 5, bundled for two small low-risk views.

- [ ] **Step 1: Wire `Macros.tsx`**

Create `packages/ui/src/views/macros.panelDefaults.ts`:

```ts
import type { PanelDefault } from "../shell/panelCanvas.ts";

export const MACROS_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "macros", col: 0, row: 0, colSpan: 10, rowSpan: 20 },
	{ id: "editor", col: 10, row: 0, colSpan: 14, rowSpan: 20 },
	{ id: "console", col: 0, row: 20, colSpan: 24, rowSpan: 10 },
	{ id: "camera", col: 0, row: 30, colSpan: 8, rowSpan: 10 },
];
```

Import block in `Macros.tsx` gains the same shape as Task 5/6 (`Panel`, `PanelCanvas`, `ConsolePanel`, `CameraPanel`, `createPanelCanvas` from `panelCanvas.ts`, `MACROS_PANEL_DEFAULTS` from `./macros.panelDefaults.ts`) in place of the old `Panel`/`panelLayout.ts` imports. `canvas = createPanelCanvas("dwc-ng.canvas.macros", MACROS_PANEL_DEFAULTS)`. Both existing `<Panel>`s (`macros`, `editor`) get `canvas={canvas}`, inner JSX unchanged. `<div class="grid macros">` → `<PanelCanvas class="macros">`, add `<ConsolePanel>`/`<CameraPanel>`.

- [ ] **Step 2: Wire `System.tsx`**

Create `packages/ui/src/views/system.panelDefaults.ts`:

```ts
import type { PanelDefault } from "../shell/panelCanvas.ts";

export const SYSTEM_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "system-files", col: 0, row: 0, colSpan: 8, rowSpan: 16 },
	{ id: "editor", col: 8, row: 0, colSpan: 16, rowSpan: 16 },
	{ id: "object-model", col: 0, row: 16, colSpan: 24, rowSpan: 14 },
	{ id: "console", col: 0, row: 30, colSpan: 24, rowSpan: 10 },
	{ id: "camera", col: 0, row: 40, colSpan: 8, rowSpan: 10 },
];
```

Same import/wiring pattern in `System.tsx`, importing `SYSTEM_PANEL_DEFAULTS` from `./system.panelDefaults.ts`. `canvas = createPanelCanvas("dwc-ng.canvas.system", SYSTEM_PANEL_DEFAULTS)`. Three existing `<Panel>`s (`system-files`, `editor`, `object-model`) get `canvas={canvas}`. `<div class="grid system">` → `<PanelCanvas class="system">`.

- [ ] **Step 3: Add both collision tests**

At the top of `packages/ui/test/panel-canvas.test.ts`, add two more static imports:

```ts
import { MACROS_PANEL_DEFAULTS } from "../src/views/macros.panelDefaults.ts";
import { SYSTEM_PANEL_DEFAULTS } from "../src/views/system.panelDefaults.ts";
```

Append:

```ts
test("Macros view's default panel layout is collision-free", () => {
	assert.equal(hasCollisions(defaultCanvas(MACROS_PANEL_DEFAULTS)), false);
});

test("System view's default panel layout is collision-free", () => {
	assert.equal(hasCollisions(defaultCanvas(SYSTEM_PANEL_DEFAULTS)), false);
});
```

- [ ] **Step 4: Typecheck and run tests**

Run (from `packages/ui`): `node ../../node_modules/typescript/bin/tsc -b`
Expected: only Control/Settings still error.

Run: `pnpm --filter @dwc-ng/ui test`
Expected: PASS, including both new collision tests.

- [ ] **Step 5: Live-verify both views in the browser**

Same shape as Task 5's Step 5, on `#/macros` and `#/system`. On System, specifically confirm Object Model still defaults to full width below System Files/Editor.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/views/Macros.tsx packages/ui/src/views/macros.panelDefaults.ts packages/ui/src/views/System.tsx packages/ui/src/views/system.panelDefaults.ts packages/ui/test/panel-canvas.test.ts
git commit -m "feat(ui): migrate Macros and System views to the grid canvas"
```

---

### Task 8: Wire `Control.tsx`

**Files:**
- Create: `packages/ui/src/views/control.panelDefaults.ts`
- Modify: `packages/ui/src/views/Control.tsx`
- Modify: `packages/ui/test/panel-canvas.test.ts`

**Interfaces:** same as Task 5.

- [ ] **Step 1: Wire the view**

Create `packages/ui/src/views/control.panelDefaults.ts`:

```ts
import type { PanelDefault } from "../shell/panelCanvas.ts";

export const CONTROL_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "homing", col: 0, row: 0, colSpan: 12, rowSpan: 6 },
	{ id: "tools", col: 12, row: 0, colSpan: 12, rowSpan: 6 },
	{ id: "heaters", col: 0, row: 6, colSpan: 12, rowSpan: 10 },
	{ id: "movement", col: 12, row: 6, colSpan: 12, rowSpan: 18 },
	{ id: "fans", col: 0, row: 16, colSpan: 12, rowSpan: 10 },
	{ id: "tuning", col: 0, row: 26, colSpan: 12, rowSpan: 8 },
	{ id: "console", col: 0, row: 34, colSpan: 24, rowSpan: 10 },
	{ id: "camera", col: 0, row: 44, colSpan: 8, rowSpan: 10 },
];
```

Same import/wiring pattern as prior tasks in `Control.tsx`, importing `CONTROL_PANEL_DEFAULTS` from `./control.panelDefaults.ts`. `canvas = createPanelCanvas("dwc-ng.canvas.control", CONTROL_PANEL_DEFAULTS)`. Six existing `<Panel>`s get `canvas={canvas}` — `fans` keeps its `<Show when={app.om.om.fans.some(f => f !== null)}>` wrapping the `<Panel>` (Panel inside Show, same as before), the other five are unconditional. `<div class="grid control">` → `<PanelCanvas class="control">`, add `<ConsolePanel>`/`<CameraPanel>`. All inner JSX (the jog pad, coupler row, heater/fan/tuning controls) is unchanged from the current file — this view has no CSS removal step (Control never had a full-span panel).

- [ ] **Step 2: Add the collision test**

At the top of `packages/ui/test/panel-canvas.test.ts`, add:

```ts
import { CONTROL_PANEL_DEFAULTS } from "../src/views/control.panelDefaults.ts";
```

Append:

```ts
test("Control view's default panel layout is collision-free", () => {
	assert.equal(hasCollisions(defaultCanvas(CONTROL_PANEL_DEFAULTS)), false);
});
```

- [ ] **Step 3: Typecheck and run tests**

Run (from `packages/ui`): `node ../../node_modules/typescript/bin/tsc -b`
Expected: only Settings still errors.

Run: `pnpm --filter @dwc-ng/ui test`
Expected: PASS.

- [ ] **Step 4: Live-verify in the browser**

Same shape as Task 5's Step 5 on `#/control`. Avoid clicking any `GcodeButton` control (only interact with grips, reset, and nav) — same caution as the prior plan's Task 7. Confirm Fans still renders (mock snapshot has fans) and is a regular movable/resizable panel now.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/Control.tsx packages/ui/src/views/control.panelDefaults.ts packages/ui/test/panel-canvas.test.ts
git commit -m "feat(ui): migrate Control view to the grid canvas"
```

---

### Task 9: Wire `Settings.tsx`

**Files:**
- Create: `packages/ui/src/views/settings.panelDefaults.ts`
- Modify: `packages/ui/src/views/Settings.tsx`
- Modify: `packages/ui/test/panel-canvas.test.ts`

**Interfaces:** same as Task 5. Last of the six views.

- [ ] **Step 1: Wire the view**

Settings' existing 3rd card is titled "Camera" and edits `app.config.config.camera.streamUrl` — this is a *config form*, distinct from the new live camera-preview `CameraPanel`. Rename its panel id from `"camera"` to `"camera-config"` to avoid colliding with the `"camera"` id every view now also uses for the live preview panel. This is the only view where an existing panel id needs renaming.

Create `packages/ui/src/views/settings.panelDefaults.ts`:

```ts
import type { PanelDefault } from "../shell/panelCanvas.ts";

export const SETTINGS_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "axis-roles", col: 0, row: 0, colSpan: 12, rowSpan: 14 },
	{ id: "tool-dock-sensors", col: 12, row: 0, colSpan: 12, rowSpan: 14 },
	{ id: "camera-config", col: 0, row: 14, colSpan: 12, rowSpan: 10 },
	{ id: "saved-versions", col: 12, row: 14, colSpan: 12, rowSpan: 10 },
	{ id: "console", col: 0, row: 24, colSpan: 24, rowSpan: 10 },
	{ id: "camera", col: 0, row: 34, colSpan: 8, rowSpan: 10 },
];
```

Same import/wiring pattern in `Settings.tsx`, importing `SETTINGS_PANEL_DEFAULTS` from `./settings.panelDefaults.ts`. `canvas = createPanelCanvas("dwc-ng.canvas.settings", SETTINGS_PANEL_DEFAULTS)`. The four existing `<Panel>`s get `canvas={canvas}`; rename the third one's `id="camera"` to `id="camera-config"` (its `ariaLabel="Camera"` can stay as-is — that's just the visible heading, unaffected by the internal id). `<div class="grid settings">` → `<PanelCanvas class="settings">`.

The `.save-bar` div (Save/Reset-everything row) is **not** a `<Panel>` and was previously a plain grid-item sibling with a forced `order` to keep it last (see the prior plan's Task 8). In the new model, move it **outside** `<PanelCanvas>` entirely — a sibling after the closing `</PanelCanvas>` tag, in normal document flow, not a grid item at all:

```tsx
	return (
		<>
			<div class="layout-toolbar">
				<button class="layout-reset" onClick={() => canvas.reset()}>↺ Reset layout</button>
			</div>
			<PanelCanvas class="settings">
				<Panel id="axis-roles" canvas={canvas} ariaLabel="Axis roles">
					{/* ...unchanged inner JSX... */}
				</Panel>

				<Panel id="tool-dock-sensors" canvas={canvas} ariaLabel="Tool dock sensors">
					{/* ...unchanged inner JSX... */}
				</Panel>

				<Panel id="camera-config" canvas={canvas} ariaLabel="Camera">
					{/* ...unchanged inner JSX... */}
				</Panel>

				<Panel id="saved-versions" canvas={canvas} ariaLabel="Saved versions">
					{/* ...unchanged inner JSX... */}
				</Panel>

				<ConsolePanel canvas={canvas} />
				<CameraPanel canvas={canvas} />
			</PanelCanvas>

			<div class="save-bar">
				{/* ...unchanged inner JSX from the current file's .save-bar... */}
			</div>
		</>
	);
}
```

(As in Task 5, the `{/* ...unchanged inner JSX... */}` markers are for this plan's readability — copy the real JSX verbatim from the current file, no literal comment placeholders in the shipped code.)

- [ ] **Step 2: Add the collision test**

At the top of `packages/ui/test/panel-canvas.test.ts`, add:

```ts
import { SETTINGS_PANEL_DEFAULTS } from "../src/views/settings.panelDefaults.ts";
```

Append:

```ts
test("Settings view's default panel layout is collision-free", () => {
	assert.equal(hasCollisions(defaultCanvas(SETTINGS_PANEL_DEFAULTS)), false);
});
```

- [ ] **Step 3: Typecheck and run tests**

Run (from `packages/ui`): `node ../../node_modules/typescript/bin/tsc -b`
Expected: **zero** view-related errors now — only the 2 pre-existing (`writeGuard.ts`, `editor/setup.ts`).

Run: `pnpm --filter @dwc-ng/ui test`
Expected: PASS, all 6 collision tests plus every other test green.

- [ ] **Step 4: Live-verify in the browser**

Same shape as Task 5's Step 5 on `#/settings`. Specifically confirm: dragging any of the four cards around doesn't affect the `.save-bar` row (it's outside the canvas now, always full-width beneath it, in normal flow); Save/Reset-everything buttons still work exactly as before.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/Settings.tsx packages/ui/src/views/settings.panelDefaults.ts packages/ui/test/panel-canvas.test.ts
git commit -m "feat(ui): migrate Settings view to the grid canvas

Last of the six views. Renamed its existing \"camera\" panel (the stream-URL
config card) to \"camera-config\" to avoid colliding with the new live
camera-preview panel every view now carries. save-bar moves outside
PanelCanvas entirely (plain document flow, not a grid item) rather than
needing a forced order like the old system required."
```

---

### Task 10: Delete the old system

**Files:**
- Delete: `packages/ui/src/shell/panelLayout.ts`
- Delete: `packages/ui/test/panel-layout.test.ts`

**Interfaces:** none — cleanup only, no code depends on these anymore after Task 9.

- [ ] **Step 1: Confirm nothing still imports the old module**

Run: `grep -rl "panelLayout" packages/ui/src packages/ui/test` (from the repo root)
Expected: no output (or only matches inside `panelCanvas.ts`'s own filename substring, which shouldn't occur — confirm the grep is clean before deleting).

- [ ] **Step 2: Delete the files**

```bash
git rm packages/ui/src/shell/panelLayout.ts packages/ui/test/panel-layout.test.ts
```

- [ ] **Step 3: Typecheck and run tests**

Run (from `packages/ui`): `node ../../node_modules/typescript/bin/tsc -b`
Expected: only the 2 pre-existing errors.

Run: `pnpm --filter @dwc-ng/ui test`
Expected: PASS — the old suite's tests are gone, replaced entirely by `panel-canvas.test.ts`'s coverage (which is a superset in intent: same tolerant-load/merge/clamp guarantees, plus the new collision/settle behavior the old system never had).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(ui): delete the old fixed-2-column panel system

panelLayout.ts and its tests are fully superseded by panelCanvas.ts — no
remaining imports (confirmed via grep before deleting)."
```

---

### Task 11: Final regression pass

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `pnpm --filter @dwc-ng/ui test`
Expected: PASS — every pure-logic suite green, including all 6 view collision tests.

Run: `pnpm --filter @dwc-ng/mock-duet test`
Expected: PASS — unchanged (this plan never touches `packages/mock-duet`).

- [ ] **Step 2: Full typecheck**

Run (from `packages/ui`): `node ../../node_modules/typescript/bin/tsc -b`
Expected: exactly the 2 pre-existing errors (`writeGuard.ts:48`, `editor/setup.ts:11`) — confirming this plan introduced none and, per Task 4, resolved the third (`Shell.tsx`'s unused `app`).

- [ ] **Step 3: Cross-view smoke test in the browser**

Visit all six views in sequence (`#/machine`, `#/jobs`, `#/macros`, `#/control`, `#/system`, `#/settings`). Confirm the backend toggle reads `MOCK` throughout. On each: confirm every panel (including Console, and Camera if pinned) shows its move/resize grips, "↺ Reset layout" is present, and no panel visibly overlaps another at rest (matching each view's collision-free defaults). Pin the camera via the header's "Camera" button on one view, navigate to another, and confirm the camera panel does *not* follow — placement is independent per view now, by design.

- [ ] **Step 4: Wrap-up**

No commit — this task made no changes. If any regression surfaced in Steps 1-3, fix it as a new commit before considering the plan complete.

## Self-Review Notes

- **Spec coverage:** grid/data model (Task 1), move/resize/settle semantics (Tasks 1-2), console/camera unification (Tasks 3-4), persistence/reset (Task 1-2, exercised in every view task), migration of all 6 views (Tasks 5-9) plus deletion of the superseded system (Task 10) all map to explicit tasks.
- **Placeholder scan:** the `{/* ...unchanged inner JSX... */}` markers in Tasks 5 and 9 are plan-authoring shorthand, explicitly called out as not to be copied literally — the actual instruction ("copy verbatim from the current file") is concrete and verifiable against a specific, currently-stable file. No other TBD/vague requirements remain.
- **Type consistency:** `PanelRect`, `CanvasState`, `PanelDefault`, `PanelCanvasController`, `createPanelCanvas`, `Panel`/`PanelCanvas`/`ConsolePanel`/`CameraPanel` props are named identically everywhere they're used across all 11 tasks.
- **Scope check:** one cohesive engine-plus-migration effort, decomposed into a shared foundation (Tasks 1-4) and six near-identical per-view tasks (5-9) plus cleanup (10) and regression (11) — matches the shape that worked well for the prior plan's execution.
