# Learnings — machine identity, phase 1 (GIT_86, campaign #76)

Merged to `main` @ `9bf78d1`, deployed as build `CgG8a9xU`. 1,530 tests,
typecheck clean, invariant register 73/73, storage-keys lint enforcing.

Counterpart to `docs/superpowers/specs/2026-08-24-machine-profile-design.md`
and `docs/superpowers/plans/2026-08-25-machine-identity-phase-1.md`. The two
supporting artefacts sit beside this file: the whole-branch review
(`-final-review.md`) and the mismatch analysis (`-postmortem.md`).

## The generator

Six BEFORE/AFTER mismatches occurred on this campaign. Five share one cause:

> **Local confirmation standing in for general confirmation** — a check that
> could only speak to the instance in front of it, treated as proof of the
> class, premise, or diagnosis it was attached to.

Two of the five reached the owner's real printer and destroyed configuration.
Every one of them passed a review before shipping. That is the point worth
carrying forward: none of these were caught by *more* review, because each
review confirmed the instance it was pointed at.

## Rules adopted from it (2026-08-26)

Each fires on an **artefact**, not on a feeling — when you write the word, the
check is due.

1. **A "class" or "shape" ruling must enumerate every instance.** Trigger: a
   finding or ruling uses a class noun ("class", "shape", "pattern") or names
   a behaviour as recurring, rather than pointing at one file:line. Action:
   search the changed layer for the same shape, list every hit, fix or defer
   each **by name** in the ledger. *Would have caught:* Ruling 23 named the
   console's defect shape and swept one module; `commandHistory.ts` and
   `editor/drafts.ts` held the identical shape and shipped broken.
2. **A diagnosis is not "confirmed" until the call path is traced.** Trigger:
   "confirmed" / "root cause" / "verified by reading the code" for a
   behavioural bug. Action: cite the call chain hop by hop, file:line, from
   the entry point that runs on the *actual observed input* to the indicted
   line. *Would have caught:* a ledger "ROOT CAUSE (confirmed by reading the
   code)" that was wrong four lines later — the code was read correctly, but
   an upstream guard meant execution never reached it.
3. **A fix for a falsified premise must check the premise underneath it.**
   Trigger: a task exists *because* an earlier premise was shown false.
   Action: state what the broken premise assumed about its **inputs**, and
   check whether the replacement inherits it one layer down — does the new
   code still trust its input to have a shape (complete, coherent, singular)
   that nothing enforces? *Would have caught:* the empty-canvas fix that
   shipped to hardware trusting "defaults are a coherent layout", when
   `defaults` is a union of two independently-partial sources.
4. **Closing an open question requires a testable proposition.** Trigger: a
   spec marks an item from its own open-questions list closed. Action: name
   the variable whose value would flip the answer, as a proposition a later
   reader could check and find **false** — not prose. *Would have caught:*
   §4 closed "are layouts machine-scoped?" recording the wrong reason; because
   the reason was wrong, nobody checked the sibling field holding identical
   data for custom screens (open as #87).
5. **Verify the target from the environment, not from a document.** Trigger:
   any action reaching outside the working tree. Action: `git remote -v` for
   a tracker, the configured host for a deploy, `rev-parse` for a branch.
   *Would have caught:* `docs/github-issue-rules.md` named the project it was
   adapted from; four tickets were filed into a stranger's repository and two
   of its issues closed. Fixed in `fa46ec5`.

## What worked, and should be kept

- **The pre-flight conflict scan.** Before Task 1, every pair of tasks sharing
  a file or interface was checked produced-against-consumed. It found five
  real plan defects — including two tests that could not fail — and they were
  ruled on before a line was written. Cheapest defect-finding of the campaign.
- **Required-not-optional dependency.** `Accessor<MachineStore | null>` as a
  *required* parameter makes "identity unknown" representable and "forgot
  identity" a compile error. An earlier optional version silently dropped
  every machine-scoped edit in production. Applied twice, consistently.
- **Deleting the parameter beats guarding it.** Ruling 18's fix removed the
  `machineNow` parameters from the legacy-migration functions entirely, so no
  machine reference *can* reach that path. Contrast a check, which the next
  caller may not make.
- **Falsification as a gate.** Every fix reverted, confirmed RED for the
  stated reason, restored, confirmed GREEN. It caught an implementer's own
  fix introducing a bug, and caught a controller ruling whose proposed
  mechanism (an escape that was not injective) was itself broken.
- **Probes over unit tests for ordering facts.** Two Criticals were found and
  then verified by constructing the real modules in real boot order in plain
  Node — no DOM needed. A unit test that hands a fix its inputs can only
  confirm "it works when the input exists".

## Residue carried forward

Filed as ticket pairs on campaign #76, none started:

- **#86 / #88** — a saved screen layout freezes that screen's card set
  forever; coded cards added in later releases never appear
  (`compose/screens.ts:275`). Predates this campaign.
- **#87 / #89** — screen geometry is stored twice (SD overlay and per-browser
  canvas store) with no reconciliation, so a stale browser copy can overwrite
  the card's good copy.

Open from the final review, judged non-blocking: custom-screen layouts are
person-scoped while built-in layouts are machine-scoped; the machine-identity
card does not render for operators with a saved System layout (#86's
mechanism, hitting this campaign's own safety surface); "Save to machine" is a
silent no-op on an unidentified machine.

**Eager payload headroom is 27 bytes.** The ceiling was raised once, with
measured per-module attribution (see `packages/deploy/eager-budget.json`'s
note, which records what was tried and rejected). The lazy-cards refactor
named there is now effectively a prerequisite for the next eager-path change:
every card is eager, so every new card costs eager bytes permanently.
