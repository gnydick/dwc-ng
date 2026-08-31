# OM picker — the inspector hands you a binding selector

Increment 6 of GIT_194 (campaign #192, "everything is a document").
Date: 2026-08-30. Status: implemented in this branch.

## Problem

Writing an OM binding for a readout/template today means transcribing a
selector by hand while reading the OM inspector. The inspector can browse the
live tree (`packages/ui/src/om/OmInspector.tsx`) but cannot hand over the one
string a binding needs — a selector in the grammar `parseOmSelector`
(`packages/ui/src/compose/controls/omSelector.ts`) accepts.

## Decision — copy-as-selector, nothing more

Every node row in the inspector grows a small, fixed-geometry copy affordance.
Clicking it copies that node's selector to the clipboard through the house
copy mechanism (`shell/copyText.ts`). That is the whole increment: no Card
Studio integration, no drag gesture (a future drag builds on this), nothing on
the wire.

### The invariant (cant-break-by-design)

**pickable-implies-parseable** — the picker can only offer a selector that
`parseOmSelector` itself accepted AND that denotes the node it was built from.

- Rung 7 (sole-constructor type). The affordance's payload is the branded
  `OmSelector`, whose sole constructor is `parseOmSelector`. The builder
  `selectorForPath` (in `om/inspect.ts`) returns `OmSelector | null`; the copy
  button renders only under `<Show when={selector()}>`, so a button holding an
  unparsed string is unrepresentable — there is no code path from a raw string
  to the button.
- Validation is not "my composer looks right": the built text is fed back
  through `parseOmSelector` (the parser stays the single authority), and the
  parse result is compared segment-by-segment against the traversal path.
  Parsing alone is necessary but NOT sufficient — a key like `"a.b"` composes
  into a string that parses fine but denotes a *different* path. The
  round-trip identity check makes "parses but means something else" fail to
  null as well.

### Path → selector construction rules

The tree threads a `PathStep[]` down the recursion — each step is
`{ kind: "key", key }` (object child) or `{ kind: "index", index }` (array
child); the parent knows which, because it knows its own value kind.

- key step → a new dot-separated segment.
- index step → `[n]` bracket qualifier on the preceding key segment.
- Unbuildable paths return null, and the affordance for that node is ABSENT
  (a same-width placeholder keeps row geometry identical — decided over a
  disabled state because an offer that can never work is noise, and absence
  is the state the invariant makes natural):
  - an index at the root (the grammar has no bare-index segment; the OM root
    is an object anyway — totality, not a reachable case),
  - an index directly after another index (`a[0][1]` — the grammar allows at
    most one bracket per segment),
  - any key that is not a bare identifier (`fan-1`, `a.b`, `3`, `""`,
    `with space`) — the composed string either fails the parse or fails the
    round-trip identity, both → null.

### Qualifiers: indices only, by design

Array elements copy as `[n]`. No `[visible]`/`[letter=C]` synthesis in this
pass — the traversal path cannot know which filter the user *means*, and
guessing one would be an invented semantic. A user can hand-edit the copied
`heat.heaters[1].current` into `move.axes[letter=C].machinePosition` in the
Studio field; the grammar comment in `omSelector.ts` documents both filter
forms. (Noting it here rather than `docs/authoring-cards.md`, which is under
another increment's advisory lock at time of writing — fold a line into that
doc when the lock clears.)

### Interaction feel (positional stability)

Modeled on the loved CardTip copy-anchors (`shell/CardTip.tsx`) — same
copied/failed state machine, same reset timing (1200 ms copied / 2400 ms
failed — failure lingers because it is news), same `copyText` fallback path
for non-secure origins. CardTip itself is untouched. Differences, forced by
the tree context:

- The glyph never changes (`⧉` at all times) — CardTip swaps its text for
  "Copied!", which is fine in a card head but would shift row layout in a
  dense tree. Feedback is color + inset box-shadow (zero-layout decoration
  rule) + `title`/`aria-label` text only.
- Fixed slot: every row renders a `--u`-sized slot between key and value;
  it holds the button or the empty placeholder. Hover reveals by opacity —
  no geometry change on hover, copy, failure, or unselectable.
- The slot sits BEFORE the live value, not after it, so a value changing
  width (9.9 → 10.01 at poll rate) never moves the button under the cursor.

### What is deliberately not here

- No Studio-side integration code (paste works because the Studio's binding
  fields already run everything through `parseOmSelector`).
- No drag gesture (future; copy is the substrate it will build on).
- No filter-qualifier synthesis (above).
- No change to `omSelector.ts`, `CardTip.tsx`, the compose vocabulary, the
  share review, or the mock — this increment reads the already-polled store
  and emits nothing on the wire. Mock parity is vacuously preserved
  (falsifying check: the branch diff touches nothing under
  `packages/mock-duet` or `src/connector`).

## Tests

`packages/ui/test/om-picker.test.ts`, red-first:

- key paths, index paths, deep mixes compose to the expected text;
- the returned selector round-trips: `parseOmSelector(sel.text)` re-derives
  identical segments, and `readOm` on a sample tree returns the very node the
  path pointed at (semantic identity, not just syntax);
- null for: index at root, index-after-index, non-identifier keys (dashes,
  dots, spaces, digits-only, empty, `=`, brackets) — the dotted-key case is
  the one that PARSES and must still be refused;
- the px lint (`unit-lengths.test.ts`) covers the new CSS file automatically
  (it walks all of `src/**`).
