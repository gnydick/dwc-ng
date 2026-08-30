/**
 * `mockctl` — start, stop, inspect and reap mock-duet processes (GIT_172).
 *
 * Reached through the root package scripts:
 *
 *     pnpm mock:start [options]     start a detached mock, wait for it to
 *                                   REGISTER, then report
 *     pnpm mock:status              every tracked mock, every worktree, plus
 *                                   untracked orphans and the UAT stack
 *     pnpm mock:stop [filters]      stop tracked mocks
 *     pnpm mock:restart [options]   stop this worktree's mocks, start one
 *     pnpm mock:reap [--dry-run]    stop EVERY live mock-duet, tracked or not
 *
 * `stop` and `reap` are two verbs on purpose. `stop` only ever touches mocks
 * this registry knows about; `reap` goes by what is actually running, which is
 * the only thing that can clean up mocks started before the registry existed
 * (ten of them, on 2026-08-29). The destructive one has to be typed.
 *
 * Every kill goes through `pidfile.ts`, which checks three factors before it
 * touches a PID and confirms the result by effect. See that file's header.
 * Port policy lives in `ports.ts`. See that file's header.
 */

import { spawn } from "node:child_process";
import { closeSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { stripArgSeparators } from "./argv.ts";
import {
	adoptStartLog,
	describeSegment,
	forgetEntry,
	identify,
	isMockProcess,
	stopLiveMock,
	openStartLog,
	probeMachine,
	readEntries,
	resolveRegistry,
	stopEntry,
	type PidEntry,
	type ProcInfo,
	type Registry,
	type Snapshot,
} from "./pidfile.ts";
import { portTag, ticketFromSegment, ticketPort, TICKET_PORT_BASE, UAT_MOCK_PORT, UAT_VITE_PORT } from "./ports.ts";

const HERE = import.meta.dirname;
const CLI_PATH = join(HERE, "cli.ts");
const PACKAGE_DIR = dirname(HERE);

const HELP = `mockctl — lifecycle control for mock-duet processes

Usage: pnpm mock:<verb> [options]

PORTS — two classes, and they never overlap:

  UAT stack (reserved, exactly one at a time):  mock ${UAT_MOCK_PORT} + vite ${UAT_VITE_PORT}
      The stack Gabe drives. One bookmark, always the same numbers. Standing a
      new one up REQUIRES tearing the previous one down (pnpm mock:stop). Vite's
      half is pinned with strictPort:true in packages/ui/vite.config.ts, because
      vite silently increments when the port is taken and "the UAT is at ${UAT_VITE_PORT}"
      then becomes quietly false.

  Ticket scratch ports (derived, never scavenged):  8000 + <ticket>
      GIT_170 -> 8170, GIT_136 -> 8136. Derived from the worktree name, so a
      stray process names the ticket that owns it. ${UAT_MOCK_PORT} is reserved out of
      this range, so a ticket can never take the UAT slot.

Verbs:
  start [options]       Start a mock detached, from THIS worktree. Waits until
                        the child has REGISTERED its pidfile before reporting
                        success — a child that dies in argument parsing or
                        loses a port race is reported as a FAILURE with its
                        log, never as a start.
      --uat               use the reserved UAT port (${UAT_MOCK_PORT}). Must be explicit.
      --scratch           use this worktree's derived ticket port (the default
                          inside a GIT_<n> worktree)
      --port <n>          an explicit port, outside both classes
      <anything else>     passed straight through to mock-duet's cli
                          (pnpm mock -- --help)

  status                Every pidfile in the registry, for every worktree, with
                        its classification, plus the UAT stack and UNTRACKED
                        ORPHANS: live mock-duet processes with no pidfile.

  stop [filters]        Stop tracked mocks. With no filter, this worktree's.
      --all               every worktree's tracked mocks
      --port <n>          the tracked mock on this port
      --pid <n>           the tracked mock with this pid

  restart [options]     Stop this worktree's tracked mocks, then start one on
                        the same port.

  reap [options]        Stop EVERY live mock-duet process, tracked or not,
                        after printing the table of what it found. This is the
                        only verb that can clean up mocks started before the
                        registry existed — they have no pidfile, so nothing
                        else can see them.
      --dry-run           print the table and stop nothing
      --port <n>          restrict to mocks listening on this port (repeatable)

Registry layout (rooted at the MAIN checkout, so one command sees every
worktree):

  <project root>/target/run/mocks/<worktree>/<pid>     content: the port
  <project root>/target/run/logs/<worktree>/<pid>.log  detached start output
`;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

function pad(value: string, width: number): string {
	return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function classify(entry: PidEntry, snap: Snapshot): string {
	const verdict = identify(entry, snap);
	if (verdict.kind === "running") return "running";
	if (verdict.kind === "gone") return "stale pidfile (process gone)";
	if (verdict.kind === "reused") return `stale pidfile (${verdict.reason})`;
	return `unverifiable (${verdict.reason})`;
}

/** Live mock-duet processes, with the ports each is listening on. */
function liveMocks(snap: Snapshot): { proc: ProcInfo; ports: number[] }[] {
	if (snap.procs === null) return [];
	const portsByPid = new Map<number, number[]>();
	if (snap.listeners !== null) {
		for (const [port, pids] of snap.listeners) {
			for (const pid of pids) {
				const list = portsByPid.get(pid) ?? [];
				list.push(port);
				portsByPid.set(pid, list);
			}
		}
	}
	const out: { proc: ProcInfo; ports: number[] }[] = [];
	for (const proc of snap.procs.values()) {
		if (proc.pid === process.pid) continue;
		if (!isMockProcess(proc)) continue;
		out.push({ proc, ports: (portsByPid.get(proc.pid) ?? []).sort((a, b) => a - b) });
	}
	return out.sort((a, b) => a.proc.pid - b.proc.pid);
}

function pidsOn(snap: Snapshot, port: number): number[] | null {
	if (snap.listeners === null) return null;
	return snap.listeners.get(port) ?? [];
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

function cmdStatus(reg: Registry): void {
	const entries = readEntries(reg);
	const snap = probeMachine();

	console.log(`registry: ${reg.mocksRoot}`);
	console.log(`this worktree: ${reg.segment}  ->  ${reg.fromToplevel}`);
	console.log("");

	// --- the reserved UAT stack, first, because it is the one with a bookmark
	console.log(`UAT stack (reserved: mock ${UAT_MOCK_PORT} + vite ${UAT_VITE_PORT}, one at a time)`);
	const uatEntry = entries.find(e => e.port === UAT_MOCK_PORT);
	if (uatEntry === undefined) {
		const stray = pidsOn(snap, UAT_MOCK_PORT);
		if (stray === null) console.log(`  mock ${UAT_MOCK_PORT} : unknown (cannot enumerate sockets)`);
		else if (stray.length === 0) console.log(`  mock ${UAT_MOCK_PORT} : not running`);
		else console.log(`  mock ${UAT_MOCK_PORT} : LISTENING but untracked — pid ${stray.join(", ")}`);
	} else {
		console.log(
			`  mock ${UAT_MOCK_PORT} : ${classify(uatEntry, snap)} — pid ${uatEntry.pid}, ` +
				`worktree ${uatEntry.segment} (${describeSegment(reg, uatEntry.segment)})`,
		);
	}
	const vite = pidsOn(snap, UAT_VITE_PORT);
	if (vite === null) console.log(`  vite ${UAT_VITE_PORT} : unknown (cannot enumerate sockets)`);
	else if (vite.length === 0) console.log(`  vite ${UAT_VITE_PORT} : not listening`);
	else console.log(`  vite ${UAT_VITE_PORT} : listening — pid ${vite.join(", ")}`);
	console.log("");

	// --- everything the registry tracks
	if (entries.length === 0) {
		console.log("tracked mocks: none");
	} else {
		let segment = "";
		for (const entry of entries) {
			if (entry.segment !== segment) {
				segment = entry.segment;
				console.log(`${segment}  ->  ${describeSegment(reg, segment)}`);
				console.log(`  ${pad("PID", 9)}${pad("PORT", 7)}${pad("CLASS", 10)}STATUS`);
			}
			console.log(
				`  ${pad(String(entry.pid), 9)}${pad(entry.port === null ? "?" : String(entry.port), 7)}` +
					`${pad(portTag(entry.port, entry.segment), 10)}${classify(entry, snap)}`,
			);
		}
	}

	// --- and the leak the registry cannot see
	const tracked = new Set(entries.map(e => e.pid));
	const orphans = liveMocks(snap).filter(m => !tracked.has(m.proc.pid));
	console.log("");
	if (orphans.length === 0) {
		console.log("untracked orphans: none");
	} else {
		console.log("untracked orphans (live mock-duet, no pidfile — only `pnpm mock:reap` can stop these)");
		console.log(`  ${pad("PID", 9)}${pad("PORT", 7)}${pad("CLASS", 10)}COMMAND`);
		for (const { proc, ports } of orphans) {
			console.log(
				`  ${pad(String(proc.pid), 9)}${pad(ports.join(",") || "?", 7)}` +
					`${pad(portTag(ports[0] ?? null), 10)}${proc.commandLine}`,
			);
		}
	}
	if (snap.procs === null) console.log("\nWARNING: could not enumerate processes; nothing above is verified.");
	if (snap.listeners === null) console.log("\nWARNING: could not enumerate listening sockets; nothing can be stopped safely.");
}

// ---------------------------------------------------------------------------
// stop
// ---------------------------------------------------------------------------

interface StopFilter {
	all: boolean;
	port: number | null;
	pid: number | null;
}

function parseStopArgs(args: string[]): StopFilter {
	const filter: StopFilter = { all: false, port: null, pid: null };
	for (let i = 0; i < args.length; i++) {
		const arg = args[i] ?? "";
		if (arg === "--all") {
			filter.all = true;
		} else if (arg === "--port" || arg === "--pid") {
			const value = Number(args[++i]);
			if (!Number.isInteger(value)) fail(`${arg} needs a number`);
			if (arg === "--port") filter.port = value;
			else filter.pid = value;
		} else {
			fail(`stop: unknown option "${arg}"\n\n${HELP}`);
		}
	}
	return filter;
}

/** @returns the ports of the mocks actually stopped. */
function cmdStop(reg: Registry, args: string[]): number[] {
	const filter = parseStopArgs(args);
	const all = readEntries(reg);
	let selected = filter.all ? all : all.filter(e => e.segment === reg.segment);
	if (filter.port !== null) selected = selected.filter(e => e.port === filter.port);
	if (filter.pid !== null) selected = selected.filter(e => e.pid === filter.pid);

	if (selected.length === 0) {
		console.log(
			filter.all
				? "no tracked mocks in the registry."
				: `no tracked mocks for ${reg.segment} (${reg.fromToplevel}). Try --all, or pnpm mock:status.`,
		);
		return [];
	}
	const snap = probeMachine();
	const ports: number[] = [];
	let failures = 0;
	for (const entry of selected) {
		const outcome = stopEntry(entry, snap);
		console.log(`${entry.segment}  pid ${entry.pid}  port ${entry.port ?? "?"}  ${outcome.detail}`);
		if (outcome.killed && entry.port !== null) ports.push(entry.port);
		if (!outcome.killed && !outcome.forgotten) failures++;
	}
	if (failures > 0) process.exitCode = 1;
	return ports;
}

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

interface StartPlan {
	port: number;
	why: string;
	passthrough: string[];
}

/**
 * Decide the port, and say why.
 *
 * There is no path here that lands on an arbitrary port by accident: either
 * the caller named one, or it is derived from the worktree, or the command
 * refuses. Scavenging a free port is what made the 2026-08-29 orphans
 * anonymous.
 */
function planStart(reg: Registry, args: string[]): StartPlan {
	let uat = false;
	let scratch = false;
	let explicit: number | null = null;
	const passthrough: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i] ?? "";
		if (arg === "--uat") uat = true;
		else if (arg === "--scratch") scratch = true;
		else if (arg === "--port" || arg === "-p") {
			const value = Number(args[++i]);
			if (!Number.isInteger(value)) fail(`${arg} needs a port number`);
			explicit = value;
		} else if (arg.startsWith("--port=")) {
			const value = Number(arg.slice("--port=".length));
			if (!Number.isInteger(value)) fail(`${arg} needs a port number`);
			explicit = value;
		} else {
			passthrough.push(arg);
		}
	}
	if (uat && scratch) fail("start: --uat and --scratch are different stacks; pick one.");
	if (uat && explicit !== null && explicit !== UAT_MOCK_PORT) {
		fail(`start: --uat means port ${UAT_MOCK_PORT}; --port ${explicit} contradicts it.`);
	}
	if (uat) return { port: UAT_MOCK_PORT, why: "reserved UAT stack", passthrough };
	if (explicit !== null) {
		if (explicit === UAT_MOCK_PORT) {
			fail(
				`start: port ${UAT_MOCK_PORT} is RESERVED for the UAT stack Gabe bookmarks. ` +
					`If this IS the UAT stack, say so: pnpm mock:start --uat`,
			);
		}
		const derived = ticketFromSegment(reg.segment);
		const why =
			derived !== null && explicit === TICKET_PORT_BASE + derived
				? `explicit --port, and it is this worktree's ticket port for GIT_${derived}`
				: "explicit --port (outside both classes)";
		return { port: explicit, why, passthrough };
	}
	const ticket = ticketFromSegment(reg.segment);
	if (ticket === null) {
		fail(
			`start: nothing to derive a port from — worktree "${reg.segment}" does not name a ticket.\n` +
				`Say which stack this is:\n` +
				`  pnpm mock:start --uat          the reserved UAT stack (mock ${UAT_MOCK_PORT} + vite ${UAT_VITE_PORT})\n` +
				`  pnpm mock:start --port <n>     an explicit port\n` +
				`Inside a GIT_<n> worktree the ticket port (8000 + n) is derived automatically.`,
		);
	}
	let port: number;
	try {
		port = ticketPort(ticket);
	} catch (err) {
		fail(`start: ${(err as Error).message}`);
	}
	return { port, why: `ticket scratch port for GIT_${ticket} (8000 + ${ticket})`, passthrough };
}

async function cmdStart(reg: Registry, args: string[]): Promise<void> {
	const plan = planStart(reg, args);
	// The registry owns every path under target/run, log files included
	// (pidfile.ts): this module reads them, and writes nothing.
	const { fd, path: tmpLog } = openStartLog(reg);
	const childArgs = ["--title=mock-duet", CLI_PATH, "--port", String(plan.port), ...plan.passthrough];
	const child = spawn(process.execPath, childArgs, {
		cwd: PACKAGE_DIR,
		detached: true,
		stdio: ["ignore", fd, fd],
		windowsHide: true,
	});
	closeSync(fd);
	if (child.pid === undefined) fail("spawn failed: no pid");
	const pid = child.pid;
	const pidFile = join(reg.mocksDir, String(pid));

	let exited: number | null = null;
	child.on("exit", code => {
		exited = code ?? -1;
	});

	// Wait for REGISTRATION, not for liveness. A port that answers proves only
	// that SOMETHING is listening — on 2026-08-29 that something was an
	// unrelated orphan, and a start that had died in parseArgs was reported as
	// healthy. A pidfile named with this child's own pid cannot be anyone
	// else's, and (Invariant A) cannot exist unless this child bound a socket.
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		if (existsSync(pidFile)) {
			const port = readFileSync(pidFile, "utf8").trim();
			const log = adoptStartLog(reg, tmpLog, pid);
			child.unref();
			console.log("mock-duet started");
			console.log(`  worktree : ${reg.segment}  (${reg.fromToplevel})`);
			console.log(`  pid      : ${pid}`);
			console.log(`  port     : ${port}  [${portTag(Number(port), reg.segment)}]  ${plan.why}`);
			console.log(`  url      : http://127.0.0.1:${port}`);
			if (plan.port === UAT_MOCK_PORT) {
				console.log(`  vite     : run \`pnpm dev\` — pinned to ${UAT_VITE_PORT} (strictPort)`);
			}
			console.log(`  pidfile  : ${pidFile}`);
			console.log(`  log      : ${log}`);
			console.log(`  stop     : pnpm mock:stop --pid ${pid}`);
			return;
		}
		if (exited !== null) break;
		await new Promise(r => setTimeout(r, 100));
	}
	child.unref();
	const tail = readLog(tmpLog);
	if (exited !== null) {
		fail(
			`mock-duet FAILED to start on port ${plan.port} (pid ${pid} exited with code ${exited} before registering).\n` +
				"No pidfile was written, which is correct: nothing bound a socket.\n" +
				`--- ${tmpLog} ---\n${tail}`,
		);
	}
	fail(`mock-duet did not register within 30s (pid ${pid}).\n--- ${tmpLog} ---\n${tail}`);
}

function readLog(path: string): string {
	try {
		const text = readFileSync(path, "utf8");
		const lines = text.split("\n");
		return lines.length > 40 ? lines.slice(-40).join("\n") : text;
	} catch {
		return "(no output)";
	}
}

async function cmdRestart(reg: Registry, args: string[]): Promise<void> {
	const stopped = cmdStop(reg, []);
	console.log("");
	const namesPort = args.some(a => a === "--port" || a === "-p" || a.startsWith("--port=") || a === "--uat" || a === "--scratch");
	const first = stopped[0];
	if (!namesPort && stopped.length === 1 && first !== undefined) {
		console.log(`reusing port ${first}`);
		await cmdStart(reg, ["--port", String(first), ...args]);
		return;
	}
	await cmdStart(reg, args);
}

// ---------------------------------------------------------------------------
// reap
// ---------------------------------------------------------------------------

function cmdReap(reg: Registry, args: string[]): void {
	let dryRun = false;
	const ports: number[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i] ?? "";
		if (arg === "--dry-run") {
			dryRun = true;
		} else if (arg === "--port") {
			const value = Number(args[++i]);
			if (!Number.isInteger(value)) fail("--port needs a number");
			ports.push(value);
		} else {
			fail(`reap: unknown option "${arg}"\n\n${HELP}`);
		}
	}

	const snap = probeMachine();
	if (snap.procs === null) fail("reap: cannot enumerate processes on this platform; refusing to guess.");
	const entries = readEntries(reg);
	const byPid = new Map(entries.map(e => [e.pid, e]));
	let found = liveMocks(snap);
	if (ports.length > 0) found = found.filter(m => m.ports.some(p => ports.includes(p)));

	// The table comes FIRST, always, so nothing is destroyed unseen.
	console.log(ports.length > 0 ? `live mock-duet processes on port ${ports.join(", ")}:` : "live mock-duet processes:");
	if (found.length === 0) {
		console.log("  none");
		return;
	}
	console.log(`  ${pad("PID", 9)}${pad("PORT", 7)}${pad("CLASS", 10)}${pad("TRACKED", 20)}COMMAND`);
	for (const { proc, ports: p } of found) {
		const entry = byPid.get(proc.pid);
		console.log(
			`  ${pad(String(proc.pid), 9)}${pad(p.join(",") || "?", 7)}${pad(portTag(p[0] ?? null, entry?.segment), 10)}` +
				`${pad(entry === undefined ? "untracked orphan" : entry.segment, 20)}${proc.commandLine}`,
		);
	}
	if (dryRun) {
		console.log("\n--dry-run: nothing stopped.");
		return;
	}
	console.log("");
	let failures = 0;
	for (const { proc, ports: p } of found) {
		// stopLiveMock re-reads the process's own identity immediately before
		// terminating it. This module never reaches a kill on its own: the
		// terminate call is behind a brand only pidfile.ts can mint, and every
		// minting site checks first.
		const result = stopLiveMock(proc.pid, p[0] ?? null);
		const entry = byPid.get(proc.pid);
		if (result.gone && entry !== undefined) forgetEntry(entry);
		console.log(`pid ${proc.pid}: ${result.detail}`);
		if (!result.gone) failures++;
	}
	// Registry entries whose process is now gone are pure litter; drop them.
	const after = probeMachine();
	for (const entry of readEntries(reg)) {
		if (identify(entry, after).kind === "gone") forgetEntry(entry);
	}
	if (failures > 0) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

const argv = stripArgSeparators(process.argv.slice(2));
const verb = argv[0] ?? "help";
const rest = argv.slice(1);

if (verb === "help" || verb === "--help" || verb === "-h") {
	console.log(HELP);
	process.exit(0);
}

let registry: Registry;
try {
	registry = resolveRegistry();
} catch (err) {
	fail(`mockctl must run inside the dwc-ng git repository (${(err as Error).message})`);
}

switch (verb) {
	case "status":
		if (rest.length > 0) fail(`status takes no options\n\n${HELP}`);
		cmdStatus(registry);
		break;
	case "start":
		await cmdStart(registry, rest);
		break;
	case "stop":
		cmdStop(registry, rest);
		break;
	case "restart":
		await cmdRestart(registry, rest);
		break;
	case "reap":
		cmdReap(registry, rest);
		break;
	default:
		fail(`unknown verb "${verb}"\n\n${HELP}`);
}
