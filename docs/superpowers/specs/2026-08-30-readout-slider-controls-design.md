# Readout + slider control kinds — design (GIT_194, increment 1 of #194)

Two new leaves in the closed control vocabulary
(`packages/ui/src/compose/controls/spec.ts:46`). Both land the full vertical
in one change: vocabulary + compiler + parse boundary + renderer + Card Studio
form + share review + tests + docs. Every choice below derives from an
existing convention, cited.

## 1. readout — a display-only OM value

Authored form:

```json
{ "type": "readout", "om": "heat.heaters[1].current",
  "label": "Nozzle", "unit": "°C", "decimals": 1 }
```

- `om` (required): the existing selector grammar (`omSelector.ts:47`,
  rung-8 bindings-are-not-executable — nothing new is added to the grammar).
- `label` (optional): compiled to a template, like `row.label`
  (`spec.ts:81-84` — a readout stamped inside a `forEach` can name its item).
- `unit` (optional): plain string suffix, rendered small like `.dro-val small`.
- `decimals` (optional): integer 0–8; numeric values render via `toFixed`.

Compiled form carries the branded `OmSelector` and `CompiledTemplate`, so the
renderer cannot receive an unparsed binding (`spec-compiles-whole`, rung 7,
`spec.ts:102`).

**Totality**: `formatReadoutValue(value, decimals)` in a new
`compose/controls/readout.ts` is the single formatting pipeline (renderer and
tests both import it — no second format site):

- `undefined | null` → `"—"` (reserved placeholder; the increment's
  "absent never collapses layout, never throws").
- finite `number` → `toFixed(decimals)` when `decimals` present, else
  `String(n)`; non-finite (`NaN`, `±Infinity`) → `"—"` (`toFixed` on a
  compiled-validated 0–8 can never throw).
- `string` → itself; `boolean` → `String(b)`.
- objects/arrays (a readout binds a leaf, not a subtree) → `"—"`.

**No jitter** (house rule, `.dro-h-val` precedent `app.css:630-650`): the
value span is `font-variant-numeric: tabular-nums`, display face, reserved
`min-width` in `--u`, right-aligned; the unit `<small>` is rendered whenever
`unit` is declared — including beside the placeholder — so nothing about the
box depends on the live value.

## 2. slider — a bound input emitting a template on release

Authored form:

```json
{ "type": "slider", "input": "speed", "min": 0, "max": 200,
  "step": 5, "template": "M220 S{input.speed}" }
```

- `input` (required): names a declared card input, exactly like
  `jog-pad.step` (`spec.ts:140-143`, `needInput`). The input def supplies the
  displayed label and unit — **derive, don't duplicate**: the slider adds no
  `label`/`unit` fields of its own.
- `min` / `max` (required numbers), `step` (optional, compiled default 1):
  finite, `min < max`, `step > 0` — validated once in `compileControlSpec`
  (the sole compile boundary both built-ins and `parse.ts` flow through), not
  a second time anywhere. These are the HTML range attributes, nothing more:
  no GUI clamping, no safeties — firmware is the authority.
- `template` (required): the existing template language (`template.ts:38`).
  Resolution reads the shared inputs store, so the emitted value is the
  dragged one.
- `stamp` (optional, default true): like `gcode-button.stamp` — the slider
  wears its LIVE-resolved command (I15) in the house mono style, updating as
  the handle moves, so what release will send is on screen before it is sent.

**Commit semantics** (read from `SpeedSlider.tsx:26-33` as precedent):
dragging updates only the card-local inputs store (worn stamps re-resolve
live, nothing is sent); the command is resolved and sent **once per completed
value-change gesture**, because RRF tolerates very few requests.

> **Fix round (review of increment 1).** The first cut wired
> pointerdown/keydown → grab and pointerup/keyup/change → release behind a
> `dragging` flag. Two defects, both traced: `change` fires on EVERY keyboard
> step of a range input and each auto-repeat keydown re-armed the flag, so a
> held arrow key sent one rr_gcode per step (~20/s); and any keyup while
> focused sent once armed — a Shift press could emit. Same wiring, same
> defects, in `SpeedSlider.tsx`. The mechanism is now the shared gesture
> machine `control/rangeGesture.ts` (pure reducer + timer wrapper), driven by
> BOTH sliders: keyboard events are not wired at all — only value changes
> open a gesture (pointer gestures complete on pointerup/pointercancel;
> keyboard ones settle 500 ms after the last change, or on blur), and a
> gesture whose final value equals its own start value sends nothing. The
> reference is the gesture's start, never a remembered "last sent" — the
> board can move between gestures, so any longer-lived latch would go stale.
> `range-gesture.test.ts` drives the reducer with the misfiring sequences
> (held-arrow burst → exactly one send; changeless press → zero) and locks
> the onSend-before-onActive(false) ordering SpeedSlider's follow-the-machine
> effect depends on.
Unlike SpeedSlider there is no follow-the-machine scale logic: the bound
value is a card-local input (like a step-size chip), not an OM mirror, so
none of the freeze/centre machinery applies. Send goes through
`useApp().connector.sendCode` — the same guarded route `GcodeButton.tsx:127`
uses, which is also why the Card Studio preview's provider swap
(`CardStudio.tsx:44-53`) makes a preview slider unable to reach the board by
construction. Feedback is colour-only on fixed geometry: value span flashes
sent/failed, plus a reserved visibility-toggled "refused" slot
(`SpeedSlider.tsx:196-199` precedent).

Range-input chrome CSS: the existing `.speed-input` pseudo-element rules are
the single source for house range styling; they gain `.ctl-range-input` as a
co-selector rather than being duplicated (tripwire: no pasted second copy of
the thumb/track rules). Thumb/track px freezes stay px (`px-ok: hit target`).

## 3. Boundary (`parse.ts`)

Field-by-field, path-named, never throws out of `parseControlSpecText`:
readout wants `om` string (+ optional `label`/`unit` strings, `decimals`
number); slider wants `input`/`template` strings, `min`/`max` numbers
(+ optional `step` number, `stamp` boolean). Semantic checks (selector
validity, decimals range, min<max, step>0, input existence, template
compile) live ONLY in `compileControlSpec`, which `parseControlSpecText`
already runs — one site serves untrusted JSON and built-ins alike.

## 4. Share review (`share.ts`)

- readout: its selector (and any `{om:…}` in its label) joins `omReads` — a
  readout is a read and nothing else, so no new category is minted for it.
- slider: a new `sliders` inventory —
  `{ input, template, min, max }` — because a slider is an EMITTER and its
  raw template must be reviewable like a button's (`SpecReview.buttons`
  precedent, `share.ts:36`). Template `{om:…}` reads join `omReads`.
  `ImportReview.tsx` renders the new section in the Sends style.
- Both cases are added before the `unreachable` weld (`share.ts:93`), which
  is what forces this file to move at all.

## 5. Card Studio form (`formModel.ts`, `CardStudio.tsx`)

`FormItem` gains `readout` and `slider` kinds; both lower in `toSpec` and
lift in `tryFromSpec`. Honesty: every authored field of both kinds is
representable in the form, so a row containing them lifts fully; nothing
about the existing null-returns (forEach/grid/jog/classes/top-level
non-rows) changes. The studio's row head gains "+ readout" and "+ slider";
the item editor becomes a `<Switch>` over the four kinds. A new slider is
seeded with the first declared input's name; a missing/renamed input surfaces
as the compile boundary's path-named error in the live preview — the form
does not re-validate (`formModel.ts:11-14` rule).

## 6. Tests (TDD — red first)

- `control-spec.test.ts`: compile accepts both kinds (slider step defaults
  to 1); rejects readout bad selector / decimals 9, 1.5, −1; slider unknown
  input / min ≥ max / step ≤ 0 / bad template — all with path-named errors.
  `formatReadoutValue` totality table. `extractButtons` gains the two cases
  plus the same `unreachable` weld the renderer uses, so the NEXT variant
  fails compile here too.
- `custom-cards.test.ts`: both kinds through `parseControlSpecText`
  (accept + named type errors); form round-trip with readout and slider
  items.
- `share.test.ts`: review inventories a slider's raw template under
  `sliders` and a readout's selector under `omReads`.

## 7. Mock parity

Nothing new touches the wire: a readout renders the already-polled OM; a
slider emits a user-templated code through the same `rr_gcode` path every
gcode-button already uses, which mock-duet already accepts and echoes.
Verified against the mock during UAT (M220 via a slider; a live
`heat.heaters[1].current` readout) rather than asserted from prose.

## 8. Docs

`docs/authoring-cards.md` node table + examples gain both kinds.
