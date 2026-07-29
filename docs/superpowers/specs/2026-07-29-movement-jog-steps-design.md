# Movement card: per-axis jog step banks

**Date:** 2026-07-29
**Status:** approved (design), not yet implemented

## Problem

The Movement card jogs one axis at a time through a two-part gesture: pick a
magnitude from the Step chips (`0.1 / 1 / 10 / 100`), then press `−` or `+` on
the axis row. Two controls decide one move, and the magnitude that will actually
be sent lives in a different widget from the button you press.

It also forces one magnitude on every axis. On this machine X/Y travel hundreds
of millimetres while U/V/W are individual Z leadscrews adjusted in hundredths —
a single shared step cannot serve both.

## What this changes

Each visible axis gets a bank of six jog buttons whose labels state exactly the
offset they send. A toggle in the card turns every cell into a text input, so
the six offsets per axis are configurable and persist with the machine.

The Step chips and the single `−/+` pair are removed: the bank subsumes both,
and leaving chips that drive nothing would be a dead control.

```
MOVEMENT                        M120 · G91 · M121   [⇄] [⠿]
FEED [6000]                                       STEPS [✎]

X               [-100][-10] [-1] │ [+1] [+10][+100]
Y               [-100][-10] [-1] │ [+1] [+10][+100]
Z                [-10] [-1][-0.1]│ [+0.1][+1] [+10]
U  Z motor 1      [-1][-0.1][-0.02]│[+0.02][+0.1][+1]
V  Z motor 2      [-1][-0.1][-0.02]│[+0.02][+0.1][+1]
W  Z motor 3      [-1][-0.1][-0.02]│[+0.02][+0.1][+1]
C  Coupler       [-10] [-1][-0.1]│ [+0.1][+1] [+10]

COUPLER   C   [LOCK][UNLOCK]
EXTRUDER  mm[5] F[300]  [RETRACT][EXTRUDE]
```

`STEPS [✎]` pressed — every cell becomes a text input, both sides independently
editable:

```
X               [-100][-10] [-1] │ [  1][ 10][ 100]
Y               [-100][-10] [-1] │ [  1][ 10][ 100]
Z                [-10] [-1][-0.1]│ [0.1][  1][  10]
U  Z motor 1      [-1][-0.1][-0.02]│[0.02][0.1][   1]
```

The coupler and extruder rows are unchanged.

Both diagrams show a **tuned** machine, not a fresh one: Z and the leadscrews
carry offsets the operator has already set. Out of the box every axis renders
the same default bank — see Defaults below.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Magnitudes shared or per-axis? | **Per-axis** | A leadscrew and a gantry axis need different steps; a shared set cannot express it. |
| Where do they persist? | **Config overlay** | A useful step is a property of the machine, not of the browser. Follows the machine, joins snapshots, revertable. |
| Edit surface | **All six cells** | Both sides independently settable, per the approved interface. |
| Step chips | **Removed** | Their only consumer was the `−/+` pair. |
| Feed input | **Kept** | `G1` still needs an `F` value. |

## Data

```ts
/** Six signed jog offsets for one axis, in rendered order (left to right). */
export type AxisSteps = readonly [number, number, number, number, number, number];
```

Added to `UiConfig` (`config/types.ts`) beside the existing per-machine UI
metadata:

```ts
/** Axis letter → its six jog offsets. RRF has no notion of a "jog step";
 *  this is per-machine UI metadata, like axisRoles above it. */
axisSteps: Record<string, AxisSteps>;
```

`DEFAULT_CONFIG.axisSteps` is `{}` — the same shape as `axisRoles: {}`. The
overlay therefore stores **only** axes the user has actually edited, and Reset
drops the overlay back to the code defaults, which are never mutated.

### Defaults

Every axis with no overlay entry renders `[-100, -10, -1, 1, 10, 100]`.

Deliberately uniform. Deriving finer defaults for the leadscrews from axis range
would be the GUI guessing at a workflow, and firmware is the authority on what
constitutes a legal move (`M208` limits reject an out-of-range jog on a homed
axis). A predictable default the operator tunes beats a clever one they have to
reverse-engineer.

The default tuple lives in one exported constant. Rendering reads
`config.axisSteps[letter] ?? DEFAULT_AXIS_STEPS` in exactly one place, so there
is no second site where a different default could be written.

### Parsing

`config/parse.ts` gains `parseAxisSteps`, following `parseDockSensors`
(`parse.ts:50`) exactly:

- `safeEntries` for iteration — this is the existing `__proto__`/prototype
  pollution guard, and an axis-letter-keyed record is precisely the shape that
  needs it.
- A value is accepted only if it is an array of **exactly six** entries, each a
  `number` passing `Number.isFinite`. Anything else — wrong arity, a string, a
  `NaN`, an `Infinity`, a nested object — drops that axis and leaves the rest.
- Returns `undefined` when nothing survived, matching every sibling parser, so
  an empty result never writes an empty object into the overlay.

Arity is checked rather than padded: a five-entry tuple padded to six would put
a fabricated offset on a motion control.

`DeepPartial` (`config/types.ts:173`) already routes arrays through its array
arm rather than its object arm, so `AxisSteps` survives the overlay type as a
tuple and cannot degrade into a `{ 0: … }`-shaped non-array.

## Control vocabulary

Movement is a **dogfood** card — it is written in the control vocabulary
(`compose/controls/builtin.ts`), not as hand-written JSX. That is the point of
`builtin.ts`: Homing and Movement are the evidence the vocabulary is expressive
enough for real controls. This feature therefore extends the vocabulary rather
than escaping it.

Two new node types in `compose/controls/spec.ts`:

```ts
| { type: "axis-step-bank"; axisVar: string; feed: string }
| { type: "steps-edit-toggle"; label: string }
```

Both compile like `axis-jog` does: `needInput(node.feed, …)` validates the feed
reference at compile time, so a spec naming an input that does not exist throws
a path-named error at module load rather than rendering a broken control.

`MOVEMENT_SPEC` becomes:

```ts
{ type: "row", class: "step-row", items: [{ input: "feed" }, { type: "steps-edit-toggle", label: "Steps" }] },
{
  type: "row",
  class: "jog-table",
  items: [{
    type: "forEach",
    from: "move.axes[visible]",
    as: "axis",
    node: { type: "axis-step-bank", axisVar: "axis", feed: "feed" },
  }],
},
```

The `jog-pad` and `axis-jog` primitives stay in the vocabulary untouched — this
removes them from the built-in card, not from what a user-authored card can do.

### Rendering

`ControlList` gains one card-level signal beside the existing `inputs` store:

```ts
const [editingSteps, setEditingSteps] = createSignal(false);
```

Card-local by design. It is a transient view mode, not a preference: it must not
persist, because a card that reloads into edit mode presents text fields where
the operator expects jog buttons.

`axis-step-bank` renders the axis name cell plus six cells. Each cell is a
`GcodeButton` when `editingSteps()` is false and a number field when true.

Every button's command is `cmd.jog(letter, offset, feed)` — the same authority
the `−/+` pair used. No new G-code is introduced by this feature, and
`test/control-spec.test.ts` continues to weld the emitted form to
`control/commands.ts`, so the bank cannot drift from `commands.ts`.

`steps-edit-toggle` renders a small `aria-pressed` button that flips the signal.

### Import/export

`compose/controls/parse.ts` and `compose/share.ts` must admit both new node
types, and `reviewSpec` must enumerate `axis-step-bank` as a motion primitive —
otherwise a shared card containing one either fails to import or imports without
disclosing that it moves the machine. The existing
`"reviewSpec enumerates every template, om read, loop, and motion primitive"`
test is the guard.

## Geometry

Positional stability is the governing constraint here.

All seven axis rows live in one CSS grid. Each row is `display: contents`, so
its cells are direct children of that grid and land in the same tracks as every
other row's. Column alignment is then true by construction — it does not depend
on `U` and `X` happening to measure the same, and adding an axis cannot reflow
the columns.

Buttons and inputs share `height: var(--ctl-h)` and identical horizontal
padding, so toggling edit mode causes **zero** reflow: no cell changes size,
nothing moves under a finger already resting on the card.

Labels and fields are `font-variant-numeric: tabular-nums`. `-0.02` and `-100`
must occupy the same width, or editing one cell would resize its column and
shift the buttons either side of it.

The card is a density citizen: the bank spends `--ctl-gap` and `--ctl-h`, so it
tightens with the lead-pitch setting like everything else.

## Validation

A cell accepts any finite number verbatim — negative, zero, fractional. The
label then states exactly what will be sent, which is the card's whole contract.

Input that does not parse to a finite number reverts the field to its previous
value and leaves the config clean. There is no coercion path: a silently
clamped or rounded value would make a button lie about its own move, which on a
motion control is worse than refusing the edit.

Zero is permitted. `G1 X0` is a legal no-op and the firmware is the authority;
the GUI does not get to invent a rule RRF does not have.

## Testing

| Test | Guards |
|---|---|
| `parseAxisSteps` tolerance: `null`, `"nope"`, `{}`, `[1,2,3]`, `[1,2,3,4,5,"6"]`, `[…NaN…]`, `[…Infinity…]` | Malformed SD/localStorage data cannot reach a motion control |
| `parseAxisSteps` drops a `__proto__` key via `safeEntries` | Prototype pollution, per the hardening audit |
| Overlay drop restores `DEFAULT_AXIS_STEPS` | Defaults immutable; Reset always works |
| Serialize → parse round-trip preserves every tuple | Config survives the SD round trip |
| Every bank button's command equals `cmd.jog(letter, offset, feed)` | The `commands.ts` weld |
| `reviewSpec` enumerates `axis-step-bank` as a motion primitive | A shared card cannot hide that it moves the machine |
| Share export → import round-trips a spec containing both new nodes | Import/export completeness |
| Bank row is `display: contents` under `.jog-table` | Column alignment by construction |
| Compile throws on an `axis-step-bank` naming an unknown feed input | Fail fast at module load |

## Out of scope

- Changing the number of cells per axis (fixed at six).
- Per-axis feed rates — feed stays one card-level input.
- A settings-view editor for steps; they are edited in place on the card.
- Any change to `jog-pad` or `axis-jog`, which remain available to
  user-authored cards.
