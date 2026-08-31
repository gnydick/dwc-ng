# Screen-global spacing tokens — design (GIT_194 increment 5)

2026-08-30. Parent #194, context #195, campaign #192. Increment 5 of the
control-framework extension: per-screen spacing a user can set — the gutter
BETWEEN cards on one screen, and the default body padding INSIDE the cards on
that screen. Both ride `--u`, both are overlay-on-defaults, reset drops them.

## 1. What exists today (verified in this worktree, 2026-08-30)

- The between-cards gutter is `--sp-card-gutter: calc(1 * var(--u))`
  (src/index.css:165), applied as `margin-bottom`/`margin-right` on every
  canvas child (`.panel-canvas > *`, src/app.css:300). GIT_170 (c59b398 →
  d54c366) drove it 2u → 0 → 1u and left the ruling in app.css:286-299: 1u is
  the FLOOR of the default because the card's drawn box is
  `span × u − gutter`, so a gutter that is not a whole number of cells takes
  the box off the grid quantum.
- In-card body padding is three tokens (src/index.css:127-129):
  `--sp-card-x` 4u (sides), `--sp-card-t` 1.5u (top — where the sticky
  header parks, app.css:358-360), `--sp-card-b` 2u (bottom), consumed by
  `.panel-body` (app.css:360).
- **Gutter vs stored geometry (finding required by the brief):** the gutter
  does NOT participate in stored geometry. `GAP_PX = 0` and both gutters
  "live on the card, not on the grid" (shell/panelCanvas.ts:90-91); the grid
  emits `repeat(GRID_COLS, var(--u))` with zero gaps (shell/PanelCanvas.tsx:
  18-25). Stored `PanelRect`s are pure cell counts. The gutter enters ONLY
  the derived, drag-time floors — `resizeHardFloor` and
  `contentRowSpan`/`contentColSpan`/`headerColSpan` take `gutterPx` read live
  off the element (`getComputedStyle(cardEl).marginBottom`,
  panelCanvas.ts:2201, and `.marginRight`, :2228) at gesture start. So a
  per-screen gutter override changes future resize stops (correctly — the
  gutter is part of what must fit in the span) and never rewrites, migrates,
  or invalidates a stored rect. Collision math never sees it.

## 2. Decisions

### D1 — Two per-screen values, machine-scoped, riding `screens`

```ts
/** Per-screen spacing overrides, in --u units. Absent key = shipped default. */
export interface ScreenSpacing {
	/** Between-cards gutter, whole cells. Integer 0..4. */
	gutterU?: number;
	/** Card body side padding; bottom padding derives as half. 0..8, half-steps. */
	padU?: number;
}
```

Stored at `MachineConfig.screens.spacing: Record<string, ScreenSpacing>`,
keyed by screen id (built-in or `u-` custom). Spacing is a layout fact about
how THIS machine's screens draw, exactly like `screens.layouts` — so it lives
in the machine half. `splitOverlay` (config/types.ts:395) learns the second
machine leaf: `layouts` AND `spacing` route to the machine side, the rest of
`screens` to the person side; `joinOverlay` needs no change (machine `screens`
spreads over person `screens`, keys disjoint). A falsifying test pins the
routing: an overlay `{screens: {spacing: {...}, renames: {...}}}` must land
spacing machine-side and renames person-side — RED before the types.ts edit,
because today `spacing` falls into `...rest` and would follow the PERSON
across machines.

### D2 — Granularity: gutter integer u; padding half-step u

- **Gutter: integers 0..4.** Derived from what the canvas can honor, per the
  GIT_170 ruling (app.css:286-289): the card box is `span·u − gutter`, so only
  a whole number of cells keeps the box on the quantum. 0 is expressible (the
  hairline seam still separates neighbours — same ruling); 4u is twice the
  pre-GIT_170 gutter, an ample ceiling.
- **Padding: half-steps 0..8.** Padding is inside the body and touches no
  grid quantum; the shipped tokens already use half-steps (`--sp-card-t`
  1.5u). Content floors measure the live DOM (contentRowSpan reads rendered
  padding), so any n×u value is honored automatically.

### D3 — One padding knob maps to x and b; t is structural

`padU = p` emits `--sp-card-x: calc(p * var(--u))` and
`--sp-card-b: calc(p/2 * var(--u))` — the shipped 4:2 ratio, so the control's
default position (4) reproduces the shipped look exactly. `--sp-card-t` is
NOT overridden: it is where the sticky header parks (app.css:358-360), a
structural gap, not breathing room.

**Precedence note (increment 4 coordination):** a card-level padding
override, if increment 4 lands one, is applied on the CARD element; these
screen tokens are applied on the CANVAS container. CSS custom-property
scoping then gives card-level the win by construction (nearer scope shadows
farther) — no code in this increment depends on inc4's existence.

### D4 — Application is a custom-property scope, no CSS edits

The one producer of emitted CSS is `spacingVars(spacing)` in the new
`src/config/screenSpacing.ts`: it returns the inline custom-property object
for the canvas container (`{"--sp-card-gutter": "calc(1 * var(--u))", ...}`),
or `{}` when nothing is overridden. `PanelCanvas` gains an optional `vars`
prop merged UNDER the grid metrics (grid metrics stay unoverridable).
`.panel-canvas > *` and `.panel-body` already consume the tokens via `var()`,
and custom properties inherit, so the existing stylesheet needs no edit.
Every emitted length is `calc(n * var(--u))` — the px lint
(test/unit-lengths.test.ts) scans TS/TSX too and stays green.

### D5 — Sole sanitation gate (cant-break-by-design)

`sanitizeScreenSpacing(raw: unknown): ScreenSpacing | undefined` in
`screenSpacing.ts` is the ONLY producer of a stored `ScreenSpacing`:

- non-object → `undefined`; non-finite / non-number members → dropped;
- finite numbers → clamped into range and quantized to the legal step
  (gutter: round to integer; pad: round to nearest 0.5) — the `clampRect`
  precedent (panelCanvas.ts:162-170): a corrupted stored value becomes a safe
  one, never a throw;
- empty result → `undefined` (the overlay's prune() then drops the key).

Callers: the untrusted overlay boundary (`config/parse.ts` `parseScreens`)
and the store writer (`setScreenSpacing`). Rung 6 choke-point — two callers,
one gate; promotion debt: brand `ScreenSpacing` so a literal cannot be
assigned (blocked on JSON round-trip to SD, same as `Envelope`'s @debt).

### D6 — Edited in the compose drawer; discrete steps, instant apply

The compose drawer (compose/ComposedScreen.tsx `ComposeDrawer`) already owns
the screen's own facts (rename / hide / delete / reset) — a "Spacing" section
joins it: two rows (Card gap, Card padding), each `− value +` steppers plus a
`↺` clear shown only while overridden. Precedent for commit semantics: the
UI scale is discrete steps applied instantly per click (shell/Shell.tsx:221,
`setScale` on click) — no drag exists, so no layout jitter under a drag by
construction; the drawer lives in the rail portal, outside the canvas, so an
applied step cannot move the control under the pointer either.

Writer: `config.setScreenSpacing(screenId, key, value | null)` — null clears
the one key; clearing both empties the record and prune() drops the screen
entry, so reset = drop the override, new defaults flow (the overlay
philosophy, config/types.ts:1-11). `removeScreen` also deletes
`spacing[screenId]` so a deleted custom screen leaves no orphan.

### D7 — No wire change; mock parity is a verification, not an edit

Spacing rides the existing overlay: persisted inside
`0:/sys/dwc-ng-config.json` via the existing rr_upload/rr_download path. No
new endpoint, no new OM key, no new file. Mock parity check = verify
packages/mock-duet stores/serves that file as opaque bytes (generic file
store), stated in the increment report.

## 3. Invariants (ledger rows)

| Invariant | Rung | Mechanism | Promotion |
|---|---|---|---|
| A stored ScreenSpacing is in-range and on-step | 6 | sole gate `sanitizeScreenSpacing`; callers: parse boundary + store setter | brand the type (blocked: JSON round-trip, same as Envelope) |
| Spacing never crosses machines | 6 | `splitOverlay` routes `screens.spacing` machine-side; test/config-scope pattern test fails otherwise | — (rides existing split choke-point) |
| Emitted lengths are n × --u | 4+6 | one producer `spacingVars` emits only `calc(n * var(--u))`; px lint fails any literal | — |
| Grid metrics unoverridable by vars | 7 | `vars` merges under `GRID_STYLE` in the one canvas component | — |
| Stored geometry is gutter-free | existing | `GAP_PX = 0`; floors read margins live at drag time (finding §1) | — |

## 4. Tests (red first)

1. `splitOverlay` routes `screens.spacing` to the machine half, rest person
   (RED against current types.ts — the falsifying test the brief requires).
2. `joinOverlay(splitOverlay(o))` round-trips an overlay carrying spacing.
3. `sanitizeScreenSpacing`: drops garbage (strings, NaN, Infinity, arrays),
   clamps 9→8 / −1→0, quantizes gutter 2.6→3, pad 3.7→3.5, returns
   `undefined` for empty/foreign input.
4. `parseOverlay` accepts a valid `screens.spacing` and drops a mis-typed one
   (`{spacing: "x"}`, `{spacing: {ctrl: {gutterU: "big"}}}`).
5. `spacingVars`: `{}` for no override; exact `calc(n * var(--u))` strings
   for gutter 0 (a REAL zero — `calc(0 * var(--u))`, not absence), pad 3
   (x 3, b 1.5); no other keys emitted.
6. Store: `setScreenSpacing` writes through the gate; null clears one key;
   clearing both drops the screen entry; `removeScreen` drops its spacing.
7. Existing suites stay green: px lint, Card Lab scale sweep (0.75/1.5 equal
   floors — spacing defaults untouched, so the sweep sees the same cards).

## 5. Files touched

- `packages/ui/src/config/screenSpacing.ts` — NEW: type, ranges, gate, vars.
- `packages/ui/src/config/types.ts` — `screens.spacing` in MachineConfig +
  DEFAULT; `splitOverlay` routes it machine-side.
- `packages/ui/src/config/parse.ts` — `parseScreens` gains the spacing leaf
  through the gate.
- `packages/ui/src/config/store.ts` — `setScreenSpacing`; `removeScreen`
  cleanup.
- `packages/ui/src/shell/PanelCanvas.tsx` — optional `vars` prop under
  GRID_STYLE.
- `packages/ui/src/compose/ComposedScreen.tsx` — canvas vars + drawer
  Spacing section.
- `packages/ui/test/screen-spacing.test.ts` — NEW: tests 1-6.
