# Authoring cards, buttons, and control types

How to add UI to dwc-ng after the composable-cards conversion
(docs/composable-cards-design.md). Three grains, from no-code to
vocabulary-extension. **Every path ends at the same two choke points:**
G-code leaves only through `GcodeButton` → the (write-guarded) connector,
and G-code *forms* come from `control/commands.ts` or are welded to it by
tests — verified against `reference/duet-gcode.md` (use the `duet-gcode`
skill), never recalled from memory.

## 1. A data card — in the UI, no code

For any card that is fundamentally *controls that send G-code*.

Any screen → **⊞ Compose → + New card** opens the **card studio**: a form
editor (name, inputs, rows of buttons) with a **live preview** — the real
renderer with pointer events off, so you watch the buttons wear their
resolved G-code as you type, and nothing can send from a preview. **Insert
example** seeds a working spindle card. **Edit as JSON** toggles to the raw
spec for the power vocabulary (forEach, grids, jog primitives); the form
and the JSON edit the SAME spec, and a spec the form can't show refuses to
lift rather than approximating — saving from the form can never silently
drop structure. Everything saves through the one untrusted boundary, so
the studio cannot author anything an import file couldn't say.

The saved card lands on the current screen and appears under **Your
cards** in every screen's drawer (checkbox to add/remove per screen, Edit,
✕). A card that later breaks shows an error body naming the problem —
never a broken screen. Custom cards live in the config overlay: **unsaved
until "Save to machine"** (Settings → the Configuration card). **Reset
everything does NOT delete them** — it resets overrides (settings,
renames, hides, layouts) while creations survive; a custom card or screen
is only removed by its own explicit ✕/Delete.

### Card metadata: size, tip, padding

A custom card's definition carries optional metadata beside its spec
(#194 inc 4) — card chrome, not spec content, so it never rides the spec
JSON and never affects what the card can *do*:

- **Authored size** (`colSpan`/`rowSpan`, grid cells): the card's default
  footprint — what it places at when added to a screen, exactly as a
  registry card places at its natural `size`. The measured content floors
  still govern minimums, and an already-placed card keeps the geometry the
  operator gave it; the authored size applies on ADD.
- **Tip** (`tip`): the CardTip text (click-to-copy, like every registry
  tip — name what powers the card, e.g. `state.status · M300`). Absent =
  the stock `custom card` tag. Provenance lives in the import review's
  complete inventory, not in the tip.
- **Padding** (`padding`, a number of `--u` units): uniform card-body
  padding, rendered as `calc(n * var(--u))` so it scales with everything
  else. Absent = the house padding.

All three are optional overlay data: reset semantics, share/import and
Save-to-machine treat them exactly like the rest of the definition, and a
config written before they existed reads identically to today.

### Authoring from the Card Lab (dev builds)

The Card Lab (nav → **Card Lab**) is the authoring *bench*: its
**+ New card** pill opens the same studio, and your cards appear as
dashed pills beside the registry cards (**✎ Edit** when featured). The
difference from authoring on a screen: the studio's preview and the bench
resolve `{om:…}` template reads against the lab's **synthetic scenario
model** — so a card that reads machine state can be exercised against
printing / paused / heater-fault / multi-tool states no real machine
produces on demand, before it ever touches a screen. A card created here
lands featured on the bench (not on any screen); add it to screens later
via any compose drawer.

### The spec vocabulary

```json
{
	"inputs": {
		"temp": { "kind": "number", "label": "°C", "default": 220 },
		"len":  { "kind": "chips", "label": "Purge", "default": 50, "options": [10, 50, 100], "unit": "mm" }
	},
	"nodes": [
		{ "type": "row", "label": "Purge", "items": [
			{ "input": "temp" },
			{ "input": "len" },
			{ "type": "gcode-button", "label": "Heat",  "template": "M568 P0 S{input.temp} A2" },
			{ "type": "gcode-button", "label": "Purge", "template": "M83\nG1 E{input.len} F300", "variant": "go" }
		]}
	]
}
```

**Inputs** (shared live values, referenced by name):
`number` (a small field), `chips` (a preset row of bare numbers, like
Movement's step sizes), or `select` (a dropdown of **labeled** options —
`"options": [ { "label": "Purge", "value": "purge" }, … ]` — whose values
may be strings, e.g. for `M98 P"/macros/{input.macro}"`). Select rules,
enforced at the one compile boundary: at least one option, `default` must
be one of the option values, and string values may not contain control
characters (a picked value can never add a line to a template). A select
whose options are all numbers can bind anywhere `chips` could; one that
lists any string value cannot bind jog `step`/`feed` or a `slider` (those
value spaces are numeric). Select inputs are edited as JSON — the form
refuses to lift them rather than approximating the option list.

**Nodes:**

| type | what it is | fields |
|---|---|---|
| `gcode-button` | a button wearing its command | `label`, `template`, `variant?` (`go`/`danger`/`quiet`), `stamp?` (false hides the mono code), `class?` |
| `jog-pad` | the cardinal XY pad + Z column | `step`, `feed` (input names) — emits via `cmd.jog` |
| `axis-jog` | one −/+ row for a loop axis | `axisVar`, `step`, `feed` |
| `readout` | a live OM value, display-only | `om` (selector), `label?`, `unit?`, `decimals?` (integer 0–8). Absent/null reads render a reserved `—`, never a collapse |
| `slider` | a range over an input; one send per completed gesture | `input` (input name — its label/unit label the slider), `min`, `max`, `step?` (default 1), `template`, `stamp?` (false hides the worn code). Never per pixel or per arrow step — the shared gesture machine settles a drag or a key burst into ONE send |
| `toggle` | a two-state switch that READS the board and sends the alternative | `om` (state selector — truthy leaf = on, `0`/`false`/`""` = off; absent/non-leaf/non-finite = unknown), `whenOn` (sent while on, i.e. the turn-off command), `whenOff` (the converse), `label?`, `stamp?`. State comes only from the polled OM (no internal latch — it converges when a command fails or the state moves externally); unknown renders indeterminate and is inert. Wears the ACTIVE alternative; bind numeric/boolean leaves, not status strings |
| `row` | a labelled flex row | `label?`, `sub?`, `class?`, `justify?`, `items` (nodes and/or `{ "input": name }`) |
| `grid` | equal-column button grid | `items` |
| `forEach` | stamp a node per OM item | `from` (selector), `as` (var name), `except?` `{prop, values}`, `enrich?` (`axisLabel`) |
| `columns` | split into weighted column tracks | `columns` (≥ 2 entries, each `{ weight?, justify?, nodes }` — `weight` an integer ≥ 1, default 1, an `fr` ratio), `rulers?` (hairline verticals between columns). Columns may not nest inside columns, at any depth |
| `group` | a labelled vertical cluster | `label?` (a template — forEach-stampable, like a row's), `class?`, `justify?`, `nodes` |
| `spacer` | authored gap — how alignment is written | `size?` (a number of u, > 0 — fixed gap; **absent = flexible**, takes the free space). Works in rows and stacks alike |

**Justify** (`"start" | "center" | "end" | "between"`, on `row`, `group`,
and each `columns` entry): distribution of the container's children along
its main axis — horizontal for a row, vertical for a group or a column.
It is a property of containers, never a node; the free space it
distributes is also authorable directly with `spacer` (a flexible spacer
between two items IS "push the rest to the far end"). Live values cannot
shift a justified layout: every control reserves its geometry
(tabular figures, fixed value slots), so a polled update changes no box —
only the model itself changing (a forEach stamping a new axis) reflows,
exactly as it always did. Note the entire node tree may nest at most 8
levels deep — past that the spec refuses to compile.

**Placeholders** (in `template` and `label`): `{input.name}` — an input's
live value; `{om:selector}` — an object-model read; `{var.prop}` — a
forEach item's property. The worn code re-resolves live as inputs change.

**Selectors** (the whole grammar — there is deliberately no more):
dot-separated identifiers, each with at most one bracket —
`move.axes`, `move.axes[3].letter`, `move.axes[visible]` (truthy filter),
`move.axes[letter=C]` (equality filter). No calls, no expressions: an
imported card can *read* the model and *emit templates*, and that is all it
can ever say.

The OM inspector (System → object model) writes selectors for you: every
node row has a copy affordance (`⧉`) that puts that node's selector on the
clipboard, ready to paste into a binding field. It copies indices only —
`heat.heaters[1].current`, never a guessed `[visible]`/`[letter=C]` filter;
hand-edit the pasted text when a filter is what you mean.

Tricks: `forEach` over an equality filter doubles as an existence gate (the
coupler row renders only when a C axis exists); `enrich: "axisLabel"` gives
axis items a `label` of letter + the user's role name.

A readout + slider row, e.g. speed factor with the nozzle temperature beside
it:

```json
{ "type": "row", "label": "Tuning", "items": [
	{ "type": "readout", "om": "heat.heaters[1].current", "label": "Nozzle", "unit": "°C", "decimals": 1 },
	{ "type": "slider", "input": "speed", "min": 0, "max": 200, "step": 5, "template": "M220 S{input.speed}" }
]}
```

The slider drags freely and resolves its worn command live, but nothing is
sent until the gesture completes — RRF tolerates very few requests, so it is
one command per gesture (a drag, or a settled run of arrow keys), exactly
like the Tuning card's speed slider. `min`/`max`/`step` are the range
control's attributes and nothing more: the firmware remains the authority on
what the sent value does.

A fan toggle plus a macro select feeding a button:

```json
{
	"inputs": {
		"macro": { "kind": "select", "label": "Macro", "default": "purge",
			"options": [ { "label": "Purge", "value": "purge" }, { "label": "Wipe", "value": "wipe" } ] }
	},
	"nodes": [
		{ "type": "row", "items": [
			{ "type": "toggle", "om": "fans[0].requestedValue", "label": "Part fan",
				"whenOn": "M106 P0 S0", "whenOff": "M106 P0 S1" },
			{ "input": "macro" },
			{ "type": "gcode-button", "label": "Run", "template": "M98 P\"/macros/{input.macro}\"" }
		]}
	]
}
```

The toggle shows the board's own state and sends the alternative for the
state it shows: while the fan runs it wears (and sends) `M106 P0 S0`. If the
command fails, or a macro flips the fan from elsewhere, the switch follows
the next poll — there is nothing else it could show. The import review lists
BOTH of a toggle's templates (it is an emitter with two alternatives) and
every select option value (string values reach templates verbatim).

A two-column card with a ruler, groups, and a spacer pinning a button to the
bottom of its column:

```json
{ "nodes": [
	{ "type": "columns", "rulers": true, "columns": [
		{ "weight": 2, "nodes": [
			{ "type": "group", "label": "Readouts", "nodes": [
				{ "type": "readout", "om": "heat.heaters[1].current", "label": "Nozzle", "unit": "°C", "decimals": 1 },
				{ "type": "readout", "om": "heat.heaters[0].current", "label": "Bed", "unit": "°C", "decimals": 1 }
			]}
		]},
		{ "nodes": [
			{ "type": "group", "label": "Actions", "nodes": [
				{ "type": "gcode-button", "label": "Home", "template": "G28" }
			]},
			{ "type": "spacer" },
			{ "type": "gcode-button", "label": "Motors off", "template": "M84", "variant": "danger" }
		]}
	]}
]}
```

The tracks split 2:1; the flexible spacer eats the second column's free
space, so "Motors off" sits at the bottom edge however tall the readout
column makes the card. Structural nodes never emit or read anything — the
import review of this card is exactly the review of the controls inside it.
(The built-in Movement card authors its own side column this way: a `group`
with `justify: "between"` keeps the coupler at the foot of the jog table.)

## 2. A registry card — in code

For cards that *render machine state* or need bespoke interaction (tables,
charts, file browsers, the firmware form). Three touches; the compiler
enforces all of them, and the card then appears automatically in every
screen's compose drawer and the Card Lab — there is no list to update.

1. **Body**: a content-only component (no `<Card>` wrapper, no panel id).
   Reads services via `useApp()` or the `ctx` prop.
2. **`compose/defs.ts`** (data half): a `defineCard({...})` entry — title,
   ariaLabel, tip, `size` (THE natural geometry), optional `visibleWhen`
   (drives both the mount and the grid cell-release), `orientationToggle`,
   `class`. `title`/`tip` may be `ctx => string` for dynamic text.
3. **`compose/cards.tsx`** (JSX half): `"my-card": { body: ctx => <MyBody/> }`
   plus optional `actions` (header controls).

If it should be default-on somewhere, add a slot to that screen's
composition in `compose/screens.ts`. Cross-card shared state goes in a
service (`compose/services.ts`), reached via `ctx.service(id)` — never a
module-level signal.

## 3. A one-off button inside a code card

```tsx
<GcodeButton label="Park" command={cmd.park()} variant="go" />
```

`GcodeButton` is the primitive everything routes through. The command
string comes from a builder in `control/commands.ts` (the 1:1 authority),
its form verified against the reference via the `duet-gcode` skill.

## 4. A new control TYPE — extending the vocabulary

When data cards need a control that doesn't exist yet (a slider, a toggle):

1. **`compose/controls/spec.ts`** — add the variant to `ControlNode` (+ its
   `CompiledNode` form and a `compileNode` case).
2. **`compose/controls/parse.ts`** — a `validateNode` case, or imported
   cards can't use it.
3. **`compose/controls/ControlList.tsx`** — the renderer case. Buttons go
   through `GcodeButton`; motion through `control/commands.ts` builders.

The switches are exhaustive with no default arms — adding the union member
turns every un-updated site into a compile error. When it compiles, every
spec (built-in, user, imported) can use the new type. What a type may do is
a review decision: it is a compiled capability data can *select*, never
*define*.

## Sharing cards and screens (export/import)

- **Export a card**: ⊞ Compose → Your cards → **⤓** — downloads
  `<name>.dwcng-card.json`. **Export a screen**: the **⤓ Export** button by
  the screen name — downloads `<name>.dwcng-screen.json` with the layout,
  the built-in card ids, and the full definitions of every custom card it
  uses (self-contained).
- **Import**: ⊞ Compose → **⤒ Import** → pick a file. The **review** opens
  first: because the vocabulary is closed, it lists EVERYTHING the file can
  do — every G-code template, every OM read, every enumeration, motion
  primitives — before anything lands. Nothing is written until you click
  Import.
- Imported items get **fresh minted ids** (a foreign file can never collide
  with or overwrite anything local); an imported screen appears in the nav
  and you're taken to it. Like all authoring, imports are unsaved config
  until **Save to machine**.
- Share files are data-only by construction: a spec can carry templates and
  selectors, and there is no field in which code could travel.

## The rules that hold it together

- **Templates are welded to the authority.** Built-in specs' raw templates
  must equal the `cmd.*` output — `test/control-spec.test.ts` fails on
  drift. New built-in data cards add their weld there.
- **Verify G-code forms** with the `duet-gcode` skill
  (`reference/duet-gcode.md`), and against `reference/dwc` for anything DWC
  also sends. Never from memory.
- **No GUI-encoded machine safety.** A button sends its code; the firmware
  is the authority. Two-step confirms are click-friction on destructive
  actions, not verdicts.
- **Everything is an overlay.** User cards/screens reset cleanly; built-in
  defaults are immutable code.
