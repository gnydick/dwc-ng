// Test support for git-env.test.ts (#224). Loaded with `node --import` ahead of a script, it
// replaces every way Node starts a process with a recorder, and starts nothing.
//
// Each attempt is appended to $SPAWN_SPY_LOG as one JSON line:
// - which function was called, and the command
// - whether the child would inherit this process's environment (no `env` given)
// - which GIT_* variables the child would get
//
// The fakes answer "succeeded", so a runner goes on to its end and every attempt it makes is seen.
//
// Patched on the child_process module object itself, then synced into its ESM exports. So the
// same fakes answer however a script reaches them:
// - a static import, on its own line or not
// - import(), with a literal or a computed specifier
// - createRequire
// - process.getBuiltinModule
// process.execve is replaced too.
import cp from 'node:child_process';
import { EventEmitter } from 'node:events';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const LOG = process.env.SPAWN_SPY_LOG;
if (!LOG) throw new Error('spawn-spy: SPAWN_SPY_LOG is not set, so nothing could be recorded');
const GIT_VAR = /^GIT_/i;

function record(fn, command, options) {
	const inherits = options?.env === undefined;
	const env = inherits ? process.env : options.env;
	const gitVars = Object.keys(env).filter((name) => GIT_VAR.test(name)).sort();
	appendFileSync(LOG, JSON.stringify({ fn, command: String(command), inherits, gitVars }) + '\n');
}

// In (command, args?, options?) signatures the args array is optional.
const optionsOf = (args, options) => (Array.isArray(args) ? options : args);
const lastFunction = (...xs) => xs.find((x) => typeof x === 'function');
const firstOptions = (...xs) => xs.find((x) => x !== null && typeof x === 'object' && !Array.isArray(x));

const SUCCEEDED = { pid: 0, status: 0, signal: null, output: [null, '', ''], stdout: '', stderr: '' };
function fakeChild() {
	const child = Object.assign(new EventEmitter(), { pid: 0, exitCode: 0, stdin: null, stdout: null, stderr: null, kill: () => true });
	setImmediate(() => { child.emit('exit', 0, null); child.emit('close', 0, null); });
	return child;
}

cp.spawnSync = (command, args, options) => { record('spawnSync', command, optionsOf(args, options)); return SUCCEEDED; };
cp.execFileSync = (file, args, options) => { record('execFileSync', file, optionsOf(args, options)); return ''; };
cp.execSync = (command, options) => { record('execSync', command, options); return ''; };
cp.spawn = (command, args, options) => { record('spawn', command, optionsOf(args, options)); return fakeChild(); };
cp.fork = (modulePath, args, options) => { record('fork', modulePath, optionsOf(args, options)); return fakeChild(); };
cp.exec = (command, options, callback) => {
	record('exec', command, firstOptions(options));
	const done = lastFunction(options, callback);
	if (done) setImmediate(done, null, '', '');
	return fakeChild();
};
cp.execFile = (file, args, options, callback) => {
	record('execFile', file, firstOptions(args, options));
	const done = lastFunction(args, options, callback);
	if (done) setImmediate(done, null, '', '');
	return fakeChild();
};
syncBuiltinESMExports();

if (typeof process.execve === 'function') {
	process.execve = (file, args, env) => { record('execve', file, env === undefined ? undefined : { env }); process.exit(0); };
}
