# Rearrangeable Panel Grids Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every view's `.grid` panels (Machine, Jobs, Macros, Control, System, Settings) become drag-to-reorder and resize-by-grid-span, persisted per browser per view, with a per-view "reset to default layout" button.

**Architecture:** A pure, unit-tested layout-state module (`panelLayout.ts`: merge/clamp/persist logic + pixel-delta-to-span-step math) underneath a Solid reactive primitive (`createPanelLayout`) that each view calls once; a thin `Panel.tsx` wrapper component replaces each view's bare `<section class="card">` and adds the drag/resize grips. Six mechanical per-view wiring tasks follow the same two testable/verifiable foundation tasks.

**Tech Stack:** SolidJS + TypeScript, hand-rolled CSS, `node:test` for pure-logic tests, Chrome browser automation (via `mcp__claude-in-chrome__*` tools) for live verification against `mock-duet`. No new dependencies.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-17-rearrangeable-panels-design.md` (committed `b9dbfeb`) — read it first; this plan implements it, with the refinements noted below.
- Never destructure props (kills Solid reactivity) — use `props.x`, not `const { x } = props`.
- Use `<Show>`/`<For>`/`<Switch>` for conditional/list rendering, not early returns or `.map` in JSX.
- Signals/stores are only read inside tracking scopes (JSX expressions, `createMemo`/`createEffect` bodies).
- Layout state is a **workspace preference**: `localStorage` only, one key per view (`dwc-ng.layout.<view>`), never the config overlay that uploads to the machine's SD card.
- "Nothing should be able to break by construction" (CLAUDE.md): corrupt/missing/out-of-range stored layout data must always fall back to something valid — never throw, never render an invalid grid.
- No new npm dependencies.
- Run `pnpm --filter @dwc-ng/ui test` after every task; all existing tests plus new ones must stay green. Run `node ../../node_modules/typescript/bin/tsc -b` from `packages/ui` for typecheck — 3 pre-existing errors (`writeGuard.ts:48`, `editor/setup.ts:11`, and an unused-`app`-var in `Shell.tsx`) predate this work and are not yours to fix; do not introduce new ones.
- Live verification uses `mock-duet` (`node src/cli.ts --snapshot ../mock-duet/captures/om-snapshot-2026-07-12.json`, run from `packages/mock-duet`, listens on :8970) and the Vite dev server (`pnpm --filter @dwc-ng/ui dev`, listens on :5173, proxies to :8970 by default). Start both once; reuse across tasks. **On the Machine backend toggle, always confirm it reads `MOCK` before interacting** — this repo's dev backend selection is shared `localStorage` across every tab on `localhost:5173`, and a stray `REAL` selection means you're looking at the physical printer.

## Plan refinements beyond the spec (read before starting)

The spec described panel defaults generically ("`panelIds: string[]`"). Surveying all six views turned up three panels that currently hard-code `grid-column: 1 / -1` in CSS (Machine's Temperatures, Jobs' Active Job, System's Object Model) to span both columns — reproducing today's layout requires `createPanelLayout` to accept a **default span per panel**, not just an ordered id list. `PanelDefault` below (`{ id, colSpan?, rowSpan? }`) carries that; the three CSS rules are removed in the task that wires their view, once the inline default reproduces them.

The spec said the drag-grip goes "into the card-head row." Surveying `System.tsx`'s Editor card (its card-head only exists in the no-selection fallback branch — `FileEditor` renders its own header when a file is open) showed this doesn't hold uniformly across views. `Panel.tsx` instead renders the grip as a small tab positioned absolutely on the card's own top border (outside the card's padding box, so it can never collide with whatever a view puts inside), and the resize grip similarly in the bottom-right corner. This achieves the same UX without depending on each view's internal markup.

Settings.tsx has a `.save-bar` div as a fifth sibling inside `.grid` (not a card, holds Save/Reset buttons) that already spans both columns via CSS. It doesn't get wrapped in `Panel` (it's not reorderable), but grid `order` groups elements by value regardless of source position — an un-ordered sibling could render **between** reordered panels instead of always last. Task 8 gives it an explicit `order` equal to the panel count so it always sorts after every panel.

---

### Task 1: `panelLayout.ts` pure logic + tests

**Files:**
- Create: `packages/ui/src/shell/panelLayout.ts`
- Test: `packages/ui/test/panel-layout.test.ts`

**Interfaces:**
- Produces: `PanelDefault { id: string; colSpan?: number; rowSpan?: number }`, `PanelSpanState { order: number; colSpan: number; rowSpan: number }`, `PanelLayoutState = Record<string, PanelSpanState>`, `MAX_COL_SPAN = 2`, `MAX_ROW_SPAN = 4`, `clampSpan(value: number, max: number): number`, `defaultLayout(defaults: PanelDefault[]): PanelLayoutState`, `parseStoredLayout(raw: string | null): unknown`, `serializeLayout(state: PanelLayoutState): string`, `mergeLayout(stored: unknown, defaults: PanelDefault[]): PanelLayoutState`, `colSpanForDelta(startSpan: number, deltaPx: number, colWidthPx: number): number`, `rowSpanForDelta(startSpan: number, deltaPx: number, rowHeightPx: number): number`. Task 2 builds `createPanelLayout` on top of these; every later task's `PANEL_DEFAULTS` arrays use `PanelDefault`.

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/test/panel-layout.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	defaultLayout, clampSpan, mergeLayout, parseStoredLayout, serializeLayout,
	colSpanForDelta, rowSpanForDelta, MAX_COL_SPAN, MAX_ROW_SPAN,
} from "../src/shell/panelLayout.ts";

const DEFAULTS = [
	{ id: "a" },
	{ id: "b", colSpan: 2 },
	{ id: "c", rowSpan: 3 },
];

test("defaultLayout orders panels by array index and fills in span defaults", () => {
	assert.deepEqual(defaultLayout(DEFAULTS), {
		a: { order: 0, colSpan: 1, rowSpan: 1 },
		b: { order: 1, colSpan: 2, rowSpan: 1 },
		c: { order: 2, colSpan: 1, rowSpan: 3 },
	});
});

test("clampSpan clamps below 1, above max, rounds fractions, and falls back on non-finite", () => {
	assert.equal(clampSpan(0, MAX_COL_SPAN), 1);
	assert.equal(clampSpan(-5, MAX_COL_SPAN), 1);
	assert.equal(clampSpan(5, MAX_COL_SPAN), MAX_COL_SPAN);
	assert.equal(clampSpan(1.6, MAX_ROW_SPAN), 2);
	assert.equal(clampSpan(Number.NaN, MAX_COL_SPAN), 1);
	assert.equal(clampSpan(Number.POSITIVE_INFINITY, MAX_COL_SPAN), 1);
});

test("parseStoredLayout tolerates missing or corrupt storage", () => {
	assert.equal(parseStoredLayout(null), null);
	assert.equal(parseStoredLayout(""), null);
	assert.equal(parseStoredLayout("{not json"), null);
});

test("mergeLayout falls back to defaults when storage is corrupt, empty, or the wrong shape", () => {
	assert.deepEqual(mergeLayout(null, DEFAULTS), defaultLayout(DEFAULTS));
	assert.deepEqual(mergeLayout("a string", DEFAULTS), defaultLayout(DEFAULTS));
	assert.deepEqual(mergeLayout(42, DEFAULTS), defaultLayout(DEFAULTS));
});

test("mergeLayout keeps stored order/span for known ids, clamped to valid bounds", () => {
	const stored = {
		a: { order: 2, colSpan: 99, rowSpan: -3 },
		b: { order: 0, colSpan: 1, rowSpan: 1 },
		c: { order: 1, colSpan: 1, rowSpan: 1 },
	};
	const merged = mergeLayout(stored, DEFAULTS);
	assert.deepEqual(merged.a, { order: 2, colSpan: MAX_COL_SPAN, rowSpan: 1 });
	assert.deepEqual(merged.b, { order: 0, colSpan: 1, rowSpan: 1 });
	assert.deepEqual(merged.c, { order: 1, colSpan: 1, rowSpan: 1 });
});

test("mergeLayout drops stored ids no longer present in defaults", () => {
	const stored = {
		a: { order: 0, colSpan: 1, rowSpan: 1 },
		ghost: { order: 1, colSpan: 1, rowSpan: 1 },
	};
	const merged = mergeLayout(stored, [{ id: "a" }]);
	assert.deepEqual(Object.keys(merged), ["a"]);
});

test("mergeLayout appends a default id missing from storage after every known order, using its own default span", () => {
	const stored = {
		a: { order: 0, colSpan: 1, rowSpan: 1 },
		b: { order: 1, colSpan: 2, rowSpan: 1 },
	};
	// "c" is a panel added to the view's code after this layout was saved.
	const merged = mergeLayout(stored, DEFAULTS);
	assert.deepEqual(merged.a, { order: 0, colSpan: 1, rowSpan: 1 });
	assert.deepEqual(merged.b, { order: 1, colSpan: 2, rowSpan: 1 });
	assert.deepEqual(merged.c, { order: 2, colSpan: 1, rowSpan: 3 });
});

test("serializeLayout round-trips through parseStoredLayout and mergeLayout", () => {
	const layout = defaultLayout(DEFAULTS);
	const restored = mergeLayout(parseStoredLayout(serializeLayout(layout)), DEFAULTS);
	assert.deepEqual(restored, layout);
});

test("colSpanForDelta only steps once the drag passes half a column width, and clamps to the max", () => {
	assert.equal(colSpanForDelta(1, 0, 300), 1, "no movement, no change");
	assert.equal(colSpanForDelta(1, 100, 300), 1, "less than half a column, stays");
	assert.equal(colSpanForDelta(1, 200, 300), 2, "past half a column, grows by one");
	assert.equal(colSpanForDelta(2, -200, 300), 1, "dragging back past half shrinks by one");
	assert.equal(colSpanForDelta(1, 10_000, 300), MAX_COL_SPAN, "clamped to the max even on a huge drag");
	assert.equal(colSpanForDelta(1, 500, 0), 1, "a zero-width column (not yet measured) never throws or produces NaN");
});

test("rowSpanForDelta steps by whole rows and never drops below 1", () => {
	assert.equal(rowSpanForDelta(1, 0, 100), 1);
	assert.equal(rowSpanForDelta(1, 40, 100), 1, "less than half a row, stays");
	assert.equal(rowSpanForDelta(1, 60, 100), 2, "past half a row, grows by one");
	assert.equal(rowSpanForDelta(2, -260, 100), 1, "clamped at the floor, never negative or zero");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @dwc-ng/ui test`
Expected: FAIL — `panel-layout.test.ts` errors with a module-not-found for `../src/shell/panelLayout.ts` (it doesn't exist yet). The 73 pre-existing tests still pass.

- [ ] **Step 3: Write the minimal implementation**

Create `packages/ui/src/shell/panelLayout.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @dwc-ng/ui test`
Expected: PASS — all new `panel-layout.test.ts` tests green, plus the pre-existing 73.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/shell/panelLayout.ts packages/ui/test/panel-layout.test.ts
git commit -m "feat(ui): panel-layout merge/clamp/span-step logic

Pure, unit-tested foundation for per-view drag-reorder + resize-by-span:
tolerant load/merge of stored order+span state (corrupt storage, panels
added/removed since a save, out-of-range spans) and the pixel-delta to
grid-track-step conversion used by the resize grip. No UI wiring yet."
```

---

### Task 2: `createPanelLayout` reactive primitive

**Files:**
- Modify: `packages/ui/src/shell/panelLayout.ts` (append to the file from Task 1)

**Interfaces:**
- Consumes: everything from Task 1 (`PanelDefault`, `PanelLayoutState`, `defaultLayout`, `mergeLayout`, `parseStoredLayout`, `serializeLayout`, `colSpanForDelta`, `rowSpanForDelta`).
- Produces: `PanelLayoutController { styleFor(id: string): Record<string,string>; startReorder(id: string, event: PointerEvent): void; startResize(id: string, event: PointerEvent): void; reset(): void }`, `createPanelLayout(storageKey: string, defaults: PanelDefault[]): PanelLayoutController`. Task 3's `Panel.tsx` takes a `layout: PanelLayoutController` prop; every later view task calls `createPanelLayout("dwc-ng.layout.<view>", PANEL_DEFAULTS)`.

This primitive's pointer-drag wiring depends on live DOM measurement (`getBoundingClientRect`, `matchMedia`) and isn't unit-testable without a DOM — same as `floatingTile.ts`'s `createFloatingTile`, which has no test file either. It's verified live in the browser once Task 4 wires it into `Machine.tsx`.

- [ ] **Step 1: Add the Solid import and reactive primitive**

At the top of `packages/ui/src/shell/panelLayout.ts`, add:

```ts
import { createEffect, createSignal, onCleanup } from "solid-js";
```

Append to the end of `packages/ui/src/shell/panelLayout.ts`:

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
		const onChange = (): void => setColumns(query.matches ? 1 : 2);
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
```

- [ ] **Step 2: Run the existing tests to confirm nothing broke**

Run: `pnpm --filter @dwc-ng/ui test`
Expected: PASS — same tests as Task 1 (this step adds no new tests; `createPanelLayout` is verified live in Task 4).

- [ ] **Step 3: Typecheck**

Run (from `packages/ui`): `node ../../node_modules/typescript/bin/tsc -b`
Expected: same 3 pre-existing errors as before this task (`writeGuard.ts`, `editor/setup.ts`, `Shell.tsx`'s unused `app`). No new errors.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/shell/panelLayout.ts
git commit -m "feat(ui): reactive panel-layout controller

createPanelLayout wires the Task 1 pure logic into a Solid primitive: pointer-
drag reorder (live-swap with whichever sibling the pointer is over), pointer-
drag resize (pixel delta -> span step via the grid's own measured column
width), and a mobile-breakpoint column-count clamp so a desktop-saved 2-span
panel can't force an implicit grid column below 900px. Not yet wired into
any view."
```

---

### Task 3: `Panel.tsx` wrapper component + grip/reset CSS

**Files:**
- Create: `packages/ui/src/shell/Panel.tsx`
- Modify: `packages/ui/src/app.css`

**Interfaces:**
- Consumes: `PanelLayoutController` from Task 2.
- Produces: `Panel(props: { id: string; layout: PanelLayoutController; ariaLabel: string; class?: string; children: JSX.Element })` — a drop-in replacement for `<section class="card" aria-label="...">...</section>`. CSS classes `.panel-grip`, `.panel-resize-grip`, `.layout-toolbar`, `.layout-reset` that every later view task uses.

- [ ] **Step 1: Create the component**

Create `packages/ui/src/shell/Panel.tsx`:

```tsx
import type { JSX } from "solid-js";
import type { PanelLayoutController } from "./panelLayout.ts";

/**
 * Wraps a view's card section so it participates in that view's rearrangeable
 * grid. The drag/resize grips are small tabs straddling the card's border,
 * independent of whatever a view puts inside — some cards (e.g. System's
 * Editor) don't always render their own card-head.
 */
export function Panel(props: {
	id: string;
	layout: PanelLayoutController;
	ariaLabel: string;
	class?: string;
	children: JSX.Element;
}) {
	return (
		<section
			class={props.class ? `card panel ${props.class}` : "card panel"}
			aria-label={props.ariaLabel}
			data-panel-id={props.id}
			style={props.layout.styleFor(props.id)}
		>
			<button
				type="button"
				class="panel-grip"
				title="Drag to reorder"
				aria-label={`Reorder ${props.ariaLabel}`}
				onPointerDown={event => props.layout.startReorder(props.id, event)}
			>
				⠿
			</button>
			{props.children}
			<div
				class="panel-resize-grip"
				title="Drag to resize"
				aria-label={`Resize ${props.ariaLabel}`}
				onPointerDown={event => props.layout.startResize(props.id, event)}
			/>
		</section>
	);
}
```

- [ ] **Step 2: Add the CSS**

In `packages/ui/src/app.css`, add this new section right after the `.card`/`.card-head`/`.card-title` rules (after line 151, before the `.card-head` block currently at line 153 — insert between them or immediately after the `.card-title` block ends; exact position doesn't matter, grouping with the other card rules does):

```css
/* ---------- rearrangeable panels ---------- */

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

- [ ] **Step 3: Typecheck and run tests**

Run (from `packages/ui`): `node ../../node_modules/typescript/bin/tsc -b`
Expected: same 3 pre-existing errors, no new ones (`Panel.tsx` isn't imported anywhere yet, but it must still typecheck standalone).

Run: `pnpm --filter @dwc-ng/ui test`
Expected: PASS — unchanged from Task 2 (no new tests; `Panel` is a presentational component verified live once wired into a view).

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/shell/Panel.tsx packages/ui/src/app.css
git commit -m "feat(ui): Panel wrapper component + grip/reset CSS

Panel.tsx replaces a bare <section class=\"card\"> with one that carries
order/span from a view's PanelLayoutController and renders drag/resize grips
as small tabs on the card's own border — placed outside the card's padding
box so they never collide with whatever markup a view puts inside (some
cards, like System's Editor, don't always render their own card-head).
Not yet used by any view."
```

---

### Task 4: Wire `Machine.tsx`

**Files:**
- Modify: `packages/ui/src/views/Machine.tsx`
- Modify: `packages/ui/src/app.css` (remove the now-superseded `.temp-card` rule)

**Interfaces:**
- Consumes: `Panel` (Task 3), `createPanelLayout`, `PanelDefault` (Task 2/1).
- Produces: nothing new for later tasks — this is the first of six identical-shaped wiring tasks (Task 5–8 repeat this pattern for the other five views).

- [ ] **Step 1: Wire the view**

In `packages/ui/src/views/Machine.tsx`, change the import block (currently line 1-4):

```tsx
import { For, Show, createMemo } from "solid-js";
import { useApp } from "../shell/context.ts";
import type { Heater } from "../om/types.ts";
import { TemperatureChart, type ChartSeries } from "../charts/TemperatureChart.tsx";
```

to:

```tsx
import { For, Show, createMemo } from "solid-js";
import { useApp } from "../shell/context.ts";
import type { Heater } from "../om/types.ts";
import { TemperatureChart, type ChartSeries } from "../charts/TemperatureChart.tsx";
import { Panel } from "../shell/Panel.tsx";
import { createPanelLayout, type PanelDefault } from "../shell/panelLayout.ts";

const PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "position" },
	{ id: "tools-heaters" },
	{ id: "job" },
	{ id: "temperatures", colSpan: 2 },
];
```

Inside `export default function Machine()`, right after `const app = useApp();` (currently line 11), add:

```tsx
	const layout = createPanelLayout("dwc-ng.layout.machine", PANEL_DEFAULTS);
```

Replace the whole `return (...)` block (currently lines 49-190) with:

```tsx
	return (
		<>
			<div class="layout-toolbar">
				<button class="layout-reset" onClick={() => layout.reset()}>↺ Reset layout</button>
			</div>
			<div class="grid">
				<Panel id="position" layout={layout} ariaLabel="Position">
					<div class="card-head">
						<h2 class="card-title">Position</h2>
						<span class="des">move.axes</span>
					</div>
					<Show when={visibleAxes().length} fallback={<p class="job-empty">Waiting for the machine…</p>}>
						<For each={visibleAxes()}>
							{axis => (
								<div class="dro-row" classList={{ unhomed: !axis.homed }}>
									<span class="dro-axis">
										{axis.letter}
										<Show when={app.config.config.axisRoles[axis.letter]}>
											{role => <span class="dro-role">{role()}</span>}
										</Show>
									</span>
									<span class="dro-val">
										{(axis.machinePosition ?? 0).toFixed(2)}<small>mm</small>
									</span>
									<span class="homed-tag" classList={{ yes: axis.homed, no: !axis.homed }}>
										{axis.homed ? "homed" : "unhomed"}
									</span>
								</div>
							)}
						</For>
					</Show>
				</Panel>

				<Panel id="tools-heaters" layout={layout} ariaLabel="Tools and heaters">
					<div class="card-head">
						<h2 class="card-title">Tools &amp; heaters</h2>
						<span class="des">tools · heat.heaters</span>
					</div>
					<table class="heat-table">
						<thead>
							<tr>
								<th scope="col">Heater</th>
								<th scope="col">Current</th>
								<th scope="col">Active</th>
								<th scope="col">Standby</th>
								<th scope="col">State</th>
							</tr>
						</thead>
						<tbody>
							<For each={app.om.om.tools}>
								{tool => (
									<Show when={tool}>
										{t => (
											<tr>
												<td>
													<span class="heat-name">
														<span class="heat-tool">{t().name || `Tool ${t().number}`}</span>
														<span class="des">T{t().number}</span>
														<Show when={dockState(t().number)}>
															{state => (
																<span
																	class={`dock-dot ${state()}`}
																	title={state() === "docked" ? "Docked" : "Away"}
																	aria-label={state() === "docked" ? "Docked" : "Away"}
																/>
															)}
														</Show>
													</span>
												</td>
												<Show when={heaterAt(t().heaters[0] ?? -1)} fallback={<td colspan="4" class="heat-set">no heater</td>}>
													{h => (
														<>
															<td><HeaterCurrent heater={h()} /></td>
															<td><span class="heat-set"><b>{h().active}</b>°</span></td>
															<td><span class="heat-set">{h().standby}°</span></td>
															<td><span class={`heat-state ${h().state}`}>{h().state}</span></td>
														</>
													)}
												</Show>
											</tr>
										)}
									</Show>
								)}
							</For>
							<Show when={heaterAt(bedHeaterIndex())}>
								{h => (
									<tr>
										<td>
											<span class="heat-name">
												<span class="heat-tool">Bed</span>
												<span class="des">heater{bedHeaterIndex()}</span>
											</span>
										</td>
										<td><HeaterCurrent heater={h()} /></td>
										<td><span class="heat-set"><b>{h().active}</b>°</span></td>
										<td><span class="heat-set">—</span></td>
										<td><span class={`heat-state ${h().state}`}>{h().state}</span></td>
									</tr>
								)}
							</Show>
						</tbody>
					</table>
				</Panel>

				<Panel id="job" layout={layout} ariaLabel="Job">
					<div class="card-head">
						<h2 class="card-title">Job</h2>
						<span class="des">job</span>
					</div>
					<Show
						when={app.om.om.job.file}
						fallback={
							<p class="job-empty">
								No job running.
								<Show when={app.om.om.job.lastFileName}> Last: {app.om.om.job.lastFileName}</Show>
							</p>
						}
					>
						{file => (
							<div class="job-line">
								<span class="fname">{file().fileName}</span>
								<Show when={app.om.om.job.layer !== null}>
									<span class="heat-set">layer {app.om.om.job.layer} / {file().numLayers}</span>
								</Show>
								<Show when={jobProgress() !== null}>
									<span class="pct">{jobProgress()!.toFixed(1)}%</span>
								</Show>
							</div>
						)}
					</Show>
				</Panel>

				<Panel id="temperatures" layout={layout} ariaLabel="Temperatures">
					<div class="card-head">
						<h2 class="card-title">Temperatures</h2>
						<span class="des">heat.heaters · live</span>
					</div>
					<Show when={chartSeries().length} fallback={<p class="job-empty">Waiting for heaters…</p>}>
						<TemperatureChart data={app.temps.data} series={chartSeries()} height={220} />
					</Show>
				</Panel>
			</div>
		</>
	);
}
```

- [ ] **Step 2: Remove the now-superseded CSS rule**

In `packages/ui/src/app.css`, find and delete this line (currently line 711):

```css
.temp-card { grid-column: 1 / -1; }
```

(The Panel wrapper's `colSpan: 2` default now produces the same `grid-column: span 2` inline, which always wins over a class rule anyway — this line is dead code once Machine is wired.)

- [ ] **Step 3: Typecheck and run tests**

Run (from `packages/ui`): `node ../../node_modules/typescript/bin/tsc -b`
Expected: same 3 pre-existing errors, no new ones.

Run: `pnpm --filter @dwc-ng/ui test`
Expected: PASS — unchanged (73 pre-existing + panel-layout tests from Task 1).

- [ ] **Step 4: Live-verify in the browser**

Start `mock-duet` (from `packages/mock-duet`, if not already running):

```bash
node src/cli.ts --snapshot ../mock-duet/captures/om-snapshot-2026-07-12.json
```

Start the dev server (from the repo root, if not already running):

```bash
pnpm --filter @dwc-ng/ui dev
```

Using Chrome browser automation (`mcp__claude-in-chrome__*` tools):
1. Navigate to `http://localhost:5173/#/machine`.
2. **Confirm the backend toggle reads `MOCK`** before doing anything else (see Global Constraints — shared localStorage risk).
3. Screenshot: confirm the grid renders exactly as before (Position top-left, Tools & Heaters top-right, Job below Position, Temperatures full-width below) — Task 4 must ship with zero visual change from defaults.
4. Drag the Position panel's grip (top-right tab) onto the Job panel; screenshot to confirm they swap order live.
5. Drag the Tools & Heaters panel's resize grip (bottom-right corner) rightward past half a column width; screenshot to confirm it now spans both columns.
6. Reload the page; screenshot to confirm the swapped order and the widened panel both persisted.
7. Click "↺ Reset layout"; screenshot to confirm it's back to the original order/spans.
8. Resize the browser window (or use `mcp__claude-in-chrome__resize_window`) to ≤900px wide; confirm no horizontal overflow/scrollbar appears (this is the mobile-clamp safety check from the spec).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/Machine.tsx packages/ui/src/app.css
git commit -m "feat(ui): rearrangeable panels on the Machine view

First view wired to Panel/createPanelLayout: Position, Tools & Heaters, Job,
Temperatures are now drag-to-reorder and resize-by-span, with a per-view
reset button. Ships with zero visual change from today's fixed layout until
someone drags something. Verified live: reorder, resize, reload-persistence,
reset, and no overflow at the mobile breakpoint."
```

---

### Task 5: Wire `Jobs.tsx`

**Files:**
- Modify: `packages/ui/src/views/Jobs.tsx`
- Modify: `packages/ui/src/app.css` (remove the now-superseded `.jobs .job-active` rule)

**Interfaces:**
- Consumes: same as Task 4.
- Produces: confirms the conditional-panel behavior (a panel that's sometimes not rendered keeps its slot) works, since Jobs has two `<Show>`-gated cards.

- [ ] **Step 1: Wire the view**

In `packages/ui/src/views/Jobs.tsx`, change the import block (currently lines 1-4):

```tsx
import { For, Show, Switch, Match, createMemo, createResource, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { Thumbnail } from "../thumbnails/Thumbnail.tsx";
import type { FileListEntry } from "../connector/types.ts";
```

to:

```tsx
import { For, Show, Switch, Match, createMemo, createResource, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { Thumbnail } from "../thumbnails/Thumbnail.tsx";
import type { FileListEntry } from "../connector/types.ts";
import { Panel } from "../shell/Panel.tsx";
import { createPanelLayout, type PanelDefault } from "../shell/panelLayout.ts";

const PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "active-job", colSpan: 2 },
	{ id: "job-files" },
	{ id: "job-details" },
];
```

Inside `export default function Jobs()`, right after `const app = useApp();` (currently line 18), add:

```tsx
	const layout = createPanelLayout("dwc-ng.layout.jobs", PANEL_DEFAULTS);
```

Replace the whole `return (...)` block (currently lines 86-226) with:

```tsx
	return (
		<>
			<div class="layout-toolbar">
				<button class="layout-reset" onClick={() => layout.reset()}>↺ Reset layout</button>
			</div>
			<div class="grid jobs">
				<Show when={isActive()}>
					<Panel id="active-job" layout={layout} ariaLabel="Active job" class="job-active">
						<div class="card-head">
							<h2 class="card-title">Printing</h2>
							<span class="des">job · state</span>
						</div>
						<Show when={jobFile()} fallback={<p class="job-empty">{app.om.om.state.status}…</p>}>
							{file => (
								<>
									<div class="job-active-head">
										<span class="fname">{baseName(file().fileName)}</span>
										<span class={`chip chip-${app.om.om.state.status === "paused" ? "warn" : "busy"}`}>
											<span class="dot" />{app.om.om.state.status}
										</span>
									</div>
									<Show when={progress() !== null}>
										<div class="progress" role="progressbar" aria-valuenow={Math.round(progress()!)}>
											<div class="progress-fill" style={{ width: `${progress()!}%` }} />
											<span class="progress-label">{progress()!.toFixed(1)}%</span>
										</div>
									</Show>
									<div class="job-facts">
										<Show when={job().layer !== null}>
											<Fact label="Layer">{job().layer} / {file().numLayers}</Fact>
										</Show>
										<Show when={job().duration !== null}>
											<Fact label="Elapsed">{fmtDuration(job().duration!)}</Fact>
										</Show>
										<Show when={job().timesLeft.file !== null}>
											<Fact label="Remaining">{fmtDuration(job().timesLeft.file!)}</Fact>
										</Show>
									</div>
									<div class="btn-row">
										{/* job-toggle reserves the wider label's width so Cancel can't
										    slide under the pointer when the job changes state. */}
										<Switch>
											<Match when={app.om.om.state.status === "paused"}>
												<button class="btn job-toggle" onClick={() => void app.connector.sendCode("M24")}>Resume</button>
											</Match>
											<Match when={true}>
												<button class="btn job-toggle" onClick={() => void app.connector.sendCode("M25")}>Pause</button>
											</Match>
										</Switch>
										<button class="btn btn-danger" onClick={() => void app.connector.sendCode("M0")}>Cancel</button>
									</div>
								</>
							)}
						</Show>
					</Panel>
				</Show>

				<Panel id="job-files" layout={layout} ariaLabel="Job files" class="jobs-browse">
					<div class="card-head">
						<h2 class="card-title">Jobs</h2>
						<span class="des">{dir()}</span>
					</div>

					<nav class="crumbs" aria-label="Folder">
						<button class="crumb" classList={{ active: dir() === GCODES_ROOT }} onClick={() => { setSelected(null); setDir(GCODES_ROOT); }}>gcodes</button>
						<For each={crumbs()}>
							{c => (
								<>
									<span class="crumb-sep">/</span>
									<button class="crumb" onClick={() => { setSelected(null); setDir(c.path); }}>{c.name}</button>
								</>
							)}
						</For>
					</nav>

					<Switch>
						<Match when={entries.loading}><p class="job-empty">Loading…</p></Match>
						<Match when={entries.error}>
							<p class="job-empty">Couldn’t list {dir()}. <button class="link-btn" onClick={() => void refetchEntries()}>Retry</button></p>
						</Match>
						<Match when={sorted().length === 0}><p class="job-empty">Empty folder.</p></Match>
						<Match when={true}>
							<ul class="file-list">
								<For each={sorted()}>
									{entry => (
										<li>
											<button
												class="file-row"
												classList={{ dir: entry.type === "d", selected: selected() === `${dir()}/${entry.name}` }}
												onClick={() => openEntry(entry)}
											>
												<span class="file-icon" aria-hidden="true">{entry.type === "d" ? "▸" : "▤"}</span>
												<span class="file-name">{entry.name}</span>
												<Show when={entry.type === "f"}>
													<span class="file-meta">{fmtSize(entry.size)}</span>
													<Show when={entry.date}><span class="file-meta file-date">{fmtDate(entry.date!)}</span></Show>
												</Show>
											</button>
										</li>
									)}
								</For>
							</ul>
						</Match>
					</Switch>
				</Panel>

				<Show when={selected()}>
					<Panel id="job-details" layout={layout} ariaLabel="Job details" class="jobs-detail">
						<div class="card-head">
							<h2 class="card-title">{baseName(selected()!)}</h2>
							<span class="des">rr_fileinfo</span>
						</div>
						<Switch>
							<Match when={info.loading}><p class="job-empty">Reading metadata…</p></Match>
							<Match when={info.error}><p class="job-empty">No metadata for this file.</p></Match>
							<Match when={info()}>
								<div class="detail-body">
									<div class="thumb-frame">
										<Switch>
											<Match when={thumb()}>{t => <Thumbnail bytes={t().bytes} format={t().format} alt={`Preview of ${baseName(selected()!)}`} />}</Match>
											<Match when={thumb.loading}><span class="thumb-placeholder">…</span></Match>
											<Match when={true}><span class="thumb-placeholder">no preview</span></Match>
										</Switch>
									</div>
									<dl class="meta-grid">
										<Show when={info()!.printTime}><Meta label="Print time">{fmtDuration(info()!.printTime!)}</Meta></Show>
										<Show when={info()!.filament.length}><Meta label="Filament">{fmtFilament(info()!.filament)}</Meta></Show>
										<Show when={info()!.numLayers}><Meta label="Layers">{info()!.numLayers}</Meta></Show>
										<Show when={info()!.height}><Meta label="Height">{info()!.height!.toFixed(2)} mm</Meta></Show>
										<Show when={info()!.layerHeight}><Meta label="Layer height">{info()!.layerHeight} mm</Meta></Show>
										<Meta label="Size">{fmtSize(info()!.size)}</Meta>
										<Show when={info()!.generatedBy}><Meta label="Sliced by">{info()!.generatedBy}</Meta></Show>
									</dl>
								</div>
								<div class="btn-row detail-actions">
									<button class="btn btn-go" disabled={isActive()} onClick={startPrint}>Start print</button>
									<Show when={isActive()}><span class="job-empty">A job is already running.</span></Show>
								</div>
							</Match>
						</Switch>
					</Panel>
				</Show>
			</div>
		</>
	);
}
```

- [ ] **Step 2: Remove the now-superseded CSS rule**

In `packages/ui/src/app.css`, find and delete this line (currently line 604):

```css
.jobs .job-active { grid-column: 1 / -1; }
```

- [ ] **Step 3: Typecheck and run tests**

Run (from `packages/ui`): `node ../../node_modules/typescript/bin/tsc -b`
Expected: same 3 pre-existing errors, no new ones.

Run: `pnpm --filter @dwc-ng/ui test`
Expected: PASS.

- [ ] **Step 4: Live-verify in the browser**

Using Chrome browser automation against the still-running mock-duet + dev server:
1. Navigate to `http://localhost:5173/#/jobs`. Confirm the backend toggle reads `MOCK`.
2. Screenshot: with no job active and no file selected, only the "Jobs" (file browser) panel renders — confirm no layout break with just one panel in the grid.
3. Click a `.gcode` file to select it; screenshot: "Job details" panel appears. Drag it to reorder relative to "Jobs".
4. Reload; confirm the order persisted and "Job details" still appears in its dragged position (since a file remains selected — Solid's resource/signal state won't survive a full reload, so re-select the file after reload if needed, then confirm order).
5. Deselect (navigate to another view and back, or click elsewhere to clear `selected()`); confirm "Job details" disappears without breaking the grid, then re-select and confirm it reappears in the same dragged position — this is the "conditional panel keeps its slot while hidden" behavior from the spec.
6. Click "↺ Reset layout"; confirm order returns to default.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/Jobs.tsx packages/ui/src/app.css
git commit -m "feat(ui): rearrangeable panels on the Jobs view

Active job, Jobs (file browser), and Job details are now drag-to-reorder and
resize-by-span. Confirms the conditional-panel design: Active job and Job
details only render when a job/selection exists, but keep their stored order
slot while absent and reappear in the same position."
```

---

### Task 6: Wire `Macros.tsx` and `System.tsx`

**Files:**
- Modify: `packages/ui/src/views/Macros.tsx`
- Modify: `packages/ui/src/views/System.tsx`
- Modify: `packages/ui/src/app.css` (remove the now-superseded `.system .om-card` rule)

**Interfaces:**
- Consumes: same as Task 4/5.
- Produces: nothing new — both views follow the established pattern; grouped into one task since each is a small (2–3 panel), low-risk, identically-shaped change.

- [ ] **Step 1: Wire `Macros.tsx`**

Change the import block (currently lines 1-4):

```tsx
import { For, Show, Switch, Match, createMemo, createResource, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { FileEditor } from "../editor/FileEditor.tsx";
import type { FileListEntry } from "../connector/types.ts";
```

to:

```tsx
import { For, Show, Switch, Match, createMemo, createResource, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { FileEditor } from "../editor/FileEditor.tsx";
import type { FileListEntry } from "../connector/types.ts";
import { Panel } from "../shell/Panel.tsx";
import { createPanelLayout, type PanelDefault } from "../shell/panelLayout.ts";

const PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "macros" },
	{ id: "editor" },
];
```

Inside `export default function Macros()`, right after `const app = useApp();` (currently line 15), add:

```tsx
	const layout = createPanelLayout("dwc-ng.layout.macros", PANEL_DEFAULTS);
```

Replace the `return (...)` block (currently lines 65-123) with:

```tsx
	return (
		<>
			<div class="layout-toolbar">
				<button class="layout-reset" onClick={() => layout.reset()}>↺ Reset layout</button>
			</div>
			<div class="grid macros">
				<Panel id="macros" layout={layout} ariaLabel="Macros">
					<div class="card-head">
						<h2 class="card-title">Macros</h2>
						<span class="des">{dir()}</span>
					</div>
					<Show when={connected()} fallback={<p class="job-empty">Not connected.</p>}>
						<Show when={dir() !== MACROS_ROOT}>
							<button class="link-btn" onClick={goUp}>← up a level</button>
						</Show>
						<ul class="file-list">
							<For each={sorted()} fallback={<li class="job-empty">No macros here.</li>}>
								{entry => (
									<li class="file-row" classList={{ active: selected() === pathOf(entry) }}>
										<Switch>
											<Match when={entry.type === "d"}>
												<button class="file-name is-dir" onClick={() => open(entry)}>
													<span class="file-ico">▸</span>{entry.name}
												</button>
											</Match>
											<Match when={entry.type === "f"}>
												<button class="file-name" onClick={() => open(entry)}>{entry.name}</button>
												<button
													class="run-btn"
													classList={{ armed: armed() === pathOf(entry) }}
													title={`Run ${entry.name} (M98)`}
													onClick={() => run(entry)}
												>
													{armed() === pathOf(entry) ? "Confirm" : "▶ Run"}
												</button>
											</Match>
										</Switch>
									</li>
								)}
							</For>
						</ul>
					</Show>
				</Panel>

				<Panel id="editor" layout={layout} ariaLabel="Editor" class="editor-card">
					<Show
						when={selected()}
						fallback={
							<>
								<div class="card-head"><h2 class="card-title">Editor</h2></div>
								<p class="job-empty">
									Select a macro to view or edit it. Opening never runs it — use the
									explicit ▶ Run button (click twice to confirm).
								</p>
							</>
						}
					>
						{path => <FileEditor path={path()} lang="gcode" onClose={() => setSelected(null)} />}
					</Show>
				</Panel>
			</div>
		</>
	);
}
```

- [ ] **Step 2: Wire `System.tsx`**

Change the import block (currently lines 1-6):

```tsx
import { For, Show, Switch, Match, createMemo, createResource, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { FileEditor } from "../editor/FileEditor.tsx";
import { OmInspector } from "../om/OmInspector.tsx";
import { languageFor, type EditorLang } from "../editor/lang.ts";
import type { FileListEntry } from "../connector/types.ts";
```

to:

```tsx
import { For, Show, Switch, Match, createMemo, createResource, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { FileEditor } from "../editor/FileEditor.tsx";
import { OmInspector } from "../om/OmInspector.tsx";
import { languageFor, type EditorLang } from "../editor/lang.ts";
import type { FileListEntry } from "../connector/types.ts";
import { Panel } from "../shell/Panel.tsx";
import { createPanelLayout, type PanelDefault } from "../shell/panelLayout.ts";

const PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "system-files" },
	{ id: "editor" },
	{ id: "object-model", colSpan: 2 },
];
```

Inside `export default function System()`, right after `const app = useApp();` (currently line 17), add:

```tsx
	const layout = createPanelLayout("dwc-ng.layout.system", PANEL_DEFAULTS);
```

Replace the `return (...)` block (currently lines 58-117) with:

```tsx
	return (
		<>
			<div class="layout-toolbar">
				<button class="layout-reset" onClick={() => layout.reset()}>↺ Reset layout</button>
			</div>
			<div class="grid system">
				<Panel id="system-files" layout={layout} ariaLabel="System files">
					<div class="card-head">
						<h2 class="card-title">System files</h2>
						<span class="des">{dir()}</span>
					</div>
					<Show when={connected()} fallback={<p class="job-empty">Not connected.</p>}>
						<Show when={dir() !== SYS_ROOT}>
							<button class="link-btn" onClick={goUp}>← up a level</button>
						</Show>
						<ul class="file-list">
							<For each={sorted()} fallback={<li class="job-empty">Empty.</li>}>
								{entry => (
									<li class="file-row" classList={{ active: selected() === pathOf(entry) }}>
										<Switch>
											<Match when={entry.type === "d"}>
												<button class="file-name is-dir" onClick={() => open(entry)}>
													<span class="file-ico">▸</span>{entry.name}
												</button>
											</Match>
											<Match when={entry.type === "f"}>
												<button class="file-name" onClick={() => open(entry)}>{entry.name}</button>
											</Match>
										</Switch>
									</li>
								)}
							</For>
						</ul>
					</Show>
				</Panel>

				<Panel id="editor" layout={layout} ariaLabel="Editor" class="editor-card">
					<Show
						when={selected()}
						fallback={
							<>
								<div class="card-head"><h2 class="card-title">Editor</h2></div>
								<p class="job-empty">
									Select a system file to view or edit it. These run when the firmware
									calls them — config.g at boot, homeall.g on G28.
								</p>
							</>
						}
					>
						{path => <FileEditor path={path()} lang={langOf(path())} onClose={() => setSelected(null)} />}
					</Show>
				</Panel>

				<Panel id="object-model" layout={layout} ariaLabel="Object model" class="om-card">
					<div class="card-head">
						<h2 class="card-title">Object model</h2>
						<span class="des">live · rr_model</span>
					</div>
					<Show when={connected()} fallback={<p class="job-empty">Not connected.</p>}>
						<OmInspector data={app.om.om as unknown as Record<string, unknown>} />
					</Show>
				</Panel>
			</div>
		</>
	);
}
```

- [ ] **Step 3: Remove the now-superseded CSS rule**

In `packages/ui/src/app.css`, find and delete this line (currently line 835):

```css
.system .om-card { grid-column: 1 / -1; }
```

- [ ] **Step 4: Typecheck and run tests**

Run (from `packages/ui`): `node ../../node_modules/typescript/bin/tsc -b`
Expected: same 3 pre-existing errors, no new ones.

Run: `pnpm --filter @dwc-ng/ui test`
Expected: PASS.

- [ ] **Step 5: Live-verify in the browser**

Using Chrome browser automation:
1. Navigate to `http://localhost:5173/#/macros`. Confirm backend reads `MOCK`. Drag-reorder the two panels; reload; confirm it persisted; reset.
2. Navigate to `http://localhost:5173/#/system`. Screenshot: confirm Object Model still renders full-width below System Files/Editor (unchanged from before). Drag-reorder; resize System Files to span 2 columns; reload; confirm both persisted; reset; confirm back to default (Object Model full-width again).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/views/Macros.tsx packages/ui/src/views/System.tsx packages/ui/src/app.css
git commit -m "feat(ui): rearrangeable panels on the Macros and System views

Both follow the now-established Panel/createPanelLayout pattern. System's
Object Model panel keeps its full-width default (colSpan: 2) matching the
CSS rule it replaces."
```

---

### Task 7: Wire `Control.tsx`

**Files:**
- Modify: `packages/ui/src/views/Control.tsx`

**Interfaces:**
- Consumes: same as Task 4.
- Produces: confirms the conditional-panel behavior again under a different condition (Fans only renders `when={app.om.om.fans.some(f => f !== null)}`, a machine-state condition rather than a UI-selection one).

- [ ] **Step 1: Wire the view**

Change the import block (currently lines 1-4):

```tsx
import { For, Show, createMemo, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { cmd } from "../control/commands.ts";
import { GcodeButton } from "../control/GcodeButton.tsx";
```

to:

```tsx
import { For, Show, createMemo, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { cmd } from "../control/commands.ts";
import { GcodeButton } from "../control/GcodeButton.tsx";
import { Panel } from "../shell/Panel.tsx";
import { createPanelLayout, type PanelDefault } from "../shell/panelLayout.ts";

const PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "homing" },
	{ id: "tools" },
	{ id: "heaters" },
	{ id: "movement" },
	{ id: "fans" },
	{ id: "tuning" },
];
```

Inside `export default function Control()`, right after `const app = useApp();` (currently line 15), add:

```tsx
	const layout = createPanelLayout("dwc-ng.layout.control", PANEL_DEFAULTS);
```

Replace the whole `return (...)` block (currently lines 34-197) with:

```tsx
	return (
		<>
			<div class="layout-toolbar">
				<button class="layout-reset" onClick={() => layout.reset()}>↺ Reset layout</button>
			</div>
			<div class="grid control">
				<Panel id="homing" layout={layout} ariaLabel="Homing">
					<div class="card-head"><h2 class="card-title">Homing</h2><span class="des">G28</span></div>
					<div class="ctl-wrap">
						<GcodeButton label="Home All" variant="go" command={cmd.homeAll()} />
						<For each={axes()}>
							{axis => (
								<GcodeButton
									label={`Home ${axis.letter}${role(axis.letter) ? ` · ${role(axis.letter)}` : ""}`}
									command={cmd.homeAxis(axis.letter)}
								/>
							)}
						</For>
					</div>
				</Panel>

				<Panel id="tools" layout={layout} ariaLabel="Tools">
					<div class="card-head"><h2 class="card-title">Tools</h2><span class="des">T · state.currentTool</span></div>
					<div class="ctl-wrap">
						<For each={app.om.om.tools}>
							{tool => (
								<Show when={tool}>
									{t => (
										<GcodeButton
											label={t().name || `Tool ${t().number}`}
											variant={app.om.om.state.currentTool === t().number ? "go" : undefined}
											command={cmd.selectTool(t().number)}
										/>
									)}
								</Show>
							)}
						</For>
						<GcodeButton label="Deselect" variant="quiet" command={cmd.deselectTool()} />
					</div>
				</Panel>

				<Panel id="heaters" layout={layout} ariaLabel="Heaters">
					<div class="card-head"><h2 class="card-title">Heaters</h2><span class="des">M568 · M140</span></div>
					<div class="heater-list">
						<For each={app.om.om.tools}>
							{tool => (
								<Show when={tool}>
									{t => (
										<HeaterControl
											label={t().name || `Tool ${t().number}`}
											kind="tool"
											num={t().number}
											active={heaterActive(t().heaters[0] ?? -1)}
										/>
									)}
								</Show>
							)}
						</For>
						<Show when={bedModelIndex() >= 0}>
							<HeaterControl label="Bed" kind="bed" num={0} active={heaterActive(bedModelIndex())} />
						</Show>
					</div>
				</Panel>

				<Panel id="movement" layout={layout} ariaLabel="Movement">
					<div class="card-head"><h2 class="card-title">Movement</h2><span class="des">M120 · G91 · M121</span></div>
					<div class="jog-controls">
						<div class="step-row">
							<span class="ctl-name">Step</span>
							<For each={STEPS}>
								{s => (
									<button class="chip-btn" classList={{ active: step() === s }} onClick={() => setStep(s)}>{s} mm</button>
								)}
							</For>
							<label class="feed-field">Feed <input type="number" value={jogFeed()} onInput={e => setJogFeed(Number(e.currentTarget.value))} /></label>
						</div>

						<div class="jog-pad">
							<Show when={hasAxis("X") && hasAxis("Y")}>
								<div class="jog-xy" role="group" aria-label="X/Y jog">
									<GcodeButton class="jog-key pos-yp" label="+Y" command={cmd.jog("Y", step(), jogFeed())} stamp={false} />
									<GcodeButton class="jog-key pos-xn" label="−X" command={cmd.jog("X", -step(), jogFeed())} stamp={false} />
									<span class="jog-center">{step()}<small>mm</small></span>
									<GcodeButton class="jog-key pos-xp" label="+X" command={cmd.jog("X", step(), jogFeed())} stamp={false} />
									<GcodeButton class="jog-key pos-yn" label="−Y" command={cmd.jog("Y", -step(), jogFeed())} stamp={false} />
								</div>
							</Show>
							<Show when={hasAxis("Z")}>
								<div class="jog-z" role="group" aria-label="Z jog">
									<GcodeButton class="jog-key" label="+Z" command={cmd.jog("Z", step(), jogFeed())} stamp={false} />
									<span class="jog-zlabel">Z</span>
									<GcodeButton class="jog-key" label="−Z" command={cmd.jog("Z", -step(), jogFeed())} stamp={false} />
								</div>
							</Show>
						</div>

						<Show when={auxAxes().length > 0}>
							<div class="jog-aux">
								<For each={auxAxes()}>
									{axis => (
										<div class="jog-row">
											<span class="ctl-name">{axis.letter}<Show when={role(axis.letter)}>{r => <small>{r()}</small>}</Show></span>
											<GcodeButton label={`− ${step()}`} command={cmd.jog(axis.letter, -step(), jogFeed())} stamp={false} />
											<GcodeButton label={`+ ${step()}`} command={cmd.jog(axis.letter, step(), jogFeed())} stamp={false} />
										</div>
									)}
								</For>
							</div>
						</Show>

						<Show when={hasAxis("C")}>
							<div class="coupler-row">
								<span class="ctl-name">Coupler <small>C</small></span>
								<GcodeButton label="Lock" command={cmd.couplerLock()} />
								<GcodeButton label="Unlock" variant="quiet" command={cmd.couplerUnlock()} />
							</div>
						</Show>
						<div class="extrude-row">
							<span class="ctl-name">Extruder</span>
							<label class="feed-field">mm <input type="number" value={extAmt()} onInput={e => setExtAmt(Number(e.currentTarget.value))} /></label>
							<label class="feed-field">F <input type="number" value={extFeed()} onInput={e => setExtFeed(Number(e.currentTarget.value))} /></label>
							<GcodeButton label="Retract" command={cmd.extrude(-extAmt(), extFeed())} stamp={false} />
							<GcodeButton label="Extrude" command={cmd.extrude(extAmt(), extFeed())} stamp={false} />
						</div>
					</div>
				</Panel>

				<Show when={app.om.om.fans.some(f => f !== null)}>
					<Panel id="fans" layout={layout} ariaLabel="Fans">
						<div class="card-head"><h2 class="card-title">Fans</h2><span class="des">M106</span></div>
						<div class="heater-list">
							<For each={app.om.om.fans}>
								{(fan, i) => (
									<Show when={fan}>
										{f => <FanControl label={f().name || `Fan ${i()}`} index={i()} value={f().actualValue} />}
									</Show>
								)}
							</For>
						</div>
					</Panel>
				</Show>

				<Panel id="tuning" layout={layout} ariaLabel="Tuning">
					<div class="card-head"><h2 class="card-title">Tuning</h2><span class="des">M220 · M221 · M290</span></div>
					<div class="heater-list">
						<FactorControl label="Speed" build={cmd.speedFactor} current={Math.round((app.om.om.move.speedFactor ?? 1) * 100)} />
						<div class="heater-ctl">
							<span class="ctl-name">Babystep Z</span>
							<label class="feed-field">mm <input type="number" step="0.01" value={babyStep()} onInput={e => setBabyStep(Number(e.currentTarget.value))} /></label>
							<div class="btn-cluster">
								<GcodeButton label={`− ${babyStep()}`} command={cmd.babystep(-babyStep())} stamp={false} />
								<GcodeButton label={`+ ${babyStep()}`} command={cmd.babystep(babyStep())} stamp={false} />
							</div>
						</div>
					</div>
				</Panel>
			</div>
		</>
	);
}
```

- [ ] **Step 2: Typecheck and run tests**

Run (from `packages/ui`): `node ../../node_modules/typescript/bin/tsc -b`
Expected: same 3 pre-existing errors, no new ones.

Run: `pnpm --filter @dwc-ng/ui test`
Expected: PASS.

- [ ] **Step 3: Live-verify in the browser**

Using Chrome browser automation:
1. Navigate to `http://localhost:5173/#/control`. Confirm backend reads `MOCK`.
2. Drag-reorder Homing and Tuning; resize Movement to span 2 rows (drag its resize grip downward); reload; confirm both persisted.
3. Confirm Fans still renders (mock snapshot's toolchanger has fans) in its default position; reset the layout; confirm everything's back to Homing/Tools/Heaters/Movement/Fans/Tuning in order.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/views/Control.tsx
git commit -m "feat(ui): rearrangeable panels on the Control view

Homing, Tools, Heaters, Movement, Fans (conditional on the machine having
fans), and Tuning are now drag-to-reorder and resize-by-span."
```

---

### Task 8: Wire `Settings.tsx`

**Files:**
- Modify: `packages/ui/src/views/Settings.tsx`

**Interfaces:**
- Consumes: same as Task 4.
- Produces: nothing new — last of the six views. Also fixes the `.save-bar` order-interleaving risk flagged in the spec.

- [ ] **Step 1: Wire the view**

Change the import block (currently lines 1-3):

```tsx
import { For, Show, createMemo } from "solid-js";
import { useApp } from "../shell/context.ts";
import { CONFIG_FILE } from "../config/types.ts";
```

to:

```tsx
import { For, Show, createMemo } from "solid-js";
import { useApp } from "../shell/context.ts";
import { CONFIG_FILE } from "../config/types.ts";
import { Panel } from "../shell/Panel.tsx";
import { createPanelLayout, type PanelDefault } from "../shell/panelLayout.ts";

const PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "axis-roles" },
	{ id: "tool-dock-sensors" },
	{ id: "camera" },
	{ id: "saved-versions" },
];
```

Inside `export default function Settings()`, right after `const app = useApp();` (currently line 11), add:

```tsx
	const layout = createPanelLayout("dwc-ng.layout.settings", PANEL_DEFAULTS);
```

Replace the whole `return (...)` block (currently lines 19-152) with:

```tsx
	return (
		<>
			<div class="layout-toolbar">
				<button class="layout-reset" onClick={() => layout.reset()}>↺ Reset layout</button>
			</div>
			<div class="grid settings">
				<Panel id="axis-roles" layout={layout} ariaLabel="Axis roles">
					<div class="card-head">
						<h2 class="card-title">Axis roles</h2>
						<button class="link-btn" onClick={() => app.config.resetSection("axisRoles")}>Reset</button>
					</div>
					<p class="hint">
						Label what each axis physically is on this machine — the firmware only
						knows letters. Labels appear in the position readout and jog controls.
					</p>
					<Show when={visibleAxes().length} fallback={<p class="job-empty">Waiting for the machine…</p>}>
						<For each={visibleAxes()}>
							{axis => (
								<label class="field">
									<span class="field-label">{axis.letter}</span>
									<input
										type="text"
										placeholder="e.g. Z motor 1"
										value={app.config.config.axisRoles[axis.letter] ?? ""}
										onChange={e => {
											const value = e.currentTarget.value.trim();
											if (value === "") app.config.clearAxisRole(axis.letter);
											else app.config.setAxisRole(axis.letter, value);
										}}
									/>
								</label>
							)}
						</For>
					</Show>
				</Panel>

				<Panel id="tool-dock-sensors" layout={layout} ariaLabel="Tool dock sensors">
					<div class="card-head">
						<h2 class="card-title">Tool dock sensors</h2>
						<button class="link-btn" onClick={() => app.config.resetSection("dockSensors")}>Reset</button>
					</div>
					<p class="hint">
						If a tool has a presence switch in its dock, map it here (sensors.gpIn
						index). The sensor reports docked or away — it cannot know "mounted".
					</p>
					<For each={app.om.om.tools}>
						{tool => (
							<Show when={tool}>
								{t => (
									<div class="field">
										<span class="field-label">T{t().number}</span>
										<input
											type="number"
											min="0"
											placeholder="gpIn #"
											value={app.config.config.dockSensors[String(t().number)]?.gpIn ?? ""}
											onChange={e => {
												const parsed = parseInt(e.currentTarget.value, 10);
												if (Number.isNaN(parsed)) app.config.clearDockSensor(t().number);
												else app.config.setDockSensor(t().number, {
													gpIn: parsed,
													inverted: app.config.config.dockSensors[String(t().number)]?.inverted,
												});
											}}
										/>
										<label class="check">
											<input
												type="checkbox"
												disabled={app.config.config.dockSensors[String(t().number)] === undefined}
												checked={app.config.config.dockSensors[String(t().number)]?.inverted ?? false}
												onChange={e => {
													const ref = app.config.config.dockSensors[String(t().number)];
													if (ref !== undefined) {
														app.config.setDockSensor(t().number, { gpIn: ref.gpIn, inverted: e.currentTarget.checked });
													}
												}}
											/>
											inverted
										</label>
									</div>
								)}
							</Show>
						)}
					</For>
				</Panel>

				<Panel id="camera" layout={layout} ariaLabel="Camera">
					<div class="card-head">
						<h2 class="card-title">Camera</h2>
						<button class="link-btn" onClick={() => app.config.resetSection("camera")}>Reset</button>
					</div>
					<p class="hint">The camera shows as a floating tile you can keep on every view.</p>
					<label class="field">
						<span class="field-label">Stream URL</span>
						<input
							type="text"
							placeholder="http://printercams:8080/stream"
							value={app.config.config.camera.streamUrl}
							onChange={e => app.config.setCamera({ streamUrl: e.currentTarget.value.trim() })}
						/>
					</label>
				</Panel>

				<Panel id="saved-versions" layout={layout} ariaLabel="Saved versions">
					<div class="card-head">
						<h2 class="card-title">Saved versions</h2>
					</div>
					<p class="hint">
						Every save keeps a version here — experiment freely and go back with
						one click. Settings live on the SD card ({CONFIG_FILE}), so they
						follow the machine to any browser.
					</p>
					<Show when={app.config.snapshots.length} fallback={<p class="job-empty">No saved versions yet.</p>}>
						<For each={app.config.snapshots}>
							{(snap, index) => (
								<div class="field">
									<span class="field-label">
										{new Date(snap.takenAt).toLocaleTimeString(undefined, { hour12: false })}
									</span>
									<span class="hint">{snap.label}</span>
									<button class="link-btn" onClick={() => app.config.revert(index())}>Restore</button>
								</div>
							)}
						</For>
					</Show>
				</Panel>

				{/* Not a Panel — never reordered. Forced order keeps it last
				    regardless of how the panels above get shuffled: grid `order`
				    groups items by value, and an un-ordered sibling could otherwise
				    render between two reordered panels instead of staying at the end. */}
				<div class="save-bar" style={{ order: String(PANEL_DEFAULTS.length) }}>
					<Show when={app.config.dirty} fallback={<span class="hint">All changes saved.</span>}>
						<span class="hint unsaved">Unsaved changes</span>
					</Show>
					<button class="primary-btn" disabled={!app.config.dirty} onClick={save}>
						Save to machine
					</button>
					<button class="link-btn" onClick={() => app.config.resetAll()}>Reset everything</button>
				</div>
			</div>
		</>
	);
}
```

- [ ] **Step 2: Typecheck and run tests**

Run (from `packages/ui`): `node ../../node_modules/typescript/bin/tsc -b`
Expected: same 3 pre-existing errors, no new ones.

Run: `pnpm --filter @dwc-ng/ui test`
Expected: PASS.

- [ ] **Step 3: Live-verify in the browser**

Using Chrome browser automation:
1. Navigate to `http://localhost:5173/#/settings`. Confirm backend reads `MOCK`.
2. Drag "Saved versions" to the front (order 0); screenshot to confirm the save-bar (Save/Reset everything row) still renders last, below all four cards, not between them.
3. Reload; confirm the reordering persisted and save-bar is still last.
4. Click "↺ Reset layout"; confirm order returns to Axis roles / Tool dock sensors / Camera / Saved versions, save-bar still last.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/views/Settings.tsx
git commit -m "feat(ui): rearrangeable panels on the Settings view

Axis roles, Tool dock sensors, Camera, and Saved versions are now drag-to-
reorder and resize-by-span. The save-bar (Save/Reset everything) isn't a
Panel and gets a forced order past every panel's range so it can't render
between two reordered panels — grid order groups by value regardless of a
sibling's source position."
```

---

### Task 9: Final regression pass

**Files:** none (verification only).

**Interfaces:** none — this task produces no new code, just confidence that Tasks 1–8 compose correctly across the whole app.

- [ ] **Step 1: Full test suite**

Run: `pnpm --filter @dwc-ng/ui test`
Expected: PASS — all pre-existing tests (73 from before this plan) plus the new `panel-layout.test.ts` suite.

Run: `pnpm --filter @dwc-ng/mock-duet test`
Expected: PASS — unchanged (this plan never touches `packages/mock-duet`).

- [ ] **Step 2: Full typecheck**

Run (from `packages/ui`): `node ../../node_modules/typescript/bin/tsc -b`
Expected: exactly the same 3 pre-existing errors as at the start of this plan (`writeGuard.ts:48`, `editor/setup.ts:11`, `Shell.tsx`'s unused `app`) — confirming this plan introduced none.

- [ ] **Step 3: Cross-view smoke test in the browser**

Using Chrome browser automation, with mock-duet + the dev server running:
1. Visit all six views (`#/machine`, `#/jobs`, `#/macros`, `#/control`, `#/system`, `#/settings`) in sequence. Confirm the backend toggle reads `MOCK` throughout.
2. On each, confirm the "↺ Reset layout" button is present and every panel shows its grip on hover/drag-attempt.
3. Resize the browser to ≤900px width once on Machine (the view with the widest default panel); confirm no horizontal scrollbar appears — the mobile colSpan clamp holds app-wide, not just on the view it was built against.
4. Resize back to desktop width; confirm Machine's layout (any changes made earlier in this session) is still exactly as left.

- [ ] **Step 4: Wrap-up**

No commit — this task made no changes. If any regression surfaced in Steps 1–3, fix it as a new commit before considering the plan complete.

---

## Self-Review Notes

- **Spec coverage:** every section of the spec (`2026-07-17-rearrangeable-panels-design.md`) maps to a task — architecture (Tasks 1–3), scope/all six views (Tasks 4–8), mobile clamp (Task 2, verified in Tasks 4 and 9), reset semantics (every wiring task), testing (Task 1). The two spec refinements (default spans beyond 1×1, grip placement as a corner tab rather than inside card-head) are called out explicitly in "Plan refinements" above rather than silently diverging.
- **Placeholder scan:** no TBD/TODO; every step has real, complete code or an exact runnable command with expected output.
- **Type consistency:** `PanelDefault`, `PanelSpanState`, `PanelLayoutState`, `PanelLayoutController`, `createPanelLayout`, `Panel` props (`id`, `layout`, `ariaLabel`, `class?`, `children`) are named identically everywhere they're used across Tasks 1–8.
- **Scope check:** single cohesive feature (one spec, one plan), naturally decomposed into a shared foundation (Tasks 1–3) plus six near-identical per-view tasks (4–8) plus a final regression pass (9) — each independently testable and committable, matching the "bite-sized, frequent commits" requirement.
