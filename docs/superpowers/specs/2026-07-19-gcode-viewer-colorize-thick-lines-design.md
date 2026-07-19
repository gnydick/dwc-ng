# GCode Viewer: Color Modes, Real Alpha, Real Width — Design Spec

Date: 2026-07-19
Status: approved by Gabe (brainstorming session)

## Purpose

The Activity view's live 3D toolpath viewer (shipped 2026-07-18) currently
renders single-pixel copper-colored lines, with "not yet printed"/"not
current layer" segments shown as a darker shade rather than genuinely
transparent. This upgrades it to real per-segment color, real (non-1px,
world-space) line width, and real alpha transparency — three
previously-separate asks that turn out to compose into one coherent
rendering upgrade.

## Scope

This is substantially larger than the original gcode viewer feature's
rendering layer. It touches: the object model (a new field), the parser
(three new tracked quantities), a forked Three.js material, and the
viewer's UI (a second mode toggle). Confirmed with Gabe as one cohesive
upgrade rather than trimmed down.

Out of scope: joins/caps polish beyond what the forked material already
provides, a UI control for filament diameter (read from the OM, not
user-editable in this pass), any change to the download-once/recolor-only
data flow established in the original feature (untouched — this only
changes what's computed *from* the already-downloaded, already-parsed
toolpath and what's fed to the renderer).

## Color modes (a new, independent axis from the existing reveal modes)

Three color modes select each segment's base RGB hue:

- **Speed**: last-seen `F` value per segment, normalized against the
  min/max feedrate actually present in *that file* (not a fixed absolute
  scale — printing speeds vary by printer/filament). Blue = slow, red =
  fast.
- **Feature type**: parses PrusaSlicer/SuperSlicer's `;TYPE:<label>`
  comments. Verified directly against both slicers' current source
  (PrusaSlicer `GCode.cpp`/`ExtrusionRole.cpp`, SuperSlicer
  `GCode.cpp`/`ExtrusionEntity.cpp`):
  - Exact format: `;TYPE:` immediately followed by the label, no space
    (e.g. `;TYPE:Perimeter`) — one comment governs every extrusion move
    until the next one appears (confirmed: the exporter only re-emits the
    tag on a role *change*).
  - PrusaSlicer labels: `Perimeter`, `External perimeter`, `Overhang
    perimeter`, `Internal infill`, `Solid infill`, `Top solid infill`,
    `Bridge infill`, `Gap fill`, `Skirt/Brim` (also accepts bare `Skirt`
    for older-version compatibility), `Support material`, `Support
    material interface`, `Ironing`, `Wipe tower`, `Custom`.
  - SuperSlicer diverges on two labels only: `Internal perimeter` (where
    PrusaSlicer says `Perimeter`) and `Skirt` (where PrusaSlicer says
    `Skirt/Brim`) — both are folded into the same visual bucket as their
    PrusaSlicer equivalent.
  - Travel moves have no companion tag in either slicer — inferred the
    same way this parser already does (no E increase), matching
    PrusaSlicer's own reference-parser logic (`GCodeProcessor.cpp`'s
    `move_type` lambda).
  - Unrecognized/absent tags fall into an "Unknown" bucket — never an
    error.
- **Layer time**: parses `M73 P<percent> R<minutes-remaining>` comments.
  Verified this is gated behind a printer-setting checkbox
  ("Supports remaining times", `remaining_times` config key) that
  defaults **off** in both slicers — so this mode frequently has no data,
  matching Gabe's own "if it's there." When present, per-layer duration is
  derived from the R-value change between consecutive `;LAYER_CHANGE`
  markers (verified: `;LAYER_CHANGE` is emitted at every layer boundary in
  both slicers). This is an explicit **heuristic, not an exact value** —
  verified directly from source that M73 emission is triggered by a
  per-minute time threshold on an arbitrary move line, with no formal
  correlation to layer boundaries; a given M73 can legitimately land just
  before or after the `;LAYER_CHANGE` it's attributed to. Algorithm: track
  the most recent M73 `R` value; each time `;LAYER_CHANGE` is seen, record
  that R value as "R at the start of the layer about to begin." Layer i's
  duration = `RAtLayerStart[i] − RAtLayerStart[i+1]`; the last layer (no
  subsequent `;LAYER_CHANGE`) uses the final R value seen in the whole
  file as its end marker. If no `M73`/`;LAYER_CHANGE` data exists at all,
  every layer's duration is `NaN` and the mode is reported unavailable.

The color-mode toggle (three buttons, mirroring the existing reveal-mode
segmented control) disables a mode when its underlying data isn't present
in the parsed file — e.g. "Layer time" grays out when
`layerTimeMinutes` is all-`NaN`. Speed and feature-type are always
available (worst case, uniform/"Unknown"). Default color mode on load:
**feature-type** (most immediately recognizable at a glance, matching
typical slicer-preview defaults); default reveal mode stays
**progressive**, unchanged from the original feature.

This fully replaces the original feature's single `BRIGHT`/`DIM` copper
constants — `renderModes.ts`'s old `computeSegmentColors` (RGB dim-vs-bright)
is superseded by the pair `hueColors.ts` (RGB, per color mode) +
`renderModes.ts`'s new alpha-only computation (per reveal mode). Its
existing tests are rewritten to assert alpha values instead of RGB, not
patched in place.

## Real alpha (reveal modes now modulate alpha, not brightness)

The existing reveal modes (progressive/static/layer-focus) keep their
semantics but now produce **alpha** per segment instead of a darker RGB
shade: "not yet printed"/"not the focused layer" segments become
genuinely translucent while keeping their real (color-mode-derived) hue;
"printed"/"focused" segments stay opaque. Color mode and reveal mode are
independent axes — e.g. speed-colored, with unprinted segments faded out.

This requires real per-vertex alpha, which stock Three.js's `LineMaterial`
does not support (verified: open, unresolved GitHub issue #23680 since
2022, "Add vertex color alpha channel support to LineMaterial" — the
class assumes vec3 colors only). No tool researched in this space (Cura,
PrusaSlicer, the `gcode-preview` npm package, deck.gl) has shipped real
per-segment alpha at scale — transparency in all of them is reserved for
auxiliary elements (a position marker, an object "shell"), never the bulk
toolpath. This spec accepts that gap and closes it via a vendored, forked
copy of `LineMaterial`/`LineSegmentsGeometry` rather than working around
it — consistent with this project's existing "vendor and extend" pattern
for `reference/dwc`.

## Real (world-space) line width

Research (Three.js forums, `aligator/gcode-viewer`, `OctoPrint-PrettyGCode`,
deck.gl's `PathLayer`) converged on Three's own `Line2`/
`LineSegmentsGeometry`/`LineMaterial` ("fat lines," shader-based, ships in
`three/examples/jsm/lines/`, zero extra dependency) as the right base
technique: cheapest per-segment cost of the three candidates evaluated
(6 floats/segment vs. 12+ triangles/segment for tube geometry, which one
concrete benchmark showed dropping to 25-30fps at just 11k segments — well
below this viewer's expected 5k-100k+ range), and it's the exact stack
`OctoPrint-PrettyGCode` (a real, shipping tool) already uses for the same
problem, including live progress sync.

`LineMaterial`'s `worldUnits` flag makes width a real 3D-space quantity —
segments scale with the model like physical geometry, not fixed
screen-space pixels, satisfying "real width" directly.

Getting *per-segment* (not just per-material) width requires extending
the fork beyond alpha: stock `LineMaterial.linewidth` is one scalar for
the whole material. The fork adds a per-segment width-scale instanced
attribute that multiplies the shader's perpendicular-offset calculation,
alongside the existing per-segment start/end position attributes.

Each extruding segment's width is computed from actual extrusion volume,
the same rectangular-bead approximation slicers themselves use:

```
width = (π × (filamentDiameter / 2)² × ΔE) / (layerHeight × segmentLength)
```

- `filamentDiameter`: from the object model's `move.extruders[].filamentDiameter`
  (RRF default 1.75mm) — not yet in this app's lean OM types, added here.
- `layerHeight`: the Z delta between this layer and the previous one
  (derivable from data the parser already tracks when it detects layer
  boundaries); the first layer falls back to its own Z as an
  approximation.
- `ΔE`, `segmentLength`: already computable from data the parser tracks
  (E delta; segment length from its own start/end positions).
- Travel moves (no extrusion) get a fixed thin hairline width rather than
  running through the formula, which would divide by zero.

## Architecture / file structure

New:
- `src/gcode/lineMaterial/` — vendored + forked `LineMaterial`,
  `LineSegmentsGeometry`, `LineSegments2`, `Line2` (forked from the
  currently-installed `three@0.185.1`'s `examples/jsm/lines/`), extended
  for: (a) vec4 (RGBA) vertex colors instead of vec3, (b) a per-segment
  width-scale instanced attribute. Provenance documented (exact version
  forked from, exact diff) per the project's existing `reference/`
  vendoring convention.
- `src/gcode/featureTypes.ts` — `FEATURE_TYPE_NAMES`, `FEATURE_TYPE_COLORS`,
  `mapLabelToFeatureType(label: string): number` (handles both slicers'
  spellings, `0` = Unknown fallback).
- `src/gcode/segmentWidth.ts` — `computeSegmentWidths(positions, deltaE,
  extruding, layerIndex, layerHeights, filamentDiameter): Float32Array`,
  pure, testable.
- `src/gcode/hueColors.ts` — `computeHueColors(toolpath, mode): Float32Array`
  (per-segment RGB) and `colorModeAvailable(toolpath, mode): boolean`.

Modified:
- `src/om/types.ts` — add `Extruder { filamentDiameter: number }` and
  `Move.extruders: Extruder[]`; update `emptyModel()`.
- `src/gcode/parseGcode.ts` — track `F` (speed), `;TYPE:` comments
  (feature type), `;LAYER_CHANGE` + `M73 P/R` (layer time); extend
  `ParsedToolpath` with `deltaE`, `speed`, `featureType`, `layerHeights`
  (per layer), `layerTimeMinutes` (per layer).
- `src/gcode/renderModes.ts` — reveal modes compute per-segment **alpha**
  instead of a darker RGB shade.
- `src/gcode/scene.ts` — switch to the forked material; `worldUnits: true`;
  wire the `resolution` uniform (required by `LineMaterial`'s shader,
  updated on resize); `setGeometry` takes per-segment widths; colors are
  now RGBA.
- `src/gcode/GcodeViewer.tsx` — combine `hueColors` (RGB) + reveal-mode
  alpha into RGBA before feeding the scene; add the color-mode segmented
  control (mirrors the existing reveal-mode one), disabling modes whose
  data isn't present.

## Error handling / fallbacks

- No `;TYPE:` tags anywhere → feature-type mode renders everything as
  "Unknown" (a defined neutral color), not an error.
- No `M73`/`;LAYER_CHANGE` data → layer-time mode disabled in the UI,
  `layerTimeMinutes` all `NaN`.
- `filamentDiameter` unavailable from the OM (shouldn't happen — RRF
  defaults it to 1.75) → fall back to 1.75mm.
- Zero-length segment (degenerate, e.g. a pure retraction with no XY/Z
  move) → width falls back to the travel hairline value rather than
  dividing by zero.

## Testing

- `featureTypes.ts`: unit tests — every verified PrusaSlicer and
  SuperSlicer label maps to its expected bucket, unrecognized/empty
  strings map to Unknown.
- `segmentWidth.ts`: unit tests — known ΔE/layerHeight/filamentDiameter
  inputs produce the expected width; travel segments get the hairline
  width; zero-length segment doesn't divide by zero.
- `parseGcode.ts` extensions: unit tests — `F` tracking persists across
  lines like existing G90/G91 state; `;TYPE:` tracking persists until the
  next tag; `M73 P/R` parsing; `;LAYER_CHANGE`-to-R correlation on a
  synthetic multi-layer file with known M73 placement.
- `hueColors.ts`: unit tests — speed-mode normalization against known
  min/max; feature-type mode maps `featureType` indices to
  `FEATURE_TYPE_COLORS`; layer-time mode maps `layerTimeMinutes` to a
  gradient; `colorModeAvailable` correctly reports false only when
  `layerTimeMinutes` is all-`NaN`.
- `renderModes.ts` (alpha version): unit tests mirroring the existing
  three-mode coverage, asserting alpha values instead of RGB.
- The forked `lineMaterial/` and `scene.ts`/`GcodeViewer.tsx` changes are
  WebGL/shader code, not unit-testable in this project's `node:test`
  setup — verified live in-browser, consistent with the original gcode
  viewer feature's own testing section.
