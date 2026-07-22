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
| **Layer chart** (per-layer times) | ✅ (`LayerChart.vue`) | ✅ | `charts/LayerChart.tsx` — uPlot bars keyed by layer number, min/avg/max summary; on the Activity view below the toolpath viewer |
| Sensors (endstops, probes, filament) | ✅ | ✅ | named sensors, status dots |
| Job progress / estimations | ✅ (3 panels) | ✅ | Elapsed/remaining/layer + a single best-of "Remaining" (filament→file→slicer trust order); Activity's detailed card breaks out all three RRF sources. Compact control cards (Machine/Control) keep the one headline so their slot never gains a row. `om/estimates.ts` |
| Preflight strip (state/homed/HOT/faults) | — | ✅ | Our addition |
| Object model browser | ✅ (plugin) | ✅ | `om/OmInspector.tsx`, first-class |

## 3. Movement & homing

| Capability | DWC | dwc-ng | Notes |
|---|---|---|---|
| Home all / per-axis (`G28`) | ✅ | ✅ | |
| Jog with step sizes (`G91`/`G0`) | ✅ | ✅ | `M120 · G91 · M121` wrapped |
| Babystepping (`M290`) | ✅ | ✅ | |
| Workplace coordinate selection (G54–G59) | ✅ | ❌ | |
| **Disable motors** (`M84`) | 🚫 (console only) | ✅ | All + per axis in Homing. DWC has no such panel — `M84` appears there only as a console autocomplete hint (`store/machine/cache.ts:54`). |
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
| **Reset heater fault** (`M562`) | ✅ (`ResetHeaterFaultDialog`) | ✅ | `cards/HeaterState.tsx`, two-step confirm |
| **Filament load/unload** (`M701`/`M702`) | ✅ | ✅ | Per tool, with a run-macros (P0) toggle; `M703` applies the filament config |
| **Filament management** (assign/config per extruder) | ✅ (`Filaments.vue`, `FilamentDialog`) | ❌ | Belongs under machine management, not files |
| Tool grouping / display config | ✅ (`SettingsToolGroupingPanel`) | ❌ | |
| Spindle control (`M3`/`M4`/`M5`) | ✅ | 🚫 | CNC |

## 5. Job control

| Capability | DWC | dwc-ng | Notes |
|---|---|---|---|
| Start print (`M32`) | ✅ | ✅ | |
| Pause / resume (`M25`/`M24`) | ✅ | ✅ | |
| Cancel (`M0`) | ✅ | ✅ | |
| Simulate (`M37`) | ✅ | ✅ | Start button beside Start print (`M37 P"<file>"`) |
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
| **Create directory / new file** | ✅ | ✅ | Inline in every listing (no dialogs) — `files/FileBrowserView.tsx` |
| **Rename / move / delete** | ✅ | ✅ | Inline rename; delete is a two-step confirm; dirs delete recursively |
| **Directory breadcrumbs / nested navigation** | ✅ | ✅ | One `createFileBrowser` shared by Jobs/Macros/System; `parentDir` clamps at the domain root |
| **Bulk file transfer / progress UI** | ✅ (`FileTransferDialog`) | 🟡 | Single upload works; no queue/progress dialog |
| Filament files | ✅ | ❌ | see §4 |

## 7. Console & messaging

| Capability | DWC | dwc-ng | Notes |
|---|---|---|---|
| Console with command entry + reply | ✅ | ✅ | Console drawer on every view |
| Command history | ✅ | ✅ | ↑/↓ recall of sent commands, localStorage-persisted, draft preserved on step-past-newest; `om/commandHistory.ts` |
| **M291 message boxes + M292 acknowledge** | ✅ (`MessageBoxDialog.vue`) | ✅ | `messagebox/` — seq handshake, jog controls per the axis bitmap |
| Notifications / toasts | ✅ (`NotificationDisplay`) | 🚫→✅ | No transient toasts by design — we surface into the persistent console instead (a toast that scrolls away is the wrong medium for a fault log). Errors/warnings are now colour-coded there, so the surfacing path is legible |
| Event/log list | ✅ (`EventList`) | ✅ | Console lines carry firmware-authored severity: `classifyReply` colours `Error:` red / `Warning:` gold, derived from the text (never stored, can't drift). `om/consoleLog.ts` |

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
| Viewer: per-object selection/cancel | ✅ (in the viewer) | ✅ | `cards/BuildObjects.tsx` — a list on Activity rather than picking in the viewer; cancel/resume by index (`M486 P`/`U`) |
| Viewer: Z-clip / layer slider | ✅ (`setZClipPlane`) | 🟡 | We have layer-focus mode; no free top/bottom clip sliders |
| Viewer: render-quality tiers | ✅ (6 levels) | ❌ | We have one quality; merge tolerance is fixed |
| **Height map** (`G29` mesh visualisation) | ✅ (`HeightMap` plugin) | ✅ | `views/Bed.tsx` — gradient surface + probe points. **Above DWC:** single-point re-probe and manual nudge, which the read-only plugin cannot do |
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
| ATX power on/off (`M80`/`M81`) | ✅ (`ATXPanel`) | ✅ | Shown only when `state.atxPower !== null`; Gabe's board has no PS_ON port so it stays hidden |
| Communication/electronics info panels | ✅ | 🟡 | Some surfaced via OM inspector |
| Hide menu items / list customisation | ✅ | 🚫 | Superseded by our panel grid |
| Config-updated / incompatible-version prompts | ✅ | ❌ | |
| Write guard (arm before any write) | — | ✅ | Our safety addition, no DWC equivalent |

---

## Priority backlog

**P0 — correctness / live-print safety** — ✅ **done 2026-07-21**
1. ✅ **M291/M292 message boxes.**
2. ✅ **Reset heater fault** (`M562`).

**P1 — routine operation gaps**
3. ✅ **File create / rename / delete / mkdir** (2026-07-21). One shared browser
   across Jobs/Macros/System; traversal is a compile error, not a check.
   Recursive delete states its item count first; unrecoverable files need their
   name typed back.
4. ✅ **Disable motors** (`M84`) — all + per axis (2026-07-21).
5. ✅ **ATX power** (`M80`/`M81`) — OM-gated, hidden on this machine (2026-07-21).
6. ✅ **Simulation start** (`M37`) (2026-07-21).
7. ✅ **Filament load/unload** (`M701`/`M702`) (2026-07-21). Assignment/config
   editing per filament is still open — see §4 "Filament management".

**P1 and P2 are closed.** Next is P3 — lifecycle: firmware update,
workplace coordinates, input shaping, DSF/SBC connector.

**P2 — visibility**
8. ✅ **Height map** viewer with single-point re-probing and manual nudge
   (2026-07-21). Save is upload + `G29 S1` as one operation. ← done
9. ✅ **Layer chart** (per-layer times) (2026-07-21). uPlot bar chart keyed
   by layer number, min/avg/max summary; drops the trailing in-progress
   layer (RRF reports it with `duration 0`). ← done
10. ✅ **Per-object cancel** (`M486`) (2026-07-21) — as a list, not viewer
    picking. Viewer **Z-clip sliders** deliberately not done: the G-code viewer
    is good as it stands (Gabe, 2026-07-21).

**P3 — lifecycle**
11. **Firmware update** flow (`M997`).
12. Workplace coordinates (G54–G59).
13. Input shaping plots.
14. DSF/SBC connector.

---

## Verification needed

Items marked 🟡 above are best-effort reads of the codebase and should be
confirmed against the running app before being planned or closed:
notification/error surfacing, nested directory navigation, and upload progress.
Closed 2026-07-22: job estimation sources (all three RRF sources on the Activity
card, best-of headline everywhere); console command history (↑/↓ recall of sent
commands, persisted).
