import os from 'node:os';
import path from 'node:path';

// The machinery layout: the one spelling of every file name that more than one unit has to name,
// and the one test of whether a filed path lives inside the spec area.
//
// Two units name these files and neither can import the other: lib/config.mjs resolves paths for
// the hooks and the intake, and gate/gate.mjs builds its own layout because it ships standalone into
// an adopting project and must not point back at the plugin cache (spec I6). A name spelled in two
// places is a name that can drift, so it is declared once here and both read it. The generated rule
// and spec indexes are gone (recalibration decision 10); the gate checks the inboxes only.
export const INBOX = 'inbox.md';
export const SPEC_INBOX = 'spec-inbox.md';
// The user's universal rules (STATUS 54): a URULE is universal for the USER, so it files into
// ~/.claude/rules/universal.md — Claude Code's per-user always-loaded location, which reaches
// subagents through the CLAUDE.md hierarchy and survives uninstalling the plugin — and its inbox is
// ~/.claude/machinery/inbox.md. Neither is configurable and nothing points back at the plugin; the
// plugin's core.md and skills change only by editing the repo. The home is resolved HERE, once:
// MACHINERY_HOME is the test suites' throwaway home, and every reader of it goes through userHome().
export const UNIVERSAL_RULES = 'universal.md';
// Its one heading: install.mjs seeds the file with it (owner, 2026-09-15) and intake.mjs files each
// URULE under it, so the two must agree — a title place.mjs does not find is a section it appends.
export const UNIVERSAL_HEADING = '# Universal rules';
export const userHome = () => process.env.MACHINERY_HOME || os.homedir();
export const userInbox = (home) => path.join(home, '.claude', MACHINERY_DIR, INBOX);
export const userRules = (home) => path.join(home, '.claude', RULES_DIR, UNIVERSAL_RULES);
// Issue tracking configuration (docs/superpowers/specs/2026-09-12-issue-tracking-config-design.md).
// Two files hold the developer's one answer about where issue tracking lives. Three units name them
// and none can import another — install.mjs seeds them, lib/issue-tracking.mjs reads them through
// config.mjs, intake.mjs routes to one — which is the condition this file exists for.
//
// The NAMES are the owner's, verbatim, underscores included; renaming them to kebab-case is a change
// to what the owner dictated, not a tidy-up.
//
// The STATE WORDS: UNANSWERED means install seeded the file and nobody has been asked (an empty file
// reads the same); NONE means asked and answered, no issue tracking here. They are distinct states,
// neither merged into the other nor into absence of the file. Install writes the word and the
// precedence function compares against it, so a mismatch between the two would fail SILENTLY.
export const GLOBAL_ISSUE_TRACKING = 'global_issue_tracking.md';
export const PROJECT_ISSUE_TRACKING = 'project_issue_tracking.md';
export const UNANSWERED = 'unanswered';
export const NONE = 'none';
// Project-relative directories. Captured specifications persist at ONE fixed, known location —
// `docs/dictated-specs` at the project root — and nothing resolves, declares or guesses it per
// project (owner, 2026-09-07: "we just need a unique location to persist those specs", then "i
// don't want specs under .claude/rules i want docs/dicatated-specs", read as `dictated-specs`
// because the string becomes a path). The name matches the vocabulary the rules already use: a
// specification handed down is dictated, exactly as a standing rule is. It is machinery's own
// ground and not another plugin's — in particular not `docs/superpowers/`, where this repo's own
// machinery specification currently sits ("i don't want to mix with superpowers necessarily").
//
// This is not a fabricated default. What is forbidden is guessing at a setting whose absence
// means "inherit the project's own
// arrangement". This is machinery's own storage, the same kind of fact as
// `.claude/machinery/inbox.md`, which nobody declares either.
//
// WHAT THIS LOCATION IS NOT: auto-loaded. `docs/` is not under `.claude/`, so nothing puts a filed
// specification into a session's context. Making one reach a session is a separate piece of work
// (#81 Part 4) and no code, comment or test here may assume it happens.
export const RULES_DIR = 'rules';
export const DOCS_DIR = 'docs';
export const SPECS_DIR = 'dictated-specs';
export const MACHINERY_DIR = 'machinery';
// The project's recorded settings (recalibration decisions 22, 39, 41): written by setup.mjs
// through lib/settings.mjs, read by the hooks and skills that need an answer.
export const CONFIG = 'config.json';

// The disposition vocabulary for a filed specification (#81). Both the gate leg that refuses a bad
// filing and the intake that writes one need this test, and neither depends on the other, so it
// lives here rather than in either — a shared definition in a unit with no dependencies of its
// own. Two call sites spelling the containment test themselves is exactly how they drift apart.

// The path half of a `filed → <path> § <Section>` disposition, or null when the disposition is not
// a filing at all (a dismissal, or a line no writer of ours produced).
export function filedPath(disposition) {
  const m = /^filed\s*→\s*(.+)$/.exec(String(disposition ?? '').trim());
  if (!m) return null;
  const p = m[1].split(' § ')[0].trim();
  return p || null;
}

// True when `p`, as written in a disposition, names something under the project's spec area. A
// containment test, not an existence test: this judges where a specification was filed, never
// whether that file happens to be on this machine right now.
export function insideSpecArea(root, specsDir, p) {
  const toPosix = (s) => s.split(path.sep).join('/');
  const rel = toPosix(path.relative(root, specsDir)) + '/';
  const q = toPosix(path.isAbsolute(p) ? path.relative(root, p) : p).replace(/^\.\//, '');
  return q.startsWith(rel) && !q.split('/').includes('..');
}
