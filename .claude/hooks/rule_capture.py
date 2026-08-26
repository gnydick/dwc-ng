#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""UserPromptSubmit hook: capture RULE:-marked prompts to docs/rule-inbox.md.

Ported from the sibling project (ferrislicer) 2026-08-26, unchanged in
mechanism: NO language matching, no regex phrase-guessing, no LLM
classification. The sole trigger is the explicit protocol mark — a prompt
whose first non-whitespace characters are `RULE:` (case-insensitive token,
still an exact protocol prefix, not inference). Marked prompts are appended
verbatim before the model responds; unmarked prompts are never stored.
Capture is mechanical: it happens even if the session ignores the rule or
dies mid-turn. `scripts/register_check.py` refuses (in --fast mode too) while
any entry is `Disposition: PENDING`.
"""
import datetime
import io
import json
import os
import sys


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    prompt = payload.get("prompt") or ""
    if not prompt.lstrip().lower().startswith("rule:"):
        return 0
    root = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    inbox = os.path.join(root, "docs", "rule-inbox.md")
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    session = payload.get("session_id") or "unknown-session"
    entry = "\n## %s %s\n\n%s\n\nDisposition: PENDING\n" % (stamp, session, prompt.strip())
    with io.open(inbox, "a", encoding="utf-8", newline="") as f:
        f.write(entry)
    # stdout becomes context for the turn
    print(
        "RULE captured verbatim to docs/rule-inbox.md (Disposition: PENDING). "
        "Run /rule-intake now: file it in docs/RULES-GROUPED.md citing a durable "
        "home, then set the entry's Disposition. "
        "python scripts/register_check.py --fast will fail until then."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
