# Can't-break-by-design audit — 2026-07-22

Full-project audit against the enforcement ladder (0 comment · 1 convention ·
2 assert · 3 tests · 4 lint · 5 helper · 6 choke-point · 7 sole-constructor
type · 8 unrepresentable). Three independent sweeps: compose layer (I1–I16),
config/shell/OM boundaries, G-code write path. Every finding cites the code it
was verified against; ratings are the **actual** rung as constructed, not the
claimed one.

Verdict in one line: the composable-cards vocabulary built in phases A–B is
genuinely high-rung (branded `CompiledControlSpec`, closed selector grammar,
parse boundaries), but the older boundaries it sits on — the config overlay,
the OM network merge, the request queue — are casts and conventions, and the
compiler gate itself has been running without `strict`.

## HIGH

### H1. The e-stop can be blocked — by the queue and by connection state
`connector/PollConnector.ts:241-248`, `connector/requestQueue.ts:44-74`,
`shell/Shell.tsx:37`. **Rung 1–2.**
"High priority" only reorders *waiting* jobs; an in-flight upload holds the
single slot for up to `uploadTimeoutMs` (300 s), so M112 queues behind a bulk
transfer. Separately, `sendCode` throws `DisconnectedError` while status is
"reconnecting" and Shell's `.catch(() => undefined)` swallows it — STOP
silently does nothing.
**Promotion:** a dedicated e-stop path that fetches `rr_gcode` outside the
RequestQueue (and/or aborts in-flight low-priority XHR on high-priority
arrival) and does not gate on connection status.

### H2. Prototype pollution through the generic mergers
`config/store.ts:241-252` (`mergeInto`), reached **unpruned** at `:70-71`
(boot from localStorage) and `:226-227` (SD download). Same vector:
`om/store.ts:98-116` (`deepMergeInto`, fed raw board JSON) and `om/store.ts:67`
(`onModelKey` — `setOm("__proto__", …)` is expressible). **Rung 0.**
`JSON.parse` creates `"__proto__"` as an own property; `Object.entries` yields
it; `base["__proto__"]` reads `Object.prototype`, which passes `isPlainObject`,
so the merge writes attacker keys onto the global prototype. A crafted
`0:/sys/dwc-ng-config.json` or localStorage entry pollutes every object in the
app. (`prune()` incidentally drops the key on the `apply()` path — the two
load paths are the exposed ones.)
**Promotion:** one shared safe-iteration helper (skip
`__proto__`/`constructor`/`prototype`) used by `mergeInto`, `prune`, and
`deepMergeInto` — or better, parse the overlay against
`DEFAULT_CONFIG`-derived keys only (see H5).

### H3. The card-studio preview can send to the machine
`compose/CardStudio.tsx:239-249`, `app.css` (`.studio-preview-card
{ pointer-events: none; }`), `control/GcodeButton.tsx:37,55`. **Rung 1–2.**
The preview's inertness is CSS-only. `pointer-events: none` does not remove
buttons from the tab order, and `GcodeButton` sends via `useApp().connector`
— the real AppContext when the studio is opened from a screen. Tab+Enter in
the preview fires a real `sendCode`. (The Card Lab is safe only because it
swaps the provider — `dev/CardLab.tsx:143`.)
Also falsifies I16 as documented: sends go through the context connector, not
`ctx.connector`.
**Promotion:** wrap the studio preview in an `AppContext.Provider` carrying an
echo/no-op connector (the CardLab pattern) — a preview send then has no route
to the machine by construction. `inert` on the preview div is the
one-attribute stopgap.

### H4. The compile gate runs without `strict`
`packages/ui/tsconfig.app.json`, `tsconfig.node.json`: no `strict`, no
`strictNullChecks`, no `noImplicitAny` (verified via `--showConfig`).
**Systemic.** Every "bypass = compile error" claim is running with the
compiler's teeth out: `CardId | null` / `OmSelector | null` returns are
advisory, and return-exhaustiveness never fires.
`npx tsc -p tsconfig.app.json --noEmit --strict` passes with **zero errors
today** — enabling it is free and instantly restores the claimed rungs.

### H5. The config overlay is cast, not parsed — and bad `screens` bricks boot
`config/store.ts:268-277` (`parsePayload` casts after a top-level
`isPlainObject`; `version` read but never checked). **Rung 2 top-level, 0
inside.**
Most junk soft-fails, but `screens: "x"` or `screens: { hidden: {} }` merges
into `config.screens`; `screenList` (`compose/screens.ts:151`) does
`.includes(...)` → TypeError inside Shell's memo → the shell fails to render —
and because `writeCache` persists the bad overlay, it crashes **every
subsequent boot** from cache. `DeepPartial` (`config/types.ts:120-122`) is
complicit: it maps `string[]` to a partial object, so TS admits non-array
`hidden`. Downstream, `Object.keys(config.cards) as CustomCardId[]`
(`ComposedScreen.tsx:313`) trusts unvalidated keys; `screens.custom` keys are
never checked against the reserved namespace.
**Promotion:** a real per-section parser mirroring `DEFAULT_CONFIG`'s shape,
dropping bad leaves the way `parseComposition` drops bad slots; validate
`cards` keys as `c-…` + `{name, spec}` and `screens.custom` keys as `u-…`;
gate on `version`. The existing corrupt-file test covers non-JSON only — add
well-formed-but-mis-typed fixtures.

### H6. `ensureSlot` bypasses collision enforcement; the repair path destroys the user's layout
`shell/panelCanvas.ts:440-443`, caller `compose/ComposedScreen.tsx:93-100`.
**Rung 6 for drags, bypassed here.**
`ensureSlot` persists `clampRect(rect)` with no collision check, and `addCard`
places against composition rects while live geometry lives in the canvas tier
— which diverges after drags. Adopting a card at an overlapping rect persists
an overlapping `CanvasState`; on next mount `mergeCanvas`
(`panelCanvas.ts:340`) detects the collision and **discards the entire stored
layout** in favor of defaults — silent user-layout loss through the documented
repair path.
**Promotion:** make `persist()` the choke-point: `ensureSlot` runs
`collidesWithAny` and falls back to `findFreePosition` against the *live*
state.

### H7. The template weld welds copies, not the specs
`test/control-spec.test.ts:101-130` vs `compose/controls/builtin.ts:22-96`.
**Claimed rung 3, effectively 0.**
The test re-types every template string and welds *those copies* to `cmd.*` —
it never extracts templates from `HOMING_SPEC`/`MOVEMENT_SPEC` (only asserts
`nodes.length > 0`). A template edited in builtin.ts drifts green while
builtin.ts claims "drift fails CI". This is the tripwire itself, duplicated a
third time in the test.
**Promotion:** walk the actual spec nodes, collect every gcode-button's
`CompiledTemplate`, and resolve those objects against `cmd.*` — or export the
strings from commands.ts and import them in builtin.ts so drift is a compile
error.

### H8. The e-stop payload is a four-way duplicated literal
`shell/Shell.tsx:37`, `messagebox/MessageBoxPrompt.tsx:56`,
`dev/writeGuard.ts:36-44`, `test/write-guard.test.ts:90-110`. **Rung 1
coupling.**
`"M112\nM999"` exists as two independent component literals plus a parallel
encoding in `isEmergencyStop` plus test copies — no `cmd.emergencyStop()`
builder, and no test asserts the *buttons'* payload satisfies the matcher.
Change the button payload and the write guard blocks STOP on an unarmed real
board with nothing failing.
**Promotion:** `cmd.emergencyStop()` used by both buttons + a weld test
`isEmergencyStop(cmd.emergencyStop()) === true`.

## MEDIUM

### M1. Review/render switches are not totality-checked
`compose/share.ts:64-88` (`reviewSpec.walk` returns void — a missing case is a
silent no-op), `compose/controls/ControlList.tsx:73-167` (`RenderNode` returns
`JSX.Element`, which includes `undefined`). **Rung 1.**
Adding a `CompiledNode` variant compiles with the new node **omitted from the
import review's inventory** — the exact property the import-safety story rests
on. `parse.ts:125-126`'s `default: fail(...)` is correct as-is (untrusted side
must reject unknowns).
**Promotion:** `never`-asserting default arms in `reviewSpec.walk` and
`RenderNode` (and `resolveTemplate`/`applyQualifier`).

### M2. `parseShareFile` throws on hostile input despite "never throws"
`compose/share.ts:191,199` — `{"dwcng":"card","card":null}` reaches
`typeof card.name` and TypeErrors; caller `ComposedScreen.tsx:152-155` has no
catch → unhandled rejection, import silently no-ops.
**Promotion:** the same `asRecord` discipline `parse.ts` uses, pinned by a
hostile-file test.

### M3. Raw command literals outside the authority
- `cards/ActiveJobCard.tsx:112,115,118` — `"M24"`, `"M25"`, `"M0"` in raw
  `<button>`s (also bypassing GcodeButton), no builder, no test.
- `cards/FileCards.tsx:121` — `` `M98 P"${path}"` `` with **unescaped
  interpolation** — the exact bug class `messagebox/ack.ts`'s `quote()` exists
  to prevent; form duplicated at `:154`.
- `heightmap/store.ts:108` — `"G29 S1"` inline (test-pinned at least).
- `control/SpeedSlider.tsx:154` — the *title* stamp is a literal
  `M220 S${stop}` while the send uses `cmd.speedFactor` — the worn code can
  drift from the sent code.
**Rung 1.** `sendCode(string)` is public on the app context; a stranger's
`sendCode("G1 …")` compiles fine.
**Promotion:** add `cmd.pausePrint/resumePrint/cancelPrint/runMacro(path)`
builders (runMacro must quote-escape); stronger: brand `sendCode`'s parameter
(`GcodeCommand`) with producers only in commands.ts, ack.ts,
`resolveTemplate`, and an explicit console escape hatch.

### M4. Upload fetch-fallback silently swapped the timeout
`connector/PollConnector.ts:316-341`. CRC32 survived the dual-transport split
(computed once before the branch — rung 6), but the fetch fallback uses
`AbortSignal.timeout(requestTimeoutMs)` (5 s) where XHR uses `uploadTimeoutMs`
(300 s) — a multi-MB upload through the fallback aborts at 5 s. The comment
claims only progress events are lost. Partial duplicate-and-drop.
**Promotion:** one transport fn parameterized only over progress reporting.

### M5. Write-guard read/write classification is per-method judgement
`dev/writeGuard.ts:57-104`. The guard is a true sole-instance choke-point
(rung 6) with compile-enforced surface coverage (rung 7 — omitting a
`Connector` method is a compile error), but read-vs-mutation classification is
rung 1: a stranger adding a mutating method can put it in the reads block and
typecheck.
**Promotion:** split `Connector` into read/write halves so the guard wraps the
write half wholesale.

### M6. Id minting: duplicated expression, unbranded returns, comment-only namespaces
`config/store.ts:121,156` (identical mint expression pasted twice; interface
returns `string` at `:28,41`), casts at `ComposedScreen.tsx:162,189`,
`CardLab.tsx:166`. The `c-`/`u-` non-collision guarantee is prose
(`composition.ts:26-31`); `isCustomCardId` is checked FIRST at
`ComposedScreen.tsx:115`, so a future registry card literally named `c-…`
would be silently hijacked. No `u-` type exists at all.
**Promotion:** one `mintId<P extends "u-" | "c-">(prefix: P): `${P}${string}``;
declare `addCustomCard(): CustomCardId`, `addScreen(): UserScreenId`; add the
erasable compile assert `Extract<CardId, CustomCardId> extends never`.

### M7. `resetSection` can destroy creations; a test locks it in as spec
`config/store.ts:45-48,172-174`; `test/screens.test.ts:70` actually calls
`resetSection("screens")`. **Rung 0** (doc comment "No UI path does"). The
creations-survive rule is re-implemented as a skip-list inside `resetAll`
instead of `resetSection` being incapable of it.
**Promotion:** `resetSection(section: Exclude<keyof UiConfig, "cards" |
"screens">)`; fix the test.

### M8. OM network boundary is a trusted cast with partial containment
`connector/PollConnector.ts:157,173-174` (`res.json()` → cast),
`om/store.ts:67` (`reconcile(value as never)`). **Rung 1.**
Containment that exists: per-key reconcile, `emptyModel()` boot shape, poll
loop catch, `visibleFor` try/catch. Not contained: render-time consumers
(`Shell.tsx:25-30` `om.move.axes.filter`) throw uncontained if a subtree lands
non-array — the exact class of the layerStats incident.
**Promotion:** cheap per-key shape gates at `onModelKey` (array-ness of
`axes`/`heaters`/`tools`…), rejecting a bad key's update (keep last good).

### M9. TS↔CSS grid constants synced by comment
`panelCanvas.ts:18-38` (`GRID_COLS=48`, `COL_UNIT_PX=46`, `GAP_PX=6`,
`ROW_UNIT_PX=4`) vs `app.css:186-193` (`repeat(48, 46px)` etc.); the contract
is the comment "keep the two in sync". Drift breaks drag delta→cell math
silently. **Rung 0.**
**Promotion:** emit the grid template from the TS constants (inline style or
CSS custom properties) so CSS has no second copy.

## LOW

- **L1.** `exportScreen` embeds broken specs raw (`share.ts:126`) where
  `exportCard` refuses (`:102-104`) — produces a screen file that can never
  import. Align on skip-and-surface or refuse.
- **L2.** Built-in screen compositions are runtime-mutable — the `Composition`
  annotation defeats `as const` (`compose/screens.ts:27-123`). Declare with
  `satisfies` (no annotation) or `Readonly<Slot>`.
- **L3.** No lint layer confines `fetch`/XHR to `src/connector/**` (no ESLint
  config exists in the repo). Encapsulation currently holds by reading.
- **L4.** `LAB_ROUTE = "cards"` vs screen-id namespace is convention
  (`router.ts:15`); a compile assert makes collision impossible.
- **L5.** Slot→rect projection duplicated (`ComposedScreen.tsx:177-178` vs
  `screens.ts:204-207`); canvas-sync keeps unknown junk ids forever
  (`ComposedScreen.tsx:96-99`); `"label" as never` setter casts in
  `CardStudio.tsx:211-223`; `addCustomCard`'s store write erases type checking
  via cast (`store.ts:157`).
- **L6 (doc drift).** I5's `needs` field and I13's `CONTROL_TYPES` registry
  don't exist as documented — the actual mechanisms (typed `ctx.service()`
  provisioning; closed `ControlNode` union + default-reject parse) are as
  good or better, but the design doc describes machinery that isn't there.

## Per-invariant table (claimed vs actual)

| # | Claimed | Actual | Verdict |
|---|---|---|---|
| I1 slot ids parse-or-drop | 8 | 8/7 (gate non-strict → H4) | OK w/ H4 |
| I2 composition shape | 8 | 8 render / re-parsed storage | OK |
| I3 one visibility truth | 8 | 7 (sole renderer closure; CardLab dev bypass documented) | OK |
| I4 size from registry | 8 | 7 | OK |
| I5 services on demand | 7 | 8-by-elimination, mechanism misdescribed | OK (doc drift) |
| I6 share format total | 8 | 8 format; review not totality-welded (M1), parser partial (M2) | GAP |
| I7 sends via guarded connector | 7 | 6–7 (choke is AppContext, not ctx) | OK w/ H3 |
| I8 one renderer | 7 | 6–7 | OK |
| I9 nav derived | 8 | 7–8 | OK |
| I10 rename ≠ identity | 8 | 7–8 | OK |
| I11 id namespaces | 7–8 | **2–5** (mint convention + list order; overlay unparsed) | **GAP** (H5, M6) |
| I12 overlay resets clean | 8 | 7 (builtins runtime-mutable, L2) | OK |
| I13 closed control vocab | 8 | 8 data path; render/review totality unwelded (M1) | OK w/ M1 |
| I14 selector grammar sealed | 8 | 8 (branded, sole constructor, injection-tested) | OK |
| I15 controls wear commands | 7 | 7 (stamp suppressible; review shows all) | OK |
| I16 preview cannot send | 7 | **6, mechanism misdescribed** | **GAP** (H3) |

## Verified-good (calibration)

- `files/path.ts` — the model citizen: branded `FileName`, `parseFileName`
  sole constructor, `childPath` refuses raw strings. Rung 7.
- `CompiledControlSpec` — branded, `compileControlSpec` sole constructor; no
  unparsed spec can reach `ControlList` today (all mount sites verified).
  Rung 7.
- Selector/template grammar — closed, no eval form, injection-tested. Rung 8.
- `parseComposition`/`parseCardId` — real boundary with per-slot degradation.
- Share import mints fresh ids — foreign files can't collide by construction.
- Write guard — sole-instance wrapper, fail-closed, compile-enforced surface.
- CRC32 — computed once inside the sole upload method, both transports.
- `messagebox/ack.ts` — second builder authority, exhaustively pinned
  (seq-echo, quote-escaping).
- Canvas storage — versioned envelope, tolerant parse, migration tests.
- Config writes — single `apply()` choke-point.
- Router — no route list; meaning resolved solely against the screen registry
  with a never-empty fallback.

## Suggested fix order

1. **H4** `strict: true` (zero-cost today; restores every type-level claim).
2. **H2** safe-key iteration in the three mergers (small, closes the security
   hole).
3. **H3** provider-swapped studio preview (CardLab pattern already exists).
4. **H1 + H8** `cmd.emergencyStop()` + unqueued e-stop path (one feature:
   "the STOP button cannot be blocked or drift").
5. **H7** weld the real specs; **H5** parse the overlay (+ version gate);
   **H6** collision-checked `ensureSlot`.
6. M-tier promotions opportunistically as their files are touched
   (grandfathering rule), starting with M3's raw literals and M4's timeout.
