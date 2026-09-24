---
status: 🟢
---
# The test loop

Dictated by Gabe on 2026-09-01, filed 2026-09-03; the entry sat in the inbox through the
migration to the machinery plugin, so its original stamp is kept in
`.claude/machinery/inbox.md`. These rules are about what a test run COSTS the agent
reading it, not about whether the change was proved — proving it is
`.claude/rules/uat-and-mock.md`. They are separate because that file's remedy is standing
something up and driving it, which would never have produced this fix. Nothing enforces
this mechanically today: it is a briefing discipline on whoever dispatches the run, and
the only check is reading the dispatch.

## What a test run feeds back

- A test run's output reaches the agent only when something failed. On a pass the loop returns the outcome — the counts and the verdict — and the transcript is discarded, because passing output buys nothing and context size is what the agent actually pays for.
