# Rearrangeable Panel Grids — Design Spec

Date: 2026-07-17
Status: approved by Gabe (brainstorming session)

## Purpose

Every view (`Machine`, `Jobs`, `Macros`, `Control`, `System`, `Settings`) lays
its cards out in the same hand-rolled `<div class="grid ...">` wrapper — a
CSS Grid with `grid-template-columns: minmax(0, 5fr) minmax(0, 7fr)` on
desktop, collapsing to one column below 900px. Panels currently render in a
fixed order at a fixed size. This adds per-view drag-to-reorder and
resize-by-grid-span for those panels, persisted per browser, with a
per-view "reset to default layout" control.

This is a workspace preference, not machine config — same reasoning already
established for the console/camera tile placement (`consoleLog.ts`'s
floating flag, `floatingTile.ts`'s geometry): it lives in `localStorage`,
sticks immediately, and never touches the config overlay that uploads to the
machine's SD card.

## Scope

All six views with a `.grid` wrapper get this. Conditionally-rendered panels
(Jobs' "Active job" and "Job details" cards, Control's "Fans" card) keep
their stored slot in the order even while not rendered; they reappear in
their last position, they never get shuffled to the end just because they
were briefly absent.

## Architecture

Two new modules, following the existing pattern of small,
independently-testable units (`consoleLog.ts`, `floatingTile.ts`):

### `src/shell/panelLayout.ts`

`createPanelLayout(storageKey: string, panelIds: string[])` — a Solid
primitive. Holds `{ [id]: { order: number; colSpan: 1 | 2; rowSpan: number } }`
seeded from each view's current JSX order with `colSpan: 1, rowSpan: 1` for
every panel (i.e. shipping this changes nothing visually until someone drags
something). Loaded from / saved to `localStorage["dwc-ng.layout.<view>"]`,
using the same tolerant-parse-or-empty approach as `consoleLog.ts`'s
`parseConsole`.

Merge rule on load (this is the "nothing should break by construction"
guarantee):
- A panel id in `panelIds` but absent from stored data gets its default
  `{order: <its index>, colSpan: 1, rowSpan: 1}` appended.
- A stored id no longer in `panelIds` (e.g. a future view change removes a
  panel) is dropped silently.
- `colSpan`/`rowSpan` are clamped to `[1, 2]` / `[1, 4]` on load regardless of
  what's in storage, so a hand-edited or corrupted localStorage value can
  never produce an invalid grid-span.

Returns:
- `styleFor(id): Record<string, string>` — `order`, `grid-column: span N`,
  `grid-row: span M`, with `N` additionally clamped to the grid's *current*
  live column count (see Mobile clamp below) — the stored preference itself
  is untouched by this clamp, only what's rendered.
- `startReorder(id, event: PointerEvent)` — pointer-drag; while dragging,
  live-swaps `order` with whichever sibling panel the pointer is currently
  over (by `elementFromPoint` against sibling card rects); commits on
  pointerup. Same pointer-event approach as the console/camera tiles, not
  native HTML5 drag-and-drop (better touch support, consistent with what's
  already built).
- `startResize(id, event: PointerEvent)` — pointer-drag from a corner grip;
  converts the pixel delta into grid-track steps using the grid container's
  own measured column width / row height (`getBoundingClientRect` on the
  grid + panel), snaps `colSpan` to 1 or 2 and `rowSpan` to the nearest
  integer ≥ 1, live-previews while dragging, commits on pointerup.
- `reset(): void` — clears `localStorage["dwc-ng.layout.<view>"]` and resets
  every panel to its default order/span.

Pixel-delta → span-step conversion is a standalone pure function (not
embedded inline in the pointer handler) so it's unit-testable without a DOM.

### `src/shell/Panel.tsx`

Thin wrapper: `<Panel id="position" layout={layout}>...</Panel>` renders the
`<section class="card">` itself (taking over what's currently a bare
`<section class="card" aria-label="...">` in each view), applying
`style={layout.styleFor(props.id)}`. Adds a small drag-grip icon into the
card-head row (wired to `layout.startReorder`) and a resize-grip in the
panel's bottom-right corner (wired to `layout.startResize`). `aria-label`
moves from the raw `<section>` onto `Panel`'s props and gets forwarded.

### Per-view reset control

Each view adds one small "↺ Reset layout" button near its `.grid` wrapper,
calling `layout.reset()`. Per-view, not global — resetting Machine's layout
doesn't touch Jobs'.

## Mobile behavior (≤900px)

Reorder and resize stay **active** at every width, including touch (per
Gabe: consistency over disabling on small screens). The safety detail:
below 900px the grid collapses to one explicit column
(`grid-template-columns: minmax(0, 1fr)`), so an unclamped
`grid-column: span 2` saved from a desktop session would force the browser
to generate an implicit second column and overflow the page — exactly the
kind of construction-time breakage the project's "nothing should be able to
break by construction" rule exists to prevent.

Fix: `styleFor(id)` tracks the live column count reactively (a signal
updated on `resize`, matching the existing 900px breakpoint used everywhere
else in `app.css`) and clamps the *applied* `grid-column: span N` to
`min(storedColSpan, currentColumnCount)`. The *stored* preference is never
mutated by this clamp — a panel set to span 2 on desktop, viewed on a phone,
then viewed on desktop again renders exactly as before. Dragging the resize
grip while narrow can only produce `colSpan: 1` (there's only one track to
measure against), which is consistent, not a special-cased restriction.

## Testing

`panelLayout.ts`'s pure logic gets `node:test` coverage in the same style as
`console-log.test.ts`:
- Tolerant load of missing/corrupt/malformed storage → empty/default layout.
- Merge rule: unknown stored id dropped, new panel id appended with defaults,
  existing ids keep stored order/span.
- Clamping: out-of-range stored `colSpan`/`rowSpan` clamped to valid bounds.
- The pixel-delta → span-step conversion function, tested standalone against
  a range of container widths/deltas.

The pointer-drag wiring itself (like `floatingTile.ts`'s) is verified live in
the browser via Chrome automation, not unit-tested — consistent with the
existing console/camera tile work.

## Out of scope

- No config-overlay / SD-card persistence for layout (workspace preference
  only, per Gabe's decision).
- No global "reset all layouts" control — per-view only.
- No cross-browser/cross-device sync of layout — it's `localStorage`, same
  as the console/camera tile placement.
