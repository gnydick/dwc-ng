/**
 * DSF (SBC) mode: the /machine WebSocket push loop and REST routes
 * (design D11). Client side uses the global WebSocket and fetch — the
 * byte-level WS layer has its own suite (ws.test.ts); this one is about
 * the protocol ON TOP: full-frame-first, ack-gated sparse diffs, the
 * consumed messages channel, WS-pinned sessions, and route contracts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startMock, type TestMock } from "./helpers.ts";
import { THUMBNAIL_PNG_BASE64 } from "../src/files.ts";

const T = { timeout: 15_000 };

function within<V>(promise: Promise<V>, label: string, ms = 3000): Promise<V> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms: ${label}`)), ms);
		promise.then(
			value => {
				clearTimeout(timer);
				resolve(value);
			},
			err => {
				clearTimeout(timer);
				reject(err);
			},
		);
	});
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function wsUrl(mock: TestMock, query = ""): string {
	return `${mock.base.replace(/^http/, "ws")}/machine${query}`;
}

function wsOpen(url: string): Promise<WebSocket> {
	return within(
		new Promise<WebSocket>((resolve, reject) => {
			const ws = new WebSocket(url);
			ws.addEventListener("open", () => resolve(ws), { once: true });
			ws.addEventListener("error", () => reject(new Error("WebSocket failed to open")), { once: true });
		}),
		"client open",
	);
}

function wsClosed(ws: WebSocket): Promise<{ code: number; reason: string }> {
	return within(
		new Promise(resolve => {
			ws.addEventListener("close", event => resolve(event as CloseEvent), { once: true });
		}),
		"client close event",
	);
}

/** ONE persistent listener with a queue; `pending` exposes unconsumed pushes. */
function wsInbox(ws: WebSocket): { next(): Promise<string>; pending(): number } {
	const queued: string[] = [];
	const waiters: Array<(text: string) => void> = [];
	ws.addEventListener("message", event => {
		const text = String((event as MessageEvent).data);
		const waiter = waiters.shift();
		if (waiter !== undefined) waiter(text);
		else queued.push(text);
	});
	return {
		next() {
			const text = queued.shift();
			if (text !== undefined) return Promise.resolve(text);
			return within(new Promise<string>(resolve => waiters.push(resolve)), "ws push");
		},
		pending: () => queued.length,
	};
}

/**
 * Assert nothing gets pushed for `ms` (several pump intervals). Valid only
 * when every expected push has already been consumed via inbox.next().
 */
async function assertSilence(inbox: { pending(): number }, ms = 150): Promise<void> {
	await sleep(ms);
	assert.equal(inbox.pending(), 0, "unexpected WS push during a silence window");
}

interface DsfClient {
	ws: WebSocket;
	inbox: ReturnType<typeof wsInbox>;
	full: any;
}

/** Open the push socket and consume the mandatory full first frame. */
async function openDsf(mock: TestMock, query = ""): Promise<DsfClient> {
	const ws = await wsOpen(wsUrl(mock, query));
	const inbox = wsInbox(ws);
	const full = JSON.parse(await inbox.next());
	return { ws, inbox, full };
}

async function startDsf(extra: Parameters<typeof startMock>[0] = {}): Promise<TestMock> {
	return startMock({ dsf: true, ...extra });
}

// --- push loop ---

test("first frame is the FULL model: messages pinned [], no seqs", T, async t => {
	const mock = await startDsf();
	t.after(() => mock.close());

	const { ws, full } = await openDsf(mock);
	assert.deepEqual(full.messages, [], "DSF models carry a messages key; ours is always drained");
	assert.ok(!("seqs" in full), "seqs is rr_ wire protocol, not DSF model data");
	assert.equal(full.state.status, "idle");
	assert.ok(Array.isArray(full.heat.heaters), "full om subtrees must be present");
	assert.ok(Array.isArray(full.move.axes));
	ws.close();
	await wsClosed(ws);
});

test("no ack means no push, even as the machine changes", T, async t => {
	const mock = await startDsf();
	t.after(() => mock.close());

	const { ws, inbox } = await openDsf(mock);
	mock.machine.advance(2000);
	await assertSilence(inbox);

	// The withheld change is delivered by the FIRST ack — and only once
	ws.send("OK\n");
	const diff = JSON.parse(await inbox.next());
	assert.equal(typeof diff.state.upTime, "number");
	await assertSilence(inbox);
	ws.close();
	await wsClosed(ws);
});

test("an ack arms exactly one push; changes arriving later still flow", T, async t => {
	const mock = await startDsf();
	t.after(() => mock.close());

	const { ws, inbox } = await openDsf(mock);
	// Arm first: nothing has changed since the full frame, so no push yet
	ws.send("OK\n");
	await assertSilence(inbox, 100);

	// The change arrives AFTER arming — the pump interval picks it up
	mock.machine.advance(1000);
	const first = JSON.parse(await inbox.next());
	assert.equal(first.state.upTime, 1);

	// Disarmed now: further changes wait for the next ack
	mock.machine.advance(1000);
	await assertSilence(inbox);
	ws.send("OK\n");
	const second = JSON.parse(await inbox.next());
	assert.equal(second.state.upTime, 2);
	ws.close();
	await wsClosed(ws);
});

test("diffs are sparse: only changed keys, unchanged subtrees absent", T, async t => {
	const mock = await startDsf();
	t.after(() => mock.close());

	const { ws, inbox } = await openDsf(mock);
	ws.send("OK\n");
	mock.machine.advance(2000);
	const diff = JSON.parse(await inbox.next());

	// advance() moves the clock, integrates heaters, mirrors sensor readings
	assert.equal(diff.state.upTime, 2);
	assert.equal(diff.state.status, undefined, "unchanged fields stay out of the diff");
	assert.ok(diff.heat, "heater temperatures drift every tick");
	// Nothing about these subtrees changed while idle
	for (const key of ["job", "tools", "directories", "limits", "network"]) {
		assert.ok(!(key in diff), `idle advance must not touch "${key}"`);
	}
	assert.ok(!("messages" in diff), "no replies pending, so no messages key");
	assert.ok(!("seqs" in diff));
	ws.close();
	await wsClosed(ws);
});

test("a changed array travels FULL-LENGTH (heater fault)", T, async t => {
	const mock = await startDsf();
	t.after(() => mock.close());

	const { ws, inbox } = await openDsf(mock);
	ws.send("OK\n");
	mock.machine.faultHeater(1);
	const diff = JSON.parse(await inbox.next());

	const heaters = diff.heat.heaters;
	assert.ok(Array.isArray(heaters), "arrays are never element-wise sparse on this wire");
	assert.equal(heaters.length, mock.machine.om.heat.heaters.length);
	assert.equal(heaters[1].state, "fault");
	assert.equal(typeof heaters[0], "object", "unchanged elements ride along, full-length");
	// The fault's console reply rides the same push as the model change
	assert.equal(diff.messages.length, 1);
	assert.equal(diff.messages[0].type, 2, "leading Error: infers type 2");
	assert.match(diff.messages[0].content, /^Error: Heater 1 fault/);
	ws.close();
	await wsClosed(ws);
});

test("messages are consumed: alone they are a pushable diff, and never repeat", T, async t => {
	const mock = await startDsf();
	t.after(() => mock.close());

	const { ws, inbox } = await openDsf(mock);
	ws.send("OK\n");
	await assertSilence(inbox, 100);

	// A reply with NO model change still constitutes a push
	mock.machine.emitReply("job done");
	const push = JSON.parse(await inbox.next());
	assert.deepEqual(Object.keys(push), ["messages"]);
	assert.equal(push.messages[0].type, 0);
	assert.equal(push.messages[0].content, "job done");
	assert.match(push.messages[0].time, /^\d{4}-\d{2}-\d{2}T/);

	// The next push must NOT carry that message again
	ws.send("OK\n");
	mock.machine.advance(1000);
	const next = JSON.parse(await inbox.next());
	assert.ok(!("messages" in next), "a consumed message can never reappear");
	ws.close();
	await wsClosed(ws);
});

test("message type inference: Error 2, Warning 1, else 0", T, async t => {
	const mock = await startDsf();
	t.after(() => mock.close());

	const { ws, inbox } = await openDsf(mock);
	const cases: Array<[string, number]> = [
		["Error: boom", 2],
		["Warning: warm", 1],
		["all good", 0],
	];
	for (const [text, type] of cases) {
		ws.send("OK\n");
		mock.machine.emitReply(text);
		const push = JSON.parse(await inbox.next());
		assert.equal(push.messages[0].type, type, text);
		assert.equal(push.messages[0].content, text);
	}
	ws.close();
	await wsClosed(ws);
});

test("PING answers PONG and never disturbs arming", T, async t => {
	const mock = await startDsf();
	t.after(() => mock.close());

	// PING is not an ack: a change after PING alone must stay unpushed
	const idle = await openDsf(mock);
	idle.ws.send("PING\n");
	assert.equal(await idle.inbox.next(), "PONG\n");
	mock.machine.advance(1000);
	await assertSilence(idle.inbox);
	idle.ws.close();
	await wsClosed(idle.ws);

	// ...and PING does not consume an existing ack either
	const armed = await openDsf(mock);
	armed.ws.send("OK\n");
	armed.ws.send("PING\n");
	assert.equal(await armed.inbox.next(), "PONG\n");
	mock.machine.advance(1000);
	const diff = JSON.parse(await armed.inbox.next());
	assert.equal(typeof diff.state.upTime, "number");
	armed.ws.close();
	await wsClosed(armed.ws);
});

// --- sessions ---

test("a session bound to an open WS survives idle expiry; closing releases it", T, async t => {
	const mock = await startDsf({ password: "secret", sessionTimeout: 200 });
	t.after(() => mock.close());

	const res = await fetch(`${mock.base}/machine/connect?password=secret`);
	const { sessionKey } = await res.json() as { sessionKey: number };
	const headers = { "X-Session-Key": String(sessionKey) };

	const { ws } = await openDsf(mock, `?sessionKey=${sessionKey}`);
	// Way past the idle timeout — the WS pin must keep the session alive
	await sleep(500);
	assert.equal((await fetch(`${mock.base}/machine/model`, { headers })).status, 200);

	ws.close();
	await wsClosed(ws);
	// Unpinned now: the same idle window kills it
	await sleep(500);
	assert.equal((await fetch(`${mock.base}/machine/model`, { headers })).status, 401);
});

test("WS handshake with a bad session is refused (1008) when a password is set", T, async t => {
	const mock = await startDsf({ password: "secret" });
	t.after(() => mock.close());

	const ws = await wsOpen(wsUrl(mock, "?sessionKey=999999"));
	assert.equal((await wsClosed(ws)).code, 1008);
});

test("REST auth: 403 wrong password on connect, 401 keyless elsewhere", T, async t => {
	const mock = await startDsf({ password: "secret" });
	t.after(() => mock.close());

	assert.equal((await fetch(`${mock.base}/machine/connect?password=nope`)).status, 403);
	assert.equal((await fetch(`${mock.base}/machine/model`)).status, 401);

	const res = await fetch(`${mock.base}/machine/connect?password=secret`);
	assert.equal(res.status, 200);
	const { sessionKey } = await res.json() as { sessionKey: number };
	assert.equal(typeof sessionKey, "number");
	const ok = await fetch(`${mock.base}/machine/model`, { headers: { "X-Session-Key": String(sessionKey) } });
	assert.equal(ok.status, 200);
});

test("sessionless REST succeeds when the password is unset", T, async t => {
	const mock = await startDsf();
	t.after(() => mock.close());

	for (const route of ["machine/model", "machine/status"]) {
		const res = await fetch(`${mock.base}/${route}`);
		assert.equal(res.status, 200);
		const model = await res.json() as Record<string, unknown>;
		assert.deepEqual(model.messages, []);
		assert.ok(!("seqs" in model));
	}
	const connect = await fetch(`${mock.base}/machine/connect?password=whatever`);
	assert.equal(connect.status, 200, "an unset password accepts anything, like an unset M551");
});

test("noop and disconnect answer 204; disconnect drops the session", T, async t => {
	const mock = await startDsf({ password: "secret" });
	t.after(() => mock.close());

	const { sessionKey } = await (await fetch(`${mock.base}/machine/connect?password=secret`)).json() as { sessionKey: number };
	const headers = { "X-Session-Key": String(sessionKey) };

	assert.equal((await fetch(`${mock.base}/machine/noop`, { headers })).status, 204);
	assert.equal((await fetch(`${mock.base}/machine/disconnect`, { headers })).status, 204);
	// The key is dead now
	assert.equal((await fetch(`${mock.base}/machine/model`, { headers })).status, 401);
});

// --- code execution ---

test("POST /machine/code runs the one gcode authority and answers the reply", T, async t => {
	const mock = await startDsf();
	t.after(() => mock.close());

	const res = await fetch(`${mock.base}/machine/code`, { method: "POST", body: "M114" });
	assert.equal(res.status, 200);
	assert.match(await res.text(), /X:/);
	// The om actually changed through the same path rr_gcode uses
	const heat = await fetch(`${mock.base}/machine/code`, { method: "POST", body: "M104 S200" });
	assert.equal(await heat.text(), "", "silent codes answer an empty string");
	assert.equal(mock.machine.om.heat.heaters[1].active, 200);

	assert.equal((await fetch(`${mock.base}/machine/code`)).status, 404, "GET is not a code channel");
});

// --- files ---

test("file GET: content, encoded and raw paths, 404 on missing", T, async t => {
	const mock = await startDsf();
	t.after(() => mock.close());

	const raw = await fetch(`${mock.base}/machine/file/0:/sys/config.g`);
	assert.equal(raw.status, 200);
	assert.match(await raw.text(), /M550/);

	const encoded = await fetch(`${mock.base}/machine/file/${encodeURIComponent("0:/sys/config.g")}`);
	assert.equal(encoded.status, 200);
	assert.match(await encoded.text(), /M550/);

	assert.equal((await fetch(`${mock.base}/machine/file/0:/sys/nope.g`)).status, 404);
});

test("file PUT creates (201) — including a zero-byte file — and DELETE removes (204/404)", T, async t => {
	const mock = await startDsf();
	t.after(() => mock.close());

	const put = await fetch(`${mock.base}/machine/file/0:/gcodes/new.g`, { method: "PUT", body: "G28\n" });
	assert.equal(put.status, 201);
	assert.equal(await (await fetch(`${mock.base}/machine/file/0:/gcodes/new.g`)).text(), "G28\n");

	const emptyPut = await fetch(`${mock.base}/machine/file/0:/gcodes/empty.g`, { method: "PUT" });
	assert.equal(emptyPut.status, 201, "an empty body still creates the file");
	const emptyGet = await fetch(`${mock.base}/machine/file/0:/gcodes/empty.g`);
	assert.equal(emptyGet.status, 200);
	assert.equal(await emptyGet.text(), "");

	assert.equal((await fetch(`${mock.base}/machine/file/0:/gcodes/new.g`, { method: "DELETE" })).status, 204);
	assert.equal((await fetch(`${mock.base}/machine/file/0:/gcodes/new.g`, { method: "DELETE" })).status, 404);
});

test("deleting a non-empty directory needs recursive=true", T, async t => {
	const mock = await startDsf();
	t.after(() => mock.close());

	assert.equal((await fetch(`${mock.base}/machine/directory/0:/gcodes/sub`, { method: "PUT" })).status, 201);
	assert.equal(
		(await fetch(`${mock.base}/machine/file/0:/gcodes/sub/a.g`, { method: "PUT", body: "x" })).status,
		201,
	);

	assert.equal((await fetch(`${mock.base}/machine/file/0:/gcodes/sub`, { method: "DELETE" })).status, 500);
	assert.equal(
		(await fetch(`${mock.base}/machine/file/0:/gcodes/sub?recursive=true`, { method: "DELETE" })).status,
		204,
	);
	assert.equal((await fetch(`${mock.base}/machine/directory/0:/gcodes/sub`)).status, 404);
});

test("directory listing has the DSF shape {type,name,size,date}; 404 on missing", T, async t => {
	const mock = await startDsf();
	t.after(() => mock.close());

	const res = await fetch(`${mock.base}/machine/directory/0:/gcodes`);
	assert.equal(res.status, 200);
	const listing = await res.json() as Array<{ type: string; name: string; size: number; date: string }>;
	const benchy = listing.find(e => e.name === "benchy.gcode");
	assert.ok(benchy);
	assert.equal(benchy.type, "f");
	assert.ok(benchy.size > 0);
	assert.match(benchy.date, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);

	assert.equal((await fetch(`${mock.base}/machine/directory/0:/nope`)).status, 404);
});

test("file/move: 204 on success, 404 missing source, clobber refused without force", T, async t => {
	const mock = await startDsf();
	t.after(() => mock.close());
	const move = (fields: Record<string, string>) =>
		fetch(`${mock.base}/machine/file/move`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams(fields).toString(),
		});

	await fetch(`${mock.base}/machine/file/0:/gcodes/a.g`, { method: "PUT", body: "a" });
	await fetch(`${mock.base}/machine/file/0:/gcodes/b.g`, { method: "PUT", body: "b" });

	assert.equal((await move({ from: "0:/gcodes/nope.g", to: "0:/gcodes/x.g" })).status, 404);
	assert.equal((await move({ from: "0:/gcodes/a.g", to: "0:/gcodes/b.g" })).status, 500, "clobber refused");
	assert.equal((await move({ from: "0:/gcodes/a.g", to: "0:/gcodes/b.g", force: "true" })).status, 204);
	assert.equal(await (await fetch(`${mock.base}/machine/file/0:/gcodes/b.g`)).text(), "a");
	assert.equal((await fetch(`${mock.base}/machine/file/0:/gcodes/a.g`)).status, 404);
});

test("file/move parses real multipart FormData too", T, async t => {
	const mock = await startDsf();
	t.after(() => mock.close());

	await fetch(`${mock.base}/machine/file/0:/gcodes/m1.g`, { method: "PUT", body: "m" });
	const form = new FormData();
	form.set("from", "0:/gcodes/m1.g");
	form.set("to", "0:/gcodes/m2.g");
	const res = await fetch(`${mock.base}/machine/file/move`, { method: "POST", body: form });
	assert.equal(res.status, 204);
	assert.equal(await (await fetch(`${mock.base}/machine/file/0:/gcodes/m2.g`)).text(), "m");
});

test("fileinfo: DSF shape; thumbnail data only with readThumbnailContent=true", T, async t => {
	const mock = await startDsf();
	t.after(() => mock.close());

	const bare = await fetch(`${mock.base}/machine/fileinfo/0:/gcodes/benchy.gcode`);
	assert.equal(bare.status, 200);
	const info = await bare.json() as any;
	assert.equal(info.fileName, "0:/gcodes/benchy.gcode");
	assert.ok(info.size > 0);
	assert.equal(info.thumbnails[0].width, 16);
	assert.equal(info.thumbnails[0].data, null, "thumbnail bytes must be opt-in");

	const withData = await fetch(
		`${mock.base}/machine/fileinfo/0:/gcodes/benchy.gcode?readThumbnailContent=true`,
	);
	const full = await withData.json() as any;
	assert.equal(full.thumbnails[0].data, THUMBNAIL_PNG_BASE64, "same source rr_thumbnail serves");

	assert.equal((await fetch(`${mock.base}/machine/fileinfo/0:/gcodes/nope.gcode`)).status, 404);
});

// --- dsf: false regression ---

test("without dsf: true, /machine/* stays exactly as before", T, async t => {
	const plainMock = await startMock();
	t.after(() => plainMock.close());
	assert.equal((await fetch(`${plainMock.base}/machine/status`)).status, 404);
	assert.equal((await fetch(`${plainMock.base}/machine/connect`)).status, 404);
	const model = await fetch(`${plainMock.base}/machine/model`);
	assert.equal(model.status, 404, "the emulated-only model route still refuses without emulated: true");

	const emulatedMock = await startMock({ emulated: true });
	t.after(() => emulatedMock.close());
	assert.equal((await fetch(`${emulatedMock.base}/machine/model`)).status, 200, "emulated model route unregressed");
	assert.equal((await fetch(`${emulatedMock.base}/machine/status`)).status, 404);
});
