import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let exe = null;
// Resolved once (union: rules/tool-output.md § A check that cannot run fails
// loudly). Bare `git` is fine on every platform; the loud failure names it.
export function gitExe() {
  if (exe) return exe;
  const probe = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) throw new Error('git not found; looked for: `git` on PATH');
  exe = 'git';
  return exe;
}

export function git(args, cwd) {
  const r = spawnSync(gitExe(), args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: r.status ?? 1, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() };
}

// Same as git(), but stdout is NOT trimmed (final review A2): a blob's leading/trailing blank
// lines are real content — trimming shifts every `path:line` citation against it.
export function gitRaw(args, cwd) {
  const r = spawnSync(gitExe(), args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: (r.stderr ?? '').trim() };
}

export function realDir(p) { return fs.existsSync(p) ? fs.realpathSync.native(p) : path.resolve(p); }
