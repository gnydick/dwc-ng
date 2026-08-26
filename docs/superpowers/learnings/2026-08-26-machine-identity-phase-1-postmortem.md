# Postmortem — machine identity phase 1 (campaign #76, branch GIT_86)

Scope: read-only analysis of the ledger (`progress.md`), the 17 task reports, the
spec (`docs/superpowers/specs/2026-08-24-machine-profile-design.md`), and the
git history on `GIT_86`. No files modified, no rules adopted — every "Candidate
rule" below is a proposal for `/rule-intake`.

---

## Mismatch 1 — "`screens.layouts` is machine-scoped" (closed, then twice reversed)

**What was believed, and where.** Spec §4, row `screens.layouts` (line 320):
"#76 said origin-global and #76 was wrong: CLAUDE.md's '4 layouts per machine'
is a recorded decision and outranks it... **Open question 1, closed
2026-08-25.**" The spec closed this without putting it to Gabe ("Not put to
Gabe: CLAUDE.md already records the decision"). The controller then ruled the
opposite (Ruling 12, progress.md:111) on a direct Gabe quote about survey-driven
provisioning, reversed to a third position after re-reading "screen content"
too broadly (Ruling 13 draft, progress.md:113), and finally reversed back to
the spec's original position after a four-message clarification (Ruling 13
final, progress.md:115-121) — landing byte-identical to the pre-Ruling-12 code
(task-6-report.md:273, diff-verified against `e44c9ed`).

**What was true.** The spec's closing paragraph and Ruling 13's final text
both end at "`screens.layouts` is machine-scoped" — the code is unchanged
end-to-end. What was never true was the spec's stated *reason*: CLAUDE.md's
"4 layouts per machine" describes how many layout *profiles* a person keeps
(desktop/mobile × portrait/landscape), not that layout geometry is a fact
about the machine. The real deciding fact, surfaced only in Ruling 13's final
form (progress.md:115-120), is that a layout belongs to a `(machine, person)`
**pair**, this app deliberately has no person key, and phase 1 only needs to
key the axis that *does* need an explicit key — which happens to make the
machine half hold the data, for a reason with nothing to do with "layouts are
a machine fact."

**Where the belief entered.** `docs/superpowers/specs/2026-08-24-machine-profile-design.md:554-560`
— the spec closed an item on its own list ("Open question 1") by citing a
project-memory line as authority, without asking whether that line's own
justification ("4 layouts per machine") actually answered the *scoping*
question being closed, or a different question (how many layouts a person
keeps). The two questions have the same-sounding answer ("machine") for
different reasons, and the spec's closing sentence never separated them. That
gap is precisely what let Ruling 12 read Gabe's answer as a clean reversal —
there was no recorded axis for "why machine" to check the new information
against.

**What standing rule would have caught it.** None in MEMORY.md addresses
spec-closure quality. **Candidate: require a spec to name the variable an
"open question" answer depends on before marking it closed** — see Candidate
Rule 1 below.

---

## Mismatch 2 — "an empty canvas store means every card is newly added" (b9bdcbf)

**What was believed.** `packages/ui/src/shell/panelCanvas.ts`'s pre-existing
`growToDefaults` treats every default id with no stored rect as "newly added"
and re-sites it via `slideDownToFree` against everything already placed
(task-15-report.md:5-10). Task 15's fix (commit `b9bdcbf`) added an
early-return: "when no default id has a valid stored rect... return
`defaultCanvas(defaults)` verbatim" (task-15-report.md:66-70) — i.e. treat a
wholly empty store as "no card in this composition has ever been placed, so
the coded defaults are exactly right."

**What was true.** `defaults` is not always "the coded defaults" — per
`compose/ComposedScreen.tsx:119`, it is `slotsOf(composition())`, the
composition *after* `screens.layouts` has already replaced it wholesale
(task-16-report.md:9-11, 19-21). A composition can therefore contain coded-only
cards (never in the operator's saved layout) sitting beside cards whose
positions the operator dragged — and the coded position of the former can
land exactly on top of the latter. Task 16 reproduced the reported symptom
(`shaping-apply` landing on the operator's dragged `shaping-decay`) and showed
`b9bdcbf`'s "verbatim" fix has **no collision check at all** for that case
(task-16-report.md:5-16).

**Where the belief entered.** `task-15-report.md:66-70`, the fix itself — a
one-line early return whose premise ("wholly empty ⇒ defaults are coherent")
was never tested against a fixture where it could be false. Task 15's own
"why the existing tests didn't catch it" section (lines 42-58) diagnoses this
exact failure mode for the *prior* bug but the fix that followed it repeated
the same shape of error one layer up: the new regression test
(task-15-report.md:88-99) modeled an *empty store*, which is real, but not a
*partially-saved* store with a coded-only sibling — the one case that falsifies
"verbatim is always right." Task 16's own retrospective says it plainly:
"None of the prior fixtures modeled a composition where some ids are
coded-only and others are the operator's, with coordinates that disagree —
which is the one shape that exposes the bug" (task-16-report.md:131-134).

**What standing rule would have caught it.** MEMORY.md already has the rule
`fake-must-model-the-bad-state` ("a green suite proves nothing about a
dimension the fixture holds constant"). That is exactly this failure — see
"Existing rules that should have fired and didn't" below for why it
apparently did not fire here.

---

## Mismatch 3 — "the composed defaults are a complete, coherent layout" (the replacement premise, also false)

**What was believed.** After Mismatch 2 was reported to have shipped a
regression, the stated replacement premise (task-16-report.md:8-12) is the one
Mismatch 2's fix actually encoded: "`defaults`... is already a coherent,
collision-free arrangement whenever the canvas is empty." This is Task 15's
premise restated by Task 16 as the thing that needs correcting, not a new
belief Task 16 introduced — it is the same premise, named explicitly for the
first time once it broke.

**What was true.** A composition is the union of coded-only cards and
whatever the *operator's own* saved layout (`screens.layouts[id]` or
`screens.custom[id].cards`) contains — and per §4's own wholesale-replace
mechanics (`compose/screens.ts:264-276`), an operator's saved layout can be
**partial**: it replaces the composition's card *set* for that screen, but
nothing forces it to cover every id the coded composition would otherwise
carry, and nothing merges the two. So "the composed defaults" is not one
coherent thing at all — it is up to two independently-authored partial
layouts (coded and operator) that can legally overlap. Task 16's fix
(`savedScreenLayout`, `seedFromOverlay`) treats them as such: only ids the
operator's save actually named are trusted at the operator's coordinates;
everything else still goes through collision avoidance
(task-16-report.md:40-72).

**Where the belief entered.** Nowhere in the spec or the plan — this is a
premise the *fix* to Mismatch 2 needed and asserted implicitly
(task-15-report.md's fix comment: "falling back to a default is placement,
not growth", plus the unconditional-verbatim branch), not something either
task's brief stated and defended. It entered as an unexamined step in a
one-person repair: the fix author reasoned from "the store is empty" to
"nothing has been placed yet" to "the coded set is authoritative," without
checking whether `defaults` itself could already be a hybrid of two
authorities. Task 16's diagnosis is explicit that this reasoning chain, not a
new fact, is what needed fixing (task-16-report.md:9-16).

**What standing rule would have caught it.** Same class as Mismatch 2 — see
Candidate Rule 2 (below) and the `fake-must-model-the-bad-state` discussion.
Additionally: **the fix for one falsified premise inherited an *unstated*
premise of its own predecessor** ("what `defaults` is" was never re-examined
when "is the store empty" was). That is a second, more general pattern —
see Candidate Rule 3.

---

## Mismatch 4 — "Ruling 23 closed the cross-contamination class"

**What was believed.** Ruling 23 (progress.md:187) named a defect *class*
explicitly: "persistSoon debounces ONE global timer and on flush calls
saveConsole(machineStore(), consoleLines.slice()) — the ENTIRE in-memory
buffer, against whichever machine is current AT FLUSH TIME... That is real
storage cross-contamination — the exact hazard #76 exists to remove." The fix
(commit `45fdfa2`) closed it for the console log, and the ledger records
"Ruling 23 CLOSED" (progress.md:189) with no further action item.

**What was true.** Two sibling modules held the identical shape — an
in-memory buffer accreted additively across an identity change, then flushed
whole against whichever machine is current at flush time: command history
(`om/commandHistory.ts`, folded into `ConsolePanel.tsx`'s `recall()`/`send()`)
and file drafts (`editor/drafts.ts`/`FileEditor.tsx`). Both shipped broken —
found by the final whole-branch review "reproduced by execution" and fixed in
Task 13 (progress.md:218; task-13-report.md:1-59).

**Where the belief entered.** The ruling itself, progress.md:187 — it
diagnoses and fixes *one call site* (`om/store.ts`) under a class-shaped name
but never asks "what else has this shape." The task's own final accounting
makes this explicit and does not equivocate: "Reviewer's criticism of me is
accepted: once Ruling 23 named a defect CLASS, the ruling should have
demanded a sweep of every consumer holding an in-memory buffer across an
identity change. There are exactly three; two were left broken."
(progress.md:218). Notably, the *re-review* of Ruling 23's fix (progress.md:189)
went further than most reviews in this campaign — it traced Solid's effect
ordering and the connector's dispatch sequencing empirically — and still did
not ask the sweep question, because the review's scope was "is this fix
correct," not "is this class closed."

**What standing rule would have caught it.** [`sweep-coverage-must-be-counted`](sweep-coverage-must-be-counted.md)
is adjacent but is framed around *search sweeps* ("a memory of what was
read"), not around *defect-class enumeration* after a fix. It would not
obviously fire here without a broader reading — see "Existing rules" below.
Candidate Rule 2 targets this precisely.

---

## Mismatch 5 (found, not given) — "ROOT CAUSE (confirmed by reading the code, not inferred from symptoms)"

**What was believed.** progress.md:212-213, stated with the strongest
epistemic marker used anywhere in the ledger: "ROOT CAUSE (confirmed by
reading the code, not inferred from symptoms): `config/migrateStorage.ts:161-171`
`readStampedMachineOverlay` returns `{overlay:{}, claimed:true}` when
`writtenFor === null`... Consequence: every existing user's machine-scoped
settings vanish on upgrade." This was written up as a full causal chain,
including a class label ("CLASS: cross-task seam defect between Task 8 and
Task 9 — each correct alone, wrong together," progress.md:214) before any fix
was dispatched.

**What was true.** progress.md:216, four lines later, in the same document:
"ROOT CAUSE CORRECTED (my first diagnosis was wrong)... `config/store.ts:846`
`if (meta.dirty) return;` opens `loadFromMachine`... His pre-upgrade
`dwc-ng.config` carried `dirty:true`, so the SD file was **never downloaded**,
no claim was raised." The claimed-profile code path the first diagnosis
indicted was never reached at all; the actual defect was three lines earlier
in the call chain, a dirty-guard early return with no relation to the
migration/claim seam the first diagnosis named.

**Where the belief entered.** progress.md:212 — a diagnosis that read
`readStampedMachineOverlay`'s *behavior in isolation* against the *symptom*
(settings gone, claim-shaped) and pattern-matched, without first checking
whether the calling code (`loadFromMachine`) even reaches that function on
this specific input. The word "confirmed" is doing work the evidence had not
earned: reading one function's source is not the same as tracing the call
path that actually executes for this operator's specific stored state. The
self-correction happened fast and before any destructive action was taken —
a genuine save, discussed under "What worked" — but the false diagnosis was
published with "confirmed" language and a class label attached, which is
exactly the framing the campaign's own standing rule (`verify-before-touching-hardware`:
"'verified' needs a check that could have FAILED") targets for *actions*, not
yet for *diagnoses*.

**What standing rule would have caught it.** The rule `verify-before-touching-hardware`
is adjacent in spirit ("name the falsifying check before claiming anything
works") but is written around hardware actions, not diagnostic claims. It did
not fire here because a "root cause" write-up is not obviously a "verified
X works" claim in the rule's own frame. See Candidate Rule 4.

---

## Deeper generator

**Not one generator — two, and they should stay separate.**

- **Mismatch 1** is a *specification* failure: a closure that recorded a
  conclusion without recording the axis the conclusion depended on. Nothing
  about it involves testing, review, or sweeping; forcing it into the same
  bucket as 2/3/4 would blur a documentation discipline with a verification
  discipline.

- **Mismatches 2, 3, and 4 share one generator: verification that confirmed
  the artifact in front of it, not the general claim the artifact was
  offered as proof of.** Task 15's fixture proved "an empty store doesn't
  scatter *this* composition" and was accepted as proof that empty-store
  handling was fixed in general. Task 16's fix (itself now the load-bearing
  code) again proves its own two new fixtures pass, and is careful enough to
  show *why* the old fixtures couldn't have caught the bug — real progress —
  but the pattern that produced Mismatch 2 (accept the instance as the
  class) is the same pattern that produced Mismatch 3 (accept "not empty
  ⇒ fine" without asking what "not empty" is a union of). Ruling 23 confirmed
  the console fix was *correct* — exhaustively, down to Solid's scheduler
  semantics — without asking whether "correct for the console" implied
  anything about the two other modules the ruling's own words had just
  described as the same class.

  **Mismatch 5 is a variant of the same generator, one layer earlier**:
  a diagnosis confirmed against one function's behavior, not the call path
  that determines whether that function's behavior is even reached. All four
  are "verified the piece that was open, not the claim that was made."

Naming it precisely: **local confirmation standing in for general
confirmation.** Every one of 2/3/4/5 has a moment where a check that could
only ever speak to the specific case at hand was treated as if it spoke to
the class name attached to it (a defect "class," a config "the composed
defaults," a diagnosis called "root cause"). Mismatch 1 has no such moment —
it never reached a verification step, because the spec-writer never framed
"open question 1" as something that *needed* a check point at all.

---

## Candidate rules

Each is a proposal only. None has been adopted; none has been written into
any rules file.

### 1. Name the deciding variable before closing an open question

- **Trigger:** a spec or ruling document marks an item from its own "open
  questions" (or equivalent) list as **closed**, resolved, or answered.
- **Action:** before the closing sentence is written, write a second sentence
  naming the variable whose value would flip the answer ("this depends on
  whether X is A or B; here it is A because..."). If that sentence cannot be
  written, the item is not actually closed — it is a guess with a due date.
- **Would have caught:** Mismatch 1, at the moment
  `2026-08-24-machine-profile-design.md:554-560` wrote "CLOSED 2026-08-25 —
  machine," citing CLAUDE.md without stating that the deciding variable was
  "does this app have a person axis to key explicitly" rather than "is
  layout a machine or person fact in the abstract."
- **Frequency / cost:** a design-sized campaign closes perhaps 3-8 open
  questions. The action costs one sentence each — cheap even where the
  question really was settled; it produces a citable fact instead of a bare
  verdict. False-positive cost: near zero, since a well-closed question can
  usually state its deciding variable in one clause.

### 2. A ruling that names a defect as a "class" or "shape" must enumerate every instance before the ruling is marked closed

- **Trigger:** a review finding, ruling, or fix-round description uses a
  class noun for a defect — "class," "shape," "pattern," "species of
  defect," or names the same wrong behavior as recurring across modules —
  rather than pointing at one file:line.
- **Action:** before the fix task is marked complete, grep/search the
  changed layer (e.g., every consumer of the same store/session/buffer
  abstraction) for the same shape, list every hit found, and either fix or
  explicitly defer each one by name in the ledger. "Fixed the one I was
  pointed at" does not satisfy a class-shaped ruling.
- **Would have caught:** Mismatch 4, the moment Ruling 23 was written
  (progress.md:187) — "the exact hazard #76 exists to remove" is a
  class-shaped claim, and a search across `packages/ui/src` for
  "in-memory buffer + additive hydrate + flush-whole-buffer-to-current-store"
  would have found `commandHistory.ts` and `editor/drafts.ts` in the same
  pass that found `om/store.ts`, before deployment.
- **Frequency / cost:** class-shaped rulings appeared roughly 3 times in
  this 12-task campaign (Ruling 15's "same class of hole," Ruling 18's
  "headline hazard," Ruling 23 itself). At that rate the action fires a
  few times per campaign; each firing costs one grep and a short per-hit
  note — cheap relative to a repeat production incident. It would also have
  fired (harmlessly) on Ruling 21, which already found its one sibling
  itself without a mandated sweep — no false-positive cost there beyond
  confirming what was already found.

### 3. A fix for a falsified premise must name and check the premise underneath it, not just the one that broke

- **Trigger:** a task or fix-round exists specifically because an earlier
  premise was shown false (a regression report, a reverted ruling, a
  "my first diagnosis was wrong" note).
- **Action:** before writing the replacement fix, state in one sentence what
  the *broken* premise assumed about its own inputs (not just its own
  behavior), and check whether the replacement inherits the same
  assumption one layer down. This is not "think harder" — it is a specific
  question with a yes/no answer: does the new code still trust its input to
  have a shape (complete, coherent, singular) that nothing enforces?
- **Would have caught:** Mismatch 3 — Task 15's fix trusted "the store is
  empty ⇒ `defaults` is coherent"; the one-sentence check ("what does
  `defaults` assume about its own completeness?") would have surfaced that
  `defaults` is itself a union of two independently-partial sources before
  `b9bdcbf` shipped, rather than after.
- **Frequency / cost:** fires only when repairing an already-falsified
  premise — by definition rare (this campaign: twice, Mismatches 2→3).
  Cost per firing is one sentence of stated assumption-tracing; negligible
  false-positive cost since the trigger condition itself is rare and
  unambiguous (a fix exists BECAUSE something else broke).

### 4. A diagnosis is not "confirmed" until the call path that reaches the indicted code is traced for the actual input, not just its behavior in isolation

- **Trigger:** a ledger, report, or comment states a root cause using
  confirmatory language ("confirmed," "root cause," "verified by reading the
  code") for a behavioral bug (as opposed to a static/type-level fact).
- **Action:** the write-up must cite the call chain, hop by hop
  (file:line at each step), from the entry point that runs on the actual
  observed input to the indicted line — not merely describe what the
  indicted function does when reached. If a guard earlier in the chain can
  short-circuit before the indicted line, the diagnosis must show it does
  not, for this input.
- **Would have caught:** Mismatch 5 at progress.md:212 — the first
  "confirmed" root cause never cited `config/store.ts:846`'s dirty guard,
  which sits between the entry point and the indicted function and, for the
  operator's actual `dirty:true` cache, prevents the indicted function from
  ever running.
- **Frequency / cost:** fires on every "root cause confirmed" claim for a
  behavioral bug — in a campaign this size, on the order of 1-3 times (once
  per real incident investigated). Cost when it fires without need (the
  first hop obviously executes) is small — writing the one-hop chain anyway
  costs a sentence; the payoff when the guard *does* exist is a corrected
  diagnosis before, not after, a fix is dispatched or hardware is touched.

---

## Existing rules that should have fired and didn't

**[`fake-must-model-the-bad-state`](fake-must-model-the-bad-state.md)** — "a
green suite proves nothing about a dimension the fixture holds constant" is,
read literally, exactly Mismatch 2 and Mismatch 3: every pre-`b9bdcbf` and
post-`b9bdcbf` fixture held "single card, or non-overlapping coded slots"
constant, which is precisely the dimension the real bug depends on
(task-15-report.md:42-58; task-16-report.md:120-134 both diagnose this
explicitly, in the exact vocabulary of the rule, without citing it). It did
not fire for two likely reasons, and both matter for how the rule should be
worded going forward:
1. **The rule's name anchors it to "fakes"** — simulated hardware/services
   (its own second clause is about a fake's synchrony vs. a real board's
   lag). `growToDefaults`/`panelCanvas` fixtures are ordinary unit-test data
   for a pure function, not a fake of an external system, so nobody
   pattern-matched "this is the fake-must-model-the-bad-state situation"
   even though the rule's *first* clause is written generally enough to
   apply. A rule whose title scopes it more narrowly than its content is a
   rule that will not be found by search when it is needed.
2. Neither Task 15 nor Task 16 was asked to consult MEMORY.md before writing
   a fixture — dispatch briefs in this campaign route implementers to the
   spec, the plan, and specific rulings, not to the standing-rule index. A
   rule that only fires when someone happens to remember it exists is not
   load-bearing.

No action is proposed here beyond naming the gap — a rename or a dispatch-time
reference is the human's call via `/rule-intake`, not something this
document adjudicates.

**[`sweep-coverage-must-be-counted`](sweep-coverage-must-be-counted.md)** —
adjacent to Mismatch 4 but not a clean match: its own text is about a
*search* sweep needing "a per-namespace file count, not a memory of what was
read." Ruling 23 was not a search that under-counted its results; it was a
diagnosis that never became a search at all — the class was named in prose,
then the fix addressed one member without any search being run. The existing
rule would need to be read very generously to cover "an unrun sweep" rather
than "a miscounted one," which is why Candidate Rule 2 above is offered as a
distinct rule rather than an elaboration of this one.

**[`verify-before-touching-hardware`](verify-before-touching-hardware.md)** —
adjacent to Mismatch 5 in spirit ("'verified' needs a check that could have
FAILED") but scoped to actions ("a print reached real hardware on a stale
belief"), not diagnostic write-ups. The controller's own good instinct
(issuing the "do NOT Save to machine" warning, progress.md:217) shows the
rule's *spirit* was live and applied correctly to the action that mattered
most — it just doesn't cover the earlier, purely textual "confirmed root
cause" claim that preceded it. Candidate Rule 4 extends the same discipline
one step upstream, to diagnosis rather than action.

---

## What worked, and the rule that preserves it

**1. The pre-flight conflict scan caught five real plan defects before any
code was written** (progress.md rows 5, 6, 7, 11, plus Ruling 5's flag on row
12) — a vacuous-test shape (row 11: `createRoot(async ...)` with nothing
awaiting it), a literal lint that could never go green (row 5), a
self-contradicting exemption claim (row 6), mandated code duplication (row
7), and an unverified API assumption (row 12) — all found by cross-referencing
what each task *produces* against what every other task *consumes*, before
dispatch. This is exactly the discipline the `sweep-coverage-must-be-counted`
and `cant-break-by-design` skills already argue for, applied at plan-review
time rather than code-review time, and it is why Tasks 1-11 shipped with only
one Critical each caught in review (Task 9's claim-invalidation gap) rather
than several.

- **Rule worth keeping (already implicit in this campaign's own practice,
  stated here so it survives as a checklist item rather than a habit):**
  before dispatching a multi-task plan, build the producer/consumer table
  described in progress.md's own pre-flight scan format — one row per
  cross-task interface — and treat every unresolved row as a blocker, not a
  note. This is not a new rule; it is a request that the pattern this
  campaign already used be named and required rather than left to the next
  controller's memory of having seen it work once.

**2. "Required accessor, nullable value" turned two real holes into compile
errors instead of silent no-ops.** Ruling 15 (`createConfigStore`'s
`machineStore` made a required `Accessor<MachineStore | null>` rather than an
optional parameter, progress.md:135) and Ruling 21 (the identical fix for
`createOmStore`, progress.md:178) both closed a class of bug — "a caller can
build a store with no machine store at all, and it will compile" — by
construction rather than by convention. The pattern is specifically:
required *accessor*, so pre-identity `null` is still representable and every
call site must say so explicitly (`() => null`, self-documenting as "this
test covers the no-machine case"). This is the `cant-break-by-design` skill's
core move, applied precisely, twice, in this campaign, and it is why neither
hole is on the mismatch list above — they were caught by construction, not by
review.

**3. Independent re-verification, not trust, was the review norm.** Reviewers
across this campaign repeatedly re-ran falsifications themselves rather than
reading the implementer's transcript (Task 5's re-reviewer traced Solid's
store internals directly rather than accepting "I tested it with a probe I
then deleted," progress.md:105; Task 10's re-reviewer traced actual connector
dispatch ordering rather than asserting sufficiency, progress.md:189; Task 8's
re-reviewer traced `revert()` to confirm attribution was *structurally*
impossible, not merely guarded, progress.md:160). This is why the campaign's
failures cluster specifically in the gap this postmortem names (verifying the
instance, not the class) rather than in "reviews rubber-stamped an
implementer's claim" — that failure mode essentially does not appear in this
ledger. Worth stating as a rule only insofar as it should be protected, not
reinvented: **a review that reports a finding "addressed" must show the
re-run falsification's actual output, not the implementer's report of it** —
already the de facto standard here every single time; it is the standard
that should not erode.
