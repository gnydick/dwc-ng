---
status: 🟢
---
# UAT and the mock

Moved 2026-09-02 from CLAUDE.md § Working rules (development environment), plus the
mock-belongs-to-its-worktree rule from CLAUDE.md § Working rules (work topology) and the
completion-claim row of docs/RULES-GROUPED.md § Proving a change against something that
behaves like the machine; history and the incident narratives stay there. A test suite exercises the units
someone wrote a fixture for; it does not exercise the wiring a person touches, and these
rules close that gap.

## Proving a change against something that behaves like the machine

- The full mock suite runs during development, and a user-facing change is not done until
  it has been exercised against it. Keep `pnpm mock` up while building UI so any change can
  be clicked through without waiting for a deploy to the printer, and drive the change
  against mock-duet before reporting it complete. A green unit suite is not UAT: it
  exercises the units you wrote a fixture for, not the wiring a person touches. (Gabe,
  2026-08-26.)
- The mock moves with every iteration. A change to what the UI reads from or writes to the
  board — a new object-model key, a new file path, a config version bump, a new endpoint —
  updates `packages/mock-duet` in the SAME change, not later. Mock parity is part of the
  work, not a follow-up ticket: a mock a version behind cannot host the UAT the other rules
  require, so letting it drift disables the rule that catches everything else.
  (2026-08-26.)
- Nothing deploys to the printer until Gabe has UAT'd it on the mock. The sequence is: work
  lands, review clean, mock stood up and handed to Gabe, **he** drives it, he says deploy.
  A clean review is not permission to ship — the implementer's UAT is evidence that the
  change works, Gabe's is the gate that lets it reach hardware. (2026-08-26.)
- Every code-complete iteration is deployed to the mock for UAT — not only the final one,
  and not gated on the review being clean. As soon as an iteration is code complete, stand
  it up against `packages/mock-duet` and say so, so Gabe can drive it while review and any
  fix rounds continue. This refines the rule above rather than replacing it: the mock
  deploy happens EARLY and often, the printer deploy still waits for Gabe's word.
  (2026-08-26.)
- Whoever stands a mock up owns tearing it down. A mock started for an iteration's UAT is
  stopped when that UAT ends, and a ticket's mock does not outlive the ticket's merge.
  Falsifying check: `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` filtered to
  `mock-duet` returns no process older than the current session's work. Confirm a kill by
  port state, never by exit code — `pkill` exits 0 on Windows while leaving the process
  alive. (Gabe, 2026-08-29.)
- Identify the mock you are driving by PID and start time, never by "something answered on
  that port". Before reporting a mock as stood up, confirm the listening process is the one
  you launched: owning PID via `Get-NetTCPConnection`, cross-checked against its
  `CreationDate`. A healthy response on the expected port is not evidence the expected
  process produced it, and an orphan's flags (`--max-sessions 32`, `--no-auth`) silently
  disable the constraints the UAT exists to exercise. (Gabe, 2026-08-29.)
- A mock stood up for a piece of work runs FROM that work's worktree — never from the main
  checkout, never shared between worktrees — so what it serves is the branch under test
  rather than whatever main happens to hold. Treat this as a PARTIAL mechanism for the
  teardown rule above, not a guarantee: it gives the process a visible owner and an obvious
  end, but removing a worktree does NOT kill a process started from it, so teardown stays a
  discipline that must be performed and confirmed by port state. (Gabe, 2026-08-29.)

## Completion claims

- A completion claim records the UAT: what was driven, against which scenario, what was
  observed. No note means the change is not done. (2026-08-26.)

## The test agent class

- This project's fourth kind of dispatched task is `test` — exercising work, including UAT
  — alongside doing the work, reviewing it, and filing rules. Named by Gabe on 2026-08-28
  ("we should have 4 types then, union of the types"); the universal rule leaves the set
  open and reserves naming a new kind to the owner, so this is the project's own named
  kind: machinery plugin: rules/agent-topology.md § How many at once. Serial within the
  kind, and one agent per working copy, apply to it like any other.
