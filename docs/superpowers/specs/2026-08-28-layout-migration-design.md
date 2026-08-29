# Layout migration across releases — architectural decision record

- **Status:** Accepted (2026-08-28). Dictated by Gabe, amended by Gabe within
  the same minute. Not implemented — see GitHub #130 / #131.
- **Kind:** ARD (architectural decision record). dwc-ng has no `docs/adr/`
  convention; `docs/superpowers/specs/` is where this repo's design decisions
  live, so this lands there. See "Where this lives, and why" below.
- **Subsystems it binds:** `packages/ui/src/config/` (the overlay envelope and
  its version), `packages/ui/src/shell/panelCanvas.ts` (the browser-local
  canvas record), `packages/deploy/` (the order in which a release reaches
  the card).

## The decision, in Gabe's words

Dictated 2026-08-28, verbatim:

> "ARD: we have to honor smooth migration path when there are updates. when the
> user interface is newer than the layout on the sd card, there has to be a
> migration to update the layouts stored on the card to the current version of
> the software. so every release needs a migration, if migration is needed, to
> modify the all layouts saved on the sdcard. if the UI sees a migration has
> happened, it trashes it's local storage and updates it with what's on the
> sdcard. we should also do a temp replacement of index.html with a simple
> 'Upgrade in process' so the web page is never loaded during a migration."

Amended by Gabe seconds later, verbatim:

> "change that to remove the 'if migration is needed'  all migrations will be at
> least a version upgrade in the layout files"

The amendment is recorded separately rather than folded into the quote above,
because it changed the decision within a minute of it being made and the record
should show what it replaced. **The conditional "if migration is needed" is
struck.** What stands is unconditional: every release ships a migration. The
floor case is not "no migration" — it is a migration whose only effect is to
raise the version stamp in the layout files on the card. A release that changes
nothing about layout semantics still bumps the stamp and still rewrites the
files.

## The four obligations

They are kept distinct because they are separable pieces of work and each can
be got wrong on its own.

### 1. Version comparison — UI against card

The running UI must be able to compare its own layout-format version against
the version stamped on the layouts stored on the SD card, and detect the case
"the UI is newer than the card". This is a comparison of a *layout* version
specifically, not merely the existing `CONFIG_VERSION` envelope check.

### 2. A migration every release, rewriting all layouts on the card

Every release ships a migration that rewrites **all** layouts saved on the SD
card to the current version. There is no "if needed" branch and no judgement
call about whether this release earned one. Where a release changed nothing
about what a layout means, the migration's whole effect is to advance the
version stamp on every layout file.

### 3. On detecting a migration, the UI discards local storage

When the UI sees that a migration has happened, it **trashes its local storage**
and re-seeds it from what is on the SD card.

**The tension this resolves, stated plainly.** Today local geometry and the
card's copy are *reconciled*, not replaced. `packages/ui/src/shell/panelCanvas.ts`
carries GIT_87's `basis` field: a canvas written to `localStorage` records which
card-side layout it was derived from, and on boot the stored record is kept when
its `basis` matches the basis computed from the current overlay
(`localIsCurrent = !proofCarrying || record.basis === basisNow`), and otherwise
re-seeded. That machinery exists to keep a browser's local arrangement across
ordinary reconnects. This decision says that **at a version boundary,
reconciliation is the wrong operation: the card wins outright.** The `basis`
mechanism is not deleted — it continues to govern the non-migration case — but
a detected version advance short-circuits it and discards local state rather
than trying to merge it.

### 4. "Upgrade in process" — no browser loads the app mid-migration

During a migration the served `index.html` is temporarily replaced by a simple
"Upgrade in process" page, so no browser can load the app while the layouts on
the card are being rewritten. The real `index.html` goes back last, after the
migration and the asset upload have completed.

## Consequences of the amendment

Two follow directly from the rule being unconditional, and both are load-bearing:

- **The placeholder is on every release, not an occasional path.** Because every
  deploy rewrites layout files on the card, the "Upgrade in process" window is
  entered every single time. Its cost and its duration therefore matter far more
  than they would for a rare migration: this is a per-release tax on every
  deploy, paid against RRF's weak embedded HTTP server, and the design must
  treat the window's length as a first-class number rather than an edge case.
- **"The card was written by an older UI" is always detectable.** Because the
  stamp always advances, a version difference is never ambiguous. The UI never
  has to guess whether a difference between what it expects and what the card
  holds is a version gap or a legitimate divergence — a lower stamp means older,
  full stop.

## Why now — the class of defect this aims at

On 2026-08-28 Gabe watched the Shaping screen on the printer render his correct
saved layout and then have a bad one paint over it. The suspected mechanism is
that browser-local canvas geometry survived a release that changed what the
composition contains, so stale local state fought newly-deployed code.

**That diagnosis is NOT confirmed** — a separate agent was still tracing the
call path when this record was written, and per `CLAUDE.md` § Working rules
(verification discipline) a behavioural diagnosis is not confirmed until the
chain is cited hop by hop. What is recorded here is narrower and does not
depend on the trace landing: this decision is the general answer to that
*class* of failure. At a version boundary the SD card becomes the authority and
local storage is discarded rather than reconciled, so a browser holding
geometry from before a release cannot paint it over a layout the new code
seeded.

## The design constraint — what must be unrepresentable

**A release that changes what a layout MEANS and ships without having answered
the migration question.**

A migration that somebody has to remember to write is rung 0 on the
`cant-break-by-design` ladder: prose in a checklist, enforced by memory. The
conditional form of this decision could not be enforced any better than that,
because "did this release need a migration?" is a judgement call, and there is
no mechanical check for a judgement someone forgot to make.

**The unconditional rule collapses the problem, and that is the point of the
amendment.** With no "if needed" branch there is no judgement to forget, and
the check reduces to arithmetic:

> The layout version stamp MUST be strictly greater than the previous release's.

That is a proposition a test can find FALSE. It is assertable against a
committed baseline — the same shape this repo already uses twice:

- `packages/deploy/eager-budget.json` + `packages/deploy/src/eagerBudget.ts`
  (invariant `eager-payload-cannot-drift-upward`, rung 6): a committed number,
  measured on the one path that puts bytes on a board, refused if it does not
  fit. Raising it is a diff, reviewed as a diff.
- `packages/invariants/debt-ceiling.json`: same shape, different quantity.

The layout stamp wants exactly that treatment: a committed baseline file
recording the previous release's stamp, and a check that fails when the current
stamp is not strictly greater. A release that did not bump it fails with no
human having to decide whether this particular release "needed" one. Raising the
stamp is then a visible diff, which is also the moment a reviewer is prompted to
ask what the migration body should actually do.

Two further constraints worth stating for the implementer, neither yet decided:

- The gate should ideally fire on the DIFF, not on the deploy. `eagerBudget.ts`
  records this as `@debt`: it gates the deploy, which is late, and the fix is
  blocked on this repo having no CI. The layout-stamp gate inherits that
  limitation and should say so rather than pretend otherwise.
- Registration of a per-release migration should be at a choke point, so that a
  bumped stamp with no registered migration is itself a failure rather than a
  silently-empty step.

## Where this lives, and why

dwc-ng has **no ADR or decisions directory**. Checked: no `docs/adr/`, no
`docs/decisions/`, nothing ADR-shaped anywhere under `docs/`. What exists is
`docs/superpowers/specs/` — 23 dated design documents, which is this repo's
established durable home for design decisions, and which
`.claude/skills/rule-intake/SKILL.md` names as the routing target for
"engine/design rules specific to one subsystem's build". Adding one more dated
file there follows the convention rather than inventing a location.

The sibling project `ferrislicer` does keep `docs/adr/` with numbered records
(`0001-coordinate-system.md` … `0008-config-provenance-and-inheritance.md`,
each with Status / Crate / Context sources / Context headings). That shape was
read for structure only, per CLAUDE.md's read-only-reference rule; no text was
taken. **If Gabe wants dwc-ng to adopt a `docs/adr/` convention, this file is
the natural first record and moving it is a rename plus a citation update in
`docs/RULES-GROUPED.md`.** That is proposed, not done — inventing a directory
unilaterally is exactly what the register exists to prevent.

## Current state of the code this touches

Recorded so the implementer does not re-derive it.

- `packages/ui/src/config/types.ts:474` — `CONFIG_VERSION = 3`.
  `types.ts:168` — `ScreenLayouts = Record<string, Record<string, SlotRect | null>>`;
  `types.ts:302` — `screens: { layouts: ScreenLayouts }`.
- `packages/ui/src/config/parse.ts:394` — `parseOverlayPayload` migrates
  forward: `version === 3` parses, `version === 2` parses unchanged (the v2→v3
  change was storage LAYOUT, handled in `migrateStorage.ts`), `version === 1`
  runs `migrateOverlayColumns` (the column-granularity rescale). A foreign or
  FUTURE version returns `null` — defaults, never a boot failure. Note the
  asymmetry this decision has to live with: the existing ladder migrates the
  card's bytes *in the reader, in the browser, on every read*. It does not
  rewrite the card. Obligation 2 is a different operation.
- `packages/ui/src/config/migrateStorage.ts` — the v2→v3 storage transform,
  and the precedent for "a local cache carries no proof of provenance, so drop
  it rather than guess" (invariant `legacy-key-single-mention`, rung 6). That
  reasoning is the same reasoning obligation 3 generalises.
- `packages/ui/src/shell/panelCanvas.ts:850` — `CANVAS_FORMAT_VERSION = 4`;
  `:985` `parseStoredCanvas` accepts only the current envelope version;
  `:1006` `serializeCanvas(state, basis, cleared?)` with `basis` REQUIRED;
  `:1565` the `localIsCurrent` reconciliation described in obligation 3.
  Note there are TWO version stamps already (`CONFIG_VERSION` and
  `CANVAS_FORMAT_VERSION`) and they are independent; the decision speaks of
  "the version of the layouts on the card", and which stamp that is — or
  whether a third, release-level stamp is introduced — is an open question the
  ticket must settle.

## Whether the deploy tool can express the placeholder ordering today

**It cannot, as written — but nothing in the transport seam forbids it.**
Checked in `packages/deploy/src/`:

- `deploy.ts:51` is a single flat loop over `manifest` in `walk(distDir)` order.
  There is no phase separation and no special handling of the entry document:
  `index.html` is one manifest row among the rest, uploaded whenever the walk
  reaches it. So "placeholder first, assets, real entry LAST" is not
  expressible in the current orchestration.
- `manifest.ts:65` `const ENTRY = "index.html"` and `manifest.ts:175`
  `entryUrl(name, layout)` already know which board path the entry occupies,
  and it differs by layout: `/index.html` in `root` mode, `/<name>.html` in
  `sidecar` mode. Gabe's deploy recipe uses `root`. A placeholder implementation
  must derive its path from `entryUrl`, never spell it out, or the two layouts
  drift.
- `transport.ts` exposes `put` / `read` / `remove` / `list` generically, so
  writing a placeholder byte-string to the entry path and later overwriting it
  is fully within the transport's vocabulary. No new transport capability is
  needed.
- Two existing behaviours interact with the change and must be reasoned about
  rather than assumed benign: the idempotence skip at `deploy.ts:55` (an
  unchanged file is not re-uploaded — with a placeholder written first the real
  entry always differs, so it does upload, but the interaction should be made
  explicit rather than incidental), and the orphan sweep at `deploy.ts:83`,
  which prunes anything in the deployment's own asset directory that is not in
  the manifest. A placeholder is by construction not in the manifest.
- `verify.ts` runs post-deploy against `entryUrl`; the ordering change moves
  when the entry is final, so verification must run after the real entry is
  restored, not before.

Per `CLAUDE.md` § Working rules (development environment), this change alters
what the UI reads from and writes to the board — a new/changed version stamp on
the layout files and a new deploy write order — so `packages/mock-duet` moves in
the SAME change, not afterwards.

## Open questions the ticket must settle

1. Which stamp is "the layout version"? `CONFIG_VERSION`, `CANVAS_FORMAT_VERSION`,
   or a new release-level layout stamp that subsumes both. Two independent
   stamps cannot both satisfy "strictly greater every release" without saying
   which one the gate reads.
2. Who runs the migration — the deploy tool writing the card directly, or the
   first UI to connect after the release. The "Upgrade in process" placeholder
   implies the deploy tool, since a UI cannot replace `index.html` before it
   loads.
3. What the placeholder window costs in wall-clock time on a real board, given
   it is now entered on every release.
4. How a migration is registered such that a bumped stamp with no registered
   migration is a failure rather than a silently-empty step.
5. What happens if a migration is interrupted (power loss, cancelled deploy)
   with the placeholder still in place. The card is then mid-rewrite and the
   served page is the placeholder forever until someone re-deploys. Whether
   that is acceptable, or whether the write must be made atomic, is undecided.
