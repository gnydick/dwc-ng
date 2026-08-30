/**
 * The mock-duet PID registry (GIT_172).
 *
 * These tests drive REAL processes into a REAL git repository made in a temp
 * directory. A fake registry would hold constant exactly the dimension that
 * failed on 2026-08-29 — a process that dies before binding, and a PID that
 * has been recycled — so nothing here is stubbed: mocks are spawned, killed,
 * and the registry is read back off disk.
 */

import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	classifyPort,
	portTag,
	ticketFromSegment,
	ticketPort,
	TICKET_PORT_BASE,
	UAT_MOCK_PORT,
	UAT_VITE_PORT,
} from "../src/ports.ts";
import {
	identify,
	isMockCommandLine,
	isMockProcess,
	LINKED_PREFIX,
	MAIN_SEGMENT,
	probeMachine,
	readEntries,
	resolveRegistry,
	stopEntry,
	toplevelForSegment,
	type PidEntry,
} from "../src/pidfile.ts";

const SRC = dirname(fileURLToPath(new URL("../src/cli.ts", import.meta.url)));
const CLI = join(SRC, "cli.ts");

// --------------------------------------------------------------------------
// scaffolding: a throwaway git repo that owns its own target/run tree
// --------------------------------------------------------------------------

const scratchDirs: string[] = [];
const spawned: ChildProcess[] = [];

function newRepo(): string {
	const root = mkdtempSync(join(tmpdir(), "dwcmock-"));
	scratchDirs.push(root);
	execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
	execFileSync("git", ["config", "user.email", "t@example.invalid"], { cwd: root, stdio: "ignore" });
	execFileSync("git", ["config", "user.name", "t"], { cwd: root, stdio: "ignore" });
	writeFileSync(join(root, "seed.txt"), "seed\n");
	execFileSync("git", ["add", "seed.txt"], { cwd: root, stdio: "ignore" });
	execFileSync("git", ["commit", "-qm", "seed"], { cwd: root, stdio: "ignore" });
	return root;
}

/**
 * Spawn the REAL cli, exactly as `mockctl` does, with its registry rooted in
 * `repo`. Nothing about the registration path is stubbed.
 */
function spawnMock(repo: string, args: string[]): ChildProcess {
	const child = spawn(process.execPath, ["--title=mock-duet", CLI, ...args], {
		cwd: repo,
		stdio: ["ignore", "pipe", "pipe"],
	});
	spawned.push(child);
	return child;
}

function exitOf(child: ChildProcess): Promise<number> {
	return new Promise(resolve => child.on("exit", code => resolve(code ?? -1)));
}

function registryDir(repo: string): string {
	// Derived through the same resolver the mock itself uses, so the test can
	// never "agree" with the code by accident of path normalisation.
	return resolveRegistry(repo).mocksDir;
}

function pidFilesIn(repo: string): string[] {
	try {
		return readdirSync(registryDir(repo)).filter(n => /^\d+$/.test(n));
	} catch {
		return [];
	}
}

async function waitFor(predicate: () => boolean, ms = 20_000): Promise<boolean> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (predicate()) return true;
		await new Promise(r => setTimeout(r, 50));
	}
	return predicate();
}

after(() => {
	for (const child of spawned) {
		if (child.pid !== undefined && child.exitCode === null) {
			try {
				child.kill("SIGKILL");
			} catch {
				/* already gone */
			}
		}
	}
	for (const dir of scratchDirs) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			/* windows can hold a handle briefly; the temp dir is disposable */
		}
	}
});

// --------------------------------------------------------------------------

describe("port classes (ports.ts)", () => {
	test("the UAT pair is the documented fixed pair", () => {
		assert.equal(UAT_MOCK_PORT, 8970);
		assert.equal(UAT_VITE_PORT, 5173);
	});

	test("a ticket port is derived from the ticket number", () => {
		assert.equal(ticketPort(170), 8170);
		assert.equal(ticketPort(136), 8136);
		assert.equal(ticketPort(172), 8172);
		assert.equal(ticketPort(1), TICKET_PORT_BASE + 1);
	});

	test("a ticket can never derive the reserved UAT port", () => {
		// 8000 + 970 == 8970. Handing that number back would silently steal the
		// bookmark, so the function refuses instead.
		assert.throws(() => ticketPort(970), /RESERVED for the UAT stack/);
	});

	test("ports round-trip to a readable class tag", () => {
		assert.equal(portTag(UAT_MOCK_PORT), "UAT");
		assert.equal(portTag(5173), "-");
		assert.equal(portTag(null), "-");
		assert.deepEqual(classifyPort(8136), { kind: "ticket", ticket: 136 });
		assert.deepEqual(classifyPort(UAT_MOCK_PORT), { kind: "uat" });
	});

	test("a ticket tag is a QUESTION until the owning worktree corroborates it", () => {
		// 8975 was a SCAVENGED port on 2026-08-29, and arithmetic reads it as
		// "ticket 975". The bare tag must therefore hedge; only the segment that
		// owns the pidfile can settle it.
		assert.equal(portTag(8975), "GIT_975?");
		assert.equal(portTag(8170), "GIT_170?");
		assert.equal(portTag(8170, "wt-GIT_170"), "GIT_170");
		assert.equal(portTag(8170, "wt-GIT_172"), "GIT_170?", "a mismatched owner does not corroborate");
		assert.equal(portTag(8172, MAIN_SEGMENT), "GIT_172?");
	});

	test("the ticket port is derived from the worktree name, not typed twice", () => {
		assert.equal(ticketFromSegment("wt-GIT_170"), 170);
		assert.equal(ticketFromSegment("wt-GIT_172"), 172);
		assert.equal(ticketFromSegment(MAIN_SEGMENT), null);
		assert.equal(ticketFromSegment("wt-RULE-worktree-scoping"), null);
	});
});

describe("registry paths (pidfile.ts)", () => {
	test("the registry roots at the MAIN checkout when resolved from a linked worktree", () => {
		const repo = newRepo();
		const wt = join(repo, "wtrees", "GIT_999");
		mkdirSync(join(repo, "wtrees"), { recursive: true });
		execFileSync("git", ["worktree", "add", "-q", "-b", "GIT_999", wt], { cwd: repo, stdio: "ignore" });

		const fromMain = resolveRegistry(repo);
		const fromWorktree = resolveRegistry(wt);

		// THE point of the layout: one tree, so one command sees every worktree.
		assert.equal(fromWorktree.projectRoot, fromMain.projectRoot);
		assert.equal(fromWorktree.mocksRoot, fromMain.mocksRoot);
		// ...but a distinct directory inside it.
		assert.equal(fromMain.segment, MAIN_SEGMENT);
		assert.equal(fromWorktree.segment, `${LINKED_PREFIX}GIT_999`);
		assert.notEqual(fromWorktree.mocksDir, fromMain.mocksDir);
	});

	test("a segment round-trips to a path you can cd to", () => {
		const repo = newRepo();
		const wt = join(repo, "wtrees", "GIT_998");
		mkdirSync(join(repo, "wtrees"), { recursive: true });
		execFileSync("git", ["worktree", "add", "-q", "-b", "GIT_998", wt], { cwd: repo, stdio: "ignore" });

		const reg = resolveRegistry(wt);
		const back = toplevelForSegment(reg, reg.segment);
		assert.notEqual(back, null);
		assert.ok(existsSync(join(back as string, ".git")), `${back} should be a checkout`);
		assert.equal(toplevelForSegment(reg, MAIN_SEGMENT), reg.projectRoot);
		assert.equal(toplevelForSegment(reg, "wt-never-existed"), null);
	});

	test("a linked worktree named `main` cannot land on the main checkout's directory", () => {
		// The prefix makes the mapping injective: `main` is not in the image of
		// name -> "wt-" + name, so no worktree name can collide with it.
		const repo = newRepo();
		const wt = join(repo, "wtrees", "main");
		mkdirSync(join(repo, "wtrees"), { recursive: true });
		execFileSync("git", ["worktree", "add", "-q", "-b", "mainish", wt], { cwd: repo, stdio: "ignore" });

		const fromMain = resolveRegistry(repo);
		const fromWorktree = resolveRegistry(wt);
		assert.equal(fromWorktree.segment, "wt-main");
		assert.notEqual(fromWorktree.segment, fromMain.segment);
		assert.notEqual(fromWorktree.mocksDir, fromMain.mocksDir);
	});
});

describe("registration (Invariant A: no pidfile without a bound socket)", () => {
	test("the pidfile appears only after the bind, is named by pid, and holds the RESOLVED port", async () => {
		const repo = newRepo();
		// Port 0 means the kernel picks. Nothing on the command line could have
		// told the registry which port to write, so the content can only have
		// come from the resolved listen().
		const child = spawnMock(repo, ["--port", "0", "--snapshot", ""]);
		const pid = child.pid as number;
		const file = join(registryDir(repo), String(pid));
		assert.ok(await waitFor(() => existsSync(file)), "pidfile should appear");

		const port = Number(readFileSync(file, "utf8").trim());
		assert.ok(Number.isInteger(port) && port > 0, `content should be a port, got ${port}`);
		assert.notEqual(port, 0);

		// The port in the file is the one actually serving.
		const res = await fetch(`http://127.0.0.1:${port}/rr_connect?password=&sessionKey=yes`);
		const body = (await res.json()) as { err?: number };
		assert.equal(body.err, 0);

		child.kill("SIGKILL");
		await exitOf(child);
	});

	test("a start that dies in argument parsing leaves NO pidfile", async () => {
		// This is 2026-08-29 exactly: parseArgs rejected the arguments before a
		// socket existed, and the operator confirmed the "start" by curling the
		// port — which an unrelated orphan answered.
		const repo = newRepo();
		const child = spawnMock(repo, ["--scenario", "no-such-scenario"]);
		const code = await exitOf(child);
		assert.notEqual(code, 0, "the start should have failed");
		assert.deepEqual(pidFilesIn(repo), [], "a failed start must register nothing");
	});

	test("a start that loses the port race leaves NO pidfile", async () => {
		const repo = newRepo();
		const first = spawnMock(repo, ["--port", "0", "--snapshot", ""]);
		const firstFile = join(registryDir(repo), String(first.pid));
		assert.ok(await waitFor(() => existsSync(firstFile)));
		const port = readFileSync(firstFile, "utf8").trim();

		const second = spawnMock(repo, ["--port", port, "--snapshot", ""]);
		const code = await exitOf(second);
		assert.notEqual(code, 0, "the second bind should have failed");
		assert.deepEqual(pidFilesIn(repo), [String(first.pid)], "only the winner is registered");

		first.kill("SIGKILL");
		await exitOf(first);
	});

	test("a bare `--` from the package manager does not kill the start", async () => {
		const repo = newRepo();
		const child = spawnMock(repo, ["--", "--port", "0", "--snapshot", ""]);
		const file = join(registryDir(repo), String(child.pid));
		assert.ok(await waitFor(() => existsSync(file)), "pnpm's separator must not be fatal");
		child.kill("SIGKILL");
		await exitOf(child);
	});
});

describe("teardown", () => {
	test("the pidfile is removed on a clean exit", async () => {
		// Drives the registration path in a real child that then exits
		// normally, which is the route every graceful stop takes: the signal
		// handler closes the server and calls process.exit, and the 'exit'
		// handler unlinks. (A SIGINT cannot be delivered programmatically to a
		// detached process on Windows, so the exit handler is exercised
		// directly rather than through a signal we cannot send here.)
		const repo = newRepo();
		const script = join(repo, "register-then-exit.mjs");
		writeFileSync(
			script,
			`import { createMockServer } from ${JSON.stringify(pathToFileURL(join(SRC, "server.ts")).href)};\n` +
				`import { listenAndRegister } from ${JSON.stringify(pathToFileURL(join(SRC, "pidfile.ts")).href)};\n` +
				`const mock = createMockServer({ tickMs: 0 });\n` +
				`const reg = await listenAndRegister(mock, 0, "127.0.0.1", process.cwd());\n` +
				`console.log(reg.file);\n` +
				`await mock.close();\n` +
				`process.exit(0);\n`,
		);
		const child = spawn(process.execPath, ["--title=mock-duet", script], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
		spawned.push(child);
		let out = "";
		let err = "";
		child.stdout?.on("data", d => (out += String(d)));
		child.stderr?.on("data", d => (err += String(d)));
		const code = await exitOf(child);
		assert.equal(code, 0, `child failed: ${out}
${err}`);
		const file = out.trim().split("\n")[0] as string;
		assert.ok(file.length > 0, "child should have printed its pidfile path");
		assert.equal(existsSync(file), false, "a clean exit must unregister");
		assert.deepEqual(pidFilesIn(repo), []);
	});

	test(
		"SIGTERM unregisters gracefully",
		{
			// On Windows a signal cannot be delivered to another process from
			// here: process.kill maps to TerminateProcess, which is a hard kill
			// by definition. The handler it would have run routes through
			// process.exit, which the test above exercises directly; the case
			// left uncovered on Windows is signal DELIVERY, not the teardown.
			skip: process.platform === "win32" ? "signals cannot be delivered programmatically on Windows" : false,
		},
		async () => {
			const repo = newRepo();
			const child = spawnMock(repo, ["--port", "0", "--snapshot", ""]);
			const file = join(registryDir(repo), String(child.pid));
			assert.ok(await waitFor(() => existsSync(file)));
			child.kill("SIGTERM");
			await exitOf(child);
			assert.equal(existsSync(file), false, "a graceful stop must unregister");
		},
	);

	test("a hard kill leaves the pidfile, and status calls it stale rather than running", async () => {
		const repo = newRepo();
		const child = spawnMock(repo, ["--port", "0", "--snapshot", ""]);
		const file = join(registryDir(repo), String(child.pid));
		assert.ok(await waitFor(() => existsSync(file)));
		child.kill("SIGKILL");
		await exitOf(child);
		// The file survives — that is unavoidable and it is why status classifies.
		assert.ok(existsSync(file), "a hard kill cannot run the exit handler");

		const reg = resolveRegistry(repo);
		const entry = readEntries(reg).find(e => e.pid === child.pid);
		assert.ok(entry !== undefined);
		const verdict = identify(entry, probeMachine());
		assert.notEqual(verdict.kind, "running");
	});
});

describe("Invariant B: the three-factor kill guard", () => {
	test("factor (a): a PID whose process is not a mock is never killed", async () => {
		const repo = newRepo();
		mkdirSync(registryDir(repo), { recursive: true });
		// An innocent bystander with a perfectly ordinary node command line.
		const innocent = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
		spawned.push(innocent);
		const pid = innocent.pid as number;
		await waitFor(() => (probeMachine().procs?.has(pid) ?? false), 10_000);

		const file = join(registryDir(repo), String(pid));
		writeFileSync(file, "8172\n");
		const reg = resolveRegistry(repo);
		const entry = readEntries(reg).find(e => e.pid === pid) as PidEntry;
		assert.ok(entry !== undefined);

		const verdict = identify(entry, probeMachine());
		assert.equal(verdict.kind, "reused", "a non-mock command line must fail factor (a)");

		const outcome = stopEntry(entry, probeMachine());
		assert.equal(outcome.killed, false, "stop must kill NOTHING here");
		assert.equal(outcome.forgotten, true, "the stale file is removed");
		assert.equal(existsSync(file), false);
		// Proof by effect, not by exit code: the bystander is still running.
		assert.equal(innocent.exitCode, null);
		assert.ok(probeMachine().procs?.has(pid), "the innocent process must survive");
		innocent.kill("SIGKILL");
	});

	test("factor (b): a live mock that is not listening on the file's port is not killed", async () => {
		const repo = newRepo();
		const child = spawnMock(repo, ["--port", "0", "--snapshot", ""]);
		const realFile = join(registryDir(repo), String(child.pid));
		assert.ok(await waitFor(() => existsSync(realFile)));

		// Same PID, same real mock — but a pidfile naming a port it does not hold.
		writeFileSync(realFile, "8173\n");
		const reg = resolveRegistry(repo);
		const entry = readEntries(reg).find(e => e.pid === child.pid) as PidEntry;
		const verdict = identify(entry, probeMachine());
		assert.equal(verdict.kind, "reused");
		assert.match(verdict.kind === "reused" ? verdict.reason : "", /not the process listening on port 8173/);

		const outcome = stopEntry(entry, probeMachine());
		assert.equal(outcome.killed, false);
		assert.equal(child.exitCode, null, "the mock must still be running");

		child.kill("SIGKILL");
		await exitOf(child);
	});

	test("factor (c): a process that started AFTER the pidfile was written cannot be the one that wrote it", async () => {
		// This is the factor that closes PID reuse, which the file format has
		// no field for: a recycled PID belongs to a process that started after
		// the original died, and the original wrote the file while alive.
		// Simulated here by back-dating the file, with (a) and (b) both TRUE —
		// so only factor (c) can be what refuses.
		const repo = newRepo();
		const child = spawnMock(repo, ["--port", "0", "--snapshot", ""]);
		const file = join(registryDir(repo), String(child.pid));
		assert.ok(await waitFor(() => existsSync(file)));

		const reg = resolveRegistry(repo);
		const before = readEntries(reg).find(e => e.pid === child.pid) as PidEntry;
		assert.equal(identify(before, probeMachine()).kind, "running", "(a) and (b) hold");

		const old = new Date(statSync(file).mtimeMs - 10 * 60 * 1000);
		utimesSync(file, old, old);
		const after2 = readEntries(reg).find(e => e.pid === child.pid) as PidEntry;
		const verdict = identify(after2, probeMachine());
		assert.equal(verdict.kind, "reused");
		assert.match(verdict.kind === "reused" ? verdict.reason : "", /started after this pidfile was written/);

		const outcome = stopEntry(after2, probeMachine());
		assert.equal(outcome.killed, false, "a start-time mismatch must kill nothing");
		assert.equal(child.exitCode, null);

		child.kill("SIGKILL");
		await exitOf(child);
	});

	test("all three factors together: a genuine mock IS stopped, verified by effect", async () => {
		const repo = newRepo();
		const child = spawnMock(repo, ["--port", "0", "--snapshot", ""]);
		const file = join(registryDir(repo), String(child.pid));
		assert.ok(await waitFor(() => existsSync(file)));
		const port = Number(readFileSync(file, "utf8").trim());

		const reg = resolveRegistry(repo);
		const entry = readEntries(reg).find(e => e.pid === child.pid) as PidEntry;
		const outcome = stopEntry(entry, probeMachine());

		assert.equal(outcome.killed, true, outcome.detail);
		assert.equal(outcome.forgotten, true);
		assert.equal(existsSync(file), false);
		// By effect: the socket is released, so the port can be taken again.
		const replacement = spawnMock(repo, ["--port", String(port), "--snapshot", ""]);
		const replacementFile = join(registryDir(repo), String(replacement.pid));
		assert.ok(await waitFor(() => existsSync(replacementFile)), "the port must actually be free");
		replacement.kill("SIGKILL");
		await exitOf(replacement);
	});

	test("a pidfile for a PID nobody holds is removed and kills nothing", () => {
		const repo = newRepo();
		mkdirSync(registryDir(repo), { recursive: true });
		// A PID that cannot be live: above the platform maximum.
		const file = join(registryDir(repo), "4294967290");
		writeFileSync(file, "8172\n");
		const reg = resolveRegistry(repo);
		const entry = readEntries(reg)[0] as PidEntry;
		assert.equal(identify(entry, probeMachine()).kind, "gone");
		const outcome = stopEntry(entry, probeMachine());
		assert.equal(outcome.killed, false);
		assert.equal(outcome.forgotten, true);
		assert.equal(existsSync(file), false);
	});

	test("an unparseable pidfile is refused, not guessed at", () => {
		const repo = newRepo();
		mkdirSync(registryDir(repo), { recursive: true });
		const file = join(registryDir(repo), String(process.pid));
		writeFileSync(file, "not-a-port\n");
		const reg = resolveRegistry(repo);
		const entry = readEntries(reg)[0] as PidEntry;
		assert.equal(entry.port, null);
		assert.equal(identify(entry, probeMachine()).kind, "unverifiable");
		const outcome = stopEntry(entry, probeMachine());
		assert.equal(outcome.killed, false);
		assert.equal(outcome.forgotten, false, "an unverifiable entry is left exactly as found");
		assert.ok(existsSync(file));
	});

	test("only bare-PID filenames are registry entries", () => {
		const repo = newRepo();
		mkdirSync(registryDir(repo), { recursive: true });
		writeFileSync(join(registryDir(repo), "1234"), "8172\n");
		writeFileSync(join(registryDir(repo), "1234.log"), "8172\n");
		writeFileSync(join(registryDir(repo), "README"), "hi\n");
		const entries = readEntries(resolveRegistry(repo));
		assert.deepEqual(entries.map(e => e.pid), [1234]);
	});
});

describe("mock process identification", () => {
	const proc = (executable: string, commandLine: string) => ({ pid: 1, executable, commandLine, startedAtMs: 0 });

	test("recognises how mock-duet is actually launched, and nothing else", () => {
		assert.ok(isMockCommandLine('"C:\\Program Files\\nodejs\\node.exe" packages/mock-duet/src/cli.ts --port 8975'));
		assert.ok(isMockCommandLine("node --title=mock-duet /tmp/x/src/cli.ts --port 0"));
		assert.ok(isMockCommandLine("node packages/mock-duet/src/cli.ts"));
		// POSIX ps, after --title has rewritten argv.
		assert.ok(isMockCommandLine("mock-duet"));
		// The control script must never see itself as a target.
		assert.equal(isMockCommandLine("node packages/mock-duet/src/mockctl.ts reap"), false);
		assert.equal(isMockCommandLine("node packages/ui/node_modules/vite/bin/vite.js"), false);
		assert.equal(isMockCommandLine("node --test"), false);
	});

	test("a SHELL that merely quotes the command is not a mock", () => {
		// Regression from the first live `status` run of this tool: five
		// bash.exe wrappers were listed as untracked orphans, each because its
		// command string MENTIONED a mock. On the command line alone, `reap`
		// would have killed the shells that Claude Code itself runs in.
		const wrapper =
			'"C:\\Program Files\\Git\\bin\\bash.exe" -c "... && eval ' +
			"'node packages/mock-duet/src/cli.ts --port 8975 --snapshot x.json --dsf 2>&1'\"";
		assert.ok(isMockCommandLine(wrapper), "the string does name a mock");
		assert.equal(isMockProcess(proc("bash.exe", wrapper)), false, "but bash.exe is not one");
		assert.ok(isMockProcess(proc("node.exe", "node packages/mock-duet/src/cli.ts --port 8172")));
		assert.ok(isMockProcess(proc("node", "mock-duet")));
		assert.equal(isMockProcess(proc("python.exe", "python -c 'mock-duet'")), false);
		assert.equal(isMockProcess(proc("node.exe", "node --test")), false);
	});
});
