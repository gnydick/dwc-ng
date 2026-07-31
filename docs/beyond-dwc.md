# Beyond DWC - what dwc-ng has that DuetWebControl doesn't

**Baseline:** DuetWebControl v3.6.3, vendored read-only at `reference/dwc/`.
**Our surface:** `packages/ui/src` as of 2026-07-31.

The sibling of [`dwc-parity.md`](dwc-parity.md), which tracks the opposite
direction - what DWC has that we still owe. This file is the inverse: features
with no DWC counterpart at all.

> Per CLAUDE.md's hard rule, the vendored DWC source is **reference only**. It
> is read to establish what exists, never to copy. Everything below is our own
> implementation.

## How this list was established

Not from memory. Each claim was checked against the vendored source:

| Evidence | Where | What it establishes |
|---|---|---|
| Route list | `reference/dwc/src/routes/` | DWC's whole navigable surface: Control (Console, Dashboard, Status), Files (Filaments, Jobs, Macros, System), Job (Status, Webcam), Settings (General, Machine, Plugins) |
| Panel list | `reference/dwc/src/components/panels/` | Every dashboard panel DWC ships |
| Chart list | `reference/dwc/src/components/charts/` | `TemperatureChart.vue`, `LayerChart.vue` - both exist, so neither is ours |
| Built-in plugins | `reference/dwc/src/plugins/` | GCodeViewer, HeightMap, InputShaping, ObjectModelBrowser, OnScreenKeyboard |
| Dependency list | `reference/dwc/package.json` | No grid/drag library present |
| `grep -rl draggable src` | → `BaseFileList.vue` only | That is drag-to-**upload**, not layout. DWC has no movable panels. |
| `grep -n sendCode HeightMap.vue` | → no matches | DWC's height map is render-only; it performs no probing |
| `getRealHeaterColor(index)` | `TemperatureChart.vue:47,109` | Heater colors are a pure function of index - not a setting, by construction |

Two negative results carried most of the weight: the absent drag library, and
the absent `sendCode` in the HeightMap plugin.

---

## 1. Layout & arrangement

- Drag any card anywhere on the screen; resize any card freely.
- A grid that **refuses** an overlapping drop rather than reshuffling your
  other cards.
- Pick up several cards (Ctrl/Cmd or Shift-click a grip) and move the whole
  formation rigidly - every member shifts by the same delta, so their relative
  positions are identical before and after.
- Four display densities, from roomy down to phone-sized.
- Four saved layouts per machine: desktop and mobile, portrait and landscape,
  each independent.
- Flip a card's internal content between vertical and horizontal.
- Hide the label column on cards whose controls already name themselves.
- Reset one screen's layout without touching anything else.

<sub>*Classic DWC: fixed panel positions and an FFF/CNC dashboard-mode
switch. Its only layout-ish setting is `SettingsHideMenuItemsPanel.vue` -
hiding whole menu items, not arranging anything.*</sub>

## 2. User-authored screens & cards

- Create new screens and name them; rename the built-in screens.
- Build custom cards from a closed vocabulary of buttons, inputs and readouts.
- Every custom control displays the G-code it sends.
- `forEach` - write **one** row and repeat it over every tool, heater or axis
  in the object model, with `{axis.letter}`-style placeholders filled per
  repetition. Add an axis to `config.g` and the card grows a row by itself.
- Export a card or a whole screen as a file to share with another operator.
- The import review lists **every** G-code, input and object-model read a
  shared card can touch, before you accept it. The control vocabulary being
  closed is what makes that inventory complete rather than best-effort.
- Shared files carry no executable code, and minted ids never travel - a
  foreign file cannot collide with or overwrite anything local.

<sub>*Classic DWC: the extension path is authoring a Vue plugin and
rebuilding the app.*</sub>

## 3. Bed & probing

- Re-probe a **single** height-map point without re-running the whole mesh.
- Manually nudge one map cell when a probe reading is obviously wrong.
- Choose which height-map file is in use; probe / load / save-as / clear from
  one card.
- Bed tram card that reports the **last result** back, not a fire-and-forget
  button.
- The probe command is a template the operator owns, so their own macro's
  preconditions apply rather than ours.

<sub>*Classic DWC: renders the height map read-only and scatters `G29` /
`G29 S1` / `G32` as menu items under Movement (`MovementPanel.vue:44,51,59`) -
the map and the act of fixing what the map shows live in two different
places.*</sub>

## 4. Per-machine naming & color

- Axis role labels - `U V W` can read as "Z motor 1, Z motor 2, Z motor 3".
- Rename sensors instead of living with the firmware's numbering.
- Pick the chart line color for each heater individually.
- Adjustable cold / warm / hot color ramp for every temperature reading.
- Tool dock presence indicators driven by the operator's own switches
  (docked vs away).

## 5. Settings storage

- Saved version history with one-click revert to any earlier snapshot.
- Reset a single setting, a single screen, or everything - reset is "drop my
  change", so it cannot fail.
- Future defaults reach the operator automatically wherever they haven't
  customized.
- Unsaved-changes state survives a reload instead of being silently
  overwritten by the next connect.
- Per-device preferences (density, last folder, scroll position) stay on the
  device and never mark anything unsaved.
- File browsers remember the folder you were in and where you'd scrolled to.

<sub>*Classic DWC: a factory reset and a local-vs-SD storage toggle
(`SettingsGeneralPanel.vue:10,17`). No history, no per-setting reset.*</sub>

## 6. Safety & interaction

- Destructive and machine-moving controls arm first, then fire - Delete, Run,
  Save, heater activate.
- Escape disarms **every** armed control on the page, including ones written
  later by someone who never read `control/armed.ts`.
- Emergency stop reports when it failed to reach the board, instead of failing
  silently.
- Pinned commands: park a G-code that re-sends on an interval to override a
  running job.
- Optional one-click macro run for operators who don't want the confirm step.
- Choose which tool-change macros run - tfree, tpre, tpost - as a field on the
  tool itself, per command, rather than as a machine-wide setting. The field
  reads back in words ("tfree · tpost"), and blank is distinct from `P0`: blank
  sends no P at all and lets the firmware run all three, `P0` suppresses them.
  See the DWC note below - the capability is parity, only its placement is not.

## 7. Presentation

- Live-updating values are pinned so digits never jitter or reflow the layout.
- Cards do not rearrange themselves when the window resizes.
- Every card names the object-model path or G-code that powers it, in its own
  header.
- The page reports the exact commit it was built from.

---

## Not ours - parity, not advantage

DWC already has these; we match rather than beat them. Listed so nobody
mistakes them for differentiators:

job list with run/simulate, three-source time estimates, pause/resume/cancel,
object cancellation (M486), the file editor, macros, filament management,
tools/heaters/fans/ATX, homing and jog, speed and extrusion factors,
babystepping, console, temperature chart, layer-time chart, 3D toolpath
viewer, object-model browser, webcam, firmware update, **selectable
tool-change macros**.

The toolpath viewer and object-model browser exist in both. Ours are cards
placeable on any screen rather than full-page plugins - but that is the layout
advantage in §1, not a separate feature, and it is not counted twice.

**Tool-change macros, specifically.** Easy to mistake for ours, so it is
written down.

<sub>*Classic DWC: builds the same `P` bitmask from three checkboxes in
Settings -> Machine (`SettingsMachinePanel.vue:86-94`), and applies it to
deselect as well - `ToolRows.vue:309` sends `"T-1" + toolChangeParameter`.
Its getter (`store/machine/settings.ts:309`) even collapses `P7` to an
omitted `P`, which is the same "all three, no P" behavior ours has.*</sub>

The capability is therefore parity in full. What differs is only that DWC's
lives once, globally, in Settings, so varying it for a single tool change means
leaving the tools screen and changing a machine-wide preference; ours is a
field beside the tool, typed per command. That difference is the §6 bullet,
and it is deliberately worded as placement rather than capability.
