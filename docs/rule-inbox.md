
## 2026-08-26T21:34:08Z 84a16cf8-421a-45db-b981-f63d00c0ead3

RULE: during development have the full mock suite running for UAT

Disposition: filed — Proving a change against something that behaves like the machine (CLAUDE.md § Working rules (development environment))

## 2026-08-26T22:57:29Z 84a16cf8-421a-45db-b981-f63d00c0ead3

RULE: deploy to mock with each code complete iteration for UAT

Disposition: filed — Proving a change against something that behaves like the machine (CLAUDE.md § Working rules (development environment))

## 2026-08-28T19:24:11Z a5e32e49-b5e0-40ee-ab12-5bd93dc627cc

RULE: nothing runs in the main agent conserve tokens and keep conversation context tight

Disposition: filed — Dispatching work — who does it, and where it runs (CLAUDE.md § Working rules (work topology))

## 2026-08-28 (manual capture — RECONSTRUCTED from the conversation of 2026-08-28, not hook-captured; these rulings were given conversationally rather than RULE:-prefixed, so `.claude/hooks/rule_capture.py` never fired on them)

RULE (reconstructed): agent topology. There are FOUR agent classes — effort, review, test, rule-intake (Gabe: "we should have 4 types then, union of the types"). Serial WITHIN a class: one agent in flight per class. Concurrent ACROSS classes: at most four agents at once, and only when each is in a DIFFERENT worktree. At most ONE agent per worktree, not waivable by an agent's own reading of its brief; sharing happens only when Gabe explicitly requests it. A review or test of work in flight targets that branch and gets its OWN worktree of it, created if the branch has none. Agents are NAMED BY CLASS AND TARGET at spawn — `effort: GIT_118`, `review: GIT_87`, `test: uat`, `rule-intake: agent topology` (Gabe: "naming convention is good") — because the harness refers to agents only by opaque ids like `a147f359d45f0a51e`, so without the convention a running agent's class is invisible and a serial-per-class rule cannot be followed at a glance.

Disposition: filed — Dispatching work — who does it, and where it runs (CLAUDE.md § Working rules (work topology))

## 2026-08-28T22:50:27Z a5e32e49-b5e0-40ee-ab12-5bd93dc627cc

RULE: stop guessing at capabilities, check first

Disposition: filed — Claiming what the tooling can do (CLAUDE.md § Working rules (verification discipline))

## 2026-08-28 (manual capture — ARD, not hook-captured; `.claude/hooks/rule_capture.py` matches a `RULE:` prefix and Gabe prefixed this one `ARD:`)

ARD (verbatim): "ARD: we have to honor smooth migration path when there are updates. when the user interface is newer than the layout on the sd card, there has to be a migration to update the layouts stored on the card to the current version of the software. so every release needs a migration, if migration is needed, to modify the all layouts saved on the sdcard. if the UI sees a migration has happened, it trashes it's local storage and updates it with what's on the sdcard. we should also do a temp replacement of index.html with a simple 'Upgrade in process' so the web page is never loaded during a migration."

AMENDMENT (verbatim, seconds later): "change that to remove the 'if migration is needed'  all migrations will be at least a version upgrade in the layout files"

Disposition: filed — Solo rules, by area § Persisted layouts across releases (docs/superpowers/specs/2026-08-28-layout-migration-design.md). Implementation ticket pair filed separately; NOT implemented in this pass.

## 2026-08-28 (manual capture — ruled in conversation, not hook-captured; `.claude/hooks/rule_capture.py` matches a `RULE:` prefix and this was answered inline as a question about #130's open question 1)

RULING (verbatim): "canvas_format_version owns it. but we need an invariant that enforces that changes in the canvas that requires changes in the config are coupled otherwise strange breakages can happen"

Disposition: filed — Persisted layouts across releases (docs/superpowers/specs/2026-08-28-layout-version-ownership.md § What ruling 1 settles, and what it costs; § Ruling 2 — the coupling requirement). Two register rows. Enforcement mechanisms rated in the same spec; NOT implemented — GIT_130 builds.

## 2026-08-28 (manual capture — ruled in conversation, not hook-captured; `.claude/hooks/rule_capture.py` matches a `RULE:` prefix and this was given inline as a reframing of ticket #146)

RULING (verbatim): "so that prompt is a really bad way of saying to record individual edits and blame them"

AND (verbatim): "yes, rewrite 146 around record-edits-not-state"

Disposition: filed — Persisted layouts across releases (docs/superpowers/specs/2026-08-28-record-edits-not-state.md § The ruling; § The two candidate designs). Two register rows. #146/#147 rewritten around the reframing. NOT implemented — GIT_146 builds, and it is BLOCKED on Gabe answering "what counts as moved" (incl. reflow displacement).

## 2026-08-29 (manual capture — ruled in conversation, not hook-captured; `.claude/hooks/rule_capture.py` matches a `RULE:` prefix and Gabe asked for this one to be filed after being shown the orphan inventory)

RULE (as ruled): mock teardown and mock identity. (1) Whoever stands a mock up owns tearing it down — a mock started for an iteration's UAT is stopped when that UAT ends, and a ticket's mock does not outlive the ticket's merge. (2) Identify the mock you are driving by owning PID and start time, never by "something answered on that port".

Evidence: ten orphaned `mock-duet` processes found listening on 2026-08-29 ~16:34 PDT, accumulated 08-27 through 08-29 (PIDs 51364/8970, 39324/8997, 62788/8999, 46136/8994, 66128/8971, 42404/8136, 80828/8138, 73292/8142, 47312/8144, 76816/8199). Ports 8136/8138/8142/8144 map to GIT_136/GIT_138/GIT_142/GIT_144, merged to main the previous day — so the leak is produced by the workflow, not by a slip. All ten killed on Gabe's instruction and verified released by port state, not by exit code. Near-miss for rule (2): a start command failed with `ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL` yet `curl 127.0.0.1:8971/rr_connect` returned a healthy `{"err":0,"apiLevel":1,"sessionTimeout":8000}` from PID 66128, an orphan from the previous evening.

Disposition: filed — Proving a change against something that behaves like the machine (CLAUDE.md § Working rules (development environment)). Two register rows (rows 6 and 7 of that group). Ruled NOT a duplicate of § Claiming what the tooling can do; the reason is recorded in the group's evidence block.

## 2026-08-29T23:45:52Z 0335a088-3f8c-4a44-96a2-09072021f835

RULE: all work happens in worktrees, mocks must be there too

Evidence: the rule's own silence was acted on twice on 2026-08-29 — `rule-intake: mock teardown` was dispatched to the main checkout and committed `7c3ee6d` there, and the mock (port 8975, PID 46244) plus a vite dev server (port 5173) for that day's UAT were started from the main checkout. Component (2) also inherits the ten-orphan inventory of the entry above: four of those mocks were on ports 8136/8138/8142/8144, mapping to GIT_136/138/142/144, branches merged the previous day whose worktrees still exist — a mock bound to its worktree has an owner and an end. Recorded as a PARTIAL mechanism only: removing a worktree does not kill a process started from it.

Disposition: filed — Dispatching work — who does it, and where it runs (CLAUDE.md § Working rules (work topology)). Two register rows (rows 5 and 6 of that group). Ruled REFINE, not CONTRADICT, so no supersession stamp and the circle does not move: nothing standing ever asserted the main checkout was a valid work surface — the 2026-08-28 topology rules constrain WHICH worktree an agent may have and are silent on whether it must have one. Component (2) is cross-referenced from § Proving a change against something that behaves like the machine (prose, not a duplicate row); the reasoning is recorded there.
