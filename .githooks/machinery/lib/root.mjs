// Story: union/plugin/hooks/rule-capture.md ("resolves the project root, not
// the session's own checkout"). The root is the directory owning the COMMON
// git dir, so a worktree resolves to the main checkout.
import path from 'node:path';
import { git, realDir } from './git.mjs';

function commonDir(cwd) {
  const r = git(['rev-parse', '--git-common-dir'], cwd);
  if (r.code !== 0) throw new Error(`not inside a git repository: ${cwd}`);
  return realDir(path.resolve(cwd, r.stdout));
}

export function projectRoot(cwd = process.cwd()) {
  return path.dirname(commonDir(cwd));
}

export function isRootSession(cwd = process.cwd()) {
  const own = git(['rev-parse', '--git-dir'], cwd);
  if (own.code !== 0) throw new Error(`not inside a git repository: ${cwd}`);
  return realDir(path.resolve(cwd, own.stdout)) === commonDir(cwd);
}
