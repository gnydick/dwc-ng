#!/usr/bin/env node
// Story: gates/commit-gate.md. Runs on EVERY commit (ruled), check-only, cheap.
//
// The check list is a closed array (spec I24): nothing can extend it at run time. Since #73 that
// array is GENERATED into ./manifest.mjs from the `declaration` each check module exports, and the
// build check regenerates and fails on drift — so a hand-edit is a stale generated file rather than
// a silent divergence, and there is still no configuration point of any kind. Every check the gate
// runs is in that one array, blocking and advisory alike: the manifest is the whole truth about
// what runs.
//
// `--merge` is declared surface with no reader: it is parsed and handed to every check in the
// context below, and no wired check reads it today. It stays because the merge step invokes the
// gate with it.
import path from 'node:path';
import { CHECKS } from './manifest.mjs';
import { projectRoot } from './lib/root.mjs';
// File names come from the one place that spells them (#81). This module builds its own layout
// rather than importing lib/config.mjs because it ships standalone into an adopting project and
// must never point back at the plugin cache (spec I6) — but the NAMES are still declared once.
import { SPEC_INBOX, INBOX, DOCS_DIR, SPECS_DIR, MACHINERY_DIR, userHome, userInbox } from './lib/layout.mjs';

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const mergeMode = argv.includes('--merge');
const root = opt('--root') ? path.resolve(opt('--root')) : projectRoot(process.cwd());

// The spec half is the rule half's mirror (#81, owner ruling 2026-09-07: "make spec: work just like
// rules"): its own area and its own inbox. The generated indexes are gone (recalibration decision
// 10). The user's inbox (STATUS 54) is read beside the project's: a universal rule is the user's,
// captured to ~/.claude/machinery/inbox.md, and an unfiled one blocks a commit in any project. The
// plugin has no inbox of its own, so there is no plugin-layout mode.
const layout = {
  inbox: path.join(root, '.claude', MACHINERY_DIR, INBOX),
  userInbox: userInbox(userHome()),
  specsDir: path.join(root, DOCS_DIR, SPECS_DIR),
  specInbox: path.join(root, '.claude', MACHINERY_DIR, SPEC_INBOX),
};

// One context, handed to every check. Each check destructures what it needs, so the manifest can
// generate a uniform call and a new leg slots into the closed list without changing this loop.
const ctx = { ...layout, root, mergeMode };

let ok = true;
// The loop still awaits each check: registerCheck is sync and awaiting a plain boolean is harmless,
// and the async shape (from the #19 streaming leg) is kept so a future leg slots in unchanged.
// A NON-BLOCKING check cannot reach the exit code by any route — not by returning false, and not by
// throwing. Its failure to run is still said out loud, because silence reads as success.
// Each blocking check prints its own `commit refused: …` line naming the fix; there is no closing
// summary and no bypass offered (recalibration decision 3).
for (const c of CHECKS) {
  try {
    const passed = await c.run(ctx);
    if (c.blocking && !passed) ok = false;
  } catch (e) {
    process.stdout.write(c.blocking
      ? `commit refused: gate check ${c.id} could not run — ${e.message}\n`
      : `gate: ${c.id} could not run — ${e.message} (advisory; the commit is not blocked by it)\n`);
    if (c.blocking) ok = false;
  }
}
process.exitCode = ok ? 0 : 1;
