# Custom-card metadata: authored size, tip, padding

Increment 4 of #194 (Context #195, campaign #192). Branch `GIT_194-inc4`
(based on increment 1's tip, `db38f1e`). Closes the second-class gaps in
`CustomCardDef`: a user-authored card gets an authored default footprint, a
CardTip of its own, and a per-card body padding — all as data in the config
overlay, none of it a new persistence tier or a parallel sizing path.

## 1. What changes, where

`CustomCardDef` (config/types.ts) today is `{ name, spec }`. It gains four
OPTIONAL fields, all flat scalars, all living NEXT to the opaque `spec`
text:

| field | type | meaning | absent means |
|---|---|---|---|
| `colSpan` | number (grid cells) | authored default footprint, X | stock custom default (156) |
| `rowSpan` | number (grid cells) | authored default footprint, Y | stock custom default (40) |
| `tip` | non-empty string | CardTip text (click-to-copy) | the stock `"custom card"` tip |
| `padding` | number (`--u` units) | uniform card-body padding | the house padding tokens |

Full vertical in this increment:

- **types** — the fields above + `CustomCardMeta`, `sanitizeCardMeta`
  (config/types.ts, the ONE acceptance gate; see §4).
- **untrusted boundary** — `parseCards` (config/parse.ts) reads them
  per-field through `sanitizeCardMeta`; a bad field drops ITSELF, never the
  card, exactly the house per-leaf tolerance.
- **store mutators** — `addCustomCard(name, spec, meta?)`,
  `updateCustomCard(id, patch)` where the four metadata fields accept
  `null` to clear (return to default) and pass through the same
  `sanitizeCardMeta` gate. Existing call sites compile unchanged.
- **composition sizing** — `defaultCardSize(id, cards?)` in
  compose/composition.ts replaces the inline
  `isCustomCardId(id) ? CUSTOM_CARD_SIZE : CARD_DEFS[id].size` fork inside
  `addCard`: registry ids answer from `CARD_DEFS[id].size`, custom ids from
  the authored fields with `CUSTOM_CARD_SIZE` as the per-axis fallback.
  `addCard` gains an optional `cards` record parameter and passes whatever
  size it gets through the SAME `findFreePosition` placement as registry
  cards — one path, no custom-card special case downstream.
- **rendering** — CustomCard passes `tip={def.tip ?? "custom card"}` and
  `padU={def.padding}`; Panel gains a `padU?: number` prop that sets
  `padding: calc(<n> * var(--u))` inline on `.panel-body` ONLY when
  present, so the default remains the stylesheet's house tokens
  (`--sp-card-t/x/b`) untouched. No app.css edit; no `px` anywhere.
- **mock parity** — the mock's v3 `dwc-ng-config.json` seed
  (packages/mock-duet/src/files.ts) carries one custom card exercising all
  four fields, so the SD → download → parseOverlay → placement → render
  path is drivable on a fresh mock with zero setup. Its one G-code, `M300
  S440 P250`, is verified against reference/duet-gcode.md §M300.
- **docs** — docs/authoring-cards.md §1 gains a "Card metadata" note.

## 2. Sizing: how the authored size actually flows

Understanding first (ticket requirement): a registry card's `size` feeds
placement in exactly one place — `addCard` → `findFreePosition` — at the
moment the card is ADDED to a screen. After that the slot rect in the
composition/canvas IS the geometry; `growToDefaults`
(shell/panelCanvas.ts) raises UNMARKED stored spans to the coded default
across releases, and the measured floors (`contentRowSpan`/
`contentColSpan`) bound resizing at drag time.

The authored size takes the identical seat:

- it is the footprint `addCard` places the card at (via
  `defaultCardSize`), on every screen it is later added to;
- the measured-floor system still governs minimums — an authored size
  smaller than the card's content floor is raised by the same resize-stop
  arithmetic every registry card obeys; nothing here touches it;
- spans are normalized through `clampRect` — the ONE existing bound
  (round, ≥1, colSpan ≤ GRID_COLS) — inside `defaultCardSize`, so an
  authored `colSpan: 9999` or `3.7` cannot place an illegal rect and no
  second min/max appears anywhere (A5.7: a bound may exist in exactly one
  place);
- editing the authored size later does NOT reflow existing placements.
  Deliberate: for custom cards the composition slot is stored operator
  geometry, and `growToDefaults`' raise-to-coded-default rule keys off the
  registry defaults list, which custom cards enter via their stored slot
  rect. The authored size is the card's default footprint, not a live
  minimum. (If a custom-card grow rule is ever wanted, it belongs in the
  same `growToDefaults`, not a second mechanism.)

`addCard`'s `cards` parameter is OPTIONAL, not required. That is a lock
constraint, not a preference: `test/custom-cards.test.ts` calls
`addCard({}, cardId)` and is owned by increment 2's agent (advisory lock)
in this parallel round, so a required parameter cannot land without editing
a file another agent holds. Ledger row: **custom-size-feeds-placement,
rung 5-6** (shared sole helper `defaultCardSize`; an omitted `cards` record
silently falls back to the stock size). Promote at integration by making
the parameter required, which the compiler then enforces at every call
site.

## 3. Why flat scalars beside `spec` are safe (the landmine)

The spec is opaque JSON TEXT because the overlay machinery corrupts
structures it recurses into (config/types.ts:98-106). The two indicted
functions, read rather than recalled (config/store.ts):

- `prune()` (~store.ts:1277) walks an overlay; for each entry it recurses
  into plain objects and drops them when empty, keeps any other
  `entry !== undefined` verbatim. A `number` or `string` is not a plain
  object: prune cannot enter it, cannot empty it, cannot drop it. The four
  new fields are exactly such leaves.
- `mergeInto()` (~store.ts:1260) deep-merges plain objects and
  `structuredClone`s every other value wholesale. A scalar field is
  replaced atomically — there is no partial state for a merge to
  manufacture. The only merge that ever sees `cards` is
  `effective() = mergeInto(DEFAULT_CONFIG, overlay)`, and
  `DEFAULT_CONFIG.cards` is `{}`, so each card def is cloned whole.
- `splitOverlay`/`joinOverlay` (config/types.ts) move `cards` as a WHOLE
  person-half section; they never enter a def.

So the hazard that forced `spec` into a string — recursive machinery
entering a structured value — cannot reach a scalar by construction. This
is also why the authored size is `colSpan`/`rowSpan` as two flat numbers
rather than a nested `size: {colSpan, rowSpan}` object: a nested object
would be legal today (never empty, only ever cloned whole) but would stand
one refactor away from the exact prune/merge hazard the comment warns
about; two leaves have no inside for the machinery to get into.

Falsifying check (test/custom-card-metadata.test.ts): create a store, add
a card with all four fields, perform a further unrelated `apply` (which
re-runs the full structuredClone → mutate → prune → mergeInto cycle), and
assert every field and the exact spec text survive; then round-trip the
overlay through `JSON.stringify` → `parseOverlay` and assert equality.
Red-checked: the parse-boundary assertions fail before `parseCards` learns
the fields (its whitelist strips them — that is the defect this increment
exists to close).

## 4. One acceptance gate: `sanitizeCardMeta`

The fields cross two trust boundaries: untrusted JSON (SD file, cache,
future share import) through `parseCards`, and typed writes through the
store mutators. One predicate set, defined once in config/types.ts:

- `colSpan`/`rowSpan`: finite number ≥ 1 (normalization to the grid is
  `clampRect`'s, at use — see §2);
- `tip`: non-empty string (an empty tip is the absent tip);
- `padding`: finite number ≥ 0. No upper cap: the value feeds
  `calc(n * var(--u))`, CSS degrades a silly value to an over-padded
  scrollable body, and the author who typed it can edit it back. A cap
  would be a guess (A5.16).

`sanitizeCardMeta(raw)` applies all four and returns only the fields that
pass; `parseCards`, `addCustomCard` and `updateCustomCard` all spread its
result. Ledger row: **card-meta-single-gate, rung 5** (shared helper — a
future writer could assign a field directly on a draft). Promote by
branding `CustomCardMeta` so an unsanitized record cannot be assigned.

## 5. Config versioning: why no bump

Verified against the load path, not asserted: `parseOverlayPayload`
(config/parse.ts:394) versions the ENVELOPE; v2 and v3 overlays parse
identically and `parseCards` rebuilds each def field-by-field. An old file
simply lacks the new fields (each is optional with a default = today's
behaviour, byte-for-byte). A NEW file read by an OLD build hits the old
`parseCards` whitelist, which strips the unknown fields and keeps
`{name, spec}` — graceful degradation, no crash, no data corruption on the
SD (the old build re-saves only what it kept, which is the pre-increment
shape). Additive-optional-with-defaults, so `CONFIG_VERSION` stays 3.

## 6. Tip and provenance

The fixed `"custom card"` tip existed to declare provenance. It becomes
the FALLBACK, not the rule: an authored tip replaces it (that is the
ticket), and CardTip's click-to-copy behaviour is untouched — the tip
travels through the same `Card`/`Panel` props as every registry tip.
Provenance now rests where it is actually enforced: the import review's
complete inventory (every template, every OM read — the gate a foreign
card cannot skip), the author-controlled title that custom cards always
had, and the compose drawer's "Your cards" section. A tip was never a
mechanism (rung 0); the review is.

## 7. Blocked-by-lock at time of writing (integration notes)

Increment 2's agent holds CardStudio.tsx, share.ts, ImportReview.tsx,
formModel.ts, app.css. The remainder of the full vertical that lives in
those files, specified here so integration is mechanical:

- **CardStudio** — four form fields (size W/H in cells, tip, padding in
  u), lifted from and lowered to the def alongside name/spec;
  `onSaved` grows a `meta` argument (or passes a whole def). tryFromSpec
  honesty is untouched: metadata is card chrome, not spec content, so it
  never rides the spec JSON and cannot make a form-refusing spec lift.
- **share.ts** — `exportCard` takes the full def and embeds
  `colSpan/rowSpan/tip/padding` in the card file; `parseShareFile` reads
  them through `sanitizeCardMeta` (already exported for exactly this);
  `CardImport` carries them; ComposedScreen's `commitImport` passes them
  to `addCustomCard`. Screen exports embed defs the same way.
- **ImportReview** — renders the metadata line (footprint, tip, padding)
  in the card inventory so a reviewer sees the chrome as well as the
  commands.

If the locks lift before this increment closes, the share/Studio parts
land here; otherwise they are called out as blocked in the increment
report and land with integration on GIT_194.

## 8. Tests (red-first)

test/custom-card-metadata.test.ts:

1. store round-trip + prune/merge survival (§3's falsifying check);
2. `updateCustomCard` patches fields, `null` clears them, invalid values
   are ignored (never written);
3. `parseOverlay` keeps valid metadata, drops each invalid field by
   itself, keeps the card;
4. `defaultCardSize`: registry id → registry size; custom id with authored
   size → authored (clamped); without → stock fallback; `addCard` places
   at the authored footprint through the one placement path;
5. old-shape overlay (no metadata) parses to exactly the old result.

Suites: `pnpm test` (ui + mock), `npx tsc -b --force`,
`python scripts/register_check.py --fast`, `pnpm build`. px lint stays
green (no new px anywhere; padding is `calc(n * var(--u))`).
