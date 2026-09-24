import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { lineSplitter } from './lines.mjs';

let exe = null;
// Resolved once; a check that cannot run fails loudly rather than skipping,
// because a skipped check reads as a pass. Bare `git` is fine on every
// platform; the loud failure names it.
export function gitExe() {
  if (exe) return exe;
  const probe = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) throw new Error('git not found; looked for: `git` on PATH');
  exe = 'git';
  return exe;
}

// Measured incident, 2026-09-02: a real `git commit` from a LINKED WORKTREE
// exports GIT_DIR (the worktree's admin dir under the main .git) to every
// hook it runs, but never GIT_WORK_TREE — and, for a partial commit (explicit
// pathspecs, this repo's own commit convention: every commit names the paths
// it commits), GIT_INDEX_FILE points at the in-flight temp index
// holding exactly that partial-commit snapshot. Inherited as-is, a spawned
// git with GIT_DIR set and GIT_WORK_TREE absent refuses any cwd-relative
// pathspec (`:./path`, used by the gate's checks) with "ambiguous
// argument" — confirmed by reproducing it directly. Stripping GIT_DIR (and
// GIT_WORK_TREE, in case something else ever sets it inconsistently) lets git
// rediscover the real worktree from `cwd` the normal way; GIT_INDEX_FILE is
// deliberately kept, because dropping it would make `--cached` reads fall
// back to the worktree's permanent index instead of the partial commit's
// temp one — silently checking the wrong snapshot.
function spawnEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
}

// How the child died when git itself never got to say (ticket #19, measured 2026-09-05: a
// spawnSync over its 1 MiB default buffer comes back status null, signal SIGTERM,
// error.code ENOBUFS and an EMPTY stderr — reported as a bare `git diff failed:`). A
// spawn failure (ENOENT, ENOBUFS) or a signal is appended to stderr, so every caller that
// prints `${r.stderr}` names it without changing: a check that cannot run fails loudly,
// naming what it could not do, because a quiet skip reads as a pass.
function failureDetail({ error, signal }) {
  const parts = [];
  if (error) parts.push(`spawn failed: ${error.code ?? error.message}${error.code === 'ENOBUFS' ? ' (output exceeded the sync buffer; stream it with gitLines)' : ''}`);
  if (signal) parts.push(`killed by ${signal}`);
  return parts.join(', ');
}
function withDetail(r) {
  const own = (r.stderr ?? '').trim();
  const detail = failureDetail(r);
  return detail ? (own ? `${own}\n${detail}` : detail) : own;
}

// For SMALL queries only (rev-parse, ls-files, config, show of one file): the whole output is
// held in memory and dies at 1 MiB. Anything that scales with the change streams via gitLines.
export function git(args, cwd) {
  const r = spawnSync(gitExe(), args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: spawnEnv() });
  return { code: r.status ?? 1, stdout: (r.stdout ?? '').trim(), stderr: withDetail(r) };
}

// Same as git(), but stdout is NOT trimmed (final review A2): a blob's leading/trailing blank
// lines are real content — trimming shifts every `path:line` citation against it.
export function gitRaw(args, cwd) {
  const r = spawnSync(gitExe(), args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: spawnEnv() });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: withDetail(r) };
}

// git's stdout as a stream of lines (lib/lines.mjs's rule: split on '\n', no phantom empty line
// after a trailing newline, multi-byte characters decoded across chunk boundaries), holding
// one chunk and one carried partial line at a time — never the whole output (ticket #19,
// owner: "can't we operate on a stream?"). The returned handle is async-iterable ONCE and
// carries the child's `pid` (to see the process) and `kill()` (to end it through its own
// handle: measured 2026-09-05, on Windows a kill from OUTSIDE is a TerminateProcess that Node
// reports as exit 1 with no signal — still a rejection, but with no signal to name).
// Fix round 1, both measured: git is spawned on the first next(), not when the handle is made,
// because a handle made and never iterated left git blocked on a full pipe for as long as the
// process lived (it kept a test runner alive indefinitely); and a second iteration of the same
// handle throws, because the old one yielded zero lines — indistinguishable from an empty diff.
// Completion is judged only once the child has CLOSED: a non-zero exit, a signal, or a spawn
// failure rejects the iteration, naming the command, the exit code or signal, and git's own
// stderr — so a truncated output can never read as a complete one. Abandoning the iteration
// kills the child rather than leaving it blocked on the pipe.
export function gitLines(args, cwd) {
  let child = null;
  let consumed = false;
  async function* lines() {
    child = spawn(gitExe(), args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: spawnEnv() });
    let spawnError = null;
    // Unbounded by design: git's stderr is a few lines of its own diagnostics, never something
    // that scales with the change — the bounded-memory claim is about stdout.
    let stderr = '';
    child.on('error', (e) => { spawnError = e; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { stderr += d; });
    const closed = new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal })));
    const splitter = lineSplitter();
    let drained = false;
    try {
      for await (const chunk of child.stdout) yield* splitter.push(chunk);
      const tail = splitter.end();
      if (tail) yield tail;
      drained = true;
    } finally {
      // Only an ABANDONED iteration kills: after a complete read the pipe can close a moment
      // before the process is reaped, and killing then would fake a signal on a clean exit.
      if (!drained && child.exitCode === null && child.signalCode === null) child.kill();
    }
    const { status, signal } = await closed;
    const detail = failureDetail({ error: spawnError, signal });
    if (spawnError || signal || status !== 0) {
      const why = detail || `exit ${status}`;
      const own = stderr.trim();
      throw new Error(`git ${args.join(' ')}: ${why}${own ? ` — ${own}` : ''}`);
    }
  }
  return {
    get pid() { return child?.pid; },
    kill: () => (child ? child.kill() : false),
    [Symbol.asyncIterator]() {
      if (consumed) throw new Error(`gitLines(git ${args.join(' ')}) already consumed: a handle streams once — make a new one`);
      consumed = true;
      return lines();
    },
  };
}

export function realDir(p) { return fs.existsSync(p) ? fs.realpathSync.native(p) : path.resolve(p); }
