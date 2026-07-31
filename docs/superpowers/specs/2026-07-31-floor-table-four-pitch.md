# Floor table — all four density pitches, 2026-07-31

The measurement stage 1 asked for and never finished. The 2026-07-30 table
([2026-07-30-floor-table.md](2026-07-30-floor-table.md)) covered the default
pitch only and said so; this one covers all four, on a repaired check, and is
the artefact a later conversion should be judged against.

**Conditions.** Microsoft Edge 150 (`Edg/150.0.0.0`), headless, driven over the
DevTools protocol from a throwaway profile — no extension, no npm dependency,
Node's global `WebSocket`. Viewport pinned to **2552 × 1274** CSS px at
`deviceScaleFactor: 1` via `Emulation.setDeviceMetricsOverride`, so the next run
measures the same page instead of inheriting whatever the window chrome left.
`await document.fonts.ready` before the first measurement — Rajdhani arriving
late would change every text metric in the table. Backend: mock-duet on the
bundled toolchanger snapshot, scenario `idle`. Registry: **43 cards** (the
07-30 table's 41 predates `Tools`, `Macros · inventory` and the
`Printing` / `Printing · estimates` split). All figures are canvas cells: rows ×
`--row-unit`, cols × 4px. Taken BEFORE any card is converted to a declaration.

Each sweep audited all 43 cards in **~100 ms** with nothing skipped and nothing
unmeasurable.

## FINDING 1: the body-in-floor check was inverted, and was repaired before these numbers were taken

The 07-30 table introduced *body in floor* as "the only one of the three that
can fail on a layout defect rather than on an inconsistency in the
measurement". As of this morning it failed on the opposite of a defect.

Six cards reported `IGNORES BODY` — `temperatures`, `camera`, `toolpath`,
`jobs`, `jobs · inventory`, `system-files` — with the message "this card can be
dragged over its own contents". All six were cards FIXED the previous day, and
their floors were large, not collapsed. Driving `.temp-chart`'s declared
`min-height` and re-reading the audit settled it:

| `.temp-chart` declares | floor reported | verdict printed |
|---|---|---|
| `min-height: 150px` | 53 rows | *IGNORES BODY — can be dragged over its own contents* |
| `min-height: 400px` | **154 rows** | *same* |
| `min-height: 20px` | 18 rows | *same* |

The floor tracks the declaration exactly, so the body is entirely inside it. The
verdict was wrong at every value.

**Cause.** `chromeRowSpan` emptied the body by setting `display: none` on every
non-header child and re-running `contentRowSpan`. `display: none` does not clear
`flex-grow` or `min-height` from computed style, and for a slack-absorbing child
those two are the ONLY inputs `contentRowSpan` reads (`panelCanvas.ts`, the
grow-child substitution). The hidden child went on contributing its declared
floor, the subtraction came out zero, and the check fired.

Confirmed in the live DOM: with `display: none` applied, `.temp-chart` still
computed `flex-grow: 1` and `min-height: 150px`.

**Why it mattered more than an ordinary false positive.** The check fired
precisely on cards whose floor is correctly DECLARED through a grow child's
`min-height` — which is both the previous day's fix and the exact mechanism the
archetype conversion applies to every card. Left alone, stage 4 would have
opened with "the conversion broke 43 cards", and the one column able to catch a
real defect would have been the one nobody believed.

**Fix.** `contentRowSpan` now takes a named `FloorContent`
(`"as-rendered" | "header-only"`) and selects children inside its own loop, so
there is no second place where "what counts as content" is written down and no
DOM trick to be defeated. The `display: none` dance is deleted.

Verified to discriminate in both directions before these numbers were taken:

| Case | rows | verdict |
|---|---|---|
| `temperatures`, `min-height: 150px` | 53 | body is worth 38 of 53 |
| same, driven to `400px` | 115 | body is worth 100 of 115 — tracks the declaration |
| restored | 53 | 38 of 53, no leakage |
| `homing`, untouched | 89 | body is worth 74 of 89 |
| `homing` **with a `flex-grow` / `min-height: 0` child injected** | 15 | **IGNORES BODY** — still caught |
| injection removed | 89 | back to 74 of 89 |

**Consequence for the tables below: no card reports `IGNORES BODY` at any of the
four pitches.** That is a wall of green, which the 07-30 document rightly warns
is the least trustworthy possible result — the injected-defect row above is the
only reason to believe it, and it is the reason it is recorded here.

## FINDING 2: 17 cards need MORE stored row-units as the pitch tightens, and a card at its floor overflows when the density changes

This is what the other three pitches were for, and it does not show up at one
pitch by construction.

Layouts are stored in row units of a FIXED 4px, while `--row-unit` renders at
4 / 3.5 / 3 / 2.8px. A card whose floor is declared in PIXELS — a 150px chart, a
file browser's viewport floor — does not shrink when the unit does, so its floor
measured in STORED UNITS grows as the pitch tightens.

| Card | units 1.27 / 0.80 / 0.50 / 0.40 | px 1.27 → 0.40 | stored units needed |
|---|---|---|---|
| Firmware update | 123 / 136 / 153 / 162 | 492 → 454 | **+32%** |
| Object model | 82 / 91 / 102 / 107 | 328 → 300 | **+30%** |
| Sensors | 73 / 80 / 89 / 94 | 292 → 263 | **+29%** |
| Temperatures | 53 / 57 / 62 / 65 | 212 → 182 | **+23%** |
| Macros | 57 / 62 / 68 / 70 | 228 → 196 | **+23%** |
| Macros · inventory | 57 / 62 / 68 / 70 | 228 → 196 | **+23%** |
| Jobs | 50 / 54 / 59 / 61 | 200 → 171 | **+22%** |
| Jobs · inventory | 50 / 54 / 59 / 61 | 200 → 171 | **+22%** |
| System files | 50 / 54 / 59 / 61 | 200 → 171 | **+22%** |
| Camera | 40 / 43 / 46 / 47 | 160 → 132 | **+18%** |
| Toolpath | 40 / 43 / 46 / 47 | 160 → 132 | **+18%** |
| Configuration | 37 / 39 / 42 / 42 | 148 → 118 | **+14%** |
| Filament editor | 38 / 40 / 42 / 42 | 152 → 118 | **+11%** |
| Bed probing | 46 / 47 / 50 / 49 | 184 → 137 | **+7%** |
| Position | 108 / 111 / 115 / 115 | 432 → 322 | **+6%** |
| Mesh | 50 / 50 / 51 / 52 | 200 → 146 | **+4%** |
| Camera URL | 41 / 41 / 42 / 42 | 164 → 118 | **+2%** |

Read the first row: the card gets SMALLER in pixels (492 → 454, the density
feature working) while needing 32% MORE stored units to hold it. The other 26
cards, whose content is built from density-scaled rows rather than pixel
declarations, hold roughly constant unit floors — that is the healthy shape.

**Reproduced, not merely implied.** `temperatures` at pitch 0.40, forced to the
span a layout saved at 1.27 would carry (53 units × 2.8px = 148px):

```
body clientHeight  146px
body scrollHeight  174px
overflow            28px
```

A card sized exactly at its floor on the shop monitor is 28px short of its own
content on the phone. Density is a per-device preference
(`shell/density.ts`) and layouts persist in stored units, so the two are
combinable in normal use.

Not fixed here — it is a design question (clamp spans on pitch change, store the
pitch alongside the layout, or express the floors in density-scaled units rather
than pixels) and it belongs with the archetype work, whose whole premise is that
a floor should come from a declaration with a number in it.

## Tables

### Pitch 1.27 — `--row-unit: 4px`

| Card | row | col | body | B |
|---|---|---|---|---|
| System file editor | 21 | 32 | 6 | **1 moved** |
| Firmware update | 123 | 132 | 108 | **62 moved** |
| Axis roles | 116 | 79 | 101 | **21 moved** |
| Tool dock sensors | 78 | 71 | 63 | **21 moved** |
| Bed probing | 46 | 81 | 31 | **6 moved** |
| Camera URL | 41 | 79 | 26 | **1 moved** |
| Sensor names | 123 | 79 | 108 | **24 moved** |
| Position | 108 | 97 | 93 | — |
| Tools & heaters | 89 | 144 | 74 | — |
| Printing | 32 | 60 | 17 | — |
| Printing · estimates | 32 | 101 | 17 | — |
| Sensors | 73 | 61 | 58 | — |
| Temperatures | 53 | 84 | 38 | — |
| Console | 27 | 80 | 12 | — |
| Camera | 40 | 43 | 25 | — |
| Cancel Objects | 21 | 82 | 6 | — |
| Toolpath | 40 | 102 | 25 | — |
| Layer times | 21 | 64 | 6 | — |
| Homing | 89 | 69 | 74 | — |
| ATX power | 21 | 61 | 6 | — |
| Extruders | 94 | 132 | 79 | — |
| Tools | 89 | 94 | 74 | — |
| Movement | 80 | 104 | 65 | — |
| Fans | 25 | 107 | 10 | — |
| Pinned commands | 30 | 94 | 15 | — |
| Tuning | 32 | 128 | 17 | — |
| Jobs | 50 | 50 | 35 | — |
| Job details | 21 | 64 | 6 | — |
| Jobs · inventory | 50 | 74 | 35 | — |
| Macros | 57 | 56 | 42 | — |
| Macros · inventory | 57 | 80 | 42 | — |
| Macro editor | 21 | 32 | 6 | — |
| System files | 50 | 68 | 35 | — |
| Object model | 82 | 75 | 67 | — |
| Height map | 30 | 77 | 15 | — |
| Probe point | 21 | 100 | 6 | — |
| Mesh | 50 | 112 | 35 | — |
| Bed tram | 31 | 61 | 16 | — |
| Chart colours | 69 | 93 | 54 | — |
| Temperature Gradient | 47 | 105 | 32 | — |
| Saved versions | 21 | 97 | 6 | — |
| Configuration | 37 | 95 | 22 | — |
| Filament editor | 38 | 88 | 23 | — |

### Pitch 0.80 — `--row-unit: 3.5px`

| Card | row | col | body | B |
|---|---|---|---|---|
| System file editor | 20 | 30 | 6 | **1 moved** |
| Firmware update | 136 | 130 | 122 | **62 moved** |
| Axis roles | 113 | 77 | 99 | **22 moved** |
| Tool dock sensors | 77 | 69 | 63 | **14 moved** |
| Bed probing | 47 | 79 | 33 | **6 moved** |
| Camera URL | 41 | 77 | 27 | **1 moved** |
| Sensor names | 119 | 77 | 105 | **24 moved** |
| Position | 111 | 95 | 97 | — |
| Tools & heaters | 85 | 142 | 71 | — |
| Printing | 32 | 58 | 18 | — |
| Printing · estimates | 32 | 99 | 18 | — |
| Sensors | 80 | 59 | 66 | — |
| Temperatures | 57 | 81 | 43 | — |
| Console | 26 | 78 | 12 | — |
| Camera | 43 | 41 | 29 | — |
| Cancel Objects | 20 | 80 | 6 | — |
| Toolpath | 43 | 100 | 29 | — |
| Layer times | 20 | 62 | 6 | — |
| Homing | 85 | 66 | 71 | — |
| ATX power | 20 | 59 | 6 | — |
| Extruders | 88 | 130 | 74 | — |
| Tools | 84 | 92 | 70 | — |
| Movement | 76 | 100 | 62 | — |
| Fans | 23 | 104 | 9 | — |
| Pinned commands | 30 | 92 | 16 | — |
| Tuning | 31 | 126 | 17 | — |
| Jobs | 54 | 48 | 40 | — |
| Job details | 20 | 62 | 6 | — |
| Jobs · inventory | 54 | 72 | 40 | — |
| Macros | 62 | 54 | 48 | — |
| Macros · inventory | 62 | 78 | 48 | — |
| Macro editor | 20 | 30 | 6 | — |
| System files | 54 | 66 | 40 | — |
| Object model | 91 | 73 | 77 | — |
| Height map | 30 | 75 | 16 | — |
| Probe point | 20 | 98 | 6 | — |
| Mesh | 50 | 109 | 36 | — |
| Bed tram | 31 | 59 | 17 | — |
| Chart colours | 64 | 91 | 50 | — |
| Temperature Gradient | 44 | 103 | 30 | — |
| Saved versions | 20 | 95 | 6 | — |
| Configuration | 39 | 93 | 25 | — |
| Filament editor | 40 | 86 | 26 | — |

### Pitch 0.50 — `--row-unit: 3px`

| Card | row | col | body | B |
|---|---|---|---|---|
| System file editor | 20 | 28 | 8 | **1 moved** |
| Firmware update | 153 | 128 | 141 | **62 moved** |
| Axis roles | 119 | 75 | 107 | **21 moved** |
| Tool dock sensors | 80 | 67 | 68 | **21 moved** |
| Bed probing | 50 | 77 | 38 | **6 moved** |
| Camera URL | 42 | 75 | 30 | **4 moved** |
| Sensor names | 124 | 75 | 112 | **24 moved** |
| Position | 115 | 93 | 103 | — |
| Tools & heaters | 79 | 140 | 67 | — |
| Printing | 32 | 56 | 20 | — |
| Printing · estimates | 32 | 97 | 20 | — |
| Sensors | 89 | 57 | 77 | — |
| Temperatures | 62 | 78 | 50 | — |
| Console | 26 | 76 | 14 | — |
| Camera | 46 | 39 | 34 | — |
| Cancel Objects | 20 | 78 | 8 | — |
| Toolpath | 46 | 98 | 34 | — |
| Layer times | 20 | 60 | 8 | — |
| Homing | 80 | 64 | 68 | — |
| ATX power | 20 | 57 | 8 | — |
| Extruders | 81 | 128 | 69 | — |
| Tools | 79 | 90 | 67 | — |
| Movement | 72 | 96 | 60 | — |
| Fans | 21 | 101 | 9 | — |
| Pinned commands | 30 | 90 | 18 | — |
| Tuning | 30 | 124 | 18 | — |
| Jobs | 59 | 46 | 47 | — |
| Job details | 20 | 60 | 8 | — |
| Jobs · inventory | 59 | 70 | 47 | — |
| Macros | 68 | 52 | 56 | — |
| Macros · inventory | 68 | 76 | 56 | — |
| Macro editor | 20 | 28 | 8 | — |
| System files | 59 | 64 | 47 | — |
| Object model | 102 | 71 | 90 | — |
| Height map | 30 | 73 | 18 | — |
| Probe point | 20 | 96 | 8 | — |
| Mesh | 51 | 105 | 39 | — |
| Bed tram | 30 | 57 | 18 | — |
| Chart colours | 62 | 89 | 50 | — |
| Temperature Gradient | 42 | 101 | 30 | — |
| Saved versions | 20 | 93 | 8 | — |
| Configuration | 42 | 91 | 30 | — |
| Filament editor | 42 | 84 | 30 | — |

### Pitch 0.40 — `--row-unit: 2.8px`

| Card | row | col | body | B |
|---|---|---|---|---|
| System file editor | 19 | 27 | 8 | **1 moved** |
| Firmware update | 162 | 127 | 151 | **62 moved** |
| Axis roles | 115 | 74 | 104 | **22 moved** |
| Tool dock sensors | 78 | 66 | 67 | **21 moved** |
| Bed probing | 49 | 76 | 38 | **6 moved** |
| Camera URL | 42 | 74 | 31 | **4 moved** |
| Sensor names | 120 | 74 | 109 | **24 moved** |
| Position | 115 | 92 | 104 | — |
| Tools & heaters | 73 | 139 | 62 | — |
| Printing | 32 | 55 | 21 | — |
| Printing · estimates | 32 | 96 | 21 | — |
| Sensors | 94 | 56 | 83 | — |
| Temperatures | 65 | 77 | 54 | — |
| Console | 25 | 75 | 14 | — |
| Camera | 47 | 38 | 36 | — |
| Cancel Objects | 19 | 77 | 8 | — |
| Toolpath | 47 | 97 | 36 | — |
| Layer times | 19 | 59 | 8 | — |
| Homing | 84 | 63 | 73 | — |
| ATX power | 19 | 56 | 8 | — |
| Extruders | 75 | 127 | 64 | — |
| Tools | 73 | 89 | 62 | — |
| Movement | 75 | 95 | 64 | — |
| Fans | 20 | 100 | 9 | — |
| Pinned commands | 30 | 89 | 19 | — |
| Tuning | 30 | 123 | 19 | — |
| Jobs | 61 | 45 | 50 | — |
| Job details | 19 | 59 | 8 | — |
| Jobs · inventory | 61 | 69 | 50 | — |
| Macros | 70 | 51 | 59 | — |
| Macros · inventory | 70 | 75 | 59 | — |
| Macro editor | 19 | 27 | 8 | — |
| System files | 61 | 63 | 50 | — |
| Object model | 107 | 70 | 96 | — |
| Height map | 30 | 72 | 19 | — |
| Probe point | 19 | 95 | 8 | — |
| Mesh | 52 | 104 | 41 | — |
| Bed tram | 30 | 56 | 19 | — |
| Chart colours | 61 | 88 | 50 | — |
| Temperature Gradient | 41 | 100 | 30 | — |
| Saved versions | 19 | 92 | 8 | — |
| Configuration | 42 | 90 | 31 | — |
| Filament editor | 42 | 83 | 31 | — |

## Invariant B: seven cards move children when narrowed

Identical at all four pitches, which is itself worth recording — B's verdict is
a property of the card's markup, not of the spacing.

| Card | children that moved |
|---|---|
| Firmware update | 62 |
| Sensor names | 24 |
| Axis roles | 21 |
| Tool dock sensors | 21 |
| Bed probing | 6 |
| System file editor | 1 |
| Camera URL | 1 |

These are counts, not diagnoses. B's child ids are positional
(`${index}:${className}`), so "these seven reflow" is safe to read and "child 17
is the culprit" is not. Naming them is the prerequisite for fixing them, and it
is not done.

Invariant B is also false by construction for a fill slot containing wrapping
text, so a card legitimately CAN appear here. None of the seven has been
triaged into "expected" versus "defect" — that triage is an open item below, not
a conclusion this table is entitled to draw.

## Invariant A is deliberately not a column

It returned "unchanged" on both axes for all 43 cards at all four pitches — 344
identical cells. The 07-30 document explains at length why that is close to
guaranteed rather than informative: `A · col` is a tautology (`min-content` is
defined at a zero-sized containing block, so the card's width is already not an
input), and `A · row` largely re-derives a property that was engineered in on
purpose. Printing 344 cells would restate the mistake these tables exist to
record.

## Open

- **Cross-density floors (FINDING 2).** Undecided, and the most consequential
  thing here: 17 of 43 cards need more stored units at a tighter pitch, and the
  overflow is reproduced. Needs a design decision, not a patch.
- **The lab's state pills do not change the bench.** Both `Idle` and `Printing`
  were swept at all four pitches and every one of the 172 rows came back
  byte-identical. A direct check found the job card reading
  "No job · Last: benchy_toolchange_v3.gcode · REPRINT" under BOTH states after
  toggling, so the `Printing` sweep must be read as a second idle sweep and is
  not reproduced here as a printing measurement. The 07-30 caveat therefore
  still stands in full: `active-job`, `active-job-detailed`, `layers`,
  `build-objects`, `job-details`, `probe-point`, `system-editor`,
  `macros-editor`, `saved-versions` and `fans` are measured EMPTY, and a human
  sweep once found `active-job` defective in exactly the idle state this table
  records as fine.
- **Invariant B's ids are positional**, so its seven cards have counts and no
  culprits, and none is triaged expected-vs-defect.
- **One viewport only** (2552 × 1274). Mobile widths bring `@media` rules into
  play that this table cannot see — the class of mistake that once cost four
  wrong diagnoses.
- **`active-job` idle**, carried over unresolved from 07-30: reported as
  shrinking over its Reprint button, not reproduced by measurement.
- **The declared-vs-measured oracle still does not exist.** Every column here
  says what the card currently reports, never that the number is RIGHT. A card
  can count every child and still declare a minimum far too small to be usable
  at. That comparison is stage 4, and neither this table nor the UI should be
  read as though it exists.
