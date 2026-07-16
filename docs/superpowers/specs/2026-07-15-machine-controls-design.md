# Machine Controls — Design Spec

Date: 2026-07-15
Status: approved-by-delegation (Gabe: "use the design skill", decisions delegated)

## Purpose

Add the interactive machine controls dwc-ng lacks (homing, movement, heaters,
tools, extrude, fans, tuning) as a dedicated **Control view**, keeping the
Machine view a calm read-only glance.

## Governing principle (hard constraint)

**Controls are 1:1 with G-code.** Every control sends a direct command. The only
logic beyond raw commands is **convenience compounds** — a fixed bundle of a
couple of commands in one click (never conditional). **No GUI-encoded safety,
verdicts, gating, or interlocks** — the firmware/macros are the authority; we
send the command and surface the reply. (See memory: controls-are-1to1-with-gcode.)

Corollary: RRF already enforces the real safeties natively (unhomed-move
rejection, M302 cold-extrude, heater-fault cutoff, temp limits). The GUI never
pre-judges; a rejected command shows its reply in the console.

## Design language

Reuses the established solder-mask / silkscreen system (--mask blues, --silk,
--copper, Rajdhani display). No new aesthetic.

**Signature — controls wear their G-code.** Every control shows the literal
command it fires in a system-monospace face (ui-monospace/Menlo/Consolas — zero
bundle cost), paired with its Rajdhani label. The view reads as a *semantic
G-code console*: commands grouped by function, each surface honestly stamped
with what it sends. This makes the 1:1 rule visible and is the memorable element.

- Label: Rajdhani, uppercase, silkscreen.
- Command stamp: mono, --silk-dim, small, shown on the control (or its hover
  title where space is tight).
- Restraint: the mono stamp is the one flourish; everything else stays quiet.

## Structure — Control view (`#/control`, nav between Machine and Jobs)

Cards in the existing grid. Sections, in daily-relevance order:

### 1. Homing
- `Home All` → `G28`
- Per-axis chips **X Y Z U V W C** (role-labeled) → `G28 X` … `G28 C`.

### 2. Movement
- Jog: per-axis −/+ for all 7 axes (role labels; U/V/W = individual Z leadscrews,
  C = coupler). Step selector `0.1 · 1 · 10 · 100` mm; jog feedrate field.
  Each press = convenience compound `G91` + `G1 H2 <axis><step> F<feed>` + `G90`.
- **Coupler:** `Lock` → `M98 P"/macros/tool_lock"` (`G1 C0`), `Unlock` →
  `M98 P"/macros/tool_unlock"` (`G1 C121`). (Exact form verified vs the real
  macros; sending the macro is truest to the machine.)
- Extrude/Retract (active tool): amount + feedrate, compound `M83` + `G1 E±<amt> F<feed>`.

### 3. Heaters
- Per tool-heater + bed: temp input + state buttons. Tools: `Off · Standby ·
  Active`. **Bed: `Off · Active` only** (no standby on this machine).
- Convenience compound: `Active` w/ temp → `M568 P<t> S<temp> A2`; `Standby` →
  `M568 P<t> R<temp> A1`; `Off` → `M568 P<t> A0`. Bed `Active` → `M140 S<temp>`;
  `Off` → exact off string verified vs vendored DWC.

### 4. Tools
- `T0 T1 T2 T3` → `T0`…; `Deselect` → `T-1`.

### 5. Fans
- Per configured fan: percentage control → `M106 P<n> S<0..1>`.

### 6. Tuning (secondary, print-time)
- Speed factor → `M220 S<pct>`; flow factor → `M221 S<pct>`;
  babystep → `M290 Z±<step>` (or `R1` variants — verify).

## Components / boundaries

- `ControlView` (`views/Control.tsx`) — composes the section cards; reads OM for
  labels/state, sends via `connector.sendCode`.
- `GcodeButton` (shared) — label + mono command stamp; onClick sends its command.
  The reusable primitive that makes the signature consistent and the 1:1
  guarantee structural (a button *is* its command).
- `HeaterControl`, `JogPad`, `FanControl` — section-specific, built from
  `GcodeButton` + inputs.
- Exact command strings sourced from reference/ (vendored DWC + the real macros),
  never memory.

## Testing

- Unit: command-builder helpers (pure: temp+state → M568 string; jog params →
  G1 string) via TDD.
- Live: drive the Control view in Chrome against the mock; verify each control
  emits the expected G-code (console/reply) and OM reflects it. Motion/heat
  verified against the mock, never the real board (self-imposed safety rule).

## Out of scope (later)

- Per-machine control layout customization (modifiable-UI overlay) — the controls
  ship with sensible defaults first.
- Filament load/unload flows, macros-as-controls.
