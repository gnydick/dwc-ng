# Floor table — baseline, 2026-07-30

Measured in Chrome at the default density pitch (`--row-unit: 4px`), against
branch `layout-archetypes` at `563e1b9`, before any card is converted to a
declaration. Units are canvas cells: rows × 4px, cols × 4px.

**This branch predates four card fixes that landed on `main` the same day**
(`9763574`, `b800bf1`, `93b7652`). Those four appear here in their broken
state, which is what makes this table worth keeping — see the finding below.

## THE FINDING: Invariant A passed on all 41 cards, and four of them were broken

Every card reports `A: ok` on both axes. On the same afternoon, a human sweep
of the same 41 cards found **six real defects**, four of which are visible in
this very table as implausibly small floors:

| Card | row floor | what was actually wrong |
|---|---|---|
| `temperatures` | 17 (68px) | dragged over its entire 253px chart |
| `gcode-viewer` | 17 (68px) | dragged over its own overlay buttons |
| `job-files` | 17 (68px) | dragged over its breadcrumbs and toolbar |
| `system-files` | 17 (68px) | same — shares `.fb` |

68px is header + chrome and nothing else. Every one of them is a card whose
slack-absorbing child declared `min-height: 0`.

**Invariant A did not catch them, and could not have.** A asks whether a card's
reported minimum CHANGES when the card's own size changes. A floor that is
constantly, honestly reported and constantly WRONG is perfectly stable, so it
passes. A catches self-reference; it does not catch dishonesty.

The half that would have caught all four is the part of the oracle not yet
built: comparing the DECLARED floor against the MEASURED min-content of the
card's contents. That comparison is what the spec calls the oracle proper, and
this table is the evidence that it — not Invariant A — is the load-bearing
piece. Build it before trusting a green audit.

Corollary for the archetype work: an arithmetic floor derived from a
declaration cannot be silently zero, because the declaration has to name a
number. The four defects are exactly the class the declaration removes.

## Table

`row` / `col` are the computed stops. `A` is Invariant A on each axis
(reported minimum independent of the card's own size along that axis).

| Card | row | col | A row | A col |
|---|---|---|---|---|
| position | 103 | 95 | ok | ok |
| tools-heaters | 87 | 134 | ok | ok |
| active-job | 46 | 149 | ok | ok |
| active-job-detailed | 52 | 149 | ok | ok |
| sensors | 69 | 55 | ok | ok |
| temperatures | **17** | 81 | ok | ok |
| console | 28 | 74 | ok | ok |
| camera | 17 | 39 | ok | ok |
| build-objects | 42 | 72 | ok | ok |
| gcode-viewer | **17** | 72 | ok | ok |
| layers | 22 | 57 | ok | ok |
| homing | 87 | 66 | ok | ok |
| atx | 22 | 55 | ok | ok |
| filament | 92 | 128 | ok | ok |
| heaters | 87 | 91 | ok | ok |
| movement | 78 | 101 | ok | ok |
| fans | 26 | 104 | ok | ok |
| pinned-commands | 31 | 83 | ok | ok |
| tuning | 35 | 127 | ok | ok |
| job-files | **17** | 61 | ok | ok |
| job-details | 22 | 57 | ok | ok |
| macros | 24 | 61 | ok | ok |
| macros-editor | 27 | 29 | ok | ok |
| system-files | **17** | 61 | ok | ok |
| system-editor | 27 | 29 | ok | ok |
| object-model | 77 | 66 | ok | ok |
| firmware | 120 | 118 | ok | ok |
| heightmap | 31 | 70 | ok | ok |
| probe-point | 22 | 88 | ok | ok |
| mesh | 50 | 101 | ok | ok |
| bed-tram | 31 | 54 | ok | ok |
| axis-roles | 119 | 74 | ok | ok |
| heater-colors | 68 | 93 | ok | ok |
| thermal-colors | 48 | 103 | ok | ok |
| tool-dock-sensors | 84 | 69 | ok | ok |
| bed-probe | 45 | 74 | ok | ok |
| camera-config | 40 | 74 | ok | ok |
| sensor-names | 117 | 74 | ok | ok |
| saved-versions | 34 | 46 | ok | ok |
| config-save | 38 | 83 | ok | ok |
| filament-editor | 39 | 77 | ok | ok |

## How this was measured, and what that costs

Driven directly from the console, not through the Card Lab's sweep button.
`requestAnimationFrame` never fires in this session's automated browser tab
(verified: a fresh observer missed even its mandatory initial callback; a shim
to `setTimeout` still stalled under background-tab timer throttling), and the
sweep awaits two frames per card. The measurement itself is identical — the
same `contentRowSpan` / `contentColSpan` arithmetic, with layout flushed
synchronously by reading geometry.

**Consequences, stated rather than buried:**

- Only the DEFAULT pitch was measured. The plan asked for all four; the other
  three need a foreground tab and the sweep button.
- Invariant B (cross-axis positional drift) is NOT in this table. It needs the
  per-child sampling the sweep performs.
- Several cards render EMPTY on the mock — no active job, one fan, no editor
  content, no probe result. Their floors are the floors of an empty card:
  `active-job`, `active-job-detailed`, `layers`, `build-objects`, `job-details`,
  `probe-point`, `system-editor`, `macros-editor`, `saved-versions`, `fans`.
  A human sweep the same day found `active-job` defective in exactly the idle
  state this table records as fine.

## Open

- `active-job` idle: reported as shrinking over its Reprint button. Not
  reproduced by measurement — width floor 149 cols against an 80px button row,
  height 46 rows against ~112px of content. Axis unknown.
- The mock should carry more than one manual fan and a printing state, or
  ten cards can only ever be audited empty.
