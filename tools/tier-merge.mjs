#!/usr/bin/env node
// The merge tier: every workspace test (fast and slow), the typecheck, the ui's build-mode
// typecheck, then the build. In that order, stopping at the first failure.
//
//   node tools/tier-merge.mjs
//
// The pre-push hook runs this with its own git environment; every step starts without any GIT_*
// variable (#224, see git-env.mjs). The slow tests make scratch repositories and linked worktrees
// with `git`, so an inherited absolute GIT_DIR would point those at this repository instead.
//
// Exit codes: the failing step's own, or 0 when every step passed.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnWithoutGitEnv } from './git-env.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const STEPS = [
	'pnpm test',
	'pnpm typecheck',
	'pnpm --filter @dwc-ng/ui exec tsc -b --force',
	'pnpm build',
];

for (const step of STEPS) {
	const run = spawnWithoutGitEnv(step, [], { cwd: root, shell: true, stdio: 'inherit' });
	if (run.status !== 0) {
		process.stderr.write(`merge tier: \`${step}\` failed\n`);
		process.exit(run.status ?? 1);
	}
}
