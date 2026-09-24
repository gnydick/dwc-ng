#!/usr/bin/env node
// The fast tier: the touched components' top-level tests, in one `node --test` run.
//
//   node tools/tier-fast.mjs <component name…>
//
// A component's test glob is derived from the SAME mapping the commit gate matched the staged path
// against — `components` in .claude/machinery/config.json — so the two cannot disagree about where a
// component lives. Each component contributes `<prefix>/test/*.test.ts`: top level only, which is
// what makes this tier fast. Slower tests live in `<prefix>/test/slow/` and run at push to main
// (`pnpm test`), never here.
//
// `--conditions=browser` is a process-wide flag; packages/ui's tests need it and it is inert for the
// rest, so one run covers every component.
//
// The pre-commit hook runs this with its own git environment; the tests start without any GIT_*
// variable (#224, see git-env.mjs).
//
// Exit codes: node --test's own (0 passed, non-zero failed); 2 usage or an unknown component.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnWithoutGitEnv } from './git-env.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const names = process.argv.slice(2);
if (!names.length) {
	process.stderr.write('usage: tier-fast.mjs <component name…>\n');
	process.exit(2);
}

const configFile = path.join(root, '.claude', 'machinery', 'config.json');
let components;
try {
	components = JSON.parse(fs.readFileSync(configFile, 'utf8')).components ?? {};
} catch (e) {
	process.stderr.write(`cannot read ${configFile}: ${e.message}\n`);
	process.exit(2);
}

const globs = [];
for (const name of names) {
	const prefix = components[name];
	if (!prefix) {
		process.stderr.write(`unknown component '${name}' — recorded: ${Object.keys(components).join(', ') || 'none'}\n`);
		process.exit(2);
	}
	globs.push(`${prefix.replaceAll('\\', '/').replace(/\/+$/, '')}/test/*.test.ts`);
}

const run = spawnWithoutGitEnv(process.execPath, ['--conditions=browser', '--test', ...globs], { cwd: root, stdio: 'inherit' });
process.exit(run.status ?? 1);
