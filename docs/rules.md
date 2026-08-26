# Rules

Standing rules for working in this repo. Each one exists because something
specific went wrong; each names a **trigger** you can recognise without
judgement and an **action**. A rule that cannot be applied mechanically is not
a rule, it is advice — advice belongs in `docs/learnings.md`.

The evidence behind each rule is in `docs/learnings.md`. A grouped view is in
`docs/rules-grouped.md`.

---

## R1 — A "class" or "shape" ruling must enumerate every instance

**Trigger:** a finding, ruling or fix description uses a class noun for a
defect — "class", "shape", "pattern", "species of defect" — or names a
behaviour as recurring across modules, rather than pointing at one file:line.

**Action:** before the task is marked complete, search the changed layer for
the same shape, list every hit, and fix or explicitly defer each one **by
name** in the ledger. "Fixed the one I was pointed at" does not satisfy a
class-shaped ruling.

**Adopted 2026-08-26.** A ruling named the console's cross-contamination shape
precisely and swept one module; `om/commandHistory.ts` and `editor/drafts.ts`
held the identical shape and shipped broken to a real printer.

---

## R2 — A diagnosis is not "confirmed" until the call path is traced

**Trigger:** confirmatory language — "confirmed", "root cause", "verified by
reading the code" — applied to a **behavioural** bug (not a static or
type-level fact).

**Action:** cite the call chain hop by hop, file:line at each step, from the
entry point that runs on the **actual observed input** to the indicted line.
Describing what the end function does is not tracing.

**Adopted 2026-08-26.** A ledger entry reading "ROOT CAUSE (confirmed by
reading the code)" was wrong four lines later: the code had been read
correctly, but a guard upstream meant execution never reached it.

---

## R3 — A fix for a falsified premise must check the premise underneath it

**Trigger:** a task exists **because** an earlier premise was shown false — a
regression report, a reverted ruling, a "my first diagnosis was wrong" note.

**Action:** state in one sentence what the broken premise assumed about its
own **inputs** (not its behaviour), and check whether the replacement inherits
that assumption one layer down. Concretely: does the new code still trust its
input to have a shape — complete, coherent, singular — that nothing enforces?

**Adopted 2026-08-26.** A replacement fix shipped to hardware trusting "the
composed defaults are a coherent layout", when `defaults` is a union of two
independently-partial sources and can overlap itself.

---

## R4 — Closing an open question requires a testable proposition

**Trigger:** a spec or ruling marks an item from its own open-questions list
as closed, resolved or answered.

**Action:** name the variable whose value would flip the answer, written as a
proposition a later reader could **check and find false** — not prose. If it
cannot be written that way, the item is not closed; it is a guess with a due
date.

**Adopted 2026-08-26.** The machine-profile spec closed "are layouts
machine-scoped?" citing a recorded decision, and recorded the wrong reason.
Because the reason was wrong, nobody checked the sibling field holding
identical data for custom screens — still open as #87.

---

## R5 — Verify the target from the environment, not from a document

**Trigger:** any action reaching outside the working tree — filing or closing
issues, pushing, deploying, posting, uploading.

**Action:** establish the target from the environment first. Issue tracker →
`git remote -v`. Deploy target → the configured host, confirmed against the
machine you believe you are addressing. Branch → `git rev-parse
--abbrev-ref HEAD`, not the worktree's name. The document is evidence of
intent; the environment is evidence of fact. When they disagree, the
environment wins and the document gets fixed.

**Adopted 2026-08-26.** `docs/github-issue-rules.md` named the project it had
been adapted from. Followed literally, it caused four tickets to be filed into
a stranger's repository, a comment on its unrelated issue, and **two of its
issues closed**. Fixed in `fa46ec5`.
