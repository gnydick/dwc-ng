# DWC Parity — what dwc-ng still needs

**Baseline:** DuetWebControl v3.6.3, vendored read-only at `reference/dwc/`.
**Our surface:** `packages/ui/src` as of 2026-07-20.

> Per CLAUDE.md's hard rule, the vendored DWC source is **reference only** — it
> is read to learn *what problems exist* and *what edge cases matter*. Nothing
> here authorises copying its code. Every item below is a feature/behaviour
> gap to solve with our own implementation.

## How to read this

| Mark | Meaning |
|---|---|
| ✅ | Have it, at or above DWC's capability |
| 🟡 | Partial — works for the common case, known holes |
| ❌ | Missing |
| 🚫 | **Deliberately not doing** — divergence by design, not a gap |

---

## 0. Deliberate divergences — do NOT "fix" these

These look like gaps against DWC but are decided architecture. Listed first so
nobody closes them by accident.

| Area | DWC | dwc-ng | Why |
|---|---|---|---|
| Information architecture | Central **Files** section (Jobs/Macros/System/Filaments as one file browser) | 🚫 Domain-owned listings — Jobs/Macros/System each own their files | Files are a means, not a destination. Filaments are machine management, not a file type. |
| Layout | Fixed dashboard panels | 🚫 24-col collision-aware panel grid, user-movable, per-view, persisted with reset/rollback | Modifiable UI on immutable defaults is foundational here |
| Click semantics | Click a job file → may run it | 🚫 Click **always** opens/edits; running is an explicit, separate control | Prevents catastrophic misclicks |
| Control logic | Some GUI-side gating/verdicts | 🚫 Every control is 1:1 with a G-code; no GUI-encoded safeties | Firmware is the authority |
| Plugin system | Full DWC plugin architecture (`DwcPlugin.ts`, install dialog, plugin store) | 🚫 Not planned | We are a control plane for a specific appliance, not a platform |
| SBC/DSF features | DSF-only endpoints, plugin management | 🚫 Deferred behind the connector abstraction | Standalone-first by design |
| On-screen keyboard | `OnScreenKeyboard` plugin | 🚫 Not planned | Touch panel use-case not in scope |

---

## 1. Connection, session, transport

| Capability | DWC | dwc-ng | Notes |
|---|---|---|---|
| `rr_connect` sessions + password auth | ✅ | ✅ | `PollConnector` |
| seqs-driven invalidation, chunked `rr_model` | ✅ | ✅ | incl. `reportedAxes`/`move.axes` edge case |
| `rr_gcode` + `rr_reply` shared-buffer drain | ✅ | ✅ | |
| `rr_upload` with CRC32 verification | ✅ | ✅ | |
| `rr_filelist` pagination | ✅ | ✅ | |
| 503 retry / 401 recovery / reconnect ladder | ✅ | ✅ | |
| Request prioritisation | — | ✅ | `requestQueue.ts` — poll heartbeat can't be starved |
| **DSF/SBC connector** | ✅ | ❌ | Bolt-on behind connector interface; not started |
| Multi-machine / machine switching | ✅ | ❌ | DWC manages several boards; we target one appliance |

## 2. Status & monitoring

| Capability | DWC | dwc-ng | Notes |
|---|---|---|---|
| Axis positions / DRO | ✅ | ✅ | 7-axis, role labels, homed state |
| Tools + heaters state | ✅ | ✅ | incl. bed-no-standby |
| Temperature chart | ✅ (`TemperatureChart.vue`) | ✅ | `charts/TemperatureChart.tsx` |
| **Layer chart** (per-layer times) | ✅ (`LayerChart.vue`) | ❌ | We have layer-time *colouring* in the viewer but no chart |
| Sensors (endstops, probes, filament) | ✅ | ✅ | named sensors, status dots |
| Job progress / estimations | ✅ (3 panels) | 🟡 | Have elapsed/remaining/layer; verify all RRF estimate sources (file/filament/layer) are surfaced |
| Preflight strip (state/homed/HOT/faults) | — | ✅ | Our addition |
| Object model browser | ✅ (plugin) | ✅ | `om/OmInspector.tsx`, first-class |

## 3. Movement & homing

| Capability | DWC | dwc-ng | Notes |
|---|---|---|---|
| Home all / per-axis (`G28`) | ✅ | ✅ | |
| Jog with step sizes (`G91`/`G0`) | ✅ | ✅ | `M120 · G91 · M121` wrapped |
| Babystepping (`M290`) | ✅ | ✅ | |
| Workplace coordinate selection (G54–G59) | ✅ | ❌ | |
| **Disable motors** (`M18`/`M84`) | ✅ | ❌ | |
| Mesh bed compensation run (`G29`) | ✅ | ❌ | see §8 Height map |
| CNC axes/movement panels | ✅ | 🚫 | FFF-focused appliance |

## 4. Tools, heaters, extrusion

| Capability | DWC | dwc-ng | Notes |
|---|---|---|---|
| Tool select / active+standby temps (`M568`) | ✅ | ✅ | |
| Bed temps (`M140`) | ✅ | ✅ | |
| Extrude / retract (`M83`+`G1 E`) | ✅ (`ExtrudePanel`) | ✅ | |
| Speed factor (`M220`) | ✅ | ✅ | |
| Extrusion factor (`M221`) | ✅ | ✅ | |
| Fans (`M106`) | ✅ | ✅ | |
| **Reset heater fault** (`M562`) | ✅ (`ResetHeaterFaultDialog`) | ❌ | Fault is surfaced in preflight but not clearable from UI |
| **Filament load/unload** (`M701`/`M702`) | ✅ | ❌ | |
| **Filament management** (assign/config per extruder) | ✅ (`Filaments.vue`, `FilamentDialog`) | ❌ | Belongs under machine management, not files |
| Tool grouping / display config | ✅ (`SettingsToolGroupingPanel`) | ❌ | |
| Spindle control (`M3`/`M4`/`M5`) | ✅ | 🚫 | CNC |

## 5. Job control

| Capability | DWC | dwc-ng | Notes |
|---|---|---|---|
| Start print (`M32`) | ✅ | ✅ | |
| Pause / resume (`M25`/`M24`) | ✅ | ✅ | |
| Cancel (`M0`) | ✅ | ✅ | |
| Simulate (`M37`) | ✅ | 🟡 | Simulations run and display; verify we can *start* one from the UI |
| **Cancel individual object** (`M486`) | ✅ (viewer object selection) | ❌ | DWC's viewer supports per-object cancel |
| Repeat / re-run last job | ✅ | ❌ | |
| Job file thumbnails | ✅ | ✅ | QOI decoder, `thumbnails/` |

## 6. Files

| Capability | DWC | dwc-ng | Notes |
|---|---|---|---|
| Job file listing + details | ✅ | ✅ | |
| Macro listing + run (`M98`) | ✅ | ✅ | with confirm |
| System file listing + edit | ✅ | ✅ | CodeMirror 6, lazy-loaded |
| Upload (with CRC verify) | ✅ | ✅ | |
| Download | ✅ | ✅ | |
| **Create directory / new file** | ✅ | ❌ | `NewDirectoryDialog`, `NewFileDialog` |
| **Rename / move / delete** | ✅ | ❌ | Verify — no delete/rename path found |
| **Directory breadcrumbs / nested navigation** | ✅ | 🟡 | Verify depth handling in each listing |
| **Bulk file transfer / progress UI** | ✅ (`FileTransferDialog`) | 🟡 | Single upload works; no queue/progress dialog |
| Filament files | ✅ | ❌ | see §4 |

## 7. Console & messaging

| Capability | DWC | dwc-ng | Notes |
|---|---|---|---|
| Console with command entry + reply | ✅ | ✅ | Console drawer on every view |
| Command history | ✅ | 🟡 | Verify persistence |
| **M291 message boxes + M292 acknowledge** | ✅ (`MessageBoxDialog.vue`) | ❌ | **Highest-priority gap — see below** |
| Notifications / toasts | ✅ (`NotificationDisplay`) | 🟡 | Verify error surfacing path |
| Event/log list | ✅ (`EventList`) | 🟡 | `om/consoleLog.ts` exists; verify severity handling |

> ### ⚠️ M291/M292 is a correctness gap, not cosmetic
> `state.messageBox` is **not modelled anywhere** in our OM types or store.
> When RRF raises a blocking message box (very common in toolchanger tool-change
> macros and filament-change flows), the firmware **waits for `M292`**. Today our
> UI shows nothing at all — the machine appears to hang with no explanation and no
> way to acknowledge. This should be treated as a live-printing defect.

## 8. Visualisation & diagnostics

| Capability | DWC | dwc-ng | Notes |
|---|---|---|---|
| 3D G-code toolpath viewer | ✅ (`@sindarius/gcodeviewer`) | ✅ | Ours: Babylon, real 3D beads, feature/speed/layer-time colouring, progressive/static/layer reveal, ghost preview, build-once `thinInstanceCount` live path |
| Viewer: per-object selection/cancel | ✅ | ❌ | |
| Viewer: Z-clip / layer slider | ✅ (`setZClipPlane`) | 🟡 | We have layer-focus mode; no free top/bottom clip sliders |
| Viewer: render-quality tiers | ✅ (6 levels) | ❌ | We have one quality; merge tolerance is fixed |
| **Height map** (`G29` mesh visualisation) | ✅ (`HeightMap` plugin) | ❌ | Notable gap for bed levelling |
| **Input shaping** (accelerometer plots) | ✅ (`InputShaping` plugin) | ❌ | |
| Webcam | ✅ (`Job/Webcam.vue`) | ✅ | Floating pinnable camera tile |

## 9. Settings & maintenance

| Capability | DWC | dwc-ng | Notes |
|---|---|---|---|
| Appearance / theme | ✅ | ❌ | Single designed theme by choice; revisit only if asked |
| Machine-specific config (axis roles, sensors, dock sensors, camera) | partial | ✅ | Ours is richer here |
| Config versioning / rollback | ❌ | ✅ | Snapshot history + revert — our addition |
| **Firmware update** (`M997`, `FirmwareUpdateDialog`) | ✅ | ❌ | |
| **Emergency stop** (`M112`) | ✅ | ✅ | |
| **Board reset** (`M999`) | ✅ | ✅ | |
| ATX power on/off (`M80`/`M81`) | ✅ (`ATXPanel`) | ❌ | |
| Communication/electronics info panels | ✅ | 🟡 | Some surfaced via OM inspector |
| Hide menu items / list customisation | ✅ | 🚫 | Superseded by our panel grid |
| Config-updated / incompatible-version prompts | ✅ | ❌ | |
| Write guard (arm before any write) | — | ✅ | Our safety addition, no DWC equivalent |

---

## Priority backlog

**P0 — correctness / live-print safety**
1. **M291/M292 message boxes.** Model `state.messageBox`, render a blocking
   prompt, send `M292`. Blocks toolchanger + filament-change workflows today.
2. **Reset heater fault** (`M562`). We show the fault but can't clear it.

**P1 — routine operation gaps**
3. File **create / rename / delete / mkdir** — currently read+upload only.
4. **Filament load/unload** (`M701`/`M702`) and filament assignment.
5. **Disable motors** (`M18`/`M84`).
6. **ATX power** (`M80`/`M81`) if the machine has it.
7. Verify **simulation start** (`M37`) is reachable from the UI.

**P2 — visibility**
8. **Height map** viewer (`G29` mesh) — biggest remaining visualisation gap.
9. **Layer chart** (per-layer time/height).
10. Viewer **Z-clip sliders** and per-object cancel (`M486`).

**P3 — lifecycle**
11. **Firmware update** flow (`M997`).
12. Workplace coordinates (G54–G59).
13. Input shaping plots.
14. DSF/SBC connector.

---

## Verification needed

Items marked 🟡 above are best-effort reads of the codebase and should be
confirmed against the running app before being planned or closed:
job estimation sources, console history persistence, notification/error
surfacing, nested directory navigation, upload progress, and whether `M37`
simulation can be started from the UI.
