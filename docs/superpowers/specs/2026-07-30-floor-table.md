# Floor table — baseline, 2026-07-30

Measured in Chrome at the default density pitch (`--row-unit: 4px`), against
branch `layout-archetypes` at `563e1b9`, before any card is converted to a
declaration. Units are canvas cells: rows × 4px, cols × 4px. Re-measured
through the fixed sweep at `6fced12`; the `row`/`col` numbers came back
identical (one config-dependent exception, noted at the table).

**This branch predates four card fixes that landed on `main` the same day**
(`9763574`, `b800bf1`, `93b7652`). Those four appear here in their broken
state, which is what makes this table worth keeping — see the finding below.

## THE FINDING: Invariant A reported nothing on all 41 cards, and four of them were broken

**Corrected 2026-07-30, after review.** The original wording here — "Invariant A
*passed* on all 41 cards" — was too kind to A, in a way that mattered: it read
as though 41 checks had been made and 41 had come back clean. They had not. Read
what each half of A can establish:

- **A · col could not have failed.** `contentColSpan` obtains its number by
  setting the body to `width: min-content` and reading it back
  (`panelCanvas.ts:387-393`). CSS Sizing 3 defines min-content as the size at a
  ZERO-sized containing block — the card's own width is already not an input.
  Probing three widths and getting three identical answers is a property of the
  measurement, not of the card. It is a tautology, and it is now labelled as one
  in the UI rather than printed as a passed check.
- **A · row largely re-derives a property that was engineered in on purpose.**
  `contentRowSpan` was rewritten to substitute a `flex-grow` child's DECLARED
  `min-height` for its rendered height (`panelCanvas.ts:344-351`), precisely to
  remove the self-reference A looks for. What A still covers is the narrow
  residue: a non-grow child whose rendered height tracks the card. Real, but
  small — and it is not what any of the four defects were.
- **Neither half sees a number.** `judgeAxis` receives only the sequence of
  reported values; no ground truth is in scope, by signature. A floor that is
  uniformly and grossly WRONG is therefore the cleanest possible pass.

On the same afternoon, a human sweep of the same 41 cards found **six real
defects**, four of which are visible in this very table as implausibly small
floors:

| Card | row floor | what was actually wrong |
|---|---|---|
| `temperatures` | 17 (68px) | dragged over its entire 253px chart |
| `gcode-viewer` | 17 (68px) | dragged over its own overlay buttons |
| `job-files` | 17 (68px) | dragged over its breadcrumbs and toolbar |
| `system-files` | 17 (68px) | same — shares `.fb` |

68px is header + chrome and nothing else. Every one of them is a card whose
slack-absorbing child declared `min-height: 0` — and that is the SAME line of
code that makes A pass, so A was on the wrong side of the defect by
construction.

### What was done about it

A third check now runs beside A and B, and it is the only one of the three that
can fail on a layout defect rather than on an inconsistency in the measurement:

> **Body in floor.** Measure the card's floor as it stands. Measure it again
> with the body's non-header children hidden — the same `contentRowSpan`, run a
> second time, not a re-derivation of it. Subtract. What remains is exactly the
> rows the card's content is worth; zero means the card's minimum is its header
> and chrome alone.

It needs no declared ground truth, which is why it could be built now rather
than waiting for the declared-vs-measured oracle. Verified to discriminate in
both directions, in Chrome, against this worktree: it flags all four cards above
(plus `camera`, which sits at the same header-only floor), passes the other 36,
and when the exact defect — a `flex-grow` child with `min-height: 0` — is
injected by hand into the known-good `homing` card, that card flips from 87 rows
to 17 and reads `IGNORES BODY` **while both Invariant A columns still say
"unchanged"**. Removing the injected rule restores 87.

The declared-vs-measured comparison the spec calls the oracle proper still does
not exist. Neither the UI nor this table should be read as though it does.

Corollary for the archetype work: an arithmetic floor derived from a
declaration cannot be silently zero, because the declaration has to name a
number. The four defects are exactly the class the declaration removes.

## Table

`row` / `col` are the computed stops. `body` is how many of those `row` units
the card's own content is worth — `row` minus the same measurement taken with
the body emptied. `B` is Invariant B: descendants that changed position when the
card was resized along the OTHER axis.

Invariant A is deliberately **not** a column any more. It returned "unchanged"
on both axes for all 41 cards, at both the original console-driven measurement
and the button-driven sweep, and the section above explains why that is close to
guaranteed rather than informative. Printing 82 identical cells would restate
the mistake this table exists to record.

`row` and `col` are unchanged from the original measurement (independently
reproduced twice). `body` and `B` are new, from the button-driven sweep. One
number moved: `sensor-names` is 130 rather than 117, because the card renders
one row per configured sensor name and this profile has more of them than it did
— it is config-dependent, not a regression.

| Card | row | col | body | B |
|---|---|---|---|---|
| position | 103 | 95 | 84 | — |
| tools-heaters | 87 | 134 | 68 | — |
| active-job | 46 | 149 | 23 | — |
| active-job-detailed | 52 | 149 | 27 | — |
| sensors | 69 | 55 | 52 | — |
| temperatures | **17** | 81 | **0** | — |
| console | 28 | 74 | 9 | — |
| camera | **17** | 39 | **0** | — |
| build-objects | 42 | 72 | 25 | — |
| gcode-viewer | **17** | 72 | **0** | — |
| layers | 22 | 57 | 5 | — |
| homing | 87 | 66 | 70 | — |
| atx | 22 | 55 | 5 | — |
| filament | 92 | 128 | 73 | — |
| heaters | 87 | 91 | 68 | — |
| movement | 78 | 101 | 61 | — |
| fans | 26 | 104 | 9 | — |
| pinned-commands | 31 | 83 | 14 | — |
| tuning | 35 | 127 | 18 | — |
| job-files | **17** | 61 | **0** | — |
| job-details | 22 | 57 | 5 | — |
| macros | 24 | 61 | 4 | — |
| macros-editor | 27 | 29 | 10 | — |
| system-files | **17** | 61 | **0** | — |
| system-editor | 27 | 29 | 10 | — |
| object-model | 77 | 66 | 60 | — |
| firmware | 120 | 118 | 97 | **60 moved** |
| heightmap | 31 | 70 | 12 | — |
| probe-point | 22 | 88 | 5 | — |
| mesh | 50 | 101 | 33 | — |
| bed-tram | 31 | 54 | 14 | — |
| axis-roles | 119 | 74 | 99 | **21 moved** |
| heater-colors | 68 | 93 | 51 | — |
| thermal-colors | 48 | 103 | 31 | — |
| tool-dock-sensors | 84 | 69 | 64 | **20 moved** |
| bed-probe | 45 | 74 | 25 | **3 moved** |
| camera-config | 40 | 74 | 20 | **3 moved** |
| sensor-names | 130 | 74 | 110 | **24 moved** |
| saved-versions | 34 | 46 | 14 | **1 moved** |
| config-save | 38 | 83 | 21 | — |
| filament-editor | 39 | 77 | 22 | — |

Five cards report `body: 0` — their entire content is outside their own minimum
and they can be dragged over it. Four are the four the human sweep found the
same day; `camera` is the fifth and was not on that list.

Invariant B has output for the first time, and it is not empty: seven cards move
children when the card is narrowed, led by `firmware` at 60. Those numbers are
counts, not diagnoses — B's ids are positional (`${index}:${className}`), so the
count is trustworthy and the naming is not yet. Reading them as "these seven
reflow" is safe; reading them as "child 17 is the culprit" is not.

## How this was measured, and what that costs

**Updated 2026-07-30: the sweep no longer needs a foreground tab.** The original
numbers were driven from the console because the sweep awaited two
`requestAnimationFrame` callbacks per card, and rAF never fires in a hidden or
automated tab (verified: a fresh observer missed even its mandatory initial
callback). That dependency is gone. Solid renders synchronously on the signal
write and reading geometry flushes layout, so the sweep measures in the same
tick; where a card's `createResource` suspends the lab it waits on microtasks,
falling back to timers, which are throttled in a background tab but do fire.

The whole table above was produced by clicking *Audit every card* with
`document.visibilityState === "hidden"` throughout: 41 rows, no card dropped,
779 ms. `filament` is in it at 92/128 — under the old sweep, featuring that card
suspended the Suspense boundary that wraps the entire Card Lab, and every card
after it was silently skipped.

**Consequences, stated rather than buried:**

- Only the DEFAULT pitch is measured here. The plan asked for all four. The
  blocker is gone — the button works in any tab now — but the other three
  pitches have not been run.
- Invariant B is present but its per-child ids are positional, so a violation
  names a count rather than a culprit. See the note under the table.
- Several cards render EMPTY on the mock — no active job, one fan, no editor
  content, no probe result. Their floors are the floors of an empty card:
  `active-job`, `active-job-detailed`, `layers`, `build-objects`, `job-details`,
  `probe-point`, `system-editor`, `macros-editor`, `saved-versions`, `fans`.
  A human sweep the same day found `active-job` defective in exactly the idle
  state this table records as fine.
- The `body` column measures whether content is IN the floor, not whether the
  floor is RIGHT. A card can count every child and still declare a minimum that
  is far too small for the card to be usable at. That is the declared-vs-measured
  comparison, and it is still unbuilt.

## Open

- `active-job` idle: reported as shrinking over its Reprint button. Not
  reproduced by measurement — width floor 149 cols against an 80px button row,
  height 46 rows against ~112px of content. Axis unknown.
- The mock should carry more than one manual fan and a printing state, or
  ten cards can only ever be audited empty.
