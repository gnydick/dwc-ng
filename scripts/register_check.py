#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Machine checks for the design-decision register (docs/RULES-GROUPED.md).

Ported from the sibling project (ferrislicer) 2026-08-26. That project's
enforcement ledger is docs/INVARIANTS.md, with `## N.M` headings and
`Enforcement: docs/INVARIANTS.md §N.M` citations resolved by a dedicated
numeric-anchor check. This project's enforcement ledger is
docs/invariant-register.md instead: it is GENERATED (`packages/invariants`,
"DO NOT EDIT"), and its headings are `## <domain>` and
"### `<invariant-name>` -- rung N" -- there is no `## N.M` numeric scheme.
Porting the numeric-anchor check verbatim would produce a check that can
never fail here (no citation could ever use its `§N.M` form, because the
headings it would resolve against don't exist), which proves nothing. It is
therefore DROPPED, not adapted. General section citations of the form
`<path>.md` § <heading> — including into docs/invariant-register.md — are
still verified, by check_section_citations below, against that file's real
headings.

Blocking checks (exit 1 on any failure):
  1. Every rule-row citation (`path:line` in a table's Source column) names a file
     that exists. Line drift is tolerated; existence is the gate.
  2. Every `<path>.md` § <heading> citation (CLAUDE.md, docs/invariant-register.md,
     specs, ...) resolves to a real heading in that file, prefix-matched (a row
     may cite "Working rules (verification discipline)" while the heading reads
     "## Working rules (verification discipline)", and rows routinely append a
     ticket or trailing prose).
  3. CLAUDE.md is cited by SECTION only, never by line (`CLAUDE.md:123` fails):
     a line number cites a POSITION, and any insert above it silently retargets
     the row.
  4. A `path:line` citation that lands on a BLANK line is caught (the file
     exists, check 1 above is satisfied, but the line points at nothing).
  5. Every intent-group header carries exactly one status circle; Solo headers
     none.
  6. Stamp bidirectionality:
       - every `> SUPERSEDED` stamp under docs/ names a register group that exists;
       - every register `Supersedes:` line with a backticked path names an existing
         file that carries a `> SUPERSEDED` stamp pointing back at the register.
  7. docs/rule-inbox.md (if present) has no `Disposition: PENDING` entry.

Advisory output (never affects exit code):
  - yellow/red groups without a GitHub issue reference (deferred until the
    adjudication workstream files them);
  - with --drift FILE..., rule-marker lines in those files not cited by any
    register row.

Modes: --fast runs checks 1, 3, 4, 5 (stamps), 6, 7 -- everything except the
group-circle content check and the advisory issue-reference scan, for
pre-commit latency. Default runs all of the above plus the nongreen advisory.
"""
import io
import os
import re
import sys

# Windows consoles default stdout/stderr to cp1252, which cannot encode the
# status-circle emoji this file prints in FAIL lines (group headers, register
# prose). Reconfigure explicitly rather than letting a print() of a perfectly
# valid error message crash the checker itself. reconfigure() is Python 3.7+;
# guarded because it is not present on every stream (e.g. when stdout is
# replaced by a test harness).
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except AttributeError:
        pass

REPO = os.environ.get(
    "REGISTER_CHECK_ROOT",
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
)
REGISTER = os.path.join(REPO, "docs", "RULES-GROUPED.md")
INBOX = os.path.join(REPO, "docs", "rule-inbox.md")
CIRCLES = ("\U0001F7E2", "\U0001F7E1", "\U0001F534")  # green, yellow, red
NONGREEN = ("\U0001F7E1", "\U0001F534")

CITE_RE = re.compile(r"\(`([^`]+?):(\d+)`\)|\| `([^`]+?):(\d+)` \|")
SUPERSEDES_PATH_RE = re.compile(r"^Supersedes: .*?`([^`]+)`")
STAMP_RE = re.compile(r"^> SUPERSEDED")
MARKER_RE = re.compile(r"HARD RULE|by construction|\bnever\b|\bmust\b", re.I)
# `<path>` § <heading> — the drift-proof citation form. A line number moves every
# time the cited file gains a line above it; a heading does not.
SECTION_CITE_RE = re.compile(r"`([^`\n]+?\.md)`\s*§\s*([^|\n]+)")
CLAUDE_LINE_CITE_RE = re.compile(r"`CLAUDE\.md:(\d+)`")
HEADING_RE = re.compile(r"^#{1,6}\s+(.+?)\s*$", re.M)
FENCE_RE = re.compile(r"^\s*(```|~~~)")
# a bare address into a doc that has its own gate: "7.2", "4.1.9a5", "8 Anchor on..."
NUMERIC_ANCHOR_RE = re.compile(r"^\d+(\.\d+)*[a-z]?\b")


def headings(text):
    """Heading texts, ignoring anything inside a fenced code block.

    A fenced snippet line that happens to start with `#` (a C macro, a shell
    comment quoted in a fence) matches a markdown heading exactly but is not
    a section; found while repairing blank-line citations in the source
    project, where such a line could have "resolved" a citation by accident.
    """
    out, fenced = [], False
    for line in text.splitlines():
        if FENCE_RE.match(line):
            fenced = not fenced
            continue
        if fenced:
            continue
        m = HEADING_RE.match(line)
        if m:
            out.append(m.group(1).strip())
    return out


def read(path):
    with io.open(path, "r", encoding="utf-8") as f:
        return f.read()


def check_citations(reg_text, errors):
    seen = set()
    for m in CITE_RE.finditer(reg_text):
        path = m.group(1) or m.group(3)
        if path in seen:
            continue
        seen.add(path)
        if not os.path.isfile(os.path.join(REPO, path)):
            errors.append("citation names missing file: %s" % path)
    return len(seen)


def check_circles(reg_lines, errors):
    in_solo = False
    groups, nongreen = [], []
    for i, line in enumerate(reg_lines, 1):
        if line.startswith("# Solo rules, by area"):
            in_solo = True
            continue
        if not line.startswith("## "):
            continue
        title = line[3:].strip()
        if title in ("Contents", "Maintaining this file (the contract)"):
            continue
        n = sum(title.count(c) for c in CIRCLES)
        if in_solo:
            if n:
                errors.append("line %d: Solo header carries a circle: %s" % (i, title))
        else:
            if n != 1:
                errors.append(
                    "line %d: group header needs exactly one circle, has %d: %s"
                    % (i, n, title)
                )
            else:
                name = title
                for c in CIRCLES:
                    name = name.replace(c, "")
                groups.append(name.strip())
                if any(c in title for c in NONGREEN):
                    nongreen.append((name.strip(), title))
    return groups, nongreen


def check_stamps(reg_text, groups, errors):
    # every stamp in docs/ points at a real register group
    stamped_files = {}
    for root, dirs, files in os.walk(os.path.join(REPO, "docs")):
        for fn in files:
            if not fn.endswith(".md"):
                continue
            fp = os.path.join(root, fn)
            rel = os.path.relpath(fp, REPO).replace(os.sep, "/")
            if rel == "docs/RULES-GROUPED.md":
                continue
            for line in read(fp).splitlines():
                if STAMP_RE.match(line):
                    stamped_files.setdefault(rel, []).append(line)
    # stamps may wrap onto continuation lines; join per-file stamp blocks
    for rel, lines in stamped_files.items():
        text = read(os.path.join(REPO, rel))
        block = []
        for line in text.splitlines():
            if line.startswith("> "):
                block.append(line[2:])
            elif block:
                break
        joined = " ".join(block)
        if "docs/RULES-GROUPED.md" not in joined:
            errors.append("%s: SUPERSEDED stamp does not cite the register" % rel)
            continue
        m = re.search(r"docs/RULES-GROUPED\.md § (.+?)\s*$", joined)
        if not m:
            errors.append("%s: stamp cites register without a '§ <group>'" % rel)
        elif m.group(1).strip() not in groups:
            errors.append(
                "%s: stamp names unknown register group: %s" % (rel, m.group(1).strip())
            )
    # every backticked Supersedes path exists and carries a stamp
    for line in reg_text.splitlines():
        m = SUPERSEDES_PATH_RE.match(line)
        if not m:
            continue
        path = m.group(1)
        full = os.path.join(REPO, path)
        if not os.path.isfile(full):
            errors.append("Supersedes names missing file: %s" % path)
        elif path not in stamped_files:
            errors.append("Supersedes target lacks a SUPERSEDED stamp: %s" % path)


def table_rows(reg_text):
    """Only the rule TABLES, never the prose around them.

    A citation lives in a row's Source column. The maintenance-contract header
    DOCUMENTS the citation format, so scanning prose makes the contract fail the
    rule it states — which is exactly how this function came to exist in the
    source project. Same shape as check_inbox requiring column 0 so the
    inbox header's own example does not read as a live entry.
    """
    return "\n".join(l for l in reg_text.splitlines() if l.lstrip().startswith("|"))


def check_claude_citations(reg_text, errors):
    """CLAUDE.md is cited by SECTION, never by line number.

    The source project measured this directly (2026-08-26, ferrislicer):
    across 22 bare `CLAUDE.md:NNN` rows, 4 pointed at a blank line and 2 named
    the wrong rule outright, yet all 22 passed a checker that only tested
    file existence. A line number does not cite a rule, it cites a POSITION,
    and every insert above it silently retargets the row. This project's
    register contract (docs/RULES-GROUPED.md § "Maintaining this file (the
    contract)") states the same rule for CLAUDE.md specifically, so it is
    enforced the same way here.
    """
    for m in CLAUDE_LINE_CITE_RE.finditer(table_rows(reg_text)):
        errors.append(
            "bare line citation `CLAUDE.md:%s` — cite the section instead: "
            "`CLAUDE.md` § <Section heading>" % m.group(1)
        )


def check_section_citations(reg_text, errors):
    """Every `<path>` § <heading> citation resolves to a real heading.

    Prefix match, not equality: a row may legitimately cite "Working rules
    (verification discipline)" where the heading reads "## Working rules
    (verification discipline)", and rows routinely append a ticket or trailing
    prose after the heading. Numeric anchors into a doc that has its own gate
    are skipped here rather than half-checked (this project has no such doc
    today; docs/invariant-register.md headings are invariant names, not
    numbers, so nothing currently exercises that skip path).
    """
    cache = {}
    for m in SECTION_CITE_RE.finditer(table_rows(reg_text)):
        path, cited = m.group(1), m.group(2).strip()
        if not cited:
            continue
        if path not in cache:
            full = os.path.join(REPO, path)
            cache[path] = headings(read(full)) if os.path.isfile(full) else None
        heads = cache[path]
        if heads is None:
            # NOT check_citations' job: a file cited ONLY in section form
            # (CLAUDE.md, docs/invariant-register.md) never matches CITE_RE,
            # so skipping here would let its deletion pass both checks unseen.
            errors.append("section citation names missing file: %s" % path)
            continue
        if any(h.startswith(cited) or cited.startswith(h) for h in heads):
            continue
        # Resolve FIRST, skip second. A numbered heading and a pure numeric
        # anchor are the same shape, so a numbered citation is verified when
        # it RESOLVES and skipped when it does not.
        if NUMERIC_ANCHOR_RE.match(cited):
            errors.append(
                "%s § %s names no heading in that file (numeric anchor, not "
                "independently verified)" % (path, cited[:60])
            )
            continue
        errors.append("%s § %s names no heading in that file" % (path, cited[:60]))


def check_blank_line_citations(reg_text, errors):
    """A `path:NNN` citation landing on a BLANK line points at nothing.

    Blocking: a blank line is not a weak citation, it is the absence of one.
    Currently a no-op here — this register's citations use the § section
    form exclusively (per its own contract) — but it stays live for any
    future `path:line` citation into a doc that has no section gate of its
    own (a spec, a plan) rather than being ported as dead code.
    """
    notes, seen = [], set()
    for m in CITE_RE.finditer(reg_text):
        path = m.group(1) or m.group(3)
        n = int(m.group(2) or m.group(4))
        if (path, n) in seen or not path.endswith(".md"):
            continue
        seen.add((path, n))
        full = os.path.join(REPO, path)
        if not os.path.isfile(full):
            continue
        body = read(full).splitlines()
        if n <= len(body) and not body[n - 1].strip():
            notes.append(
                "%s:%d cites a BLANK line — point it at the rule, or better, "
                "cite `%s` § <Section>" % (path, n, path)
            )
    errors.extend(notes)


def check_inbox(errors):
    if not os.path.isfile(INBOX):
        return
    for i, line in enumerate(read(INBOX).splitlines(), 1):
        # column-0 only: the inbox header documents the format inside an
        # indented example block, which must not read as a live entry
        if line.rstrip() == "Disposition: PENDING":
            errors.append(
                "docs/rule-inbox.md:%d: undispositioned entry (file it in the "
                "register via /rule-intake, or mark 'not a rule - <reason>')" % i
            )


def advisory_nongreen(reg_text, nongreen):
    notes = []
    for name, title in nongreen:
        idx = reg_text.find(title)
        tail = reg_text[idx : idx + 2000]
        if not re.search(r"#\d{2,4}", tail):
            notes.append("non-green group without an issue reference: %s" % name)
    return notes


def advisory_drift(reg_text, files):
    cited_lines = set()
    for m in CITE_RE.finditer(reg_text):
        cited_lines.add(m.group(1) or m.group(3))
    notes = []
    for path in files:
        rel = os.path.relpath(os.path.abspath(path), REPO).replace(os.sep, "/")
        if not os.path.isfile(path) or not path.endswith(".md"):
            continue
        for i, line in enumerate(read(path).splitlines(), 1):
            if MARKER_RE.search(line) and rel not in cited_lines:
                notes.append("%s:%d: rule-marker line in uncited file" % (rel, i))
                break  # one note per file is enough
    return notes


def main(argv):
    fast = "--fast" in argv
    drift_files = []
    if "--drift" in argv:
        drift_files = argv[argv.index("--drift") + 1 :]
    if not os.path.isfile(REGISTER):
        print("FAIL: register missing: docs/RULES-GROUPED.md")
        return 1
    reg_text = read(REGISTER)
    reg_lines = reg_text.splitlines()
    errors = []
    n = check_citations(reg_text, errors)
    check_claude_citations(reg_text, errors)
    check_section_citations(reg_text, errors)
    check_blank_line_citations(reg_text, errors)
    groups, nongreen = check_circles(reg_lines, errors if not fast else [])
    check_stamps(reg_text, groups, errors)
    check_inbox(errors)
    for e in errors:
        print("FAIL:", e)
    print(
        "register_check: %d citation files, %d groups, %d errors%s"
        % (n, len(groups), len(errors), " (fast)" if fast else "")
    )
    if not fast:
        for note in advisory_nongreen(reg_text, nongreen):
            print("ADVISORY:", note)
    for note in advisory_drift(reg_text, drift_files):
        print("ADVISORY:", note)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
