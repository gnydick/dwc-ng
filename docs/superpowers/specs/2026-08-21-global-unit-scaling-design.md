# Global unit scaling: one unit, everything relative to it

## Goal

The CLAUDE.md constraint, verbatim: *"Scaling features should work
universally. Interface cards should not need resizing or layout updated."*

Stated as an invariant that can fail:

> A card's minimum size, measured in stored grid cells, is the same number at
> every UI scale.

If that holds, a layout saved at one scale fits at every other scale, with no
re-measurement, no re-clamp and no migration — because the stored geometry
never had a pixel in it, and now nothing the card draws has one either.

The purpose is **readability**, not zoom. The operator makes the UI larger or
smaller to read it standing at the machine or on a phone; decorations that do
not aid reading (borders, hairlines, radii, shadows) stay at their pixel size.

## Why the current mechanism cannot satisfy the constraint

Assessment of 2026-08-21 (this worktree, `c0fa80d`):

1. The only scale control is the density pitch (`shell/density.ts`). It shrinks
   *air* — padding, control height — but deliberately leaves type fixed, and it
   leaves every absolute-px floor (`min-height: 150px` on the chart, viewport
   floors on file browsers, canvas floors on camera/toolpath) untouched.
2. So cards shrink at **two rates**. The 26 cards built from density tokens
   hold a flat floor in stored units; the 17 cards with px floors need up to
   +32% more stored units at the tightest pitch (measured,
   `2026-07-31-floor-table-four-pitch.md` FINDING 2). A single `--row-unit`
   chosen from the least-shrinking card leaves slack on the first group and
   still clips the second.
3. A card's true minimum is known only inside a pointer drag
   (`panelCanvas.ts` `startResize` → `contentRowSpan`/`contentColSpan`) and is
   discarded into an integer that carries no record of the pitch it was
   measured at. Nothing re-evaluates it when the pitch changes. "Resize the
   card" is the only path — exactly what the constraint forbids, and the shell
   admits it (`Shell.tsx` DensityToggle doc comment).
4. The width axis never scales at all: `COL_UNIT_PX` is a literal.

Root cause: **lengths inside cards are written in two incompatible units
(density-scaled tokens and absolute px), and the stored grid cell is a third.**
No conservative constant can reconcile three units.

## The design

### One unit

```css
:root { --u: 4px; }                      /* scale 1.0 — renders byte-identically to today */
:root[data-scale="075"]  { --u: 3px; }
:root[data-scale="0875"] { --u: 3.5px; }
:root[data-scale="1125"] { --u: 4.5px; }
:root[data-scale="125"]  { --u: 5px; }
:root[data-scale="150"]  { --u: 6px; }
```

Every length that occupies layout space is `calc(n * var(--u))`: spacing
tokens, control height, font sizes, table column tracks, chart and viewport
floors, the grid's column and row tracks. `n` may be fractional, so fonts land
on fractional pixel sizes (14px → `3.5u` → 10.5px at 0.75, 21px at 1.5).
Browsers lay out and rasterise fractional font sizes routinely.

`4px` is chosen as the default because it is already the stored grid quantum
(`ROW_UNIT_PX`, `COL_UNIT_PX`), so at scale 1 one drawn cell is one stored
cell and the migration is a pure renaming of values, verifiable by pixel
identity.

### The exemption rule

> **Anything exempt from scale must occupy zero layout space.**

A card's floor is the sum of the layout-space lengths it contains. A 1px
border inside the box model is a fixed term in that sum, so the floor in
stored cells would drift with scale — the same defect in miniature. Exempt
decorations are therefore drawn in forms CSS does not count toward size:

| decoration | forbidden form | required form |
|---|---|---|
| card / control border | `border: 1px …` | `box-shadow: inset 0 0 0 1px …` or `outline` |
| row hairline | `border-top/bottom: 1px` | `box-shadow: 0 -1px 0 …` or an absolutely positioned `::before/::after` |
| radius | — | `border-radius: 6px` (never affects layout) |
| shadows, focus rings, grip dots, detent cues | — | `box-shadow` / `outline` / `text-shadow` (already zero-layout) |

`letter-spacing` scales (it is part of reading). Media-query breakpoints stay
in screen px (they are about the device, not the layout). Pointer-physics
constants — edge-scroll thresholds, drag step budgets, drop-jump tolerances —
stay in screen px (they are about the hand, not the layout).

### The control

`shell/scale.ts` replaces `shell/density.ts`, same shape:

- `SCALES` — the declared steps: `075 · 0875 · 100 · 1125 · 125 · 150`. The
  stylesheet is the authority on what a step *is*; this list is the authority
  on which exist. An id with no CSS block renders as the default; it cannot
  render as something broken.
- One attribute, `data-scale`, on `<html>`. Scale 1 is the **absence** of an
  override: there is no `[data-scale="100"]` block, so the default is written
  down once and cannot drift from the step that claims to be it.
- Per-device preference in `localStorage["dwc-ng.scale"]`; never the config
  overlay (same reasoning as pitch: shop monitor and phone want different
  scales from the same machine).
- The old `dwc-ng.density-pitch` key is read once and mapped
  `127→100, 080→0875, 050→075, 040→075`, then ignored. No setting vanishes.
- Shell toggle replaces `DensityToggle`. Its note that cards must be resized
  after a change is deleted because it is no longer true.

**Range.** 0.75 is the floor because controls are hit targets: `--ctl-h` is
`7.5u` (today's 28px + 2px bump = 30px) → 22.5px at 0.75, above the 20px
floor density already refused to cross.
1.5 is the ceiling because beyond it the canvas (624u = 3744px) stops fitting
any screen usefully and the goal is readability, not magnification.

### The grid

- `ROW_UNIT_PX = COL_UNIT_PX = 4` remain the **stored** format. Frozen: a
  format whose meaning depends on a display preference is not a format.
- The **drawn** unit for both axes is `var(--u)`:
  `grid-template-columns: repeat(GRID_COLS, var(--u))`,
  `grid-auto-rows: var(--u)`. `rowUnitPx()` becomes `unitPx()` and serves both
  axes; `--row-unit` is deleted.
- `contentRowSpan` and `contentColSpan` both divide measured px by `unitPx()`.
  (Row already does; column divides by the literal today — that is the width
  half of the bug.)
- Stored layouts need **no migration**. The `v: 4` format is unchanged.
- `migrateRowGranularity` keeps using the frozen constant (existing test
  `density.test.ts` "the row migration must use ROW_UNIT_PX" carries over).

### The stylesheet pass

- `index.css`: every spacing/size token becomes `calc(n * var(--u))`. The four
  `[data-pitch]` blocks are deleted. `--fs-bump` is deleted; each font size is
  written directly in `u` (e.g. `calc(14px + var(--fs-bump))` → `4u`, since
  today's effective size is 16px).
- `app.css` (813 px lengths) and `dev/paletteLab.css` (17): every
  layout-space length → `u` multiple; every border/hairline → zero-layout form.
- TS/TSX (60 px tokens in 21 files): inline styles and geometry literals
  (`compose/defs.ts` sizes are already in cells; `panelCanvas.ts` constants
  split into stored-format, pointer-physics, and drawn — drawn ones read
  `unitPx()`).
- CodeMirror's editor font size is set by us and joins `u`. uPlot, Babylon,
  the heightmap surface and the camera size from their containers and follow
  for free.
- All edits are made with the Edit tool or `newline=''` writers — the files
  are mixed CRLF/LF.

## Enforcement

### The lint — one pipeline for the invariant

A `node:test` in `packages/ui/test/unit-lengths.test.ts` that reads every
`.css`, `.ts`, `.tsx` under `packages/ui/src` and **fails `pnpm test`** on any
absolute-unit token — `px`, `PX`, `vh`, `vw`, `rem`, `pt`, `in`, `cm`, `mm`,
`pc`, or a `` `${n}px` `` template — unless:

1. it is the value of an exempt property — `border-radius`, `box-shadow`,
   `outline`, `outline-offset`, `text-shadow`, `filter`, `backdrop-filter`;
2. it is inside a `@media` prelude;
3. it is one of the `--u` definitions in `index.css`; or
4. the line carries a `/* px-ok: <reason> */` marker, and the test prints every
   marker so the allowlist is a visible, reviewable list rather than a silent
   one. Expected members: pointer-physics constants in `panelCanvas.ts` and
   `edgeScroll.ts`; `1px` in hairline `box-shadow` forms is already exempt by
   rule 1.

A `border: 1px` anywhere fails. A new `min-height: 150px` fails. A
`max-height: 52vh` fails. There is no second way to write a length, so the
invariant cannot be bypassed by forgetting it.

**Rung 4, not 7 — corrected 2026-08-21.** This originally claimed rung 7 and
"a build error", and it is neither: `pnpm build` is `tsc -b && vite build` and
never runs `node:test`, and the repo has no CI and no git hook. The lint is as
strong as described; the *gate* is "someone ran `pnpm test`", which is a lint,
which is rung 4. See the follow-up at the end of this document.

The lint is written **first**, red against today's source (≈870 hits), and the
migration is done when it is green. That makes the migration's completeness a
counted fact, not a memory of what was converted.

### The assertion — the claim stated so it can fail

Card Lab layout audit gains a **scale sweep**: for every card, render at
`data-scale` 075 and 150 and assert

```
contentRowSpan(card @ 0.75) == contentRowSpan(card @ 1.50)   ± 1 cell
contentColSpan(card @ 0.75) == contentColSpan(card @ 1.50)   ± 1 cell
```

(±1 for `Math.ceil`.) Any card that fails is a card still containing a
layout-space pixel the lint could not see — a canvas sized by script, a
third-party stylesheet — and the failure names it. The sweep runs in a
foreground browser like the existing audit (jsdom has no layout engine).

### Pixel identity at scale 1

Before/after the CSS pass, a screenshot diff of each composed screen at
`data-scale` absent was the falsifying check for "the default renders exactly
as before": it can fail, and if the migration mis-converts a single value it
will.

**It did fail, in eight places, and this is the measured truth rather than the
plan.** The migration is NOT pixel-identical at scale 1. Every difference below
was deliberate — each is a defect the pass had to fix in order to make the
length scale at all — and each is recorded here so nobody re-derives them as
regressions:

| Where | Scale-1 delta | Why it was accepted |
|---|---|---|
| Borders throughout | 2px → the hairline is now an inset `box-shadow` | `border:` occupies layout space, which is the whole defect; a shadow ring does not |
| `.om-tree` | `max-height: 52vh` → flex-fill | a viewport fraction inside a card is a floor that moves with the window, not with `u` |
| `.field input`, `.console-form input` | gained an explicit width plus a `min-width` floor | they used to size from the intrinsic default, which is font-metric-derived and does not follow `u` |
| `.heat-table td` | padding +0.5px per side | `--sp-cell` rounds to the nearest half-unit; the alternative was a literal |
| `.fw-warn` | text 3px left; gold bar 2px wide | the bar was a `border-left`, now an inset ring, and the text sits against the ring instead of the border box |
| `.mode-key.is-applied` ring | 2px → 1px, **restored to 2px in the 2026-08-21 review pass** | the wholesale `box-shadow` restatement lost a layer; the dead `--gcode-border` it set was deleted at the same time |
| `input[type=checkbox]` | now an explicit size, Chromium-identical | the UA default differs between engines, so "identical" was only ever true on one; on Firefox this is a visible change |
| Speed slider thumb / track / stops | unchanged at scale 1, and now **frozen in px** | pointer targets; 3.5u is 10.5px at 0.75, which is not a target. `SpeedSlider.stopOffset()` carries the same 14px and says so |


## Testing

| Check | Host | Fails when |
|---|---|---|
| `unit-lengths.test.ts` | `pnpm test` | any non-exempt absolute-unit token exists (px/PX/vh/vw/rem/pt/in/cm/mm/pc, `` `${n}px` `` included) |
| `scale.test.ts` (port of `density.test.ts`) | `pnpm test` | default has a CSS block; a step lacks `--u`; `--u` not monotonic in scale; old pitch key maps wrongly; migrations use `unitPx()` instead of the frozen constant |
| `panel-canvas.test.ts` additions | `pnpm test` | `contentColSpan` divides by a literal; stored format changes |
| Card Lab scale sweep | Edge, foreground | any card's cell floor differs between 0.75 and 1.5 |
| Screenshot identity at scale 1 | Edge | default render changed |
| Manual: Edge at 0.75 and 1.5, desktop and mobile width | Edge | jitter, reflow, clipped control, unreadable hairline |

## What is out of scope

- Declared floors, archetypes, `heightForWidth`, the declared-vs-measured
  oracle (`2026-07-30-layout-archetypes-design.md`). Unaffected, and simpler
  afterwards because every floor is already in `u`.
- Layout profiles (desktop/mobile × portrait/landscape). A different feature.
- A continuous scale slider. Presets were chosen so "works at every scale" is
  a finite list that can be QA'd, not a continuum.
- Browser zoom keeps working on top of this; it multiplies `--u` like
  everything else.

## Risks

- **Size of the pass.** ≈870 CSS edits and ≈30 TS edits. Mechanical; the lint
  counts them down to zero and the screenshot identity check catches a wrong
  quotient. Still the largest single CSS change the project has made — it
  should land as one commit per file, each leaving the build green and the
  default render identical.
- **Hairline contrast at small scale.** Hairlines stay 1px by exemption, so
  they do not thin; but at 0.75 a `0.5u` gap beside a 1px line may visually
  merge. Verified by eye at 0.75 on the manual pass; the fix, if needed, is a
  larger `n`, not a px.
- **Third-party stylesheets.** CodeMirror ships its own px values for gutters
  and padding. The lint does not see `node_modules`; the Card Lab sweep does.
  Overrides for anything that contributes to a card floor are written in `u`
  in `app.css`.
- **Rounding.** Cell floors are `Math.ceil(px / unitPx())`; at non-integer `u`
  a card can need one more cell than at another scale. The ±1 tolerance in the
  sweep is that rounding. A card exactly at its floor may show up to 1 cell
  (≤ 6px) of slack at some scales; the resize stop rounds up, so it cannot
  clip.

## Follow-ups

Out of scope for the ten migration tasks, and open as of the 2026-08-21
review pass:

- **Composed default `rowSpan`s are too small for this machine, at every
  scale.** `compose/screens.ts` ships defaults sized for a smaller printer;
  on the 7-axis / 4-tool toolchanger the Fans, Extruders, Movement, Firmware
  update and Object model cards all open shorter than their content. This is
  not a scaling defect — the floors ARE scale-invariant, they are simply
  below the content — but it is what an operator sees first on a fresh
  layout, so it reads as one.
- **Promote the Card Lab scale sweep to CI.** It is the only check that can
  see a pixel hiding behind a script-set inline style or a third-party
  stylesheet, and it is manual (`dev/card-floor-scale-invariant`, rung 4).
  The same CDP driver already used for the floor sweep would serve.
- **Promote `ui/unit-lengths` from rung 4 to 6.** The lint is a `node:test`;
  `pnpm build` is `tsc -b && vite build` and never runs it, and this repo has
  no CI and no git hook, so the gate is "someone ran `pnpm test`". Running it
  from a pre-push hook or in CI makes it mechanically unavoidable. The debt
  ceiling was raised 21 → 22 to record the honest rating
  (`packages/invariants/debt-ceiling.json`).
