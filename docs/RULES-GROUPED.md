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

Rows 6 and 7 (2026-08-29) are the group's own back-pressure, not a wobble: the
first five rules only ever say STAND ONE UP — per iteration, per ticket, early
and often — and nothing in the workflow ever said take one down or check which
one you got. On 2026-08-29 ten orphaned `mock-duet` processes were found still
listening, the oldest two days old, four of them on ports 8136/8138/8142/8144
matching GIT_136/GIT_138/GIT_142/GIT_144 — the branches merged the day before.
That port-to-ticket mapping is what makes the leak a product of the workflow
rather than a slip, and it means the rule that catches everything else was
generating the hazard. Both new rows protect the same premise the first five
depend on: that the thing being driven is the thing that was changed.

No wobble.

| Date | Rule | Cites |
|---|---|---|
| 2026-08-26 | The full mock suite runs during development, and a user-facing change is not done until it has been exercised against it — a green unit suite is not UAT. | `CLAUDE.md` § Working rules (development environment) |
| 2026-08-26 | A completion claim records the UAT: what was driven, against which scenario, what was observed. No note means the change is not done. | `CLAUDE.md` § Working rules (development environment) |
| 2026-08-26 | A change to what the UI reads from or writes to the board updates `packages/mock-duet` in the SAME change. Mock parity is part of the work, not a follow-up ticket. | `CLAUDE.md` § Working rules (development environment) |
| 2026-08-26 | Nothing deploys to the printer until Gabe has UAT'd it on the mock. A clean review is not permission to ship; the implementer's UAT is evidence, Gabe's is the gate. | `CLAUDE.md` § Working rules (development environment) |
| 2026-08-26 | Every code-complete iteration is deployed to the mock for UAT — early and often, not gated on review being clean. Refines the row above: mock deploy is early, printer deploy still waits for Gabe. | `CLAUDE.md` § Working rules (development environment) |
| 2026-08-29 | Whoever stands a mock up owns tearing it down: a mock started for an iteration's UAT stops when that UAT ends, and a ticket's mock does not outlive the ticket's merge. Falsifiable — a `Win32_Process` scan for `mock-duet` returns nothing older than the current session's work — and a kill is confirmed by port state, never by exit code. | `CLAUDE.md` § Working rules (development environment) |
| 2026-08-29 | Identify the mock you are driving by owning PID and start time, never by "something answered on that port". A healthy response on the expected port is not evidence the expected process produced it, and an orphan's flags (`--max-sessions 32`, `--no-auth`) silently disable the constraints the UAT exists to exercise. | `CLAUDE.md` § Working rules (development environment) |

**Evidence:** `docs/LEARNINGS.md` § 2026-08-26, and
`docs/superpowers/2026-08-26-machine-identity-phase-1-final-review.md`, whose
two Criticals were both found by running the real modules rather than by
reading or by unit tests.

**Evidence for rows 6 and 7:** the ten-orphan inventory of 2026-08-29, measured
with `Get-CimInstance Win32_Process` cross-referenced against
`Get-NetTCPConnection`, four of whose ports mapped one-to-one onto the previous
day's merged tickets. The near-miss that produced row 7: a `pnpm mock` start
failed with `ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL` and never listened, yet
`curl 127.0.0.1:8971/rr_connect` answered `{"err":0,"apiLevel":1,"sessionTimeout":8000}`
from an orphan launched the previous evening — the fresh mock was one report
away from being a stranger process.

**Cross-reference, added 2026-08-29:** § Dispatching work — who does it, and
where it runs now carries a rule that a mock runs from the worktree of the work
it serves. It is filed THERE, not here, and deliberately not duplicated as a row
in this group: its subject is where a process lives, decided at dispatch, while
this group's subject is whether a change was proved against something that
behaves like the machine. It matters to rows 6 and 7 all the same, in two ways
— a mock served out of the main checkout is not serving the branch under test,
and a mock bound to a worktree has a visible owner and an obvious end. Do not
read it as enforcement: removing a worktree does not kill a process started from
it, so it narrows who can orphan a mock without preventing it, and the teardown
rule is still discharged by killing the PID and confirming the port.

Row 7 is deliberately NOT folded into § Claiming what the tooling can do. That
rule governs a capability claim sourced from PROSE and is discharged by running
any check at all; here a check *was* run — `curl` against the port — and it
returned a true answer to the wrong question. The defect is a non-discriminating
observation, not an unchecked one, so the remedy is a different check (PID +
`CreationDate`), which that rule does not name and would not have produced.

**Enforcement:** no automated check. The teeth are in the report: a completion
claim without a UAT note fails the second rule on its face, which is
reviewable by eye where "did you run the mock" is not. `packages/mock-duet`
runs via `pnpm mock`; no teardown target exists — verified 2026-08-29 by
reading the `scripts` blocks of both `package.json` and
`packages/mock-duet/package.json`, which offer `start`, `dev`, `test`,
`typecheck` and no stop, so rows 6 and 7 are held by discipline alone.

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

Rows 5 and 6 (2026-08-29, Gabe: "all work happens in worktrees, mocks must be
there too") are a REFINEMENT, not a wobble. Nothing standing ever said the main
checkout was a valid work surface — the 2026-08-28 rules decide WHICH worktree
an agent may have (one agent each; a review or test in its own, explicitly "not
the main checkout") and are silent on whether an agent must have one at all.
The new rows close that silence, and the silence was acted on twice on
2026-08-29: `rule-intake: mock teardown` was dispatched to the main checkout and
committed `7c3ee6d` there, and the mock (port 8975) plus vite dev server (port
5173) for that day's UAT were started from it. A practice permitted by silence
is not a standing rule, so no supersession stamp is owed and the circle does not
move.

| Date | Rule | Cites |
|---|---|---|
| 2026-08-28 | The main agent does no work: it holds conversation, adjudication and relay, and delegates everything else. Reading a file to answer a question is conversation; reading it to change it is work. | `CLAUDE.md` § Working rules (work topology) |
| 2026-08-28 | Four agent classes — effort, review, test, rule-intake. Serial WITHIN a class (one in flight each), concurrent ACROSS classes, so at most four at once and only when each is in a different worktree. | `CLAUDE.md` § Working rules (work topology) |
| 2026-08-28 | At most ONE agent per worktree, not waivable by an agent's own reading of its brief; a review or test of work in flight targets that branch in its OWN worktree of it, created if none exists. | `CLAUDE.md` § Working rules (work topology) |
| 2026-08-28 | Agents are named by class and target at spawn (`effort: GIT_118`, `review: GIT_87`, `test: uat`, `rule-intake: agent topology`), because the harness identifies a running agent only by an opaque id. | `CLAUDE.md` § Working rules (work topology) |
| 2026-08-29 | All work happens in a worktree: an agent given work gets a worktree of the branch that work lands on, created if the branch has none, even when it is the only agent alive; the main checkout keeps only conversation, adjudication and relay. Falsifiable by `git rev-parse --git-dir` in the checkout an agent wrote in — `.git/worktrees/<name>` in a linked worktree, a bare `.git` in the main one. | `CLAUDE.md` § Working rules (work topology) |
| 2026-08-29 | A mock stood up for a piece of work runs FROM that work's worktree — not the main checkout, not shared across worktrees — so it serves the branch under test. A PARTIAL mechanism for the teardown rule in § Proving a change against something that behaves like the machine: it gives the process a visible owner and an obvious end, but removing a worktree does not kill a process started from it. | `CLAUDE.md` § Working rules (work topology) |

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

Rows 6 and 7 are a further refinement, not a wobble: reframing #146, Gabe ruled
that the configuration document records the operator's EDITS rather than the
app's resolved state, which is the same boundary seen from the other side — the
first three rows decide which copy wins at a version boundary, and these two
decide what may be in the copy at all. They restate the config module's own
founding rule (`config/types.ts`: reset = delete from the overlay) for the one
section that never obeyed it.

Rows 4 and 5 close the one thing the ARD left open — WHICH stamp the arithmetic
reads — and are a refinement, not a wobble: Gabe ruled `CANVAS_FORMAT_VERSION`
owns it and attached a new obligation in the same breath, that a canvas change
forcing a config change must be coupled. The rating of candidate enforcement
mechanisms for that coupling (compile-time vs deploy-time vs prose-only, with
the recommendation and what none of them reach) is in the companion spec.


| Date | Rule | Cites |
|---|---|---|
| 2026-08-28 | Every release ships a migration that rewrites ALL layouts stored on the SD card to the current version — unconditionally, the floor case being a migration whose only effect is to raise the version stamp. Enforced as arithmetic: the layout stamp must be strictly greater than the previous release's, against a committed baseline in the `eager-budget.json` / `debt-ceiling.json` shape. | `docs/superpowers/specs/2026-08-28-layout-migration-design.md` § The design constraint — what must be unrepresentable |
| 2026-08-28 | When the UI detects that a migration has happened, it discards its local storage and re-seeds from the card. At a version boundary the card wins outright; GIT_87's `basis` reconciliation governs only the non-migration case. | `docs/superpowers/specs/2026-08-28-layout-migration-design.md` § The four obligations |
| 2026-08-28 | During a migration the served entry document is temporarily replaced by an "Upgrade in process" page, so no browser loads the app mid-migration. Because migrations are unconditional, this window is entered on EVERY release. | `docs/superpowers/specs/2026-08-28-layout-migration-design.md` § The four obligations |
| 2026-08-28 | `CANVAS_FORMAT_VERSION` is THE layout version: it owns layout migration and is the stamp the ratchet reads. `CONFIG_VERSION` stamps the non-layout configuration document only and carries no claim about what a layout means — which requires layouts to leave the `CONFIG_VERSION`-stamped overlay rather than merely being re-labelled. | `docs/superpowers/specs/2026-08-28-layout-version-ownership.md` § What ruling 1 settles, and what it costs |
| 2026-08-28 | A canvas-format change that FORCES a change to the configuration document must be coupled so neither stamp can advance alone — enforced by a mechanism, not a prose "must", since the two stamps have deliberately different disciplines (the layout stamp ratchets every release; `CONFIG_VERSION` is read by equality and must bump only on a real shape change). | `docs/superpowers/specs/2026-08-28-layout-version-ownership.md` § Ruling 2 — the coupling requirement |
| 2026-08-28 | The configuration document records the operator's EDITS, not the app's resolved STATE: geometry reaches the overlay only from an operator gesture, so a card's presence in the file IS its authorship and a card sitting at its coded default is absent — which is what lets a later release still move or re-measure it. | `docs/superpowers/specs/2026-08-28-record-edits-not-state.md` § The ruling |
| 2026-08-28 | Attribution is STRUCTURAL, not stored: write-through on gesture is preferred over a persisted provenance mark, because a mark states authorship a second time beside the file's own key presence and nothing makes the two agree. The rule is prospective only — numbers already resolved onto a card can be repaired by a migration Gabe rules on or by an explicit reset, never by inferring which of them a person chose. | `docs/superpowers/specs/2026-08-28-record-edits-not-state.md` § The two candidate designs |
