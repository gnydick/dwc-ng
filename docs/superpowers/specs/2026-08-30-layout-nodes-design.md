# In-card layout nodes: columns, group, spacer, justify — design (GIT_194, increment 3 of #194)

2026-08-30. Parent #194, context #195, campaign #192. Structural nodes for the
declarative control vocabulary: a card author can split a card into weighted
column tracks, cluster controls into labelled vertical groups, author alignment
with explicit spacers, and distribute a container's children — all as data
through the ONE compile boundary, none of it able to emit, read, or do anything
a leaf control cannot already do. Every choice below derives from an existing
convention, cited.

## 1. The vocabulary

### columns — split a container into weighted tracks

```json
{ "type": "columns", "rulers": true, "columns": [
    { "weight": 2, "nodes": [ …nodes… ] },
    { "justify": "between", "nodes": [ …nodes… ] }
] }
```

- `columns` (required): **at least two** entries. A one-column split is a
  `group` wearing the wrong name — refused at compile with a path-named error,
  the select precedent ("a select needs at least one option": coherence at the
  boundary, not a GUI safety). An entry's `nodes` MAY be empty (an empty
  column is authored whitespace, like a spacer).
- `weight` (optional, per column, default 1): a finite **integer ≥ 1**. The
  track list is `<weight>fr` per column, so weights are ratios; integers are
  decided because fractional weights add nothing a ratio of integers cannot
  say, and integer tracks read like grid spans. **Per-column, not a parallel
  `weights` array**: co-locating the weight with its column makes an
  array-length mismatch UNREPRESENTABLE (cant-break-by-design technique 1;
  a `weights: [1,2]` beside `columns: […,…,…]` would need a validator for a
  state that now cannot be written). No upper cap: weights are ratios, a silly
  ratio renders as a silly ratio the author sees immediately and edits back —
  a cap would be a guess (A5.16, the card-padding precedent).
- `rulers` (optional, default false): hairline verticals between columns.
  House idiom — **inset box-shadow, zero layout** (the card hairline ruling,
  app.css: `box-shadow: inset 0 0 0 1px var(--hairline)`; never `border:`,
  which occupies layout space and would shift the tracks). Each column after
  the first carries `inset 1px 0 0 var(--hairline)` plus `padding-left` in u,
  so the line sits centred in a symmetric gutter (gap on one side, padding on
  the other). `box-shadow` is an EXEMPT prop in the px lint
  (test/unit-lengths.test.ts) — the 1px is decoration, not layout.
- `justify` (optional, per column): vertical distribution of that column's
  stack — see §justify.

### group — a labelled vertical cluster

```json
{ "type": "group", "label": "Coupler", "justify": "between", "nodes": [ … ] }
```

- The vertical counterpart of `row` (which stays the horizontal flex
  container). `label` (optional) is a **template**, the row-label precedent
  (spec.ts row case): a group stamped by a `forEach` can name its item.
  `class` (optional) replaces the default `.ctl-group`, exactly as `row.class`
  replaces `.ctl-wrap` — the mechanism by which built-ins keep bespoke CSS.
- `nodes`: ControlNode[] — like `grid.items`, NOT RowItems: input placements
  live inside rows, which a group contains. (Allowing bare `{input:…}` at
  group level would create a second lexical home for the InputRef
  discriminator hazard spec.ts documents on `isInputRef`; nothing needs it.)
- `justify` (optional): vertical distribution of the stack.

### spacer — explicit authored gap

```json
{ "type": "spacer", "size": 4 }    // fixed: 4 × --u
{ "type": "spacer" }               // flexible: takes the free space
```

- `size` (optional): finite number **> 0**, in `--u` units — every
  layout-space length is `calc(n * var(--u))` (the global-unit rule,
  CLAUDE.md; rendered exactly as the Panel `padU` precedent renders authored
  padding). Absent = flexible (`flex: 1 1 0`): the free-space eater, which is
  how alignment is AUTHORED — "push the rest to the far end" is a spacer, not
  a magic margin. `size: 0` is refused (a zero gap is the absence of a
  spacer), the slider `step > 0` precedent.
- Direction-agnostic by construction: the fixed form is `flex-basis`, which
  is main-axis in a row and in a group/column alike — one node, no
  horizontal/vertical variants to keep in sync (A5.7).
- A spacer emits nothing, reads nothing, and has no children: in the share
  review it contributes NOTHING to the inventory, and the walk says so
  explicitly (a `return` under the totality weld, like jog-pad's motion note).

### justify — a property of container nodes, not a node

`justify?: "start" | "center" | "end" | "between"` on **row** (horizontal
distribution), **group** (vertical), and **each columns entry** (vertical,
within that column's stack). Not on the `columns` node itself: its tracks are
`fr`-weighted and always fill the width, so a main-axis `justify-content`
there is a dead knob — refusing to mint it is A5.18 (delete the alternative).
Rendered as one of four static classes (`.ctl-justify-*`), not an inline
style: four values, zero lengths, and a class is greppable where a style
string is not. Untrusted strings are validated in parse.ts (the `VARIANTS`
set precedent for `gcode-button.variant` — compile trusts the TS union,
parse refuses the rest).

**Positional stability** (the PRIMARY concern, uniformity-alignment memory):
justify redistributes FREE space, so a child's position depends only on
sibling box sizes. Every leaf control boxes its VALUES against live updates —
tabular-nums + min-width readout/slider value slots, reserved error/stamp
slots, fixed toggle word box (ControlList.tsx comments per node) — so a
polled value change cannot move a justified sibling. LABELS are the stated
exception (corrected on the inc 3 review, F3): a row/group/readout label
carrying `{om:}` has a min-width floor and no max, so a poll resolving to a
longer label CAN grow its box and take free space from the distribution — by
design, a legitimate long label renders whole rather than clipping; an
author who wants complete stillness under justify keeps `{om:}` out of
labels. What can also move siblings is a forEach stamping a new item (an
axis appearing), which is true of every container today and is the model
changing, not a value updating. Documented in authoring-cards.md.

**Cross axis and the stack rhythm** (round-2 fixes, found by Gabe on the
mock 2026-08-31): every vertical stack — the ControlList ROOT (`.ctl-list`,
new: nodes previously rendered bare into `.panel-body` and two top-level
controls could touch), each columns entry (`.ctl-col`) and each group
(`.ctl-group`) — carries `gap: var(--ctl-gap)`, the SAME 2u token rows use
horizontally, and defaults its cross axis to `flex-start`: a control ATOM
(button, toggle, readout) keeps its intrinsic width. The elements that ARE
layout — rows, the columns split, grids, nested groups — plus the elastic
slider strip span the stack via one `align-self: stretch` rule. A mount with
its own layout hands its class to the list root, REPLACING `.ctl-list` (the
`node.class ?? "ctl-group"` precedent — Movement's `.jog-controls` grid).
Pinned by test/layout-nodes.test.ts. The mock's seeded demo card
(`packages/mock-duet/src/files.ts`, "Beeper") is re-authored in the SAME
change to the exact shape both defects appeared in — a columns split and a
row as top-level siblings, buttons stacked in a column and a nested group —
and the same test file compiles the spec the mock actually serves through
`parseControlSpecText`, so a vocabulary change that invalidates the seed
fails tests instead of handing UAT a broken card.

**Open extension, deliberately NOT minted** (be-reasonable/YAGNI, round 2):
a per-container `stretch` (or `align`) knob letting an author opt an atom
into spanning the stack — e.g. a deliberately full-width button. No card
needs it yet; minting it now would be a knob whose absence nobody has felt.
If an author asks, it joins the container nodes beside `justify` with the
same VARIANTS-set parse discipline.

## 2. Nesting rules — enforced at the ONE compile boundary

Both refusals live in `compileControlSpec` (the sole producer of the branded
`CompiledControlSpec`, rung 7 `spec-compiles-whole`), so built-ins fail the
build and imported JSON gets a path-named error from the same lines. Nothing
is "handled" at render: the renderer receives only trees these rules already
hold for.

1. **columns cannot nest inside columns** — anywhere in the subtree, not just
   directly (`columns > group > columns` is still a nested split). A card is
   one panel: a second-level split produces sub-quantum tracks that defeat
   the scale discipline (the GIT_170 ruling: boxes live on the `--u` quantum)
   and has no legitimate card. Mechanism: the compile walk carries an
   `inColumns` flag; the error names the exact path.
2. **the node tree is at most 8 levels deep.** Depth counts every nesting
   edge (row items, grid items, forEach node, group nodes, columns entries'
   nodes). The deepest built-in today is 4 (HOMING: row > forEach > row >
   button); 8 is double that, and past it there is only pathology. This also
   makes "renderer/review recursion is bounded" a property of the compiled
   TYPE: a compiled spec deeper than 8 cannot exist. (parse.ts's own
   validators still recurse over raw JSON first; a hostile 100k-deep file
   throws RangeError inside `parseControlSpecText`'s existing catch and comes
   back as a named error — the never-throws contract holds, verified by
   test.)

Declared as `@invariant layout-nesting-refused-at-compile`, **rung 7** (the
sole-constructor boundary is the mechanism) — no below-rung-6 register row is
added; the register is regenerated in the same commit.

## 3. Rendering (ControlList.tsx)

New cases behind the same `unreachable` totality weld (a missed case is a
compile error, not an empty render):

- `columns` → `div.ctl-columns` (CSS grid), `grid-template-columns` from the
  compiled weights as `"2fr 1fr"` inline (fr only — no length units, px lint
  indifferent); `has-rulers` class when `rulers`. Each entry →
  `div.ctl-col` (+ justify class), children via the same node renderer.
- `group` → `div` with `class={node.class ?? "ctl-group"}` (+ justify class),
  optional label span exactly like row's (`.ctl-name`, resolved template,
  `<Show>` on the resolved text so an empty stamp costs no slot), children
  via the node renderer.
- `spacer` → `span.ctl-spacer[aria-hidden]`; fixed form gets inline
  `flex: 0 0 calc(<n> * var(--u))` (the Panel padU precedent for authored
  u-lengths), flexible form is the stylesheet's `flex: 1 1 0`.
- `row` gains only a justify class — its structure is untouched.

CSS: `.ctl-columns`, `.ctl-col`, `.ctl-group`, `.ctl-spacer`,
`.ctl-justify-{start,center,end,between}`, and the ruler rule — all lengths
`calc(n * var(--u))`, hairlines inset box-shadow.

## 4. Boundary (parse.ts)

Field-by-field, path-named, same shape as every existing case: `columns`
wants an array of objects each with optional finite `weight`, optional
justify (validated against the closed set), and a `nodes` array validated
recursively; `group` wants `nodes` array + optional `label`/`class` strings +
optional justify; `spacer` wants optional `size` number. Semantic rules
(≥ 2 columns, integer weight ≥ 1, size > 0, no nested columns, depth cap)
live ONLY in `compileControlSpec` — one site serves untrusted JSON and
built-ins alike (the increment-1 rule, restated).

## 5. Share review (share.ts)

Structural nodes emit nothing and read nothing (group's label template can
read — see below), so they add NO categories; their CONTENTS are what must be
walked, and the `unreachable` weld is what forces the walk to say so: columns
walks every entry's nodes, group walks its nodes, spacer returns. A button,
slider or toggle inside a column is inventoried exactly as if it sat at top
level — pinned by test (the "weld forces the walk" check the brief names).

**Found while adding this** (class ruling, enumerated): `row.label`/`row.sub`
are templates and may carry `{om:…}` reads, but the review's row case walked
only `items` — an OM read in a row label was silently absent from the Reads
inventory. Same shape would have applied to `group.label`. Both fixed in this
increment: row and group label (and row sub) template reads join `omReads`,
with a red-first test. Sweep of the walk for the same shape: gcode-button
(label+template taken), readout (label taken), toggle (label taken), slider
(template taken; it HAS no label field — derives from its input def, which
is not a template) — no other template field exists uninventoried
(enumeration complete over CompiledNode's template-typed fields).

## 6. Card studio (formModel.ts, CardStudio.tsx)

- `FormItem` gains `{ kind: "spacer", size: number | null }` (null =
  flexible); lowers in `toSpec`, lifts in `tryFromSpec` — a spacer inside a
  flat row is fully form-representable.
- `columns` and `group` are JSON territory: they cannot ride a flat row list
  without approximating, so `tryFromSpec` refuses (null-over-approximation,
  the forEach/grid/jog/select rule). A `row` carrying `justify` also refuses
  (the form has no field for it — same honesty as `sub`/`class` today).
- The studio's row head gains "+ spacer"; the mode-switch refusal message
  names columns/groups.

## 7. Dogfood (builtin.ts + app.css)

MOVEMENT_SPEC's side column is today a `row` whose class (`jog-side`) turns
it into a flex COLUMN, with the coupler pinned to the bottom by a stylesheet
hack: `.jog-side > .coupler-row { margin-top: auto; }` (app.css — the comment
there even explains the pin). That is exactly the intent the new vocabulary
exists to say in data: the node becomes a **`group`** (it was never a row —
the class was fighting the node's meaning) with **`justify: "between"`**, and
the margin-top:auto rule is DELETED. Two children (step bank, coupler row) —
`space-between` reproduces the pin byte-for-byte in rendered geometry; when
no C axis exists the forEach stamps nothing and one child under
space-between sits at start, exactly as margin-top:auto on a missing element
did. The Card Lab scale sweep must stay green (run, not asserted). HOMING is
left alone: its table idiom (display: contents rows spending a shared track
list) is a stronger alignment guarantee than columns' independent tracks —
converting it would weaken it.

## 8. Mock parity

Structural nodes touch NOTHING on the wire: no new endpoint, no new OM key,
no new file, no new G-code — a columns/group/spacer/justify card polls and
emits exactly what its leaf controls already did. Verified by inspection of
the vertical (no connector/mock file is touched by this increment) and by
driving the UAT card against the live mock; stated in the report rather than
asserted from prose.

## 9. Tests (red first)

- control-spec.test.ts: columns/group/spacer compile (weight default 1
  concrete, group label compiled to a template); refusals path-named —
  columns with 0/1 entries, weight 0 / −1 / 1.5 / ∞, spacer size 0 / −2 / ∞,
  nested columns (direct AND via group), depth 9 vs depth 8; extractButtons
  gains the cases (the weld's totality forces it).
- custom-cards.test.ts: the three types through `parseControlSpecText`
  (accept + named field errors incl. a bad justify string and a hostile
  deep-nesting file returning `ok: false`, never throwing); form round-trip
  with a spacer; tryFromSpec null on columns, group, and row-with-justify.
- share.test.ts: a button + slider + toggle nested inside columns/groups
  appear in the review inventory; row and group label `{om:…}` reads join
  `omReads` (red against the current walk).

## 10. Gates

`pnpm test` (ui + mock), `npx tsc -b --force`, `python
scripts/register_check.py --fast`, `pnpm -C packages/invariants run check`
with an EMPTY regen diff (register regenerated in the same commit as the new
invariant), `pnpm build`, px lint green (no new absolute units; hairline px
rides the exempt box-shadow prop).
