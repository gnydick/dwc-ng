import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import http from "node:http";
import { createHash } from "node:crypto";
import type { Duplex } from "node:stream";
import { createMockServer, type MockServer, type MockServerOptions } from "../../mock-duet/src/server.ts";
import { THUMBNAIL_PNG_BASE64 } from "../../mock-duet/src/files.ts";
import { DsfConnector, type DsfConnectorOptions } from "../src/DsfConnector.ts";
import { EMERGENCY_STOP } from "../src/emergency.ts";
import { createVirtualClock, type VirtualClock } from "./virtualClock.ts";
import { createLinkGate } from "./linkGate.ts";
import {
	DisconnectedError, FileNotFoundError, InvalidPasswordError, OperationFailedError,
	type ConnectionStatus,
} from "../src/types.ts";

/**
 * End-to-end DsfConnector tests: a real DsfConnector talking WebSocket +
 * REST to an in-process mock-duet in DSF mode (design D11), simulation
 * timer disabled — tests drive the machine state directly and observe the
 * connector's events. Faults the mock has no API for (a firewalled or
 * crashed DCS) are simulated on the raw upgraded TCP socket, which a
 * second — purely observational — 'upgrade' listener captures.
 *
 * TIME is virtual here. Every connector in this file is constructed with its
 * OWN VirtualClock (src/clock.ts; never a swapped global — `node --test` runs
 * these files concurrently), so a liveness deadline, a reconnect delay and a
 * request budget are all things the test MOVES rather than waits for. That
 * bought two things. It took this file from 12.9 s to 1.1 s — it was the whole
 * reason the battery took 15 s — and it made the timing
 * assertions exact: "nothing at 1050 ms, the ladder at 1080 ms" is a claim
 * about the deadline, where "wait 1.4 s and look" was only a claim about the
 * end state.
 *
 * The NETWORK is still real. A reconnect genuinely opens a socket to the mock
 * over loopback, which costs real milliseconds — so the pattern below is
 * "advance the clock to make the connector act, then `until(...)` to let the
 * I/O it started finish".
 */

const T = { timeout: 15_000 };

/**
 * The mock's idle session sweep is the one deadline in this file that is NOT
 * on the connector's clock: it reads wall time inside mock-duet, a different
 * package and out of scope here. So exactly one real wait survives, and it is
 * this one.
 */
const SESSION_TIMEOUT_MS = 250;
const SESSION_SWEEP_MS = SESSION_TIMEOUT_MS + 20;

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

/**
 * Move the connector's clock forward in steps until `cond` holds, letting the
 * real network run between steps.
 *
 * Use this where the point is "get there" — a reconnect ladder that may need
 * several attempts, say. Where the point is "get there at exactly T", use
 * `clock.advance()` directly: a step size is an approximation, and the
 * deadline assertions in this file are not approximate.
 */
async function advanceUntil(
	clock: VirtualClock, cond: () => boolean, label: string, stepMs = 25, maxMs = 120_000,
): Promise<void> {
	let moved = 0;
	while (!cond()) {
		if (moved >= maxMs) throw new Error(`never held within ${maxMs} virtual ms: ${label}`);
		await clock.advance(stepMs);
		moved += stepMs;
	}
}

interface Harness {
	mock: MockServer;
	connector: DsfConnector;
	/** The connector's own clock. Nothing in this file waits on wall time. */
	clock: VirtualClock;
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

	const clock = createVirtualClock();
	const connector = new DsfConnector({
		baseUrl: `http://127.0.0.1:${port}`,
		clock,
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
		mock, connector, clock, keys, replies, statuses, layerEvents, boardInfos, log, rawSockets,
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

/**
 * A bare HTTP server that completes the RFC6455 handshake and then says
 * NOTHING — the "socket opens but never pushes" fault the mock cannot
 * express (it always sends the full model on connection). Used to prove the
 * liveness deadline is armed before the first frame.
 */
function createSilentUpgradeServer(): { listen(): Promise<number>; upgrades(): number; close(): Promise<void> } {
	const server = http.createServer();
	const sockets: Duplex[] = [];
	server.on("upgrade", (req, socket) => {
		sockets.push(socket);
		const key = req.headers["sec-websocket-key"] ?? "";
		const accept = createHash("sha1")
			.update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
			.digest("base64");
		socket.write(
			"HTTP/1.1 101 Switching Protocols\r\n" +
			"Upgrade: websocket\r\nConnection: Upgrade\r\n" +
			`Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
		);
		// …and then deliberately nothing. The socket is open and healthy at
		// the TCP layer; no frame ever arrives.
	});
	return {
		listen: () => new Promise<number>(resolve => server.listen(0, () => {
			resolve((server.address() as { port: number }).port);
		})),
		// Completed handshakes. Virtual time can outrun a real TCP upgrade, so
		// the test waits for THIS before claiming the socket went silent.
		upgrades: () => sockets.length,
		close: () => new Promise<void>(resolve => {
			// http close() does NOT reap upgraded sockets — destroy them by
			// hand or node never exits (the very gotcha the campaign fixed for
			// mock-duet; here it is the test's own throwaway server).
			for (const s of sockets) s.destroy();
			// …and it does not reap the ORDINARY connection either. The aborted
			// /machine/connect probe leaves a socket this server is still
			// holding open, and close() then waits out its 5 s keep-alive
			// timeout: that alone was 4 s of the battery once virtual time had
			// removed everything else from this test.
			server.closeAllConnections();
			server.close(() => resolve());
		}),
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
	// machine: only PING/PONG traffic exists. If PONG frames did not stamp the
	// liveness clock, the connector would false-positive into reconnecting.
	const h = await startHarness(
		{ password: "secret", sessionTimeout: SESSION_TIMEOUT_MS },
		{ password: "secret", pingIntervalMs: 40 },
	);
	try {
		await h.connector.connect();
		const deadlineMs = 2 * 40 + 1000;

		// THREE full deadlines of virtual quiet, walked one ping interval at a
		// time so each PONG has a real turn of the loop to cross the loopback
		// socket and stamp the clock. The old version of this test waited
		// 1400 ms of wall time — 1.3 deadlines — and cost 1.4 s; this covers
		// more than twice the silence and costs the network round trips only.
		for (let elapsed = 0; elapsed < 3 * deadlineMs; elapsed += 40) {
			await h.clock.advance(40);
			assert.ok(!h.statuses.includes("reconnecting"),
				`the ladder started after ${elapsed + 40} ms of PONGed silence (deadline ${deadlineMs} ms)`);
		}
		assert.equal(h.connector.status, "connected");
		assert.equal(h.rawSockets.length, 1, "the original socket was never replaced");

		// The mock's idle sweep reads WALL time — it is the mock's clock, not
		// the connector's, and mock-duet is out of scope here — so proving the
		// WS-held session outlived it still costs one real wait. Only this one.
		await sleep(SESSION_SWEEP_MS);
		assert.equal(h.mock.sessions.size, 1, "the WS-held session survived idle expiry");
	} finally {
		await h.close();
	}
});

test("a silent (firewalled) socket trips the ladder AT the deadline, not before", T, async () => {
	// This is the test virtual time was worth having. It used to pause the
	// socket, wait up to 6 s for "reconnecting" to appear, and assert the end
	// state — which cannot tell a deadline that fires at 1060 ms from one that
	// fires at 40 ms because of a bug in `lastSeen`. Now every instant is
	// exact: nothing at 1050 ms, the ladder at 1080 ms, the attempt at 1110 ms.
	const pingMs = 30;
	const reconnectMs = 30;
	const h = await startHarness({}, { pingIntervalMs: pingMs, reconnectDelayMs: reconnectMs });
	try {
		await h.connector.connect();
		h.keys.length = 0;
		h.boardInfos.length = 0;
		const deadlineMs = 2 * pingMs + 1000; // D5/C7

		// The whole handshake ran without the clock moving, so the liveness
		// stamp is exactly `now` and the arithmetic below is not an estimate.
		assert.equal(h.clock.now(), 0, "connect() consumed no virtual time");

		// Firewall: the server stops READING (no PONGs, no acks processed)
		// but the TCP connection stays up — the exact silent-death mode the
		// deadline exists for. No close frame will ever arrive.
		h.rawSockets[0]!.pause();

		// The deadline expires at the first ping tick STRICTLY past it, so the
		// last tick that still sees a live socket is at 1050 ms and the first
		// that does not is at 1080 ms. Both instants are asserted.
		const lastQuietTick = Math.floor(deadlineMs / pingMs) * pingMs;
		await h.clock.advance(lastQuietTick);
		assert.equal(h.connector.status, "connected", `torn down early, at ${h.clock.now()} ms of silence`);
		assert.ok(!h.statuses.includes("reconnecting"), "the ladder must not start before the deadline");

		// The very next tick is the first one PAST the deadline.
		await h.clock.advance(pingMs);
		assert.equal(h.connector.status, "reconnecting", `deadline of ${deadlineMs} ms did not fire at ${h.clock.now()} ms`);
		assert.equal(h.rawSockets.length, 1, "noticing the death is not yet an attempt");

		// …and the attempt itself waits its full backoff, no less.
		await h.clock.advance(reconnectMs - 1);
		assert.equal(h.rawSockets.length, 1, `the ladder attempted early, ${reconnectMs - 1} ms into a ${reconnectMs} ms delay`);
		await h.clock.advance(1);

		// Recovery: a fresh socket, a fresh model, everything re-emitted. The
		// socket and the model are real, so this part waits on real I/O.
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
		// The backoff is virtual; the session negotiation and socket are real.
		await advanceUntil(h.clock, () => h.connector.status === "connected", "reconnected");

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

		// Ten virtual MINUTES — where this used to be 200 ms of real waiting,
		// which is under three reconnectDelayMs windows. A ladder, a retry, a
		// stray keepalive: anything at all would have to show itself in that.
		assert.equal(h.clock.pendingScheduled(), 0,
			`a terminal failure armed a timer: ${h.clock.describePending()}`);
		await h.clock.advance(10 * 60_000);
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

		// The leak check, stated directly instead of inferred. On wall time the
		// best this test could do was sleep 300 ms and hope a leaked timer
		// showed itself (and lean on a leaked interval hanging the runner at
		// exit — an implicit gate that a virtual timer no longer trips, which
		// is precisely why the count below replaces it). Now the question
		// "did disconnect() leave anything armed?" is asked, not sampled.
		assert.equal(h.clock.pendingScheduled(), 0,
			`disconnect() left a timer armed: ${h.clock.describePending()}`);
		// And a minute of virtual time confirms nothing wakes up on its own.
		await h.clock.advance(60_000);
		assert.equal(h.statuses.at(-1), "disconnected");
		assert.equal(h.rawSockets.length, 1, "no reconnection after a deliberate close");
	} finally {
		await h.close();
	}
});

/**
 * The starvation reproduction (GIT_110). A flapping link is not a rare event
 * on a printer in a workshop, and every trip round the ladder used to take a
 * fresh session slot and abandon the one it was replacing. The mock's OWN
 * defaults are used deliberately — maxSessions 4, sessionTimeout 8000 — so the
 * numbers here are the ticket's arithmetic, not a fixture tuned to fail.
 *
 * The socket is FIREWALLED rather than destroyed: a destroyed socket tells the
 * server the client is gone, which unpins the session and lets the idle sweep
 * clean up after us. A paused one does not, so the only thing that can free the
 * slot is a goodbye the connector sends — which is exactly the property under
 * test, and exactly what a WiFi drop looks like from the board's side.
 */
test("a flapping link holds ONE session slot, however many reconnects", T, async () => {
	const pingMs = 20;
	const reconnectMs = 25;
	const h = await startHarness(
		{ maxSessions: 4, sessionTimeout: 8000 },
		{ pingIntervalMs: pingMs, reconnectDelayMs: reconnectMs },
	);
	try {
		await h.connector.connect();
		assert.equal(h.mock.sessions.size, 1, "one tab, one slot");

		const slots: number[] = [];
		let stalled: string | null = null;
		for (let i = 0; i < 6; i++) {
			h.rawSockets.at(-1)!.pause();
			const before = h.rawSockets.length;
			try {
				await advanceUntil(
					h.clock,
					() => h.connector.status === "connected" && h.rawSockets.length > before,
					`reconnect ${i + 1} completed`, 25, 4000,
				);
			} catch (err) {
				stalled = (err as Error).message;
				break;
			}
			slots.push(h.mock.sessions.size);
		}

		assert.equal(stalled, null,
			`the ladder stopped recovering after ${slots.length} reconnects, with ${h.mock.sessions.size}/4 slots in use`);
		assert.deepEqual(slots, [1, 1, 1, 1, 1, 1],
			"steady-state slot usage for ONE browser tab is ONE, however many reconnects");
	} finally {
		await h.close();
	}
});

/**
 * Requirement 2, on the DSF transport. A goodbye is best effort: with the link
 * genuinely dead the board never hears it, and that must cost the ladder
 * NOTHING — not a stall, not a missed attempt, not a connector that never comes
 * back. The orphan left behind is the accepted price and the board's idle sweep
 * collects it; a ladder waiting on a network that will not answer is not.
 *
 * A TCP gate rather than the firewall trick above, because here BOTH halves
 * must die: the WebSocket and the REST call the goodbye rides on.
 */
test("a goodbye into a black hole neither stalls nor breaks the ladder", T, async () => {
	const mock = createMockServer({ dsf: true, tickMs: 0, maxSessions: 4, sessionTimeout: 60_000 });
	const boardPort = await mock.listen(0);
	const gate = createLinkGate(boardPort);
	const gatePort = await gate.listen();
	const clock = createVirtualClock();
	const connector = new DsfConnector({
		baseUrl: `http://127.0.0.1:${gatePort}`,
		clock,
		pingIntervalMs: 20,
		reconnectDelayMs: 25,
		requestTimeoutMs: 2000,
		events: {},
	});
	try {
		await connector.connect();
		assert.equal(mock.sessions.size, 1, "one tab, one slot");

		gate.blackhole();
		// Nothing FAILS in a black hole; the liveness deadline is what notices.
		await advanceUntil(clock, () => connector.status === "reconnecting",
			"the liveness deadline noticed the silence", 25, 20_000);
		const attemptsAtCut = gate.attempts();

		// Each attempt now tries to hand the old key back over a dead link,
		// fails, and must carry on to the connect regardless.
		await advanceUntil(clock, () => gate.attempts() > attemptsAtCut + 1,
			"the ladder kept attempting while the link was down", 25, 20_000);

		gate.restore();
		await advanceUntil(clock, () => connector.status === "connected",
			"recovered once the link returned", 25, 20_000);
		assert.equal(connector.status, "connected");
	} finally {
		await connector.disconnect().catch(() => undefined);
		await gate.close();
		await mock.close();
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

test("a solicited code reply reaches the console via onReply, exactly once", T, async () => {
	// The console reads the EVENT (ConsolePanel discards sendCode's return),
	// and DSF answers a solicited reply in the POST body only — so the
	// connector must emit it on onReply itself. Exactly once: the mock must
	// NOT also queue it on the WS messages channel (that would double-log).
	const h = await startHarness();
	try {
		await h.connector.connect();
		h.replies.length = 0;
		const reply = await h.connector.sendCode("M115");
		assert.match(reply, /FIRMWARE/i);
		await sleep(150); // give any erroneous messages-channel push time to arrive
		assert.deepEqual(h.replies, [reply], "console saw the reply once, not zero or twice");
	} finally {
		await h.close();
	}
});

test("a throwing model consumer cannot freeze the transport (the ack still fires)", T, async () => {
	// The push stream is ack-gated: if an onModelKey emission throws and the
	// ack is skipped, the server never pushes again and PING/PONG masks it as
	// healthy — a green chip over a frozen model. The ack lives in a finally
	// precisely so one bad emission cannot stop the channel.
	const h = await startHarness();
	let throwOnce = true;
	try {
		await h.connector.connect();
		// Wire a consumer that throws on the very next state emission.
		const original = h.connector["events"].onModelKey!;
		h.connector["events"].onModelKey = (key, value) => {
			if (key === "state" && throwOnce) { throwOnce = false; throw new Error("boom in a consumer"); }
			original(key, value);
		};
		const before = h.keys.length;
		// Two rounds of change: the first emission throws; the transport must
		// still be taking pushes for the second to land.
		h.mock.machine.advance(1000);
		await sleep(100);
		h.mock.machine.advance(1000);
		await until(() => h.keys.length > before, "the channel kept turning past the throw");
		assert.equal(h.connector.status, "connected");
	} finally {
		await h.close();
	}
});

test("a socket that opens but never pushes trips the deadline into the ladder", T, async () => {
	// The liveness clock is armed at socket creation, not on the first frame:
	// a handshake that completes then goes silent used to hang connect() AND
	// stall the whole reconnect ladder (the awaited openSocket never settled).
	// Here the mock's WS is swapped for a bare server that upgrades and says
	// nothing; connect() must reject within the deadline, not hang.
	const silent = createSilentUpgradeServer();
	const port = await silent.listen();
	const clock = createVirtualClock();
	const requestTimeoutMs = 5000;
	const pingIntervalMs = 50;
	const deadlineMs = 2 * pingIntervalMs + 1000;
	try {
		const c = new DsfConnector({
			baseUrl: `http://127.0.0.1:${port}`,
			clock,
			pingIntervalMs,
			reconnectDelayMs: 25,
			requestTimeoutMs,
			events: {},
		});
		// Started, not awaited: the whole point is to move the clock while
		// connect() is in flight.
		const rejected = assert.rejects(c.connect(), (err: unknown) => err instanceof OperationFailedError,
			"connect() rejects on the silent socket instead of hanging");
		// Let the request actually GO OUT before moving time. The session is
		// taken through SessionSlot.acquire (session.ts), which releases the
		// previous key first, so the probe is issued a microtask after
		// connect() is called rather than inside its synchronous prologue —
		// and a budget registered mid-advance would be measured from the wrong
		// instant. The two assertions below are still exact; this only makes
		// "now" mean the same thing for both of them.
		await clock.settle();

		// This bare server answers nothing at all, so /machine/connect hangs
		// and only its own budget ends it. That budget used to be real: this
		// test cost 9 s, the single most expensive one in the battery.
		await clock.advance(requestTimeoutMs - 1);
		assert.equal(silent.upgrades(), 0, "still inside the session probe — no socket attempted yet");
		await clock.advance(1);

		// Sessionless fallback, then the socket. The handshake is real TCP, so
		// wait for it before claiming the socket then went silent.
		await until(() => silent.upgrades() === 1, "the bare server completed the handshake");
		const armedAt = clock.now();
		assert.equal(c.status, "connecting");

		// The deadline is armed at socket CREATION, not at the first frame —
		// that is the whole claim of this test, and it is now checked to the
		// tick rather than inferred from "it rejected eventually".
		await clock.advance(deadlineMs);
		assert.equal(c.status, "connecting", `torn down after only ${clock.now() - armedAt} ms of silence`);
		await clock.advance(pingIntervalMs);
		await rejected;
		await c.disconnect();
		assert.equal(clock.pendingScheduled(), 0, `a failed connect left a timer armed: ${clock.describePending()}`);
	} finally {
		await silent.close();
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

// ---- per-call deadlines (SendCodeOptions.timeoutMs) ----

/**
 * A DSF server that completes the WebSocket handshake, pushes one full frame
 * so the connector reaches "connected", and then HOLDS every POST
 * /machine/code until the test lets it go.
 *
 * The mock cannot express this. DSF answers /machine/code only once the code
 * has EXECUTED, so the fault being reproduced — a code that runs for longer
 * than the flat request budget — is a server that does not answer yet, and
 * mock-duet always answers at once. `/machine/connect` 404s here, which is the
 * connector's documented sessionless fallback.
 */
function createStallingCodeServer(): {
	listen(): Promise<number>;
	pending(): number;
	release(body: string): void;
	close(): Promise<void>;
} {
	const sockets: Duplex[] = [];
	let held: http.ServerResponse[] = [];
	const server = http.createServer((req, res) => {
		if (req.method === "POST" && (req.url ?? "").startsWith("/machine/code")) {
			req.resume();
			held.push(res);
			// The abort that a timed-out fetch causes must not leave a corpse
			// in `held` — the tests count pending requests to know the POST
			// actually reached the wire before they move the clock.
			res.on("close", () => { held = held.filter(r => r !== res); });
			return;
		}
		res.writeHead(404).end();
	});
	server.on("upgrade", (req, socket) => {
		sockets.push(socket);
		const accept = createHash("sha1")
			.update((req.headers["sec-websocket-key"] ?? "") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
			.digest("base64");
		socket.write(
			"HTTP/1.1 101 Switching Protocols\r\n" +
			"Upgrade: websocket\r\nConnection: Upgrade\r\n" +
			`Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
		);
		// One unmasked text frame carrying an empty full model: enough for
		// applyFull, the ack and "connected". Frames the client sends back
		// (the ack, a PING) are simply never read.
		const payload = Buffer.from("{}", "utf8");
		socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
	});
	return {
		listen: () => new Promise<number>(resolve => server.listen(0, () => {
			resolve((server.address() as { port: number }).port);
		})),
		pending: () => held.length,
		release(body: string) {
			for (const res of held) res.writeHead(200, { "Content-Type": "text/plain" }).end(body);
			held = [];
		},
		close: () => new Promise<void>(resolve => {
			for (const res of held) res.destroy();
			for (const s of sockets) s.destroy();
			server.closeAllConnections();
			server.close(() => resolve());
		}),
	};
}

test("DSF: sendCode's deadline replaces the flat budget for that call and nothing else", T, async () => {
	// The bug, on the transport where it showed. DSF's POST /machine/code does
	// not answer until the code has EXECUTED, so `G4 P3601` behind a 2.01 s
	// move is a 5.61 s request — and a flat 5 s budget aborted it on Gabe's
	// machine twice on 2026-08-23 while the board carried on and wrote the
	// capture. `pingIntervalMs` is enormous because the liveness clock and the
	// request budget share the virtual clock and only the budget is on trial.
	const stall = createStallingCodeServer();
	const port = await stall.listen();
	const clock = createVirtualClock();
	const requestTimeoutMs = 5000;
	const c = new DsfConnector({
		baseUrl: `http://127.0.0.1:${port}`,
		clock,
		requestTimeoutMs,
		pingIntervalMs: 600_000,
		reconnectDelayMs: 600_000,
		events: {},
	});
	try {
		await c.connect();
		assert.equal(c.status, "connected");

		// A: no deadline — today's behaviour, unchanged. The flat budget ends it.
		const plain = assert.rejects(
			c.sendCode("G4 P3601"),
			(err: unknown) => err instanceof OperationFailedError,
			"a code with no deadline is still aborted at the flat default",
		);
		await until(() => stall.pending() === 1, "the un-budgeted POST reached the server");
		await clock.advance(requestTimeoutMs);
		await plain;

		// B: the same stall, with a deadline. It must survive well past the
		// default and then resolve with the reply the board eventually sent.
		let settled = false;
		const budgeted = c.sendCode("G4 P3601", { timeoutMs: 20_000 })
			.then(v => { settled = true; return v; }, err => { settled = true; throw err; });
		await until(() => stall.pending() === 1, "the budgeted POST reached the server");
		await clock.advance(19_000);
		assert.equal(settled, false, "still in flight 19 s in — 4x the flat budget it was NOT given");
		stall.release("capture complete");
		assert.equal(await budgeted, "capture complete", "resolves with the reply, not a timeout");

		// C: the deadline was that call's alone — the next code is back on 5 s.
		const after = assert.rejects(
			c.sendCode("M400"),
			(err: unknown) => err instanceof OperationFailedError,
			"the widened budget did not leak into the following call",
		);
		await until(() => stall.pending() === 1, "the following POST reached the server");
		await clock.advance(requestTimeoutMs);
		await after;

		await c.disconnect();
	} finally {
		await stall.close();
	}
});
