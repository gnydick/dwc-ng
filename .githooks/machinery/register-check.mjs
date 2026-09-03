import path from 'node:path';
import { pending } from './lib/inbox.mjs';
import { generateIndexFrom } from './lib/index.mjs';
import { report } from './lib/report.mjs';
import { git, gitRaw } from './lib/git.mjs';

const toPosix = (p) => p.split(path.sep).join('/');
const posixBasename = (p) => p.split('/').pop();

// The STAGED rule files under rulesDir, read from the git index — not the working tree
// (spec I28: partial staging must not slip an index past what's actually being committed).
function stagedRuleEntries(root, rulesDir) {
  const rel = toPosix(path.relative(root, rulesDir));
  const ls = git(['ls-files', '--cached', '--', rel], root);
  if (ls.code !== 0) throw new Error(`git ls-files failed: ${ls.stderr}`);
  const files = ls.stdout.split('\n').filter((f) => f && f.endsWith('.md')).sort();
  return files.map((f) => {
    // `:./<path>` resolves relative to cwd (root); plain `:<path>` resolves relative to the
    // git top level, which breaks when root is itself a subdirectory of the enclosing repo
    // (e.g. the universal plugin checkout nested inside a monorepo). Untrimmed (final review
    // A2): a rule file's own leading/trailing blank lines are real content for its parser.
    const show = gitRaw(['show', `:./${f}`], root);
    if (show.code !== 0) throw new Error(`git show :./${f} failed: ${show.stderr}`);
    return { name: posixBasename(f), text: show.stdout };
  });
}

// The STAGED index file's content, or null when nothing is staged there.
function stagedIndex(root, indexFile) {
  const rel = toPosix(path.relative(root, indexFile));
  const r = gitRaw(['show', `:./${rel}`], root);
  return r.code === 0 ? r.stdout : null;
}

// {rulesDir, inbox, index, root} → true if it passes. Never writes (spec I23).
// The index is compared against a regeneration from the STAGED rule files, not the working
// tree (spec I28, I2): the index must never disagree with the rule files being committed.
export function registerCheck({ rulesDir, inbox, index, root }) {
  let ok = true;
  let pend = [];
  try { pend = pending(inbox); } catch (e) { report('register_check', 1, 1, `inbox malformed — ${e.message}`); return false; }
  report('register_check', pend.length, pend.length, `pending inbox entr${pend.length === 1 ? 'y' : 'ies'} (must be 0)`);
  if (pend.length) ok = false;
  let staged;
  try { staged = stagedRuleEntries(root, rulesDir); }
  catch (e) { report('register_check', 1, 1, `rule files: ${e.message}`); return false; }
  // Both sides trimmed consistently at the comparison (final review A2): gitRaw() above is
  // untrimmed for line-accurate blobs; a written index always carries a trailing newline that
  // a fresh regeneration's own .trim() would otherwise disagree with.
  const curRaw = stagedIndex(root, index);
  const cur = curRaw === null ? null : curRaw.trim();
  if (staged.length === 0 && cur === null) {
    // Final review A1: nothing under rulesDir and no index are staged — nothing being
    // committed can disagree with anything, so there is nothing to check.
    report('register_check', 0, 0, 'index rows (nothing staged under rules or the index)');
    return ok;
  }
  const fresh = generateIndexFrom(staged).trim();
  if (cur === null) {
    process.stdout.write(`register_check: index not staged (generated but not added) — git add ${path.relative(process.cwd(), index) || index}\n`);
    ok = false;
  } else if (cur !== fresh) {
    process.stdout.write(`register_check: index is stale — ${path.relative(process.cwd(), index) || index} differs from a fresh regeneration; run /machinery:reindex\n`);
    ok = false;
  }
  return ok;
}
