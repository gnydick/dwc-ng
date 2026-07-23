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
until "Save to machine"** (Settings → the Configuration card), reset-able
like all config.

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
`number` (a small field) or `chips` (a preset row, like Movement's step sizes).

**Nodes:**

| type | what it is | fields |
|---|---|---|
| `gcode-button` | a button wearing its command | `label`, `template`, `variant?` (`go`/`danger`/`quiet`), `stamp?` (false hides the mono code), `class?` |
| `jog-pad` | the cardinal XY pad + Z column | `step`, `feed` (input names) — emits via `cmd.jog` |
| `axis-jog` | one −/+ row for a loop axis | `axisVar`, `step`, `feed` |
| `row` | a labelled flex row | `label?`, `sub?`, `class?`, `items` (nodes and/or `{ "input": name }`) |
| `grid` | equal-column button grid | `items` |
| `forEach` | stamp a node per OM item | `from` (selector), `as` (var name), `except?` `{prop, values}`, `enrich?` (`axisLabel`) |

**Placeholders** (in `template` and `label`): `{input.name}` — an input's
live value; `{om:selector}` — an object-model read; `{var.prop}` — a
forEach item's property. The worn code re-resolves live as inputs change.

**Selectors** (the whole grammar — there is deliberately no more):
dot-separated identifiers, each with at most one bracket —
`move.axes`, `move.axes[3].letter`, `move.axes[visible]` (truthy filter),
`move.axes[letter=C]` (equality filter). No calls, no expressions: an
imported card can *read* the model and *emit templates*, and that is all it
can ever say.

Tricks: `forEach` over an equality filter doubles as an existence gate (the
coupler row renders only when a C axis exists); `enrich: "axisLabel"` gives
axis items a `label` of letter + the user's role name.

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
