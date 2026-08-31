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

---

# Addendum — select + toggle (GIT_194, increment 2 of #194)

The two remaining control kinds. Same rule as increment 1: every choice
derives from an existing convention, cited, and both land the full vertical
in one change.

## A1. select — an INPUT kind, not a control

Two shapes were on the table: (a) a new input kind whose labeled options
stage a value for templates, or (b) a control leaf that emits on selection.
**(a), decided by the 1:1 rule and composition:**

- *Emit-on-selection already exists*: a row of `gcode-button`s IS an
  enumerated choice that emits — and each button wears exactly the command
  it will send (I15). A dropdown that emitted on selection would duplicate
  that power while wearing its command WORSE: the command a pick will send
  cannot be on screen before the list is open.
- *Labeled staging does not exist*: `chips` stages bare numbers
  (`spec.ts:36-40`). The missing power is options with LABELS and — the
  real capability gap — **string values** (a macro name, a named mode),
  staged once and consumed by any number of buttons/sliders/toggles via
  `{input.name}`. An input composes with every emitter; a control composes
  with nothing.

Authored form (in `inputs`, beside `number`/`chips`):

```json
"mode": { "kind": "select", "label": "Mode", "default": 0,
  "options": [ { "label": "Off", "value": 0 }, { "label": "Half", "value": 0.5 },
               { "label": "Full", "value": 1 } ] }
```

Rendered as a **dropdown** — the house element for enumerated choice with
labels (`<select class="fb-input">`, the studio's own kind/variant pickers,
`CardStudio.tsx`). Chips stay the compact segmented style for BARE numeric
presets; a select is precisely the case where the value needs a name, which
is what a dropdown's rows give and a chip row does not. The renderer stages
by option INDEX (the `<option>` carries the index, the store receives
`options[i].value`), so a numeric value stages as a number and a string as
a string — never the DOM's stringification.

**The line-count invariant, restated.** `operator-input-cannot-add-a-line`
(`spec.ts`) was rung 8 by "every stageable value is a number". String
option values change its mechanism, not its truth: every string an operator
can stage is one the AUTHOR enumerated, admitted only after
`compileControlSpec` — the sole constructor of the branded compiled spec —
has refused control characters in it (same refusal `gcodeQuote` applies at
`control/commands.ts:141`: a newline has no escape in RRF, so it is
rejected, not encoded). The operator still has no free-text path: there is
no free-text kind, and the dropdown stages by index. Compile also requires
at least one option and `default` ∈ option values (spec coherence at the
boundary, like `min < max` — not a GUI safety).

**Numeric-only bindings hold.** `jog-pad`/`axis-jog` step+feed and
`slider.input` bind value SPACES that must be numeric (they feed `cmd.jog`
and an HTML range). Compile rejects binding them to a select that lists any
string value (`isNumericInput` in spec.ts); a select whose options are all
numbers binds anywhere `chips` could.

**Review** (`share.ts`): a select never emits, so it is not a Sends
category — but its STRING values interpolate into templates verbatim,
expanding what a reviewed template can say beyond digits. `SpecReview`
gains `selects` (input name + full labeled option list), rendered by
`ImportReview` — accepting a card still means having seen every command it
can emit, including every author-enumerated string a placeholder can become.

**Form**: select inputs are JSON territory (`tryFromSpec` → null, same rule
as forEach/grid/jog): the studio's input row is a flat line of scalar
fields, and a labeled option list cannot ride in it without approximating —
null over approximation.

## A2. toggle — a two-state control that reads the board and emits the alternative

```json
{ "type": "toggle", "om": "fans[0].requestedValue", "label": "Part fan",
  "whenOn": "M106 P0 S0", "whenOff": "M106 P0 S1", "stamp": true }
```

- `om` (required): the existing selector grammar — the toggle's state comes
  ONLY from the polled object model. There is no internal latched boolean
  anywhere: the board is the authority, so the control converges to reality
  when a command fails, is overridden by a macro, or the state changes from
  another client — for free, because there is nothing else it could show.
- **Truthy mapping** (`toggleStateOf`, one pure pipeline in
  `compose/controls/toggle.ts`, the `formatReadoutValue` precedent):
  `undefined`/`null` and non-leaf values (object/array — a toggle binds a
  leaf) → **unknown**; otherwise JS truthiness on the leaf: `false`, `0`,
  `""` → **off**, everything else → **on**. Documented consequence: bind
  numeric/boolean leaves (`fans[0].requestedValue`, `state.atxPower`); a
  STATUS STRING like "off" is truthy and the wrong binding for a toggle.
- `whenOn` / `whenOff` (required): templates through the one compile
  boundary. `whenOn` is what activation sends while the state IS on (i.e.
  the turn-off command), `whenOff` the converse. 1:1 rule intact: each
  press sends exactly one author-written template, chosen by reported
  state; no GUI verdict intervenes.
- `label` (optional): a template, the readout/row precedent.
- **Worn command** (GcodeButton's title discipline, `GcodeButton.tsx:163`:
  title/stamp show exactly what THIS press sends): the toggle wears the
  live-resolved ACTIVE alternative. Both raw templates are what the import
  review shows (`toggles` category — it is an emitter, both alternatives
  reviewable like any button's template); the control itself wears the one
  the next press will send.
- **Unknown state is inert and reserved**: before the first poll lands (or
  on a selector that reads nothing) the control renders an indeterminate
  appearance in the same geometry — centred hollow thumb, placeholder in
  the word and stamp slots — and activation does nothing, because neither
  alternative is truthfully "what this press sends". That is representation
  honesty (the 1:1 rule with no state to be 1:1 WITH), not a GUI safety;
  the moment the OM reports a leaf, it is live. `aria-pressed` mirrors
  on/off/`"mixed"`.
- Send/ack: one send per activation press (native button semantics), via
  the same guarded connector, colour-only feedback on fixed geometry. The
  send/ack state machine is extracted to `sendFeedback.ts` and shared by
  the slider and the toggle (the tripwire: a third hand-rolled copy inside
  ControlList would have been the second paste) — a rung-5 shared helper
  with its promotion path named in the file.

## A3. Verticals

Same slices as increment 1: `spec.ts` union + sole-boundary validation
(path-named), `parse.ts` untrusted cases, `ControlList.tsx` cases behind
the same `unreachable` weld, `formModel`/`CardStudio` (toggle lifts fully;
select refuses), `share.ts` review + `ImportReview` sections, docs, and
red-first tests in control-spec/custom-cards/share suites. Mock parity:
the toggle demo binds `fans[0].requestedValue` — mock-duet already applies
`M106 P S` to it (`gcode.ts:178-184`, `M107` at 217) and projects it in the
live poll (`model-query.ts:140-144`), so no mock change is required; the
UAT drives that exact path.
