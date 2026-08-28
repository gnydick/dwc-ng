import { test } from "node:test";
import assert from "node:assert/strict";
import { startMock, fetchStitched } from "./helpers.ts";
import { POLLED_KEYS } from "../src/snapshot.ts";
import { loadCaptureFile } from "../src/capture.ts";

test("rr_connect returns a session (err 0, apiLevel >= 1, sessionKey)", async t => {
	const mock = await startMock();
	t.after(() => mock.close());

	const res = await mock.getRaw("rr_connect?password=reprap&time=2026-07-12T12:00:00&sessionKey=yes");
	const body: any = await res.json();
	assert.equal(body.err, 0);
	assert.ok(body.apiLevel >= 1, "apiLevel must be >= 1 or DWC throws BadVersionError");
	assert.equal(typeof body.sessionKey, "number");
	assert.ok(body.sessionTimeout > 0);
	assert.ok(!("isEmulated" in body), "isEmulated makes DWC abort the connection");
});

test("rr_connect rejects a wrong password with err 1", async t => {
	const mock = await startMock({ password: "secret" });
	t.after(() => mock.close());

	const bad: any = await (await mock.getRaw("rr_connect?password=nope&time=x")).json();
	assert.equal(bad.err, 1);
	const good: any = await (await mock.getRaw("rr_connect?password=secret&time=x")).json();
	assert.equal(good.err, 0);
});

test("rr_connect returns err 2 when sessions are exhausted", async t => {
	const mock = await startMock({ maxSessions: 1 });
	t.after(() => mock.close());

	await mock.connect();
	const second: any = await (await mock.getRaw("rr_connect?password=&time=x")).json();
	assert.equal(second.err, 2);
});

test("requests without a valid X-Session-Key get 401 (client re-auth trigger)", async t => {
	const mock = await startMock();
	t.after(() => mock.close());

	assert.equal((await mock.getRaw("rr_model?key=seqs")).status, 401);
	assert.equal((await mock.getRaw("rr_model?key=seqs", 999999)).status, 401);

	const key = await mock.connect();
	assert.equal((await mock.getRaw("rr_model?key=seqs", key)).status, 200);
});

test("rr_model key=seqs lists every polled subtree plus reply and volChanges", async t => {
	const mock = await startMock();
	t.after(() => mock.close());
	const key = await mock.connect();

	const { result } = await mock.getJson("rr_model?key=seqs", key);
	for (const k of POLLED_KEYS) {
		assert.equal(typeof result[k], "number", `seqs.${k} missing`);
	}
	assert.equal(typeof result.reply, "number");
	assert.ok(Array.isArray(result.volChanges));
});

test("live poll (flags=d99fn) carries seqs, status and upTime", async t => {
	const mock = await startMock();
	t.after(() => mock.close());
	const key = await mock.connect();

	const { result } = await mock.getJson("rr_model?flags=d99fn", key);
	assert.ok(result.seqs, "live response must embed seqs");
	assert.equal(typeof result.state.upTime, "number");
	assert.equal(result.state.status, "idle");
	assert.equal(typeof result.heat.heaters[1].current, "number");
	assert.equal(typeof result.move.axes[0].machinePosition, "number");
});

test("key fetch (d99vno) returns the full subtree, without seqs", async t => {
	const mock = await startMock();
	t.after(() => mock.close());
	const key = await mock.connect();

	const { result } = await mock.getJson("rr_model?key=heat&flags=d99vno", key);
	assert.equal(result.heaters.length, 2);
	assert.ok(result.heaters[0].model, "verbose fetch includes non-live fields");
	assert.equal(result.seqs, undefined);
});

test("array keys are chunked with a<offset>/next and stitch back together", async t => {
	const mock = await startMock({ chunkSize: 3 });
	t.after(() => mock.close());
	const key = await mock.connect();

	const first = await mock.getJson("rr_model?key=inputs&flags=d99vno", key);
	assert.equal(first.result.length, 3);
	assert.equal(first.next, 3);

	const stitched = await fetchStitched(mock, key, "inputs", "d99vno");
	assert.equal(stitched.length, mock.machine.om.inputs.length);
	assert.equal(stitched[stitched.length - 1].name, "Autopause");
});

test("#key returns the array element count", async t => {
	const mock = await startMock();
	t.after(() => mock.close());
	const key = await mock.connect();

	const { result } = await mock.getJson("rr_model?key=%23inputs&flags=d99vno", key);
	assert.equal(result, mock.machine.om.inputs.length);
});

test("unknown keys yield result null", async t => {
	const mock = await startMock();
	t.after(() => mock.close());
	const key = await mock.connect();

	const { result } = await mock.getJson("rr_model?key=does.not.exist&flags=d99vno", key);
	assert.equal(result, null);
});

test("rr_gcode executes, bumps seqs.reply, and rr_reply drains once", async t => {
	const mock = await startMock();
	t.after(() => mock.close());
	const key = await mock.connect();

	const before = (await mock.getJson("rr_model?key=seqs", key)).result.reply;

	const gres = await mock.getJson("rr_gcode?gcode=M104%20S200", key);
	assert.equal(gres.err, 0);
	assert.ok(gres.buff > 0, "buff 0 makes DWC throw CodeBufferError");

	const after = (await mock.getJson("rr_model?key=seqs", key)).result.reply;
	assert.equal(after, before + 1);

	assert.equal(mock.machine.om.heat.heaters[1].active, 200);

	// M114 produces a textual reply; both replies drain in one rr_reply call
	await mock.getJson("rr_gcode?gcode=M114", key);
	const reply = await (await mock.getRaw("rr_reply", key)).text();
	assert.match(reply, /X:/);
	const drained = await (await mock.getRaw("rr_reply", key)).text();
	assert.equal(drained, "");
});

test("busyEvery injects periodic 503s on rr_model", async t => {
	const mock = await startMock({ busyEvery: 3 });
	t.after(() => mock.close());
	const key = await mock.connect();

	const statuses: number[] = [];
	for (let i = 0; i < 6; i++) {
		statuses.push((await mock.getRaw("rr_model?key=seqs", key)).status);
	}
	assert.deepEqual(statuses, [200, 200, 503, 200, 200, 503]);
});

test("M999 resets uptime and kills sessions (firmware reboot)", async t => {
	const mock = await startMock();
	t.after(() => mock.close());
	const key = await mock.connect();

	mock.machine.advance(30_000);
	assert.equal(mock.machine.om.state.upTime, 30);

	await mock.getJson("rr_gcode?gcode=M999", key);
	assert.equal(mock.machine.om.state.upTime, 0);
	assert.equal((await mock.getRaw("rr_model?key=seqs", key)).status, 401);
});

test("move.axes is truncated in a move fetch when it exceeds reportedAxes", async t => {
	const mock = await startMock({ chunkSize: 4 });
	t.after(() => mock.close());
	const key = await mock.connect();

	// Grow the machine to 10 axes (limits.reportedAxes = 9)
	const axes = mock.machine.om.move.axes;
	const letters = ["U", "V", "W", "A", "B", "C", "D"];
	for (const letter of letters) axes.push({ ...structuredClone(axes[0]), letter });
	assert.equal(axes.length, 10);

	const { result } = await mock.getJson("rr_model?key=move&flags=d99vno", key);
	assert.equal(result.axes.length, 9, "move result must truncate axes to reportedAxes");

	const full = await fetchStitched(mock, key, "move.axes", "d99vno");
	assert.equal(full.length, 10, "move.axes key fetch pages through all axes");
});

// ---- GIT_92 requirement 3: the unidentified machine, on purpose ----------
//
// The UI resolves identity from `boards[].uniqueId`, falling back to the first
// interface MAC (ui config/machineId.ts `resolveMachineId`), and returns
// `unidentified` only when BOTH are absent. Giving the default mock machine an
// id (requirements 1 and 2) therefore made that branch unreachable by any flag
// — the exact "a mock easier than the board hides the defects UAT is for"
// failure this ticket's design constraint names.

test("--unidentified strips BOTH identity routes, so the UI cannot key this machine", async t => {
	const mock = await startMock({ unidentified: true });
	t.after(() => mock.close());
	const key = await mock.connect();

	const boards = (await mock.getJson("rr_model?key=boards&flags=d99", key) as { result: unknown }).result as Array<Record<string, unknown>>;
	assert.ok(boards.length > 0, "the machine still HAS boards — it just cannot be identified by them");
	for (const board of boards) {
		assert.equal("uniqueId" in board, false, "no board carries a uniqueId");
	}

	const network = (await mock.getJson("rr_model?key=network&flags=d99", key) as { result: unknown }).result as { interfaces: Array<Record<string, unknown>> };
	assert.ok(network.interfaces.length > 0, "the interface is still there — only its MAC is gone");
	for (const iface of network.interfaces) {
		assert.equal("mac" in iface, false, "no interface carries a MAC");
	}
});

test("the default machine IS identified — --unidentified is opt-in, never the default", async t => {
	const mock = await startMock();
	t.after(() => mock.close());
	const key = await mock.connect();

	const boards = (await mock.getJson("rr_model?key=boards&flags=d99", key) as { result: unknown }).result as Array<Record<string, unknown>>;
	const main = boards.find(b => (b.canAddress ?? 0) === 0);
	assert.ok(typeof main?.uniqueId === "string" && main.uniqueId !== "");
});

test("--unidentified composes with a multi-tool snapshot and a seeded config", async t => {
	// The point of the flag, and the thing a strip-at-serve-time implementation
	// would have got wrong: an unidentified machine that is otherwise ordinary.
	// This combination presents "claimed, not adopted" — a settings file on the
	// card stamped for a machine this one cannot prove it is.
	const mock = await startMock({ unidentified: true, model: loadCaptureFile(new URL("../captures/om-snapshot-2026-07-12.json", import.meta.url)) });
	t.after(() => mock.close());
	const key = await mock.connect();

	const tools = (await mock.getJson("rr_model?key=tools&flags=d99", key) as { result: unknown }).result as unknown[];
	assert.ok(tools.length >= 4, `the toolchanger's tools survive the strip (got ${tools.length})`);

	const boards = (await mock.getJson("rr_model?key=boards&flags=d99", key) as { result: unknown }).result as Array<Record<string, unknown>>;
	for (const board of boards) assert.equal("uniqueId" in board, false);

	const down = await mock.getRaw("rr_download?name=0:/sys/dwc-ng-config.json", key);
	const parsed = JSON.parse(await down.text()) as { machineId?: string };
	assert.ok(typeof parsed.machineId === "string", "the config is still stamped — that is what makes it CLAIMED");
});

test("a scenario reset does not hand the identity back", async t => {
	// Stripping is done on the PRISTINE model, before `om` is cloned from it,
	// precisely so a reset cannot undo it. Stripping at any serve site would
	// leave this path open.
	const mock = await startMock({ unidentified: true });
	t.after(() => mock.close());
	const key = await mock.connect();

	mock.machine.reset();
	// A reset is a BOARD reset: it drops every session, so the old key 401s.
	// Reconnecting is part of modelling the thing, not a workaround.
	const afterReset = await mock.connect();
	const boards = (await mock.getJson("rr_model?key=boards&flags=d99", afterReset) as { result: unknown }).result as Array<Record<string, unknown>>;
	for (const board of boards) assert.equal("uniqueId" in board, false, "still unidentified after a reset");
});
