# Card UI/UX Specification — dwc-ng panel system

*This document is written to be handed to another AI as a prompt. It is a
complete, self-contained description of how cards behave in this UI, including
the reasoning behind each rule, because most of these rules were arrived at by
fixing something that broke.*

---

You are implementing (or reviewing) a card-based control panel UI. Follow this
specification exactly. Where it gives a number, that number is load-bearing —
it was measured, not chosen for looks.

## 1. What a card is

A **card** is a rectangular panel on a user-arrangeable grid. It has a header
(title + a "tip" chip naming the underlying data source or G-code) and a body
of controls. The user can move it, resize it, and reset the whole layout to
defaults. Layouts persist per view.

Cards are the *only* container. There are no modals, no dialogs, no popovers,
no drawers that overlay content. An action that needs confirmation confirms
**in place**, on the control itself.

## 2. The grid

```
columns:        624 fixed columns × 4px, NO column gap
rows:           4px, NO row gap
card gutter:    0 — no margin on the card at all
card height:    4 × rowSpan px          (card width: 4 × colSpan px)
separator:      the card's own 1px inset ring, at zero layout cost
```

The 4px here is the *stored* quantum. What is drawn is `var(--u)`, which is
4px at scale 1.0 and 3px / 6px at the 0.75 / 1.5 steps; the stored numbers do
not move with it. See `docs/superpowers/specs/2026-08-21-global-unit-scaling-design.md`.

### Why the gutter is zero

The gutter used to be an 8px margin on the card, which made every card's
border box `4n − 8`. Zeroing it (2026-08-29, Gabe: minimal padding between
cards) puts the box on exactly `4n` — *more* on the quantum than before, not
less — and hands every card back 8px on each axis at scale 1.

Nothing was added to replace it. Two abutting cards are told apart by the ring
each already draws: `box-shadow: inset 0 0 0 1px`, back to back, reads as a
~2px seam. **The separator is cheaper than the gap it replaced** — an inset
ring occupies no layout space, so it cannot appear in a card's floor and
cannot drift with the scale, which a 1px margin would have done on both
counts. A literal `1px` gutter was the obvious alternative and was rejected
for exactly that: it needs a lint escape and it lands every card on `4n − 1`.

Consequence worth knowing before you measure anything: **every card's floor
dropped by exactly 2 cells on both axes** when this landed, because the gutter
was a term in the sum. Floors got looser, never tighter, so nothing that fitted
before can clip now.

### Why rows are 4px with no gap

**The vertical quantum must equal the greatest common divisor of your widget
heights.** If rows are coarse, a card can never be sized to its content — the
slop is baked in by construction and no amount of careful measurement removes
it. This system previously used 24px rows with a 6px row gap, a **30px
quantum**, which meant up to 29px of dead space per card no matter what.

The row gap is **zero** on purpose. A gap adds itself back into the quantum
(24 + 6 = 30). The visual gutter moved onto the card as a margin so the quantum
stayed 4 — and has since gone to zero as well (§ above), which put the card
box on the quantum exactly rather than 8px under it.

### The rhythm rule (critical, and the part most often missed)

**Every vertical dimension inside a card must also be a multiple of the
quantum.** It is not enough for the grid to be fine. If chrome sums to a
non-multiple, content totals sit permanently off-grid and exact fit is
impossible *at any granularity* — a finer grid would only let you get within
1px instead of landing on it.

Concretely, all of these are multiples of 4:

| Element | Value |
|---|---|
| control height | 28px |
| control gap | 8px |
| card header height | 20px (explicit — do not let the font decide) |
| header bottom margin | 8px |
| body bottom padding | 8px |
| card bottom gutter | 0 (was 8px — see §2) |

The header height **must be set explicitly**. Left to the font it measured
18px, which put every card 2px off the rhythm.

## 3. Controls: one height

**Every interactive control is exactly 28px tall.** Buttons, text inputs,
number inputs, selects, chips, checkbox rows. One exception is permitted: a
large touch target (e.g. a directional pad) at exactly **2× (56px)**, so it
still lands on the rhythm.

This is the single highest-value rule in the document. Before it, this UI had
**seven distinct control heights (25/27/30/31/32/46/60)** — and three of them
came from the *same component*, varying by whether an optional sub-label
rendered and whether the label wrapped. **Content whose height varies cannot be
fitted to.** Everything downstream (card sizing, dead-space elimination, the
resize detent) depends on control height being knowable.

If a component has an optional second line, put that content **inline instead**.
A two-line variant is how a component acquires three heights.

## 4. Card sizing

Default row spans are **computed from measured content**, not guessed. Measure
the rendered content height, then `rowSpan = contentHeight / 4`. (The formula
still carries a `+ gutter` term in code — `contentRowSpan(cardEl, gutterPx)` —
because the gutter is read back off the element rather than assumed; it is 0
today, and the term is what would keep the arithmetic right if it ever were
not.)

- Cards whose content is **fixed** (a form, a fixed set of buttons) are trimmed
  to exactly what they draw.
- Cards whose content **grows with machine state** (a progress block that
  appears mid-job; one row per tool/fan/axis) carry deliberate headroom.
- Cards whose content is **unbounded** (a file list, a log, an editor, a
  viewport) are *not* trimmed. Their unused height is **capacity, not waste** —
  they scroll. Measuring one of these can legitimately report *negative* dead
  space, meaning content already overflows.

**Never trim a card so tightly that it overflows into a scrollbar.** A
scrollbar on a fixed-content card is worse than slack. When in doubt, add a row.

## 5. Resizing: the detent

Resizing snaps to the 4px grid. In addition, the bottom edge has a **sticky
detent at the card's exact content fit**:

1. Dragging down, the edge **stops** at the minimum and stays there while the
   pointer keeps moving — so the exact fit is something you *feel*.
2. Pull ~20px (5 rows) further and it **releases**, continuing to shrink. The
   content then scrolls. This is a detent, **not a wall** — the user may go
   smaller if they mean to.
3. The release is **continuous**: at the frame it breaks away the span is
   *exactly* the minimum, and from there it tracks the pointer with the
   breakaway distance subtracted. Without this the card jumps by the breakaway
   amount the instant it lets go.
4. It **re-arms** on the way back up at the same point, so the detent is felt in
   both directions.

The detent is felt through the frame catching, not shown with a colour: an
earlier version highlighted the card border while at the minimum, but it fired
on the row dimension even during a width resize, used a warning-adjacent colour,
and lit up constantly once cards were fitted to their content minimum by
default. The sticky hold is the cue; a border was noise.

Computing the minimum: measure from the **card's own top** to the last child's
bottom, plus body padding and border. Do not add the header separately if the
header is a child of the measured container — that double-counts it and puts
the "minimum" *above* the card's current height, so the detent catches above
where the card already is.

## 6. Nothing inside a card may move when the card resizes

This is absolute. Sweep every descendant while squeezing a card to 40% of its
height; the only things permitted to change are:

- the scrolling container itself,
- the resize grip (it lives on the bottom edge),
- a deliberately bottom-anchored element (e.g. a log's input bar).

The header in particular is a flex child of the scroll container and **will be
compressed by `flex-shrink` unless pinned** (`flex: 0 0 <height>`). Symptom: the
title creeps upward as the card shrinks.

## 7. Positional stability (applies at all times, not just during resize)

A live-updating UI must not jitter. Anything that changes at runtime must not
change the geometry around it.

- **Numeric readouts**: `font-variant-numeric: tabular-nums` **and** a reserved
  `min-width`. `"0%"` and `"200%"` are different widths and this updates on
  every poll.
- **Two-state buttons** (e.g. `Delete` ⇄ `Confirm`): reserve the *wider* label's
  width. A confirm step whose target moves between the two clicks it demands is
  a trap. Verify by measurement: both states must report identical width and
  identical right edge.
- **Messages and errors**: reserve the line's height and toggle `visibility`,
  not `display`. An error appearing must not push the content below it.
- **Values that flip between text and a placeholder** (a name ⇄ `—`): reserve
  the width.

## 8. Alignment within a card

- **Rows of same-purpose buttons use an equal-column grid**, not a wrapping
  flex row. Labels vary in length (especially if they embed user-configured
  names), and flex-wrap gives every button its own width. Symptom to check for:
  N buttons with N distinct widths and N distinct left edges, nothing lining up
  between rows.
- Use `repeat(auto-fill, minmax(<min>, 1fr))` so alignment survives renaming or
  adding an item.
- **When a button cluster leads a row, give the cluster a fixed width**, so the
  labels that follow it align across rows even when one row has one button and
  another has two. Otherwise you have merely traded a ragged right edge for a
  ragged left one.

## 9. Card header

- Title left, at 20px fixed height.
- A "tip" chip beside the title naming the data source (e.g. the G-code the card
  sends, or the model path it reads).
- **All panel controls (drag handle, layout toggle, etc.) live in ONE
  absolutely-positioned cluster at the top-right**, spaced by a flex gap.

  Do *not* give each control its own corner offset. That is how a toggle ends up
  positioned top-left, directly on top of the title. One cluster means their
  spacing is a gap rather than two coordinates that can disagree, and a third
  control added later inherits the placement.
- Panel controls are **always visible**, not revealed on hover. A control you
  must already know about is not discoverable.

## 10. Confirmation and destructive actions

- Destructive actions are **two-step in place**: first click arms (label changes,
  colour changes), second click fires. No modal.
- The armed state must not resize the control (§7).
- **A destructive action must state what it will destroy, before it happens** —
  item counts for a recursive delete, the specific consequence for an
  irreplaceable file.
- For genuinely unrecoverable targets, require the user to **type the name**.
- Prefer making the dangerous variant *unreachable* rather than merely guarded:
  the operation that can destroy contents should require an object that can only
  be obtained by first counting those contents.

## 11. Feedback: a control must report its own outcome

**Every control that triggers a remote action must show whether it succeeded.**

- States: `idle → sending → sent | failed`, auto-returning to idle (~1.1s for
  success, ~3s for failure).
- The acknowledgement must follow the **actual response**, not the click. "Sent"
  must mean the far end accepted it.
- On failure, surface *why* — at minimum a visible marker plus the error text in
  a tooltip.
- **Never swallow errors.** `.catch(() => undefined)` on a user-triggered action
  is a defect. A refused command that produces no visible change makes a working
  control look dead, and the user reports it as broken.
- Every state must be a **colour change on fixed geometry**. Nothing resizes.

Recommended: a fixed-size status dot, absolutely positioned in a corner, whose
colour alone changes.

## 12. Optimistic updates and ordering

When a control both *commands* a value and *displays* it, and the displayed
value arrives back asynchronously:

1. On commit, the requested value becomes the displayed value **immediately**.
2. Any derived UI (scales, ranges, positions) recalculates around it **at the
   same time**.
3. The remote value catching up later must produce **no visible change** —
   because what is on screen already equals what it will derive.
4. Suppress "follow the remote value" while a command is in flight; a stale
   reading would otherwise clobber the number the user is looking at.
5. On failure, revert to the remote value — never leave a number on screen that
   nothing is actually running at.

Getting this wrong looks like: commit → revert to old → jump to new. **Three
visible states where there should be one.** Verify by sampling the rendered
state every ~60ms through a change and asserting the sequence contains no
intermediate revert.

## 13. Two controls may never occupy the same point

If a draggable handle and a clickable target can ever coincide, **one of them
wins permanently and the other is dead.** This is not a z-index problem —
whichever is on top owns the pixel.

Real example from this codebase: a slider whose scale was always `0 … 2×
current` put its handle permanently at the midpoint, and a snap-marker for the
current value at the same midpoint. The marker owned the pixel; **the slider
could not be dragged at all.**

Resolve by **spatial separation** (put the markers on their own row), not by
stacking. Verify with `document.elementFromPoint` at the handle's centre *and*
along its travel: the draggable element must own every one of those points, and
the markers must remain individually hittable.

## 14. Hiding a card

A card hidden because the underlying capability is absent must be reported as
**hidden to the layout engine**, not merely un-rendered. Otherwise its grid
cells stay reserved and block neighbouring cards from being moved or resized
into them.

It must still have a **default placement**, even when hidden — a panel the
layout engine has never heard of has nowhere to go on a machine where it *does*
apply.

## 15. Colour

Palette below is this project's; substitute your own, but keep the rules.

| Token | Value | Use |
|---|---|---|
| `--mask-900` | `#0b1626` | page ground, input wells |
| `--mask-700` | `#122238` | card surface |
| `--mask-500` | `#1b3350` | raised control |
| `--silk` | `#e9eef4` | primary text |
| `--silk-dim` | `#8fa3b8` | secondary text |
| `--hairline` | `rgba(233,238,244,0.09)` | dividers |
| `--accent-bright` | `#f0a050` | focus, selection, active handle |
| `--ok` | `#6fbf8f` | success / go |
| `--fault` | `#e05c4a` | failure / destructive |

Rules:

- **A control must look like a control.** A raised surface, a visible border, a
  real `:active` state that moves under the press. A flush background behind a
  9%-opacity hairline reads as a label, not a button — especially in dense rows.
- **Series colours must be perceptually distinct.** For any chart or multi-line
  display, compute pairwise ΔE and require **≥ 25**. Do not eyeball it. Two
  colours at ΔE 9 are indistinguishable no matter how different their hex codes
  look.
- **Reserve a colour by excluding it from the pool.** If one series has a fixed
  identity colour, that colour must not be a member of the palette others are
  assigned from — then a collision is unrepresentable rather than merely
  unlikely.
- **Index palettes densely by position among the items being coloured**, not by
  a raw model index. If a reserved item occupies index 0, indexing by model
  index both wastes the palette's first entry and shifts everything else.
- **Signed data needs a diverging scale centred on zero.** A sequential ramp
  reads −0.10 and +0.10 as unequal.
- Assert the ΔE floor **in a test**, with a red-check proving the threshold can
  fail. Otherwise a future palette edit reintroduces the collision silently.

## 16. Verification checklist

Do not claim any of this works without measuring it. For each card:

- [ ] Every rendered card height is a multiple of the quantum.
- [ ] No off-grid chrome value remains (header, margins, padding, gutter).
- [ ] Every control is exactly one height (plus the permitted 2× exception).
- [ ] Dead space below content ≈ the intended bottom padding, except where
      headroom or scroll capacity is deliberate.
- [ ] No fixed-content card overflows into a scrollbar.
- [ ] Squeezing a card to 40% moves nothing inside it (§6).
- [ ] Two-state controls measure identical width and right edge in both states.
- [ ] `elementFromPoint` along a draggable's travel returns the draggable.
- [ ] Every remote-action control shows sent/failed and surfaces the error text.
- [ ] An optimistic update produces no intermediate revert (sample at ~60ms).
- [ ] Chart/series colours all ≥ ΔE 25 pairwise.
- [ ] Default layouts are collision-free (assert in a test).

## 17. Principles behind all of the above

1. **Measure, don't eyeball.** Every number here came from a measurement, and
   several corrected an assumption that looked fine on screen.
2. **Make the broken state unrepresentable** rather than guarded. Exclude the
   colour from the pool; require an object that can only be obtained by doing
   the check; derive the value instead of storing it twice.
3. **Nothing moves under the pointer.** Ever.
4. **A control that cannot report its own failure is worse than no control** —
   it looks like it works.
5. **The quantum must divide everything**, not just the grid.
