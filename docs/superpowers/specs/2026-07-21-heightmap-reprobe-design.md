# Height map preview with single-point re-probing

**Date:** 2026-07-21
**Status:** implemented 2026-07-21

## Problem

dwc-ng has no height map at all — it is the largest remaining visualisation gap
(parity §8). DWC's own `HeightMap` plugin is **read-only**: terrain/heat colour
schemes, statistics, invert-Z. It cannot re-probe.

A mesh is usually good except for a handful of points — a bit of crud on the
bed, a probe that did not trigger cleanly, a point over a bed clip. Re-running
`G29` to fix three cells costs a full mesh probe. The goal is to fix those cells
individually.

## Non-goals

- Running a full mesh probe (`G29 S0`). That already works from the console and
  needs no UI.
- Editing the grid geometry (spacing, bounds, radius). Those come from
  `M557`/`M558` and belong in config.g.
- 3D rendering. A 2D grid of points is what you need to pick a cell; the
  toolpath viewer already carries the 3D budget.

## Why a client-side file round-trip

RRF has no command to patch a single point of the in-memory mesh. `G29` probes
the whole grid; `G29 S1` loads a file; `G29 S3` saves the current map. There is
no "set point (i,j) to z".

So: download `heightmap.csv`, parse it, patch one cell, serialise, upload,
`G29 S1`. This is the only available path, not a preference.

**Consequence that must be structural:** uploading the file changes nothing on
its own — RRF keeps using the map it already loaded. `save()` therefore performs
upload **and** `G29 S1` as a single operation, so the file on the card and the
map the machine is compensating with cannot diverge.

## File format

From the real machine capture (`packages/mock-duet/captures/duet3-real-2026-07-15/heightmap.csv`):

```
RepRapFirmware height map file v2 generated at 2026-05-23 18:55, min error -0.105, max error 0.150, mean 0.016, deviation 0.047
axis0,axis1,min0,max0,min1,max1,radius,spacing0,spacing1,num0,num1
X,Y,5.00,335.00,5.00,295.00,-1.00,22.00,19.33,16,16
  0.067,  0.017, -0.000, ...   (num1 rows of num0 values)
```

- Line 1: format banner **plus four derived statistics**.
- Line 2: column names for line 3.
- Line 3: grid geometry. `radius -1` means rectangular, not delta.
- Lines 4+: `num1` rows, each `num0` comma-separated values, two leading spaces
  and three decimals per field. A point that was not probed is `0` in RRF's
  output — see Open questions.

### Derived, not carried

`min error`, `max error`, `mean`, `deviation` on line 1 are **recomputed from
the grid on every serialise**. They are never parsed forward into the output.
Editing a cell and writing back a stale header would produce a file whose
summary disagrees with its contents; making them derived removes the
possibility rather than relying on remembering to update them.

Geometry (line 2, line 3) passes through unmodified — we are editing values, not
re-defining the mesh.

## Components

### `heightmap/parse.ts` — pure

```
parseHeightMap(csv: string): HeightMap | null
serializeHeightMap(map: HeightMap): string
```

`HeightMap = { axes, bounds, spacing, radius, rows: number[][] }`.
Tolerant parse: anything malformed returns null rather than throwing, matching
`parseStoredCanvas`'s contract elsewhere in this codebase.

Tests include a **round-trip of the real capture**: parse → serialise must be
byte-identical when no cell changed. That single test pins the format, the
number formatting, and the derived-statistics arithmetic all at once.

### `heightmap/store.ts` — loaded map + pending edits

Mirrors the config store's model: an immutable loaded map plus an overlay of
pending edits, so discarding is dropping the overlay and cannot fail.

```
load(connector)                  download + parse
edit(row, col, value)            into the pending overlay
pending(): Map<cellKey, {old,new}>
dirty(): boolean
discard()
save(connector)                  serialise + rr_upload + G29 S1
```

`save` is one operation for the reason above.

### `heightmap/HeightMapView.tsx`

- Grid of dots, one per probe point, coloured by deviation (diverging scale
  centred on zero — this is signed error, so a sequential ramp would misread).
  Palette follows the same ΔE separation rule as the heater series.
- Click a dot → detail panel: cell index, X/Y in mm, current value.
- **Re-probe** → sends the configured probe command → shows **old vs new, and
  the raw reply text** → Accept / Discard.
- Accepted cells render as modified. Save writes once, however many were fixed.

### Probe command — configured, not hardcoded

A template in the config overlay, editable in Settings:

```
probe.pointCommand = 'M98 P"/macros/probe_point.g" X{x} Y{y}'
```

`{x}`/`{y}` substituted with the cell's bed coordinates. The UI sends exactly
one command, which it displays (the GcodeButton signature holds). The motion —
clearance, probe deploy, tool state — lives in the operator's own macro, not in
this UI. If the default is wrong for a machine, it is fixed in Settings rather
than in a release.

## The conversion — RESOLVED 2026-07-21

**The trigger height IS the map value.** No conversion (confirmed by Gabe).
RRF has already applied the probe's `G31 Z` offset by the time it reports,
which is why a real map reads in hundredths of a millimetre rather than around
the probe's standoff. The section below is kept for the reasoning that led to
isolating it; the raw reply is still shown at the accept step, now to catch a
bad *probe* rather than a bad formula.

## The conversion, as it was reasoned about before that

`sendCode` resolves with the reply text, so the probed height is read from
RRF's response. **Converting that reply into a height-map value is not yet
verified** and is not being guessed at: the map stores deviation from the
reference plane, not raw machine Z, and the relationship involves the probe's
`G31` trigger height. The vendored reference (`@duet3d/objectmodel`,
`@duet3d/connectors`, DWC, the M409 doc) does not cover G-code semantics, so
this must be confirmed against the official RRF documentation and, ultimately,
against the machine.

Containment:

- One function, `mapValueFromProbe(reply, context)`, with its own tests.
- The Accept step shows the **raw reply alongside the computed value**, so a
  wrong formula is visible on the first probe rather than after a map has been
  corrupted.
- Nothing is written until Save.

The first real probe is therefore a deliberate calibration of the formula.

## Placement

Its own nav entry, **Bed**. A 16×16 grid plus a detail panel needs room, and
Control is already dense. It is also a distinct task: you go there to fix the
bed, not to run a print.

## Safety

This is data-loss and machine-motion territory, so:

- Nothing writes to the card until Save.
- Save is upload + `G29 S1` together, never one without the other.
- Re-probe is two-step (select the dot, then confirm) like every other machine
  action in this UI.
- The dev write guard already blocks upload and `sendCode` against the real
  board unless writes are armed.
- No GUI-encoded machine safeties: the UI does not decide whether probing is
  wise, does not gate on homed state, and does not invent motion. It sends one
  operator-configured command and reports what came back.

## Testing

| Unit | Covered by |
|---|---|
| `parse.ts` | round-trip of the real capture; malformed input → null; derived statistics recomputed after an edit; number formatting preserved |
| `store.ts` | edit → dirty; discard restores; save uploads **and** reloads; a failed upload does not mark clean |
| `mapValueFromProbe` | reply parsing, including a reply that reports no trigger |
| View | manual, against mock-duet seeded with the real capture |

## Open questions

- **Unprobed points.** RRF writes `0` for a point outside the probed radius. On
  a rectangular bed (`radius -1`) every point is probed, so this does not arise
  on Gabe's machine — but the parser should preserve such values verbatim rather
  than treating them as real zeroes. Confirm before supporting delta beds.
- **Number formatting.** The capture uses `%7.3f`-ish spacing. The round-trip
  test will settle the exact rule; if RRF is not byte-stable here, the test
  relaxes to numeric equality and the requirement is documented as such.
