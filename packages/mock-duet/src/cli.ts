import { parseArgs } from "node:util";
import process from "node:process";
import { createMockServer } from "./server.ts";
import { scenarios } from "./scenarios/index.ts";
import { loadCaptureFile } from "./capture.ts";
import type { ConfigSeedVersion } from "./files.ts";

const { values } = parseArgs({
	options: {
		scenario: { type: "string", short: "s", default: "idle" },
		// Defaults to the bundled capture of the machine this UI is built for.
		// A bare synthetic board is rarely what you want to look at; pass
		// --snapshot "" for one.
		snapshot: { type: "string", default: "captures/om-snapshot-2026-07-12.json" },
		port: { type: "string", short: "p", default: "8970" },
		password: { type: "string", default: "" },
		"busy-every": { type: "string", default: "0" },
		"chunk-size": { type: "string", default: "8" },
		"reply-expiry": { type: "string", default: "3000" },
		// RRF's embedded server allows very few concurrent sessions, and the
		// defaults below MODEL that constraint deliberately — a mock that hands
		// out sessions freely cannot show a session leak, which is the class of
		// bug #110 exists for. These flags raise the cap for a UAT session that
		// is fighting the leak rather than hunting it; they do NOT change what
		// the mock is by default.
		"max-sessions": { type: "string", default: "" },
		"session-timeout": { type: "string", default: "" },
		"no-auth": { type: "boolean", default: false },
		dsf: { type: "boolean", default: false },
		// "3" (current) by default; "1"/"2" stay selectable so the pre-v3
		// migration a real board's SD can carry is reachable on a live mock,
		// not only in the UI's own synthetic parser tests (GIT_92 req. 3).
		"config-version": { type: "string", default: "3" },
		// Opt-in persistence (GIT_114). Absent = the mock forgets on exit,
		// which is the default on purpose: a mock that silently remembers can
		// hide a config-loading bug.
		state: { type: "string", default: "" },
		// A machine whose SD carries a PRE-#86 screen override: the Machine
		// screen saved with two of its coded cards and no tombstones. Off by
		// default because it is a deliberately degraded machine.
		"frozen-screen": { type: "boolean", default: false },
		// A machine the UI cannot identify: no boards[].uniqueId, no interface
		// MAC. Off by default because it is a deliberately degraded machine —
		// see snapshot.ts stripIdentity and docs/mock-parity.md.
		unidentified: { type: "boolean", default: false },
		list: { type: "boolean", default: false },
		help: { type: "boolean", short: "h", default: false },
	},
});

if (values.help) {
	console.log(`mock-duet — mock RRF board speaking the rr_ HTTP dialect

Usage: pnpm --filter @dwc-ng/mock-duet start [-- options]

Options:
  -s, --scenario <name>   Scenario to run (default: idle). See --list.
      --snapshot <file>   Serve a captured object model (JSON from DSF
                          GET /machine/model or stitched rr_model responses).
                          Non-standalone keys are dropped; seqs synthesized.
  -p, --port <port>       Port to listen on (default: 8970).
      --password <pw>     Require this rr_connect password ("" accepts any).
      --busy-every <n>    Every nth rr_model/rr_filelist request gets a 503.
      --chunk-size <n>    Array elements per rr_model chunk / files per page (default: 8).
      --reply-expiry <ms> Drop unread G-code replies after this long (default: 3000).
      --max-sessions <n>  Concurrent session slots (default: 4, matching RRF's
                          real scarcity). Raise ONLY to work around a known
                          session leak during UAT — a high cap hides that class
                          of bug.
      --session-timeout <ms>
                          Idle session expiry (default: 8000).
      --no-auth           Don't require X-Session-Key (handy for curl).
      --dsf               Also serve the DSF (SBC) surface: /machine/* REST
                          routes and the /machine WebSocket push loop.
      --config-version <v> Seed shape for 0:/sys/dwc-ng-config.json:
                          1, 2, or 3/current (default: 3).
      --state <file>      Persist the SD tree and machine state to this file and
                          restore it at startup. Omitted = the mock forgets on
                          exit, which is the default on purpose.
      --frozen-screen     Seed a pre-#86 screens.layouts override (Machine and
                          Settings each saved with a SUBSET of their coded
                          cards, no tombstones) so the composition merge is
                          observable. The Settings entry predates the #140
                          Accelerometers card, so the merge must add it.
      --unidentified      Serve a machine with no boards[].uniqueId and no
                          interface MAC, so the UI's unidentified path (identity
                          card, in-memory canvas) is reachable. Composes with
                          --snapshot and --config-version.
      --list              List scenarios and exit.`);
	process.exit(0);
}

if (values.list) {
	for (const s of Object.values(scenarios)) {
		console.log(`${s.name.padEnd(14)} ${s.description}`);
	}
	process.exit(0);
}

const scenario = scenarios[values.scenario];
if (scenario === undefined) {
	console.error(`Unknown scenario "${values.scenario}". Available: ${Object.keys(scenarios).join(", ")}`);
	process.exit(1);
}

const CONFIG_VERSIONS = ["1", "2", "3"] as const;
if (!(CONFIG_VERSIONS as readonly string[]).includes(values["config-version"])) {
	console.error(`--config-version must be one of ${CONFIG_VERSIONS.join(", ")}, got "${values["config-version"]}"`);
	process.exit(1);
}
const configVersion = Number(values["config-version"]) as ConfigSeedVersion;

const model = values.snapshot !== "" ? loadCaptureFile(values.snapshot) : undefined;

const mock = createMockServer({
	scenario,
	model,
	password: values.password,
	busyEvery: parseInt(values["busy-every"], 10),
	chunkSize: parseInt(values["chunk-size"], 10),
	replyExpiryMs: parseInt(values["reply-expiry"], 10),
	...(values["max-sessions"] === "" ? {} : { maxSessions: parseInt(values["max-sessions"], 10) }),
	...(values["session-timeout"] === "" ? {} : { sessionTimeout: parseInt(values["session-timeout"], 10) }),
	requireAuth: !values["no-auth"],
	dsf: values.dsf,
	configVersion,
	statePath: values.state !== "" ? values.state : undefined,
	frozenScreen: values["frozen-screen"],
	unidentified: values.unidentified,
});

const port = await mock.listen(parseInt(values.port, 10));
console.log(`mock-duet listening on http://127.0.0.1:${port}`);
console.log(`scenario: ${scenario.name} — ${scenario.description}`);
if (model !== undefined) {
	const axes = (model.move?.axes ?? []).map((a: any) => a?.letter).join("");
	console.log(`snapshot: ${values.snapshot} (${model.tools?.length ?? 0} tools, axes ${axes || "n/a"})`);
}
if (values["no-auth"]) console.log("auth disabled (--no-auth): X-Session-Key not required");
if (values.dsf) console.log(`DSF mode (--dsf): REST http://127.0.0.1:${port}/machine/*, push ws://127.0.0.1:${port}/machine`);
console.log(`dwc-ng-config.json seed: version ${configVersion}${configVersion === 3 ? " (current)" : ""}`);
if (mock.stateRestore === null) {
	console.log("state: not persisted (pass --state <file> to keep it across restarts)");
} else if (mock.stateRestore.kind === "restored") {
	console.log(`state: restored from ${values.state}`);
} else if (mock.stateRestore.kind === "unreadable") {
	console.log(`state: ${values.state} is UNREADABLE (${mock.stateRestore.reason}) — starting clean; it will be overwritten on the next change`);
} else {
	console.log(`state: ${values.state} (new file; written after the first change)`);
}
console.log(`dwc-ng-config.json seed: version ${configVersion}${configVersion === 3 ? " (current)" : ""}`);
if (values["frozen-screen"]) console.log("frozen screen (--frozen-screen): screens.layouts.machine and .settings hold pre-#86 subset overrides (settings also predates #140's Accelerometers card)");
if (values.unidentified) console.log("unidentified (--unidentified): no boards[].uniqueId, no interface MAC — the UI cannot key this machine");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		void mock.close().then(() => process.exit(0));
	});
}
