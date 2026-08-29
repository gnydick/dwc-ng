# Capturing Gabe's Settings arrangement as the CODED default

Date: 2026-08-28. Status: filed, not implemented. Ticket pair: #152 (parent) /
#153 (`Context: #152`), both labelled `GIT_152`.

## The request (verbatim, Gabe, 2026-08-28)

> "as for layout, none of the default layout for settings will do. make an issue
> for me to lay it out and you capture what should be the default"

Read literally: the CODED default for the Settings screen
(`SETTINGS_COMPOSITION`, `packages/ui/src/compose/screens.ts:209-228`) is
rejected. Gabe will arrange the screen himself in a running browser, and that
arrangement becomes the coded default — it lands in `screens.ts` (and in the
`size` pins in `compose/defs.ts` where those must agree), shipped to everyone.
It is explicitly NOT to be left as his personal overlay.

## Relationship to #146 (record edits, not state)

This spec sits directly on top of `docs/superpowers/specs/2026-08-28-record-edits-not-state.md`
and must not contradict it. Two points of contact:

1. **#146 says the config records the operator's EDITS.** This task moves an
   arrangement in the OPPOSITE direction — out of the operator's overlay and
   into the code. That is consistent, not contradictory: #146 governs what the
   *config document* may contain; this task governs what the *coded default*
   is. The capture route chosen below deliberately does not go through the
   config document at all (§ Mechanism, M2), so it neither depends on nor
   entrenches the resolved-state write #146 is deleting.
2. **#146's `captureScreenGeometry` is being DELETED** (Design A). Any capture
   route that depends on a Save running `captureScreenGeometry`
   (`screens.ts:463-484`) is therefore building on a function with a scheduled
   demolition date. M3 below is exactly that, which is a second reason M2 wins.

## The trap: orientation is silently dropped on three separate paths

This is the single most likely way this task fails without anyone noticing, so
it is a first-class requirement, not a footnote. Every card's orientation is a
number-free fact — if it is lost, the col/row/colSpan/rowSpan all still look
right and nothing complains. All three sites re-verified by opening the file on
`main` @ `8df4a98`, 2026-08-28:

| # | Site | What it does | Verified |
|---|---|---|---|
| O1 | `packages/ui/src/config/parse.ts:37-42` `asSlotRect` | destructures exactly `{col,row,colSpan,rowSpan}` and returns exactly those four; `orientation` is not read. Runs on EVERY config read — from SD and from the localStorage cache. | ✔ read 2026-08-28 |
| O2 | `packages/ui/src/compose/share.ts:183-188` | a SECOND private function also named `asSlotRect`, identical four-field rebuild, on the share IMPORT path — while `exportScreen` at `share.ts:141-144` deliberately DOES write orientation, with a comment saying a screen that arrived with every direction reset "is not the screen that was shared". Export preserves; import discards. | ✔ read 2026-08-28 |
| O3 | `packages/ui/src/compose/screens.ts:352` `savedScreenLayout` | third four-field transcription (`state[id] = { col, row, colSpan, rowSpan }`), on the path that seeds a NEW browser (`seedFromOverlay`) and computes `layoutBasis`. | ✔ read 2026-08-28 |

Only `compose/composition.ts:209` `toSlotRect` carries orientation
(`...(slot.orientation === undefined ? {} : { orientation: slot.orientation })`).
`SlotRect` (`config/types.ts:76-90`) DECLARES `orientation` with a doc comment
saying it lives in the slot precisely so it rides to SD:

> "it used to live only in localStorage under `<canvasKey>.orientation`, which
> meant it was in no persistence tier at all — it never exported, never
> imported, never rode to SD, and never seeded a new browser."

**Consequence, stated plainly:** if Gabe's arrangement is captured through any
of O1/O2/O3, every card he rotated comes back unrotated, and nobody notices,
because all the numbers look correct. A capture that loses orientation produces
a shipped default that is quietly wrong for every user, forever.

## Mechanism — what reads the arrangement out

### What already exists (investigated before proposing anything)

- **`compose/share.ts:128-146` `exportScreen`** — reachable from the shipped UI
  (`compose/ComposedScreen.tsx:551`, the "⤓ Export" button in the compose menu;
  not dev-gated). Emits `{dwcng:"screen", version, screen:{name, cards}, customCards}`
  with orientation preserved (`:141-144`). Reads `entry.def.composition` — the
  MERGED composition (coded ∪ overlay ∪ tombstones), i.e. resolved state.
  #146 flags that resolved-ness as instance I11, DEFERRED. Using it here for
  capture must not be read as blessing I11: capture WANTS the resolved form,
  sharing may not.
- **`compose/share.ts:183-188`** — the import counterpart, and O2 above.
- **`dev/LayoutAuditPanel.tsx:121` `auditCard`** (+ `dev/layoutAudit.ts`) —
  measures a card's CONTENT FLOOR from live DOM, at 0.75/1.0/1.5 scale
  (`ScaleSweepAll`, `:628`). It reports what a card NEEDS; it does not report
  where a card IS. It is the right tool for requirement 6, and the wrong tool
  for the capture itself.
- **`shell/panelCanvas.ts`** — holds the live canvas state per (machine,
  screen): `readCanvasState` (`:2440`), `readCanvasOrientation`,
  `serializeCanvas` (`:1035`ff), `CANVAS_FORMAT_VERSION = 4` (`:850`). This is
  the store every drag/resize/rotate writes to, so it is the closest artefact to
  the gesture itself.

**What is missing:** nothing turns any of these into TypeScript source text.
Every existing route ends in JSON or in the config document.

### The ladder

| Rung | Candidate | Verdict |
|---|---|---|
| 0 | **M0 — hand-transcribe numbers from devtools / the inspector into `screens.ts`.** | REJECTED. Thirteen cards × four-to-five fields, retyped. It drifts, and the failure is silent: a mistyped `row` looks exactly like a decision. |
| 0 | **M1 — Export the share JSON, then hand-copy its numbers into `screens.ts`.** | REJECTED. The JSON is generated but the transcription is not; the rung is set by the weakest step, which is a human retyping numbers. |
| 5–6 | **M2 — a dev-only "emit composition source" action (RECOMMENDED).** Reads `readCanvasState(machineStore, "settings")` + `readCanvasOrientation(...)` for the screen on screen, and emits the exact `SETTINGS_COMPOSITION` object literal as text (clipboard or download). The text is pasted into `screens.ts` WHOLE — no number is ever retyped. | RECOMMENDED. |
| 5 | **M3 — Save, then the shipped Export button, then a repo script that rewrites the literal.** Reuses only shipped code. | FALLBACK ONLY. See below. |

**Why M2 over M3.** M3 reads `entry.def.composition`, so orientation reaches
the export only if the overlay currently holds it — which is true only in a
session where a Save has just re-injected it from the canvas store
(`screens.ts:471` `orientations[id] ?? slot.orientation`). Reload the browser
first and O1 has already eaten it; open it in a fresh browser and O3 has. The
precondition "export in the same session as the Save, without a reload" is
prose, i.e. rung 0 guarding the exact fact most likely to be lost. M3 also
requires a Save, which today runs `captureScreenGeometry` and writes a
fully-resolved nine-screen overlay — the defect #146 exists to delete — and
therefore makes requirement 3 (clearing the overlay) strictly worse.

M2 reads the canvas store directly. It touches neither `parse.ts` nor
`share.ts`, so O1 and O2 cannot reach it; it needs no Save, so it writes no
config bytes and does not enlarge the overlay. O3 is irrelevant to it (it reads
the canvas, not the overlay).

**What M2's rung actually is, stated from the mechanism and not from
confidence.** The generation step is technique 14 (generate, don't
hand-maintain) and is a sole route: canvas record → emitted text → paste. That
makes "the coded default equals the arrangement Gabe made" **rung 5–6** — one
generator, no hand transcription, but a human still performs the paste and
could paste something else, edit it after, or capture the wrong screen. It
**cannot reach rung 7/8** while the destination is a hand-edited TypeScript
literal. The promotion, named and NOT taken here: make `SETTINGS_COMPOSITION`
generated at build time from a checked-in data file that the emitter is the
sole producer of, so a hand edit is a build failure. That is a larger change
than this ticket and is recorded as debt, not done.

**The red check (must FAIL if orientation is lost).** Before the paste, and
mechanically, not by eye: for every card id present in the browser's
`<canvasKey>.orientation` record for `settings`, the emitted text must contain
that same id with that same orientation value; and the count of orientation
entries in the emitted text must equal the count in that record. The check is
performed as part of the capture and its output is pasted into the ticket. It
is falsifiable: rotate one card, drop the orientation read from the emitter,
and the check reports a mismatch. A capture with no rotated cards at all does
NOT satisfy this check — it makes it vacuous, so the capture session must
include at least one deliberate rotate-and-verify before the real arrangement,
or the check has proven nothing.

## Clearing Gabe's overlay afterwards

Once his arrangement is the coded default, his own saved overlay still contains
a copy of it. Two facts make that harmful rather than redundant:

- Per #146 (measured on the printer, 2026-08-28): a Save writes ALL nine
  screens FULLY RESOLVED — `settings` was one of the seven rewritten screens,
  33 rect fields across 11 cards, with `console`, `camera` and `object-model`
  ADDED at values equal to the coded defaults.
- `compose/composition.ts:190-196`: an override slot replaces the coded slot
  **wholesale, spans included**.

So if his `screens.layouts.settings` is left in place, he is pinned to a frozen
copy of the very layout we just shipped and will never receive any future
change to it — including any floor re-measure. The clipping incident #146
documents is exactly this mechanism.

**Obligation (encoding NOT invented here).** The ticket must state how the
`settings` entry is cleared for Gabe, and must distinguish two intents that
share one spelling today:

- "reset this card / this screen to the coded default" — should let future coded
  changes through, and
- "remove this card from this screen" — a TOMBSTONE.

`null` in the overlay already means TOMBSTONE (`config/types.ts:140-168`,
`config/store.ts:775-795`, #86), so those two intents are currently
indistinguishable. #146 requirement 6 and its open question 2 own that
encoding; this ticket cites it and does not decide it. What this ticket DOES
require is that after the capture ships, a check confirms Gabe's overlay no
longer pins `settings` — the falsifying test is: bump a coded `rowSpan` in
`SETTINGS_COMPOSITION` after the capture and confirm it reaches his machine.

## Sequencing precondition — four unmerged branches and one unbuilt feature

All four branches below touch Settings pins or placement and NONE has merged as
of 2026-08-28. If Gabe arranges against a build without them, he is arranging
cards whose sizes are about to change under him, and the capture is stale before
it is pasted.

| Branch | Head at filing | What it moves in Settings |
|---|---|---|
| `GIT_136` | `38ee9c5` | `shaping-sweep` 118→134, `console` 307→323, `camera` 382→398 (Shaping screen rows; listed because the same shared cards appear on Settings) |
| `GIT_138` | `2dc3464` | `bed-probe` 45→54, `camera-config` 40→49, and EVERY row below them +9: thermal 161→170, sensor-names 237→246, filament-editor 309→318, settings-shaping & accelerometers 439→448, config-save 567→576, console 593→602, camera 668→677 |
| `GIT_142` | `cbc11d9` (being edited) | combined the accelerometer rows, re-pinned that card 156×128 → 312×64, moved it full-width under `settings-shaping`, displacing config-save/console/camera. A floor re-measure is IN FLIGHT after a UAT finding, so its numbers WILL change again |
| `GIT_144` | `050986f` | input caps; claims no pin changes (claim not independently verified here) |

Pending and unbuilt: **#150** adds a two-input threshold region to the top of
the Temperature Gradient card, growing that card and displacing everything
below it again.

**The numbers in this table go stale.** A later reader must re-derive them from
the branches themselves — `git log`/`git diff` against
`packages/ui/src/compose/screens.ts` and `defs.ts` — and must not trust this
table.

## What "capture" must produce

The artefact is:

1. The complete `SETTINGS_COMPOSITION` object literal in
   `packages/ui/src/compose/screens.ts` — every card's `col`, `row`, `colSpan`,
   `rowSpan`, plus `orientation` for every card that carries one.
2. Any `size` pin in `packages/ui/src/compose/defs.ts` that must change to
   agree with (1).

**The agreement invariant, as it exists today.** Measured on `main` @ `8df4a98`:
every one of the eleven registry-sized Settings cards is currently placed at
EXACTLY its `CARD_DEFS` size —

```
axis-roles 156×109  camera-config 156×40   tool-dock-sensors 156×76
saved-versions 156×40  bed-probe 156×45    heater-colors 156×76
thermal-colors 156×60  sensor-names 312×72 filament-editor 312×130
settings-shaping 156×178  config-save 312×26
```

(`console` and `camera` are the shared cards that deliberately take per-screen
sizes.) So any captured span that differs from the registry is a deliberate
deviation and must be named as one.

**The tests it must satisfy, not be pasted and hoped for.**

- `packages/ui/test/composition.test.ts:80-105` — "built-in screen compositions
  are collision-free and round-trip parse". `settings` IS in that list
  (`:94`). It asserts `parseComposition(composition)` deep-equals the input and
  `hasCollisions(...)` is false. Note what it does NOT check: a card placed
  smaller than its registry size passes this test, which is exactly how the
  Shaping Decay card came to be shipped clipped (the test's own comment,
  `:95-99`).
- `packages/ui/test/composition.test.ts:182-197` — the registry-size assertion
  (`"${id} rowSpan: placed ${slot.rowSpan}, needs ${natural.rowSpan}"`) is
  **scoped to Shaping only** on `main`, deliberately (`:177-180`: the other
  built-ins genuinely place shared cards at per-screen sizes).
- **Correction to the brief this ticket was filed from:** the message
  `"bed-probe rowSpan: placed 45, registry says 54"` is not from a test on
  `main`. It comes from a NEW test that `GIT_138` adds —
  `.claude/worktrees/GIT_138/packages/ui/test/composition.test.ts:217-225` —
  scoped to `["bed-probe", "camera-config"]` ONLY, matching Gabe's "those two
  cards ONLY" ruling. Once `GIT_138` merges, the capture must satisfy that test
  too, for those two cards.

## Floors — a captured arrangement is not automatically valid

Per **#134** (OPEN, `GIT_134`): a card's minimum binds ONLY inside the resize
gesture. Verified on `main`: `minColSpan`/`minRowSpan` are declared at
`shell/panelCanvas.ts:154-155` and read at `:2214` and `:2230`, both inside
`startResize` (`:2155`); a repo-wide grep for `minRowSpan:` finds **zero
producers** — nothing ever sets them. Every load/merge/restore path bottoms out
at 1. So an arrangement can be captured, parsed, shipped, and rendered with a
card below its own content floor, and no code path objects.

**Requirement:** every captured card is measured with `auditCard`
(`dev/LayoutAuditPanel.tsx:121`) across the 0.75 / 1.0 / 1.5 scale sweep
(`ScaleSweepAll`, `:628`) and compared against the captured `rowSpan`/`colSpan`.

**Policy when a captured card is below its floor — decided here, so the
implementer does not have to guess:** the capture is REJECTED for that card and
one of two things happens, chosen explicitly and recorded:

- **(a) the floor is re-examined.** A floor can itself be wrong: #142 found a
  reserved clash slot inflating `.color-clash`'s floor by 35u until it was
  re-derived. If the floor is wrong, fix the floor, re-measure, re-check.
- **(b) Gabe re-places the card.** If the floor is right, the arrangement is not
  shippable as drawn and he decides the alternative.

**Silently clamping is forbidden**, because a clamp makes the shipped default
differ from what he arranged with nothing saying so — the same silent-divergence
shape as the orientation drop.

## Scope

**Settings only.** Gabe named Settings. The same procedure would generalise to
the other eight screens and probably should, later — but widening it is not in
this ticket. Precedent, same evening: he ruled a similar widening down on #138
("those two cards ONLY").

## The per-profile question — answered by the code, so NOT asked

CLAUDE.md requires four saved layout profiles per machine (desktop/mobile ×
portrait/landscape). The question was whether the captured default is one of
four, and if so which. The code answers it:

- `SETTINGS_COMPOSITION` (`compose/screens.ts:209`) is a single `Composition`.
  There is no profile dimension in the type.
- `ScreenLayouts` (`config/types.ts:168`) is
  `Record<screenId, Record<cardId, SlotRect | null>>` — screen id to cards, with
  no profile key.
- The per-browser canvas record is keyed by (machine, screen) only
  (`shell/panelCanvas.ts:1409-1410`, `readCanvasState(store, screenId)` at
  `:2440`).
- The grid is fixed and viewport-independent: `GRID_COLS = 624`
  (`panelCanvas.ts:37`), cells are `var(--u)` and a card's cell size "only ever
  depends on its own colSpan; a narrower window" does not re-flow it
  (`:97`). Settings' full-width cards span 312 of the 624.

So there is exactly ONE coded default and ONE stored layout per screen today,
and it applies at every width and scale. A single capture at any width is
therefore sufficient and complete, and no `needs-input` is warranted. **Recorded
assumption, not a decision:** if the four-profile requirement is ever
implemented, this capture is the layout the profiles are derived FROM, and
whoever implements profiles must decide whether it seeds all four or only the
desktop-landscape one. That is that ticket's question, not this one's.

**Correction to the brief:** the grid is 624 columns, not 312. 312 is the width
Settings' full-width cards happen to use.

## What could NOT be verified

- `GIT_144`'s "no pin changes" claim is taken from the brief; not independently
  checked, because its worktree is in use by a live agent and this pass touched
  no worktree but `main` (read-only greps into `GIT_138` excepted).
- `GIT_142`'s in-flight floor re-measure is by definition unfinished; its final
  numbers do not exist yet.
- #150's effect on the Temperature Gradient card's height is unbuilt, so its
  displacement is not quantifiable.

## Tickets

**#152** (parent) and **#153** (`Context: #152`), linked as the one permitted
sub-issue pair and both labelled `GIT_152`, per `docs/github-issue-rules.md`.
On governance — this pass
establishes **no standing rule** (Gabe issued a work request, not a ruling), so
no `docs/RULES-GROUPED.md` row and no `docs/rule-inbox.md` entry were added,
matching what the #130 and #146 filing agents did (they filed rows only for
Gabe's verbatim RULINGS).
