# Engineering notebook — learnings and discoveries

Dated entries, appended in the same commit as the work that produced them and
managed like any source file; the git history of this file is the record of how
understanding evolved. Each entry is self-contained: what prompted it, what was
done, what was observed, what we conclude. Defect status lives in GitHub
issues; specs and plans state intent; this notebook states what reality
answered. Work is fully recorded only when both sides exist.

Rules extracted from these entries now live under `.claude/rules/`, indexed by the
generated `.claude/machinery/INDEX.md`; `docs/RULES-GROUPED.md` and the CLAUDE.md rule
sections are retired history, stamped with pointers (2026-09-02).

---

## 2026-08-26

Campaign #76 phase 1 (machine identity) merged at `9bf78d1` and deployed as
build `CgG8a9xU`. The five entries below are the mismatches it produced — cases
where a stated assumption did not survive contact — and what each one taught.
Two of them destroyed configuration on the real printer. Every one had passed a
review before shipping.

### 1. A class-shaped claim needs a class-shaped sweep

**Prompted by:** a fix for cross-machine contamination in the console log,
whose ruling described "the exact hazard #76 exists to remove" — a claim about
a *class* of defect.

**Method:** the fix was scoped to the module it was found in
(`om/store.ts`). A later whole-branch review searched for the same shape
across every consumer holding an in-memory buffer across an identity change.

**Observation:** two siblings held the identical shape — additive hydrate, then
persist the whole buffer to whichever store is current — and both shipped
broken. `om/commandHistory.ts` put commands typed at machine A into machine B's
recall list; `editor/drafts.ts` did the same for file drafts. The reviewer
reproduced the first by execution.

**Conclusion:** naming a defect as a class and then fixing one instance is the
most expensive shape of half-finished work, because the naming creates
confidence that the class is closed. There are exactly three consumers of that
abstraction; a grep at ruling time would have found all three in the same pass
that found the first.

### 2. "Confirmed by reading the code" is not confirmation

**Prompted by:** a live outage — the owner's settings appeared empty after
upgrade — and a ledger entry recording the root cause as "confirmed by reading
the code."

**Method:** the indicted function was read carefully and its behaviour
described correctly. What was never checked was whether execution reaches it
for the input in question.

**Observation:** it does not. `loadFromMachine` opens with `if (meta.dirty)
return`, and the owner's migrated cache carried `dirty: true`, so the SD file
was never downloaded and the code that had been "confirmed" never ran. The
diagnosis was corrected four lines later in the same ledger.

**Conclusion:** for a behavioural bug, reading the end function is evidence
about the function, not about the path. The confirmation that matters is the
call chain from the entry point that runs on the actual observed input.

### 3. A replacement premise inherits the shape of the one it replaced

**Prompted by:** a fix (`b9bdcbf`) that shipped to the printer and made the
reported problem worse.

**Method:** the first premise — "an empty canvas store means every card is
newly added" — was falsified by the owner's Control screen. The replacement
premise was "the composed defaults are a complete, coherent layout."

**Observation:** also false, and for the same reason one layer down.
`defaults` is `coded composition ∪ user overlay`, and a user overlay can be
partial, so the union can overlap itself. On the Shaping screen three cards the
owner had never placed landed on top of one he had.

**Conclusion:** when a fix exists *because* a premise broke, the replacement's
own assumption about its **inputs** is the thing to state and check. Both
premises trusted an input to have a shape — coherent, complete — that nothing
enforced. The correct fix (seeding from the proof-carrying SD overlay) was
considered first and set aside as too involved.

### 4. A closed question records a reason, and the reason is load-bearing

**Prompted by:** the spec closing its own open question 1 — "are screen layouts
machine-scoped?" — with the verdict *machine*, citing a recorded decision.

**Method:** the verdict was correct and the code built on it is correct. Four
clarifying exchanges during implementation established that the deciding
variable was not "is layout a machine fact" but "does this app have a person
axis to key explicitly" — which the spec never recorded.

**Observation:** because the recorded reason was the wrong one, nobody asked
the question it would have prompted: does any sibling field hold the same data?
One does. `screens.custom[].cards` holds byte-identical geometry for
user-created screens and is person-scoped, so a custom screen's arrangement
still crosses machines. Open as #87.

**Conclusion:** a verdict without its deciding variable is a fact the next
reader cannot extend. Recording it as a proposition that could be checked and
found false is what makes a closure reusable rather than merely final.

### 5. A document adapted from another project carries its identifiers

**Prompted by:** `docs/github-issue-rules.md`, which states the ticket-pair
convention this project uses and names the repository as `gnydick/ferrislicer`
in five places — the project it was adapted from.

**Method:** followed literally, without checking `git remote -v`.

**Observation:** four tickets were filed into that unrelated repository, a
comment was posted on its #76 (a different campaign entirely), and **two of its
open issues were closed** because ticket numbers from this project's ledger
collided with real issues there. All reversed; the tickets re-filed here as
#86/#88 and #87/#89.

**Conclusion:** the document is evidence of intent, the environment is evidence
of fact, and a repo name reads as scenery right up until it addresses someone
else's issue tracker. The file was internally consistent and confidently wrong,
which is the shape that survives review. Repaired in `fa46ec5`, which also
added the check that would have caught it.

### What worked, and is worth keeping

- **The pre-flight conflict scan.** Before task 1, every pair of tasks sharing
  a file or interface was checked produced-against-consumed. It found five real
  plan defects — two of them tests that could not fail — and they were ruled on
  before a line was written. Cheapest defect-finding of the campaign.
- **Required, not optional, dependencies.** `Accessor<MachineStore | null>` as
  a *required* parameter makes "identity unknown" representable and "forgot
  identity" a compile error. An earlier optional version silently dropped every
  machine-scoped edit in production.
- **Deleting a parameter beats guarding it.** One fix removed the `machineNow`
  parameters from the legacy-migration functions entirely, so no machine
  reference *can* reach that path — as against a check the next caller may not
  make.
- **Falsification as a gate.** Every fix reverted, confirmed RED for the stated
  reason, restored, confirmed GREEN. It caught an implementer's own fix
  introducing a bug, and caught a controller ruling whose proposed mechanism —
  an escape sequence that was not injective — was itself broken.
- **Probes over unit tests for ordering facts.** Both of the final review's
  Criticals were ordering facts about three plain functions, found and then
  verified by constructing the real modules in real boot order in plain Node.
  A unit test that hands a fix its inputs can only confirm "it works when the
  input exists"; the unasked question was whether the input exists at the
  moment the code runs.

---

## 2026-09-02

Migrating this project's governance machinery onto the `machinery` Claude Code
plugin, and every project rule out of prose and into the plugin's
`.claude/rules/*.md` format. GIT_208.

### 1. Two implementations of one idea, and the one with no owner lost

**Prompted by:** the `machinery` plugin now provides, generically and for every
project on the machine, what this repo built by hand on 2026-08-26 by porting a
sibling project's checker: rule capture, an inbox with dispositions, a register,
an intake skill and a commit gate. Gabe, 2026-09-02, approved retiring the local
copy by pointer and ruled "we need the full migration of how rules are stored to
the .claude/rules format".

**Method.** Four commits on `migrate-to-machinery`. The retirement and the
install went FIRST, because the old `.githooks/pre-commit` would otherwise have
run `scripts/register_check.py` against the new stamps: deleted
`.claude/hooks/rule_capture.py`, `.claude/hooks/rule_nudge.py`,
`.claude/skills/rule-intake/SKILL.md`, `scripts/register_check.py` and the old
`pre-commit`; emptied `.claude/settings.json` to `{}`; dropped `register:check`
and `register:check:fast` from `package.json`; changed `core.hooksPath` in the
shared repo config from an absolute path to the relative `.githooks`, which the
installer requires and which resolves per worktree; then ran the plugin
installer. Then the nine rule files, then the stamps, then this entry.

**Where each rule went.** 43 bullets of prose in, 44 rule bullets out.

| Source | Bullets | Destination | Bullets |
|---|---|---|---|
| CLAUDE.md, hard constraints | 4 | rules/hard-constraints.md | 4 |
| CLAUDE.md, reference source | 3 | rules/reference-material.md | 1 |
| CLAUDE.md, first tasks item 6 | 1 | rules/reference-material.md | 1 |
| CLAUDE.md, stack | 4 | rules/stack.md | 4 |
| CLAUDE.md, architecture requirements | 7 | rules/architecture.md | 7 |
| CLAUDE.md, Solid-specific rules | 3 | rules/solid.md | 3 |
| CLAUDE.md, dependency policy | 2 | rules/dependencies.md | 2 |
| CLAUDE.md, working rules (development environment) | 6 | rules/uat-and-mock.md | 6 |
| RULES-GROUPED, the completion-claim row | 1 | rules/uat-and-mock.md, completion claims | 1 |
| CLAUDE.md, working rules (work topology) | 8 | rules/uat-and-mock.md (2) plus universal (7, one bullet double-counted) | 2 |
| RULES-GROUPED, persisted layouts across releases | 7 | rules/persisted-layouts.md | 7 |
| github-issue-rules, tracking work | 10 | rules/tracking-work.md | 6 |
| CLAUDE.md, working rules (verification discipline) | 6 | universal only | 0 |
| RULES-GROUPED, maintaining this file (the contract) | 6 | universal only | 0 |

Nineteen retired bullets are not restated as project rules, because a universal
plugin rule already states them: all six verification-discipline bullets, seven
of the eight work-topology bullets, four of the ten GitHub-tracking bullets, two
of the three reference-source bullets, and all six contract bullets of the old
register. Each retired section points at the universal rule instead. Exactly one
retired bullet had no universal counterpart, and it is kept as a project rule
and named as such: that this project's fourth kind of dispatched task is `test`,
which the universal rule deliberately leaves open for the owner to name.

**Observed.**

- The installer printed: created the inbox; regenerated the index; installed
  gate 0.1.37 into `.githooks/machinery/`; `core.hooksPath: .githooks`; and
  "hosted check: none (the local merge gate is the sole blocking backstop)".
- The gate ran on all four commits and passed each, with no `--no-verify`. Its
  denominators were non-zero where citations existed (six on the rule-file
  commit, two on the stamps commit), which is what shows the observer was alive
  rather than merely silent.
- **The gate rejected a commit for a real defect.** The first version of the
  `docs/github-issue-rules.md` pointer put explanatory prose after the cited
  heading. The gate's section matcher captures a heading lazily up to the next
  comma, full stop, semicolon, bracket or pipe, so it captured the heading plus
  that prose and correctly found no such heading. Fixed by terminating the
  citation with a full stop.
- **A heading containing a comma cannot be cited in the backticked form at all.**
  Measured against the same matcher: the capture always truncates at the first
  comma, so the layout-version-ownership spec's "What ruling 1 settles, and what
  it costs" resolves to "What ruling 1 settles" and fails however it is written.
  That one citation in `.claude/rules/persisted-layouts.md` is therefore
  deliberately unbackticked, verified instead by exact string comparison against
  the spec's own heading line, with the reason stated in the file itself.
- **Falsification of the register check, run rather than assumed.** A bullet was
  appended to `.claude/rules/solid.md` and staged WITHOUT reindexing. The commit
  was rejected, naming the index as stale against a fresh regeneration. The
  bullet was restored and the index re-confirmed equal to a regeneration.

**Concluded.** The weakest link in the old arrangement was that the register was
authored by hand beside a prose contract asking people to keep it in step. The
plugin removes that link mechanically: the index is generated from the rule
files, and the gate regenerates it from the STAGED files, so a register that
disagrees with what is actually being committed cannot land. The rules being
machine-readable is what made that possible. 44 bullets can be counted, indexed
and cited into; 43 lines of prose could not.

**What got worse.** Named, not softened.

- The old checker validated every citation in the whole register on every run.
  The plugin's citation check validates only newly ADDED lines, "validated once,
  at authoring". An existing citation that rots because its target heading is
  later renamed is no longer caught by anything.
- The old checker had a group/circle scan and a stamp-bidirectionality check: a
  SUPERSEDED stamp had to name a group that exists, and the register had to carry
  a matching Supersedes line pointing back. The plugin gate has neither. The
  eight stamps written today are unchecked prose, and the ones pointing at plugin
  rule files are unverifiable from this repo by construction, because those files
  are not in it.
- Citation matching went from prefix to exact. Stricter and better, at the cost
  of the comma case above.
- `pnpm test` no longer runs any governance check at all; the old `test` script
  ended by running the register checker in full mode. The commit gate is now the
  only place a governance violation is caught, and only at commit time.
- The old gate ran on five governance paths only; the new one runs node on every
  commit. Better coverage, a small fixed cost on every commit.

**New smell.** The installed gate resolves its project root from
`git rev-parse --git-common-dir`, which in a linked worktree is the MAIN checkout.
Committing is unaffected, because git's hook environment supplies GIT_DIR and
GIT_INDEX_FILE, so the checks read the committing worktree's index. That was
measured today: the gate correctly rejected the stale-index commit from inside
this worktree. But running `node .githooks/machinery/gate.mjs` BY HAND from a
linked worktree, with no hook environment and no `--root`, reports zero of zero
index rows and "nothing staged under rules or the index" and exits 0 while real
changes sit staged. A check that reads as a pass while checking nothing is
exactly the shape this project's own rules exist to catch. Pass
`--root <worktree>` for a hand run; it then behaves identically to the hook.
