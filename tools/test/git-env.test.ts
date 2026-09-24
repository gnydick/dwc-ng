// #224: the hooks start dwc-ng's test runs with the hook's git environment. From a linked
// worktree git hands a hook an absolute GIT_DIR and GIT_INDEX_FILE, so a test that runs `git`
// in a scratch directory operates on the real repository instead (2026-09-23: `core.bare = true`
// and a `user = t` identity written into .git/config, and a "seed" commit on GIT_194).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

// The hooks run whatever `tiers.fast` and `tiers.merge` say, with the hook's environment. So the
// protection holds only while each of them is a tools/ runner, and each runner can start a process
// only through the helper. This is the tripwire for either one drifting.
//
// A runner's whole reach is its imports, so they are an allowlist, not a denylist of spawners:
// nothing that can start a process (child_process, worker_threads, a second local module that
// might) and no run-time loading, whose specifier a text scan cannot see. A runner that needs
// another module widens this list in the same change, where a reviewer sees it.
const RUNNER = /^node tools\/([\w-]+\.mjs)(?:\s|$)/;
const RUNNER_IMPORTS = new Set(["node:fs", "node:path", "node:url", "./git-env.mjs"]);
const STATIC_IMPORT = /^\s*(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
const RUNTIME_LOAD = /\bimport\s*\(|\brequire\s*\(|\bcreateRequire\b|\bprocess\s*\.\s*(?:binding|dlopen)\b/;

// Why a runner's source could let a hook's GIT_* variables through, or null when it cannot.
function leak(source: string): string | null {
	if (RUNTIME_LOAD.test(source)) return "loads code dynamically";
	const imports = [...source.matchAll(STATIC_IMPORT)].map((m) => m[1] as string);
	const stray = imports.find((spec) => !RUNNER_IMPORTS.has(spec));
	if (stray !== undefined) return `imports ${stray}`;
	if (!imports.includes("./git-env.mjs")) return "does not import ./git-env.mjs";
	return null;
}

test("both tier commands the hooks run are tools/ runners that start processes only through the helper", () => {
	const tiers = JSON.parse(readFileSync(join(ROOT, ".claude", "machinery", "config.json"), "utf8")).tiers;
	for (const key of ["fast", "merge"]) {
		const command = tiers[key];
		const runner = RUNNER.exec(command);
		assert.ok(runner, `tiers.${key} is \`${command}\`, not a tools/ runner — the hook would hand it GIT_DIR and GIT_INDEX_FILE`);
		const file = runner[1] as string;
		assert.equal(leak(readFileSync(join(TOOLS, file), "utf8")), null, `tools/${file}`);
	}
});

test("POSITIVE CONTROL: the scan still flags every way a runner could spawn around the helper", () => {
	const helper = "import { spawnWithoutGitEnv } from './git-env.mjs';\n";
	// child_process itself, however it is spelled or laid out.
	assert.equal(leak(helper + "import { spawnSync } from 'node:child_process';"), "imports node:child_process");
	assert.equal(leak(helper + 'import cp from "child_process";'), "imports child_process");
	assert.equal(leak(helper + "import {\n\tspawnSync,\n} from 'node:child_process';"), "imports node:child_process");
	// Anything loaded at run time, where the specifier is invisible to a text scan.
	assert.equal(leak(helper + "const cp = require('child_process');"), "loads code dynamically");
	assert.equal(leak(helper + "const cp = await import('node:child_process');"), "loads code dynamically");
	assert.equal(leak(helper + "const cp = await import('child_' + 'process');"), "loads code dynamically");
	assert.equal(leak(helper + "import { createRequire } from 'node:module';\ncreateRequire(import.meta.url)('child_process');"), "loads code dynamically");
	// A second module that could do the spawning, or another way to start a process.
	assert.equal(leak(helper + "import { run } from './other.mjs';"), "imports ./other.mjs");
	assert.equal(leak(helper + "export { run } from './other.mjs';"), "imports ./other.mjs");
	assert.equal(leak(helper + "import { Worker } from 'node:worker_threads';"), "imports node:worker_threads");
	assert.equal(leak(helper + "import { execa } from 'execa';"), "imports execa");
	// No helper at all.
	assert.equal(leak("import path from 'node:path';"), "does not import ./git-env.mjs");
	// And a runner shaped like the real ones passes.
	assert.equal(leak(helper + "import path from 'node:path';\nimport { fileURLToPath } from 'node:url';\nconst here = fileURLToPath(import.meta.url);\nspawnWithoutGitEnv('node', ['--test']);"), null);
	assert.ok(RUNNER.test("node tools/tier-fast.mjs <components>"));
	assert.ok(!RUNNER.test("pnpm test && pnpm build"));
});

test("every GIT_* variable is removed, whatever its letter case", () => {
	const env = { GIT_DIR: "/a", GIT_INDEX_FILE: "/b", Git_Work_Tree: "/c", git_prefix: "d/" };
	assert.deepEqual(withoutGitEnv(env), {});
});

test("everything that is not a GIT_* variable is kept, GITHUB_* and a bare GIT included", () => {
	const env = { PATH: "/bin", GITHUB_TOKEN: "t", GIT: "g", HOME: "/h", GIT_DIR: "/a" };
	assert.deepEqual(withoutGitEnv(env), { PATH: "/bin", GITHUB_TOKEN: "t", GIT: "g", HOME: "/h" });
});
