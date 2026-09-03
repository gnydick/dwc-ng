#!/usr/bin/env node
// Story: gates/commit-gate.md. Runs on EVERY commit (ruled), check-only, cheap.
// The check list is a closed array (spec I24): nothing can extend it.
import path from 'node:path';
import { registerCheck } from './register-check.mjs';
import { citationTarget } from './citation-target.mjs';
import { sweepGuard } from './sweep-guard.mjs';
import { projectRoot } from './lib/root.mjs';

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const universal = argv.includes('--universal');
const mergeMode = argv.includes('--merge');
const root = opt('--root') ? path.resolve(opt('--root')) : projectRoot(process.cwd());

const layout = universal
  ? { rulesDir: path.join(root, 'rules'), inbox: path.join(root, 'inbox.md'), index: path.join(root, 'register', 'INDEX.md') }
  : { rulesDir: path.join(root, '.claude', 'rules'), inbox: path.join(root, '.claude', 'machinery', 'inbox.md'), index: path.join(root, '.claude', 'machinery', 'INDEX.md') };

const CHECKS = Object.freeze([
  () => registerCheck({ ...layout, root }),
  () => citationTarget({ root, mergeMode }),
]);
let ok = true;
for (const check of CHECKS) { try { if (!check()) ok = false; } catch (e) { process.stdout.write(`gate: a check could not run — ${e.message}\n`); ok = false; } }
sweepGuard({ root });
if (!ok) process.stdout.write('commit gate FAILED (see lines above). Commit rejected. Bypass only for a genuine emergency: `git commit --no-verify`; twice means the checker is wrong — fix the checker.\n');
process.exitCode = ok ? 0 : 1;
