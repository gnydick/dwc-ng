/**
 * The mock-duet PID registry (GIT_172).
 *
 * ## Layout (ruled by Gabe, 2026-08-29, verbatim)
 *
 * > "the pid file is in a target/* location in the root of the project so the
 * > control script can take worktree location, etc."
 *
 *     <project root>/target/run/mocks/<worktree>/<pid>      content: "<port>\n"
 *     <project root>/target/run/logs/<worktree>/<pid>.log   (detached starts)
 *
 * `<project root>` is the MAIN checkout's root — the parent of the COMMON
 * `.git` directory — even when the mock was started from a linked worktree.
 * That is the whole point: one registry, so one control script sees every
 * worktree's mocks. The file NAME is the PID; the file CONTENT is the port.
 * The format carries nothing else and may not be extended.
 *
 * ## Invariant A — a PID file cannot exist without a bound socket
 *
 * `writePidFile` is module-private. The only exported route that reaches it is
 * {@link listenAndRegister}, which awaits `MockServer.listen()` first and
 * writes the port that call RESOLVED — never a port a caller handed in. There
 * is no expressible call that registers an unbound port, so a start that dies
 * in `parseArgs` (2026-08-29) or loses a port race leaves nothing behind.
 *
 * ## Invariant B — nothing but the registered mock can be killed
 *
 * PIDs recycle, and the file format has no start time to compare against. The
 * hole is closed WITHIN the format by three factors, ALL required before any
 * kill (see {@link identify}):
 *
 *   (a) the live process holding that PID has a mock-duet command line;
 *   (b) that PID is the process actually LISTENING on the file's port;
 *   (c) the process started no later than the PID file's mtime.
 *
 * (c) comes free from filesystem metadata rather than file content, and it is
 * the factor that closes recycling outright: a recycled PID belongs to a
 * process that started after the original died, and the original was alive
 * from before it wrote the file until it died — so a recycled process's start
 * time is necessarily AFTER the file's mtime.
 *
 * Kills are verified BY EFFECT (process gone and port released), never by exit
 * code: `pkill` exits 0 on Windows while leaving the process running
 * (docs/LEARNINGS.md).
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import process from "node:process";
import type { MockServer } from "./server.ts";

// ---------------------------------------------------------------------------
// Registry paths
// ---------------------------------------------------------------------------

/** Segment used for the main checkout. Cannot collide — see {@link segmentFor}. */
export const MAIN_SEGMENT = "main";
/** Every LINKED worktree's segment carries this prefix. */
export const LINKED_PREFIX = "wt-";

export interface Registry {
	/** Absolute root of the MAIN checkout (parent of the common `.git`). */
	projectRoot: string;
	/** Absolute path of the COMMON `.git` directory. */
	gitCommonDir: string;
	/** Absolute toplevel of the checkout this registry was resolved FROM. */
	fromToplevel: string;
	/** Directory segment naming that checkout (see {@link segmentFor}). */
	segment: string;
	/** `<projectRoot>/target/run/mocks` */
	mocksRoot: string;
	/** `<projectRoot>/target/run/mocks/<segment>` */
	mocksDir: string;
	/** `<projectRoot>/target/run/logs/<segment>` */
	logsDir: string;
}

function git(args: string[], cwd: string): string {
	return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Normalise for comparison: forward slashes, no trailing separator. */
function norm(p: string): string {
	const s = p.replace(/\\/g, "/");
	return s.length > 1 && s.endsWith("/") ? s.slice(0, -1) : s;
}

/**
 * Map a checkout to its registry directory segment.
 *
 * The main checkout gets `main`; every linked worktree gets `wt-<git worktree
 * name>`. Git's worktree names are unique BY GIT'S OWN CONSTRUCTION (they are
 * the directory names under `<common>/worktrees/`, and git de-duplicates them),
 * and `main` is not in the image of `name -> "wt-" + name`, so the mapping is
 * injective: a linked worktree literally named `main` becomes `wt-main` and
 * still cannot land on the main checkout's directory.
 */
function segmentFor(gitDir: string, gitCommonDir: string): string {
	return norm(gitDir) === norm(gitCommonDir) ? MAIN_SEGMENT : LINKED_PREFIX + basename(norm(gitDir));
}

/**
 * Resolve the registry from any directory inside the repository.
 *
 * `--git-common-dir` is the MAIN checkout's `.git` even when called from a
 * linked worktree — that is what puts every worktree's mocks in one tree.
 */
export function resolveRegistry(cwd: string = process.cwd()): Registry {
	const gitCommonDir = resolve(git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd));
	const gitDir = resolve(git(["rev-parse", "--path-format=absolute", "--git-dir"], cwd));
	const fromToplevel = resolve(git(["rev-parse", "--show-toplevel"], cwd));
	const projectRoot = dirname(gitCommonDir);
	const segment = segmentFor(gitDir, gitCommonDir);
	const mocksRoot = join(projectRoot, "target", "run", "mocks");
	return {
		projectRoot,
		gitCommonDir,
		fromToplevel,
		segment,
		mocksRoot,
		mocksDir: join(mocksRoot, segment),
		logsDir: join(projectRoot, "target", "run", "logs", segment),
	};
}

/**
 * Reverse {@link segmentFor}: the checkout a segment names, or `null` if that
 * worktree is gone. This is what makes `status` print a path you can `cd` to.
 */
export function toplevelForSegment(reg: Registry, segment: string): string | null {
	if (segment === MAIN_SEGMENT) return reg.projectRoot;
	if (!segment.startsWith(LINKED_PREFIX)) return null;
	const gitdirFile = join(reg.gitCommonDir, "worktrees", segment.slice(LINKED_PREFIX.length), "gitdir");
	try {
		// The file holds `<toplevel>/.git`; its directory is the toplevel.
		return dirname(resolve(readFileSync(gitdirFile, "utf8").trim()));
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Reading the registry
// ---------------------------------------------------------------------------

export interface PidEntry {
	segment: string;
	pid: number;
	/** Port as recorded in the file, or `null` when the content is unparseable. */
	port: number | null;
	file: string;
	/** Registration time: the file is written immediately after the bind. */
	mtimeMs: number;
}

const PID_NAME = /^\d+$/;
const PORT_BODY = /^\d+$/;

/** Every PID file in the registry, across all worktrees, oldest name first. */
export function readEntries(reg: Registry): PidEntry[] {
	let segments: string[];
	try {
		segments = readdirSync(reg.mocksRoot, { withFileTypes: true })
			.filter(d => d.isDirectory())
			.map(d => d.name);
	} catch {
		return [];
	}
	const entries: PidEntry[] = [];
	for (const segment of segments.sort()) {
		const dir = join(reg.mocksRoot, segment);
		let names: string[];
		try {
			names = readdirSync(dir);
		} catch {
			continue;
		}
		for (const name of names.sort((a, b) => Number(a) - Number(b))) {
			// Only bare-PID names are registry entries. Anything else in the
			// directory (an editor swap file, a stray log) is ignored rather
			// than half-parsed.
			if (!PID_NAME.test(name)) continue;
			const file = join(dir, name);
			let mtimeMs: number;
			try {
				mtimeMs = statSync(file).mtimeMs;
			} catch {
				continue;
			}
			let port: number | null = null;
			try {
				const body = readFileSync(file, "utf8").trim();
				if (PORT_BODY.test(body)) port = Number(body);
			} catch {
				port = null;
			}
			entries.push({ segment, pid: Number(name), port, file, mtimeMs });
		}
	}
	return entries;
}

/** Remove a PID file. Removing a file kills nothing — that is the point. */
export function forgetEntry(entry: PidEntry): void {
	try {
		rmSync(entry.file, { force: true });
	} catch {
		/* already gone */
	}
}

// ---------------------------------------------------------------------------
// Process and socket probes
// ---------------------------------------------------------------------------

export interface ProcInfo {
	pid: number;
	/** Executable file name, e.g. `node.exe` / `node`. */
	executable: string;
	commandLine: string;
	/** Process creation time, ms since epoch. */
	startedAtMs: number;
}

/**
 * Does this command line NAME a mock-duet?
 *
 * Three accepted signals, any one sufficient:
 *  - `--title=mock-duet`, which `packages/mock-duet` puts on every `start`;
 *  - a leading `mock-duet`, which is what POSIX `ps -o args=` shows once that
 *    title has rewritten argv;
 *  - an entry-point path ending `mock-duet/src/cli.ts`, which is how the mock
 *    is invoked from a repository root (`node packages/mock-duet/src/cli.ts`).
 *
 * `mockctl.ts` itself matches none of them, so a control run never sees itself.
 *
 * THIS IS ONLY HALF THE TEST — callers use {@link isMockProcess}. A command
 * line is a string, and plenty of processes carry this one without being it:
 * the very first `status` run of this tool listed five `bash.exe` wrappers as
 * orphans, because each held a shell command that MENTIONED a mock. On the
 * string alone, `reap` would have killed those shells.
 */
export function isMockCommandLine(commandLine: string): boolean {
	return (
		/--title=mock-duet\b/i.test(commandLine) ||
		/^"?mock-duet\b/i.test(commandLine.trim()) ||
		/mock-duet[\\/]src[\\/]cli\.ts\b/i.test(commandLine)
	);
}

const NODE_EXECUTABLE = /^node(\.exe)?$/i;

/**
 * Is this process a mock-duet?
 *
 * Both halves are required: the process must BE node, and its command line
 * must name the mock. A shell that merely quotes the command is not the thing
 * the command would have started.
 */
export function isMockProcess(proc: ProcInfo): boolean {
	return NODE_EXECUTABLE.test(proc.executable) && isMockCommandLine(proc.commandLine);
}

function powershell(script: string): string {
	return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
		encoding: "utf8",
		maxBuffer: 16 * 1024 * 1024,
		stdio: ["ignore", "pipe", "pipe"],
	});
}

function parseJsonArray(raw: string): unknown[] {
	const text = raw.trim();
	if (text === "") return [];
	const parsed: unknown = JSON.parse(text);
	return Array.isArray(parsed) ? parsed : [parsed];
}

/** Parse POSIX `ps -o etime=` (`[[dd-]hh:]mm:ss`) into seconds. */
function parseEtime(etime: string): number | null {
	const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(etime.trim());
	if (m === null) return null;
	const [, d, h, mm, ss] = m;
	return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(mm ?? 0) * 60 + Number(ss ?? 0);
}

/**
 * EVERY live process, by PID — not just the node ones.
 *
 * The width matters for honesty, not for speed: if this only listed node
 * processes, a PID held by anything else would read as "no such process", and
 * `status` would call a recycled PID "gone". It never becomes a safety hole
 * (nothing is killed on "gone"), but it would be a confident lie in a table
 * whose whole job is telling you what is actually there.
 *
 * Windows reads `Win32_Process` (command line and creation time in one query);
 * a process whose command line we may not read comes back blank, which fails
 * the mock-identity factor and so is never killed. POSIX reads `ps`. A
 * platform that answers neither yields `null`, and every caller treats `null`
 * as "cannot verify" rather than "nothing there".
 */
export function probeProcesses(): Map<number, ProcInfo> | null {
	try {
		if (process.platform === "win32") {
			const raw = powershell(
				"Get-CimInstance Win32_Process | " +
					"Select-Object ProcessId, Name, CommandLine, " +
					"@{n='Created';e={$_.CreationDate.ToUniversalTime().ToString('o')}} | " +
					"ConvertTo-Json -Compress -Depth 2",
			);
			const out = new Map<number, ProcInfo>();
			for (const row of parseJsonArray(raw)) {
				const r = row as { ProcessId?: number; Name?: string | null; CommandLine?: string | null; Created?: string };
				if (typeof r.ProcessId !== "number") continue;
				const startedAtMs = typeof r.Created === "string" ? Date.parse(r.Created) : Number.NaN;
				out.set(r.ProcessId, {
					pid: r.ProcessId,
					executable: r.Name ?? "",
					commandLine: r.CommandLine ?? "",
					startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : 0,
				});
			}
			return out;
		}
		// `comm` is the real executable; `args` is what the process ADVERTISES,
		// and --title rewrites it. Both are needed: one for identity, one for
		// the mock marker.
		const raw = execFileSync("ps", ["-A", "-o", "pid=,etime=,comm=,args="], {
			encoding: "utf8",
			maxBuffer: 16 * 1024 * 1024,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const now = Date.now();
		const out = new Map<number, ProcInfo>();
		for (const line of raw.split("\n")) {
			const m = /^\s*(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line);
			if (m === null) continue;
			const pid = Number(m[1]);
			const seconds = parseEtime(m[2] ?? "");
			out.set(pid, {
				pid,
				executable: basename(m[3] ?? ""),
				commandLine: m[4] ?? "",
				startedAtMs: seconds === null ? 0 : now - seconds * 1000,
			});
		}
		return out;
	} catch {
		return null;
	}
}

/**
 * PIDs listening on each TCP port.
 *
 * `null` means the platform could not be asked — NOT that nothing is
 * listening. Every caller refuses to kill on `null` rather than guessing.
 */
export function probeListeners(): Map<number, number[]> | null {
	try {
		if (process.platform === "win32") {
			const raw = powershell(
				"Get-NetTCPConnection -State Listen | Select-Object LocalPort, OwningProcess | ConvertTo-Json -Compress",
			);
			const out = new Map<number, number[]>();
			for (const row of parseJsonArray(raw)) {
				const r = row as { LocalPort?: number; OwningProcess?: number };
				if (typeof r.LocalPort !== "number" || typeof r.OwningProcess !== "number") continue;
				const list = out.get(r.LocalPort) ?? [];
				if (!list.includes(r.OwningProcess)) list.push(r.OwningProcess);
				out.set(r.LocalPort, list);
			}
			return out;
		}
		const raw = execFileSync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-FpPn"], {
			encoding: "utf8",
			maxBuffer: 16 * 1024 * 1024,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const out = new Map<number, number[]>();
		let pid = 0;
		for (const line of raw.split("\n")) {
			if (line.startsWith("p")) pid = Number(line.slice(1));
			else if (line.startsWith("n")) {
				const m = /:(\d+)$/.exec(line);
				if (m === null) continue;
				const port = Number(m[1]);
				const list = out.get(port) ?? [];
				if (!list.includes(pid)) list.push(pid);
				out.set(port, list);
			}
		}
		return out;
	} catch {
		return null;
	}
}

export interface Snapshot {
	procs: Map<number, ProcInfo> | null;
	listeners: Map<number, number[]> | null;
}

/** One consistent read of the machine, shared by every entry in a command. */
export function probeMachine(): Snapshot {
	return { procs: probeProcesses(), listeners: probeListeners() };
}

// ---------------------------------------------------------------------------
// Identity — the three-factor guard
// ---------------------------------------------------------------------------

/**
 * Slack allowed on factor (c). The process necessarily starts BEFORE it writes
 * its PID file, so in a perfect world `startedAtMs <= mtimeMs` with no slack at
 * all; the allowance only absorbs the clock-source difference between WMI's
 * `CreationDate` and the filesystem's mtime.
 */
export const START_SKEW_MS = 1000;

export type Verdict =
	| { kind: "running"; proc: ProcInfo }
	/** No process holds that PID. Hard-killed, or crashed. */
	| { kind: "gone"; reason: string }
	/** A process holds that PID, and it is provably not our mock. */
	| { kind: "reused"; proc: ProcInfo; reason: string }
	/** A factor could not be evaluated. Never a licence to kill. */
	| { kind: "unverifiable"; reason: string };

/**
 * Decide what a PID file refers to. This is the ONLY place a PID becomes
 * eligible to be killed, and it says yes only when all three factors hold.
 */
export function identify(entry: PidEntry, snap: Snapshot): Verdict {
	if (entry.port === null) {
		return { kind: "unverifiable", reason: "pidfile content is not a port number" };
	}
	if (snap.procs === null) {
		return { kind: "unverifiable", reason: "cannot enumerate processes on this platform" };
	}
	const proc = snap.procs.get(entry.pid);
	if (proc === undefined) {
		return { kind: "gone", reason: "no live process holds this PID" };
	}
	// (a) it IS a mock-duet process (node, running the mock's entry point)
	if (!isMockProcess(proc)) {
		return { kind: "reused", proc, reason: "PID belongs to a process that is not a mock-duet" };
	}
	// (b) listening on the recorded port
	if (snap.listeners === null) {
		return { kind: "unverifiable", reason: "cannot enumerate listening sockets on this platform" };
	}
	const owners = snap.listeners.get(entry.port) ?? [];
	if (!owners.includes(entry.pid)) {
		return {
			kind: "reused",
			proc,
			reason: `PID is not the process listening on port ${entry.port}` +
				(owners.length > 0 ? ` (that is PID ${owners.join(", ")})` : " (nothing is)"),
		};
	}
	// (c) started no later than the registration
	if (proc.startedAtMs > entry.mtimeMs + START_SKEW_MS) {
		return {
			kind: "reused",
			proc,
			reason: "process started after this pidfile was written, so it cannot be the process that wrote it",
		};
	}
	return { kind: "running", proc };
}

// ---------------------------------------------------------------------------
// Stopping, verified by effect
// ---------------------------------------------------------------------------

export interface StopOutcome {
	pid: number;
	port: number | null;
	/** Whether a process was actually terminated. */
	killed: boolean;
	/** Whether the PID file was removed. */
	forgotten: boolean;
	detail: string;
}

function sleepSync(ms: number): void {
	// A control script that polls the OS has nothing to do while it waits, and
	// Atomics.wait is the only builtin synchronous sleep.
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Cheap existence poll: signal 0 tests for the process without touching it.
 * `EPERM` means it exists and we may not signal it, which is still "there".
 */
function pidExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * The authoritative "is it really gone" check, by EFFECT: no process holds the
 * PID (or the one that does is not a mock), and the port is released.
 */
function confirmedGone(pid: number, port: number | null): boolean {
	const procs = probeProcesses();
	if (procs === null) return false; // cannot tell -> never claim success
	const proc = procs.get(pid);
	const processGone = proc === undefined || !isMockProcess(proc);
	if (!processGone) return false;
	if (port === null) return true;
	const listeners = probeListeners();
	if (listeners === null) return false;
	return !(listeners.get(port) ?? []).includes(pid);
}

declare const vouched: unique symbol;

/**
 * A PID that has been checked and may be killed.
 *
 * @invariant nothing-is-killed-without-being-identified-first
 * @rung 7  sole-constructor type — `killVouched` is the only call that
 *          terminates anything, it is not exported, and it takes a
 *          `VouchedTarget` whose brand is a `unique symbol` this module never
 *          exports. `{ pid, port }` does not satisfy the type and no cast
 *          outside this file can name the brand, so reaching a kill from
 *          another module is a compile error rather than a dead process. Both
 *          minting sites check first: `stopEntry` only after `identify`
 *          returned `running` (all three factors), `stopLiveMock` only after
 *          re-reading the process's own identity in the same breath. Death is
 *          then confirmed BY EFFECT — the PID gone AND the port released —
 *          never by an exit code, because pkill exits 0 on Windows and
 *          leaves the process running
 * @why PIDs recycle, and the ruled pidfile format (name = pid, content = port)
 *      has no start time to disambiguate with. A `stop` that dereferenced a
 *      PID out of a file and killed it would eventually terminate a stranger's
 *      process on this machine. The three factors make that require a
 *      mock-duet, listening on exactly the recorded port, that started before
 *      the file naming it was written — and a recycled PID's process starts
 *      after the original died, hence after that write
 */
export type VouchedTarget = { readonly pid: number; readonly port: number | null; readonly [vouched]: true };

/**
 * Terminate a vouched-for target and confirm it BY EFFECT. `process.kill`
 * returning without throwing proves nothing — `pkill` exits 0 on Windows and
 * leaves the process running.
 */
function killVouched(target: VouchedTarget, graceMs = 5000): { gone: boolean; detail: string } {
	return killVerified(target.pid, target.port, graceMs);
}

function killVerified(pid: number, port: number | null, graceMs = 5000): { gone: boolean; detail: string } {
	const notes: string[] = [];
	try {
		process.kill(pid, "SIGTERM");
		notes.push("SIGTERM");
	} catch (err) {
		notes.push(`SIGTERM failed (${(err as Error).message})`);
	}
	const deadline = Date.now() + graceMs;
	while (Date.now() < deadline) {
		// Poll cheaply, then confirm expensively — the confirmation is what the
		// caller is allowed to believe, because an exit code is not evidence.
		if (!pidExists(pid) && confirmedGone(pid, port)) return { gone: true, detail: notes.join("; ") };
		sleepSync(150);
	}
	// Escalate. On Windows SIGTERM is already a hard terminate, but a wedged
	// process tree needs taskkill /T; on POSIX this is the real SIGKILL.
	try {
		if (process.platform === "win32") {
			execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
			notes.push("taskkill /T /F");
		} else {
			process.kill(pid, "SIGKILL");
			notes.push("SIGKILL");
		}
	} catch (err) {
		notes.push(`escalation failed (${(err as Error).message})`);
	}
	const hardDeadline = Date.now() + graceMs;
	while (Date.now() < hardDeadline) {
		if (!pidExists(pid) && confirmedGone(pid, port)) return { gone: true, detail: notes.join("; ") };
		sleepSync(150);
	}
	return { gone: false, detail: `${notes.join("; ")} — STILL ALIVE after ${graceMs * 2} ms` };
}

/**
 * Stop one registry entry.
 *
 * `running` -> kill, verify, then forget. Anything else kills NOTHING; a stale
 * or recycled entry is only forgotten, and an unverifiable one is left exactly
 * as it was found.
 */
export function stopEntry(entry: PidEntry, snap: Snapshot): StopOutcome {
	const verdict = identify(entry, snap);
	if (verdict.kind === "gone") {
		forgetEntry(entry);
		return { pid: entry.pid, port: entry.port, killed: false, forgotten: true, detail: `stale pidfile (${verdict.reason}) — removed, nothing killed` };
	}
	if (verdict.kind === "reused") {
		forgetEntry(entry);
		return { pid: entry.pid, port: entry.port, killed: false, forgotten: true, detail: `stale pidfile (${verdict.reason}) — removed, nothing killed` };
	}
	if (verdict.kind === "unverifiable") {
		return { pid: entry.pid, port: entry.port, killed: false, forgotten: false, detail: `REFUSED: ${verdict.reason}` };
	}
	// The ONE place a registry entry becomes killable: reached only after
	// identify() returned "running", i.e. after all three factors held.
	const target = { pid: entry.pid, port: entry.port } as VouchedTarget;
	const result = killVouched(target);
	if (!result.gone) {
		return { pid: entry.pid, port: entry.port, killed: false, forgotten: false, detail: `FAILED: ${result.detail}` };
	}
	forgetEntry(entry);
	return { pid: entry.pid, port: entry.port, killed: true, forgotten: true, detail: `stopped (${result.detail})` };
}

/**
 * Stop a live mock found by ENUMERATION rather than by a PID file — the `reap`
 * path, and the only way a mock started before the registry existed can be
 * cleaned up.
 *
 * The identity here is the process's own command line, re-read in this same
 * breath: a PID that died and was recycled between the caller's scan and now
 * cannot be mistaken for a mock. There is no pidfile to cross-check a port
 * against, and none is needed — the PID came from the enumeration itself, it
 * was not dereferenced out of a file someone else wrote.
 */
export function stopLiveMock(pid: number, port: number | null): { gone: boolean; killed: boolean; detail: string } {
	const fresh = probeProcesses();
	if (fresh === null) return { gone: false, killed: false, detail: "REFUSED: cannot enumerate processes" };
	const proc = fresh.get(pid);
	if (proc === undefined) return { gone: true, killed: false, detail: "gone before we reached it — nothing killed" };
	if (!isMockProcess(proc)) {
		return { gone: true, killed: false, detail: "PID no longer belongs to a mock — nothing killed" };
	}
	const result = killVouched({ pid, port } as VouchedTarget);
	return {
		gone: result.gone,
		killed: result.gone,
		detail: result.gone ? `stopped (${result.detail})` : `FAILED: ${result.detail}`,
	};
}

// ---------------------------------------------------------------------------
// Registration — the sole writer
// ---------------------------------------------------------------------------

export interface Registration {
	pid: number;
	port: number;
	file: string;
	segment: string;
	registry: Registry;
}

/** Set once, by {@link listenAndRegister}, for this process's own PID file. */
let ownFile: string | null = null;

function writePidFile(port: number, cwd: string): Registration {
	if (ownFile !== null) {
		throw new Error(`mock-duet already registered at ${ownFile}; one process registers once`);
	}
	const registry = resolveRegistry(cwd);
	mkdirSync(registry.mocksDir, { recursive: true });
	const file = join(registry.mocksDir, String(process.pid));
	writeFileSync(file, `${port}\n`, "utf8");
	ownFile = file;
	return { pid: process.pid, port, file, segment: registry.segment, registry };
}

function installTeardown(mock: MockServer): void {
	// Synchronous, because 'exit' handlers may not defer work.
	process.on("exit", () => {
		if (ownFile === null) return;
		try {
			rmSync(ownFile, { force: true });
		} catch {
			/* best effort: a hard kill can leave it, and status classifies that honestly */
		}
	});
	const signals: NodeJS.Signals[] = process.platform === "win32"
		? ["SIGINT", "SIGTERM", "SIGBREAK"]
		: ["SIGINT", "SIGTERM", "SIGHUP"];
	for (const signal of signals) {
		process.on(signal, () => {
			// Do not let a wedged close() strand the process (and its PID file).
			const bail = setTimeout(() => process.exit(0), 2000);
			bail.unref();
			void mock.close().then(
				() => process.exit(0),
				() => process.exit(0),
			);
		});
	}
}

/**
 * Bind, then register. **The only route by which a PID file comes to exist.**
 *
 * Registering also installs the teardown that removes the file on a clean
 * exit, so "registered" and "cleans up after itself" cannot come apart.
 *
 * @invariant pidfile-only-after-a-successful-bind
 * @rung 6  choke point — `writePidFile` is not exported, and this is the only
 *          exported function that reaches it. It awaits `MockServer.listen()`
 *          first and writes the port that call RESOLVED; no parameter carries
 *          a port to the write, so no caller can name one. A start that dies
 *          before this line (argument parsing, loading a capture) or loses the
 *          port race throws here and creates nothing. `writePidFile` also
 *          throws on a second call, so one process registers exactly once
 * @why on 2026-08-29 a mock start died in parseArgs before binding any socket,
 *      and `curl 127.0.0.1:8971/rr_connect` still answered healthily — from an
 *      unrelated orphan. A pidfile that can exist without a bound socket turns
 *      every later question ("is my mock up?", "whose process is this?") into
 *      the liveness probe that already lied once, one step from a UAT that
 *      would have validated the wrong code and looked green doing it
 * @debt rung 7 would make the resolved port a branded `BoundPort` mintable
 *       only by the bind, so even a future function inside this module could
 *       not write a port it had not watched a socket accept. Today the barrier
 *       stops at the module edge
 */
export async function listenAndRegister(
	mock: MockServer,
	requestedPort: number,
	host?: string,
	cwd: string = process.cwd(),
): Promise<Registration> {
	const port = await mock.listen(requestedPort, host);
	const registration = writePidFile(port, cwd);
	installTeardown(mock);
	return registration;
}

// ---------------------------------------------------------------------------
// Start logs
// ---------------------------------------------------------------------------
//
// A detached child cannot share the control script's stdio, so it gets a file.
// The plumbing lives HERE, with the rest of the `target/run` tree, because this
// package holds exactly two modules that may name a filesystem write and they
// own disjoint trees: `persist.ts` owns the mock's SD tree and machine state,
// `pidfile.ts` owns `<project root>/target/run`. A third writer anywhere is a
// test failure (`test/persist.test.ts`, "the only writers in the package").

/**
 * Open the log a detached start will write to.
 *
 * The child's PID names the log, and the PID is not known until spawn returns,
 * so the file starts under a placeholder name; {@link adoptStartLog} renames it.
 */
export function openStartLog(reg: Registry): { fd: number; path: string } {
	mkdirSync(reg.logsDir, { recursive: true });
	const path = join(reg.logsDir, `starting-${process.pid}.log`);
	return { fd: openSync(path, "w"), path };
}

/** Give a start log its final `<pid>.log` name. Returns the path it now has. */
export function adoptStartLog(reg: Registry, tempPath: string, pid: number): string {
	const final = join(reg.logsDir, `${pid}.log`);
	try {
		renameSync(tempPath, final);
		return final;
	} catch {
		return tempPath;
	}
}

/** Path a reader can `cd` to for a segment, or the segment itself if it is gone. */
export function describeSegment(reg: Registry, segment: string): string {
	const top = toplevelForSegment(reg, segment);
	return top === null ? `${segment} (worktree gone)` : top.split("/").join(sep);
}
