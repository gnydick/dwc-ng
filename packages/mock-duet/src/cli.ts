import { parseArgs } from "node:util";
import process from "node:process";
import { createMockServer } from "./server.ts";
import { scenarios } from "./scenarios/index.ts";
import { loadCaptureFile } from "./capture.ts";

const { values } = parseArgs({
	options: {
		scenario: { type: "string", short: "s", default: "idle" },
		snapshot: { type: "string", default: "" },
		port: { type: "string", short: "p", default: "8970" },
		password: { type: "string", default: "" },
		"busy-every": { type: "string", default: "0" },
		"chunk-size": { type: "string", default: "8" },
		"reply-expiry": { type: "string", default: "3000" },
		"no-auth": { type: "boolean", default: false },
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

const model = values.snapshot !== "" ? loadCaptureFile(values.snapshot) : undefined;

const mock = createMockServer({
	scenario,
	model,
	password: values.password,
	busyEvery: parseInt(values["busy-every"], 10),
	chunkSize: parseInt(values["chunk-size"], 10),
	replyExpiryMs: parseInt(values["reply-expiry"], 10),
	requireAuth: !values["no-auth"],
});

const port = await mock.listen(parseInt(values.port, 10));
console.log(`mock-duet listening on http://127.0.0.1:${port}`);
console.log(`scenario: ${scenario.name} — ${scenario.description}`);
if (model !== undefined) {
	const axes = (model.move?.axes ?? []).map((a: any) => a?.letter).join("");
	console.log(`snapshot: ${values.snapshot} (${model.tools?.length ?? 0} tools, axes ${axes || "n/a"})`);
}
if (values["no-auth"]) console.log("auth disabled (--no-auth): X-Session-Key not required");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		void mock.close().then(() => process.exit(0));
	});
}
