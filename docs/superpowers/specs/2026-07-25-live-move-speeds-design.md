# Live move speeds — requested, top, extrusion/flow

**Date:** 2026-07-25
**Status:** approved (design), not yet implemented
**Parity gap:** `docs/dwc-parity.md` §4 — DWC's Status-panel "Speeds" block has no
dwc-ng equivalent. Reported by Gabe as "the one critical missing piece."

## Problem

`move.currentMove` has been arriving in the store since the connector was
written and nothing renders it. It is part of the `d99fn` live query
(`PollConnector.ts:111`, 500 ms interval; confirmed present in the real-board
capture `packages/mock-duet/captures/duet3-real-2026-07-15/model/live-d99fn.json`),
and the live patch is deep-merged into the OM store on every poll. So the gap
is entirely in the UI layer: no connector, poll, or seqs work is required.

DWC shows this as a "Speeds" category directly beneath the axes/extruders block
of `StatusPanel.vue` (`reference/dwc/src/components/panels/StatusPanel.vue:114-159`),
with three cells: Requested Speed, Top Speed, and Extrusion Rate — the last
click-toggling to volumetric flow in mm³/s.

### What the values actually mean

Verified 2026-07-25 against the RRF Object Model Documentation wiki (the 3.6
revision, matching our pinned line). Neither the vendored class
(`reference/objectmodel/src/move/index.ts:13-20`) nor
`reference/rrf-m409-object-model.md` carries field descriptions, so the wiki is
the authority here. Documented verbatim:

- `requestedSpeed` — "Requested speed of the current move (in mm/s)". This is
  the feedrate the move asked for, after `M220`.
- `topSpeed` — "Top speed of the current move (in mm/s)". The speed actually
  achieved on the move being executed.
- `extrusionRate` — "Current extrusion rate (in mm/s)". Filament consumption,
  not nozzle travel.

**There is no instantaneous-velocity field.** RRF exposes requested and
achieved, and nothing else; `topSpeed` is the closest thing to "actual" that
the firmware reports, and is what DWC labels "Top Speed". Because the poll
re-samples at 500 ms while the machine retires many moves per second, the
reading behaves as a live achieved-speed trace during a print — it will be
noisy on short segments, which is a faithful report of the machine genuinely
slowing for them.

The gap between requested and achieved is the useful signal: it shows when
acceleration limits, cornering, or short segments stop the machine hitting its
commanded feedrate.

**Label decision (Gabe, 2026-07-25): cell 2 is labelled `Actual`, not DWC's
"Top Speed".** The value is re-sampled every poll and is the speed the machine
is achieving right now, so "Top Speed" mis-describes it as a high-water mark —
a reader would reasonably expect a number that only ever climbs. `Actual` says
what it is. The underlying field is still `topSpeed`, and traceability is
preserved two ways: the card tip lists `move.currentMove`, and the cell carries
a `title` naming `move.currentMove.topSpeed`. This is a deliberate, recorded
divergence from DWC's wording, not an oversight.

### Path and nullability, verified

- `currentMove` sits at **`move.currentMove`** on our pinned 3.6 line, not
  `move.motionSystems[].currentMove` (a newer-OM arrangement that some search
  results describe). Confirmed twice: the vendored class
  (`reference/objectmodel/src/move/index.ts:43`) and the real board capture,
  whose `move` object has no `motionSystems` key.
- The shape authority declares `acceleration`, `deceleration`,
  `extrusionRate`, `requestedSpeed` and `topSpeed` as non-nullable `number`
  defaulting to `0`; only `laserPwm` is `number | null`. So the firmware's own
  contract is that these are always numbers when the subtree is present —
  see the note under I-D on what that means for the em-dash case.

## Decisions

| Question | Decision |
|---|---|
| Placement | A footer row on the **Position card**, mirroring DWC's own IA (speeds sit under the DRO). Not a separate registry card — no extra card to place on every screen, and it is the same "what is the machine doing right now" glance. |
| Fields | All three, with the volumetric-flow toggle (full DWC parity). |
| Card height | Bump the **default** `rowSpan` in `compose/defs.ts` so fresh installs and *Reset layout* are correct. No migration of saved overlays. |

## Invariants

Per `cant-break-by-design`, named in both directions.

### Touched (existing, currently under-enforced)

**I-A: no unvalidated number reaches a rendered speed string.**

`conform`'s `move` case currently waves the nested object through unchecked
(`om/types.ts:346`):

```ts
currentMove: isObject(value.currentMove) ? value.currentMove : d.currentMove,
```

The fields are *typed* `number` but never *checked*, so a board sending a
string reaches `.toFixed()` and throws.

**Correction, found while planning (2026-07-25): `conform` is NOT the OM's
single entry.** Its own doc comment describes it as "the per-key shape gate at
the OM's single entry," which holds for authoritative subtree replacement but
not for live patches. `store.ts:89-91` routes the `d99fn` live patch straight
into `deepMergeInto` without ever calling `conformModelKey`:

```ts
onModelPatch(patch) {
    setOm(produce(draft => deepMergeInto(draft as Record<string, unknown>, patch)));
},
```

`currentMove` is updated *predominantly* by that live path — it is why the
value ticks at 2 Hz at all. So hardening conform alone would leave the hot
path unguarded. Two ingress routes, one gate.

Gating the second route is the wrong fix: `conformModelKey` is per-top-level-
key, and a sparse nested patch has no such shape. **Enforcement belongs where
the two routes reconverge — the render derivation.** `speedRow()` (component
2) is the sole producer of rendered speed text, so it accepts its inputs as
`unknown` and parses them. Both ingress routes are then covered by one choke
point, whatever shape the data arrived in.

Concretely:

- `numberOrNull` is exported from `om/speeds.ts` — one implementation.
- `speedRow()` parses every value through it. This is the enforcing gate: a
  card cannot obtain a speed string except from `speedRow`.
- `conform`'s `move` arm uses the same helper for the refetch path, so the
  store's own shape matches its declared type. This is defence in depth and a
  correctness fix for the store, not the render guarantee.

Note that DWC's `isFinite()` guard would not be a correct thing to copy:
`isFinite(null) === true` in JS, because `null` coerces to `0`. A board
reporting `null` renders as `0.0` in DWC, indistinguishable from "genuinely
stopped."

### Introduced (new, this feature's own output)

**I-B: the speeds footer always occupies exactly three fixed slots.** A row
that gains or loses cells as machine state changes would reflow the card —
directly against the project's primary positional-stability rule. Enforced by
the derivation returning a fixed 3-tuple, so "two cells" and "four cells" have
no representation.

**I-C: volumetric flow is derived, never stored.** One computation site, at use
time, so it cannot drift from the `extrusionRate` it is derived from.

**I-D: "not reported" and "zero" are different values.** `null` renders as an
em-dash; `0` renders as `0.0`.

Scope note: the firmware declares these fields non-nullable with a `0` default
(see "Path and nullability, verified"), so a connected board reporting the
subtree always sends numbers. The `null` case therefore covers only the states
where the field genuinely is not there — before the first full sync, on a
partial patch that omits it, or from a board older than our pinned line. It is
kept because rendering `0.0` in those states asserts "the machine is stopped"
on no evidence, which is the same class of error as DWC's `isFinite(null)`
hole. It is not expected to be visible during normal operation.

## Components

### 1. `packages/ui/src/om/types.ts` — parse boundary

Widen the type to admit the honest absent case, and add the third field:

```ts
currentMove: {
    requestedSpeed: number | null;
    topSpeed: number | null;
    extrusionRate: number | null;
};
```

Defaults in `emptyModel()` become `null` (currently `0`, which asserts
"stopped" before the first poll has landed).

Import `numberOrNull` from `om/speeds.ts` (one implementation — see I-A) and
use it per field in the `move` conform arm, replacing the pass-through:

```ts
currentMove: {
    requestedSpeed: numberOrNull(rawCurrentMove.requestedSpeed),
    topSpeed: numberOrNull(rawCurrentMove.topSpeed),
    extrusionRate: numberOrNull(rawCurrentMove.extrusionRate),
},
```

This fixes the store's shape on the refetch route. It is **not** the render
guarantee — that lives in `speedRow` (I-A), because the live-patch route never
reaches this function.

No other code reads `currentMove` today, so the type widening is free.

### 2. `packages/ui/src/om/speeds.ts` — the single derivation (new)

The only place OM values become display text.

```ts
export type FlowMode = "linear" | "volumetric";

export interface SpeedCell {
    key: "requested" | "actual" | "flow";
    label: string;
    value: string;   // already formatted, including the em-dash for absent
    unit: string;
    /** OM path, for the cell's title attribute. */
    source: string;
}

/** Exactly three cells, always — see I-B. */
export type SpeedRow = readonly [SpeedCell, SpeedCell, SpeedCell];

/** The enforcing gate for I-A — parses, never trusts. */
export function numberOrNull(value: unknown): number | null;

export function speedRow(om: ObjectModel, mode: FlowMode): SpeedRow;
```

`speedRow` takes `ObjectModel` (the open `KnownModel & Record<string, unknown>`)
and reads `currentMove`'s fields as `unknown`, parsing each through
`numberOrNull`. It does not rely on the declared `number | null` type being
true, because the live-patch route can violate it (I-A).

Behaviour:

- `null` → `"—"`; a number → one decimal place.
- Cell 1 — `requestedSpeed`, label `Requested`, unit `mm/s`.
- Cell 2 — `topSpeed`, label **`Actual`**, unit `mm/s`.
- Cell 3 depends on `mode`:
  - `"linear"` → `extrusionRate`, unit `mm/s`, label `Extrusion`.
  - `"volumetric"` → `area × extrusionRate`, unit `mm³/s`, label `Flow`,
    where `area = π (d/2)²` and `d` is
    `move.extruders[tool.filamentExtruder].filamentDiameter` for the tool at
    `state.currentTool`.
- Volumetric with no current tool, no filament extruder, or a missing/zero
  diameter → `"—"`. We do not fall back to the linear value, which would
  silently show a mm/s number under a mm³/s unit.

Our `Tool` type carries a single `filamentExtruder` index rather than DWC's
`extruders[]` + `mix[]` arrays, so the mix-ratio averaging in
`StatusPanel.vue:286-311` has no analogue here — one tool, one extruder.

### 3. `packages/ui/src/shell/speedFlowMode.ts` — the toggle's state (new)

localStorage-backed, modelled on `shell/panelOrientation.ts`: a tolerant
`parseSpeedFlowMode` that yields the default on anything unexpected and never
throws.

Deliberately **not** part of `UiConfig`. That overlay persists to
`0:/sys/dwc-ng-config.json` and drives the dirty/save cycle
(`config/types.ts:149-171`); a display-unit preference should not mark machine
config unsaved, and it is per-browser rather than per-machine.

### 4. `packages/ui/src/cards/PositionCard.tsx` — the footer

One row below the DRO, rendered in both the vertical and horizontal
orientations (the card supports `orientationToggle`). Structure follows the
existing `.dro-row` idiom, whose CSS already documents the fixed-slot rule
(`app.css:455-465`: *"a fixed slot keeps the value's right edge rock-steady"*).

- `<For each={speedRow()}>` over the 3-tuple.
- `font-variant-numeric: tabular-nums` and a fixed-width value slot, so digits
  changing at 2 Hz cannot shift anything.
- Cell 3's label is a real `<button>` toggling the mode — not DWC's
  `<a href="javascript:void(0)">`.
- Per `solid-patterns`: no destructuring, `<Show>`/`<For>` only.

### 5. `packages/ui/src/compose/defs.ts` — card metadata

- `tip`: `"move.axes"` → `"move.axes · move.currentMove"`.
- `size.rowSpan`: currently `95` (= 380 px at `ROW_UNIT_PX = 4`,
  `panelCanvas.ts:33`). The footer adds roughly one `.dro-row` band, ~9–10
  units.

  The value will be **measured, not guessed**: `panelCanvas.ts:264` provides
  the smallest `rowSpan` that still contains a card's content, read from the
  DOM. Build the footer, read the measured minimum in the browser, set the
  default to it. This keeps the default derived from the rendered content
  rather than a hand-maintained second copy of "how tall is this card" that
  drifts whenever the DRO's type sizes change.

  Saved layout overlays keep their stored `95` and will clip the footer until
  the card is resized once by hand. Accepted: no migration code, and nothing
  silently rewrites a user's saved layout. (A migration was considered and
  rejected — `panelCanvas`'s collision rules can refuse the grow when a card
  sits directly below, in which case it would clip anyway, silently.)

### 6. `packages/ui/src/dev/cardScenarios.ts` — card-lab fixtures

The lab's model stub (`cardScenarios.ts:73`) pins `currentMove` to zeroes, so
the Card Lab would show a permanently dead footer. Give the printing scenarios
live-looking values (requested above top, a non-zero extrusion rate) and leave
the idle scenario at `null` so both the em-dash and the numeric rendering are
reachable without a machine.

## Testing

`packages/ui/test/speeds.test.ts`:

- **The I-A red-check:** a value that arrived via the live-patch route as a
  string (`requestedSpeed: "fast"`) renders as `"—"` and does not throw. Drive
  this through `createOmStore().events.onModelPatch(...)` specifically, not
  `onModelKey` — `onModelPatch` is the route that bypasses conform, so a test
  written against `onModelKey` would pass while the real hot path stayed
  broken.
- `null` values render as `"—"`, not `"0.0"` (I-D).
- Numbers render at one decimal place.
- Volumetric derivation against a hand-computed value for 1.75 mm filament.
- Volumetric with no current tool / no filament extruder / zero diameter →
  `"—"`, and specifically *not* the linear number.
- The returned row has length 3 in every case above (I-B).

`packages/ui/test/om-conform.test.ts` (extend the existing `currentMove` case
at line 64):

- A board sending `{ requestedSpeed: "fast" }` conforms to `null`, not a
  string — the red-check being that without the fix this value reaches the
  formatter (I-A).
- A board omitting `currentMove` entirely still yields a usable `move`.

## Live verification

Per the standing rule that "verified" requires a check that could have failed,
the falsifying checks are:

1. Run a real job (or the mock's mid-print scenario) and confirm requested and
   top **diverge** during acceleration and cornering. If they track each other
   exactly at all times, the values are not being read live and the check has
   failed.
2. Change `M220` and confirm `requestedSpeed` moves with it.
3. Watch the footer at mobile width and during a live print for any horizontal
   shift as digit counts change (e.g. `99.4` → `100.0`).

## Out of scope

- Imperial units. DWC's `displayMoveSpeed` converts to ipm under a global
  units setting (`reference/dwc/src/utils/display.ts:110-115`); dwc-ng has no
  such setting and this feature does not introduce one.
- A speeds chart or history. This is a live readout only.
