# Grid Canvas Panel Layout — Design Spec

Date: 2026-07-17
Status: approved by Gabe (brainstorming session, superseding same-day rearrangeable-panels design)

## Purpose

Replace the fixed-2-column panel layout (spec `2026-07-17-rearrangeable-panels-design.md`,
built as Tasks 1-7 on `panelLayout.ts`/`Panel.tsx`) with a fully positioned grid
canvas: panels sit at explicit `(col, row)` coordinates on a 24-column grid,
sized by `(colSpan, rowSpan)`, move only into empty space, resize only until
blocked by a neighbor, and never move otherwise — nothing on the canvas
shifts except the panel you're directly dragging. This was discovered
mid-session by testing the old system live — it fundamentally
cannot express "three stacked half-width panels beside one tall panel"
because CSS Grid auto-flow has no explicit column assignment, only linear
order + a span cap of 2.

## Why the old system doesn't work

- Auto-flow (`order` + `colSpan ∈ {1,2}`) alternates panels between columns
  as it fills rows — there's no way to pin several panels to one column
  region while another column holds something else.
- `rowSpan` on `grid-auto-rows: auto` tracks only grows visually if some
  *other* panel shares those rows — an isolated panel's resize can be
  invisible.
- Drag-reorder swaps two panels' `order` values; it can't place a panel at
  an arbitrary position.
- Console/camera are global floating overlays (`floatingTile.ts`), not
  per-view — Gabe now wants them as regular per-view panels instead.

## Grid & data model

- CSS Grid, `grid-template-columns: repeat(24, minmax(0, 1fr))` — 24 equal
  proportional columns, scaling with viewport width exactly like today's
  2-column grid does. This is what makes "no fixed number of columns"
  true for panels (they can span 1-24, not capped at 2) while the grid
  itself has a stable, well-understood track count.
- `grid-auto-rows: 24px` — a fixed-pixel row unit. Rows are unbounded;
  the canvas grows as tall as its content requires and the page scrolls.
  Fixed height (not `auto`) is what fixes the "resize does nothing
  visually" bug: spanning N rows is always N × 24px, regardless of what
  else occupies those rows.
- Per-panel state: `{ col: 0-23, row: ≥0, colSpan: 1-24, rowSpan: ≥1 }`.
- Every view's panel set now includes **`console`** and **`camera`** as
  two more entries alongside its existing cards — these are no longer
  global overlays. Console/camera *data* (message log, stream URL,
  pinned flag) stays shared/global via existing config/OM state; only
  their on-screen *placement* becomes per-view and independent (you
  could pin console at the top on Machine, tucked in a corner on
  Control, and they don't share a position).

## Interactions

**Move.** Dragging a panel by its grip proposes a new `(col, row)`. The
move commits only if the resulting rectangle doesn't overlap any other
panel and stays within `[0, 24)` columns and `row ≥ 0` — otherwise the
drag simply can't go there; on release without ever reaching a valid
spot, the panel stays exactly where it started. A move never displaces,
swaps, or otherwise touches any panel besides the one being dragged.

**Resize.** Dragging a panel's corner grip grows `colSpan`/`rowSpan` one
cell at a time, hard-clamped at the first occupied neighboring cell or
the grid boundary in that direction — like hitting a wall. To grow
further, the blocking neighbor must be moved out of the way first, then
the resize can continue into the space it vacated. v1 resizes from the
bottom-right corner only (grow right/down, shrink by dragging back),
matching the existing Panel grip convention — no separate top/left-edge
handles.

**No automatic settling (revised post-ship).** The original round of this
spec included a "settle" pass — after a move, other panels would auto-pull
up/left into freed space. Built, tested, and shipped, then reversed after
live use: it read as unpredictable ("everything floats to pack the area")
even though it only ever ran after a manual move, never a resize. Current
behavior: a panel only ever changes position when directly dragged.
Nothing else on the canvas moves as a side effect of anything, ever —
freed space just stays empty until something is explicitly dragged into
it. The `settle()` function and its tests have been removed entirely
rather than kept dead/unused.

**Scope for this round.** Serial, single-panel drags only. Moving or
selecting multiple panels together is a real, explicitly-deferred future
enhancement — not built now.

## Persistence, defaults, reset

Same pattern as everything else built this session: `localStorage` per
view (`dwc-ng.canvas.<view>`), tolerant parse/merge/clamp so corrupt or
stale stored data can never break a view's grid (a panel id missing from
storage gets appended after the highest known position; an id no longer
in the view's panel list is dropped; out-of-range col/row/span values
clamp into bounds). A per-view "↺ Reset layout" button drops that view's
stored canvas back to its coded defaults — console and camera included.

## Migration

Replaces, in full:
- `packages/ui/src/shell/panelLayout.ts` and its test file (fixed-grid
  logic — order/colSpan/rowSpan/mergeLayout/clampSpan/span-step math).
- `packages/ui/src/shell/Panel.tsx` (swap-based reorder + span-step resize).
- `packages/ui/src/shell/floatingTile.ts` (console/camera's global
  drag/resize mechanism) — deleted; console/camera become panels.
- The now-dead `loadConsoleFloating`/`saveConsoleFloating` in
  `consoleLog.ts` (the docked/floating toggle concept no longer exists).
- `Shell.tsx`'s `ConsoleDrawer`/`ConsoleTile`/`ConsoleHistory`/
  `ConsoleForm`/`CameraTile` and the `consoleFloating` module signal —
  removed from the global shell; their JSX becomes two reusable
  components (`ConsolePanel`, `CameraPanel`) each view places as a
  regular `<Panel>`.

All six views (Machine, Jobs, Macros, System, Control — previously wired
to the old system — and Settings, never wired) get rewired to the new
`PanelCanvas`/`Panel`/`createPanelCanvas` primitives, each including
`console` and `camera` in its panel set.

## Testing

Pure logic — `rectsOverlap`, collision/bounds checking, clamped-growth
math for resize, clamped-move validation, and tolerant load/merge/clamp —
is unit-tested via `node:test`, same TDD style as every other pure module
this session. Drag, resize, persistence, and reset are verified live per
view against `mock-duet`, same as Tasks 4-7.

## Out of scope

- Multi-panel/batch move (noted future enhancement).
- Top/left-edge resize handles (bottom-right corner only, v1).
- Any shared/global position for console or camera (explicitly rejected
  — independent per view).
