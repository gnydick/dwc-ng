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
		"no-auth": { type: "boolean", default: false },
		dsf: { type: "boolean", default: false },
		// "3" (current) by default; "1"/"2" stay selectable so the pre-v3
		// migration a real board's SD can carry is reachable on a live mock,
		// not only in the UI's own synthetic parser tests (GIT_92 req. 3).
		"config-version": { type: "string", default: "3" },
		// A machine whose SD carries a PRE-#86 screen override: the Machine
		// screen saved with two of its coded cards and no tombstones. Off by
		// default because it is a deliberately degraded machine.
		"frozen-screen": { type: "boolean", default: false },
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
      --no-auth           Don't require X-Session-Key (handy for curl).
      --dsf               Also serve the DSF (SBC) surface: /machine/* REST
                          routes and the /machine WebSocket push loop.
      --config-version <v> Seed shape for 0:/sys/dwc-ng-config.json:
                          1, 2, or 3/current (default: 3).
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
	requireAuth: !values["no-auth"],
	dsf: values.dsf,
	configVersion,
	frozenScreen: values["frozen-screen"],
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
if (values["frozen-screen"]) console.log("frozen screen (--frozen-screen): screens.layouts.machine holds a pre-#86 subset override");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		void mock.close().then(() => process.exit(0));
	});
}
