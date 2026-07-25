# Card overlap reflow on load — design

**Date:** 2026-07-25
**Source:** `USER_AUDIT.md` line 19
**Status:** approved (Gabe, 2026-07-25)

> change behavior of card overlap: if cards are redesigned and dimensions
> change, the next time the page loads, push the cards right or down, order of
> cards from left to right and down. choose right or down based on whichever
> direction has the least distance to cover

## The problem, precisely

A screen's geometry lives in two tiers:

- the **composition** — built-in `compose/screens.ts` merged with the user's
  SD-backed config overlay;
- the **canvas** — this browser's `localStorage["dwc-ng.canvas.<screen>"]`,
  written on every drag.

`mergeCanvas(stored, defaults)` (`shell/panelCanvas.ts:464`) reconciles them at
mount, and today the rule is *stored wins, unconditionally*:

```ts
result[d.id] = isPanelRect(entry) ? clampRect(entry) : fallback[d.id]!;
```

So when a card's coded dimensions change, a browser that has ever laid out that
screen keeps the old numbers forever.

**Observed 2026-07-24/25.** The live-move-speeds work bumped `position`
`rowSpan` 95 → 103 and `active-job` 40 → 46 in both `defs.ts` and all three
compositions. On Gabe's machine nothing changed: `localStorage` pinned 95 and 40,
`mergeCanvas` preferred them, and the new speed footer plus the relocated
Pause/Cancel buttons rendered below the fold. The only escapes were resizing
each card by hand or Reset Layout, which discards the whole arrangement.

Note the failure is *not* an overlap. Keeping the old span leaves the layout
collision-free and merely too short. The overlap appears only once the new span
is adopted — which is the fix this document specifies, and which is why the two
halves (adopt, then reflow) have to ship together.

## Decisions

Both were put to Gabe as multiple choice with trade-offs; both answers are his,
and neither was the recommendation.

### D1 — Grow-only adoption, no baseline tracking

Per card, per axis: `span = max(stored, composition)`. Position is untouched.

Rejected alternative (recommended, not chosen): store the composition rect each
slot was last reconciled against, so "the code changed" and "the user resized"
become distinguishable. Costs one field per slot plus a format-version bump.

**Accepted consequence, stated plainly:** a card the user has deliberately
shrunk below its coded default is grown back the next time that default is
touched, and nothing can tell it was a deliberate shrink. The detent breakaway
(`applyDetent`, `panelCanvas.ts:241`) exists precisely so a card *can* be pulled
below its content and scroll; this design will undo such a shrink on the next
redesign of that card. Shrinks are preserved across every load where the coded
default does not move.

### D2 — Distance measured in grid cells

`rightCells` and `downCells` are compared as raw cell counts, not pixels.

Rejected alternative (recommended, not chosen): convert to pixels
(`cols × 46`, `rows × 4`) so "least distance" means least visual distance.

**Accepted consequence, stated plainly:** the grid is anisotropic — a column is
46px, a row is 4px — so equal cell counts are an 11.5× difference on screen.
For the common case this is harmless and in fact correct: a card sitting flush
beneath one that grew 8 rows computes `down = 8` against `right = 24` and is
pushed down, which is the desired outcome and matches the 2026-07-24 incident
exactly. The pathological case is a card whose top lands *deep inside* a grown
card's new span: a 12-column card that grows 40 rows yields `right = 12` against
`down = 40`, and the neighbour is shoved a column sideways, possibly cascading.
Accepted as specified.

## Algorithm

Two pure functions, composed inside `mergeCanvas`. Pure = no DOM, no Solid, no
storage, so both are testable without a browser — the standing rule for this
module (`panelCanvas.ts:1-12`).

### `growToDefaults(stored, defaults) -> { state, grew }`

For each id in `defaults`:

- absent from `stored`, or not a valid rect → the coded default verbatim
  (today's behavior, unchanged);
- present → `col`/`row` from stored; `colSpan = max(stored.colSpan,
  default.colSpan)`; `rowSpan = max(stored.rowSpan, default.rowSpan)`.

Every result passes through `clampRect`, so a `colSpan` grown past the grid
pulls `col` back into bounds rather than escaping it.

`grew` is true iff at least one span strictly increased. Ids in `stored` but not
in `defaults` are dropped, as today.

### `reflow(state) -> state`

Sort ids into **reading order**: `row` ascending, then `col` ascending, then id
(the last key only for determinism when two cards share a corner).

Place each in turn against the already-placed set. While the candidate collides
with some placed rect `b` — the first such in reading order:

```
rightCells = (b.col + b.colSpan) - candidate.col
downCells  = (b.row + b.rowSpan) - candidate.row

fitsRight  = candidate.col + rightCells + candidate.colSpan <= GRID_COLS

if fitsRight and rightCells <= downCells:  candidate.col += rightCells
else:                                      candidate.row += downCells
```

Ties go right (`<=`), because right is the bounded axis — taking it when
available keeps the layout compact, and the unbounded axis is always still
there.

The first card in reading order never moves, and no card is ever pushed up or
left. A grown card keeps its position; its neighbours yield.

**Termination.** Each push strictly increases `col` or `row`. `col` is bounded
by `GRID_COLS`, and when right no longer fits the down branch is forced; `row`
is unbounded and the placed set is finite, so a row beneath every placed rect is
always free. Same argument `slideDownToFree` (`panelCanvas.ts:114`) already
rests on.

**Idempotence.** Running `reflow` on its own output is a no-op: its output is
collision-free, so no candidate ever enters the push loop.

## The trigger: gated on `grew`

```ts
export function mergeCanvas(stored: unknown, defaults: PanelDefault[]): CanvasState {
    // ... existing per-id reconciliation, via growToDefaults
    return grew ? reflow(state) : state;
}
```

When nothing grew, `mergeCanvas` returns exactly what it returns today. This is
not an optimisation — it is required for correctness.

The current code **deliberately tolerates legal overlaps**. From
`panelCanvas.ts:440-448`: a hidden card (`visibleWhen` false) releases its grid
cells precisely so visible cards can be resized into that space, which stores a
legal overlap; the old mount-time "collision = corruption, reset everything"
verdict then erased the user's entire layout on every reload. Reflowing
unconditionally would resurrect a variant of that bug — shoving cards around to
"fix" overlaps that are intentional and invisible.

Gating on `grew` confines the repair to the load after a redesign, which is what
line 19 asks for ("the next time the page loads").

**Accepted consequence:** on a load that *does* have growth, any pre-existing
hidden-card overlap is resolved too, because `reflow` runs over the whole
canvas rather than a subgraph. Rare, and only on redesign loads. The alternative
— reflowing only the cards reachable from a grown card — needs cascade tracking
for no behavioural gain in the cases that occur.

## Persistence

The reflowed state is written to `localStorage` at controller init, via the same
`serializeCanvas` envelope, so the fixup settles once instead of being
recomputed on every load.

It does **not** call `onLayoutChange` / `markLayoutDirty`. A repair is not a
user edit, and firing a config-store mutation during signal initialisation is a
reactive-write-during-render hazard in Solid.

Correctness does not depend on the write landing: the algorithm is idempotent
and deterministic, so a browser in private mode (where `writeStorage` silently
no-ops) recomputes the identical layout every load.

## Scope

Untouched: `adoptLayout` (screen import), `ensureSlot` (card added or shown
again), `resetSlot`, `reset`. Line 19 specifies page load; those are different
events whose current behaviour is correct.

## Tests

`packages/ui/test/panel-canvas.test.ts`, against the pure functions:

1. grow adopts the larger span per axis independently; `col`/`row` unchanged
2. no growth → state returned untouched, **including a legal overlap** (the
   hidden-card regression guard)
3. flush neighbour beneath a grown card is pushed **down** (the 2026-07-24 case:
   `down = 8` vs `right = 24`)
4. width growth pushes the side neighbour **right**
5. right blocked by `GRID_COLS` falls back to **down**
6. a cascade displaces the third card too
7. `reflow(reflow(x)) === reflow(x)`
8. `hasCollisions(reflow(x)) === false` for a hand-built overlapping state —
   the red-check: this assertion fails if `reflow` is stubbed to a no-op
9. deterministic ordering: two cards sharing a corner resolve the same way
   regardless of key insertion order

## Verification (must be able to fail)

A check that cannot fail proves nothing (standing rule). The falsifiable live
check, run against the board after deploy:

Set `dwc-ng.canvas.machine` so `position` has `rowSpan: 95` and the card below
it sits flush, reload, and read back the stored rect. **Before** this change the
readback is `rowSpan: 95` with the neighbour unmoved. **After**, it must be
`rowSpan: 103` with the neighbour's `row` increased by exactly 8. Both outcomes
are observable and distinguishable, so the check can fail.
