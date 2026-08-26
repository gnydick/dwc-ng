# GitHub issue rules (dwc-ng)

Source of truth: `CLAUDE.md` § "Tracking work". This file restates it verbatim and adds the
commands that execute it, so another Claude session can follow it without the repo context.

## Tracking work (verbatim from CLAUDE.md)

- Related bugs share one worktree. Discover the link late? Combine and clean up.
- Every new piece of work gets a GitHub issue. `/superpowers` plans and specs hang off those issues.
  the issue needs to be engineer-stranger compatible, full engineer spec.
- Each campaign keeps a ledger of stats and changes: what we did, what changed, what
  is better, what regressed, whether the refactor worked, new smells.
- Learnings ship with the major commit or worktree, versioned like code, as the
  counterpart to plans and specs.
- Pickup protocol. Every ticket has exactly one "Context:" sub-issue: the compressed
  pickup context for an AI session. To get caught up: list issues for titles, fetch
  the ticket's one sub-issue, read its description — nothing else unless it proves
  insufficient. Goal is minimal token burn. Keep the context sub-issue current as
  the ticket moves.
  - The sub-issue relation is reserved for this pair alone. Nothing else is ever a
    sub-issue of anything.
  - Campaign findings, epic chapters, follow-ups: each is its own NEW ticket pair
    (full engineer-stranger parent + its own Context child), never a sub-issue of
    the campaign.
  - Added-links mirror at both levels: the new parents are "added" tickets on the
    overall parent; the new Context children are "added" tickets on the overall
    Context child. A session resuming a campaign reaches every finding's context
    from the one campaign sub-issue, without pulling any full parent.
- GitHub Issue read access is designed for minimum token consumption
    - use API to only fetch fields needed
    - allowed: list github issues to get the title then get the 1 sub-issue for that ticket.
    - allowed: read full issue if more context is needed
    - not allowed: pulling full issues
    - add learnings to the sub-issue with AI condensed context
    - when referring to issue numbers, developer may refer to the parent or child, it always means the set
      and the issue access and behavior rules still apply, the referred to issue number doesn't redirect
- Issues are updated in the parent full spec and child context everytime there is a correction
  given by the developer
-  Every GH issue gets a label for the worktree it's in
-  Don't make sub-issues, they are only for the parent-child relationship with full detail in parent and context in
   child. Make new ticket pairs if you want to track individual progress, then add them as "added" tickets, parents
   to the overall parent, and sub-issues to the overal sub-issue
   not sub-issues
- Every commit message gets a marker for the github issue that relates to it in the form if GIT_[\d]+

## How the rules are executed (commands that work, 2026-08-22)

Repo: `gnydick/dwc-ng`. Confirm with `git remote -v` before any `gh` call — this
file was adapted from another project, and a stale repo name here caused a
session to file four tickets into the wrong repository and close two unrelated
issues there (2026-08-26).

### Pickup (minimal tokens)

```bash
gh issue list --state open --limit 200 --json number,title,labels
gh issue view N --json title,labels,state
gh api graphql -f query='{ repository(owner:"gnydick", name:"dwc-ng") { issue(number:N) { subIssues(first:2) { nodes { number title body } } } } }'
```

Read the parent body only if the child proves insufficient.

### Create a ticket pair

```bash
gh issue create --title "<engineer-stranger title>" --body-file parent.md            # -> #N
gh issue create --title "Context: #N" --body-file child.md                          # -> #N+1
PID=$(gh api graphql -f query='{repository(owner:"gnydick",name:"dwc-ng"){issue(number:N){id}}}' -q .data.repository.issue.id)
CID=$(gh api graphql -f query='{repository(owner:"gnydick",name:"dwc-ng"){issue(number:N+1){id}}}' -q .data.repository.issue.id)
gh api graphql -f query="mutation{addSubIssue(input:{issueId:\"$PID\",subIssueId:\"$CID\"}){subIssue{number}}}"
gh label create GIT_N --color 0e8a16 2>/dev/null; gh issue edit N --add-label GIT_N; gh issue edit N+1 --add-label GIT_N
```

Parent body shape: Problem / Required behaviour (numbered) / Design constraint (cant-break-by-design)
/ Decided (dated, attributed to Gabe) / Tests required / Sites (file:line). Child body: "Context for the
parent (AI pickup)." then 5-8 bullets: ruling, today's cause with file:line, shape of the fix,
decisions, tests, worktree name.

### Labels

- `GIT_N` — the worktree/branch the pair lives in (on BOTH issues).
- `needs-input` — blocked on a decision from Gabe; the autonomous pass skips it. Add to both,
  comment on the child saying exactly what input is needed.
- Type labels in use: `bughunt`, `fixture-catalog`, `logging-residuals`, `debt`, `feature`, `perf`, `research`.

### Corrections and close-out

- A correction from Gabe edits BOTH the parent spec and the child context in the same step
  (`gh issue edit N --body-file ...`).
- Close-out: `gh issue close N --comment "Merged to main @ <sha>."`, then a short AI-condensed
  learnings comment on the child, then close the child.
- Commit messages carry `GIT_N` and end with `Co-Authored-By: Claude ... <noreply@anthropic.com>`.

### Worktree pairing

```bash
git worktree add .claude/worktrees/GIT_N -b GIT_N        # branch name == worktree name, no prefix
git commit -- <paths>                                     # explicit pathspecs, always
git merge --no-ff GIT_N && git push origin main           # only after the full battery is green
git worktree remove .claude/worktrees/GIT_N && git branch -d GIT_N
```
