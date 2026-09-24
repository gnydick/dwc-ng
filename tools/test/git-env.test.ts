// #224: the hooks start dwc-ng's test runs with the hook's git environment. From a linked
// worktree git hands a hook an absolute GIT_DIR and GIT_INDEX_FILE, so a test that runs `git`
// in a scratch directory operates on the real repository instead (2026-09-23: `core.bare = true`
// and a `user = t` identity written into .git/config, and a "seed" commit on GIT_194).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnWithoutGitEnv, withoutGitEnv } from "../git-env.mjs";

const TOOLS = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = dirname(TOOLS);

// Fixture git runs with GIT_* removed, so this suite is itself safe to run from inside a hook.
function git(args: string[], cwd: string): string {
	const r = spawnSync("git", args, { cwd, encoding: "utf8", env: withoutGitEnv() });
	if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${r.stderr}`);
	return r.stdout.trim();
}

const scratch: string[] = [];
function tempDir(tag: string): string {
	const dir = mkdtempSync(join(tmpdir(), `dwc-git-env-${tag}-`));
	scratch.push(dir);
	return dir;
}
test.after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });

// A repository with one linked worktree, set up the way a hook from that worktree would see it:
// GIT_DIR is the worktree's admin dir under the main .git, and absolute. Its identity comes from
// `-c` on each commit, never from its config, so a `user` section there can only be the probe's.
function sandbox(): { config: string; hookEnv: NodeJS.ProcessEnv } {
	const root = tempDir("repo");
	git(["init", "-q"], root);
	git(["-c", "user.name=s", "-c", "user.email=s@example.invalid", "commit", "-q", "--allow-empty", "-m", "base"], root);
	const wt = join(root, "..", `${root.split(/[\\/]/).pop()}-wt`);
	scratch.push(wt);
	git(["worktree", "add", "-q", wt], root);
	const admin = git(["rev-parse", "--path-format=absolute", "--git-dir"], wt);
	return {
		config: join(root, ".git", "config"),
		hookEnv: { ...withoutGitEnv(), GIT_DIR: admin, GIT_INDEX_FILE: join(admin, "index") },
	};
}

// What the 2026-09-23 test did: make a scratch repo and give it an identity.
const PROBE = [["init", "-q"], ["config", "user.name", "t"]];

// Read back exactly the two keys the incident wrote. `--get` exits 1 for an absent key.
function damage(config: string): { bare: string; user: string } {
	const read = (key: string) => spawnSync("git", ["config", "-f", config, "--get", key], { encoding: "utf8", env: withoutGitEnv() }).stdout.trim();
	return { bare: read("core.bare"), user: read("user.name") };
}

test("a probe run through the helper leaves the repository the hook came from untouched", () => {
	const box = sandbox();
	const probeDir = tempDir("probe");
	for (const args of PROBE) {
		const r = spawnWithoutGitEnv("git", args, { cwd: probeDir, env: box.hookEnv, encoding: "utf8" });
		assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
	}
	assert.deepEqual(damage(box.config), { bare: "false", user: "" });
	// And the probe did its work where it was pointed.
	assert.equal(git(["config", "--get", "user.name"], probeDir), "t");
});

test("INVERSE CONTROL: the same probe spawned raw does damage the repository, so the observer is alive", () => {
	const box = sandbox();
	const probeDir = tempDir("probe");
	for (const args of PROBE) spawnSync("git", args, { cwd: probeDir, env: box.hookEnv, encoding: "utf8" });
	assert.deepEqual(damage(box.config), { bare: "true", user: "t" });
});

// The hooks run whatever `tiers.fast` and `tiers.merge` say, with the hook's environment. The
// protection holds only while each is a tools/ runner that starts every process without GIT_*.
// That is checked by BEHAVIOUR, not by reading source: review of #224 walked around two text scans
// in a row (a second import sharing a line, a comment between `import` and its parenthesis). Each
// runner runs with a hook-shaped environment under spawn-spy.mjs, which intercepts every way Node
// starts a process, records the environment each child would have had, and starts nothing — so no
// real test runs and nothing is touched. Limit: the spy sees the paths a run takes, not branches
// it never reaches.
// Plain word arguments only: a shell operator (`&&`, `|`, `;`, a redirect) would run something the
// runner never sees.
const RUNNER = /^node (tools\/[\w-]+\.mjs)((?:\s+[\w.-]+)*)\s*$/;
const SPY = join(TOOLS, "test", "spawn-spy.mjs");

type Attempt = { fn: string; command: string; inherits: boolean; gitVars: string[] };

// Run `script` the way a hook would: GIT_DIR and GIT_INDEX_FILE set. They name a directory that
// does not exist, since nothing here may ever point at a real repository; the spy only needs them
// to be present.
function spied(script: string, args: string[]): { status: number | null; stderr: string; attempts: Attempt[] } {
	const dir = tempDir("spy");
	const log = join(dir, "attempts.jsonl");
	const hookDir = join(dir, "no-such-gitdir");
	const r = spawnSync(process.execPath, ["--import", pathToFileURL(SPY).href, script, ...args], {
		cwd: ROOT,
		encoding: "utf8",
		env: { ...withoutGitEnv(), GIT_DIR: hookDir, GIT_INDEX_FILE: join(hookDir, "index"), SPAWN_SPY_LOG: log },
	});
	const lines = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
	return { status: r.status, stderr: r.stderr, attempts: lines.map((l) => JSON.parse(l) as Attempt) };
}

// A runner under the spy that ran `pnpm test` for real would reach this file again; the spy's log
// variable survives withoutGitEnv, so a nested run sees it and stops here instead of recursing.
const NESTED = process.env.SPAWN_SPY_LOG !== undefined;

test("each tier command the hooks run starts every process with GIT_* removed, seen by behaviour", { skip: NESTED && "inside a spied run" }, () => {
	const config = JSON.parse(readFileSync(join(ROOT, ".claude", "machinery", "config.json"), "utf8"));
	for (const key of ["fast", "merge"]) {
		const configured: string = config.tiers[key];
		const m = RUNNER.exec(configured.replaceAll("<components>", Object.keys(config.components).join(" ")));
		assert.ok(m, `tiers.${key} is \`${configured}\`, not a tools/ runner — the hook would hand it GIT_DIR and GIT_INDEX_FILE`);
		const run = spied(join(ROOT, m[1] as string), (m[2] as string).trim().split(/\s+/).filter(Boolean));
		assert.equal(run.status, 0, `tiers.${key} failed under the spy: ${run.stderr}`);
		assert.ok(run.attempts.length > 0, `tiers.${key} started nothing, so there was nothing for the spy to see`);
		for (const a of run.attempts) {
			assert.equal(a.inherits, false, `tiers.${key}: ${a.fn}(${a.command}) would inherit the hook's environment`);
			assert.deepEqual(a.gitVars, [], `tiers.${key}: ${a.fn}(${a.command}) would get ${a.gitVars.join(", ")}`);
		}
	}
});

test("POSITIVE CONTROL: the spy catches a runner that starts a process around the helper, however it gets there", () => {
	const dir = tempDir("fixtures");
	const helper = JSON.stringify(pathToFileURL(join(TOOLS, "git-env.mjs")).href);
	const bad: Record<string, string> = {
		"inherits": "import { spawnSync } from 'node:child_process';\nspawnSync('x', ['y']);",
		"passes-process-env": "import { spawnSync } from 'node:child_process';\nspawnSync('x', [], { env: process.env });",
		"shares-the-helpers-line": `import { spawnWithoutGitEnv } from ${helper}; import { execSync } from 'node:child_process';\nexecSync('x');`,
		"comment-before-the-paren": "const cp = await import/*x*/('node:child_process');\ncp.execFileSync('x', []);",
		"computed-specifier": "const cp = await import('node:child_' + 'process');\ncp.spawnSync('x');",
		"getBuiltinModule": "process.getBuiltinModule('node:child_process').spawnSync('x');",
		"createRequire": "import { createRequire } from 'node:module';\ncreateRequire(import.meta.url)('child_process').execSync('x');",
		"async-spawn": "import { spawn } from 'node:child_process';\nspawn('x', []);",
		"exec-with-callback": "import { exec } from 'node:child_process';\nexec('x', () => {});",
		"fork": "import { fork } from 'node:child_process';\nfork('x.mjs');",
	};
	for (const [name, source] of Object.entries(bad)) {
		const file = join(dir, `${name}.mjs`);
		writeFileSync(file, source);
		const run = spied(file, []);
		assert.ok(run.attempts.some((a) => a.inherits || a.gitVars.length > 0), `${name}: not caught — attempts ${JSON.stringify(run.attempts)}, stderr ${run.stderr}`);
	}
	// A runner that goes through the helper is clean, and it is seen.
	const good = join(dir, "good.mjs");
	writeFileSync(good, `import { spawnWithoutGitEnv } from ${helper};\nspawnWithoutGitEnv('x', ['y']);`);
	assert.deepEqual(spied(good, []).attempts, [{ fn: "spawnSync", command: "x", inherits: false, gitVars: [] }]);
});

test("the configured-runner pattern takes a tools/ runner and refuses a raw command", () => {
	assert.ok(RUNNER.test("node tools/tier-fast.mjs connector ui"));
	assert.ok(RUNNER.test("node tools/tier-merge.mjs"));
	assert.ok(!RUNNER.test("pnpm test && pnpm build"));
	assert.ok(!RUNNER.test("node tools/tier-merge.mjs && pnpm build"));
});

test("every GIT_* variable is removed, whatever its letter case", () => {
	const env = { GIT_DIR: "/a", GIT_INDEX_FILE: "/b", Git_Work_Tree: "/c", git_prefix: "d/" };
	assert.deepEqual(withoutGitEnv(env), {});
});

test("everything that is not a GIT_* variable is kept, GITHUB_* and a bare GIT included", () => {
	const env = { PATH: "/bin", GITHUB_TOKEN: "t", GIT: "g", HOME: "/h", GIT_DIR: "/a" };
	assert.deepEqual(withoutGitEnv(env), { PATH: "/bin", GITHUB_TOKEN: "t", GIT: "g", HOME: "/h" });
});
