# Design and Implementation Rules, Grouped by Intent

**This is the project's design-decision register — the living authority on WHAT
was decided.** Its sibling, `docs/invariant-register.md`, is the enforcement
ledger — the living authority on HOW STRONGLY code holds each invariant (rungs
0–8), generated from declarations beside the mechanisms themselves. One job per
doc; they cross-link, they never duplicate. Everything else that states a rule
(superpowers specs and plans, `docs/LEARNINGS.md`) is immutable history that
this register cites.

Rules that bear on the same design decision — agreeing, refining, or
disagreeing — share a group, sorted by adoption date. Each group summary states
what binds the rules and, where the project wobbled, what the wobble argued
about and where it ended.

Each group header carries a status circle: 🟢 the design came to a conclusive
end (agreeing rules, or a wobble with a clear written verdict); 🟡 weak
agreement (the standing verdict is only inferred, or a deviation is documented
but never reconciled); 🔴 no conclusive end — opposing rules are both still
live.

Started 2026-08-26, hand-maintained. Unlike the sibling project this convention
comes from, there is no dated extraction snapshot behind it: this register was
begun from a single campaign's adopted rules rather than seeded from a sweep of
the repository's markdown. **A `docs/RULES.md` provenance snapshot does not
exist here and should not be invented** — if one is ever wanted, generate it
from git blame rather than writing it by hand.

## Maintaining this file (the contract)

- **The register CITES, it never ORIGINATES.** Every row points at where the
  rule actually lives — `CLAUDE.md` § heading, a spec, the invariant register.
  Write it in its durable home first, then cite it here.
- **Same commit.** A change that adds, changes or supersedes a rule updates
  this register in the same commit as the durable-home edit.
- **Citations name a SECTION, never a line, for `CLAUDE.md`.** A line number
  cites a POSITION, and every insert above it silently retargets the row.
- **Adding a rule.** Agreeing or refining an existing group → append a row
  (date = today, cite the durable home). Contradicting → that is a wobble:
  record "The wobble / Where it ended" with the adjudicated verdict and set the
  circle accordingly. No fitting group but siblings exist → promote them into a
  new group with a summary. No siblings → a row in the Solo section.
- **Superseding.** The old doc gets, as its first body line:
  `> SUPERSEDED (YYYY-MM-DD): see docs/RULES-GROUPED.md § <group>` — and the
  group gets a `Supersedes:` line citing that doc. Both directions, same
  commit. Old bodies are never rewritten.
- **Flipping a circle.** Only an adjudication (Gabe's ruling, or a landed
  change that settles the question) flips 🟡/🔴 → 🟢.

## Contents

- [Confirmation discipline — a local check is not a general one](#confirmation-discipline--a-local-check-is-not-a-general-one) 🟢
- [Acting outside the working tree](#acting-outside-the-working-tree) 🟢
- [Proving a change against something that behaves like the machine](#proving-a-change-against-something-that-behaves-like-the-machine) 🟢

---

## Confirmation discipline — a local check is not a general one 🟢

**What binds these:** each rule closes one route by which a check that could
only speak to the instance in front of it was treated as proof of the class,
premise, or diagnosis it was attached to. Named as a single generator by the
post-mortem of campaign #76 phase 1, which found it behind five of six
BEFORE/AFTER mismatches on that branch; two of the five reached the printer and
destroyed configuration. Every one had passed a review first — which is why the
rules demand a different *question*, not more eyes.

No wobble: all four were adopted together, unopposed, on the evidence of the
same campaign.

| Date | Rule | Cites |
|---|---|---|
| 2026-08-26 | A finding or ruling that uses a class noun for a defect ("class", "shape", "pattern") must enumerate every instance in the changed layer and fix or defer each BY NAME before the task closes. | `CLAUDE.md` § Working rules (verification discipline) |
| 2026-08-26 | A diagnosis is not "confirmed" for a behavioural bug until the call chain is cited hop by hop, file:line, from the entry point that runs on the actual observed input to the indicted line. | `CLAUDE.md` § Working rules (verification discipline) |
| 2026-08-26 | A fix that exists because an earlier premise was falsified must state what the broken premise assumed about its INPUTS, and check whether the replacement inherits that assumption one layer down. | `CLAUDE.md` § Working rules (verification discipline) |
| 2026-08-26 | Closing an open question requires naming the deciding variable as a proposition a later reader could check and find FALSE; prose means the question is not closed. | `CLAUDE.md` § Working rules (verification discipline) |

**Evidence:** `docs/LEARNINGS.md` § 2026-08-26, entries 1–4.
**Enforcement:** none mechanical. These bind authorship, not code, so the
invariant register has no rung for them — they are held by review and by the
post-mortem trigger that fires on a ledger mismatch.

---

## Acting outside the working tree 🟢

**What binds these:** the same generator pointed outward — a fact true in one
context, carried into another where it was never checked. Currently one rule;
kept as its own group because its trigger (an action leaving the tree) is
recognised at a different moment from the authorship rules above.

| Date | Rule | Cites |
|---|---|---|
| 2026-08-26 | Before any action reaching outside the working tree, establish the target from the environment, not from a document: `git remote -v` for a tracker, the configured host for a deploy, `rev-parse` for a branch. The document is evidence of intent; the environment is evidence of fact. | `CLAUDE.md` § Working rules (verification discipline) |

**Evidence:** `docs/LEARNINGS.md` § 2026-08-26, entry 5 — `docs/github-issue-rules.md`
named the project it had been adapted from; followed literally it filed four
tickets into a stranger's repository and closed two of its issues. Repaired in
`fa46ec5`, which also added the `git remote -v` check to that file.
**Enforcement:** none mechanical.

---

## Proving a change against something that behaves like the machine 🟢

**What binds these:** a test suite exercises the units someone wrote a fixture
for; it does not exercise the wiring a person touches. This group holds the
rules that close that gap by requiring a change to be driven against something
that behaves like the real system before it is called done.

Evidence, and why the bar is where it is: on 2026-08-26 two defects reached the
owner's printer with the full suite green (1,530 tests, 0 failures). Both were
ordering facts about the live boot path — a config load that never ran because
an upstream guard returned first, and a canvas seed read before the value it
needed existed. Neither could have been caught by more unit tests of the same
shape, and both were falsified in minutes once the real modules were run in the
real sequence.

No wobble.

| Date | Rule | Cites |
|---|---|---|
| 2026-08-26 | The full mock suite runs during development, and a user-facing change is not done until it has been exercised against it — a green unit suite is not UAT. | `CLAUDE.md` § Working rules (development environment) |
| 2026-08-26 | A completion claim records the UAT: what was driven, against which scenario, what was observed. No note means the change is not done. | `CLAUDE.md` § Working rules (development environment) |
| 2026-08-26 | A change to what the UI reads from or writes to the board updates `packages/mock-duet` in the SAME change. Mock parity is part of the work, not a follow-up ticket. | `CLAUDE.md` § Working rules (development environment) |

**Evidence:** `docs/LEARNINGS.md` § 2026-08-26, and
`docs/superpowers/2026-08-26-machine-identity-phase-1-final-review.md`, whose
two Criticals were both found by running the real modules rather than by
reading or by unit tests.
**Enforcement:** no automated check. The teeth are in the report: a completion
claim without a UAT note fails the second rule on its face, which is
reviewable by eye where "did you run the mock" is not. `packages/mock-duet`
runs via `pnpm mock`.
