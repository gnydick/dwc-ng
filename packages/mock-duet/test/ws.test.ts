import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { Buffer } from "node:buffer";
import { attachWebSocket, type WsConnection, type WsEndpoint } from "../src/ws.ts";

// RFC 6455 §1.3 known answer — pins the accept computation forever
const SAMPLE_KEY = "dGhlIHNhbXBsZSBub25jZQ==";
const SAMPLE_ACCEPT = "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=";

const T = { timeout: 10_000 };

function within<T>(promise: Promise<T>, label: string, ms = 2000): Promise<T> {
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

// --- server harness ---

interface ServerConn {
	sock: WsConnection;
	nextMessage(): Promise<string>;
	messageCount(): number;
	closed: Promise<{ code: number; reason: string }>;
}

interface Harness {
	url: string;
	port: number;
	server: http.Server;
	endpoint: WsEndpoint;
	nextConn(): Promise<ServerConn>;
	close(): Promise<void>;
}

async function startHarness(): Promise<Harness> {
	const server = http.createServer((_req, res) => {
		res.writeHead(404);
		res.end();
	});
	const pending: ServerConn[] = [];
	const connWaiters: Array<(conn: ServerConn) => void> = [];
	const endpoint = attachWebSocket(server, {
		path: "/machine",
		onConnection(sock) {
			const queued: string[] = [];
			const messageWaiters: Array<(text: string) => void> = [];
			let received = 0;
			// ONE persistent handler: per-await once() listeners lose coalesced frames
			sock.onMessage(text => {
				received++;
				const waiter = messageWaiters.shift();
				if (waiter !== undefined) waiter(text);
				else queued.push(text);
			});
			let resolveClosed!: (value: { code: number; reason: string }) => void;
			const closed = new Promise<{ code: number; reason: string }>(resolve => {
				resolveClosed = resolve;
			});
			sock.onClose((code, reason) => resolveClosed({ code, reason }));
			const conn: ServerConn = {
				sock,
				closed,
				messageCount: () => received,
				nextMessage() {
					const text = queued.shift();
					if (text !== undefined) return Promise.resolve(text);
					return within(new Promise<string>(resolve => messageWaiters.push(resolve)), "server message");
				},
			};
			const waiter = connWaiters.shift();
			if (waiter !== undefined) waiter(conn);
			else pending.push(conn);
		},
	});
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as net.AddressInfo).port;
	return {
		url: `ws://127.0.0.1:${port}/machine`,
		port,
		server,
		endpoint,
		nextConn() {
			const conn = pending.shift();
			if (conn !== undefined) return Promise.resolve(conn);
			return within(new Promise<ServerConn>(resolve => connWaiters.push(resolve)), "server connection");
		},
		close() {
			endpoint.destroyAll();
			// Ignore "not running" on double-close: harness close is idempotent
			return new Promise<void>(resolve => server.close(() => resolve()));
		},
	};
}

// --- global-WebSocket client helpers ---

function wsOpen(url: string, protocols?: string | string[]): Promise<WebSocket> {
	return within(
		new Promise<WebSocket>((resolve, reject) => {
			const ws = new WebSocket(url, protocols);
			ws.addEventListener("open", () => resolve(ws), { once: true });
			ws.addEventListener("error", () => reject(new Error("WebSocket failed to open")), { once: true });
		}),
		"client open",
	);
}

function wsClosed(ws: WebSocket): Promise<{ code: number; reason: string; wasClean: boolean }> {
	return within(
		new Promise(resolve => {
			ws.addEventListener("close", event => resolve(event as CloseEvent), { once: true });
		}),
		"client close event",
	);
}

/** ONE persistent listener with an internal queue — coalesced frames survive. */
function wsInbox(ws: WebSocket): { next(): Promise<string> } {
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
			return within(new Promise<string>(resolve => waiters.push(resolve)), "client message");
		},
	};
}

// --- raw-socket client (hand-crafted handshake and frames) ---

interface RawClient {
	socket: net.Socket;
	/** Response status line + headers. */
	head: string;
	ended: Promise<void>;
	write(data: Buffer): void;
	/** Await at least `count` complete server frames (server frames are unmasked). */
	frames(count: number): Promise<Array<{ opcode: number; payload: Buffer }>>;
}

function rawConnect(
	port: number,
	options: { path?: string; key?: string; version?: string; tail?: Buffer } = {},
): Promise<RawClient> {
	return within(
		new Promise<RawClient>(resolve => {
			const socket = net.connect(port, "127.0.0.1");
			socket.setNoDelay(true);
			let all = Buffer.alloc(0);
			let frameBytes = Buffer.alloc(0);
			let headText: string | null = null;
			const checkers: Array<() => void> = [];
			let resolveEnded!: () => void;
			const ended = new Promise<void>(r => {
				resolveEnded = r;
			});
			socket.on("error", () => {});
			socket.on("close", () => {
				resolveEnded();
				for (const check of [...checkers]) check();
			});
			const client: RawClient = {
				socket,
				get head() {
					return headText ?? "";
				},
				ended: within(ended, "raw socket end"),
				write(data) {
					socket.write(data);
				},
				frames(count) {
					return within(
						new Promise(res => {
							const check = (): void => {
								const parsed = parseServerFrames(frameBytes);
								if (parsed.length >= count) res(parsed);
							};
							checkers.push(check);
							check();
						}),
						`${count} server frame(s)`,
					);
				},
			};
			socket.on("data", chunk => {
				if (headText === null) {
					all = Buffer.concat([all, chunk]);
					const idx = all.indexOf("\r\n\r\n");
					if (idx === -1) return;
					headText = all.subarray(0, idx).toString("latin1");
					frameBytes = Buffer.from(all.subarray(idx + 4));
					resolve(client);
				} else {
					frameBytes = Buffer.concat([frameBytes, chunk]);
				}
				for (const check of [...checkers]) check();
			});
			socket.on("connect", () => {
				const request =
					`GET ${options.path ?? "/machine"} HTTP/1.1\r\n` +
					`Host: 127.0.0.1:${port}\r\n` +
					"Upgrade: websocket\r\n" +
					"Connection: Upgrade\r\n" +
					`Sec-WebSocket-Key: ${options.key ?? SAMPLE_KEY}\r\n` +
					`Sec-WebSocket-Version: ${options.version ?? "13"}\r\n` +
					"\r\n";
				const bytes = Buffer.from(request, "latin1");
				socket.write(options.tail !== undefined ? Buffer.concat([bytes, options.tail]) : bytes);
			});
		}),
		"raw handshake response",
	);
}

/** Client→server frame builder; masked unless the test needs the violation. */
function clientFrame(opcode: number, payload: Buffer, masked = true): Buffer {
	const maskBit = masked ? 0x80 : 0x00;
	const len = payload.length;
	let head: Buffer;
	if (len < 126) {
		head = Buffer.from([0x80 | opcode, maskBit | len]);
	} else if (len < 0x10000) {
		head = Buffer.alloc(4);
		head[0] = 0x80 | opcode;
		head[1] = maskBit | 126;
		head.writeUInt16BE(len, 2);
	} else {
		head = Buffer.alloc(10);
		head[0] = 0x80 | opcode;
		head[1] = maskBit | 127;
		head.writeBigUInt64BE(BigInt(len), 2);
	}
	if (!masked) return Buffer.concat([head, payload]);
	const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
	const body = Buffer.from(payload);
	for (let i = 0; i < body.length; i++) body[i] = body[i]! ^ mask[i & 3]!;
	return Buffer.concat([head, mask, body]);
}

/** Test-side reader of unmasked server frames (never a second production codec). */
function parseServerFrames(buf: Buffer): Array<{ opcode: number; payload: Buffer }> {
	const frames: Array<{ opcode: number; payload: Buffer }> = [];
	let offset = 0;
	while (offset + 2 <= buf.length) {
		const opcode = buf[offset]! & 0x0f;
		let len = buf[offset + 1]! & 0x7f;
		let headEnd = offset + 2;
		if (len === 126) {
			if (offset + 4 > buf.length) break;
			len = buf.readUInt16BE(offset + 2);
			headEnd = offset + 4;
		} else if (len === 127) {
			if (offset + 10 > buf.length) break;
			len = Number(buf.readBigUInt64BE(offset + 2));
			headEnd = offset + 10;
		}
		if (headEnd + len > buf.length) break;
		frames.push({ opcode, payload: Buffer.from(buf.subarray(headEnd, headEnd + len)) });
		offset = headEnd + len;
	}
	return frames;
}

function closeCodeOf(frame: { opcode: number; payload: Buffer }): number {
	assert.equal(frame.opcode, 0x8, "expected a close frame");
	return frame.payload.readUInt16BE(0);
}

// --- tests ---

test("handshake pins the RFC 6455 §1.3 known answer", T, async t => {
	const h = await startHarness();
	t.after(() => h.close());
	const raw = await rawConnect(h.port);
	assert.ok(raw.head.startsWith("HTTP/1.1 101 Switching Protocols"), raw.head);
	assert.ok(raw.head.includes(`Sec-WebSocket-Accept: ${SAMPLE_ACCEPT}`), raw.head);
	assert.ok(raw.head.includes("Upgrade: websocket"), raw.head);
	assert.ok(raw.head.includes("Connection: Upgrade"), raw.head);
	assert.ok(!/sec-websocket-extensions/i.test(raw.head), "extensions must never be echoed");
	raw.socket.destroy();
});

test("non-matching upgrade path is refused politely", T, async t => {
	const h = await startHarness();
	t.after(() => h.close());
	const raw = await rawConnect(h.port, { path: "/elsewhere" });
	assert.ok(raw.head.startsWith("HTTP/1.1 404"), raw.head);
	await raw.ended;
	assert.equal(h.endpoint.size, 0);
});

test("handshake without version 13 is refused", T, async t => {
	const h = await startHarness();
	t.after(() => h.close());
	const raw = await rawConnect(h.port, { version: "8" });
	assert.ok(raw.head.startsWith("HTTP/1.1 400"), raw.head);
	await raw.ended;
});

test("exactly one offered subprotocol is echoed", T, async t => {
	const h = await startHarness();
	t.after(() => h.close());
	// undici ABORTS the handshake unless the server picks one offered value
	const ws = await wsOpen(h.url, ["v1.duet", "v2.duet"]);
	assert.equal(ws.protocol, "v1.duet");
	ws.close();
	await wsClosed(ws);
});

test("text frames round-trip both directions", T, async t => {
	const h = await startHarness();
	t.after(() => h.close());
	const ws = await wsOpen(h.url);
	const inbox = wsInbox(ws);
	const conn = await h.nextConn();
	ws.send("to-server");
	assert.equal(await conn.nextMessage(), "to-server");
	conn.sock.send("to-client");
	assert.equal(await inbox.next(), "to-client");
	ws.close();
	await wsClosed(ws);
});

test("two frames coalesced in one TCP write are both delivered", T, async t => {
	const h = await startHarness();
	t.after(() => h.close());
	const raw = await rawConnect(h.port);
	const conn = await h.nextConn();
	raw.write(Buffer.concat([clientFrame(0x1, Buffer.from("one")), clientFrame(0x1, Buffer.from("two"))]));
	assert.equal(await conn.nextMessage(), "one");
	assert.equal(await conn.nextMessage(), "two");
	raw.socket.destroy();
});

test("a frame dribbled byte-by-byte is delivered", T, async t => {
	const h = await startHarness();
	t.after(() => h.close());
	const raw = await rawConnect(h.port);
	const conn = await h.nextConn();
	const frame = clientFrame(0x1, Buffer.from("dribble"));
	for (const byte of frame) {
		raw.write(Buffer.from([byte]));
		await new Promise(resolve => setTimeout(resolve, 2));
	}
	assert.equal(await conn.nextMessage(), "dribble");
	raw.socket.destroy();
});

test("16-bit length path round-trips", T, async t => {
	const h = await startHarness();
	t.after(() => h.close());
	const ws = await wsOpen(h.url);
	const inbox = wsInbox(ws);
	const conn = await h.nextConn();
	const payload = "x".repeat(300);
	ws.send(payload);
	const got = await conn.nextMessage();
	assert.equal(got.length, 300);
	assert.equal(got, payload);
	conn.sock.send(got);
	assert.equal(await inbox.next(), payload);
	ws.close();
	await wsClosed(ws);
});

test("64-bit length path round-trips (>64 KiB)", T, async t => {
	const h = await startHarness();
	t.after(() => h.close());
	const ws = await wsOpen(h.url);
	const inbox = wsInbox(ws);
	const conn = await h.nextConn();
	const payload = "y".repeat(70_000);
	ws.send(payload);
	const got = await conn.nextMessage();
	assert.equal(got.length, 70_000);
	assert.equal(got, payload);
	conn.sock.send(got);
	assert.equal(await inbox.next(), payload);
	ws.close();
	await wsClosed(ws);
});

test("clean close: client code/reason round-trip", T, async t => {
	const h = await startHarness();
	t.after(() => h.close());
	const ws = await wsOpen(h.url);
	const conn = await h.nextConn();
	// Client API only permits 1000 or 3000-4999
	ws.close(4321, "x");
	const serverSide = await within(conn.closed, "server close callback");
	assert.deepEqual(serverSide, { code: 4321, reason: "x" });
	const clientSide = await wsClosed(ws);
	assert.equal(clientSide.code, 4321);
	assert.equal(clientSide.reason, "x");
	assert.equal(clientSide.wasClean, true);
});

test("server-initiated close reaches the client cleanly", T, async t => {
	const h = await startHarness();
	t.after(() => h.close());
	const ws = await wsOpen(h.url);
	const conn = await h.nextConn();
	conn.sock.close(4001, "bye");
	const clientSide = await wsClosed(ws);
	assert.equal(clientSide.code, 4001);
	assert.equal(clientSide.reason, "bye");
	assert.deepEqual(await within(conn.closed, "server close callback"), { code: 4001, reason: "bye" });
});

test("ping is auto-ponged with the identical payload, invisible to onMessage", T, async t => {
	const h = await startHarness();
	t.after(() => h.close());
	const raw = await rawConnect(h.port);
	const conn = await h.nextConn();
	raw.write(clientFrame(0x9, Buffer.from("p1")));
	const [pong] = await raw.frames(1);
	assert.equal(pong!.opcode, 0xa);
	assert.equal(pong!.payload.toString(), "p1");
	// The ping must not have surfaced as a message
	raw.write(clientFrame(0x1, Buffer.from("after")));
	assert.equal(await conn.nextMessage(), "after");
	assert.equal(conn.messageCount(), 1);
	raw.socket.destroy();
});

test("unmasked client frame dies with close 1002", T, async t => {
	const h = await startHarness();
	t.after(() => h.close());
	const raw = await rawConnect(h.port);
	const conn = await h.nextConn();
	raw.write(clientFrame(0x1, Buffer.from("nope"), false));
	const [close] = await raw.frames(1);
	assert.equal(closeCodeOf(close!), 1002);
	assert.deepEqual((await within(conn.closed, "server close callback")).code, 1002);
	await raw.ended;
});

test("oversized frame announcement dies with 1009 on the header alone", T, async t => {
	const h = await startHarness();
	t.after(() => h.close());
	const raw = await rawConnect(h.port);
	const conn = await h.nextConn();
	// 32 MiB announced via 64-bit length; no payload is ever sent
	const head = Buffer.alloc(10);
	head[0] = 0x81;
	head[1] = 0x80 | 127;
	head.writeBigUInt64BE(BigInt(32 * 1024 * 1024), 2);
	raw.write(head);
	const [close] = await raw.frames(1);
	assert.equal(closeCodeOf(close!), 1009);
	assert.equal((await within(conn.closed, "server close callback")).code, 1009);
	await raw.ended;
});

test("binary frame dies with close 1003", T, async t => {
	const h = await startHarness();
	t.after(() => h.close());
	const ws = await wsOpen(h.url);
	const conn = await h.nextConn();
	ws.send(new Uint8Array([1, 2, 3]));
	const clientSide = await wsClosed(ws);
	assert.equal(clientSide.code, 1003);
	assert.equal((await within(conn.closed, "server close callback")).code, 1003);
});

test("frames arriving in the upgrade's head Buffer are delivered", T, async t => {
	const h = await startHarness();
	t.after(() => h.close());
	// Handshake and a frame in ONE write: the frame may land in `head`
	const raw = await rawConnect(h.port, { tail: clientFrame(0x1, Buffer.from("early")) });
	const conn = await h.nextConn();
	assert.equal(await conn.nextMessage(), "early");
	raw.socket.destroy();
});

test("destroyAll reaps upgraded sockets so server close() can finish", T, async t => {
	const h = await startHarness();
	t.after(() => h.close());
	const ws = await wsOpen(h.url);
	await h.nextConn();
	assert.equal(h.endpoint.size, 1);
	h.endpoint.destroyAll();
	assert.equal(h.endpoint.size, 0);
	const clientSide = await wsClosed(ws);
	assert.equal(clientSide.code, 1006);
	assert.equal(clientSide.wasClean, false);
	// Without destroyAll this close() would hang: http does not reap upgrades
	await within(
		new Promise<void>(resolve => h.server.close(() => resolve())),
		"server.close after destroyAll",
	);
});
