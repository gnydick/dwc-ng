#!/usr/bin/env node
// Plan Task B2 (recalibration 13, 15, 23; owner answers 45, 46): the tier runner the installed
// pre-commit calls after the gate. `tiers.mjs fast` runs the recorded `checks.commit` (when one is
// recorded) and then `tiers.fast` once, with `<components>` replaced by the names of the recorded
// components a staged path touches. Installed into .githooks/machinery/ next to the gate, so every
// import is './lib/...' and nothing here points at the plugin cache.
//
// Exit codes: 0 passed (or nothing to run); 1 refused — a check or the tier failed, or a setting
// the hook needs is not recorded (the refusal names the /machinery:setup item); 2 usage.
// Every refusal is a line on stdout beginning `commit refused:`; the count lines state their
// denominator so a pass for a bad reason cannot hide behind a bare pass.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { git } from './lib/git.mjs';
import { checkoutRoot } from './lib/root.mjs';
import { readSetting, recorded } from './lib/settings.mjs';
import { componentsOf } from './lib/components.mjs';
import { isOwnFile } from './lib/own-files.mjs';

const USAGE = 'usage: tiers.mjs fast | merge';
const say = (line) => process.stdout.write(line + '\n');
const run = (cmd, cwd) => spawnSync(cmd, { cwd, shell: true, stdio: 'inherit' }).status ?? 1;

// A setting the hook cannot do without: the refusal names what is missing and the item that records it.
class NotRecorded extends Error {}
function need(root, key, what) {
  try { return readSetting(root, key); }
  catch { throw new NotRecorded(`commit refused: no ${what} recorded in .claude/machinery/config.json — run /machinery:setup tiers`); }
}

function fast(root) {
  const listed = git(['diff', '--cached', '--name-only'], root);
  if (listed.code !== 0) { say(`commit refused: cannot list the staged paths: ${listed.stderr}`); return 1; }
  const staged = listed.stdout ? listed.stdout.split('\n') : [];
  if (!staged.length) { say('fast_tier: 0 of 0 touched components failed (nothing staged)'); return 0; }
  // Machinery's own files (STATUS decision 51): a commit staging only what install.mjs stages has
  // no code a test could cover, so it passes before any recorded setting is consulted — which is
  // what lets install and setup commit their own files before tiers exist.
  if (staged.every(isOwnFile)) { say("fast_tier: 0 of 0 touched components failed (machinery's own files only)"); return 0; }
  const command = need(root, 'tiers.fast', 'tiers');
  need(root, 'components', 'components');
  const checks = recorded(root, 'checks.commit');
  if (checks !== undefined) {
    const failed = run(checks, root) === 0 ? 0 : 1;
    say(`commit_checks: ${failed} of 1 checks failed`);
    if (failed) { say(`commit refused: checks failed — run \`${checks}\`, fix, commit again`); return 1; }
  }
  const touched = componentsOf(root, staged);
  if (!touched.length) { say('fast_tier: 0 of 0 touched components failed (nothing staged in a component)'); return 0; }
  const cmd = command.replaceAll('<components>', touched.join(' '));
  // One command runs over every touched component, so a failure is a failure of that set: the
  // count says how many components the failing run covered, never which one broke.
  const failed = run(cmd, root) === 0 ? 0 : touched.length;
  say(`fast_tier: ${failed} of ${touched.length} touched components failed`);
  if (failed) { say(`commit refused: fast tests failed in ${touched.join(', ')} — run \`${cmd}\`, fix, commit again`); return 1; }
  return 0;
}

// The merge tier (plan Task B3; decision 13 amended): run in place on the warm build, only for a
// push whose remote ref is main, and only on a clean tree whose HEAD is the commit being pushed —
// otherwise the tests would judge a tree the push does not carry. git hands the pre-push hook one
// line per ref on stdin: `<local ref> <local sha> <remote ref> <remote sha>`; a deletion has an
// all-zero local sha and nothing to test.
const MAIN = 'refs/heads/main';
const ZERO = /^0{40}$/;
function merge(root) {
  const pushes = fs.readFileSync(0, 'utf8').split('\n').map((l) => l.trim().split(/\s+/)).filter((f) => f.length === 4 && f[2] === MAIN && !ZERO.test(f[1]));
  if (!pushes.length) { say('merge_tier: 0 of 0 pushes to main'); return 0; }
  const [, pushed] = pushes[0];
  const status = git(['status', '--porcelain'], root);
  const head = git(['rev-parse', 'HEAD'], root).stdout;
  if (status.stdout !== '' || head !== pushed) {
    say(`push refused: working tree not clean or HEAD ${head} is not pushed ${pushed} — commit, check out ${pushed}, push again`);
    return 1;
  }
  let command;
  try { command = readSetting(root, 'tiers.merge'); }
  catch { say('push refused: no tiers recorded in .claude/machinery/config.json — run /machinery:setup tiers'); return 1; }
  if (run(command, root) !== 0) { say(`push refused: merge tests failed — run \`${command}\`, fix, push again`); return 1; }
  say('merge_tier: 0 of 1 pushes to main failed');
  return 0;
}

const TIERS = { fast, merge };
const [tier] = process.argv.slice(2);
if (!(tier in TIERS)) { process.stderr.write(USAGE + '\n'); process.exit(2); }
// The checkout being committed or pushed (STATUS 52), so a linked worktree's own index, config and
// tree are what the tiers judge — never the main checkout's.
try { process.exit(TIERS[tier](checkoutRoot(process.cwd()))); }
catch (e) {
  if (e instanceof NotRecorded) { say(e.message); process.exit(1); }
  process.stderr.write(`${e.message}\n`); process.exit(1);
}
