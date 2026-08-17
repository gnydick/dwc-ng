# dwc-ng visual design

`dashboard-comp.html` is a static design comp (open directly in a browser). It is
the visual reference for the real SolidJS UI — not app code, not part of any build.

## Direction: "hard anodize" (2026-08-17)

The ground is the machine's own surface: hard-anodized graphite, bead-blasted
aluminium text, and one cool accent that is used nowhere else. Structure labels
remain PCB-style reference designators — and every designator is still a **real
RRF object-model key** (`T0`, `heater0`, `fan0`, `move.axes`), never invented.

**Supersedes "solder mask & silkscreen"** (deep blue surfaces, copper accent),
which shipped until 2026-08-17. It was replaced for a measured reason, not a
preference: six tokens sat inside a **39° hue arc** at 47–63% lightness, so
`--accent` (28°) and `--t-warm` (34°) were 6° apart. The colour meaning "you may
press this" and the colour meaning "this is heating up" were the same colour.
Running the project's own `deltaE` (`util/colorDistance.ts`) across the chrome,
the operator's thermal ramp and the chart series found **20 pairs under the
codebase's own `MIN_SEPARATION` of 25**.

The ramp owns the warm arc and belongs to the operator (`thermalColors`), so a
collision there cannot be fixed by moving it — separation that depends on the
operator not changing a setting is not separation. **The accent moves instead**,
28° → 188°, putting 152° between it and the whole warm arc. Nothing warm on
screen is interactive; nothing cyan is thermal.

The neutral ground does a second job: `--silk-dim` is 7% saturated here, so
`--t-cold` (209°, 25%) separates from it by *chroma* at the same lightness. On
the blue ground the two were 2° apart and a cold reading looked like a disabled
label.

The one rule the palette is built on: **colour marks what is happening, never
what a thing is.** A control at rest is neutral no matter what it does.

Navy remains available in the palette lab (dev only) — `?ground=navy`.

## Tokens

| Token | Value | Use |
|---|---|---|
| `--mask-900` | `#15171B` | page background |
| `--mask-700` | `#1E2128` | cards |
| `--mask-500` | `#2A2E37` | raised / tracks |
| `--silk` | `#E8EAEE` | primary text |
| `--silk-dim` | `#8A9099` | secondary text, labels |
| `--accent` / `--accent-bright` | `#2FC4D4` / `#5CE0EE` | accent, interactive, progress |
| `--ok` / `--fault` / `--gold` | `#57C07A` / `#E5645A` / `#C9A227` | semantic states only |
| `--magenta` | `#A97FD6` | Off, as a state rather than an alarm |
| `--face-*` | `#313640` → `#262A32` | the gradient a pressable control is cut from |
| `--t-cold` → `--t-warm` → `--t-hot` | `#6E8CA8` → `#E0A458` → `#EF7B45` | thermal-keyed numerals |

`--accent` / `--accent-bright` were `--copper` / `--copper-bright` until this
pass. The name had stopped describing the value, and a token whose name says one
colour while it holds another is a trap for the next person mixing a palette.
`--accent` names what the token is *for*, which is what survives a re-ground.

`--face-*` were six literal hex values inside `app.css` until this pass, which
made the button face the one large surface no palette could reach: every token
above could change and the buttons stayed navy.

`--accent-blue` (`#5CE0EE`) is now the same value as `--accent-bright` and has
two uses, both scroll-shadow insets. It is a leftover of the old palette and
should be folded into `--accent-bright`.

## Type

- **Rajdhani** 500/600/700 — DRO numerals, headings, labels (uppercase,
  letterspaced), always `font-variant-numeric: tabular-nums` on data.
  Comp loads it from Google Fonts; **production must self-host a subsetted
  woff2 from the SD card** (dependency/asset decision pending approval).
- **System UI stack** — body text. Zero bytes; honors the 300 KB budget.

## Signature elements (spend boldness here, nowhere else)

1. **Thermal-keyed numerals** — temperature readouts colored by actual heat
   (cold steel-blue → amber → glowing orange). Color encodes data. On the
   anodize ground this is the *only* warm colour in the UI, which is what the
   accent moved out of the warm arc to protect.
2. **Trace progress bar** — job progress drawn as an accent trace terminating
   in a via pad.
3. **The mode-key ladder** — a heater key carries five independent facts at
   once, each on its own channel: label + fixed column say *which key*, a 2 px
   inset border says *armed* (press 1 landed), a solid fill says *engaged*
   (this is the mode), a thermally-coloured halo says *arrival*, and a corner
   dot says the setpoint field holds an unwritten value. Rest is neutral. Four
   tools used to show twelve permanently-lit buttons with the machine idle.
   Nothing on this ladder moves geometry — colour, fill and shadow only — so a
   key cannot shift under the pointer when it changes state.

Everything else stays quiet: hairline borders at `rgba(232,234,238,.10)`,
6 px radius, no gradients on surfaces, no decorative motion. Only animation is
the state-badge pulse, disabled under `prefers-reduced-motion`.

## Interaction principles

**The location determines the verb.** The worst seam in official DWC: in
Files → Macros a click *runs* the macro (with a confirm), while in
Files → System the same click opens an editor. Same object, same gesture,
opposite verbs — and the surprise direction is machine motion. In dwc-ng:

- In any file listing, primary click always **opens** — editor for text files,
  info pane otherwise. Never click-to-run, never click-then-confirm-run.
- Domain verbs (Print, Run) are explicit, labeled buttons on the row — the
  verb is visible before the gesture.
- Control surfaces (dashboard) are the execution context: macro quick-run
  panel, job start. Listings are management contexts. The two never trade verbs.

**Views own their content; storage is an implementation detail.** DWC's
"Files" section groups by SD directory instead of by task — that's backwards.
dwc-ng has no central Files area:

- **Jobs** owns `gcodes/`: printable files with metadata (est. time, filament,
  thumbnail) and an explicit Print button.
- **Macros** owns `macros/`: edit on click, explicit Run button; a quick-run
  panel also lives on the dashboard.
- **System** owns `sys/`: config editing, board/firmware info, backups —
  plus a power-user raw SD browser if ever needed. The **object model
  inspector is first-class here** (DWC buries it in a plugin) — dwc-ng polls
  the whole OM anyway, and designator chips elsewhere in the UI can deep-link
  into it.
- **Filaments are not files.** Defining/editing profiles is a setting;
  load/unload is a machine action on the dashboard/tool panel. Users never
  see the `filaments/` directory.

**Modify without fear.** The UI layout is user-modifiable, and customization
only gets used if experimenting is safe:

- User layout is an **overlay on immutable defaults** — the baseline is code,
  never mutated. Reset (per-panel or whole layout) just drops the overlay, so
  it always works and defaults can't drift.
- Explicit edit mode with live preview. Save commits; leaving discards.
- Small snapshot history of layout configs with one-click revert.
- Layout config is plain JSON, small enough to diff by eye.
- No drag-drop library — hand-rolled, per the bundle budget.

**North star: the control plane of a specific-purpose appliance** (Gabe's
framing — DWC is "a hodge podge of ideas"). Tests that follow from it:

- One source of truth per control. Never the same slider on two pages
  (DWC: fans + speed factor on both Dashboard and Job Status).
- A control's view and its configuration live together (DWC: webcam view
  under Job, webcam config under Settings → General).
- Capabilities never appear/disappear with plugin state (DWC: Height Map
  vanishes from nav when its plugin is stopped).
- Controls match hardware semantics: the bed heater has no standby, so it
  gets Active/Off — not DWC's three-state toggle with a standby column.

**Global chrome (from Gabe's answers, 2026-07-12):**

- **Preflight strip**, not DWC's pinned third-of-screen dashboard block: a
  slim always-visible line with what you must know before touching the
  machine — state badge, homed/unhomed, HOT indicator (any heater above
  safe-touch temp, even when idle), motion in progress, active tool, job %
  when printing, pending M291 dialog, fault, connection. E-stop always in
  the header.
- **Floating camera tile**: pinnable overlay that persists across views
  (his tuning workflow: watch the nozzle while jogging), toggled from the
  header. Not a page.
- **Jog panel**: XYZ primary; other axes grouped behind an expand and
  labeled by *role* (his UVW = individual Z motors for sag recovery, C =
  tool coupler). Role labels are per-machine UI metadata in the modifiable
  layout config. 5-axis printing is on his roadmap — no hardcoded XYZ
  assumptions anywhere.
- **Tool dock indicators**: toolchangers with per-tool presence switches
  (Gabe's has one per tool) get a Docked/Away indicator per tool, driven by
  a user-configured tool → sensor mapping (per-machine UI metadata, like
  axis roles). Honest semantics: the sensor knows docked, not mounted —
  never claim more. Cross-checks feed the preflight strip: tool selected
  while still reading docked = failed pickup (crash risk); no tool selected
  but one reads away = tool unaccounted for. Machines without sensors get
  no column — no fake data.

## States to design later

- Idle / halted / paused badge variants (badge border color follows state).
- Heater fault: row gets `--fault` treatment (mock-duet has a fault scenario).
- Disconnected: status strip goes `--fault`, cards dim — never a modal wall.
