/**
 * What a developer actually GETS when they start a mock (GIT_194).
 *
 * Every other suite in this package builds its server by calling
 * `createMockServer({ dsf: true, ... })` in-process, which proves the DSF
 * surface WORKS and proves nothing at all about whether anyone is served it.
 * On 2026-08-31 the running UAT mock had been started without `--dsf`, so it
 * had no `/machine` routes and no upgrade handler; the UI's Mock·DSF backend
 * could not connect, the seeded config was therefore never loaded, and the
 * missing Beeper card read as a seed defect in DSF mode. Twenty-three green
 * DSF tests said nothing, because not one of them started the CLI.
 *
 * So these tests spawn the REAL cli.ts, exactly as `mockctl` does, and ask the
 * questions an operator asks: does the mock I just started speak DSF, and does
 * it serve my config over it? Nothing here is stubbed.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDialect, ContradictoryDialectError } from "../src/dialect.ts";

const CLI = join(dirname(fileURLToPath(new URL("../src/cli.ts", import.meta.url))), "cli.ts");
// Spawning a real CLI means loading the bundled capture in a fresh process, and
// the repo-root run does that while every other package's suite competes for
// the same machine. Budget for a loaded box, not an idle one.
const T = { timeout: 90_000 };

const scratchDirs: string[] = [];
const spawned: ChildProcess[] = [];

function newRepo(): string {
	const root = mkdtempSync(join(tmpdir(), "dwcdialect-"));
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
 * Start the real CLI on an OS-assigned port and resolve its base URL, read
 * from the banner the CLI itself prints. The port is never assumed: a test
 * that guessed one could be answered by an unrelated process, which is the
 * exact forensic hole that made the 2026-08-29 orphans expensive.
 */
async function startCli(args: string[]): Promise<{ base: string; banner: string }> {
	const child = spawn(process.execPath, ["--title=mock-duet", CLI, "--port", "0", ...args], {
		cwd: newRepo(),
		stdio: ["ignore", "pipe", "pipe"],
	});
	spawned.push(child);
	let out = "";
	let err = "";
	child.stdout?.on("data", d => (out += String(d)));
	child.stderr?.on("data", d => (err += String(d)));

	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		const m = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(out);
		if (m !== null) return { base: m[1] as string, banner: out };
		if (child.exitCode !== null) break;
		await new Promise(r => setTimeout(r, 50));
	}
	throw new Error(`cli did not report a listening port.\nstdout:\n${out}\nstderr:\n${err}`);
}

/**
 * ONE default-flag mock, shared by the tests that ask about the default. Each
 * spawn is a whole Node process loading the bundled capture; three of them for
 * three questions about the same server is load the repo-root run does not need
 * (it is what made this file flaky there). The mock is stateless for these
 * reads, so sharing changes nothing about what is proved.
 */
let defaultMock: Promise<{ base: string; banner: string }> | null = null;
function defaultCli(): Promise<{ base: string; banner: string }> {
	defaultMock ??= startCli([]);
	return defaultMock;
}

function wsOutcome(url: string): Promise<string> {
	return new Promise(resolve => {
		const ws = new WebSocket(url);
		const done = (v: string) => {
			resolve(v);
			try {
				ws.close();
			} catch {
				/* already closing */
			}
		};
		ws.addEventListener("open", () => done("open"));
		ws.addEventListener("error", () => done("error"));
		ws.addEventListener("close", e => done(`closed(${e.code})`));
		setTimeout(() => done("timeout"), 8000);
	});
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
// the resolver
// --------------------------------------------------------------------------

describe("resolveDialect", () => {
	test("omitting both flags serves DSF — the default is the fix", () => {
		assert.deepEqual(resolveDialect({}), { dsf: true, why: "default" });
	});

	test("--dsf is an explicit spelling of the default, not a different board", () => {
		assert.equal(resolveDialect({ dsf: true }).dsf, true);
		assert.equal(resolveDialect({ dsf: true }).why, "--dsf");
	});

	test("--standalone is the deliberate opt-out: a board with no /machine", () => {
		assert.deepEqual(resolveDialect({ standalone: true }), { dsf: false, why: "--standalone" });
	});

	test("the contradictory pair is REFUSED, never resolved by argument order", () => {
		assert.throws(() => resolveDialect({ dsf: true, standalone: true }), ContradictoryDialectError);
	});
});

// --------------------------------------------------------------------------
// the surface a developer is actually served
// --------------------------------------------------------------------------

describe("a mock started the way a developer starts one", () => {
	test("speaks DSF with NO flags: /machine REST answers and /machine upgrades", T, async () => {
		const { base, banner } = await defaultCli();

		// REST: the route DsfConnector.fetchSessionKey hits first. A 404 here is
		// swallowed as "DSF older than 3.4-b4" and the failure surfaces much
		// later at the socket, which is what made this so hard to diagnose.
		const connect = await fetch(`${base}/machine/connect`);
		assert.equal(connect.status, 200, "GET /machine/connect must answer on a default mock");
		const body = (await connect.json()) as { sessionKey?: unknown };
		assert.equal(typeof body.sessionKey, "number", "connect must hand out a session key");

		// probeTransport's discriminator.
		assert.equal((await fetch(`${base}/machine/status`)).status, 200);

		// The push channel. An http server with no upgrade handler destroys the
		// socket, so this is the assertion that fails when --dsf is missing.
		assert.equal(await wsOutcome(`${base.replace(/^http/, "ws")}/machine`), "open");

		// And the operator is TOLD, rather than having to infer it.
		assert.match(banner, /dialects: rr_ \+ DSF/);
	});

	test("serves the seeded config over DSF with the demo card PLACED, not merely defined", T, async () => {
		const { base } = await defaultCli();

		// The path DsfConnector.download builds: the whole virtual path as ONE
		// encoded component (its sole URL builder, C11).
		const path = encodeURIComponent("0:/sys/dwc-ng-config.json");
		const res = await fetch(`${base}/machine/file/${path}`);
		assert.equal(res.status, 200, "the UI's config file must be downloadable over DSF");
		const cfg = JSON.parse(await res.text()) as any;

		// PLACEMENT, not definition. "the card exists in the registry" is
		// exactly the check that passes while nothing renders: a card with no
		// rect on a screen is invisible, which is the state GIT_194-inc4 was
		// re-authored to stop happening.
		const rect = cfg?.overlay?.screens?.layouts?.machine?.["c-mock-meta"];
		assert.ok(rect, "c-mock-meta must be PLACED on the machine screen over DSF");
		for (const field of ["col", "row", "colSpan", "rowSpan"]) {
			assert.equal(typeof rect[field], "number", `placement.${field} must be a number`);
		}

		// ...and the definition the placement points at.
		assert.equal(cfg?.overlay?.cards?.["c-mock-meta"]?.name, "Beeper");

		// The stamp the UI matches against the object model's identity. A
		// mismatch here discards the whole overlay, which would look exactly
		// like "the card is missing in DSF mode".
		const model = (await (await fetch(`${base}/machine/model`)).json()) as any;
		assert.equal(
			cfg.machineId,
			`b.${String(model?.boards?.[0]?.uniqueId).replace(/[.\s]/g, "-")}`,
			"the seeded stamp must match the identity the DSF model reports",
		);
	});

	test("both dialects serve the SAME config bytes — one seed, no second copy", T, async () => {
		const { base } = await defaultCli();

		const key = ((await (await fetch(`${base}/rr_connect?password=&sessionKey=yes`)).json()) as any).sessionKey;
		const viaRr = await (
			await fetch(`${base}/rr_download?name=${encodeURIComponent("0:/sys/dwc-ng-config.json")}`, {
				headers: { "X-Session-Key": String(key) },
			})
		).text();
		const viaDsf = await (
			await fetch(`${base}/machine/file/${encodeURIComponent("0:/sys/dwc-ng-config.json")}`, {
				headers: { "X-Session-Key": String(key) },
			})
		).text();

		// Both dialects read one VirtualSD off one Machine, so this is a
		// tripwire rather than a behaviour: the day it fails, someone has given
		// DSF a seed of its own and the two will drift silently from then on.
		assert.equal(viaDsf, viaRr, "the two dialects must serve one seed, not two copies");
		assert.match(viaRr, /"c-mock-meta"/);
	});

	test("--standalone still gives a bare RRF board, and says so", T, async () => {
		const { base, banner } = await startCli(["--standalone"]);

		// The deliberate degradation must stay reachable: probeTransport's
		// standalone case is only testable against a mock with no /machine.
		assert.equal((await fetch(`${base}/machine/status`)).status, 404);
		assert.equal((await fetch(`${base}/machine/connect`)).status, 404);
		assert.notEqual(await wsOutcome(`${base.replace(/^http/, "ws")}/machine`), "open");

		// rr_ is untouched.
		assert.equal(((await (await fetch(`${base}/rr_connect?password=`)).json()) as any).err, 0);

		// The silence was the defect. Whichever way it resolves, the banner says.
		assert.match(banner, /dialects: rr_ ONLY/);
	});

	test("--dsf --standalone refuses to start rather than picking a winner", T, async () => {
		const child = spawn(process.execPath, [CLI, "--port", "0", "--dsf", "--standalone"], {
			cwd: newRepo(),
			stdio: ["ignore", "pipe", "pipe"],
		});
		spawned.push(child);
		let err = "";
		child.stderr?.on("data", d => (err += String(d)));
		const code = await new Promise<number>(r => child.on("exit", c => r(c ?? -1)));
		assert.equal(code, 1, "a contradictory pair must not produce a running mock");
		assert.match(err, /--dsf and --standalone/);
	});
});
