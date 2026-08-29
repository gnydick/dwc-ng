# The config records EDITS, not STATE

- **Status:** Design accepted in principle (2026-08-28, Gabe's reframing of
  #146). One blocking question open — see "Blocking question". Not implemented.
- **Tracked as:** GIT_146 (#146 parent / #147 context).
- **Companions:** `docs/superpowers/specs/2026-08-28-layout-migration-design.md`
  (the ARD: every release migrates the card's layouts) and
  `docs/superpowers/specs/2026-08-28-layout-version-ownership.md` (which stamp
  owns a layout, and the canvas/config coupling invariant). This document is the
  third of the set and the only one that is about WHAT GETS WRITTEN rather than
  when or under which version.
- **Subsystems it binds:** `packages/ui/src/compose/` (screens, composition,
  share), `packages/ui/src/config/` (store, parse, types),
  `packages/ui/src/shell/panelCanvas.ts`, `packages/mock-duet`.

## The ruling

Gabe, 2026-08-28, on reading the first draft of #146 (verbatim):

> "so that prompt is a really bad way of saying to record individual edits and
> blame them"

and immediately after:

> "yes, rewrite 146 around record-edits-not-state"

**#146 is therefore no longer "make the wholesale write narrower."** It is: the
configuration document records the operator's EDITS, and every number in it is
blamable to the gesture that put it there. "Saving one screen rewrote seven
others" stops being the headline defect and becomes one symptom of the absent
concept.

The ruling is not new to this repo — it is the config module's own founding
rule, stated at `packages/ui/src/config/types.ts:1-11`:

> "defaults are code (this file) and immutable; user customization is a
> deep-partial OVERLAY on those defaults; reset = delete from the overlay, so it
> cannot fail and new defaults arrive automatically wherever the user hasn't
> customized"

Screen geometry is the one part of the overlay that does not obey it.

## The absent concept

The configuration document has no way to record that a number was authored by a
PERSON rather than inherited from the CODE.

Every other section of the overlay records edits and therefore needs no such
record: `setAxisRole` writes one letter's role and `clearAxisRole` deletes it
(`config/store.ts:643-648`); `setHeaterColor` / `clearHeaterColor` the same
(`:649-654`); `setThermalColors`, `setCamera`, `setCameraPrefs`, `setMacros`,
`setBed` all take a PATCH and every call site in the app passes exactly the one
field the operator touched (`cards/SettingsCards.tsx:173`, `:254`, `:272`;
`cards/FileCards.tsx:221`; `shell/Shell.tsx:160`; `shell/CameraPanel.tsx:121`).
In all of those, "the operator authored this" is not stored — it is DERIVED from
the key being present. Absence means "not customised", which is what makes
"reset = drop the overlay" total and free.

Screen geometry breaks the derivation, in one direction only: the write path
puts numbers into the file that no gesture produced, so presence stops meaning
authorship. Once presence is meaningless, everything downstream that needs to
know "is this the operator's?" has to invent a second channel — and each
invention is a separate instance of the same absence.

## Class search

Per `CLAUDE.md` § Working rules (verification discipline), a class ruling must
enumerate every instance in the changed layer BY NAME. The layer searched:
`packages/ui/src/config/`, `packages/ui/src/compose/`,
`packages/ui/src/shell/panelCanvas.ts`. The searches run: every write method on
`ConfigStore` and each one's call sites; every `keys.set` / `keys.remove` in
`panelCanvas.ts`; every construction of a rect literal (`grep -n "colSpan:"`
across the three directories, registry sizes excluded by inspection); every
caller of `setScreenCard`, `replaceAllScreenCards`, `replaceScreenLayout`,
`captureScreenGeometry`, `adoptLayout`, `writeCanvasState`, `ensureSlot`,
`removeSlot`, `resetSlot`.

### Instances — the file contains numbers no gesture produced

| # | Site | What it is |
|---|---|---|
| I1 | `compose/screens.ts:463-484` `captureScreenGeometry` (sole caller `cards/SettingsCards.tsx:711`) | Loops EVERY screen and, per screen, EVERY card of the MERGED composition (`:470`), writing each as a concrete rect through `replaceAllScreenCards` (`:477`). The bulk producer of unattributed numbers. |
| I2 | `shell/panelCanvas.ts:1714` | The canvas key is written UNCONDITIONALLY at construction, with the full merged state. It destroys the only fact I1's skip guard (`screens.ts:467`) reads, so one visit to a screen enrols it in every future Save. Provenance is lost at canvas construction, not at Save. |
| I3 | `shell/panelCanvas.ts:1695-1696` | `sizedNow` is unioned with every id in `seedFromOverlay`. On a machine whose file is already fully resolved — Gabe's, today — every card reads as operator-sized. Any rule keyed naively on `sized` writes everything on exactly the machines that need the fix most. |
| I4 | `shell/panelCanvas.ts:1798-1877` `markOperatorSized` | Records SPANS only, by design and with a stated reason (`:1826-1830`: "A MOVE deliberately marks nothing"). Correct for its own invariant; insufficient as a general authorship mark, which is why it must not be repurposed as one. |
| I5 | `config/parse.ts:37-42` `asSlotRect` | Rebuilds a rect from four fields and silently drops `orientation`, on every read from SD and from the localStorage cache. An operator's rotation is deleted on a round trip. |
| I6 | **`compose/share.ts:183-188`, a SECOND private function also named `asSlotRect`** | Same four-field transcription, same silent drop, in the share IMPORT path — while `exportScreen` (`share.ts:141-144`) deliberately writes orientation with a comment saying a screen that arrives with every direction reset "is not the screen that was shared". Export preserves it; import throws it away. **Not previously enumerated anywhere.** |
| I7 | **`compose/screens.ts:352` `savedScreenLayout`** | Third four-field transcription: builds the canvas seed as `{col,row,colSpan,rowSpan}`, dropping `orientation`. This feeds `createPanelCanvas`'s `seedFromOverlay` AND `layoutBasis`, so a new browser seeded from the card gets geometry without direction even if I5 and I6 are fixed. **Not previously enumerated anywhere.** |
| I8 | `shell/panelCanvas.ts:1719-1726` | The orientation seed is all-or-nothing: a single stored toggle (`Object.keys(stored).length > 0`) discards EVERY composition-supplied orientation for that screen. A state fact overwrites a set of edits wholesale. |
| I9 | `compose/screens.ts:429-443` `replaceScreenLayout` vs `:451-457` `orientationsOf` | The same orientation-splitting loop, inline at one call site and as a function at the other. The skill's own tripwire (§4.3): a processing step duplicated at a second call site means the design is already wrong. |
| I10 | `config/store.ts:82-93`, `:586-592` `markLayoutDirty` | One global boolean. "Which screen moved" and "which card moved" are facts the save path does not have, and cannot have, because nothing records them. |
| I11 | `compose/share.ts:128-146` `exportScreen` | Exports `entry.def.composition` — the MERGED composition — i.e. fully-resolved state, the same shape as I1. **Deferred, not fixed:** a share file lands on a machine running a different build whose coded defaults differ, so the resolved form is arguably correct there. It must be DECIDED rather than inherited; see open question Q4. |

### Instances — an operator edit with no durable home at all

The mirror image of the same absence: these are edits, correctly recorded as
edits, that exist only in one browser's `localStorage` because the config
document has no field for them. They cannot be blamed, exported, or migrated,
and a wholesale Save is the only thing that has ever carried any of them.

| # | Site | What it is |
|---|---|---|
| I12 | `shell/panelCanvas.ts:1733`, `:1763` `parked` | Where a hidden card's rect goes so hide→show restores the spot. Browser-local; no config field; never travels. |
| I13 | `shell/panelCanvas.ts:1883-1898` `hiddenLabels` (`labels` key) | Per-card label hiding. Browser-local; `screens.hidden` in the config is hidden SCREENS, not labels (checked: `config/types.ts:175`). **Note its comment: "stored as the EXCEPTION set rather than a value per card ... an empty store means everything as shipped."** That is record-edits-not-state, already implemented, in the same file. Geometry is the outlier, not the norm. |
| I14 | `shell/panelCanvas.ts:2321-2337` `reset()` and its `cleared` flag | The operator's "put this screen back" is a positive record — browser-local only. The card keeps the old resolved copy, and the next Save from a browser that never reset re-materialises it. |
| I15 | `shell/panelCanvas.ts:1841-1848`, orientation store | Orientation is per-browser in the canvas and per-slot in the config, with I5/I6/I7 severing the second. Two homes for one edit; see `A5.7` — a bound may exist in exactly one place. |

### Checked and found NOT to be instances

Recorded so the search is auditable rather than a claim.

- Every non-layout `ConfigStore` setter and its call sites (enumerated above):
  edit-shaped, with a matching `clear*` or a single-field patch. No default is
  ever materialised.
- `setShaping({ envelope })` (`config/store.ts:682-697`): writes a whole
  envelope, but the coded default is `null` (not a field-wise default), so there
  is nothing to materialise; absence already spells "unset" and the code says so.
- Custom screens' `cards` record (`store.ts:762`): for a user-created screen the
  record IS the composition — there is no coded layer beneath it, so resolved and
  authored are the same thing by construction. `replaceAllScreenCards` says this.
- `writeCanvasState` (`panelCanvas.ts:2417-2422`) marking every id of an imported
  layout operator-sized: consistent with #132's ruling that an applied import is
  the operator's own act. Correct as designed.
- `ensureSlot` / `removeSlot` (`panelCanvas.ts:1930-1966`): persist with origin
  `"composition-reconcile"`, which is silent and marks nothing. Correct — and
  under Design A below this stops being incidental and becomes load-bearing.

## The two candidate designs

### Design A — write-through on gesture

Drag/resize end calls `setScreenCard(screenId, cardId, rect)` for that one card,
exactly as membership edits already do (`ComposedScreen.tsx:420`, `:424`).
Save stops touching geometry. `captureScreenGeometry` is DELETED.

Attribution is not stored — it is structural. The file cannot contain an
unattributed number because no code path can put one there.

**Ladder placement, from the mechanism and not from the wording:**

- **Rung 6 on landing.** A choke point: per-card geometry has exactly one
  producer (`setScreenCard`), and the whole-layout producer
  (`replaceAllScreenCards`) is left with a SINGLE caller, `replaceScreenLayout`,
  which is the import/preset/restore route. That is a real improvement to an
  existing rung-6 invariant (`config/screen-layout-two-tier`, `store.ts:194-213`)
  whose filed debt says the danger is that `replaceAllScreenCards` "is still
  reachable from anywhere holding the store, and its name is the only thing
  saying the caller owes the second tier".
- **Rung 7 available, and cheap once A lands.** Brand the rect: `setScreenCard`
  and `replaceAllScreenCards` accept only a value mintable by the canvas's
  `persist(…, "operator-gesture")` path. This is the same move #132 made one
  layer down (`serializeCanvas` takes the operator-sized set as a REQUIRED
  parameter) and is verbatim the promotion the store's own `@debt` row names.
  Bypass then becomes a compile error.
- **Rung 8 for the specific property "the file holds a rect nobody placed"** once
  the branded type exists AND the import route is the only wholesale one: the
  state has no expression. Claimed only with the branding; without it the claim
  is rung 6 and must say so.

### Design B — provenance carried through the canvas

Keep the bulk export. The canvas tracks owned-vs-coded per card — a real `sized`
covering moves and orientation, persisted to SD — and Save exports only owned
cards.

**Ladder placement:**

- **Rung 6 at best, and it is the rung `sized` already occupies** — a choke point
  over a required parameter (`panelCanvas.ts:1798-1830`). B is not a new
  mechanism; it is an extension of a shipped one.
- **It cannot reach 7 or 8 on the property that matters.** The fact "the operator
  authored this card" would be stated TWICE — once by the card's presence in the
  file, once by its membership in the mark set — and nothing makes them agree.
  `A5.7` (a bound may exist in exactly one place) and `A5.3` (co-location is not
  a mechanism) both apply directly. `A5.8` applies to the persisted mark set: it
  is a mirror of gesture history with no generator, and a drift test would report
  divergence after someone wrote it.

**B's specific, verified liabilities:**

1. It inherits I3. `panelCanvas.ts:1695-1696` unions the mark set with every id
   in `seedFromOverlay`, so on Gabe's already-resolved card every card is owned
   and B's filter passes everything. B must fix I3 before it can work at all —
   and I3 exists for a stated reason (#132: "a layout the operator SAVED TO THE
   CARD is the strongest operator gesture there is"), so fixing it means
   overturning a shipped ruling, not patching an oversight.
2. It puts a new field on the layout document that must survive to SD. That is
   exactly the case `docs/superpowers/specs/2026-08-28-layout-version-ownership.md`
   § "Ruling 2" names: a canvas change that forces a config change, requiring a
   `CANVAS_FORMAT_VERSION` bump, coupling, migration registry entry, and mock
   parity. A adds no field.
3. It keeps a store-to-store sync (canvas marks → config export) and adds
   bookkeeping to it. A deletes the sync.

### Verdict

**Design A.** Not because it is smaller — because the two designs sit on
different rungs for the same property. B tops out at rung 6 with two artefacts
that must agree; A reaches 6 immediately and 7-8 with a branding step this repo
has already performed once, and it removes the duplicated fact rather than
maintaining it. Technique 8 (derive, don't duplicate) is the whole argument:
under A, "the operator authored this" IS "the key is present", the same
derivation every other section of the overlay already relies on.

The brief's prior read — "A removes a store-to-store sync rather than adding
bookkeeping to it" — is upheld, with one correction: that is a consequence, not
the reason. The reason is that B cannot express the invariant without stating it
twice.

## What Design A costs, and what it makes harder

Stated plainly, because none of these are hypothetical.

1. **Reflow displacement is the sharp edge.** A drag that collides pushes
   NEIGHBOURS clear (`panelCanvas.ts:386`, `:415`). Those cards' rects change
   without being gestured directly. Under A, either they are written (and a
   single drag enrols untouched cards — the materialisation problem returns,
   bounded to actual collisions instead of all nine screens) or they are not
   (and the file disagrees with what the operator sees, because the coded rect
   would re-collide on the next mount). This is unresolved and is part of the
   blocking question below. It is the single largest risk in A and the reason
   this document does not claim A is free.
2. **Multi-card gestures need a batched write.** `setScreenCard` is one card;
   a selection move (`panelCanvas.ts:415` moves a whole patch) and any reflow
   change several at once. Either N calls inside one `apply`, or a
   `setScreenCards(screenId, patch)` sibling that still cannot express "replace
   the record". The wholesale method must NOT be reused for this — that is the
   invariant `screen-layout-two-tier` exists to protect.
3. **`layoutBasis` restamping moves.** Today the canvas is restamped inside
   `captureScreenGeometry` (`screens.ts:481`) because that is when the overlay
   changes. Under A the overlay changes on every drop, so the restamp must move
   to the persist path or the next mount reads the browser as stale and tells the
   operator a layout was dropped (#87's notice, `ComposedScreen.tsx:210`).
4. **Local-only layouts that were never Saved are lost at the cut-over.** A
   browser that has dragged but never pressed Save holds geometry only in
   `localStorage`; `captureScreenGeometry` was the path that would eventually
   have carried it. Deleting it drops that path. A one-time capture at the
   upgrade is possible but is itself a wholesale resolved write — so it belongs
   to #130's migration, under Gabe's decision, not to a silent boot-time write.
5. **Pre-conversion layout migration loses its carrier.** `screens.ts:394-399`
   states that `captureScreenGeometry` is "the whole migration story for
   pre-conversion layouts: their historic keys are read here and captured on the
   first save." That story must be re-homed in #130 or explicitly abandoned.
6. **`adoptLayout` / wholesale import is unaffected and must stay that way.**
   `replaceScreenLayout` (`screens.ts:429-443`) writes both tiers and remains the
   sole legitimate whole-layout write. Its rects are all the operator's by #132's
   import ruling (`panelCanvas.ts:2422`, `:1858-1861`), so A does not contradict
   it. What changes is that this becomes the ONLY caller of
   `replaceAllScreenCards`, which is what makes the rung-7 branding cheap.
7. **`ensureSlot` / `removeSlot` reconciles must be provably config-silent.**
   They already are (origin `"composition-reconcile"`), but under A that property
   carries the invariant instead of merely being tidy, so it needs a test that
   fails if a reconcile ever writes a config byte.
8. **Multi-browser conflict granularity changes.** Today the last Save wins
   wholesale; under A, per-card writes from two browsers interleave. This is
   strictly finer-grained and almost certainly better, but it IS a behaviour
   change to the machine-scoped overlay and should not be discovered later.
9. **Write frequency.** One `apply` → `prune` → `commit` → localStorage cache
   write per gesture DROP (not per frame — `persist` is called once on drop,
   `panelCanvas.ts:1872-1878`). SD is untouched until Save. Measure before assuming
   it is free.

## What A does NOT do — the bytes already on the card

**The redesign is PROSPECTIVE ONLY.** Gabe's card holds a fully-resolved copy of
all nine screens (7346 → 9995 bytes, measured 2026-08-28). A changes what is
WRITTEN from now on; it cannot re-blame numbers already written, because the two
cases it would have to distinguish — "the operator placed this exactly here" and
"the save resolved it here" — are byte-identical, which is the finding #132
already established and this design accepts rather than re-litigates.

So for the existing bytes there are exactly three honest options, and all three
are decisions rather than inferences:

- **#130's migration** rewrites them under a rule Gabe picks (keep everything as
  the operator's — safe, no repair; or drop everything — loses real edits).
- **An explicit operator gesture**: full `reset()` per screen, or per-card
  `resetSlot` (`panelCanvas.ts:2353-2367`), both of which already exist.
- **Accept them**, and let #134's render-time floor cover the clipping.

A migration that GUESSES which spans are fossils is ruled out by the same
argument in both directions and must not be proposed as a fourth option.

## The behaviour change the operator will see

**Cards he never touched will begin to move and grow on upgrade.** That is the
intent — it is what "a later release can still reach this card" means — but it
is a visible consequence and must be named as one: after A lands and the card's
existing resolved copy is cleared, a release that re-measures a card's floor
(GIT_90 and GIT_128 both did on 2026-08-28) will change that card's size on his
screen without him doing anything.

**Should it be surfaced in the UI?** Recommendation, for Gabe to accept or
reject: yes, minimally, through the channel that already exists —
`noteDroppedMachineSection` (`config/store.ts:621-624`), rendered by the
machine-identity card, which is how #87 already tells the operator that a layout
changed underneath them. A one-line note per screen ("N cards follow the app
defaults and moved in this release") is honest and costs no new surface. The
alternative — silence — is defensible only if the operator is expected to read a
release note. Not decided here.

## Blocking question for Gabe

**What counts as "moved"?**

Not answered in this document, deliberately. The proposal, for acceptance or
rejection:

- (a) **A gesture marks the card as the operator's**, and the card is written.
- (b) **A per-card reset CLEARS the mark** — i.e. removes the key from the
  overlay — so reset genuinely returns the operator to the coded layout
  *including future versions of it*, rather than pinning today's coded values.
- (c) **Drag a card and drag it back:** under (a)+(b) it stays owned, because the
  key is present. The alternative — comparing against the coded rect and deleting
  the key when they match — is what `markOperatorSized` ALREADY does for spans
  (`panelCanvas.ts:1861-1867`: "A span landing exactly on its coded default
  UNMARKS instead"), so there is a shipped precedent for the value-equality rule
  and the two halves of the app would otherwise disagree.
- (d) **Reflow displacement** (cost 1 above): is a neighbour pushed clear by the
  operator's drag the operator's card, or not? This has no precedent to inherit
  and no answer that is obviously right.

**The existing reset paths and what each must do under A** (verified, not
recalled):

| Path | Today | Under A |
|---|---|---|
| `panelCanvas.ts:2353-2367` `resetSlot(id)` | Sets the canvas rect to the coded default via `persist(…, "operator-gesture")`; clears that slot's `parked` entry and orientation. Writes NO config. | Must call `setScreenCard(screen, id, null)`… except `null` today means TOMBSTONE (`store.ts:786-793`, #86's written-down removal), not "unset". **"Reset this card" and "remove this card" need different spellings, and today they have one.** This is the concrete shape of (b) and cannot be waved through. |
| `panelCanvas.ts:2321-2337` `reset()` (whole screen) | Writes `serializeCanvas({}, …, cleared=true)`, removes `orientation` and `parked`, clears `sizedNow`. Writes NO config. | Must delete the screen's overlay entry entirely — but tombstones for deliberately removed cards must survive, so it is "delete every non-null value", not "delete the key". |
| `store.ts:247` `resetSection` / `:256` `resetAll` | Drop overlay sections. | Unchanged; A makes them MORE correct, since dropping a sparse overlay returns the coded layout exactly. |

## Reconciliation with the sibling tickets

- **#132 (`sized`) — LEAVES STANDING. Not dead code, not a foundation.** It
  answers a different question in a different store: whether a span in THIS
  BROWSER's `localStorage` record was operator-set, which `growToDefaults`
  (`panelCanvas.ts:1176-1252`) needs and which A does not touch. Local records
  still predate releases after A lands, so the canvas-tier ambiguity survives.
  **It is a hazard only if repurposed:** I3 (`:1695-1696`) makes `sized` say
  "everything" on a fully-resolved machine, so it must never be read as
  config-tier authorship. Under Design B it would have had to be the foundation —
  which is a further count against B.
- **#134 (floor enforcement) — LEAVES STANDING, unaffected, still wanted.** A
  reduces the population of below-floor stored spans prospectively; it does not
  make a below-floor span unrepresentable, and nothing in A protects the bytes
  already on the card. **A does add one constraint to #134's implementation:** a
  floor-raise at load must be a `"composition-reconcile"`, never an
  `"operator-gesture"` — #134's own open question Q3 asks exactly this, and under
  A the answer is forced. A floor-raise recorded as an operator edit would write
  a number the operator never chose and freeze it against the next release,
  reintroducing this ticket's defect through the fix for its symptom.
- **#130 (per-release migration) — LEAVES STANDING and is REQUIRED.** A is
  prospective; #130 owns the existing bytes (see above), and it inherits two jobs
  A drops: pre-conversion layout capture (cost 5) and the never-Saved local
  layouts (cost 4).
- **Ownership spec's C6 (one rect type, one sole-producer parser) — SUBSUMES
  #146's orientation requirement, and is now larger than it looked.** The class
  search found THREE four-field transcriptions, not one: `config/parse.ts:41`
  (I5), `compose/share.ts:187` (I6), `compose/screens.ts:352` (I7), against
  `compose/composition.ts:209` `toSlotRect` which does carry orientation. C6 must
  cover all four or it fixes one third of the defect.

## Mock parity owed when this is built

`CLAUDE.md` § Working rules (development environment): a change to what the UI
reads from or writes to the board updates `packages/mock-duet` in the SAME
change. What is owed:

- The seed builder (`packages/mock-duet/src/files.ts:258-320`,
  `buildConfigSeed`) must be able to serve a **sparse** `screens.layouts` — the
  post-A shape — and a **fully-resolved nine-screen** file, the pre-A shape that
  is on Gabe's card today, so the upgrade and the migration can both be driven.
  `--frozen-screen` (`src/cli.ts:80`, `FROZEN_MACHINE_SCREEN`) is the existing
  partial-override precedent to extend, not to duplicate.
- Slots in the seed must carry `orientation`, so the round trip that I5/I6/I7
  break is exercised end to end rather than only in a unit test.
- If Design A's write-through changes nothing about the FILE FORMAT (it does not
  — sparse is the same shape with fewer keys), no `CONFIG_VERSION` bump is owed
  and `CONFIG_VERSIONS` (`src/cli.ts:104`) is unchanged. If the reset spelling in
  the blocking question introduces a new value alongside `null`, that IS a format
  change and the coupling invariant in the ownership spec fires.

## Open questions

1. **(d) above — reflow displacement.** Blocking; no precedent.
2. **The reset spelling.** `null` is taken by tombstones. "Unset" needs its own
   encoding or its own method (`clearScreenCard`), and which one is a format
   question, not a naming one.
3. **Does write-through make `markLayoutDirty` (`store.ts:586`) redundant?**
   `setScreenCard → apply → commit` already marks dirty. If it does, delete it
   rather than leaving it — `A5.18`.
4. **Does the export path need the resolved form?** (I11.) An exported screen
   lands on a machine running a different build. If yes, `exportScreen` keeps
   resolving and the file says why; if no, a sparse share file inherits the
   receiving machine's coded defaults, which may be the better behaviour and is
   certainly the more surprising one.
5. **Orientation on a fresh browser** (I8): a single stored toggle discards ALL
   composition-supplied orientations for the screen. Fix here or file separately?

## What this document does not do

It does not implement. It does not answer the blocking question. It does not
rate #130's migration options beyond ruling out a guessing migration. GIT_146
builds, after Gabe answers.
