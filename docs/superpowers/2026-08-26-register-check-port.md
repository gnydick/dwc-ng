# Porting the register-check governance mechanism from ferrislicer

Source: `C:\Users\Gabe E. Nydick\RustroverProjects\ferrislicer` (read-only,
untouched). Target: this repo, `main`, starting at `d0fa207`.

## What was kept, adapted, or dropped, and why

`scripts/register_check.py` — adapted, not a straight copy.

**Kept as-is (same mechanism, same meaning here):**
- `check_citations` — every `` `path:line` `` citation in a register row
  names a file that exists.
- `check_circles` — every intent-group header carries exactly one status
  circle; Solo headers none. Target register has no "Solo rules, by area"
  section yet; the check is forward-compatible with one.
- `check_stamps` — `SUPERSEDED` / `Supersedes:` bidirectionality. The
  citation format (`` see docs/RULES-GROUPED.md § <group> ``) is byte-for-byte
  what this project's own register contract already specifies, so nothing
  needed adjusting.
- `check_inbox` — `docs/rule-inbox.md`, if present, has no
  `Disposition: PENDING` entry. Same filename as source.
- `check_claude_citations` (bans bare `CLAUDE.md:NNN`), `check_section_citations`
  (generic `<path>.md` § heading resolution, prefix-matched),
  `check_blank_line_citations` (a `path:line` citation landing on a blank
  line), and the two advisory scans (`advisory_nongreen`,
  `advisory_drift`) — all path-generic, kept unchanged.

**Dropped: `check_invariant_anchors` (the source's check #4).** Source
resolves `Enforcement: docs/INVARIANTS.md §N.M` against `## N.M` headings in
`docs/INVARIANTS.md`. This project's enforcement ledger is
`docs/invariant-register.md` instead — a **generated** file
("DO NOT EDIT", built by `packages/invariants`) whose headings are `## <domain>`
and `` ### `<invariant-name>` — rung N ``, never a `## N.M` numeric scheme, and
the current register has zero `Enforcement:`-style citations into it. Porting
the numeric-anchor check verbatim would produce a check that can **never
fail** here — no citation could ever match its `§N.M` form, because the
heading shape it resolves against doesn't exist in this file — which is
exactly the "checker that always passes" the task warned against. It is
omitted, not adapted, and the module docstring says so.

What replaces its coverage: `check_section_citations` is already
path-generic (it was written to check `<path>.md § <heading>` for *any*
markdown file, not just `CLAUDE.md`), so a future register row citing
`` `docs/invariant-register.md` § <invariant-name> `` is verified by the same
mechanism that verifies `CLAUDE.md` citations — nothing was lost, the
dedicated numeric-anchor check just had nothing to do here. One deliberate
behavior change from source: source's `check_section_citations` **skips**
citations that look like a bare numeric anchor (`§7.2`) that fail to resolve,
because in ferrislicer another dedicated check (the one just described) owns
verifying those. Since that second check doesn't exist in this port, I made
the numeric-anchor branch here **fail** instead of silently skip — otherwise
a mistyped numeric-style citation would pass silently forever, the same trap
being avoided. Search this file for `NUMERIC_ANCHOR_RE` to see the exact
change (`check_section_citations`).

`rule_nudge.py` — **ported**, adapted only in `RULE_BEARING`: source's
`docs/INVARIANTS.md` and `docs/refactors/` don't exist here, so they were
replaced with `docs/invariant-register.md` and dropped respectively (the
latter isn't invented — this repo has no `docs/refactors/`). Worth porting
because it's the cheapest, lowest-risk layer of the three-layer governance
chain: it never blocks (advisory `print` only, swallows all errors), it
directly enforces the "same commit" rule already stated in this project's own
`docs/RULES-GROUPED.md` § "Maintaining this file (the contract)", and it
costs one `git status --porcelain` call gated behind a path-prefix check that
returns instantly for the overwhelming majority of edits (anything outside
`CLAUDE.md`, `docs/invariant-register.md`, `docs/superpowers/specs/`).

## The hook and what it does on a `RULE:` prompt

`.claude/hooks/rule_capture.py` — ported essentially verbatim (no
project-specific paths in the source version; comments updated to reference
`scripts/register_check.py` instead of a nonexistent pre-commit gate). On a
`UserPromptSubmit` event: if the prompt's first non-whitespace characters
are `RULE:` (case-insensitive, exact protocol prefix — no language matching,
no LLM classification, matching Gabe's ferrislicer ruling of 2026-08-15),
it appends a timestamped, verbatim entry to `docs/rule-inbox.md` with
`Disposition: PENDING`, and prints a message telling the user it did and
that `/rule-intake` should run next. Any other prompt is a no-op. Verified
live (see Falsification below) — a `RULE:`-prefixed stdin payload produced
the expected inbox entry and stdout message; a plain prompt produced neither.

## Wiring

Both hooks are wired in `.claude/settings.local.json` (this project's actual
settings file — there is no committed `.claude/settings.json` here at all,
unlike ferrislicer, so this is the only place hooks live today):
- `UserPromptSubmit` → `rule_capture.py`
- `PostToolUse` (matcher `Edit|Write`) → `rule_nudge.py`
- `SessionStart` → an echo reminding the session of the `RULE:` protocol,
  reworded from source to not claim commits are blocked (see below)

**Concern:** `.claude/settings.local.json` is gitignored
(`.gitignore:26`). This wiring is local to this checkout/user and will not
propagate through git the way source's committed `.claude/settings.json`
does. That's a straight consequence of the task naming this file
specifically, and it matches how every other hook in this project (e.g.
`quiet_hook.py`) is currently wired — but it means a fresh clone gets no
governance hooks until someone wires them again. Flagging for Gabe rather
than deciding it silently: worth a committed `.claude/settings.json` at some
point if this should survive clones.

## Pre-commit: no clean path exists here, so nothing was wired

Checked directly, not assumed:
- `git config --get core.hooksPath` → unset (source project sets it to
  `.githooks`, which is where its `pre-commit` script lives).
- `.git/hooks/` here has only the stock `*.sample` files — nothing active.
- No `.github/` directory anywhere in this repo — no CI at all.
- No husky / lint-staged / simple-git-hooks in `package.json` or
  `pnpm-workspace.yaml`.

**How the existing invariants gate actually runs**, since the task named it
as the precedent to follow: `packages/invariants` has `generate`/`check`
scripts (`pnpm --filter @dwc-ng/invariants check`), and its enforcement is a
`node:test` file, `packages/invariants/test/gate.test.ts`, exercised by that
package's own `pnpm test` — which the root `test` script fans out to via
`pnpm -r --if-present test`. There is no hook or CI invoking any of this
automatically. CLAUDE.md says the same thing explicitly about the sibling
scaling lint: "enforced by a test-suite-failing px lint (... `pnpm test`,
not `pnpm build`; there is no CI or hook running it yet)". That is the
established precedent in this repo: gates are real, are run through
`pnpm`/manual invocation, and are **not yet** wired to anything that runs
automatically.

Following that precedent rather than inventing a parallel one: no
`.githooks/pre-commit`, no `core.hooksPath` change, no fabricated CI
workflow. Instead, `register_check.py` was exposed the same way
`packages/invariants` exposes its own gate — as plain `pnpm` scripts at the
root (`pnpm register:check`, `pnpm register:check:fast`), for manual
invocation now and for CI to pick up later if one is ever added.
`.claude/skills/rule-intake/SKILL.md` step 5 says outright that nothing
blocks the commit mechanically today, and to run the full check by hand
before calling a filing done. `docs/rule-inbox.md`'s existence was corrected
in `.claude/hooks/rule_capture.py`'s own printed message and in the
`SessionStart` echo to say "`register_check.py --fast` will fail" rather
than "commits are blocked" — the latter would have been the exact class of
unfalsified-precedent claim this whole mechanism exists to catch.

## Falsification — proved the checker can fail, then reverted

All commands run from `N:\ideaprojects\dwc-ng`.

**Baseline, both modes green:**
```
$ python scripts/register_check.py
register_check: 0 citation files, 2 groups, 0 errors
$ python scripts/register_check.py --fast
register_check: 0 citation files, 2 groups, 0 errors (fast)
```

**Introduced three real violations** (backed up `docs/RULES-GROUPED.md`
first):
1. Added a table row citing `` `docs/does-not-exist.md:5` ``.
2. Changed a group header from `## Acting outside the working tree 🟢` to
   `## Acting outside the working tree 🟢🔴` (two circles).
3. Created `docs/rule-inbox.md` with a `Disposition: PENDING` entry.

**Full mode caught all three** (after fixing a real bug the test itself
surfaced — see below):
```
$ python scripts/register_check.py
FAIL: citation names missing file: docs/does-not-exist.md
FAIL: line 85: group header needs exactly one circle, has 2: Acting outside the working tree 🟢🔴
FAIL: docs/rule-inbox.md:5: undispositioned entry (file it in the register via /rule-intake, or mark 'not a rule - <reason>')
register_check: 1 citation files, 1 groups, 3 errors
EXIT:1
```

**`--fast` caught two of three** (circle-count content check is
intentionally skipped in fast mode, matching source's own fast/full split):
```
$ python scripts/register_check.py --fast
FAIL: citation names missing file: docs/does-not-exist.md
FAIL: docs/rule-inbox.md:5: undispositioned entry ...
register_check: 1 citation files, 1 groups, 2 errors (fast)
EXIT:1
```

**A genuine bug the falsification test caught, not staged on purpose:** the
first full-mode run crashed instead of printing the circle-count FAIL line —
`UnicodeEncodeError: 'charmap' codec can't encode` — because this Windows
Python session's stdout defaults to cp1252, which cannot encode the 🟢/🔴
emoji embedded in the error message the checker was trying to print. Fixed
by reconfiguring `sys.stdout`/`sys.stderr` to UTF-8 at import time (guarded
with `try/except AttributeError` for streams where `.reconfigure` doesn't
exist). This is exactly the class of thing "verify by running it" is for —
the source script never surfaces this on the platform it was written on.

**Reverted** (`mv` the backup back over the live file, `rm` the test
inbox), confirmed both modes green again:
```
$ python scripts/register_check.py
register_check: 0 citation files, 2 groups, 0 errors
$ python scripts/register_check.py --fast
register_check: 0 citation files, 2 groups, 0 errors (fast)
$ git status --porcelain
?? scripts/
```
(only the new, not-yet-committed `scripts/` directory — the register and
inbox were left exactly as found).

Also exercised the hooks directly (not just the checker):
- `RULE:`-prefixed stdin → appended entry to `docs/rule-inbox.md`,
  `register_check.py --fast` immediately reported it, printed the expected
  message. Non-`RULE:` stdin → no file write, exit 0, no output.
- `rule_nudge.py` on `CLAUDE.md` with no staged register change → printed
  the nudge. On an unrelated file (`packages/ui/src/App.tsx`) → silent,
  exit 0.
- Test inbox entry removed afterward; register confirmed clean.

## Files added / changed

- `scripts/register_check.py` (new)
- `.claude/hooks/rule_capture.py` (new)
- `.claude/hooks/rule_nudge.py` (new)
- `.claude/skills/rule-intake/SKILL.md` (new)
- `.claude/settings.local.json` (edited — gitignored, see Concern above)
- `package.json` (edited — added `register:check` / `register:check:fast`)
- `docs/superpowers/2026-08-26-register-check-port.md` (this file)

## Concerns

1. `.claude/settings.local.json` is gitignored — the hook wiring will not
   reach a fresh clone or another machine. See Wiring section above.
2. No pre-commit or CI actually stops a bad register from being committed.
   This matches this project's existing precedent for its other gates, but
   it is a materially weaker guarantee than ferrislicer has today (its
   `.githooks/pre-commit` genuinely blocks). If Gabe wants a real block,
   the smallest correct step given the precedent found here would be
   opting `core.hooksPath` into a checked-in `.githooks/` the same way
   ferrislicer does — a bigger decision than this task's scope, flagged
   rather than taken.
3. `check_section_citations`'s numeric-anchor branch now reports a FAIL
   where source silently skips (see above) — a deliberate tightening, not
   a bug, but worth Gabe's eyes since it diverges from source behavior.
4. `rule_nudge.py` will nudge on any edit to `docs/invariant-register.md`
   even though that file is generated and shouldn't be hand-edited in the
   first place; the nudge message ("update the register") is slightly the
   wrong message in that specific case (the right fix is "regenerate", not
   "cite it"), but it's harmless — advisory-only, and a hand-edit to a
   DO-NOT-EDIT generated file is itself the primary problem there.
