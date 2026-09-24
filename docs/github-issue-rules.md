# GitHub issue rules (dwc-ng)

> SUPERSEDED (2026-09-02): the rules themselves moved to the machinery plugin format.
The GitHub-specific mechanics are now in
`.claude/rules/tracking-work.md` § Tracking work on GitHub.
The universal form is machinery plugin rules/work-tracking.md § A ticket and its companion.
This file keeps the COMMANDS that execute them, below, and stays the place to look for
those.

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
