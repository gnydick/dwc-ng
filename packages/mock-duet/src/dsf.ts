/**
 * DSF (SBC) surface for mock-duet — design D11: the /machine REST routes
 * plus the /machine WebSocket push loop, over the SAME Machine, VirtualSD
 * and SessionManager the rr_ dialect uses. Nothing here owns state the
 * rr_ side can't see; the dialects are two skins over one machine.
 *
 * Push-loop constructions (each is the ONE site for its rule):
 *  - serializeDsfModel is the sole full-frame/diff-input serializer: it
 *    strips `seqs` and pins `messages: []`, so neither can ever appear
 *    in a structural diff — messages travel ONLY via the pending queue.
 *  - pump() is the sole push-send site: it requires `armed` and consumes
 *    it on send, so one "OK\n" buys exactly one push, ever.
 *  - the pending-messages splice happens inside pump() at the only
 *    `payload.messages` write, so a reply appears in exactly one push.
 */
import type http from "node:http";
import { Buffer } from "node:buffer";
import { attachWebSocket, type WsConnection } from "./ws.ts";
import { computeDsfDiff } from "./dsfDiff.ts";
import type { Machine } from "./machine.ts";
import type { Om } from "./snapshot.ts";
import type { SessionManager } from "./sessions.ts";

export interface DsfEndpointOptions {
	machine: Machine;
	sessions: SessionManager;
	/** The mock's configured password; "" = sessionless access allowed. */
	password: string;
}

export interface DsfEndpoint {
	/** Handle a /machine/* HTTP request (endpoint = pathname sans leading "/"). */
	handleRest(req: http.IncomingMessage, res: http.ServerResponse, endpoint: string, url: URL): void;
	/** Queue a G-code reply as a DSF message on every open WS connection. */
	queueReply(text: string): void;
	/** Live WS connection count (tests). */
	readonly connections: number;
	/** Tear down the pump timer and every upgraded socket. */
	dispose(): void;
}

/** DSF Message object; type 0 = success, 1 = warning, 2 = error. */
interface DsfMessage {
	time: string;
	type: 0 | 1 | 2;
	content: string;
}

/** Armed = the client has acked and is owed the next change, at most once. */
interface PushConn {
	sock: WsConnection;
	/** The model exactly as last pushed — the diff baseline. */
	snapshot: Om;
	armed: boolean;
	pending: DsfMessage[];
}

/** How often armed connections re-check the machine for pushable changes. */
const PUMP_INTERVAL_MS = 25;

export function createDsfEndpoint(server: http.Server, opts: DsfEndpointOptions): DsfEndpoint {
	const { machine, sessions, password } = opts;
	const conns = new Set<PushConn>();

	/**
	 * The sole serializer for full frames AND diff inputs. DSF has no seqs
	 * (that is rr_ wire protocol, not model), and real DSF models carry a
	 * messages key — pinned [] here because our messages are a consumed
	 * channel (the pending queue), never model data.
	 */
	const serializeDsfModel = (): Om => {
		const model = structuredClone(machine.om);
		delete model.seqs; // a caller-supplied options.model could carry one
		model.messages = [];
		return model;
	};

	/**
	 * The ONE push site. Sends iff armed AND something is pushable (a
	 * structural diff and/or pending messages); disarms on send. Callers
	 * (ack, reply queue, interval) may invoke it freely — over-calling is
	 * harmless by construction.
	 */
	const pump = (conn: PushConn): void => {
		if (!conn.armed) return;
		const current = serializeDsfModel();
		const diff = computeDsfDiff(conn.snapshot, current);
		if (diff === null && conn.pending.length === 0) return;
		const payload: Record<string, unknown> = diff ?? {};
		if (conn.pending.length > 0) {
			// Consume semantics: the splice and the write are one step
			payload.messages = conn.pending;
			conn.pending = [];
		}
		conn.sock.send(JSON.stringify(payload));
		conn.snapshot = current;
		conn.armed = false;
	};

	// Mutations happen all over Machine (advance, execute, scenario events,
	// direct test pokes) — rather than trusting every site to notify, armed
	// connections poll. The diff-vs-snapshot check cannot miss a mutation
	// path by construction, whatever code mutates the om tomorrow.
	const pumpTimer = setInterval(() => {
		for (const conn of conns) pump(conn);
	}, PUMP_INTERVAL_MS);
	pumpTimer.unref();

	const endpoint = attachWebSocket(server, {
		path: "/machine",
		onConnection(sock, req) {
			const url = new URL(req.url ?? "/", "http://mock");
			const keyParam = url.searchParams.get("sessionKey") ?? "";
			const key = /^\d+$/.test(keyParam) ? parseInt(keyParam, 10) : null;
			// Pin whatever valid session arrived, even when auth is off — an
			// open WS must keep its session alive either way (design D11)
			const pinnedKey = key !== null && sessions.pin(key) ? key : null;
			if (password !== "" && pinnedKey === null) {
				sock.close(1008, "invalid session");
				return;
			}

			const conn: PushConn = { sock, snapshot: serializeDsfModel(), armed: false, pending: [] };
			conns.add(conn);
			sock.onClose(() => {
				conns.delete(conn);
				if (pinnedKey !== null) sessions.unpin(pinnedKey);
			});
			sock.onMessage(text => {
				const line = text.trim();
				if (line === "PING") {
					// Liveness probe: answered directly, arming untouched
					sock.send("PONG\n");
					return;
				}
				if (line === "OK") {
					conn.armed = true;
					pump(conn);
				}
			});
			// Full model first, always: armed starts false, so no diff can
			// precede this send, and the snapshot IS this frame
			sock.send(JSON.stringify(conn.snapshot));
		},
	});

	const queueReply = (text: string): void => {
		// Silent codes answer "" over REST; they are not console traffic
		if (text === "") return;
		// RRF's raw reply text carries the severity as a prefix; a DSF message
		// carries it as `type` and its content is the bare text — the prefix is
		// re-derived from the type when the line is displayed
		// (reference/objectmodel/src/messages/index.ts:16-18, and DWC's own
		// `Error: ${message.content}`). Consuming the prefix without stripping
		// it would double it in every consumer.
		const severity = /^Error:\s*/i.exec(text) ?? /^Warning:\s*/i.exec(text);
		const message: DsfMessage = {
			time: machine.om.state.time,
			type: severity === null ? 0 : severity[0].toLowerCase().startsWith("error") ? 2 : 1,
			content: severity === null ? text : text.slice(severity[0].length),
		};
		for (const conn of conns) {
			conn.pending.push(message);
			// Messages alone are a pushable diff — no model change needed
			pump(conn);
		}
	};

	// --- REST routes ---

	const handleRest = (
		req: http.IncomingMessage,
		res: http.ServerResponse,
		endpointPath: string,
		url: URL,
	): void => {
		const json = (body: unknown, status = 200): void => {
			const payload = JSON.stringify(body);
			res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
			res.end(payload);
		};
		const plain = (body: string, status = 200): void => {
			res.writeHead(status, { "Content-Type": "text/plain", "Content-Length": Buffer.byteLength(body) });
			res.end(body);
		};
		const empty = (status: number): void => {
			res.writeHead(status);
			res.end();
		};

		if (endpointPath === "machine/connect") {
			if (password !== "" && (url.searchParams.get("password") ?? "") !== password) {
				plain("Forbidden", 403);
				return;
			}
			const session = sessions.connect();
			if (session === null) {
				plain("No more sessions available", 503);
				return;
			}
			json({ sessionKey: session.key });
			return;
		}

		// Auth parity with the live board: with a password set every other
		// route needs a valid X-Session-Key; with "" keyless access succeeds
		const session = sessions.fromHeader(req.headers["x-session-key"]);
		if (password !== "" && session === null) {
			plain("Unauthorized", 401);
			return;
		}

		switch (endpointPath) {
			case "machine/disconnect": {
				if (session !== null) sessions.disconnect(session.key);
				empty(204);
				return;
			}
			case "machine/noop": {
				empty(204);
				return;
			}
			case "machine/model":
			case "machine/status": {
				json(serializeDsfModel());
				return;
			}
			case "machine/code": {
				if (req.method !== "POST") {
					plain("POST only", 404);
					return;
				}
				void readBody(req).then(body => {
					// The one execution authority — the same path rr_gcode takes
					plain(machine.execute(body.toString("utf8")));
				});
				return;
			}
			case "machine/file/move": {
				if (req.method === "POST") {
					void readBody(req).then(body => {
						const fields = parseForm(req.headers["content-type"], body);
						const from = fields.get("from") ?? "";
						const to = fields.get("to") ?? "";
						const force = ["true", "yes", "1"].includes((fields.get("force") ?? "").toLowerCase());
						switch (machine.sd.move(from, to, force)) {
							case "ok":
								machine.bumpVolume(0);
								empty(204);
								return;
							case "missing":
								plain("File not found", 404);
								return;
							case "exists":
								plain("Destination already exists", 500);
								return;
						}
					});
					return;
				}
				break; // a GET/PUT/DELETE of a file literally named "move" falls through
			}
		}

		// Path-carrying routes: decode the remainder, tolerating raw paths
		// the way the live board does (only malformed % stays raw)
		const filePath = pathAfter(endpointPath, "machine/file/");
		if (filePath !== null) {
			switch (req.method) {
				case "GET": {
					const data = machine.sd.read(filePath);
					if (data === null) {
						plain("File not found", 404);
						return;
					}
					res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": data.length });
					res.end(Buffer.from(data));
					return;
				}
				case "PUT": {
					void readBody(req).then(body => {
						if (machine.sd.write(filePath, new Uint8Array(body), machine.om.state.time)) {
							machine.bumpVolume(0);
							empty(201);
						} else {
							plain("Cannot write file", 500);
						}
					});
					return;
				}
				case "DELETE": {
					const recursive = ["true", "yes", "1"].includes((url.searchParams.get("recursive") ?? "").toLowerCase());
					switch (machine.sd.delete(filePath, recursive)) {
						case "ok":
							machine.bumpVolume(0);
							empty(204);
							return;
						case "missing":
							plain("File not found", 404);
							return;
						case "not-empty":
							plain("Directory not empty", 500);
							return;
					}
					return;
				}
			}
			plain("Unsupported method", 404);
			return;
		}

		const dirPath = pathAfter(endpointPath, "machine/directory/");
		if (dirPath !== null) {
			if (req.method === "GET") {
				const listing = machine.sd.list(dirPath);
				if (listing === "unmounted" || listing === "missing") {
					plain("Directory not found", 404);
					return;
				}
				json(listing);
				return;
			}
			if (req.method === "PUT") {
				if (machine.sd.mkdir(dirPath, machine.om.state.time)) {
					machine.bumpVolume(0);
					empty(201);
				} else {
					plain("Cannot create directory", 500);
				}
				return;
			}
			plain("Unsupported method", 404);
			return;
		}

		const infoPath = pathAfter(endpointPath, "machine/fileinfo/");
		if (infoPath !== null) {
			const info = machine.sd.fileInfo.get(infoPath);
			if (info === undefined) {
				plain("File not found", 404);
				return;
			}
			// Thumbnail bytes come from the SAME source rr_thumbnail serves;
			// data rides along only when explicitly requested (DSF contract)
			const withContent = url.searchParams.get("readThumbnailContent") === "true";
			const data = machine.sd.thumbnails.get(infoPath) ?? null;
			json({
				...info,
				thumbnails: info.thumbnails.map(t => ({ ...t, data: withContent ? data : null })),
			});
			return;
		}

		plain("Unknown /machine route", 404);
	};

	return {
		handleRest,
		queueReply,
		get connections() {
			return conns.size;
		},
		dispose() {
			clearInterval(pumpTimer);
			endpoint.destroyAll();
		},
	};
}

/**
 * The remainder of `endpoint` after `prefix`, percent-decoded; null when
 * the prefix doesn't match. Raw (undecodable) paths pass through as-is,
 * mirroring the live board's tolerance.
 */
function pathAfter(endpoint: string, prefix: string): string | null {
	if (!endpoint.startsWith(prefix)) return null;
	const raw = endpoint.slice(prefix.length);
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
	return new Promise(resolve => {
		const chunks: Buffer[] = [];
		req.on("data", chunk => chunks.push(chunk));
		req.on("end", () => resolve(Buffer.concat(chunks)));
	});
}

/**
 * Tolerant form parser for /machine/file/move: real DSF clients send
 * multipart FormData, curl-style callers urlencoded — accept both.
 */
function parseForm(contentType: string | undefined, body: Buffer): Map<string, string> {
	const out = new Map<string, string>();
	const boundary = /multipart\/form-data/i.test(contentType ?? "")
		? /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? "")
		: null;
	if (boundary !== null) {
		const marker = `--${(boundary[1] ?? boundary[2] ?? "").trim()}`;
		for (const part of body.toString("utf8").split(marker)) {
			const headerEnd = part.indexOf("\r\n\r\n");
			if (headerEnd === -1) continue;
			const name = /name="([^"]*)"/i.exec(part.slice(0, headerEnd))?.[1];
			if (name === undefined) continue;
			let value = part.slice(headerEnd + 4);
			if (value.endsWith("\r\n")) value = value.slice(0, -2);
			out.set(name, value);
		}
		return out;
	}
	for (const [name, value] of new URLSearchParams(body.toString("utf8"))) {
		out.set(name, value);
	}
	return out;
}
