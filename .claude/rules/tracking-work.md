---
status: 🟢
---
# Tracking work on GitHub

Moved 2026-09-02 from the verbatim rule block of docs/github-issue-rules.md § Tracking work
(verbatim from CLAUDE.md); that file keeps the commands that execute these, and stays the
place to look for them. Only the GitHub-specific mechanics are here — the universal form of
the ticket pair, its labels and its commit marker is machinery plugin:
rules/work-tracking.md § A ticket and its companion, and the learnings ledger it requires is
machinery plugin: rules/work-tracking.md § The learnings record.

## Tracking work on GitHub

- Every new piece of work gets a GitHub issue PAIR: a full parent written so an
  engineer-stranger could pick it up cold, and exactly one child titled `Context: #N`
  holding the compressed AI pickup context. Plans and specs hang off the parent.
- The GitHub sub-issue relation is reserved for that parent-and-child pair alone; nothing
  else is ever a sub-issue of anything. Campaign findings, epic chapters and follow-ups each
  get their own NEW pair rather than a sub-issue of the campaign.
- Added-links mirror at both levels: a new parent is an "added" ticket on the overall
  parent, and its Context child an "added" ticket on the overall Context child. A session
  resuming a campaign then reaches every finding's context through Context children alone,
  without pulling any full parent.
- Issue reads are budgeted for minimum token burn: fetch only the fields needed; list
  issues for their titles, then fetch the ticket's one Context child and read that; read the
  full parent only if the child proves insufficient; never pull full issues in bulk. AI
  condensed learnings are added to the child.
- A number the developer names always means the PAIR, whichever half they named. The read
  rules above still apply, and the number you were given does not redirect you somewhere
  else.
- Every GitHub issue carries a label naming the worktree it lives in, on BOTH halves of the
  pair, and every commit message carries a marker for the issue it relates to in the form
  `GIT_[\d]+`.
