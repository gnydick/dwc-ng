/**
 * Zero-dependency RFC 6455 WebSocket layer for the DSF endpoint (design D11).
 *
 * @invariant sole-frame-parser
 * @rung 7  choke-point behind a sole constructor — this is the ONLY byte-level
 *          WS code here, and a connection exists solely through
 *          attachWebSocket's handshake; no other constructor is exported. The
 *          parser's outcomes are a closed sum of frame / need-more / fail, so
 *          "malformed input hangs the connection" has no encoding
 * @why a second hand-rolled framer is how a mock stops being a faithful stand-in
 *      for the board: the connector under test would be exercised against two
 *      slightly different dialects and pass both. Strict on purpose —
 *      fragmentation, RSV bits, unmasked client frames, binary and oversized
 *      frames each die with a NAMED close code, so a connector bug surfaces as
 *      a diagnosis rather than a hang
 */
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import type http from "node:http";
import type { Duplex } from "node:stream";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/** Frames announcing more than this are refused (1009) on the header alone. */
const MAX_PAYLOAD = 16 * 1024 * 1024;

const OP_CONT = 0x0;
const OP_TEXT = 0x1;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

export interface WsConnection {
	/** No-op once closing/closed — teardown races must not throw. */
	send(text: string): void;
	close(code?: number, reason?: string): void;
	onMessage(cb: (text: string) => void): void;
	/** Fires exactly once, whatever ends the connection (close frame, error, destroy). */
	onClose(cb: (code: number, reason: string) => void): void;
}

export interface WsEndpoint {
	/** Live upgraded sockets. */
	readonly size: number;
	/**
	 * Destroy every upgraded socket. http close()/closeAllConnections()
	 * do NOT reap upgraded sockets — the mock's close() must call this.
	 */
	destroyAll(): void;
}

export interface AttachOptions {
	/** Exact pathname to serve; any other upgrade path gets a polite 404. */
	path: string;
	onConnection(sock: WsConnection, req: http.IncomingMessage): void;
}

/**
 * Hook the server's 'upgrade' event. One endpoint per server: this
 * handler owns ALL upgrades (non-matching paths are refused), so a
 * pre-existing upgrade listener is a construction error, not a merge.
 */
export function attachWebSocket(server: http.Server, opts: AttachOptions): WsEndpoint {
	if (server.listenerCount("upgrade") > 0) {
		throw new Error("attachWebSocket: server already has an 'upgrade' handler (one endpoint per server)");
	}
	const live = new Set<Duplex>();

	server.on("upgrade", (req, socket, head) => {
		// Refused or reset sockets must never crash the mock
		socket.on("error", () => {});

		if ((req.url ?? "").split("?", 1)[0] !== opts.path) {
			refuse(socket, "404 Not Found");
			return;
		}
		const key = header(req, "sec-websocket-key");
		const upgrade = header(req, "upgrade");
		if (
			req.method !== "GET" ||
			upgrade === undefined ||
			!upgrade.split(",").some(token => token.trim().toLowerCase() === "websocket") ||
			key === undefined ||
			header(req, "sec-websocket-version") !== "13"
		) {
			refuse(socket, "400 Bad Request");
			return;
		}

		const lines = [
			"HTTP/1.1 101 Switching Protocols",
			"Upgrade: websocket",
			"Connection: Upgrade",
			`Sec-WebSocket-Accept: ${createHash("sha1").update(key + WS_GUID).digest("base64")}`,
		];
		// Echo exactly ONE offered subprotocol — undici aborts the handshake
		// on zero. NEVER echo Sec-WebSocket-Extensions: undici offers
		// permessage-deflate, and agreeing to it would corrupt our framing.
		const offered = header(req, "sec-websocket-protocol")?.split(",")[0]?.trim();
		if (offered !== undefined && offered !== "") {
			lines.push(`Sec-WebSocket-Protocol: ${offered}`);
		}
		socket.write(lines.join("\r\n") + "\r\n\r\n");

		const raw = socket as Partial<import("node:net").Socket>;
		raw.setTimeout?.(0);
		raw.setNoDelay?.(true);

		live.add(socket);
		socket.on("close", () => live.delete(socket));

		const conn = createConnection(socket);
		opts.onConnection(conn.handle, req);
		// The upgrade's head Buffer may already hold frames — parse it
		// first, after the caller has had its chance to register handlers
		if (head.length > 0) conn.feed(head);
	});

	return {
		get size() {
			return live.size;
		},
		destroyAll() {
			for (const socket of live) socket.destroy();
			live.clear();
		},
	};
}

function header(req: http.IncomingMessage, name: string): string | undefined {
	const value = req.headers[name];
	return Array.isArray(value) ? value[0] : value;
}

function refuse(socket: Duplex, status: string): void {
	socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
}

// --- the one frame codec (C13) ---

type Parsed =
	| { kind: "need" }
	| { kind: "fail"; code: number; reason: string }
	| { kind: "frame"; fin: boolean; opcode: number; payload: Buffer; consumed: number };

const NEED: Parsed = { kind: "need" };

/**
 * Incremental client-frame parser: yields one complete frame (payload
 * unmasked into a copy) or asks for more bytes at EVERY boundary (2-byte
 * header, extended length, mask key, payload) or fails with the close
 * code the connection must die with. No other outcome exists.
 */
function parseFrame(buf: Buffer): Parsed {
	if (buf.length < 2) return NEED;
	const b0 = buf[0]!;
	const b1 = buf[1]!;
	if ((b0 & 0x70) !== 0) return { kind: "fail", code: 1002, reason: "RSV bits set" };
	if ((b1 & 0x80) === 0) return { kind: "fail", code: 1002, reason: "client frame not masked" };
	const len7 = b1 & 0x7f;
	let length: number;
	let offset: number;
	if (len7 === 126) {
		if (buf.length < 4) return NEED;
		length = buf.readUInt16BE(2);
		offset = 4;
	} else if (len7 === 127) {
		if (buf.length < 10) return NEED;
		const wide = buf.readBigUInt64BE(2);
		if (wide > BigInt(Number.MAX_SAFE_INTEGER)) {
			return { kind: "fail", code: 1009, reason: "64-bit length beyond MAX_SAFE_INTEGER" };
		}
		length = Number(wide);
		offset = 10;
	} else {
		length = len7;
		offset = 2;
	}
	// Refuse oversized announcements before buffering a single payload byte
	if (length > MAX_PAYLOAD) return { kind: "fail", code: 1009, reason: "frame exceeds 16 MiB cap" };
	if (buf.length < offset + 4) return NEED;
	const mask = buf.subarray(offset, offset + 4);
	offset += 4;
	if (buf.length < offset + length) return NEED;
	// Copy before unmasking — the accumulator is never mutated
	const payload = Buffer.from(buf.subarray(offset, offset + length));
	for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ mask[i & 3]!;
	return { kind: "frame", fin: (b0 & 0x80) !== 0, opcode: b0 & 0x0f, payload, consumed: offset + length };
}

/** Server→client frames: FIN always set; masking is inexpressible here. */
function encodeFrame(opcode: number, payload: Buffer): Buffer {
	const len = payload.length;
	let head: Buffer;
	if (len < 126) {
		head = Buffer.from([0x80 | opcode, len]);
	} else if (len < 0x10000) {
		head = Buffer.alloc(4);
		head[0] = 0x80 | opcode;
		head[1] = 126;
		head.writeUInt16BE(len, 2);
	} else {
		head = Buffer.alloc(10);
		head[0] = 0x80 | opcode;
		head[1] = 127;
		head.writeBigUInt64BE(BigInt(len), 2);
	}
	return Buffer.concat([head, payload]);
}

function encodeClosePayload(code: number, reason: string): Buffer {
	// 1005/1006/1015 exist only in close events, never on the wire (§7.4.1)
	if (code === 1005 || code === 1006 || code === 1015) return Buffer.alloc(0);
	// Control payloads cap at 125 bytes: 2 for the code leaves 123 of reason
	const text = Buffer.from(reason, "utf8").subarray(0, 123);
	const payload = Buffer.alloc(2 + text.length);
	payload.writeUInt16BE(code, 0);
	text.copy(payload, 2);
	return payload;
}

interface Conn {
	handle: WsConnection;
	feed(chunk: Buffer): void;
}

function createConnection(socket: Duplex): Conn {
	let state: "open" | "closing" | "closed" = "open";
	let buf: Buffer = Buffer.alloc(0);
	let closeFired = false;
	const messageCbs: Array<(text: string) => void> = [];
	const closeCbs: Array<(code: number, reason: string) => void> = [];

	const fireClose = (code: number, reason: string): void => {
		if (closeFired) return;
		closeFired = true;
		for (const cb of closeCbs) cb(code, reason);
	};

	// The sole route out of "open": every ending (server close, protocol
	// failure, close echo) sends exactly one close frame then FIN.
	const shutdown = (payload: Buffer, code: number, reason: string): void => {
		if (state !== "open") return;
		state = "closing";
		socket.write(encodeFrame(OP_CLOSE, payload));
		socket.end();
		fireClose(code, reason);
	};

	const failClose = (code: number, reason: string): void => {
		shutdown(encodeClosePayload(code, reason), code, reason);
	};

	const handleFrame = (fin: boolean, opcode: number, payload: Buffer): void => {
		if (opcode >= OP_CLOSE) {
			// Control frames: never fragmented, payload ≤ 125 (§5.5)
			if (!fin || payload.length > 125) {
				failClose(1002, "malformed control frame");
				return;
			}
			switch (opcode) {
				case OP_CLOSE: {
					if (payload.length === 1) {
						failClose(1002, "close frame with 1-byte payload");
						return;
					}
					const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
					const reason = payload.length > 2 ? payload.subarray(2).toString("utf8") : "";
					// Echo the client's payload verbatim, then FIN: clean close
					shutdown(payload, code, reason);
					return;
				}
				case OP_PING:
					// Auto-pong with the identical payload; invisible to onMessage
					socket.write(encodeFrame(OP_PONG, payload));
					return;
				case OP_PONG:
					return;
				default:
					failClose(1002, `unknown control opcode 0x${opcode.toString(16)}`);
					return;
			}
		}
		switch (opcode) {
			case OP_TEXT: {
				if (!fin) {
					failClose(1002, "fragmented frames not supported");
					return;
				}
				const text = payload.toString("utf8");
				for (const cb of messageCbs) cb(text);
				return;
			}
			case OP_CONT:
				failClose(1002, "continuation frames not supported");
				return;
			case OP_BINARY:
				failClose(1003, "binary frames not supported");
				return;
			default:
				failClose(1002, `unknown opcode 0x${opcode.toString(16)}`);
				return;
		}
	};

	const feed = (chunk: Buffer): void => {
		if (state !== "open") return;
		buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
		// One TCP segment may carry many frames — loop until need-more
		while (state === "open") {
			const parsed = parseFrame(buf);
			if (parsed.kind === "need") return;
			if (parsed.kind === "fail") {
				failClose(parsed.code, parsed.reason);
				return;
			}
			buf = buf.subarray(parsed.consumed);
			handleFrame(parsed.fin, parsed.opcode, parsed.payload);
		}
	};

	socket.on("data", feed);
	socket.on("close", () => {
		state = "closed";
		// Reached first only when no close frame was exchanged
		fireClose(1006, "abnormal closure");
	});

	return {
		feed,
		handle: {
			send(text) {
				if (state !== "open") return;
				socket.write(encodeFrame(OP_TEXT, Buffer.from(text, "utf8")));
			},
			close(code = 1000, reason = "") {
				failClose(code, reason);
			},
			onMessage(cb) {
				messageCbs.push(cb);
			},
			onClose(cb) {
				closeCbs.push(cb);
			},
		},
	};
}
