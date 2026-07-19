# Activity View + Live GCode Viewer — Design Spec

Date: 2026-07-18
Status: approved by Gabe (brainstorming session)

## Purpose

There's no single place to watch a print happen. Position, job progress, and
the shape of what's actually being printed are all in different views
(Machine, Jobs) with no visual toolpath at all. This adds a new **Activity**
view — a 7th nav item — that brings the two most relevant live cards
(Position, Job progress) together with a new 3D GCode Viewer card showing
the print's toolpath, synced live to the machine's actual position.

This is also the trigger for CLAUDE.md's reserved Three.js dependency
("lazy-loaded only if/when gcode/heightmap 3D happens") — no new dependency
approval is needed, it's already pre-authorized for exactly this feature.

## Scope

- One new view: `Activity`, added to the nav (`Machine · Control · Jobs ·
  Macros · System · Settings · Activity`) and the hash router.
- Two cards moved to shared, reusable components and placed on both their
  original view and Activity: Position (currently Machine-only) and
  Active-job progress (currently Jobs-only).
- One new card: the GCode Viewer, only on Activity.
- Out of scope: heightmap 3D (mentioned in CLAUDE.md as a separate future
  Three.js consumer, not part of this work), a standalone full-page viewer,
  DSF-specific behavior (this targets the standalone PollConnector only, per
  the project's current stage — see CLAUDE.md's connector-abstraction note;
  nothing here should make a future DSF connector harder to add, since the
  viewer only depends on `connector.download()` and OM fields both
  connectors already expose).

## Architecture

### Nav + routing

`src/shell/router.ts`'s `Route` union gains `"activity"`; `Shell.tsx`'s `NAV`
array and view `<Switch>` gain the corresponding entry, following the exact
pattern of the other five views — no new mechanism.

### Reused cards: extraction

`Position` currently lives inline in `src/views/Machine.tsx`; `Active-job`
lives inline in `src/views/Jobs.tsx`. Both get extracted to standalone
components:

- `src/cards/PositionCard.tsx`
- `src/cards/ActiveJobCard.tsx`

Each wraps its existing markup in the existing `<Card>` component
(`src/shell/Card.tsx`) exactly as it's already used today — this is a pure
extraction, not a redesign. `Machine.tsx` and `Jobs.tsx` import and render
their card unchanged from the user's perspective. `Activity.tsx` imports
both.

Panel-canvas ids (`"position"`, `"job"`) are per-view-localStorage-keyed
already (each view's `panelCanvas` instance is constructed with its own
storage key — see `panelCanvas.ts`), so the same id appearing in both
Machine's and Activity's grids does not collide; each view's layout,
orientation, and reset-to-default state stays independent.

### GCode Viewer card — data flow

New module: `src/gcode/` (parser + worker are UI-framework-agnostic, kept
separate from the rendering component per the project's existing pattern of
small independently-testable units).

- `src/gcode/parseGcode.ts` — pure function, `parseGcode(text: string):
  ParsedToolpath`. No Worker/DOM dependency itself, so it's directly
  unit-testable; the worker below is a thin wrapper around it.
- `src/gcode/parseGcode.worker.ts` — Worker entry point: receives raw gcode
  text, calls `parseGcode`, posts back the result using transferable
  `ArrayBuffer`s (not structured-cloned copies).
- `src/gcode/ParsedToolpath` shape:
  ```ts
  interface ParsedToolpath {
      positions: Float32Array;   // [x0,y0,z0, x1,y1,z1, ...] line-segment endpoints
      layerIndex: Uint16Array;   // one entry per segment, which layer it belongs to
      byteOffset: Float64Array;  // one entry per segment, source file byte offset
      layerCount: number;
  }
  ```
- Parser scope: `G0`/`G1` linear moves only. `G2`/`G3` arcs are approximated
  as a single chord to their endpoint (no tessellation) — sufficient for a
  visual preview, keeps the parser simple. A new layer is detected on a Z
  change in an extruding move (same heuristic `getFileInfo`/slicers commonly
  use). Non-extruding travel moves are included in `positions` but flagged
  via a parallel `Uint8Array extruding` mask, so render modes can dim travel
  moves if desired later — day one, travel and print moves render the same.

Trigger/lifecycle (`src/views/Activity.tsx`):

- A Solid effect watches the active job's filename from the OM store (the
  same field `Jobs.tsx`'s `job()`/`file()` memos already read).
- When it's non-null and differs from the last-parsed path: call the
  existing `app.connector.download(path)` (already used elsewhere — no new
  connector method), send the text to the worker, store the resulting
  `ParsedToolpath` in a signal.
- The file is downloaded and parsed exactly once per job. Live updates
  afterward never re-download or re-parse — they only read
  `job.filePosition` (already polled for the existing progress bar) and map
  it to a segment index via a binary search over `byteOffset` (monotonic, so
  this is O(log n) per poll tick, not a rescan).
- Nothing downloads or parses until the Activity view is actually mounted
  (lazy `createResource`/effect scoped to the component), matching the
  lazy-load intent for Three.js itself (dynamic `import()`).

### Rendering

`src/gcode/GcodeViewer.tsx` (the only file that imports Three.js — dynamic
`import()` so the chunk only loads when Activity is visited):

- Scene: perspective camera, `OrbitControls` (Three's own `examples/jsm`
  addon — no extra package), a single `THREE.LineSegments` built from
  `positions`. No lighting rig needed (unshaded vertex-colored lines, not lit
  solids).
- A small 3-way segmented control in the card header (visually consistent
  with the existing orientation-toggle pattern in `Panel.tsx`) selects the
  render mode, persisted the same way orientation is (localStorage, per
  panel id):
  - **Progressive** (default): segments before the live index render at full
    color; segments after render dim/translucent.
  - **Static**: all segments full color; only a marker mesh moves along the
    path to the live index's position.
  - **Layer-focus**: segments whose `layerIndex` matches the live segment's
    layer render full color; all others dim.
- All three modes recolor/re-opacity the *same* geometry buffer on each
  live-position update (a `Float32Array` color attribute rewrite) — switching
  modes or advancing position never re-parses or rebuilds geometry.

### Error handling & empty states

- No active job: card shows a quiet "No active job" placeholder, no scene.
- `download()` rejects (404, network error): inline error message + a Retry
  button; doesn't affect the Position/Job-progress cards on the same view.
- Worker parse throws (malformed gcode): same inline-error treatment,
  isolated to this card since parsing runs off the main thread.
- Job's active file changes mid-view (new print starts while Activity is
  open): the effect re-triggers the download/parse cycle same as a fresh
  mount.

## File structure

New:
- `src/views/Activity.tsx` — the view; renders `<PositionCard>`,
  `<ActiveJobCard>`, `<GcodeViewer>` in its own `<PanelCanvas>`.
- `src/views/activity.panelDefaults.ts` — `ACTIVITY_PANEL_DEFAULTS`, ids
  `"position" | "job" | "gcode-viewer"`, following the exact shape/pattern
  of the other five `*.panelDefaults.ts` files.
- `src/cards/PositionCard.tsx`, `src/cards/ActiveJobCard.tsx` — extracted
  card components (see Architecture above).
- `src/gcode/parseGcode.ts`, `src/gcode/parseGcode.worker.ts`,
  `src/gcode/GcodeViewer.tsx`, `src/gcode/renderModes.ts` (the
  progressive/static/layer-focus color-attribute logic, kept separate from
  the Three.js scene setup so it's testable as pure data transforms).

Modified:
- `src/views/Machine.tsx` — Position card body replaced with
  `<PositionCard>` import.
- `src/views/Jobs.tsx` — Active-job card body replaced with
  `<ActiveJobCard>` import.
- `src/shell/router.ts` — `Route` union gains `"activity"`.
- `src/shell/Shell.tsx` — `NAV` array + view `<Switch>` gain the Activity
  entry.

## Testing

- `parseGcode.ts`: unit tests with hand-written gcode snippets — linear
  move sequences, layer-boundary detection on Z change, arc-as-chord
  behavior for `G2`/`G3`, and the `byteOffset` monotonicity the live-index
  binary search depends on.
- The live-index-from-`filePosition` lookup: unit-tested as a plain function
  taking a `ParsedToolpath` and a byte offset, independent of the worker or
  Three.js.
- `PositionCard`/`ActiveJobCard` extraction: existing Machine/Jobs tests must
  keep passing unchanged (this is a pure refactor, not a behavior change);
  `Activity.tsx` gets a thin render test confirming both cards mount.
- The Three.js scene itself (WebGL) is not meaningfully unit-testable —
  verified live in-browser, same as the rest of this project's UI work.

## Open items resolved during brainstorming

- Render approach: full 3D (not 2D per-layer canvas), using Three.js as
  CLAUDE.md anticipated.
- Placement: new dedicated "Activity" view, not a card on an existing view
  or a floating tile.
- Live-sync semantics: all three modes (progressive reveal, static+marker,
  layer-focus) are in scope as a user-selectable toggle, not a single fixed
  mode.
- Parsing: one-time download + Web Worker parse; never re-parsed for
  ordinary progress updates, only when the active job's file changes.
