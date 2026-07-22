# Composable Cards — architecture design

**Status:** ratified 2026-07-23 (Gabe: instances, persistence, migration, v1 scope
decided; control types added to scope). Supersedes the fixed-view architecture.
**Method:** cant-break-by-design — every invariant below names its enforcement
rung; grounded in a six-agent code sweep (2026-07-23) of all views, the panel
system, persistence, cards, the Card Lab, and cross-card couplings.

## Why

1. **The north star widened** (Gabe, 2026-07-22): from "an appliance control
   plane" to "a system that produces a coherent appliance per machine type."
   Machine diversity (FFF / CNC / laser) becomes compositions of one foundation,
   not hardcoded mode branches.
2. **The duplication already exists.** The sweep found the fixed-view design at
   rung 0–1 everywhere: 9 copies of canvas boilerplate, 8 layout toolbars, 8
   Console+Camera tails, visibility conditions encoded 2× (6 cards) and 3×
   (camera), every card's natural size stated in ≥2 places, ROUTES/NAV/Switch
   triple-synced by hand, the Card Lab keeping a private parallel registry.
3. **Shareability** (screens, cards, controls) requires data-not-code as a
   structural property, not a review rule.

## Decisions (ratified)

| Decision | Choice |
|---|---|
| Instances per card per screen | **One** — composition keyed by CardId; duplicates unrepresentable. Type widenable later without breaking stored data. |
| Persistence | **All to SD via the config overlay** (screens + geometry). localStorage remains the cache tier. Layout edits update overlay+cache immediately; SD upload stays explicit/batched (weak RRF server — no chatty uploads on drag). |
| Existing layouts | **Migrate** — parse `dwc-ng.canvas.*` (v3 envelope) into per-screen compositions on first load. |
| v1 scope | **Picker + screens** — add/remove cards, create/rename/hide screens, nav derived from the screen list. Control types follow; export/share last. |

## Architecture: four registries, one renderer

### 1. Card registry (`compose/cards.tsx`)
`defineCard()` is the sole constructor of a `CardDef`:

- `title / ariaLabel / tip / class / orientationToggle` — chrome, declared once.
- `size: {colSpan, rowSpan}` — THE single source of natural geometry
  (deletes the 9-place per-view/lab tables).
- `visibleWhen?(ctx)` — ONE predicate driving BOTH the JSX mount and the
  canvas `isActive` cell-release (deletes the dual/triple encoding).
- `needs?: ServiceId[]` — typed service dependencies.
- `body(ctx)` — **content-only**. The renderer provides the single `<Card>`
  wrapper from the def (normalizes the self-carding vs content-only split and
  removes panel-id literals from component bodies).

`CARDS = { position: defineCard(...), ... }`;
`type CardId = keyof typeof CARDS`. Runtime strings pass `parseCardId()` or
cease to exist (parse, don't validate).

### 2. Service registry (`compose/services.ts`)
The sole home of inter-card state (the sweep's five coupling mechanisms):

- `jobsBrowser` — file browser (0:/gcodes, recent) + selected + info→thumb
  resources + downloading.
- `macrosBrowser` — browser (0:/macros) + selected + armed + autoConfirm.
- `sysBrowser` — browser (0:/sys) + selected.
- `heightmap` — height-map store + selected cell + message + probe transaction
  + the connection-gated load lifecycle (moves INTO the factory).
- `layers` — layer stats/chart memos.

The composer creates each service **once per screen, only when a present card
needs it**, and passes it by reference. Cards receive services through typed
ctx; there is no other constructor — two cards cannot disagree about "which
file is selected."

### 3. Screen registry + user screens (`compose/screens.ts`)
Built-in screens become data: `machine: { name, cards: {position: rect, ...} }`.
User screens are overlay entries `{ id (minted, stable), name, cards }`.
Nav rail, hash router, and renderer all derive from the one screen list.
Built-ins are immutable defaults; rename/hide/reorder and user screens are
overlay operations; reset drops the overlay (the existing config philosophy,
third application).

### 4. Control-type registry (`compose/controls/`) — phase B
Control *types* are compiled (`jog-pad`, `axis-jog`, `probe`, `gcode-button`,
`slider`, `toggle`, …): one trusted renderer each. Control *instances* are data:
`{ type, config, template }`. Param sources: `static` | `input` (operator fills
at click) | `om` (selector read) | `forEach` (instantiate per OM collection
entry — e.g. one jog row per visible axis). In-repo precedents:
`control/GcodeButton.tsx`, `config.bed.probePointCommand` ({x}/{y} template),
`control/SpeedSlider.tsx`. Built-in Control-view cards convert to these
primitives first (dogfood), then user-authored custom cards, then sharing.

### The renderer (`compose/ComposedView.tsx`)
The single route from composition → screen: derives panel defaults from
`CardDef.size`, derives `isActive` from `visibleWhen`, provisions services from
the union of `needs`, wraps each body in the one `<Card>`, hosts the layout
toolbar + picker. Keyed rendering preserves instance identity for untouched
cards (GcodeViewer/FileEditor hold heavy Worker/Three/CodeMirror lifecycles —
composition edits must not remount them).

## Invariants

| # | Invariant | Construction | Rung |
|---|---|---|---|
| I1 | A screen can only render registered cards | `CardId = keyof CARDS`; `parseCardId` at boundaries | 8 |
| I2 | No duplicate card on a screen | Composition is `Partial<Record<CardId, Slot>>` | 8 |
| I3 | Mount gate and cell-release can never disagree | Both derive from `CardDef.visibleWhen` | 8 |
| I4 | One source of natural geometry | `CardDef.size`; screens only place | 8 |
| I5 | Context-carrying cards can't exist without context | `needs` typed; composer provisions or card can't mount | 7 |
| I6 | Shared artifacts are data, not code | Export format has no field that can encode code | 8 |
| I7 | No card bypasses the write guard | Sole guarded connector in ctx (preserved) | 7 |
| I8 | One view renderer | `ComposedView` is the only composition→screen route | 7 |
| I9 | Nav/router/renderer agree on screens | All derive from the one screen list | 8 |
| I10 | Rename can't orphan layouts | Bindings key stable minted id; name is a label | 8 |
| I11 | User screens can't shadow built-in routes | Slugs parsed against the reserved namespace | 7–8 |
| I12 | Built-ins immutable; user changes are overlay | Config-overlay model, reset = drop | 8 |
| I13 | Control instances only of compiled types | `ControlTypeId = keyof CONTROL_TYPES` | 8 |
| I14 | OM bindings are selectors, never executable | Branded `OmSelector` grammar with no call/eval form; total read-only evaluation | 8 |
| I15 | Emitted G-code visible before send | The shared control renderer is the choke point | 7 |
| I16 | Control sends only via guarded connector | Renderers receive `ctx.connector`; no other path | 7 |

## Corrections the sweep demands

- **`mergeCanvas` discard-all-on-collision is unacceptable** once users
  compose: adding a card must auto-place into free space (first free row),
  never wipe a stored layout.
- **Settings' save-bar** (view chrome outside the canvas) becomes a card.
- **The "3-tier device/SD layout system" does not exist** (memory was wrong);
  the SD tier for screens/layouts is NEW work riding the config overlay.
- Editor's two-personality slot (placeholder Panel vs FileEditor sharing id
  `editor`) becomes one card body with an internal `Show` on the service's
  selection.
- Connection gating becomes uniform: a `connected` flag in ctx; cards declare
  their gate rather than five ad-hoc encodings.

## Phased plan (each step green + committed; A/B render checks per conversion)

A1. Core types: composition schema, parse/serialize, CardId, tests (pure).
A2. Card registry with Machine's 7 cards as content-only bodies.
A3. `ComposedView`; convert **Machine** (no services) — A/B verify.
A4. Convert **Activity**, **Control** (extract inline cards; controls stay
    hand-written until phase B).
A5. Service registry; convert **Jobs, Macros, System, Bed**.
A6. Convert **Settings** (+ save-bar card).
A7. Screens-as-data: derive nav/router; user screens, rename, hide; SD
    persistence via config overlay; migrate `dwc-ng.canvas.*`.
A8. Picker UI (add/remove cards, create screens).
A9. Card Lab consumes the registry (delete LAB_CARDS/LAB_DEFAULTS).
B1. Control-type registry + OM selector language + convert Control's cards to
    primitives.
B2. Custom user cards (control lists) in the picker.
B3. Export/import (screens, cards) — data-only format, G-code review on import.
