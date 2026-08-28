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
- [Dispatching work — who does it, and where it runs](#dispatching-work--who-does-it-and-where-it-runs) 🟢
- [Claiming what the tooling can do](#claiming-what-the-tooling-can-do) 🟢
- [Persisted layouts across releases](#persisted-layouts-across-releases) 🟢

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
| 2026-08-26 | Nothing deploys to the printer until Gabe has UAT'd it on the mock. A clean review is not permission to ship; the implementer's UAT is evidence, Gabe's is the gate. | `CLAUDE.md` § Working rules (development environment) |
| 2026-08-26 | Every code-complete iteration is deployed to the mock for UAT — early and often, not gated on review being clean. Refines the row above: mock deploy is early, printer deploy still waits for Gabe. | `CLAUDE.md` § Working rules (development environment) |

**Evidence:** `docs/LEARNINGS.md` § 2026-08-26, and
`docs/superpowers/2026-08-26-machine-identity-phase-1-final-review.md`, whose
two Criticals were both found by running the real modules rather than by
reading or by unit tests.
**Enforcement:** no automated check. The teeth are in the report: a completion
claim without a UAT note fails the second rule on its face, which is
reviewable by eye where "did you run the mock" is not. `packages/mock-duet`
runs via `pnpm mock`.

---

## Dispatching work — who does it, and where it runs 🟢

**What binds these:** the groups above fire on an artefact that already exists
— a claim, a diagnosis, a completion note. These fire one step earlier, at the
moment work is HANDED OUT: who executes it, how many executors may be alive at
once, and which checkout each one owns. Two questions, one generator — the main
agent's context is a scarce shared resource, and so is a working tree; both are
protected by deciding the topology before dispatch rather than discovering the
contention afterwards.

No wobble: both rules are Gabe's, ruled 2026-08-28, and the second refines
rather than contradicts the first.

| Date | Rule | Cites |
|---|---|---|
| 2026-08-28 | The main agent does no work: it holds conversation, adjudication and relay, and delegates everything else. Reading a file to answer a question is conversation; reading it to change it is work. | `CLAUDE.md` § Working rules (work topology) |
| 2026-08-28 | Four agent classes — effort, review, test, rule-intake. Serial WITHIN a class (one in flight each), concurrent ACROSS classes, so at most four at once and only when each is in a different worktree. | `CLAUDE.md` § Working rules (work topology) |
| 2026-08-28 | At most ONE agent per worktree, not waivable by an agent's own reading of its brief; a review or test of work in flight targets that branch in its OWN worktree of it, created if none exists. | `CLAUDE.md` § Working rules (work topology) |
| 2026-08-28 | Agents are named by class and target at spawn (`effort: GIT_118`, `review: GIT_87`, `test: uat`, `rule-intake: agent topology`), because the harness identifies a running agent only by an opaque id. | `CLAUDE.md` § Working rules (work topology) |

**Evidence:** the worktree rule needs no incident to justify it — two agents
writing one checkout each read the other's half-written files as the state they
are reasoning about, and neither can attribute or undo a change it did not
make. No such collision is recorded in this repository's history; a candidate
anecdote was deliberately left out because it could not be corroborated from
either repo. The naming rule's evidence is visible in any transcript: the
harness reports agents as ids like `a147f359d45f0a51e`, which carry no class.

**Enforcement: none, and none is proposed.** Gabe, 2026-08-28: "it's worked
well as a guiding principle." A survey found no mechanism for agent topology in
this project or the sibling it borrows conventions from, and the honest reason
is structural: an agent is not a process this repo can probe, and a worktree
does not know how many agents are inside it. There is no artefact a checker
could read that would reveal a violation. So this group is held by discipline
alone — a weaker footing than the register's other groups, stated here rather
than papered over. The circle is 🟢 because the RULING is settled, not because
anything enforces it.

---

## Claiming what the tooling can do 🟢

**What binds these:** the same generator as "Acting outside the working tree" —
a fact taken from prose about the environment instead of from the environment —
but pointed at a different kind of fact and caught at a different moment. That
group fires before an ACTION LEAVING THE TREE and asks *which target*; this one
fires before an ASSERTION and asks *what can that thing actually do*. A claim
that a hook gates a commit, that a test would fail on a given input, that a
flag or harness exists, is a claim about capability, and it is checkable in one
command in almost every case. Kept separate rather than folded into the target
rule because folding it in would widen that rule's trigger from "you are about
to act" to "you are about to speak" and dilute its named checks; if Gabe
prefers one group, the two merge cleanly.

No wobble: dictated by Gabe on 2026-08-28 after the third false capability
claim of the day.

| Date | Rule | Cites |
|---|---|---|
| 2026-08-28 | Before asserting that a hook, test, gate, flag, script or harness exists or would catch something, run the falsifying check — `git config core.hooksPath` and the hook script, the test file's own assertion, `--help`, the `package.json` scripts block, a lockfile grep — rather than sourcing the claim from prose, this repo's own prose included. | `CLAUDE.md` § Working rules (verification discipline) |

**Evidence:** three assertions on 2026-08-28, each sourced from a document that
read authoritative, each false, each falsifiable by one command. (1) "There is
no pre-commit hook in this project", taken from `.claude/skills/rule-intake/SKILL.md`'s
own trust-property paragraph — `.githooks/pre-commit` exists, `core.hooksPath`
is `.githooks`, and it fired on commit `b7dfbab` the same day; the skill text
was corrected in that commit. (2) "`packages/ui/test/mock-parity.test.ts` will
force the T-code issue" — that test scrapes `case "([GMT]\d+)"` labels out of
the mock's switch, and the mock matches tool selection by a regexp ABOVE the
switch, so `T` codes are invisible to the scan; the effort agent found this and
documented the gap rather than inheriting the claim. (3) "This repo has no
jsdom, so a layout assertion in the node suite is not available", taken from
issue #95's context body. Gabe: "there are automated checks, they happen all of
the time." Two of the three sources were this repository's own prose, which is
precisely why they read as reliable.
**Enforcement:** none mechanical, and none is available — no artefact records
that a claim was made without checking. Held by authorship discipline, like the
other verification-discipline rules.

---

## Persisted layouts across releases 🟢

**What binds these:** all three are one decision about the boundary between a
RELEASE and the layout state that outlives it. A layout lives in three places at
once — code defaults, the SD card, and browser `localStorage` — and a release can
change what a layout MEANS while all three still hold bytes written under the old
meaning. These rules fix which copy is authoritative at that moment (the card),
what happens to the copy that is not (discarded, not reconciled), and what the
browser is allowed to see while the rewrite is in flight (nothing).

No wobble: dictated by Gabe on 2026-08-28 as an ARD, and amended by him within
the minute to strike the "if migration is needed" conditional. The amendment is
what makes the first row enforceable — the conditional form left a judgement call
that no check could catch, and the unconditional form reduces it to arithmetic.
Both the original dictation and the amendment are quoted verbatim in the spec.


| Date | Rule | Cites |
|---|---|---|
| 2026-08-28 | Every release ships a migration that rewrites ALL layouts stored on the SD card to the current version — unconditionally, the floor case being a migration whose only effect is to raise the version stamp. Enforced as arithmetic: the layout stamp must be strictly greater than the previous release's, against a committed baseline in the `eager-budget.json` / `debt-ceiling.json` shape. | `docs/superpowers/specs/2026-08-28-layout-migration-design.md` § The design constraint — what must be unrepresentable |
| 2026-08-28 | When the UI detects that a migration has happened, it discards its local storage and re-seeds from the card. At a version boundary the card wins outright; GIT_87's `basis` reconciliation governs only the non-migration case. | `docs/superpowers/specs/2026-08-28-layout-migration-design.md` § The four obligations |
| 2026-08-28 | During a migration the served entry document is temporarily replaced by an "Upgrade in process" page, so no browser loads the app mid-migration. Because migrations are unconditional, this window is entered on EVERY release. | `docs/superpowers/specs/2026-08-28-layout-migration-design.md` § The four obligations |
