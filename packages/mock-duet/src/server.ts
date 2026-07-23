import http from "node:http";
import { Buffer } from "node:buffer";
import { Machine } from "./machine.ts";
import type { Om } from "./snapshot.ts";
import { SessionManager } from "./sessions.ts";
import { buildModelResponse } from "./model-query.ts";
import { crc32 } from "./crc32.ts";
import { createDsfEndpoint, type DsfEndpoint } from "./dsf.ts";
import { scenarios, type Scenario } from "./scenarios/index.ts";

export interface MockServerOptions {
	scenario?: Scenario | string;
	/** Expected password; "" (default) accepts anything, like an unset M551. */
	password?: string;
	maxSessions?: number;
	/** Session idle timeout in ms (reported by rr_connect). */
	sessionTimeout?: number;
	/** Unread G-code replies are dropped after this many ms (RRF: ~1 s). */
	replyExpiryMs?: number;
	/** Max array elements per rr_model chunk / files per rr_filelist page. */
	chunkSize?: number;
	/** Every Nth rr_model/rr_filelist/rr_files request gets a 503 (0 = off). */
	busyEvery?: number;
	/** Reject requests lacking a valid X-Session-Key with 401 (default true). */
	requireAuth?: boolean;
	/** Simulation tick in ms; 0 disables the timer (drive machine.advance yourself). */
	tickMs?: number;
	/** Base object model to serve instead of the synthetic one (see capture.ts). */
	model?: Om;
	/**
	 * Pretend to be DSF's rr_ emulation (SBC mode): rr_connect reports
	 * isEmulated, and GET /machine/model serves the full model the way DSF
	 * does — the endpoint the connector's layer-history enrichment reads.
	 */
	emulated?: boolean;
	/**
	 * Serve the full DSF surface (design D11): /machine/* REST routes and
	 * the /machine WebSocket push loop, alongside the rr_ dialect.
	 */
	dsf?: boolean;
}

export interface MockServer {
	server: http.Server;
	machine: Machine;
	sessions: SessionManager;
	listen(port?: number, host?: string): Promise<number>;
	close(): Promise<void>;
}

export function createMockServer(options: MockServerOptions = {}): MockServer {
	const scenario = typeof options.scenario === "string"
		? scenarios[options.scenario]
		: options.scenario ?? scenarios["idle"];
	if (scenario === undefined) {
		throw new Error(`Unknown scenario "${options.scenario}" (available: ${Object.keys(scenarios).join(", ")})`);
	}

	const password = options.password ?? "";
	const chunkSize = options.chunkSize ?? 8;
	const busyEvery = options.busyEvery ?? 0;
	const requireAuth = options.requireAuth ?? true;
	const tickMs = options.tickMs ?? 250;
	const emulated = options.emulated ?? false;

	const machine = new Machine(scenario, options.model);
	const sessions = new SessionManager({
		maxSessions: options.maxSessions ?? 4,
		sessionTimeout: options.sessionTimeout ?? 8000,
		replyExpiryMs: options.replyExpiryMs ?? 3000,
	});

	machine.onReply = (text, solicited) => {
		// rr_ clients have no return channel — every reply goes to the drain.
		sessions.pushReply(text);
		// DSF's messages channel carries UNSOLICITED replies only; a solicited
		// one already went back in the POST /machine/code body, so queuing it
		// here too would double-log it in every DSF console.
		if (!solicited) dsf?.queueReply(text);
	};
	machine.onReset = () => sessions.clear();
	machine.onOutage = () => sessions.clear();

	let busyCounter = 0;
	let lastUploadErr = 0;

	const server = http.createServer((req, res) => {
		if (machine.outageActive) {
			// Simulated network loss: kill the connection without a response
			req.socket.destroy();
			return;
		}

		const url = new URL(req.url ?? "/", "http://mock");
		const endpoint = url.pathname.replace(/^\/+/, "");
		const q = (name: string): string => url.searchParams.get(name) ?? "";

		const json = (body: unknown, status = 200) => {
			const payload = JSON.stringify(body);
			res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
			res.end(payload);
		};
		const plain = (body: string, status = 200) => {
			res.writeHead(status, { "Content-Type": "text/plain", "Content-Length": Buffer.byteLength(body) });
			res.end(body);
		};

		// Full DSF surface (dsf: true): every /machine/* route belongs to
		// the DSF endpoint. Without it, only the emulated model route below
		// exists — dsf: false must behave exactly as before.
		if (dsf !== null && (endpoint === "machine" || endpoint.startsWith("machine/"))) {
			dsf.handleRest(req, res, endpoint, url);
			return;
		}

		// DSF's model endpoint, present only when emulating SBC mode. DSF
		// serves it without an rr_ session (its own auth is separate).
		if (endpoint === "machine/model") {
			if (!emulated) {
				plain("mock-duet: /machine/model exists only with emulated: true.", 404);
				return;
			}
			json(machine.om);
			return;
		}

		if (!endpoint.startsWith("rr_")) {
			plain("mock-duet: RRF rr_ endpoints only. This mock does not serve DWC assets.", 404);
			return;
		}

		// --- rr_connect is the only endpoint that needs no session ---
		if (endpoint === "rr_connect") {
			if (password !== "" && q("password") !== password) {
				json({ err: 1 });
				return;
			}
			const session = sessions.connect();
			if (session === null) {
				json({ err: 2 });
				return;
			}
			const response: Record<string, unknown> = {
				err: 0,
				apiLevel: 1,
				sessionTimeout: sessions.sessionTimeout,
			};
			if (emulated) response.isEmulated = true;
			if (q("sessionKey") === "yes") response.sessionKey = session.key;
			json(response);
			return;
		}

		// --- session check ---
		const session = sessions.fromHeader(req.headers["x-session-key"]);
		if (requireAuth && session === null) {
			plain("", 401);
			return;
		}

		// --- transient 503 injection (RRF: out of buffers / busy) ---
		if (busyEvery > 0 && ["rr_model", "rr_filelist", "rr_files"].includes(endpoint)) {
			busyCounter++;
			if (busyCounter % busyEvery === 0) {
				plain("Service Unavailable", 503);
				return;
			}
		}

		switch (endpoint) {
			case "rr_disconnect": {
				if (session !== null) sessions.disconnect(session.key);
				json({ err: 0 });
				return;
			}

			case "rr_model": {
				json(buildModelResponse(machine, q("key"), q("flags"), chunkSize));
				return;
			}

			case "rr_gcode": {
				if (!url.searchParams.has("gcode")) {
					json({ err: 1 });
					return;
				}
				machine.execute(q("gcode"));
				json({ err: 0, buff: 247 });
				return;
			}

			case "rr_reply": {
				plain(session !== null ? sessions.takeReplies(session) : "");
				return;
			}

			case "rr_upload": {
				if (req.method !== "POST") {
					json({ err: lastUploadErr });
					return;
				}
				const chunks: Buffer[] = [];
				req.on("data", chunk => chunks.push(chunk));
				req.on("end", () => {
					const data = new Uint8Array(Buffer.concat(chunks));
					const expectedCrc = q("crc32");
					if (expectedCrc !== "" && parseInt(expectedCrc, 16) !== crc32(data)) {
						lastUploadErr = 1;
						json({ err: 1 });
						return;
					}
					const ok = machine.sd.write(q("name"), data, q("time") || nowStr(machine));
					lastUploadErr = ok ? 0 : 1;
					if (ok) machine.bumpVolume(0);
					json({ err: lastUploadErr });
				});
				return;
			}

			case "rr_download": {
				const data = machine.sd.read(q("name"));
				if (data === null) {
					plain("", 404);
					return;
				}
				res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": data.length });
				res.end(Buffer.from(data));
				return;
			}

			case "rr_delete": {
				const ok = machine.sd.delete(q("name"), q("recursive") === "yes") === "ok";
				if (ok) machine.bumpVolume(0);
				json({ err: ok ? 0 : 1 });
				return;
			}

			case "rr_move": {
				const ok = machine.sd.move(q("old"), q("new"), q("deleteexisting") === "yes") === "ok";
				if (ok) machine.bumpVolume(0);
				json({ err: ok ? 0 : 1 });
				return;
			}

			case "rr_mkdir": {
				const ok = machine.sd.mkdir(q("dir"), nowStr(machine));
				if (ok) machine.bumpVolume(0);
				json({ err: ok ? 0 : 1 });
				return;
			}

			case "rr_filelist":
			case "rr_files": {
				const dir = q("dir");
				const first = parseInt(q("first") || "0", 10);
				const listing = machine.sd.list(dir);
				if (listing === "unmounted") {
					json({ dir, first, files: [], next: 0, err: 1 });
					return;
				}
				if (listing === "missing") {
					json({ dir, first, files: [], next: 0, err: 2 });
					return;
				}
				const page = listing.slice(first, first + chunkSize);
				const next = first + page.length < listing.length ? first + page.length : 0;
				const files = endpoint === "rr_files"
					? page.map(f => (q("flagDirs") === "1" && f.type === "d" ? `*${f.name}` : f.name))
					: page;
				json({ dir, first, files, next, err: 0 });
				return;
			}

			case "rr_fileinfo": {
				const name = q("name");
				if (name === "") {
					// No name: info about the file being printed
					const file = machine.om.job.file;
					if (file === null) {
						json({ err: 1 });
						return;
					}
					json({ err: 0, ...file });
					return;
				}
				const info = machine.sd.fileInfo.get(name);
				if (info === undefined) {
					json({ err: 1 });
					return;
				}
				json({ err: 0, ...info });
				return;
			}

			case "rr_thumbnail": {
				const data = machine.sd.thumbnails.get(q("name"));
				const offset = parseInt(q("offset") || "0", 10);
				const info = machine.sd.fileInfo.get(q("name"));
				const base = info?.thumbnails[0]?.offset ?? 0;
				if (data === undefined || offset < base) {
					json({ err: 1 });
					return;
				}
				// Serve the base64 payload in chunks, next = 0 when done
				const CHUNK = 1024;
				const pos = offset - base;
				const slice = data.slice(pos, pos + CHUNK);
				const next = pos + slice.length < data.length ? base + pos + slice.length : 0;
				json({ fileName: q("name"), offset, data: slice, next, err: 0 });
				return;
			}

			default:
				plain("", 404);
				return;
		}
	});

	// Created after `server` because attachWebSocket hooks its upgrade
	// event; the request handler above only dereferences it per-request.
	const dsf: DsfEndpoint | null = options.dsf === true
		? createDsfEndpoint(server, { machine, sessions, password })
		: null;

	let tickTimer: NodeJS.Timeout | null = null;

	return {
		server,
		machine,
		sessions,
		listen(port = 0, host = "127.0.0.1"): Promise<number> {
			return new Promise((resolve, reject) => {
				server.once("error", reject);
				server.listen(port, host, () => {
					if (tickMs > 0) {
						tickTimer = setInterval(() => machine.advance(tickMs), tickMs);
						tickTimer.unref();
					}
					const address = server.address();
					resolve(typeof address === "object" && address !== null ? address.port : port);
				});
			});
		},
		close(): Promise<void> {
			if (tickTimer !== null) clearInterval(tickTimer);
			// Upgraded WS sockets are invisible to closeAllConnections —
			// dispose() reaps them or server.close() would hang forever
			dsf?.dispose();
			server.closeAllConnections();
			return new Promise((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
		},
	};
}

function nowStr(machine: Machine): string {
	return machine.om.state.time;
}
