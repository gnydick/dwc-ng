# Code review — GIT_86 (machine identity, phase 1), whole branch at `bf363c5`

Second pass. First pass ran at `0949d2d`; all its blocking issues were fixed and eleven further commits landed after it, including fixes for a live outage on the owner's printer.

## Verdict

**Blocking issues:**

1. The `dirty` guard is person-scoped but gates a machine-scoped load — machine B never reads its own SD config, and a Save then destroys it (reproduced by execution).
2. `b7ac2f2`'s `seedFromOverlay` is evaluated before the SD overlay exists, so it can never fire on the real upgrade path; the coded default layout is persisted over the operator's saved one and then written back to the card (reproduced by execution).

Four Important, six Minor below.

Read in four passes: (1) ledger and post-mortem; (2) the five new/changed identity modules end to end; (3) the machine-scoped consumers; (4) the eleven post-first-pass commits individually plus the lint and migration tests. Where reading raised a doubt, the real modules were run under `node --conditions=browser` rather than reasoned about — three probes, quoted below. No subagents spawned; nothing modified.

## End-to-end traces

**(a) Cold boot, no stored data.** `loadPersonCache()` → null; `createComputed` → `hydrateMachine(null)` → machine half `{}`, `writeMachineOverlay` returns before touching storage. Identity resolves during `PollConnector.fullSync` (`boards` and `network` are both seqs keys, `PollConnector.ts:191-201`, awaited inside `connect()`), the computed re-fires with a real handle, reads an empty `"config"` key, commits `{}`. `loadFromMachine` then finds no file (`FileNotFoundError`) and commits clean. Correct.

**(b) Upgrade from v2 with `dirty: true` (the live outage).** Verified fixed, and by the right mechanism, not just by its test. `loadPersonCache` merges the legacy cache (`dirty: true`), `loadFromMachine` captures `wasDirty` at `store.ts:858`, `readStampedMachineOverlay` returns `migrated: true` for `version !== 3`, and `store.ts:943` `if (!stamped.migrated && wasDirty) return` lets migration through. `person = wasDirty ? local : filePerson` keeps the unsaved person half, the machine half is adopted, and `saveToMachine` re-stamps as v3. `config-migrate-v3.test.ts:275` pins it. Good — but the guard is only carved out for `migrated`; see Critical 1.

**(c) Second, different printer in the same browser.** This is where it breaks. See Critical 1.

**(d) SD card moved from board A into board B.** v3 file: `readStampedMachineOverlay` sees `writtenFor = "b.A"` != `"b.B"` → `claimed`, the machine half stays B's, the file's bytes sit only in the closure-private `pendingClaimOverlay`. Correct, and genuinely unreachable from outside the module. Two notes: the file's **person** half is adopted unconditionally in that same branch (`store.ts:950`, by design — person follows the person), and a **v2** file on a moved card is adopted as B's under the amnesty. The amnesty is spec'd and unavoidable (v2 carries no origin evidence) but it is the one remaining silent cross-machine adoption in the design, and it is not named anywhere in the code as such.

**(e) Identity re-resolving mid-session.** `hydrateMachine` rebuilds the machine half from the new handle and clears both `pendingClaimOverlay` and `meta.claimedProfile` (`store.ts:463-471`); `hydrateConsole` flushes the outgoing machine's pending debounce *before* rebinding (`om/store.ts:172-181` — `scheduledFor` captured at schedule time, correct); `createCommandHistoryState.bindMachine` replaces rather than folds; `draftSession.rebind` returns `"swapped"` and `FileEditor` drops the session; `ComposedScreen`'s keyed `<Show>` remounts the canvas against the new store. This chain is the strongest part of the branch. One residual: after a bind, `bindMachine(null)` is a no-op, so a command typed during an A→unidentified window persists to A (`commandHistory.ts:120-131`). Attributed to the last-known machine, so not a leak — Minor.

**(f) A machine that never identifies.** `569b478` fixed it correctly and did not open a second door: `nullCanvasKeys()` is a plain `Map`, never `localStorage`, and `UNIDENTIFIED_CANVAS` is a module-level sentinel so repeated unidentified renders do not remount. `machineKeySegment` still takes only `IdentifiedMachine`. But the mode is not actually usable: `saveToMachine` returns at `store.ts:806` when `handle === null` while the Save button (`SettingsCards.tsx:698-701`) is enabled and reports nothing — silent no-op. See Important 4.

## The headline claim

**Two reachable paths where one machine's persisted state destroys or misrepresents another machine's truth.** Neither is a leak of A's *values* into B's key; both are the mirror image, which is worse for a motion envelope: B's real settings are replaced by a fiction and then written to B's card.

Attempts that **failed** (i.e. the design held):

- `persistCache` racing an identity change — `createComputed` runs synchronously in the same update batch as the memo, and no reactive code calls `commit` outside `hydrateMachine`.
- `adoptClaimedProfile` surviving a re-identify — cleared unconditionally in `hydrateMachine`, and `pendingClaimOverlay` is unnameable outside the closure.
- `loadFromMachine` straddling its `await` — `handle`, the stamp check, `commit`, `stampMachineOverlay` and the payload are all read in one synchronous block after the download.
- Snapshot id collision between machines — ids minted per snapshot, `parseMachineSnapshots` re-splits on read.
- `machineKeySegment` collision — theoretically live, practically unreachable (Minor 1).

Attempts that **succeeded**: the person-scoped `dirty` flag crossing machines (C1); the canvas seed's evaluation instant (C2); custom-screen geometry crossing machines through the person half (I2).

## Issues

### Critical (must fix before merge)

**C1. `config/store.ts:943` (and `:858`, `:900`) — an origin-global `dirty` flag gates a machine-scoped load; the next Save destroys the other machine's config.**

`meta.dirty` is restored from `dwc-ng.person`, which is deliberately *not* machine-scoped. So unsaved work done while pointed at machine A makes `wasDirty` true on the next boot pointed at machine B, and `if (!stamped.migrated && wasDirty) return` refuses to load B's own, correctly-stamped, matching-identity SD file. B then renders empty machine settings with **no claim row and no warning** — nothing was claimed, so the identity card has nothing to say. Executed against the real modules:

```
A session dirty = true
B boot: dirty inherited from person cache = true
B after load: axisRoles = {} envelope = null
B claimedProfile = null
B SD file after Save: axisRoles = undefined shaping = undefined
```

The last line is the damage: `saveToMachine` uploads `{version:3, machineId:"b.B", overlay}` built from the empty machine half, stamped as B's own, over B's intact config. Axis roles, dock sensors, bed probe command and the motion envelope are gone from the card, and the file now looks authoritative.

This is the live outage's exact mechanism in a second instance. `a5aa651` carved out only `stamped.migrated`; it never asked what else `dirty` could be true *about*. That is the post-mortem's named generator (local confirmation for general confirmation) firing a sixth time, in the fix for the fifth.

Fix: `dirty` describes unsaved edits to a specific pair of halves. Either (a) scope the flag's machine component into the machine store so `wasDirty` means "unsaved edits *for this machine*", or (b) at minimum split the guard — the person half's dirtiness must not withhold the machine half's load, since the machine half's local copy for a machine you have never loaded is `{}` by construction and has nothing to protect. The "unidentified" branch at `:900` needs the same treatment.

Noted honestly: not a regression *created* by the branch — pre-split the same guard existed and the outcome was arguably worse (A's actual values written to B). The branch narrows it but leaves the destructive half live, and the branch exists specifically to make this class unreachable.

**C2. `compose/ComposedScreen.tsx:175` + `shell/panelCanvas.ts:1424-1430` — the seed added by `b7ac2f2` cannot fire on the path it was written for.**

`b7ac2f2` is a genuine, complete revert of `b9bdcbf`: `growToDefaults` diffed across `b9bdcbf..b7ac2f2` — the early-return block is removed in full, nothing layered on top. Confirmed.

The replacement is evaluated at the wrong instant. `savedScreenLayout(app.config.config, screenId)` is read `untrack`ed at canvas construction. Construction happens the moment the keyed `<Show>` swaps from the sentinel to a real `MachineStore` — i.e. during `fullSync`, inside `connect()`. `loadFromMachine` runs only after `connect()` resolves. So at seeding time the config's machine half is still whatever the (empty) machine store held:

```
boot, unidentified:                       seed = null
identity resolved, SD not yet loaded:     seed = null
after loadFromMachine:                    seed = {"shaping-decay":{"col":210,...}}
```

And the settle-write at `panelCanvas.ts:1430` fires immediately, so the window closes for good:

```
dwc-ng.m.b.X.canvas.control = {"v":4,"state":{"a":{...coded...},"b":{...coded...}}}
```

On every later boot `isWhollyEmpty` is false and the seed is ignored. Consequences:

- The operator's saved layout for whichever screen is on view at first identified boot is silently replaced by the coded defaults — permanently, since `ensureSlot` returns early for ids it already tracks (`panelCanvas.ts:1537-1538`), so the SD layout arriving 200ms later changes card *membership* but never geometry.
- The next "Save to machine" runs `captureScreenGeometry` (`compose/screens.ts:448-463`), which reads that machine's canvas key and calls `replaceAllScreenCards` — writing the coded defaults over `screens.layouts` on the SD card. Real loss, on the card, of the thing the operator arranged.
- `611011c` reflowed `SHAPING_COMPOSITION`, so on the Shaping screen the loss is guaranteed to be visible.

Same symptom Gabe reported on `DTvDnGVZ` ("Control shows the Printing card I removed"), by a different route. The task-16 report is careful and correct about *what* `defaults` is; it never asks *when* the seed is read, and its two tests hand the seed in directly — the instance confirmed, not the class.

Fix: the canvas must not bind to real storage until the first SD load attempt has completed. Add a `configLoaded` accessor to `AppServices` (set in `App.tsx` after `loadFromMachine` settles, success or `FileNotFoundError` alike) and include it in the `<Show>`'s key alongside `machineStore()`, so the unidentified branch's already-correct non-persisting `nullCanvasKeys` covers the whole pre-load window. That also makes the seed's precondition true by construction rather than by hoping about poll timing.

### Important (should fix before merge)

**I1. `config/store.ts:757-766` — reverting to another machine's snapshot erases this machine's config.**

`meta.snapshots` is person-scoped and origin-global, so the revert list shows restore points taken on every machine, undifferentiated. `revert` looks the machine half up in the current machine's own `"snapshots"` key and falls back to `{}` on a miss — then commits that `{}` as the machine half, persisting the erasure and marking dirty:

```
B before revert: axisRoles= {"U":"B-role"}
snapshots visible on B: [ 'on A' ]
B after reverting A-snapshot: axisRoles= {}
B machine store config key = {"version":3,"overlay":{}}
```

The `revert-machine-half-scoped-to-current-machine` invariant claims `@rung 6` and says a miss "read[s] as 'nothing to restore' — `{}` — never a guess". `{}` is not "nothing to restore"; it is "restore emptiness", a destructive act. The needed distinction is already available: `snapshot()` writes an entry to the current machine's key **unconditionally**, even when the machine half is empty (`store.ts:729-733`), so *absence of the id* provably means "not taken on this machine". Fix: when the id is not found in this machine's store, leave the current machine half unchanged (and ideally say so in the UI). As written the stated strength exceeds the mechanism.

**I2. `config/store.ts:614-617` + `compose/screens.ts:334-338` — custom-screen layouts are person-scoped while built-in layouts are machine-scoped.**

`replaceAllScreenCards` writes a user screen's geometry into `screens.custom[id].cards`, which `splitOverlay` (`types.ts:385-390`) assigns to the **person** half — origin-global. `captureScreenGeometry` reads *this machine's* canvas store and writes it there, so machine A's arrangement of a custom screen becomes machine B's seed and B's arrangement overwrites A's on the next save. `savedScreenLayout` reads the same field for the seed, so the two halves of the layout story disagree about scope.

Ruling 13 spent four messages settling that `screens.layouts` is machine-scoped and never asked about the sibling field holding byte-identical data for user screens. Layout data only, so no physical hazard — but it is precisely the defect class this campaign exists to close, surviving inside the campaign. Either move `screens.custom[].cards` geometry to the machine half (keeping the screen's *definition* person-scoped), or record the asymmetry as a deliberate decision in the spec.

**I3. `compose/screens.ts:125` — the machine-identity card is invisible to exactly the operators it was built for.**

`"machine-identity"` is added to the coded `SYSTEM_COMPOSITION`, but a saved `screens.layouts["system"]` replaces a built-in's composition **wholesale** (no merge — `screens.ts:264-276`). Every upgrading operator has a saved System layout that predates the card, so the one surface that makes a wrong identity discoverable — the spec's stated safety argument, §3 — will not render for them. Fix: either merge coded-only cards into a saved built-in layout for ids the saved layout has never named, or surface the identity/claim/dropped-sections lines somewhere not layout-governed (the preflight strip already carries exceptional state).

**I4. `config/store.ts:806` + `cards/SettingsCards.tsx:698-701` — "Save to machine" is a silent no-op on an unidentified machine.**

`no-unstamped-sd-write` is the right call, but the button stays enabled, `captureScreenGeometry` also returns early, nothing uploads, no error is set, and "Unsaved changes" stays lit. Spec §3 says an unidentified machine has "no local machine cache at all: SD is its only store" — the code makes SD unwritable too, a defensible tightening that is nowhere recorded and nowhere explained to the operator. Fix: disable the button when `!isIdentified(app.machineId())` with the identity card's own explanation, or set a `saveError`. Also worth a line in the spec, since code and spec currently disagree.

### Minor (can ship)

- **`config/machineId.ts:78` — `machineKeySegment`'s board branch is not injective.** `uniqueId.replace(/[.\s]/g, "-")` maps `"A.B"` and `"A-B"` onto the same key, and the MAC branch's `replace(/[^0-9a-f]/g, "")` can produce an empty segment for a garbled MAC (all such machines then share one profile). Unreachable with real Duet unique ids, but it sits three lines from `safeSuffix`, whose doc comment argues at length that exactly this substitution is unsafe. Use `safeSuffix` here too and the argument becomes uniform.
- **`config/migrateStorage.ts:14` — stale invariant justification.** `@rung 6 choke-point — test/storage-keys.test.ts (skipped until Task 10, which unskips it)`. The test is not skipped; the parenthetical understates the enforcement and reads as an open TODO.
- **`config/machineStore.ts:11` — "Task 4 adds a lint…"** Same shape: a forward reference to work that landed. Both are the kind of drift `bf363c5` went looking for and did not find.
- **`config/parse.ts:105-108` — `camera.pinned` is dropped silently on upgrade.** It moved to `cameraPrefs.pinned` with no migration arm, so every existing operator's pin preference resets. Trivial in effect, but an unreported drop in a branch whose whole discipline is that drops are reported (`droppedSectionsText`).
- **`cards/SystemCards.tsx:36-40` — the identity row's label changes width across the transition.** `identityRow` returns `"Not identified"` then `"Board"`; `.field-label`'s `min-width: calc(14.5 * var(--u))` (`app.css:1327`) is narrower than `"Not identified"` in Rajdhani 700, so the value column shifts left when identity lands. The ledger's queued item asked for this to be verified; it appears not to have been. A `min-width` sized to the longest label fixes it.
- **`om/commandHistory.ts:120-123` — a command typed during an A→unidentified window persists to A.** `bindMachine(null)` is a no-op by design, but `push` still writes through `boundStore`. Attributed to the last-known machine, so defensible; worth a sentence in the doc comment, which currently reads as if unbound means non-persisting.
- **`shell/panelCanvas.ts:1350-1408` — `createPanelCanvas` now takes six positional parameters**, with the sole real call site passing `undefined` for `bench` to reach `seedFromOverlay`. An options object would remove a whole class of miswiring in a function now load-bearing for layout attribution.

## Residue from superseded fixes

`b9bdcbf` → `b7ac2f2` is clean. `growToDefaults` diffed directly across the two commits: the entire early-return block is gone, nothing layered on top, `grew`/`reflow` semantics byte-identical to pre-`b9bdcbf`, and `b9bdcbf`'s now-false regression test ("wholly empty store uses composed defaults verbatim") was removed rather than left asserting the old contract. The bench path still reads `storedRaw` and never the seed, so the Card Lab is genuinely untouched. The only residue is architectural: the sixth positional parameter above, and the fact that the replacement mechanism is inert on the real path (C2) — which is not residue so much as the fix not landing.

No other reversal left anything behind. `dda99b2` → `6f5b88d` (the `screens.layouts` scope round-trip) is byte-identical to its pre-Ruling-12 state, as the post-mortem records.

## Rulings or fixes judged wrong

- **Ruling 13's *reasoning*, and the spec's §4 closure at `2026-08-24-machine-profile-design.md:554-560`.** The verdict is right and the code is right, but "layouts are a machine fact" was never the deciding variable, and because it was recorded as the reason, nobody checked the field that holds the same data for user screens. That omission is Important 2. The post-mortem diagnoses the closure as a documentation failure with no verification consequence; it had one.
- **`a5aa651` (the outage fix) was scoped too narrowly, and the ledger's own correction stopped one step short.** The corrected root cause names `config/store.ts:846`'s dirty guard as the defect. The fix treats it as a *migration* problem and carves out `stamped.migrated`. The guard is a *scope* problem — an origin-global flag deciding a per-machine question — and the second instance (C1) is at least as destructive as the first. Candidate Rule 2 from the post-mortem ("a ruling that names a class must enumerate every instance") would have fired here if applied to the incident's own fix, not only to Ruling 23.
- **Task 16's verification.** The report is unusually good at explaining why the previous fixtures could not have caught the bug, then repeats the shape one level up: both new tests pass `seedFromOverlay` in directly, which can only confirm "seeding works when a seed exists". The unasked question — does a seed exist at the moment `createPanelCanvas` runs, on the real boot path — is answerable in ten lines of plain Node against the real modules. No jsdom needed.

## Test integrity

No `createRoot` with an un-awaited async callback anywhere in `packages/ui/test` — Ruling 4 holds; `config-claimed.test.ts:44-48`'s `runInRoot` captures the promise inside the synchronous `withLocalStorage` body and awaits it outside, which is correct and well documented.

What the missing jsdom leaves uncovered, precisely: `569b478`'s DOM claims — that both `<Show>` branches render the same card set, that the compose drawer hides while unidentified, that the sentinel does not cause a remount per poll tick, and that the identity card's two rows lay out as house `.field` rows. The mechanism beneath them (`nullCanvasKeys` never touching storage, the null→machine transition being a clean swap) *is* covered by `panel-canvas.test.ts` with a falsification recorded, and that is the part that could leak. The render gap is acceptable for merge: the untested claims are cosmetic or structural-JSX, and every claim with a storage consequence has a node-level test.

What is **not** acceptable is treating "no jsdom" as the reason C2 went unnoticed. C2 is an ordering fact about three plain functions, and a probe with no DOM at all falsifies it in seconds.

## Strengths

- **The `Accessor<MachineStore | null>` required-parameter pattern** (`store.ts:269`, `om/store.ts:102`) is the branch's best move: pre-identity is representable, forgetting identity is a compile error, and every `() => null` at a call site reads as a declaration. Applied twice, consistently.
- **`pendingClaimOverlay` as a closure-local with a single reader** is a real rung-6 mechanism, not a claimed one — no module outside `createConfigStore` can name the value, so "claimed cannot be consumed as fact" holds by construction rather than by a flag anyone must remember to check.
- **`safeSuffix`'s injectivity argument** (`machineStore.ts:79-91`) is the most rigorous reasoning in the branch, and keeping the four canvas records as four `MachineKeyName`s rather than one suffix-encoded key follows from it correctly.
- **`flushNow`/`scheduledFor`/`currentMachineStart`** in `om/store.ts` handles the console swap properly, including the capping arithmetic edge case, and eagerly captures the store at schedule time rather than resolving it at fire time. `commandHistory` and `draftSession` each adopt the variant appropriate to their own harm model rather than copying it.
- **The migration's evidence-based asymmetry** — SD self-attributes, localStorage does not, so one is adopted and the other dropped and *reported* — is a genuinely good design idea, cleanly implemented, and `readAndClearLegacyPersonCache`'s remove-on-read makes a partial run harmless.
