
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
