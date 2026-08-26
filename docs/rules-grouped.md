# Rules, grouped

The same rules as `docs/rules.md`, arranged by **the moment they fire** rather
than by number — so the question "what applies right now?" has one place to
look. Full statement, evidence and adoption date live in `docs/rules.md`;
this file is a lookup, not a second source of truth.

---

## When you are writing a finding, ruling or fix description

- **R1 — did you use a class noun?** "class", "shape", "pattern", "species of
  defect", or "this keeps happening". If so, enumerate every instance in the
  changed layer and fix-or-defer each by name before the task closes. Fixing
  the one you were pointed at does not discharge a class-shaped claim.

## When you are writing down a cause

- **R2 — did you write "confirmed", "root cause", or "verified by reading the
  code"?** For a behavioural bug, trace the call chain hop by hop, file:line,
  from the entry point that runs on the *actual observed input* to the line
  you are indicting. Reading the end function correctly is not the same as
  showing execution reaches it.

## When you are fixing something that broke a previous belief

- **R3 — is this task here because a premise was falsified?** Then state what
  the broken premise assumed about its **inputs**, and check whether your
  replacement inherits the same assumption one layer down. The question has a
  yes/no answer: does the new code trust its input to be complete, coherent
  or singular, when nothing enforces that?

## When you are closing an open question in a spec or plan

- **R4 — can you name the deciding variable as a checkable proposition?**
  Something a later reader could test and find false. If the best you can
  write is prose, the question is not closed — it is a guess with a due date,
  and the wrong recorded reason will send the next reader past the thing that
  actually mattered.

## When an action leaves this working tree

- **R5 — where does this actually go?** `git remote -v` before a `gh` call,
  the configured host before a deploy, `rev-parse` before trusting a branch
  name. A document adapted from another project carries that project's
  identifiers, and they read as scenery right up until they address someone
  else's issue tracker.

---

## The common thread

R1–R4 are one failure wearing four hats: **local confirmation standing in for
general confirmation** — a check that could only speak to the instance in
front of it, treated as proof of the class, premise, or diagnosis it was
attached to. R5 is the same shape pointed outward: a fact true in one context,
carried into another where it was never checked.

Five of six mismatches on campaign #76 phase 1 had this cause. Two reached a
real printer and destroyed configuration. Each had passed a review first —
which is the part worth remembering, because none of them would have been
caught by more review of the same kind. They needed a different *question*,
not more eyes.
