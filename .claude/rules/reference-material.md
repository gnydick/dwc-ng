---
status: 🟢
---
# Reference material

Moved 2026-09-02 from CLAUDE.md § Reference source: read-only, never copy (HARD AND FAST
RULE) and § First tasks item 6; history stays there. Only the project-specific residue is
here — what actually counts as reference in this repo, and what it is pinned to. The ban
on copying, porting, transcribing, translating or paraphrasing any of it is universal and
is deliberately not restated: machinery plugin: rules/reference-sources.md § Reference only.

## What counts as reference here

- Everything under `reference/` is vendored third-party source, held read-only and marked
  excluded from builds: the official DuetWebControl source, `@duet3d/objectmodel`,
  `@duet3d/connectors`, and a verbatim M409 documentation snapshot. So is any installed
  dependency opened in order to study it (`@sindarius/gcodeviewer`, Babylon examples), and
  any code seen on a board, in a repository or on the web. Exact refs and provenance are
  in `reference/README.md`.
- The vendored set is pinned to the 3.6.3 line in the Duet3D repository ecosystem — an
  established project constraint, not a moving target: `@duet3d/objectmodel` 3.6.3,
  `@duet3d/connectors` 3.6.0 (its 3.6.x release), DuetWebControl v3.6.3. Updating means
  re-downloading at a new pinned ref, replacing the directory wholesale, and updating the
  provenance table in `reference/README.md`.
