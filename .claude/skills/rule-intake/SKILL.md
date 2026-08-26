---
name: rule-intake
description: File a dictated or discovered rule into the design-decision register (docs/RULES-GROUPED.md) — finds the group it joins or the entry it supersedes, writes the durable home first, and dispositions the rule-inbox entry. Use immediately when a RULE:-marked prompt is captured, when scripts/register_check.py reports a PENDING inbox entry, or when any change adds/changes/supersedes a standing rule.
---

# Rule intake

**Trust property, stated first: this skill is NOT load-bearing, and only Gabe
adjudicates a rule.** This skill PREPARES a filing — it never self-files.
Capture is a hook (`.claude/hooks/rule_capture.py`); the machine checks are
`scripts/register_check.py`. If this skill never runs, no rule is silently
lost — the inbox entry just sits `Disposition: PENDING` and
`register_check.py --fast` keeps reporting it. **There is no pre-commit hook
in this project enforcing that today** (see
`docs/superpowers/2026-08-26-register-check-port.md` for why: this repo's
existing gates — the invariants ledger, the unit-lengths lint — are also run
by hand or via `pnpm test`, not by a git hook or CI, and this port followed
that precedent rather than inventing a new one). Running the check and acting
on it is still a discipline this skill exists to make easy to follow, not one
the tooling can force yet.

The register CITES, it never ORIGINATES. Every step below either writes the
rule to its durable home or points the register at that home — never the
reverse.

## The steps — in order, none skipped

1. **Write it down first (durable home).** Land the rule where it lives:
   - process / working-agreement hard rules → `CLAUDE.md` § "Working rules
     (verification discipline)" (add a new bullet there, or a new subsection
     if it doesn't fit an existing one)
   - engine/design rules specific to one subsystem's build → the active spec
     under `docs/superpowers/specs/` that owns that subsystem's design
   - enforcement-strength claims (rungs) → these are declared beside the
     mechanism in source (`@invariant` blocks) and regenerated into
     `docs/invariant-register.md`; this skill does not hand-edit that file.
   The register row will cite this durable home **by section** (`` `CLAUDE.md`
   § <heading> `` or `` `<spec path>` § <heading> ``) — never by line number.
   A line cites a position, and any insert above it silently retargets the
   row; `scripts/register_check.py` enforces this for `CLAUDE.md` and checks
   that every section citation actually resolves to a heading, for any file.

2. **Candidate search (token-cheap).** Read only the register's Contents list
   and the summaries of plausible groups; grep the register body for the
   rule's key nouns. Shortlist at most 2–3 candidate groups. Present the
   shortlist to Gabe with a one-line reason each.

3. **Conflict check.** For each candidate: does the new rule AGREE, REFINE, or
   CONTRADICT the group's standing? A contradiction IS a wobble — and a rule
   Gabe dictated is an adjudication: update "The wobble / Where it ended"
   with the new verdict, flip the circle (🟢 unless Gabe marks it tentative),
   and stamp any doc carrying the losing rule per the supersession protocol
   in the register's own "Maintaining this file (the contract)" section —
   `> SUPERSEDED (YYYY-MM-DD): see docs/RULES-GROUPED.md § <group>` on the old
   doc, a `Supersedes:` line on the new row, same commit, both directions
   (`scripts/register_check.py` checks both).

4. **Placement.**
   - Fits an existing group → append a row: `| <today> | <rule, one sentence>
     | \`<durable-home file>\` § <heading> |`.
   - No fitting group, but related Solo rules exist → promote them together
     into a NEW group with a summary and status circle.
   - No siblings → a row under a "Solo rules, by area" section (create it,
     with no circle on its own header, if this is the first solo rule).

5. **Disposition + same commit.** Replace the inbox entry's
   `Disposition: PENDING` with `Disposition: filed — <group> (<durable-home
   file § heading>)` (or `not a rule — <reason>` if Gabe dismisses it).
   Commit the durable home, the register, and the inbox together. Run
   `python scripts/register_check.py` (full mode, not just `--fast`) before
   calling it done — it is not wired to block the commit automatically here,
   so this step is the only thing that catches a bad filing.

## Red flags

- "I'll note it in the register only" — no: durable home first, register cites.
- "This obviously supersedes X" — supersession is Gabe's call when the losing
  rule was ever his; propose, don't presume.
- "The inbox entry can wait" — file it or dismiss it with a reason; don't
  leave it `PENDING` across a commit just because nothing is mechanically
  stopping you.
