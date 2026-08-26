# Engineering notebook — learnings and discoveries

Dated entries, appended in the same commit as the work that produced them and
managed like any source file; the git history of this file is the record of how
understanding evolved. Each entry is self-contained: what prompted it, what was
done, what was observed, what we conclude. Defect status lives in GitHub
issues; specs and plans state intent; this notebook states what reality
answered. Work is fully recorded only when both sides exist.

Rules extracted from these entries live in `CLAUDE.md` § Working rules and are
grouped in `docs/RULES-GROUPED.md`.

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
