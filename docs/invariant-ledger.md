# Invariant ledger

Invariants that do **not** yet sit as high on the enforcement ladder as the
language allows, each with the promotion that would close it. Debt is allowed;
silent debt is not.

Ladder, short form: 0 comment · 1 convention · 2 runtime assert · 3 tests ·
4 lint · 5 shared helper · 6 choke-point (sole visible route) · 7
sole-constructor type (bypass = compile error) · 8 illegal state
unrepresentable.

---

## L1 — A wholesale layout replacement writes both layout tiers

**Invariant.** Replacing a screen's layout outright (import today; presets or
restore tomorrow) writes *both* the config overlay and the per-browser canvas
store. Writing one alone delivers a shredded layout.

**Why it matters.** A screen's geometry lives in two deliberate tiers
(ratified 2026-07-22, `f426706`): the per-browser canvas store wins locally,
and the config overlay rides to SD to seed a new browser. `mergeCanvas`
assembles what renders **card by card** from whichever tier holds each id. So
a replacement that writes only the overlay loses every card the browser
already knew, and keeps only the ones it had never seen.

**How it surfaced.** Reported 2026-07-24 as "machine import didn't work" —
while the Control import had appeared to work. Same code path. Control's file
carried cards this browser had not seen, so they took the file's positions;
Machine's carried only known cards, so every imported position lost and
nothing moved. The outcome was decided by overlap, which is not a design.

**Current rung: 5** (shared helper, optional use).
`replaceScreenLayout` (`compose/screens.ts`) writes both tiers, but
`ConfigStore.updateScreenCards` remains public with four direct callers:

| Site | Intent | Correct today? |
|---|---|---|
| `ComposedScreen.tsx:180` | add custom card | ✓ incremental |
| `ComposedScreen.tsx:231` | toggle card | ✓ incremental |
| `ComposedScreen.tsx:240` | card studio save | ✓ incremental |
| `compose/screens.ts:288` | `captureScreenGeometry` (canvas → config sync) | ✓ by design |

All four are correct *by inspection*, which is rung 1. Tests
(`test/screen-layout-replace.test.ts`, incl. a red check reproducing the
shredding) are rung 3 and pin only the path that exists.

**Stranger test: FAILS.** Someone adding a preset loader reaches for
`updateScreenCards` — it is public, it is the obvious name, and the
surrounding code calls it four times — and reintroduces the bug with no
warning.

**Promotion to rung 7.** Remove `updateScreenCards` from the public
`ConfigStore` interface and expose two named intents:

- `updateScreenMembership(id, cards)` — incremental; the canvas syncs
  per-card through the existing `ensureSlot`/`removeSlot` effect.
- `replaceScreenLayout(id, rects)` — wholesale; writes both tiers.

Then "write screen geometry without declaring which kind of change this is"
has no encoding — there is no third thing to reach for, and the operation's
name carries the requirement. Scope: one interface change plus the four call
sites above.

**Deferred** 2026-07-24 at Gabe's direction ("ledgered"), immediately after
the rung-5 fix shipped. Not blocked — just not now.
