import path from 'node:path';
import { pending } from './lib/inbox.mjs';
import { report } from './lib/report.mjs';

// The gate's composition is generated from this (ticket #73, I43). The rules index and its
// comparison are gone (recalibration decision 10): what blocks is a pending inbox entry, nothing else.
export const declaration = Object.freeze({
  id: 'register_check',
  run: 'registerCheck',
  blocking: true,
  wired: true,
});

// {inbox, userInbox, root} → true if it passes. Never writes (spec I23). Two inboxes, one check
// (STATUS 54): the project's, and the user's ~/.claude/machinery/inbox.md, so an unfiled URULE
// blocks a commit in ANY project. A refusal names whichever inbox holds the entries and the one
// fix, and offers no bypass (recalibration decision 3). The project inbox is shown relative to the
// root; the user's lies outside every repository, so it is shown as it is.
export function registerCheck({ inbox, userInbox, root }) {
  const show = (f) => (f === userInbox ? f : path.relative(root, f).split(path.sep).join('/'));
  const counts = [];
  for (const f of [inbox, userInbox]) {
    try { counts.push([f, pending(f).length]); }
    catch (e) { report('register_check', 1, 1, `inbox malformed — ${show(f)}: ${e.message}`); return false; }
  }
  const n = counts.reduce((sum, [, k]) => sum + k, 0);
  report('register_check', n, n, `pending inbox entr${n === 1 ? 'y' : 'ies'} across the project and user inboxes (must be 0)`);
  for (const [f, k] of counts) {
    if (k) process.stdout.write(`commit refused: ${k} pending entr${k === 1 ? 'y' : 'ies'} in ${show(f)} — run /machinery:rule-process\n`);
  }
  return n === 0;
}
