# Layout version ownership, and the canvas/config coupling invariant

Companion to `docs/superpowers/specs/2026-08-28-layout-migration-design.md`.
That document records the ARD (every release migrates the card's layouts, the UI
discards local storage at a version boundary, an "Upgrade in process" page is
served during the rewrite) and left **open question 1 — which stamp is "the
layout version"** — undecided. This document records Gabe's answer to it, what
the answer costs elsewhere, and the new requirement he attached to it.

Tracked as GIT_130 (#130 parent / #131 context).

## The ruling (2026-08-28, Gabe, verbatim)

> "canvas_format_version owns it. but we need an invariant that enforces that
> changes in the canvas that requires changes in the config are coupled
> otherwise strange breakages can happen"

Two rulings in one sentence, and they are not the same kind of thing:

1. **Ownership.** `CANVAS_FORMAT_VERSION` is THE layout version. It owns layout
   migration and it is the stamp the #130 ratchet reads ("strictly greater than
   the previous release's"). `CONFIG_VERSION` is not a layout stamp and stops
   being treated as one.
2. **Coupling.** A canvas-format change that FORCES a config change must be
   coupled, such that neither stamp can advance alone. This is a NEW
   requirement, not a restatement of (1) — (1) removes the ambiguity about
   which number the ratchet reads; (2) closes the hole (1) opens, which is that
   two documents whose meanings are entangled now have two independent stamps
   and only one of them is watched.

## What ruling 1 settles, and what it costs

### The collision it removes

Layouts live today inside the config overlay — `ScreenLayouts`
(`packages/ui/src/config/types.ts:168`), reached as
`screens: { layouts: ScreenLayouts }` (`:302`) — so the bytes describing a
layout on the SD card are stamped by `CONFIG_VERSION` (`types.ts:474`, value 3),
while the bytes describing the SAME layout in the browser are stamped by
`CANVAS_FORMAT_VERSION` (`packages/ui/src/shell/panelCanvas.ts:850`, value 4).
Two independent numbers describing one meaning is why #130's ratchet could not
be written: "the layout stamp must be strictly greater every release" has no
referent while there are two of them.

The ruling picks one. It does not, by itself, stop the other one from also
being a layout stamp — that requires the move below.

### `CONFIG_VERSION`'s remaining scope

After the ruling, `CONFIG_VERSION` stamps the **non-layout configuration
document** and nothing else: axis role labels, tool dock sensors, thermal
colours, `renames` / `hidden` / `custom`, the snapshot history, and the
person/machine storage split that the 2 → 3 bump was actually about (its own
doc comment at `types.ts:467-473` says so). Its semantics are unchanged:

- Written at four sites — `config/store.ts:1021` (SD payload), `:1628`
  (machine handle), `:1533` (localStorage person cache), `:1368` (snapshots).
- Read back by **equality** at `config/parse.ts:402`, with a hand-written
  backward ladder for 2 and 1 and `null` (= defaults, never a boot failure)
  for anything foreign or future.
- Read by equality again at `config/migrateStorage.ts:187`, where a mismatch
  means "not this version's storage layout, re-derive".
- `packages/mock-duet` knows exactly versions 1/2/3 (`src/cli.ts:104`,
  `CONFIG_VERSIONS = ["1","2","3"]`).

None of that changes. What changes is that a `CONFIG_VERSION` bump no longer
carries any claim about what a layout means.

### What has to move for the ruling to be true of the code

The ruling is currently false of the code in three concrete ways. Each is work
GIT_130 owns:

1. **`CANVAS_FORMAT_VERSION` is file-private.** `panelCanvas.ts:850` declares it
   `const`, not `export const`, and it appears at exactly four lines, all in
   that file (`:850`, `:1016`, `:1042`, `:1061`). A stamp that never leaves one
   module cannot be the version the deploy ratchet reads, cannot be compared
   against the card, and cannot be written onto an SD document. It must move to
   a module both the canvas and the persistence layer read.

2. **Layouts must stop riding in the `CONFIG_VERSION`-stamped document.** While
   `screens.layouts` is a leaf of the overlay, a layout on the card is
   transitively stamped by `CONFIG_VERSION` no matter what this document says.
   Lifting layouts into their own envelope stamped by `CANVAS_FORMAT_VERSION` is
   what makes the double-stamping unrepresentable rather than merely deprecated.
   Note the interaction, not to be discovered later: `screens.layouts` is
   MACHINE-scoped while `renames` / `hidden` / `custom` are PERSON-scoped
   (`config/types.ts:387-403`; `splitOverlay` splits `screens` per leaf on every
   read and write), so a layout document cuts along the machine-scoped half
   only — it is not "the screens section".

3. **The canvas envelope's future-version behaviour is not fit to be the
   authority.** `parseStoredCanvas` (`panelCanvas.ts:1015-1021`) matches
   `parsed.v === CANVAS_FORMAT_VERSION`, then hand-written arms for 3, 2 and
   unversioned. A envelope stamped with a version NEWER than the running build
   (v5 seen by a v4 UI — a downgrade, or a second browser on a stale build)
   matches no arm and falls through to
   `migrateColGranularity(migrateRowGranularity(migrateLegacyDoubleWidth(parsed)))`
   applied to the ENVELOPE object, not to the state. That is not a discard; it
   is a garbage-in path. Once this stamp is the layout authority, "newer than me"
   must be an explicit, named outcome — which is exactly obligation 3 of the ARD
   (discard local, re-seed from the card).

Mock parity moves in the same change (`CLAUDE.md` § Working rules (development
environment)): `packages/mock-duet` must be able to seed a card whose layout
stamp is older, equal to, and newer than the UI's.

## Ruling 2 — the coupling requirement

**Stated as an invariant:** *a release in which the canvas format changes in a
way that forces a change to the configuration document cannot ship with only one
of the two stamps advanced.*

Read the failure it prevents literally, because it is not symmetric with #130's
ratchet. #130's ratchet says the layout stamp always advances. It says nothing
about `CONFIG_VERSION`, and it must not: bumping `CONFIG_VERSION` every release
would be actively harmful, since `parse.ts:402` compares by equality and a bump
with no matching backward arm makes every stored config on every card read as
`null` — defaults — silently. So the two stamps genuinely have different
disciplines (one ratchets unconditionally, one bumps only on a real shape
change), and the coupling requirement is precisely about the case where the
second one is OWED and not paid.

The concrete shape of the breakage: a canvas change introduces a field that must
survive to SD (a new per-slot property, a new orientation-like fact). The canvas
stamp advances because it always does. The config parser is not taught the field.
The field is written by the canvas, dropped by the config parser on the next
read, and the UI shows a layout that is neither what the operator set nor what
the code defaults to — a "strange breakage" with no error anywhere.

**This is not hypothetical, and there is a live instance.** `asSlotRect`
(`config/parse.ts:37-42`) rebuilds a rect from `col/row/colSpan/rowSpan` only and
silently drops `orientation`, on every read from SD and from the localStorage
cache — even though `SlotRect` (`config/types.ts:76-90`) declares the field with
a doc comment stating it lives there so it rides to SD. Filed as #146/#147. It
is exactly the class this invariant exists to make impossible.

## Enforcement — candidates, honestly rated

Per `cant-break-by-design`: the rung comes from the mechanism you can point at,
never from how the sentence reads. Rungs below use that skill's ladder.

### C1 — Derive one stamp from the other

`export const CONFIG_VERSION = CANVAS_FORMAT_VERSION + OFFSET`, or one constant
with two exported views.

- **Rung claimed:** 8 (the disagreement becomes unrepresentable).
- **Real strength: reject.** It couples them ALWAYS, which is the wrong
  proposition — the requirement is "coupled *when the canvas change forces a
  config change*". Worse, it is unsound against the wire: `parse.ts:402` and
  `migrateStorage.ts:187` compare `CONFIG_VERSION` by equality against bytes
  already on cards, so an unrelated canvas bump would silently invalidate every
  stored config in the field. It buys a compile-time guarantee by breaking
  production data.

### C2 — One stamping pipeline both documents flow through

A sole-constructor `StampedDocument` type: fields private, one factory that
takes the payload and the format descriptor and is the only thing
`JSON.stringify`-able onto the card or into `localStorage`. Every current write
site (`store.ts:1021`, `:1368`, `:1533`, `:1628`, `panelCanvas.ts:1042`,
`:1061`) becomes a call to it.

- **Rung:** 7 for "no document reaches storage unstamped", compile-time (a raw
  object is not assignable where the branded type is required).
- **Real strength: necessary, not sufficient.** Six hand-written stamp sites is
  the skill's own tripwire (§4.3 — a processing step duplicated at a second call
  site means the design is already wrong), and this is the fix for that. But it
  enforces *that a stamp is present*, not *that the right one advanced*. On its
  own it would not have caught `asSlotRect`.

### C3 — Delete the second layout stamp (the structural half of ruling 1)

Move layouts out of the `CONFIG_VERSION` document into a `CANVAS_FORMAT_VERSION`
envelope, so there is exactly one number that describes what a layout means.

- **Rung:** 8 for the specific collision #130 is blocked on — after this, "two
  independent stamps describe one meaning" has no expression.
- **Real strength: the highest-value item here, and it is a prerequisite rather
  than an alternative.** It does not discharge ruling 2: it shrinks the coupling
  surface to the genuinely entangled cases (a canvas change that forces a change
  to *non-layout* config) rather than the whole overlay. Technique 8, derive
  don't duplicate; technique 15, shrink the trusted core.

### C4 — An exhaustive migration registry, typed by the stamp

The registry #130's open question 4 already asks for, given teeth:

```ts
type LayoutVersion = 1 | 2 | 3 | 4;              // extended with the stamp
const MIGRATIONS: Record<LayoutVersion, LayoutMigration> = { ... }
```

with `LayoutMigration` a discriminated union whose config arm is REQUIRED, no
default:

```ts
type LayoutMigration =
  | { canvas: (s: unknown) => unknown; config: "untouched" }
  | { canvas: (s: unknown) => unknown; config: ConfigMigration; configVersion: number }
```

Bumping `CANVAS_FORMAT_VERSION` without adding a registry entry is a **type
error** (`Record` over a literal union is not satisfied). Adding the entry forces
the author to choose an arm, and the second arm cannot be written without naming
the config version it requires.

- **Rung:** 7, compile-time, for *"a bumped layout stamp with no registered
  migration"* and for *"a migration that never states its relationship to the
  config document"*.
- **Real strength, stated honestly:** it makes the DECLARATION unskippable, not
  TRUTHFUL. An author can write `config: "untouched"` when it is not. That
  residual is rung 1 (review) and must carry a ledger row rather than be
  papered over. It is still a large gain: today the question is not asked at
  all; after this it is asked by the compiler, in the diff, of the one person
  who knows the answer. Would it have caught `asSlotRect`? **Only if the
  orientation change had come in as a canvas-format bump.** It did not — the
  field was added to `SlotRect` without any stamp moving. That is a real gap and
  C6 is what covers it.

### C5 — The committed-baseline ratchet (test-time)

`packages/deploy/layout-baseline.json` (or a key in the existing
`packages/invariants/debt-ceiling.json` shape) holding the previous release's
`CANVAS_FORMAT_VERSION` and `CONFIG_VERSION`; a test asserting (a) canvas
strictly greater, and (b) if the registry entry for the new canvas version
declares a config arm, `CONFIG_VERSION` also advanced to the version it names.

- **Rung:** 6 if wired into the one path that puts bytes on a board (the shape
  `packages/deploy/src/eagerBudget.ts` already uses, invariant
  `eager-payload-cannot-drift-upward`); 3 if it lives only in the test suite.
- **Real strength:** this is the ONLY candidate that can express "strictly
  greater than the *previous release*", because the previous release's number is
  not a fact any type in this build knows. Inherit `eagerBudget.ts`'s stated
  `@debt` verbatim rather than pretending otherwise: it gates the DEPLOY, which
  is late — the bump is already committed by then — and promoting it to gate the
  DIFF is blocked on this repo having no CI (`.github/workflows` does not
  exist). The pre-commit hook (`.githooks/pre-commit`, installed per clone by
  `pnpm hooks:install`) runs `scripts/register_check.py --fast` on five
  governance paths only; it does not run `pnpm test` and would not fire on a
  change to `panelCanvas.ts`.

### C6 — One rect type, one parser, no second transcription

The `asSlotRect` class is not a version problem at all — it is a *mirror without
a generator* (anti-pattern A5.8). `SlotRect` (`config/types.ts:76-90`) is
declared as an inlined mirror of `panelCanvas`'s `PanelRect` "so config stays
dependency-free", and `asSlotRect` re-transcribes its fields by hand. Adding a
field to one side and not the other is invisible.

The fix is structural: one rect type with one parser that is the sole producer of
a rect on every tier (SD, localStorage, canvas), so a new field is carried
everywhere or compiles nowhere. Exhaustiveness can be forced — build the parsed
rect by destructuring the full type so a new required field is a compile error,
or generate the parser from the type.

- **Rung:** 7 achievable, compile-time.
- **Real strength:** this is the mechanism that would actually have caught the
  live instance. It is narrower than the stated invariant (it covers the rect,
  not every entangled field), but it covers the only entangled shape that
  exists today, and it is the cheapest of the six.

### C7 — Prose, an `@invariant` block, or a `register_check.py` rule

- `register_check.py` validates register citations, group headings and inbox
  dispositions. It does not read TypeScript and does not know what a stamp is;
  teaching it to would put a build-critical check in a documentation linter that
  only the pre-commit hook runs, only on five governance paths, and only for a
  clone that ran `pnpm hooks:install`.
- An `@invariant` block is a DECLARATION of strength, not a source of it. It is
  required beside whatever mechanism lands (`docs/invariant-register.md` is
  generated from those blocks) — but it is rung 0 on its own.
- **Real strength: prose-only. Not an enforcement candidate.** Listed because it
  is what "we need an invariant that enforces this" degrades into if nobody
  writes a mechanism.

### Recommendation

**C3 + C4 + C6 as the mechanism, C2 as the substrate, C5 as the release ratchet;
C1 rejected, C7 as the declaration only.**

Ordered, with what each buys:

| # | Mechanism | When it fires | Rung | Covers |
|---|---|---|---|---|
| C3 | Layouts move to a `CANVAS_FORMAT_VERSION` envelope | compile / by construction | 8 | deletes the two-stamps-one-meaning collision |
| C6 | One rect type, one sole-producer parser | compile | 7 | the live `orientation` class (#146) |
| C4 | `Record<LayoutVersion, LayoutMigration>` with a required config arm | compile | 7 | a bumped stamp with no migration; an unstated config dependency |
| C2 | Sole-constructor stamped document | compile | 7 | six hand-written stamp sites (the tripwire) |
| C5 | Committed baseline + deploy-gated ratchet | deploy | 6 | "strictly greater than the previous release" |
| C7 | `@invariant` block | — | 0 | declaration only |

Why this combination and not one item: the requirement has three independent
failure modes and no single mechanism reaches all three. C4 catches *the author
who bumped the stamp and did not think about config*; C6 catches *the author who
changed the shape and never touched a stamp at all* (the case that actually
happened); C5 catches *the release that shipped without either*. C3 is what makes
C4 and C5 expressible in the first place, because the ratchet has no referent
while two stamps describe one meaning.

**What none of them enforce**, stated plainly rather than left to be discovered:
whether a migration's declared relationship to the config document is TRUE. That
is rung 1 — review — and it needs a ledger row naming it, not a sentence
claiming otherwise.

**Not implemented here.** This document decides and rates; GIT_130 builds.

## Open, still

- Whether layouts become per-screen files on the card (#130 open question 6,
  raised by Gabe 2026-08-28, not decided). It changes ruling 1's shape but not
  its answer: with one file per screen, the layout stamp becomes a per-file fact
  stamped by `CANVAS_FORMAT_VERSION` rather than one global — the ownership
  ruling holds either way, and C4/C5 read the same number.
- Whether GIT_146's `sized`-style provenance widens into the "operator authored
  this slot" fact that C6's single rect type should carry. GIT_132's `sized`
  (`panelCanvas.ts:869`, `:874-895`, sole writer `:1853-1877`) is the right
  shape and too narrow to reuse as-is: spans only, browser-local, no orientation
  analogue, and `:1695-1696` unions it with every id in `seedFromOverlay`, so on
  a machine with an already fully-resolved override every card reads as
  operator-sized.
