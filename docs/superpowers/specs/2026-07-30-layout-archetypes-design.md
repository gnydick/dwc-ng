# Layout archetypes: a legible layout model for cards

## Goal

**An operator who does not know CSS can diagnose and fix a layout problem.**

Not "fewer regressions" — that is a means. The 2026-07-29/30 session fixed a
dozen layout defects and every correct diagnosis was useless to hand over:
*"the cell's line-box strut inflates the row because an inline-flex child sits
in a line box as tall as the inherited font's line-height."* The symptom was
"the card will not shrink"; the cause was three layers away in a mechanism with
no error message.

That is the actual problem. CSS makes the cause invisible at the point of
failure. The fix is a model where the cause is stated in the same terms the
operator edits in, and where the app names the mismatch itself.

Success looks like this sentence appearing in the UI:

> Extruders — column `feed` declares a floor of 148px, needs 187px at density
> 0.50.

## The regression classes this addresses

All observed, all from one session:

| | Class | Instances |
|---|---|---|
| a | Content sized by something that is not its container | `max-height: 62vh` file list; canvas bitmap set from the element being measured; `height: 100%` against an auto-height parent |
| b | Content that reflows, so a card "fits" at any width | `.speed-foot`, `.mesh-actions`, 10 others |
| c | Content declaring a false floor | `min-width: 0` on a pair needing 159px |
| d | **Self-referential measurement** | toolpath and console reported `rowStop == current span`; unshrinkable |
| e | Two cards implemented twice, agreeing by coincidence | Tools vs Tools & heaters — crossed over at a different density |
| f | Positional selectors silently retargeting | a 6-column media query written for a 5-column table |

## Architecture

### The inversion

Today the card's minimum is **measured** from the live DOM at drag start:

```
measure DOM ──> minimum ──> layout ──> DOM
     ^                                  │
     └───────────── cycle ──────────────┘
```

`getBoundingClientRect` is, by CSSOM View definition, post-layout border-box
geometry under the **real** available space. CSS Sizing 3 §5.1 defines
`min-content` as the size the box would have *"if its containing block was
zero-sized in that axis."* These are opposite quantities. Measuring one and
using it as the other is a category error, not an imprecision — and in the
self-referential case it provably returns the current size (class d).

Chromium names the resulting defect *hysteresis*: "If the code made the mistake
of reading the size or position of an object at the incorrect time or stage…
we would immediately add a subtle hysteresis bug."

Proposed:

```
declaration ──> minimum ──> layout ──> DOM
     │                                  │
     └──> declared floor  ==?  measured min-content   (oracle; fails the build)
```

The signature is the enforcement:

```ts
layout(declaration: CardLayout, available: Size): Geometry
```

The card's live geometry is **lexically out of scope**. Classes (a), (c) and
(d) are not discouraged — they are unwritable, because the quantities that
made them possible are not parameters. This is Blink LayoutNG's shape: layout
is a function from an immutable constraint object to an immutable fragment,
and reading previous state is prohibited.

### What is NOT copied

**Any engine's intrinsic-size cache.** Permitting content-derived sizing forces
memoization, and memoization becomes a child→parent damage-propagation protocol
that expert teams get wrong: Servo shipped a bug in Feb 2026 — "layout damage
to a node was not clearing the inline content size cache of the parent node" —
in a subsystem carrying four such PRs. Blink's pre-LayoutNG caches were
"constantly fighting with under and over invalidation bugs." The value of
arithmetic floors is that **there is nothing to invalidate.**

## The vocabulary

Four archetypes. Structure is typed; numbers are tokens or px.

- **`table`** — named columns, uniform rows, optional header. (Tools & heaters,
  Tools, Sensors, Layer times)
- **`rows`** — a list of like items at one pitch, hairline-separated.
  (Extruders, Fans, Homing, Movement axes)
- **`stack`** — heterogeneous blocks in a column. (Printing, ATX, Tuning)
- **`fill`** — one slot that absorbs all slack, with a declared floor.
  (Toolpath, Console log, Camera, Height map)

### Column and row model

Every track declares a **floor** in px and a **growth rule**:

```ts
{ id: "heater", floor: 152 }              // fixed
{ id: "name",   floor: 76, grow: 1 }      // floors at 76, takes slack
```

`grow` is a fraction, not content. **No track that feeds the card's reported
minimum may be content-derived** (`max-content` / `auto`).

This is narrower than "ban intrinsic sizing everywhere". An `auto` track fully
contained inside an already-floored region is permitted: no intrinsic
contribution escapes the card boundary, so it violates neither Invariant A nor
the no-cache property.

### Worked example

Both tool cards, today's measured numbers:

```ts
export const toolsHeaters = card({
  archetype: "table",
  rowHeight: "tool-row",
  columns: [
    { id: "heater",  floor: 152 },
    { id: "active",  floor: 56, gutterLeft: 14 },
    { id: "standby", floor: 56 },
    { id: "current", floor: 58, align: "end", gutterRight: 14 },
    { id: "set",     floor: 156 },
  ],
});

export const tools = toolsHeaters.without("active", "standby", "set");
```

- Width floor = Σ column floors + gutters. Arithmetic.
- Height floor = header + rows × `tool-row` + chrome. Arithmetic.
- The two cards agree by **subtraction**, not by two implementations matching.
- `nth-child` cannot go stale: widths travel with named columns, so inserting a
  column shifts nothing.

### Floors are a function, not a constant

```ts
floorOf(declaration, tokens) -> px
```

Density must be an input: regression (e) crossed over *at a different density
setting*. Text floors are expressed in `ch`/`em` derived from font metrics so
they track font-size rather than freezing a px value.

## Invariants

### A — universal, same-axis form

> A card's reported minimum along axis X is a pure function of its declaration
> and, optionally, of the available size along the **other** axis. Never of its
> own used size along X.

Platform-validated: CSS defines `min-content` this way by construction, and
violating it is Chromium's named hysteresis defect.

**Enforced by the `layout()` signature**, not by a test — rung 7/8. The card's
used size is not a parameter.

Honest limit: A is **not** universal in the stronger form "depends only on the
static declaration." CSS itself enumerates carve-outs — aspect-ratio transfer,
cyclic percentage-sized boxes (§5.2.1), orthogonal flows — and Chromium admits
some hysteresis "was needed to get some layout modes working correctly."

### The one escape hatch — copied from Qt verbatim

Wrapping text genuinely couples axes. Qt's design, transplanted:

- `hasHeightForWidth` — **defaults false.** Independence is the default;
  coupling is declared, never inferred.
- `heightForWidth(concreteWidth)` — the dependent axis is a function, not a
  scalar.
- **The reverse direction is forbidden.** Qt: "It is not possible to have a
  layout with both height-for-width and width-for-height constraints at the
  same time." This is what makes the cycle unrepresentable.

Floor+fraction survives intact on the driving (width) axis; only the dependent
axis stops being a scalar.

### B — per-archetype policy, NOT a law

> No descendant changes position when the container resizes along the other
> axis.

Research found **no named property and no component-level analogue to CLS**
(which is page-level and time-windowed, and cannot see drag-time drift). B is
a project policy that matches the standing positional-stability requirement —
adopt it as such, do not assert it as prior art.

Scope it per archetype. For `table`, `rows` and `stack`, descendant positions
along the main axis must be a function of the main-axis size alone — which
falls out of banning wrap and content-derived tracks, killing class (b). **For
a `fill` archetype containing wrapping text, B is false by construction and
must be declared so.**

Expressed as an assertion, not a principle: evaluate positions at cross-axis
size `W` and `W+δ`, assert equality.

## The oracle

A dev- and CI-mode audit that renders each card, measures real shaped text per
locale, and **fails when a declared floor is below the measured `min-content`.**

Measurement is not deleted; it is **relocated from a layout input to a test
oracle**. Sound precisely because it detects what arithmetic cannot see —
shaped text, German, CJK, RTL — and it introduces no cycle, because the measured
value never flows back into layout.

It also supplies a falsifying check for every "this card fits" claim, which
observation cannot.

**Host:** the audit is a plain module with no test-host dependency, called by
the Card Lab. Wiring it to a headless runner later is a small change and is not
part of this spec — Playwright is a large dependency and adding one requires
explicit approval per the project dependency policy.

**Known constraint:** `jsdom` has no layout engine and `ResizeObserver`
callbacks do not fire in automated/background tabs (observed 2026-07-30 — a
fresh observer missed even its mandatory initial fire). The audit must run in a
foreground browser context.

## The inspector

Card Lab panel, in two stages:

1. **Read-only.** Declaration, computed floors, measured floors, and any
   mismatch named in the vocabulary the operator edits in.
2. **Live nudges.** The numbers become editable with live preview, persisted
   through the existing config overlay.

Full direct manipulation (drag a column edge) is **out of scope** for this
spec. It is a larger build, and it drifts toward "layout editor as a product"
rather than a control plane for a specific-purpose appliance. It becomes cheap
later if the model is right.

## Where the declaration lives

**Structure in typed source; numbers in the config overlay.**

- **Structure** (archetype, column identity, which fields exist) is TypeScript.
  `Record<CardId, CardLayout>` makes it total: a new card cannot ship without a
  declaration, enforced by the compiler rather than by anyone remembering.
- **Numbers** (floors, gutters, row height) are overridable through the config
  overlay that already carries card geometry, axis roles and dock sensors —
  with reset and snapshot history for free.

The split has a safety property: an overlay edit can make a card ugly, but
cannot make it structurally invalid, because the archetype and columns are not
reachable from there. The oracle validates the *effective* values, so an
overlay that pushes a floor below what text needs still fails loudly.

## Staging

Cheapest and most independently verifiable first.

| # | Step | Why here |
|---|---|---|
| 1 | Oracle against all 41 cards **as they are** | builds the floor table empirically *before* behaviour changes, so any later mismatch is attributable |
| 2 | 12 `nth-child` selectors → named role classes | kills class (f) outright; mechanical, zero interaction with sizing |
| 3 | Tools + Tools & heaters → one declaration | kills class (e); the density crossover becomes one token |
| 4 | Convert card-by-card, both systems live | converted cards compute, unconverted still measure, oracle checks both |
| 5 | Toolpath early despite being one card | purest instance of (d); validates the immutable-input signature |

Precedent for the shape: Blink's own migration ran per-layout-mode across
multiple releases, old and new paths coexisting — Grid did not move to LayoutNG
until Chrome 93, years after the architecture landed.

## Risks

**Text and i18n — the concentration of risk.** Any declared text floor is a
guess that German, CJK or RTL will falsify. Three mitigations by leverage:

1. Text contributes **no** floor where possible: it lives in a slot that
   ellipsises, or in a declared `heightForWidth` slot. Let the text lose, not
   the layout.
2. Where a text floor is unavoidable, express it in `ch`/`em` from font metrics.
3. The oracle runs per locale.

**This design inherits its author's judgement.** The mitigation is that the
oracle checks the arithmetic against real rendering, so the system can catch the
author being wrong — which nothing in the current codebase does.

**Scope is structure and size only.** Colour, type, the 3D viewport and
animation stay in CSS. Structure and size is where every observed defect lived,
but it is not all of the 3,296 lines.

**No attested prior art for the whole.** Generating CSS from a typed
declaration is well-trodden (vanilla-extract, StyleX). Computing component
*minimum sizes* arithmetically from that declaration has no surviving attested
precedent in the research. That part is genuine invention, which is why the
oracle is staged first: it de-risks by keeping measurement available as a check
while the arithmetic earns trust.

## Sources

- CSS Sizing 3 §5, §5.1, §5.2.1 — intrinsic sizing; `min-content` at a
  zero-sized containing block
- <https://developer.chrome.com/docs/chromium/layoutng> — one-pass vs two-pass
  complexity; idempotence and hysteresis; cache invalidation history
- <https://github.com/servo/servo/pull/42574> — inline content size cache not
  cleared on parent damage
- <https://bugzilla.mozilla.org/show_bug.cgi?id=1151040> — Gecko intrinsic
  width invalidation
- <https://doc.qt.io/qt-6/qlayoutitem.html> — `hasHeightForWidth` /
  `heightForWidth`; bidirectional coupling forbidden
- <https://docs.flutter.dev/ui/layout/constraints> — constraints down, sizes up;
  single pass; a widget cannot know its own size or position
- <https://developer.android.com/develop/ui/compose/layouts/intrinsic-measurements>
  — measure-once; intrinsics as a separate pre-pass
- <https://developer.apple.com/documentation/swiftui/layout> — `sizeThatFits`
  must be idempotent and side-effect free
