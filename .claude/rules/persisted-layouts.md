---
status: 🟢
---
# Persisted layouts across releases

Moved 2026-09-02 from docs/RULES-GROUPED.md § Persisted layouts across releases; the
group's reasoning and the wobble history stay there, and each rule's authority is the spec
cited on its own bullet. All seven are one decision about the boundary between a RELEASE
and the layout state that outlives it: a layout lives in three places at once — code
defaults, the SD card, and browser `localStorage` — and a release can change what a layout
MEANS while all three still hold bytes written under the old meaning. One citation below is
deliberately unbackticked: the commit gate's section-citation matcher truncates a cited
heading at its first comma, so a heading containing one cannot be expressed in the
backticked form at all.

## Persisted layouts across releases

- Every release ships a migration that rewrites ALL layouts stored on the SD card to the
  current version — unconditionally, the floor case being a migration whose only effect is
  to raise the version stamp. Enforced as arithmetic: the layout stamp must be strictly
  greater than the previous release's, against a committed baseline in the
  `eager-budget.json` / `debt-ceiling.json` shape. (Gabe, 2026-08-28, as an ARD amended by
  him within the minute to strike the "if migration is needed" conditional.)
  `docs/superpowers/specs/2026-08-28-layout-migration-design.md` § The design constraint — what must be unrepresentable.
- When the UI detects that a migration has happened, it discards its local storage and
  re-seeds from the card. At a version boundary the card wins outright; GIT_87's `basis`
  reconciliation governs only the non-migration case. (Gabe, 2026-08-28.)
  `docs/superpowers/specs/2026-08-28-layout-migration-design.md` § The four obligations.
- During a migration the served entry document is temporarily replaced by an "Upgrade in
  process" page, so no browser loads the app mid-migration. Because migrations are
  unconditional, this window is entered on EVERY release. (Gabe, 2026-08-28.)
  `docs/superpowers/specs/2026-08-28-layout-migration-design.md` § The four obligations.
- `CANVAS_FORMAT_VERSION` is THE layout version: it owns layout migration and is the stamp
  the ratchet reads. `CONFIG_VERSION` stamps the non-layout configuration document only and
  carries no claim about what a layout means — which requires layouts to leave the
  `CONFIG_VERSION`-stamped overlay rather than merely being re-labelled. (Gabe,
  2026-08-28.) Spec, unbackticked for the reason given above:
  docs/superpowers/specs/2026-08-28-layout-version-ownership.md § What ruling 1 settles, and what it costs.
- A canvas-format change that FORCES a change to the configuration document must be coupled
  so neither stamp can advance alone — enforced by a mechanism, not a prose "must", since
  the two stamps have deliberately different disciplines: the layout stamp ratchets every
  release, while `CONFIG_VERSION` is read by equality and must bump only on a real shape
  change. (Gabe, 2026-08-28.)
  `docs/superpowers/specs/2026-08-28-layout-version-ownership.md` § Ruling 2 — the coupling requirement.
- The configuration document records the operator's EDITS, not the app's resolved STATE:
  geometry reaches the overlay only from an operator gesture, so a card's presence in the
  file IS its authorship and a card sitting at its coded default is absent — which is what
  lets a later release still move or re-measure it. (Gabe, 2026-08-28.)
  `docs/superpowers/specs/2026-08-28-record-edits-not-state.md` § The ruling.
- Attribution is STRUCTURAL, not stored: write-through on gesture is preferred over a
  persisted provenance mark, because a mark states authorship a second time beside the
  file's own key presence and nothing makes the two agree. The rule is prospective only —
  numbers already resolved onto a card can be repaired by a migration Gabe rules on or by
  an explicit reset, never by inferring which of them a person chose. (Gabe, 2026-08-28.)
  `docs/superpowers/specs/2026-08-28-record-edits-not-state.md` § The two candidate designs.
