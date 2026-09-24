// The environment a test run started by a git hook gets: the caller's, minus every GIT_* variable.
//
// #224: git exports GIT_DIR and GIT_INDEX_FILE to every hook, and from a linked worktree both are
// absolute. A test that runs `git` in a scratch directory with them inherited operates on the real
// repository instead: on 2026-09-23 one wrote `core.bare = true` and a `user = t` identity into
// .git/config and committed "seed" onto GIT_194. Gabe, 2026-09-23: test runs get no GIT_* variable.
//
// Matched case-insensitively: Windows environment names are, so `Git_Dir` would still reach a
// child as GIT_DIR.

import { spawnSync } from 'node:child_process';

const GIT_VAR = /^GIT_/i;

export function withoutGitEnv(env = process.env) {
	return Object.fromEntries(Object.entries(env).filter(([name]) => !GIT_VAR.test(name)));
}

// The only way a tier runner in tools/ starts a process: spawnSync with the environment it would
// have inherited, minus GIT_*. `options.env`, when given, is filtered the same way — a caller
// cannot hand a GIT_* variable through.
export function spawnWithoutGitEnv(command, args = [], options = {}) {
	return spawnSync(command, args, { ...options, env: withoutGitEnv(options.env ?? process.env) });
}
