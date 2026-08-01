# Full invariant coverage: found, filed, and promoted

**Status:** design, awaiting review · **Date:** 2026-07-31

Goal, in one sentence: **every invariant in this repo is enumerable, declared
beside the mechanism that enforces it, sitting at rung 6 or higher, and none of
those three can silently stop being true.**

Bar set by Gabe, 2026-07-31: *filed **and** promoted to rung 6+*, with the
register *declared in source and generated out*.

---

## 1. Why — the measured state

Not a suspicion. Five findings, each re-checkable.

**F1 — the ledger is incomplete, not merely stale.** `docs/invariant-ledger.md`
holds exactly one row and was last touched 136 commits ago. The
2026-07-22 audit closed with its own "Remaining ledger" of three deliberate
debts; **none** were ever filed there, and at least two are still open in code:

```
packages/ui/src/connector/types.ts:131    sendCode(code: string): Promise<string>;
```

That is the audit's stated rung-7 promotion (a branded `GcodeCommand`) — promised,
never done, never recorded. `cards/ActiveJobCard.tsx` likewise still has four raw
`<button>`s against the same audit's note.

**F2 — four unrelated ID schemes, two of which collide.**

| Source | Scheme | Count |
|---|---|---|
| `docs/composable-cards-design.md` | I1–I16 | 16 |
| `docs/dsf-connector-design.md` | C1–C14, D1–D13 | 27 |
| `docs/cant-break-audit-2026-07-22.md` | H/M/**L**1–L6 (severity tiers) | ~20 |
| `docs/invariant-ledger.md` | **L**1 (a debt row) | 1 |
| `src/dev/layoutAudit.ts` | A, B | 2 |

`L1` denotes a layout-replacement debt in one file and "Low-severity finding #1"
in another. Nothing joins these lists, so the question *"is that all of them?"*
has no place where it could be answered — which is why it never has been.

**F3 — the mechanisms are better than the bookkeeping.** Six genuine rung-7
branded types exist and work (`OmSelector`, `CompiledTemplate`, `FilePlan`,
`FileName`, control `spec`, `mintId`), plus seven `never`-exhaustiveness welds.
None are enumerated anywhere.

**F4 — rung 2 is carrying a lot.** 67 `throw new` sites across the three
packages.

**F5 — claims outnumber records 21 : 1.** Twenty-one invariant claims live in
source doc comments; one has a ledger row.

### The root cause

An invariant's **claim** lives in `docs/` while its **mechanism** lives in
`src/`, with a human as the only link. Two artifacts that must agree and no
generator between them — anti-pattern A5.8. Process rule 10 ("state the
invariant and file its row in the same commit") was itself enforced at rung 0: a
sentence in a document that anyone can fail to read. **136 commits is the
measurement of how fast rung 0 decays.**

---

## 2. What counts as an invariant

The sweep needs a boundary or it never terminates. An invariant is:

> A property that must hold across **all** executions, whose violation is a
> defect rather than a preference, and for which some identifiable mechanism is
> responsible.

Included: safety properties ("an operator-typed name cannot escape its
directory"), representation rules ("a screen's geometry is written to both tiers
or neither"), protocol obligations ("the e-stop path is never queued behind a
gated write"), and layout contracts ("a card's reported minimum does not depend
on its own width").

Excluded: style, naming, performance targets, and anything whose violation
produces a worse result rather than a wrong one. Those are `be-reasonable`
territory, not this register.

---

## 3. Declaration — at the mechanism, never in `docs/`

A block comment immediately above the code that enforces the property:

```ts
/**
 * @invariant path-escape
 * @rung 7  sole-constructor type — parseFileName is the only producer of
 *          FileName, and every path-joining function takes FileName, not string
 * @why     a name the operator typed can never reach outside its directory
 */
```

**Comment-based, so zero runtime bytes.** Non-negotiable under the RRF payload
constraint; a registry of runtime objects would ship in the bundle for no user-
facing gain.

**The namespace is derived from the directory, not written.** The author writes
the slug `path-escape`; living in `packages/ui/src/files/` makes the id
`files/path-escape`. A wrong namespace is therefore unwritable, and moving a file
renames its id *visibly in the register diff* rather than leaving a quiet
mismatch. (Trade-off accepted: prose citing an id elsewhere is unchecked and can
go stale — citations remain rung 0, as they are today.)

The derivation rule, stated exactly: strip the leading `packages/<pkg>/`, then
strip a leading `src/`, then take the remaining directory path with `/`
separators. A declaration in a package root or directly in `src/` uses the
package name.

| File | Namespace |
|---|---|
| `packages/ui/src/files/path.ts` | `files` |
| `packages/ui/src/compose/controls/spec.ts` | `compose/controls` |
| `packages/ui/src/app.css` | `ui` |
| `packages/deploy/src/manifest.ts` | `deploy` |

Ids are unique **within a namespace**, so two files in the same directory cannot
both claim `escape` — that collision is a hard error, and is intended: a
directory is one conceptual area.

**Scanned file types:** `.ts`, `.tsx`, **and `.css`** — layout invariants live in
`app.css` and need the same home as the rest.

Fields:

| Field | Required | Meaning |
|---|---|---|
| `@invariant <slug>` | yes | kebab-case, unique within its namespace |
| `@rung <0-8> <mechanism>` | yes | the number **and** the named mechanism, in that order |
| `@why <sentence>` | yes | what breaks in the world if it fails |
| `@debt <promotion>` | only when rung < 6 | the specific promotion that would close it |

**Rung is assigned from the mechanism, never from the wording** (skill process
rule 9). "No named mechanism" is rung 0 however confident the sentence sounds.

---

## 4. The generator and the gate

New workspace package `packages/invariants` (`@dwc-ng/invariants`) — zero
dependencies, Node's native TS stripping, matching `mock-duet` and `deploy`.

It walks all three packages' sources, extracts every block, and emits
`docs/invariant-register.md` under a `DO NOT EDIT — generated` header.

**Hard errors (the generator exits non-zero):**

- duplicate id within a namespace
- missing `@rung`, `@why`, or a malformed/out-of-range rung
- rung < 6 with no `@debt`
- `@debt` present with no promotion text, or on a rung ≥ 6 declaration
- a `@rung` line with a number but no named mechanism after it

**The gate rides the existing test command.** `pnpm test` at the root already
runs `pnpm -r --if-present test`, so `packages/invariants/test/*.test.ts` is
picked up with nothing new to remember. Three tests:

1. **Drift** — regenerate in memory, assert byte-identical to the committed
   `docs/invariant-register.md`.
2. **Validity** — the hard-error list above, one case each.
3. **Ratchet** — see below.

`docs/invariant-ledger.md` is **deleted**, its single row migrating to a `@debt`
declaration on `ConfigStore.updateScreenCards`. Leaving it in place would be a
rung-0 invitation to file rows in a dead file (A5.18: delete the alternative,
don't leave it unused).

---

## 5. The debt ratchet — what actually holds the rung-6 floor

A gate that permits `@debt` is an allowlist, and allowlists grow silently
(A5.10). Without a counter, "filed and promoted" quietly degrades to "filed",
because writing `@debt` is always the cheaper move at 2am.

So: `packages/invariants/debt-ceiling.json` holds one committed integer —
`{ "ceiling": <n> }`, nothing else, so the diff is always a single changed digit.
The ratchet test fails when **`actual > ceiling`**. Lowering the ceiling is free;
raising it is a deliberate commit with a number going up in the diff.

This converts *"did the standard slip while nobody was looking?"* from a question
requiring an audit into one answered by `git log -p` on a single file. It is
technique 13 — monotonicity — applied to the process rather than to the data.
Phase 2 ends when the ceiling reaches **0**, at which point the generator's
`rung < 6 ⇒ error` rule stands alone and `@debt` becomes unwritable.

---

## 6. What this honestly cannot do

**An invariant nobody perceived cannot be enforced by a machine.** No generator
detects a missing declaration. This gap is real, is not closable, and gets an
explicit label rather than a pretence — an unlabelled gap reads as protection and
will be trusted (A5.17).

Two mitigations, both stated at their true strength:

- **Rung 4** — a lint failing any diff that introduces `callers must` /
  `should` / `by convention` / `in practice` / `guaranteed by` into `src/`
  without a matching declaration. Catches the syntactic tells, not the silent
  ones.
- **Rung 3 at best** — the sweep itself, which is human and model judgment.

The register's own preamble will state: *completeness-of-discovery is rung 4.*

---

## 7. Phasing

**Phase 1 — mechanism, then sweep to an honest register.**

Build the generator, gate and ratchet; then read all 247 source files in risk
order, declaring every invariant found **at its true current rung**, promoting
nothing yet:

`connector` → `control/commands` (hardware safety) → `config/parse` → `files` →
`compose` → `om` → `shell` → `cards` → `deploy` → `mock-duet` → `app.css`

Deliverable: the complete register, plus a **measured** count of how many sit
below rung 6, which becomes the opening ceiling.

**Phase 2 — promote everything below 6; ratchet to zero.**

Scoped from Phase 1's actual output, one module per commit, each carrying the
A/B regression test the skill requires plus a red check proving the test can
fail.

**Phase 2's size is deliberately not estimated here.** Guessing it before the
sweep would be a number with nothing behind it; Phase 1 exists precisely to
replace the guess with a count. Where TypeScript offers no rung-7 encoding
(CSS geometry, live-hardware behaviour), the promotion is the skill's §3 escape —
generate the artifact from typed source, or seal it behind one route — which
reaches rung 6 and satisfies the floor. Any invariant that turns out genuinely
unable to reach 6 comes back to Gabe as a named decision rather than a quietly
written number.

---

## 8. Testing

| What | How | Red check |
|---|---|---|
| Generator extraction | fixture tree with known blocks | a block with a typo'd tag is not extracted |
| Each hard error | one fixture per rule | rule removed ⇒ fixture passes |
| Drift | regenerate vs committed | mutate the committed file ⇒ fails |
| Ratchet | count vs ceiling | add a `@debt` fixture ⇒ fails |
| Red-flag lint | seeded phrase in a fixture diff | phrase without declaration ⇒ fails |

Every new declaration added during the sweep is a claim about existing code, so
the sweep adds **no** behavioural tests; it may, however, surface invariants that
are *claimed but not actually enforced*, and each of those is a bug to be filed
and fixed on its own merits rather than declared at a flattering rung.

---

## 9. Continuous review — decided: deferred

**Continuous review** (skill §6 — offer, do not assume): a background agent could
watch the diff since the last register update, report *mechanism* changes ("rung 3
— enforced by test X" rather than a bare verdict), and escalate a dropped rung —
a sole-constructor type gaining a public field, a choke-point gaining a second
caller — immediately rather than in batches. It proposes; it never promotes.

**Decided 2026-07-31 (Gabe delegated the call): defer.** The ratchet and the
drift test already catch the failure mode that actually occurred here, and a
watcher would be built for one we have not observed. Revisit only if Phase 2
shows rungs dropping *between* audits — that is the signal that would justify it.

The §6 rung-4 label likewise stands as written. The remedy for weak discovery is
a wider sweep rather than a more confident word, and Phase 1 is already the wide
sweep: all 247 source files, not a sample.

---

## Phase 1 outcome — measured 2026-07-31

**42 invariants declared. 29 at rung 6 or above. 13 below.**

| Rung | Count | What sits there |
|---|---|---|
| 8 — illegal state unrepresentable | 4 | `compose/no-duplicate-card`, `compose/controls/bindings-are-not-executable`, `om/no-confusable-heater-lines`, `deploy/compression-follows-the-server` |
| 7 — sole-constructor type | 12 | the `FileName` and `RemovePlan` brands, `files/listing-follows-mutation`, `dev/guard-follows-the-declaration`, `config/id-namespace`, `shell/grid-metrics-single-source`, both compile boundaries, and the rest |
| 6 — choke-point | 13 | `connector/sole-construction`, the config write paths, `compose/additive-placement`, `deploy/uninstall-owns-only-its-own` |
| 5 and below | 13 | the debt, each with a written promotion |

**Opening ceilings:** `ceiling: 13`, `redFlagCeiling: 8`.

### Claimed but not enforced — the two the sweep was for

Both are the 2026-07-22 audit's own unkept promises, unrecorded for 136 commits:

1. **`firmware-arm-bypasses-escape`.** `control/armed.ts` stated that Escape
   disarms "EVERY armed control on the page, including ones written later by
   someone who never read this file". `cards/FirmwareUpdateCard.tsx` is that
   someone: it arms with a raw `createSignal`, and its next click sends M997.
2. **`job-buttons-swallow-failures`.** ActiveJobCard's Pause/Resume/Cancel are
   raw `<button>`s with no catch and no acknowledgement, so a blocked or
   rejected code leaves the operator believing a running print was cancelled.

Neither was fixed during the sweep, deliberately: a sweep that also fixes things
cannot be reviewed as a sweep. Both are early Phase 2 work, and each also
promotes an invariant when done.

### What the numbers do not say

`DEBT.md` carries **7 entries**, five of which bound the *audit's own* coverage —
Card Lab's state pills are inert so ten cards are measured empty; Invariant B
names positions rather than culprits; the sweep runs at one viewport; there is
no declared-vs-measured oracle. The register is exhaustive over what has been
*declared*, and discovery remains rung 4. That is stated in the register's
preamble rather than implied away.

### Phase 2 scope, now measured rather than guessed

Thirteen promotions, each with its design already written in its `@debt` line.
The cheapest first: `narrow-rules-come-after-desktop` is rung **0** — held by
nothing — and a stylesheet-parsing test takes it to 4 in an afternoon. The most
valuable is `connector/gcode-producers`: branding `sendCode` retires
`estop-vocabulary`'s debt at the same time.
