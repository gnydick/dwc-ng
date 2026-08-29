# Configurable thermal thresholds, and the band table both the colour and the legend are derived from

Tracked as GIT_150 (#150 parent / #151 context).

**Base for every file:line in this document: `main` at `8df4a98`.** Where the
in-flight branch `GIT_142` differs, the difference is called out explicitly and
labelled — it changed two of the three sites this spec touches, and reading the
wrong tree would make requirement 1 look already half-done.

## The request

Gabe, 2026-08-28, verbatim:

> "yes, let the thresholds be configurable and generated from the configs set in
> the gui"

The "yes" answers an offer to make the Temperature Gradient card's legend
strings DERIVED from the thresholds instead of hand-written prose that restates
them. He went further: the thresholds themselves become GUI-configurable, and
the legend is generated from that configuration.

And, on where the inputs live (2026-08-28, verbatim):

> "thresholds go on the temperature gradient card, next to each colour"

## 1. What exists today

### The one hardcoded home

`packages/ui/src/cards/ToolsHeatersCard.tsx:468-480` — a `classList` on
`.heat-cur`:

```
"t-cold": props.heater.current < 45,
"t-warm": props.heater.current >= 45 && props.heater.current < 160,
"t-hot":  props.heater.current >= 160,
```

So the boundary convention is **half-open ascending**: exclusive at the cold
edge, inclusive at the hot edge. 45.0 reads WARM and 160.0 reads HOT.

### The class search — every consumer of 45 / 160 / the band classes, BY NAME

`CLAUDE.md` § Working rules (verification discipline) binds here: this finding
is class-shaped ("the thresholds are restated"), so the enumeration is
exhaustive, not exemplary. Searched: `packages/ui/src`, `packages/ui/test`,
`packages/mock-duet` for `t-cold|t-warm|t-hot`, `\b45\b`, `\b160\b`,
`current >=`, `current <`, `chip-hot`.

| # | Site | What it does | Status |
|---|---|---|---|
| 1 | `packages/ui/src/cards/ToolsHeatersCard.tsx:472-474` | the classList above — the only place the numbers are *used* to colour a reading | **the source of truth to be replaced** |
| 2 | `packages/ui/src/cards/SettingsCards.tsx:143-147` (`ThermalColorsBody`, `channels[].range`) | prose restating the same numbers. `main`: `"below 45 °C"` / `"45 – 160 °C"` / `"160 °C and above"`. `GIT_142`: `"< 45 °C"` / `"45 – 160 °C"` / `"≥ 160 °C"` | **duplicate — to be derived** |
| 3 | `packages/ui/src/shell/Shell.tsx:40-41` (`anyHeaterHot`), rendered at `:145-146` as `<span class="chip chip-hot">hot</span>` | the preflight strip's HOT chip: `h.current >= 45` | **third duplicate, and it disagrees semantically — see §7** |

Nothing else. Specifically checked and ruled OUT as non-instances:

- `packages/ui/src/index.css:80-82`, `theme-graphite.css:44-46`,
  `dev/paletteLab.css:32-34`, `app.css:948-950` — these declare and consume the
  `--t-cold`/`--t-warm`/`--t-hot` *colours*. They carry no threshold.
- `packages/ui/src/app.css:203` `.chip-hot` — a colour rule; the `45` that
  drives it lives at site 3.
- `packages/mock-duet/src/snapshot.ts:132` `coldExtrudeTemperature: 160` — a
  real RepRapFirmware object-model field. Numerically coincident, semantically
  unrelated (it is the firmware's cold-extrude interlock). It is **not** a
  consumer of this config and must not be wired to it: see §9.
- `packages/ui/src/dev/cardScenarios.ts:223-230`, `compose/defs.ts:455`,
  `compose/screens.ts:214`, `charts/mapData.ts:225-229`, and the `160`s in
  `packages/mock-duet` probe grids, thumbnails and accelerometer tests —
  unrelated numbers.

Site 3 is the finding the brief did not have. It means "the thresholds are
stated in two places" was already understated: they are stated in **three**, and
the third one is not even the same threshold as the label it prints.

### The colours, which are already configurable — the shape to match

- Type `ThermalColors { cold, warm, hot: string }` — `config/types.ts:179-183`.
- Default `DEFAULT_THERMAL_COLORS` — `config/types.ts:192-196`, whose doc
  comment already records that this object and `index.css` must agree (a
  pre-existing rung-0 co-location; see §12).
- **Scope: PERSON.** `PersonConfig.thermalColors` (`config/types.ts:312`),
  listed in `PERSON_SECTIONS` (`config/types.ts:385`), so `splitOverlay`
  (`config/types.ts:397-403`) sends it to the unkeyed person half — it follows
  the operator across machines and is NOT stamped with the machine id.
  `packages/ui/test/config-scope.test.ts:44-45` asserts exactly that.
- Parsed by `parseThermalColors` (`config/parse.ts:106-115`), reached from
  `parseOverlay` (`:327`). Field by field: one bad channel drops itself, the set
  survives; an absent or garbage section returns `undefined`.
- Written by `app.config.setThermalColors` (`config/store.ts:655-657`).
- Card-level reset: `resetAction("thermalColors")` in `compose/cards.tsx:213`,
  which calls `ctx.config.resetSection` (definition at
  `compose/cards.tsx:250-254`).
- Applied at runtime by `App.tsx:89`, which overwrites the `--t-*` custom
  properties from the overlay.

### The precedent for an ORDERED pair, already in this codebase

`config/types.ts:198-203`:

```
/**
 * An inclusive `[lo, hi]` bound with `lo < hi` ...
 * Minted only by `asRange` (config/parse.ts) — the type
 * cannot say "ordered", so the one gate that checks it is the only producer.
 */
export type Range = readonly [number, number];
```

`asRange` is `config/parse.ts:157-163` and already rejects a non-array, a wrong
length, a non-`number` element, a non-finite element, and `lo >= hi`. Its
consumer `Envelope` (`config/types.ts:207-215`) carries the
`envelope-is-config-not-default` invariant at **rung 6, choke-point**
(`config/types.ts:246-252`). The thermal thresholds are the same problem — an
ordered pair of numbers arriving from untrusted JSON and from a text input — and
must reuse this construction rather than mint a parallel one.

## 2. The invariant

> **One thermal band table. The reading's colour class, the legend text on the
> settings card, and the preflight HOT chip are all evaluated from it; none of
> them contains a temperature literal or a band-boundary string.**

Prose saying "keep the legend in sync with the classList" is **rung 0** on the
`cant-break-by-design` ladder and is explicitly NOT acceptable as the mechanism
here. It is worth saying why in this specific code, because rung 0 has already
failed twice in it: the `GIT_142` comment at `SettingsCards.tsx:141-160`
(branch) is a careful, correct, four-paragraph argument for why the hot band's
legend must read `≥` and not `>` — and it is *still* rung 0, because nothing
stops the next edit to `ToolsHeatersCard.tsx` from moving 160 without anyone
reading it. Site 3 (`Shell.tsx:41`) drifted without anybody writing a comment at
all.

### Mechanisms, rated honestly

**M1 — a shared band-table module both sites import.** A `thermal.ts` exporting
`bandOf(temp, cuts)` and the band descriptors.

- **Rung 5** (shared helper). Fails the stranger test: a fourth site can still
  write `t >= 160` by hand. The skill's own words — the weakest acceptable
  interim, and only with a ledger row naming the promotion.

**M2 — the legend as a pure function of the cuts, with no string literals.**
The settings card holds no range string; the band's rendering is produced from
the cut list and the one boundary convention.

- **Rung 8 for the specific property "the legend disagrees with the colour
  rule"** — after this, a legend that contradicts the cuts is not expressible,
  because the strings do not exist to be edited. This is the strongest rung
  available for the property Gabe actually asked about, and it is cheap.
  Technique 8 (derive, don't duplicate); technique 14 (generate, don't
  hand-maintain).
- It does **not** by itself stop a fourth site from hardcoding a comparison.
  That is M3's and the §11.3 source assertion's job.

**M3 — cuts, not per-band ranges: the partition is unrepresentably broken.**
Do not store three bands each with a lo and a hi — that admits a gap at 44.9 and
an overlap at 160, and needs a validator to catch either. Store the **cut list**
(the interior boundaries only) and define

```
bandIndex(t, cuts) = the number of cuts c with c <= t
```

- **Rung 8** for *"the bands cover the real line exactly once, with no gap and
  no overlap"*. There is no way to write a gap: every temperature lands in
  exactly one band by arithmetic, for any cut list at all. Technique 1, illegal
  states unrepresentable.
- The boundary convention (`<` exclusive below a cut, `>=` inclusive at and
  above it) becomes a property of this ONE function rather than a fact restated
  at each comparison — which is precisely what Gabe asked about. It is stated
  once, in `bandIndex`, and the legend generator reads the same definition.
  **It is fixed by the code, not stored in the data**: there must be no
  `inclusive: true` key anywhere. Rationale, so a later reader does not "improve"
  it: a per-band inclusivity flag makes degenerate and double-covered states
  expressible again, undoing M3's whole gain, and no operator has asked to
  invert it.
- Residual, stated: `bandIndex` is total for ANY cut list, including an unsorted
  one — an unsorted list produces a monotone-but-surprising assignment rather
  than an ill-formed one. Ordering therefore still needs M4.

**M4 — ordering via the existing `Range` gate.** Two interior cuts is exactly an
ordered pair, and this repo already has a sole producer for one: store `Range`,
mint it only through `asRange` (`config/parse.ts:157`), the same gate `Envelope`
uses.

- **Rung 6, choke-point** — and rung 6 is the honest rating, *not* 7. `Range` is
  a bare `readonly [number, number]` alias with no brand, so
  `const r: Range = [160, 45]` compiles today. `asRange` being the only
  *intended* producer is a property of who calls it, not of the type. The
  existing doc comment at `config/types.ts:198-202` says "minted only by
  `asRange`", and that sentence is anti-pattern A5.1/A5.11 material: it reads
  like rung 7 and is rung 6.
- **Promotion available, and it is a decision, not a default:** branding
  (`type Range = readonly [number, number] & { readonly __ordered: unique symbol }`,
  the cast living inside `asRange` alone) moves this to **rung 7**, bypass =
  compile error. It also touches `Envelope`, `asEnvelope` and every `shaping`
  consumer — a class-shaped change beyond this ticket's scope. Filed as Q2, not
  done silently.

**Adopted stack: M3 + M4 + M2, held in the M1 module.** Combined claim, per
property:

| Property | Rung | Mechanism |
|---|---|---|
| the legend cannot disagree with the colour rule | **8** | no literals exist; both generated from the cut list |
| the bands partition the line, no gap, no overlap | **8** | `bandIndex` counts cuts |
| the cuts are strictly ordered (no inverted, no equal) | **6** | sole producer `asRange`; **7** if Q2 is yes |
| a *fourth* future site cannot hardcode a comparison | **5** | shared module, with a rung-4 source assertion (§11.3) as support |

The rung-5 row carries the promotion debt (§12). The only rung-8 answer to it
would be deleting the ability to name a raw heater temperature outside the
module — a `Celsius` newtype whose sole public predicate is band membership —
which is a larger change than this request warrants.

## 3. Ordering and validity — the behaviour table

Cuts are `[warmCut, hotCut]`, minted only by `asRange`, which returns
`Range | null`. `null` means the section is dropped and the **coded default
stands**. Nothing is clamped, nothing is repaired.

| Input | Outcome |
|---|---|
| `[45, 160]` | accepted; today's behaviour exactly |
| `[160, 45]` (inverted) | **rejected** by `asRange`'s `lo >= hi` guard (`parse.ts:161`); section dropped, default stands, the row shows `aria-invalid` and the card's status line says so |
| `[45, 45]` (equal — a zero-width warm band) | **rejected** by the same guard: a band no temperature can occupy is unrepresentable, not merely ugly |
| non-numeric (`"hot"`), `NaN`, `Infinity` | **rejected** — `parse.ts:160-161` already requires `typeof === "number"` and `Number.isFinite` on both |
| missing, empty, not an array, wrong length | `undefined` from the parser → key absent → coded default |
| negative (`[-20, 160]`) | **accepted.** A chamber or cold-plate reading below 0 °C is real, and this is display-only colouring. There is no floor |
| a cut far above the machine's range (`[45, 5000]`) | **accepted.** Refusing it would be a GUI-encoded opinion about the machine — see §9 |

Rejection is **visible, never silent**: the offending input gets
`aria-invalid="true"` and the card's always-rendered status line says what was
refused — exactly as `SettingsCards.tsx` already does for the shaping envelope
(`GIT_142` branch, `:455-485`, the `.env-status` reserved slot). A refused edit
leaves the section byte-identical.

## 4. Scope, key, default, absence

- **Scope: PERSON**, following `thermalColors` (`PERSON_SECTIONS`,
  `config/types.ts:385`). Justification rather than imitation: which temperature
  reads as "hot" to a person is a perception preference, the same kind of thing
  as which colour it is drawn in. It is not a fact about the printer, and an
  operator who wants 60 °C to read warm wants that on every machine they open.
- **Key: `thermalCuts: Range`**, a new `PersonConfig` field beside
  `thermalColors`, added to `PERSON_SECTIONS`, parsed by a `parseThermalCuts`
  that is a one-line call to `asRange`.
  - Named `Cuts` and not `Thresholds` deliberately: the stored thing is the
    interior boundary list of M3, and a name saying "thresholds" invites a later
    reader to add a third, per-band, independently editable one.
- **Default: `[45, 160]`**, exported as `DEFAULT_THERMAL_CUTS` from
  `config/types.ts`, so an operator who never touches it sees byte-identical
  behaviour to today.
- **Absence semantics — #146 consistency, and this is load-bearing.** Absence
  means "use the coded default". The key must **not** be materialised on save.
  Two concrete obligations, because `prune` (`config/store.ts:1277-1288`) drops
  only `undefined` and empty objects — it does **not** drop a value equal to the
  default, so a naive setter WOULD write 45/160 into every operator's file:
  1. The setter deletes the key when the committed value equals
     `DEFAULT_THERMAL_CUTS`, in the shape `clearAxisRole` / `clearHeaterColor`
     already use (`config/store.ts:646,652`) — **not** the shape
     `setThermalColors` uses (`:655-657`, which assigns a merged object
     unconditionally).
  2. Nothing on the render path ever writes the resolved value back. The card
     reads the *effective* value to display and writes only the operator's
     gesture.
  This is #146's whole thesis — the config records the operator's EDITS, not
  the app's resolved STATE — and adding a fresh instance of the defect that
  ticket exists to describe would be indefensible. Cite #146 from the code.

## 5. The version stamp

Read `docs/superpowers/specs/2026-08-28-layout-version-ownership.md` first. Per
Gabe's #130 ruling, `CANVAS_FORMAT_VERSION` owns layout and `CONFIG_VERSION`
(`config/types.ts:474`, value 3) owns the non-layout config document. This key
is non-layout config, so `CONFIG_VERSION` is the stamp in question.

**Conclusion: `CONFIG_VERSION` does NOT bump.** Argued, not assumed:

- *A new build reading a config WITHOUT the key.* `parseOverlay`
  (`config/parse.ts:320-335`) builds its `sections` object key by key; a missing
  `thermalCuts` yields `undefined`, `prune` drops it, and the effective config
  resolves to `DEFAULT_THERMAL_CUTS`. Identical to today. Safe.
- *An OLDER build reading a config WITH the key.* `parseOverlay` enumerates the
  keys it knows and never copies an unknown one, so `thermalCuts` is silently
  ignored and the old build behaves exactly as it does now. Safe — **with one
  real consequence that must be written down rather than discovered**: if that
  old build then SAVES, the key it dropped is not written back and the
  operator's thresholds are lost. That is a property of the existing
  parse-and-rewrite design, identical for every key added since v1, and a
  version bump does not improve it.
- *Why a bump would be actively harmful.* `parse.ts:402` compares
  `parsed.version === CONFIG_VERSION` and falls through a hand-written backward
  ladder for 2 and 1; `migrateStorage.ts:187` compares by equality again. A bump
  to 4 with no matching arm makes every stored config on every card read as
  defaults, silently. The version-ownership spec says this in terms
  (§ "Ruling 2"): bumping `CONFIG_VERSION` every release "would be actively
  harmful". A backward-compatible optional key with a coded default is exactly
  the case the stamp is not for.
- *The #130 ruling-2 coupling obligation is not triggered*: this change does not
  touch the canvas format, so no canvas stamp advances that would owe a config
  stamp.

**Falsifiable form of this conclusion**, per `CLAUDE.md` § verification
discipline: the claim is FALSE if any read path compares the payload's version
to `CONFIG_VERSION` in a way that a *known* version carrying an *unknown key*
fails. The two comparison sites are `config/parse.ts:402` and
`config/migrateStorage.ts:187`; the check that could fail is §11.5.

## 6. Mock parity — owed in the SAME change

`CLAUDE.md` § Working rules (development environment): the mock moves with every
iteration.

1. `packages/mock-duet/src/files.ts` — `currentOverlay()` (`:318-330`), the
   overlay shared by config-seed versions 2 and 3, gains a **non-default**
   `thermalCuts` (e.g. `[50, 150]`). A seed equal to the default proves nothing:
   it cannot distinguish "read from the card" from "fell back to the coded
   default", which is the exact dimension this feature is about
   (`docs/LEARNINGS.md`, "a fake must model the bad state").
2. `buildConfigSeed`'s **version-1 arm** (`files.ts:331-342`) does **not** gain
   the key. Its doc comment (`:266-278`) says v1 is byte-for-byte what the seed
   always was, so a machine mid-upgrade exercises the same content — and a v1
   file predating this key is precisely the "written before the key existed"
   case §4's absence semantics claims to handle. It is therefore already covered
   by the existing `--config-version 1` scenario: **no new `--config-version`
   case is needed**, and `CONFIG_VERSIONS` (`packages/mock-duet/src/cli.ts:104`)
   stays `["1","2","3"]`. Adding a version to test the absence of a key that
   version 1 already lacks would be inventing coverage.
3. A malformed seed for the rejection path (§3) is NOT added as a fourth config
   version. Inverted-cut handling is a parser property with a unit test; the
   mock's job is to present states an operator can drive, and the operator can
   type an inverted pair into the card on a running mock.
4. `packages/mock-duet/test/files.test.ts` gains an assertion that the v2/v3
   seed carries `thermalCuts` and the v1 seed does not.

## 7. The third site — the preflight HOT chip

`Shell.tsx:40-41` fires the strip's `hot` chip at `current >= 45` — the **warm**
cut — while drawing it in `--t-hot` (`app.css:203`). Under this change it must
read the same band table as everything else; *which band* is Gabe's to answer,
not this spec's. Filed as Q1 with `needs-input`.

What is not optional either way: the comparison stops being a literal and
becomes a call into the band module.

## 8. The GUI

Gabe: "thresholds go on the temperature gradient card, next to each colour." So:
the `thermal-colors` card (`compose/defs.ts:440-444`, title "Temperature
Gradient"), inside the existing per-band `.field` rows. Not a new card, not a
new section.

### Arity — SETTLED

Three bands, two thresholds: cold has no lower bound and hot has no upper, so
"next to each colour" cannot be 1:1. Gabe settled it directly (2026-08-28,
verbatim): **"2 inputs, one gets 45 and one gets 160, get it?"**

So: **exactly two editable inputs on this card.** Every other appearance of
either number — including the Warm band's upper edge and the Cold band's `< 45`
— is DERIVED read-only text generated from the same band table that drives the
reading-colour classList. A threshold rendered in two editable places is the
exact duplication this ticket exists to delete and is not permitted anywhere in
the implementation.

**Row placement (implementer's choice, made here): each band edits its own
FLOOR.** Cold has no input (the band starts at −∞), the Warm row holds the 45,
the Hot row holds the 160. It reads naturally — the number sits in the row whose
colour begins at it — and the rule it states ("each band edits its floor; the
bottom band has none") keeps the arity honest if a band is ever added, where
"the row owns its lower edge and *displays* its upper one" would leave a
displayed 160 sitting beside an input, inviting the second editable home back
in (anti-pattern A5.4).

Rung for "one editable home per threshold": **6** — the mechanism is that only
two `<input>` elements exist in the card.

### Row contents, and which parts are editable

Per row, left to right, on the existing `.field` line:

| Element | Editable? | Source |
|---|---|---|
| `.field-label` — Cold / Warm / Hot | no | the band table |
| `.color-swatch` (`<input type="color">`) | **yes** (unchanged) | `thermalColors[key]` |
| `.color-hex` | no | derived from the swatch |
| `.color-range` — the legend | **holds the one editable input for this band's floor** (Warm, Hot); wholly derived read-only text on Cold | generated by M2 from the cuts — **no string literal in the component** |
| `.color-clash` — reserved advisory slot | no | unchanged |

The legend text and the input are one element group: the generator returns the
band's rendering as segments (a leading operator, an editable cut, a trailing
unit) rather than a finished string, so the row a threshold appears in and the
legend it produces come from one call and cannot disagree.

### Input mechanics

- `type="number"`, `step="1"`, in `.env-bound`'s idiom.
- **Commit semantics: draft on `onInput`, commit on `onChange` and on `Enter`**
  — the shaping envelope's convention on this very component
  (`SettingsCards.tsx`, `GIT_142` branch, `:455-485`), which is the right
  precedent because it is the other ordered-pair editor in the codebase. It is
  deliberately NOT `thermalColors`' commit-on-`onInput` idiom
  (`SettingsCards.tsx:173`): that is correct for a colour picker, where every
  intermediate value is valid and the OS dialog streams them; it is wrong for a
  number, where `4` is a keystroke on the way to `45` and committing it would
  briefly invert the pair.
- A refused commit reverts the input to the stored value, sets
  `aria-invalid="true"`, and speaks through the card's status line (§3).
- **`max-width` is mandatory.** #144 is open on text inputs in `.field` rows
  growing without limit when a card is stretched. `app.css:1358` gives
  `input[type="number"]` `max-width: calc(22.5 * var(--u))`, so a number input
  inherits a bound — but that must be **verified at implementation time, not
  taken on this document's word**, and the cut input should carry its own fixed
  flex basis in the `.env-bound` shape (`app.css:1851-1852`) so the row's
  geometry is identical whether the value reads `45` or `1600`. Cite #144.

### Layout — measurement, not guessing

The Temperature Gradient card is under active min-width work on `GIT_142`: its
floor was just cut from colStop 104 to 76 by removing a `white-space: nowrap`
reserved slot from min-content (`packages/ui/test/intrinsic-floors.test.ts` on
that branch, the `.color-clash` block). Adding two numeric inputs to those rows
**will move that floor** — and note `.color-range` is `flex: none`
(`app.css:1797`), so its content feeds the row's minimum directly.

All of the following are requirements. A pin left at its old value is drift, not
a pass:

1. Re-measure the card in the Card Lab with `auditCard`
   (`packages/ui/src/dev/LayoutAuditPanel.tsx:121`) — the procedure
   `compose/defs.ts:540,629,654,673` records for other cards.
2. Re-pin `size: { colSpan, rowSpan }` in `compose/defs.ts:440-444` (today
   `156 × 60`) from that measurement.
3. Re-pin the placement in `compose/screens.ts:216` (today
   `col:156 row:161 colSpan:156 rowSpan:60`) and check it neither collides with
   nor overflows its neighbours on that screen.
4. Run the scale sweep at 0.75 / 1.0 / 1.5 and confirm equal cell floors, per
   `CLAUDE.md` § Architecture requirements.
5. Every new length is `calc(n * var(--u))`; decorations are inset box-shadow,
   never `border:` — enforced by `packages/ui/test/unit-lengths.test.ts`.

## 9. Out of scope — said plainly so nobody mistakes this for a safety feature

This is **display-only colouring of a reading**, plus the wording of a legend.

- It is NOT machine control. `CLAUDE.md`'s "controls are 1:1 with G-code / no
  GUI-encoded safeties, verdicts or gating" rule is therefore **not engaged** —
  nothing here emits a G-code and nothing here is a control.
- The thresholds must **not** gate, disable, warn about, confirm, or interlock
  anything. No button becomes unavailable because a heater is in the hot band.
  A number an operator can set to 5000 must never be load-bearing for safety,
  and the firmware is the authority on what is too hot
  (`heat.coldExtrudeTemperature`, `heat.heaters[].max`, heater faults) — which
  is exactly why `packages/mock-duet/src/snapshot.ts:132`'s
  `coldExtrudeTemperature: 160` stays unconnected to this config despite the
  coincident number.
- The preflight HOT chip (§7) is the one thing that looks like a warning. It is
  a status indication, not a gate: it colours a word, it stops nothing. That
  stays true after this change.

## 10. Blocking questions (`needs-input`)

**Q1 — the preflight HOT chip's band.** `Shell.tsx:41` fires at 45 today, calls
itself "hot", and is drawn in the hot colour. Once it derives from the table,
which cut does it read — `cuts[0]` (preserves today's behaviour exactly, and
reads "hot" as "hot enough to burn you", which is what a preflight strip is for)
or `cuts[1]` (the word, the colour and the band finally agree, and the chip
becomes much rarer)? Either answer changes a safety-adjacent *indication* on the
always-visible strip, so it is not an implementer's call.

*(The arity of "next to each colour" was Q2 and is CLOSED — Gabe, 2026-08-28:
"2 inputs, one gets 45 and one gets 160, get it?" See §8.)*

**Q2 — brand `Range`, or accept rung 6?** Branding `Range`
(`config/types.ts:203`) so only `asRange` can mint one promotes the ordering
invariant from choke-point (6) to compile-error (7), and corrects a doc comment
that currently reads stronger than its mechanism. It also touches `Envelope`,
`asEnvelope` and the shaping consumers — a class-shaped change larger than this
ticket. Do it here, file it separately, or leave the rung-6 ledger row standing?

## 11. Tests required

1. `bandIndex` is total and monotone: with `[45,160]`, `44.9→cold`, `45→warm`,
   `159.9→warm`, `160→hot`; with `[50,150]` the same boundaries move with the
   cuts. This makes the boundary convention a checkable fact rather than a
   comment.
2. **The derivation test, with a red check**: with cuts `[50,150]` the legend
   the settings card renders contains `50` and `150` and contains neither `45`
   nor `160`. The red check must show the assertion FAILING against the
   pre-change hand-written `channels` array, or it is a sentence and not a check
   — the discipline `intrinsic-floors.test.ts` already applies to itself
   (`GIT_142`, its "red check" test).
3. A source assertion that no temperature literal remains at the three sites
   enumerated in §1 (`ToolsHeatersCard.tsx`, `SettingsCards.tsx`, `Shell.tsx`),
   so a fourth hardcoded comparison is caught by the suite. This is the rung-4
   support under §2's rung-5 residual.
4. The §3 parse table, every row, including that a rejected pair leaves the
   effective config equal to the default.
5. `CONFIG_VERSION` compatibility (§5's falsifying check): a `version: 3`
   payload with `thermalCuts`, one without it, and one carrying an unknown junk
   key all parse to the expected overlay.
6. Absence (§4, #146): after setting the cuts back to `[45,160]`, the saved
   overlay does **not** contain a `thermalCuts` key.
7. Mock (§6): the v2/v3 seed carries a non-default `thermalCuts`; the v1 seed
   does not.
8. Layout (§8): the card's re-measured floor, asserted at 0.75 / 1.0 / 1.5.

## 12. Ledger rows owed

Per `cant-break-by-design` §4.6 and §4.10 — filed in the same commit as the
mechanism, in the invariant register (`docs/invariant-register.md` is generated
from `@invariant` blocks in source, so these are declared beside the code).

| Invariant | Rung | Mechanism | Promotion |
|---|---|---|---|
| legend cannot disagree with the colour rule | 8 | no literals exist; both generated from the cut list | none owed |
| bands partition the line, no gap, no overlap | 8 | `bandIndex` counts cuts | none owed |
| cuts are strictly ordered | 6 | sole producer `asRange` | brand `Range` → 7 (Q2) |
| no FOURTH site hardcodes a band comparison | 5 | shared module + source-assertion test (§11.3) | a `Celsius` newtype whose only public predicate is band membership → 7. Not scheduled |
| `DEFAULT_THERMAL_COLORS` and `index.css` agree | 0 | co-location + doc comment (`config/types.ts:186-191`) | **pre-existing, inherited not introduced.** A5.3: co-location is not a mechanism. Generating the `:root` block from the constant would be rung 8. Out of scope, recorded here only so it is not mistaken for something this change fixed |

## 13. Adjacent defects Gabe found on this card the same night

**(a) Temperature Gradient rows have no per-row Reset; Chart colours rows do.**
`SettingsCards.tsx:118-123` wraps a `.lab-pill` Reset in `<Show when={overridden()}>`
calling `clearHeaterColor(i)`; `ThermalColorsBody` has no equivalent, only the
card-level `resetAction("thermalColors")` (`compose/cards.tsx:213`).

**Disposition: THIS ticket.** Not because the asymmetry is this ticket's fault,
but because this ticket makes it unanswerable to defer: once a row carries a
threshold as well as a colour, "reset this row" must mean something specific
(colour only? cut only? both?), and `resetSection` takes a single section key
(`compose/cards.tsx:250`) while colours and cuts are about to be two sections —
so the card's existing single Reset would silently stop covering half of what
the card edits. The reset granularity is a design output of this change.

**(b) The Chart-colours Reset is conditionally rendered with no reserved space.**
It pops into the row on first override, shifting the `.color-clash` slot — on
the card whose clash slot was *just* carefully reserved to stop exactly that.
This violates `CLAUDE.md`'s uniformity / alignment / positional-stability rule.

**Disposition: `GIT_142` while it is open; a new pair otherwise. NOT this
ticket.** It is a defect in the card `GIT_142` is actively rewriting, the fix is
that branch's own idiom (reserve the slot the way `.color-clash` and
`.env-status` are reserved), and holding it behind a feature with three blocking
questions would leave a known jitter shipping.

**The verification gap is the more important half of (b).** `GIT_142`'s
stability work is a **source-assertion** suite —
`packages/ui/test/intrinsic-floors.test.ts` says so itself: "Source assertions,
like the rest of this file — there is no DOM here." Its predicate
`clashSlotFaults` is applied to a hand-maintained list,
`RESERVED_SLOTS = [".color-clash", ".accel-status"]`, and the file's own comment
concedes the shape: "enumeration standing in for a sweep". So the suite does not
measure a row and find it stable; it checks two named CSS rules for four
properties. A conditionally-rendered *sibling* in the same row — the Reset
button — is outside the predicate entirely, and **no test in that file could
fail because of it**. That is why (b) survived a round of work explicitly about
this row's stability.

The gap, not the button, is the finding: the invariant is written over a list of
slots when the property it wants is "nothing in a `.field` row appears or
disappears". A check asserting that no `<Show>` in `SettingsCards.tsx` wraps a
row-level element — or that every such element has a reserved counterpart — is
what would have caught it, and is owed wherever (b) lands.
