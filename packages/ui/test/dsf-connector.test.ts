import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import type { Duplex } from "node:stream";
import { createMockServer, type MockServer, type MockServerOptions } from "../../mock-duet/src/server.ts";
import { THUMBNAIL_PNG_BASE64 } from "../../mock-duet/src/files.ts";
import { DsfConnector, type DsfConnectorOptions } from "../src/connector/DsfConnector.ts";
import { EMERGENCY_STOP } from "../src/connector/emergency.ts";
import {
	DisconnectedError, FileNotFoundError, InvalidPasswordError, OperationFailedError,
	type ConnectionStatus,
} from "../src/connector/types.ts";

/**
 * End-to-end DsfConnector tests: a real DsfConnector talking WebSocket +
 * REST to an in-process mock-duet in DSF mode (design D11), simulation
 * timer disabled — tests drive the machine state directly and observe the
 * connector's events. Faults the mock has no API for (a firewalled or
 * crashed DCS) are simulated on the raw upgraded TCP socket, which a
 * second — purely observational — 'upgrade' listener captures.
 */

const T = { timeout: 15_000 };

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function until(cond: () => boolean, label: string, ms = 5000): Promise<void> {
	const start = Date.now();
	while (!cond()) {
		if (Date.now() - start > ms) throw new Error(`timed out after ${ms} ms: ${label}`);
		await sleep(10);
	}
}

interface Harness {
	mock: MockServer;
	connector: DsfConnector;
	/** Every onModelKey emission, in order. */
	keys: Array<{ key: string; value: unknown }>;
	replies: string[];
	statuses: ConnectionStatus[];
	layerEvents: unknown[][];
	boardInfos: Array<{ emulated: boolean; boardType?: string; transport?: string }>;
	/** Flat event trace ("key:heat", "layers", "status:connected", …). */
	log: string[];
	/** Raw upgraded TCP sockets, oldest first (pause = firewall, destroy = crash). */
	rawSockets: Duplex[];
	/** Most recent onModelKey value for one key. */
	latest(key: string): unknown;
	close(): Promise<void>;
}

async function startHarness(
	mockOptions: MockServerOptions = {},
	connectorOptions: Partial<DsfConnectorOptions> = {},
): Promise<Harness> {
	const mock = createMockServer({ dsf: true, tickMs: 0, ...mockOptions });
	const rawSockets: Duplex[] = [];
	mock.server.on("upgrade", (_req, socket) => {
		rawSockets.push(socket);
	});
	const port = await mock.listen(0);

	const keys: Array<{ key: string; value: unknown }> = [];
	const replies: string[] = [];
	const statuses: ConnectionStatus[] = [];
	const layerEvents: unknown[][] = [];
	const boardInfos: Array<{ emulated: boolean; boardType?: string; transport?: string }> = [];
	const log: string[] = [];

	const connector = new DsfConnector({
		baseUrl: `http://127.0.0.1:${port}`,
		pingIntervalMs: 50,
		reconnectDelayMs: 25,
		requestTimeoutMs: 2000,
		events: {
			onModelKey: (key, value) => {
				keys.push({ key, value });
				log.push(`key:${key}`);
			},
			onJobLayers: layers => {
				layerEvents.push(layers);
				log.push("layers");
			},
			onReply: text => {
				replies.push(text);
				log.push("reply");
			},
			onStatusChange: status => {
				statuses.push(status);
				log.push(`status:${status}`);
			},
			onBoardInfo: info => {
				boardInfos.push(info);
				log.push("boardInfo");
			},
		},
		...connectorOptions,
	});

	return {
		mock, connector, keys, replies, statuses, layerEvents, boardInfos, log, rawSockets,
		latest(key: string): unknown {
			for (let i = keys.length - 1; i >= 0; i--) {
				if (keys[i]!.key === key) return keys[i]!.value;
			}
			return undefined;
		},
		async close() {
			await connector.disconnect().catch(() => undefined);
			await mock.close().catch(() => undefined);
		},
	};
}

// ---- the push channel ----

test("connect emits the FULL model wholesale — and resolves only after", T, async () => {
	const h = await startHarness();
	try {
		// The base model ships a non-empty layer history: exactly what must
		// ride onJobLayers while the job emission itself carries layers: [].
		const seededLayers = structuredClone(h.mock.machine.om.job.layers) as unknown[];
		assert.ok(seededLayers.length > 0, "precondition: the base model has layer history");

		await h.connector.connect().then(() => h.log.push("resolved"));

		// Every snapshot key arrived as a wholesale subtree BEFORE resolve.
		const resolvedAt = h.log.indexOf("resolved");
		assert.equal(resolvedAt, h.log.length - 1, "nothing may follow the resolution marker");
		for (const key of ["boards", "heat", "move", "state", "tools", "job", "network", "sensors", "volumes"]) {
			const at = h.log.indexOf(`key:${key}`);
			assert.ok(at !== -1 && at < resolvedAt, `${key} emitted before connect() resolved`);
		}
		assert.ok(h.log.indexOf("layers") < resolvedAt, "onJobLayers fired before resolve");
		assert.ok(h.log.indexOf("boardInfo") < resolvedAt, "onBoardInfo fired before resolve");
		assert.ok(h.log.indexOf("status:connected") < resolvedAt, "status flipped before resolve");
		assert.deepEqual(h.statuses, ["connecting", "connected"]);

		// C4: the job snapshot NEVER carries layers; the layers channel does.
		const job = h.latest("job") as Record<string, unknown>;
		assert.deepEqual(job.layers, [], "job emissions pin layers: []");
		assert.equal(h.layerEvents.length, 1);
		assert.deepEqual(h.layerEvents[0], seededLayers, "the real history rides onJobLayers");

		// D3/C5: messages is a consumed channel, never a model key.
		assert.ok(!h.keys.some(e => e.key === "messages"), "messages must never be model data");

		// D10: this transport announces itself.
		assert.deepEqual(h.boardInfos, [{ emulated: false, transport: "dsf", boardType: "Mini5plus" }]);

		const move = h.latest("move") as Record<string, unknown>;
		assert.ok(Array.isArray(move.axes) && move.axes.length === 3, "full subtrees, not fragments");
	} finally {
		await h.close();
	}
});

test("ack-gated diffs land wholesale for exactly the touched keys, push after push", T, async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		h.keys.length = 0;

		h.mock.machine.advance(2000);
		await until(() => h.latest("state") !== undefined, "first diff push");
		const touched = new Set(h.keys.map(e => e.key));
		assert.ok(touched.has("state") && touched.has("heat"), "the changed subtrees arrived");
		for (const key of ["job", "tools", "directories", "limits", "network"]) {
			assert.ok(!touched.has(key), `untouched subtree "${key}" must not be re-emitted`);
		}
		// Wholesale replacement: the whole subtree, not the sparse diff.
		const state = h.latest("state") as Record<string, unknown>;
		assert.equal(state.upTime, 2);
		assert.equal(state.status, "idle", "unchanged fields are present — this is the full subtree");

		// The ack ladder continues: a later change flows through the next push.
		h.mock.machine.advance(1000);
		await until(() => (h.latest("state") as Record<string, unknown>).upTime === 3, "second diff push");
	} finally {
		await h.close();
	}
});

test("an array shrink survives end-to-end as a TRUNCATED wholesale subtree", T, async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		const heaters = h.mock.machine.om.heat.heaters as unknown[];
		assert.equal(heaters.length, 2, "precondition: bed + hotend");
		h.keys.length = 0;

		heaters.pop(); // the wire announces the shorter array full-length
		await until(() => h.latest("heat") !== undefined, "shrink push");

		const heat = h.latest("heat") as Record<string, unknown>;
		assert.ok(Array.isArray(heat.heaters));
		assert.equal((heat.heaters as unknown[]).length, 1, "truncation reached the emission");
		assert.deepEqual([...new Set(h.keys.map(e => e.key))], ["heat"], "only heat was touched");
	} finally {
		await h.close();
	}
});

test("onJobLayers fires on growth and resets to [] for a new print — job stays untouched", T, async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		const job = h.mock.machine.om.job as Record<string, unknown>;
		const history = job.layers as unknown[];
		const baseline = history.length;
		h.keys.length = 0;
		h.layerEvents.length = 0;

		// A completed layer: the connector re-emits the WHOLE history.
		history.push({ duration: 57, filament: [455], fractionPrinted: 0.25, height: 1.8, temperatures: [] });
		await until(() => h.layerEvents.length === 1, "growth event");
		assert.equal((h.layerEvents[0] as unknown[]).length, baseline + 1);
		// A layers-only change is NOT a job change (C4): the job emission
		// would be byte-identical, so it must not fire at all.
		assert.ok(!h.keys.some(e => e.key === "job"), "layers-only diffs never re-emit job");

		// New print: the shrink-to-empty must reach the store as [].
		job.layers = [];
		await until(() => h.layerEvents.length === 2, "reset event");
		assert.deepEqual(h.layerEvents[1], [], "a new print's empty history resets wholesale");
	} finally {
		await h.close();
	}
});

test("a machine reply arrives via onReply exactly once, never as model data", T, async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		h.replies.length = 0;
		h.keys.length = 0;

		h.mock.machine.emitReply("job done");
		await until(() => h.replies.length === 1, "reply push");
		assert.deepEqual(h.replies, ["job done"]);
		assert.equal(h.keys.length, 0, "a messages-only push touches no model keys");

		// Later pushes must not repeat the consumed message.
		h.mock.machine.advance(1000);
		await until(() => h.latest("state") !== undefined, "follow-up push");
		assert.deepEqual(h.replies, ["job done"], "a consumed reply can never reappear");
		assert.ok(!h.keys.some(e => e.key === "messages"));
	} finally {
		await h.close();
	}
});

test("a severity prefix survives the whole transport exactly once", T, async () => {
	// Severity crosses the wire as `type` and is re-derived on arrival. The
	// two halves are written independently, so only an end-to-end assertion
	// catches them disagreeing — it caught exactly that ("Error: Error: …").
	const h = await startHarness();
	try {
		await h.connector.connect();
		h.replies.length = 0;

		h.mock.machine.emitReply("Error: Heater 1 fault");
		await until(() => h.replies.length === 1, "error reply push");
		assert.deepEqual(h.replies, ["Error: Heater 1 fault"]);

		h.mock.machine.emitReply("Warning: bed is cold");
		await until(() => h.replies.length === 2, "warning reply push");
		assert.equal(h.replies[1], "Warning: bed is cold");
	} finally {
		await h.close();
	}
});

// ---- liveness, sessions, reconnect ----

test("PONGs keep a quiet connection alive across the mock's idle expiry", T, async () => {
	// pingIntervalMs 40 → liveness deadline 1080 ms. Nothing changes on the
	// machine for well past that AND past the mock's 250 ms session sweep:
	// only PING/PONG traffic exists. If PONG frames did not stamp the
	// liveness clock, the connector would false-positive into reconnecting.
	const h = await startHarness(
		{ password: "secret", sessionTimeout: 250 },
		{ password: "secret", pingIntervalMs: 40 },
	);
	try {
		await h.connector.connect();
		await sleep(1400);
		assert.ok(!h.statuses.includes("reconnecting"), "a ponging socket is a live socket");
		assert.equal(h.connector.status, "connected");
		assert.equal(h.mock.sessions.size, 1, "the WS-held session survived idle expiry");
	} finally {
		await h.close();
	}
});

test("a silent (firewalled) socket trips the liveness deadline; the ladder recovers", T, async () => {
	const h = await startHarness({}, { pingIntervalMs: 30, reconnectDelayMs: 30 });
	try {
		await h.connector.connect();
		h.keys.length = 0;
		h.boardInfos.length = 0;

		// Firewall: the server stops READING (no PONGs, no acks processed)
		// but the TCP connection stays up — the exact silent-death mode the
		// deadline exists for. No close frame will ever arrive.
		h.rawSockets[0]!.pause();
		await until(() => h.statuses.includes("reconnecting"), "liveness deadline expiry", 6000);

		// Recovery: a fresh socket, a fresh model, everything re-emitted.
		await until(() => h.connector.status === "connected", "reconnect completed");
		assert.equal(h.rawSockets.length, 2, "recovery used a NEW socket");
		for (const key of ["boards", "heat", "move", "state", "tools"]) {
			assert.ok(h.keys.some(e => e.key === key), `${key} re-emitted from the fresh full frame`);
		}
		assert.equal(h.boardInfos.length, 1, "boardInfo re-announced on reconnect");
	} finally {
		await h.close();
	}
});

test("M999 kills every session; reconnect negotiates a fresh one and re-emits fresh truth", T, async () => {
	const h = await startHarness(
		{ password: "secret" },
		{ password: "secret", pingIntervalMs: 200, reconnectDelayMs: 25 },
	);
	try {
		await h.connector.connect();
		assert.equal(h.mock.sessions.size, 1);
		h.mock.machine.advance(5000);
		await until(() => (h.latest("state") as Record<string, unknown> | undefined)?.upTime === 5, "pre-reset diff");

		// M999 through the one execution authority: the machine resets and
		// EVERY session dies, including the WS-pinned one — then the DCS
		// restart takes the socket down (no close frame; simulated by
		// destroying the raw TCP socket).
		h.mock.machine.execute("M999");
		assert.equal(h.mock.sessions.size, 0, "precondition: sessions incl. the pinned one are gone");
		h.keys.length = 0;
		h.rawSockets.at(-1)!.destroy();

		await until(() => h.statuses.includes("reconnecting"), "socket death noticed");
		await until(() => h.connector.status === "connected", "reconnected");

		// The old key was dead, so this MUST have been a fresh
		// /machine/connect — a reused stale key would be refused (1008) and
		// never reach connected.
		assert.equal(h.mock.sessions.size, 1, "a brand-new session was negotiated");
		// C8: the first frame replaced everything — fresh truth, not a resume.
		await until(() => h.latest("state") !== undefined, "full model re-emitted");
		assert.equal((h.latest("state") as Record<string, unknown>).upTime, 0, "post-reset truth, not stale");
		for (const key of ["boards", "tools", "move"]) {
			assert.ok(h.keys.some(e => e.key === key), `${key} re-emitted wholesale`);
		}
	} finally {
		await h.close();
	}
});

test("wrong password is terminal: InvalidPasswordError, no socket, no retry loop", T, async () => {
	const h = await startHarness({ password: "secret" }, { password: "nope" });
	try {
		await assert.rejects(h.connector.connect(), (err: unknown) => err instanceof InvalidPasswordError);
		assert.deepEqual(h.statuses, ["connecting", "disconnected"]);
		assert.equal(h.rawSockets.length, 0, "the 403 precedes any WebSocket attempt");

		// Several reconnectDelayMs windows: a ladder would show itself here.
		await sleep(200);
		assert.deepEqual(h.statuses, ["connecting", "disconnected"], "terminal means terminal");
		assert.equal(h.rawSockets.length, 0);
	} finally {
		await h.close();
	}
});

test("deliberate disconnect: session dropped, no ladder, no timer left behind", T, async () => {
	const h = await startHarness({ password: "secret" }, { password: "secret", pingIntervalMs: 20, reconnectDelayMs: 20 });
	try {
		await h.connector.connect();
		assert.equal(h.mock.sessions.size, 1);

		await h.connector.disconnect();
		assert.equal(h.connector.status, "disconnected");
		assert.equal(h.mock.sessions.size, 0, "the goodbye reached /machine/disconnect");

		// Many fake-fast ping/reconnect intervals: a leaked timer or ladder
		// would open a new socket or flip the status. (A leaked interval
		// would also hang the test runner at exit — that gate is implicit.)
		await sleep(300);
		assert.equal(h.statuses.at(-1), "disconnected");
		assert.equal(h.rawSockets.length, 1, "no reconnection after a deliberate close");
	} finally {
		await h.close();
	}
});

// ---- codes ----

test("sendCode returns the reply text; silent codes answer empty and act", T, async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		assert.match(await h.connector.sendCode("M115"), /FIRMWARE/i);

		assert.equal(await h.connector.sendCode("M104 S200"), "", "silent codes resolve empty");
		assert.equal(h.mock.machine.om.heat.heaters[1].active, 200, "…but the code ran");
	} finally {
		await h.close();
	}
});

test("while reconnecting, sendCode refuses — but the e-stop still reaches the machine", T, async () => {
	// reconnectDelayMs 60 s holds the connector in "reconnecting" for the
	// whole test; disconnect() at the end must clear that pending timer or
	// the runner would hang for a minute (the timer-leak red-check).
	const h = await startHarness({}, { pingIntervalMs: 100, reconnectDelayMs: 60_000 });
	try {
		await h.connector.connect();
		h.rawSockets[0]!.destroy();
		await until(() => h.connector.status === "reconnecting", "socket death noticed");

		await assert.rejects(h.connector.sendCode("G28"), (err: unknown) => err instanceof DisconnectedError);

		// C9: the e-stop bypasses the status gate entirely.
		assert.equal(await h.connector.sendCode("M112"), "");
		assert.equal(h.mock.machine.om.state.status, "halted", "observed at the machine");
	} finally {
		await h.close();
	}
});

test("a failed e-stop REJECTS — the STOP button's alarm depends on it", T, async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		await h.mock.close(); // the server is gone; nothing can accept the POST
		await assert.rejects(
			h.connector.sendCode(EMERGENCY_STOP),
			(err: unknown) => err instanceof OperationFailedError,
		);
	} finally {
		await h.close();
	}
});

// ---- files (D7) ----

test("download returns content; a missing file is FileNotFoundError", T, async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		assert.match(await h.connector.download("0:/sys/config.g"), /M550/);
		await assert.rejects(
			h.connector.download("0:/sys/does-not-exist.g"),
			(err: unknown) => err instanceof FileNotFoundError,
		);
	} finally {
		await h.close();
	}
});

test("upload creates, overwrites, round-trips bytes, and accepts an empty file", T, async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		await h.connector.upload("0:/macros/dsf-test.g", "; v1\nM117 hello\n");
		assert.equal(await h.connector.download("0:/macros/dsf-test.g"), "; v1\nM117 hello\n");

		await h.connector.upload("0:/macros/dsf-test.g", "; v2\n");
		assert.equal(await h.connector.download("0:/macros/dsf-test.g"), "; v2\n", "PUT overwrites");

		await h.connector.upload("0:/macros/dsf-bytes.g", new TextEncoder().encode("G28 ; bytes\n"));
		assert.equal(await h.connector.download("0:/macros/dsf-bytes.g"), "G28 ; bytes\n");

		await h.connector.upload("0:/macros/dsf-empty.g", "");
		assert.equal(await h.connector.download("0:/macros/dsf-empty.g"), "", "a zero-byte file is a file");
	} finally {
		await h.close();
	}
});

test("move refuses to clobber (typed) unless forced; a missing source is FileNotFoundError", T, async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		await h.connector.upload("0:/gcodes/a.g", "G28\n");
		await h.connector.upload("0:/gcodes/b.g", "G29\n");

		await assert.rejects(
			h.connector.move("0:/gcodes/a.g", "0:/gcodes/b.g"),
			(err: unknown) => err instanceof OperationFailedError,
			"clobbering must take a deliberate act",
		);
		await h.connector.move("0:/gcodes/a.g", "0:/gcodes/b.g", true);
		assert.equal(await h.connector.download("0:/gcodes/b.g"), "G28\n", "force moved the content");
		await assert.rejects(
			h.connector.move("0:/gcodes/a.g", "0:/gcodes/c.g"),
			(err: unknown) => err instanceof FileNotFoundError,
			"the source is gone now",
		);
	} finally {
		await h.close();
	}
});

test("remove needs recursive for a non-empty directory; mkdir rejects a duplicate", T, async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		await h.connector.mkdir("0:/gcodes/batch");
		await assert.rejects(
			h.connector.mkdir("0:/gcodes/batch"),
			(err: unknown) => err instanceof OperationFailedError,
		);
		await h.connector.upload("0:/gcodes/batch/one.g", "G28\n");

		await assert.rejects(
			h.connector.remove("0:/gcodes/batch"),
			(err: unknown) => err instanceof OperationFailedError,
			"a non-empty directory must not vanish over a forgotten flag",
		);
		await h.connector.remove("0:/gcodes/batch", true);
		const names = (await h.connector.list("0:/gcodes")).map(e => e.name);
		assert.ok(!names.includes("batch"));
	} finally {
		await h.close();
	}
});

test("list carries the FileListEntry shape with lexicographically sortable dates", T, async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		const entries = await h.connector.list("0:/gcodes");
		const benchy = entries.find(e => e.name === "benchy.gcode");
		assert.ok(benchy, "seeded file present");
		assert.equal(benchy.type, "f");
		assert.ok(benchy.size > 0);
		// DSF's date format sorts as a string — the recent-sort contract.
		assert.match(benchy.date ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
	} finally {
		await h.close();
	}
});

test("fileinfo → getThumbnail round-trips the offset token to real image bytes", T, async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		const info = await h.connector.getFileInfo("0:/gcodes/benchy.gcode");
		assert.equal(info.fileName, "0:/gcodes/benchy.gcode");
		assert.equal(info.numLayers, 240);
		const thumb = info.thumbnails[0];
		assert.ok(thumb, "thumbnail descriptor present");
		assert.equal(thumb.format, "png");
		assert.deepEqual([thumb.width, thumb.height], [16, 16]);

		// The offset is opaque to the caller — whatever fileinfo said is what
		// selects the content, and the content is genuinely decoded base64.
		const bytes = await h.connector.getThumbnail("0:/gcodes/benchy.gcode", thumb.offset);
		const expected = new Uint8Array(Buffer.from(THUMBNAIL_PNG_BASE64, "base64"));
		assert.deepEqual([...bytes.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47], "PNG magic — real bytes, not base64 text");
		assert.deepEqual(bytes, expected, "byte-exact round-trip");

		await assert.rejects(
			h.connector.getThumbnail("0:/gcodes/benchy.gcode", 999_999),
			(err: unknown) => err instanceof OperationFailedError,
			"an unknown offset is a typed failure",
		);

		await assert.rejects(
			h.connector.getFileInfo("0:/gcodes/none-such.gcode"),
			(err: unknown) => err instanceof FileNotFoundError,
		);
	} finally {
		await h.close();
	}
});
