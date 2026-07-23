import {
	type Connector, type ConnectorEvents, type ConnectionStatus, type FileListEntry,
	type GcodeFileInfo, type ThumbnailInfo,
	InvalidPasswordError, FileNotFoundError, OperationFailedError, DisconnectedError,
} from "./types.ts";
import { createDsfModel, type DsfModel, type DsfDigest } from "./dsfModel.ts";
import { isEmergencyStop } from "./emergency.ts";
import { isPlainObject } from "../util/safeObject.ts";

/**
 * SBC-mode connector speaking DSF's native /machine API (design:
 * docs/dsf-connector-design.md, decisions D4–D8/D10): one WebSocket push
 * channel for the model — full frame first, then ack-gated sparse diffs —
 * plus plain REST for codes and files.
 *
 * Protocol sources (do not code from memory):
 * - .claude/skills/duet-http-api/ — /machine route map + the DSF OpenAPI
 * - reference/connectors/src/RestConnector.ts — behavior reference ONLY
 * - live wire facts (the real Pi, 2026-07-23): first frame = full model,
 *   then ~90 B diffs gated on "OK\n" acks; "PING\n" answered "PONG\n";
 *   close code 1006 on teardown is routine, not an error.
 *
 * Deliberately NO request queue (the spot where PollConnector documents
 * its single-slot RequestQueue): DSF fronts a Pi's real web server, not
 * RRF's starved embedded socket pool. Requests run concurrently, and
 * failures surface as typed errors through the one seam (D8/C12) instead
 * of being retried or serialized.
 *
 * All model translation lives in dsfModel.ts (D1/C2): this class only
 * moves frames in and wholesale onModelKey/onJobLayers/onReply out — the
 * store's un-conformed patch path is unreachable from this transport.
 */

export interface DsfConnectorOptions {
	/** Origin serving the /machine API. "" = the page's own origin. */
	baseUrl?: string;
	password?: string;
	/** PING cadence; the liveness deadline is 2× this + 1 s (D5/C7). */
	pingIntervalMs?: number;
	/** Delay between reconnect attempts after a lost socket (D4/C8). */
	reconnectDelayMs?: number;
	/** Budget for one plain REST request (uploads get a generous multiple). */
	requestTimeoutMs?: number;
	events?: ConnectorEvents;
}

/**
 * Uploads get this multiple of requestTimeoutMs: a multi-MB gcode through
 * the Pi beats RRF easily, but must never be cut off by a 5 s poll budget.
 */
const UPLOAD_TIMEOUT_FACTOR = 60;

export class DsfConnector implements Connector {
	status: ConnectionStatus = "disconnected";

	private readonly base: string;
	private readonly password: string;
	private readonly pingIntervalMs: number;
	private readonly reconnectDelayMs: number;
	private readonly requestTimeoutMs: number;
	private readonly events: ConnectorEvents;

	/** DSF session key (numeric on the wire; kept as header text). Null =
	 *  sessionless (no password set, or a pre-3.4-b4 DSF without connect). */
	private sessionKey: string | null = null;
	/** The one live push socket. Per-socket state (model, lastSeen) lives in
	 *  openSocket's closure, NOT here — see the C8 note there. */
	private sock: WebSocket | null = null;
	private pingTimer: ReturnType<typeof setInterval> | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	/** True from disconnect() on: a dying socket must not start the ladder. */
	private deliberate = false;

	constructor(options: DsfConnectorOptions = {}) {
		this.base = options.baseUrl ?? "";
		this.password = options.password ?? "";
		this.pingIntervalMs = options.pingIntervalMs ?? 2000;
		this.reconnectDelayMs = options.reconnectDelayMs ?? 2000;
		this.requestTimeoutMs = options.requestTimeoutMs ?? 5000;
		this.events = options.events ?? {};
	}

	// ---------- lifecycle ----------

	async connect(): Promise<void> {
		this.deliberate = false;
		this.stopReconnect();
		this.teardownSocket();
		this.setStatus("connecting");
		try {
			await this.openSession();
			// Resolves only after the full model was emitted and acked — the
			// App chains config.loadFromMachine on connect(), so an early
			// resolve would race the store's first truth.
			await this.openSocket();
		} catch (err) {
			this.setStatus("disconnected", (err as Error).message);
			throw err;
		}
	}

	async disconnect(): Promise<void> {
		this.deliberate = true;
		this.stopReconnect();
		this.teardownSocket();
		if (this.sessionKey !== null) {
			// Best effort: the WS unpin already lets the session idle out, so a
			// failed goodbye costs nothing.
			try {
				await fetch(this.machineUrl("disconnect"), {
					headers: { "X-Session-Key": this.sessionKey },
					signal: AbortSignal.timeout(this.requestTimeoutMs),
				});
			} catch {
				// nothing to recover
			}
		}
		this.sessionKey = null;
		this.setStatus("disconnected");
	}

	/**
	 * GET /machine/connect. 200 keeps the session key; 401/403 is terminal
	 * (a wrong password never fixes itself); ANYTHING else — 404, network
	 * failure, an odd status — degrades to sessionless, matching DSF
	 * versions before 3.4-b4 that have no connect route at all. A truly
	 * dead server then surfaces at the WebSocket, not here.
	 */
	private async openSession(): Promise<void> {
		this.sessionKey = null;
		let res: Response;
		try {
			res = await fetch(
				`${this.machineUrl("connect")}?password=${encodeURIComponent(this.password)}`,
				{ signal: AbortSignal.timeout(this.requestTimeoutMs) },
			);
		} catch {
			return; // sessionless parity
		}
		if (res.status === 401 || res.status === 403) throw new InvalidPasswordError();
		if (!res.ok) return; // 404 = pre-3.4-b4; others degrade the same way
		const body = await res.json().catch(() => null) as unknown;
		if (isPlainObject(body)) {
			const key = body["sessionKey"];
			if (typeof key === "number" || typeof key === "string") this.sessionKey = String(key);
		}
	}

	/**
	 * Open the push socket and drive it until it dies. Resolves once the
	 * first (full-model) frame has been emitted, acked, and the status is
	 * "connected"; rejects if the socket dies first.
	 *
	 * Per-socket state — the model copy and the liveness clock — lives in
	 * THIS closure by construction (C8): a reconnect builds a new closure
	 * around a new createDsfModel(), so no field exists through which a new
	 * session could resume a stale model. Partial resume is unrepresentable.
	 */
	private openSocket(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const query = this.sessionKey !== null ? `?sessionKey=${encodeURIComponent(this.sessionKey)}` : "";
			// The ws origin derives from the same sole URL builder (C11).
			const ws = new WebSocket(this.machineUrl("").replace(/^http/, "ws") + query);
			this.sock = ws;
			let model: DsfModel | null = null;
			let lastSeen = Date.now();
			let settled = false;

			/**
			 * The sole route out of this socket, whatever killed it (close,
			 * error, liveness expiry, protocol violation). Idempotent: the
			 * second cause to arrive finds `current` false and does nothing.
			 */
			const die = (reason: string): void => {
				const current = this.sock === ws;
				if (current) {
					this.sock = null;
					this.stopLiveness();
				}
				if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
					try { ws.close(); } catch { /* already closing */ }
				}
				if (!settled) {
					// Still opening: the caller (connect / reconnect attempt)
					// owns the failure — no ladder from here.
					settled = true;
					reject(new OperationFailedError(`/machine websocket: ${reason}`));
					return;
				}
				if (current && !this.deliberate) this.beginReconnect(reason);
			};

			ws.addEventListener("error", () => die("socket error"));
			ws.addEventListener("close", event => die(`closed (${event.code})`));

			// ONE persistent handler, installed before any ack ever goes out:
			// pushes can arrive coalesced back-to-back, and a listener that is
			// re-registered per awaited frame loses the ones in between
			// (verified gotcha). The handler is fully synchronous — parse,
			// merge, emit, ack — so no frame can slip past an await either.
			ws.addEventListener("message", event => {
				if (this.sock !== ws) return; // a torn-down socket must not emit or ack
				lastSeen = Date.now();
				const text = typeof event.data === "string" ? event.data : "";
				if (text.trim() === "PONG") return; // liveness answer — consumed, never acked
				let frame: unknown;
				try {
					frame = JSON.parse(text);
				} catch {
					// Protocol violation: this socket can no longer be trusted;
					// resync from scratch through the ladder.
					die("unparseable frame");
					return;
				}
				const first = model === null;
				const current = model ?? createDsfModel();
				model = current;
				const digest = first ? current.applyFull(frame) : current.applyDiff(frame);
				this.emitDigest(current, digest);
				if (first) {
					this.events.onBoardInfo?.({ emulated: false, transport: "dsf", boardType: boardTypeOf(current) });
				}
				// The ONE ack site (C6): exactly one "OK\n" per processed push,
				// full frame and diff alike, sent only after every emission for
				// the frame has landed. No other code sends an ack.
				if (ws.readyState === WebSocket.OPEN) ws.send("OK\n");
				if (first) {
					this.startLiveness(ws, () => lastSeen, die);
					this.setStatus("connected");
					settled = true;
					resolve();
				}
			});
		});
	}

	/**
	 * D5/C7: one timer per live socket. Each tick first audits the deadline
	 * — no inbound frame for 2×ping + 1 s means the socket is presumed dead
	 * (a silently dead socket would otherwise serve week-old truth) — then
	 * pings. Expiry goes through die(): teardown + ladder, never limbo.
	 */
	private startLiveness(ws: WebSocket, lastSeenOf: () => number, die: (reason: string) => void): void {
		this.stopLiveness(); // defensive: one timer, ever
		const deadlineMs = 2 * this.pingIntervalMs + 1000;
		this.pingTimer = setInterval(() => {
			if (Date.now() - lastSeenOf() > deadlineMs) {
				die(`no frame for ${deadlineMs} ms (liveness deadline)`);
				return;
			}
			if (ws.readyState === WebSocket.OPEN) ws.send("PING\n");
		}, this.pingIntervalMs);
	}

	/**
	 * D4/C8: the connector-owned reconnect ladder. The guard collapses
	 * concurrent triggers (close event + liveness expiry) into one ladder;
	 * InvalidPasswordError is terminal inside the attempts, everything else
	 * retries every reconnectDelayMs until deliberate disconnect.
	 */
	private beginReconnect(detail: string): void {
		if (this.deliberate || this.status === "reconnecting") return;
		this.setStatus("reconnecting", detail);
		this.scheduleReconnect();
	}

	private scheduleReconnect(): void {
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			void this.tryReconnect();
		}, this.reconnectDelayMs);
	}

	private async tryReconnect(): Promise<void> {
		if (this.deliberate) return;
		try {
			// Fresh session, same tolerance as first connect; the first frame
			// then builds a brand-new model inside openSocket's closure and
			// re-emits everything — fresh truth, never a resume (C8).
			await this.openSession();
			if (this.deliberate) return;
			await this.openSocket();
		} catch (err) {
			if (err instanceof InvalidPasswordError) {
				// The password will not fix itself — surface and stop.
				this.setStatus("disconnected", err.message);
				return;
			}
			if (!this.deliberate) this.scheduleReconnect();
		}
	}

	// ---------- Connector surface: codes ----------

	async sendCode(code: string): Promise<string> {
		// The unblockable path (D6/C9): recognized at the transport, before
		// any status gate, so EVERY caller sending the e-stop payload gets it
		// — a "reconnecting" session must still be able to halt the machine.
		if (isEmergencyStop(code)) {
			await this.sendEmergencyStop(code, false);
			return "";
		}
		if (this.status !== "connected") throw new DisconnectedError();
		// DSF answers when the code has completed; silent codes answer ""
		// right here (they are never queued on the WS messages channel, so
		// nothing repeats them later).
		const res = await this.request("POST", this.machineUrl("code"), { body: code });
		return (await res.text()).trim();
	}

	/**
	 * Fire the e-stop straight at DSF: a direct fetch with no shared
	 * machinery, so nothing this class does — status gates, the error seam's
	 * replay, a wedged socket — can delay or swallow it. One transparent
	 * re-auth on a culled session, then one re-fire; any remaining failure
	 * REJECTS, because the STOP button's alarm depends on honest rejection.
	 */
	private async sendEmergencyStop(code: string, retried: boolean): Promise<void> {
		let res: Response;
		try {
			res = await fetch(this.machineUrl("code"), {
				method: "POST",
				body: code,
				headers: this.sessionKey !== null ? { "X-Session-Key": this.sessionKey } : {},
				signal: AbortSignal.timeout(this.requestTimeoutMs),
			});
		} catch (err) {
			throw new OperationFailedError(`emergency stop: ${(err as Error).message}`);
		}
		if ((res.status === 401 || res.status === 403) && !retried) {
			try {
				await this.openSession();
			} catch {
				// Even a bad password must not stop the re-fire attempt; the
				// re-POST below reports the truth either way.
			}
			return this.sendEmergencyStop(code, true);
		}
		if (!res.ok) throw new OperationFailedError(`emergency stop: HTTP ${res.status}`);
	}

	// ---------- Connector surface: files (D7) ----------

	async download(path: string): Promise<string> {
		// 404 → FileNotFoundError via the seam — load-bearing: config boot
		// probes for dwc-ng-config.json and treats "not found" as first run.
		const res = await this.request("GET", this.machineUrl("file", path), { path });
		return res.text();
	}

	async upload(path: string, content: Uint8Array | string, _onProgress?: (fraction: number) => void): Promise<void> {
		// fetch cannot observe upload-byte progress, so _onProgress is
		// accepted (the Connector contract keeps it optional/best-effort)
		// and ignored. DSF answers 201 Created; the seam rejects anything
		// outside 2xx, which is as much verification as this transport
		// offers (no CRC exists in the /machine protocol).
		await this.request("PUT", this.machineUrl("file", path), {
			body: content as BodyInit,
			path,
			timeoutMs: this.requestTimeoutMs * UPLOAD_TIMEOUT_FACTOR,
		});
	}

	async list(dir: string): Promise<FileListEntry[]> {
		const res = await this.request("GET", this.machineUrl("directory", dir), { path: dir });
		const body = await res.json().catch(() => null) as unknown;
		if (!Array.isArray(body)) throw new OperationFailedError(`directory listing for ${dir} is not a list`);
		const entries: FileListEntry[] = [];
		for (const item of body) {
			// Parse, don't trust: each entry is rebuilt as our own plain
			// object from checked fields — wire shapes never flow through.
			if (!isPlainObject(item)) continue;
			const name = item["name"];
			if (typeof name !== "string" || name === "") continue;
			const entry: FileListEntry = {
				type: item["type"] === "d" ? "d" : "f",
				name,
				size: typeof item["size"] === "number" ? item["size"] : 0,
			};
			const date = item["date"];
			// DSF's YYYY-MM-DDTHH:mm:ss sorts lexicographically — that IS the
			// recent-sort contract FileListEntry.date carries.
			if (typeof date === "string") entry.date = date;
			entries.push(entry);
		}
		return entries;
	}

	async mkdir(path: string): Promise<void> {
		await this.request("PUT", this.machineUrl("directory", path), { path });
	}

	async move(from: string, to: string, overwrite = false): Promise<void> {
		// The ONE documented exception to machineUrl's path encoding (C11):
		// file/move takes its paths RAW in urlencoded form fields, not URL
		// segments. DSF accepts application/x-www-form-urlencoded, which
		// URLSearchParams sets on the request by itself.
		const fields = new URLSearchParams({ from, to });
		if (overwrite) fields.set("force", "true");
		// Without force, DSF refuses to clobber an existing destination —
		// surfaced through the seam as a typed rejection, never a default.
		await this.request("POST", this.machineUrl("file/move"), { body: fields, path: from });
	}

	async remove(path: string, recursive = false): Promise<void> {
		const query = recursive ? "?recursive=true" : "";
		await this.request("DELETE", this.machineUrl("file", path) + query, { path });
	}

	async getFileInfo(path: string): Promise<GcodeFileInfo> {
		const res = await this.request("GET", this.machineUrl("fileinfo", path), { path });
		const body = await res.json().catch(() => null) as unknown;
		const raw = isPlainObject(body) ? body : {};
		const fileName = raw["fileName"];
		return {
			fileName: typeof fileName === "string" && fileName !== "" ? fileName : path,
			size: typeof raw["size"] === "number" ? raw["size"] : 0,
			lastModified: strOrUndef(raw["lastModified"]),
			height: numOrUndef(raw["height"]),
			layerHeight: numOrUndef(raw["layerHeight"]),
			numLayers: numOrUndef(raw["numLayers"]),
			printTime: numOrUndef(raw["printTime"]),
			simulatedTime: numOrUndef(raw["simulatedTime"]),
			filament: Array.isArray(raw["filament"])
				? raw["filament"].filter((n): n is number => typeof n === "number")
				: [],
			generatedBy: typeof raw["generatedBy"] === "string" ? raw["generatedBy"] : "",
			thumbnails: thumbnailsOf(raw["thumbnails"]),
		};
	}

	async getThumbnail(path: string, offset: number): Promise<Uint8Array> {
		// D7: DSF has no rr_thumbnail chunk loop — one fileinfo call with
		// readThumbnailContent carries every thumbnail's base64 body; ours is
		// selected by the offset token getFileInfo preserved verbatim.
		const res = await this.request(
			"GET",
			this.machineUrl("fileinfo", path) + "?readThumbnailContent=true",
			{ path },
		);
		const body = await res.json().catch(() => null) as unknown;
		const list = isPlainObject(body) && Array.isArray(body["thumbnails"]) ? body["thumbnails"] : [];
		for (const item of list) {
			if (!isPlainObject(item) || item["offset"] !== offset) continue;
			const data = item["data"];
			if (typeof data !== "string") break; // metadata came without content
			const bin = atob(data);
			const bytes = new Uint8Array(bin.length);
			for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
			return bytes;
		}
		throw new OperationFailedError(`no thumbnail at offset ${offset} in ${path}`);
	}

	// ---------- plumbing ----------

	/**
	 * The sole /machine URL builder (C11): the WHOLE virtual path travels as
	 * ONE encodeURIComponent component, so a filename containing %, # or ?
	 * cannot fracture the route. move()'s raw form fields are the one
	 * documented exception, and they live inside move() itself.
	 */
	private machineUrl(route: string, path?: string): string {
		const origin = this.base !== "" ? this.base : (typeof location !== "undefined" ? location.origin : "");
		let url = `${origin}/machine`;
		if (route !== "") url += `/${route}`;
		if (path !== undefined) url += `/${encodeURIComponent(path)}`;
		return url;
	}

	/**
	 * The ONE REST seam (D8/C12): every /machine HTTP call except the two
	 * documented direct fetches (e-stop, disconnect goodbye) goes through
	 * here, so the typed-error mapping cannot be skipped at a call site:
	 * 401/403 → one transparent re-connect + single replay, then
	 * InvalidPasswordError; 404 → FileNotFoundError; everything else non-ok
	 * (DSF reports failures as 500 with a text body) and every network/
	 * timeout failure → OperationFailedError. No raw Error escapes.
	 */
	private async request(
		method: string,
		url: string,
		opts: { body?: BodyInit; path?: string; timeoutMs?: number } = {},
		retried = false,
	): Promise<Response> {
		let res: Response;
		try {
			res = await fetch(url, {
				method,
				body: opts.body,
				headers: this.sessionKey !== null ? { "X-Session-Key": this.sessionKey } : {},
				signal: AbortSignal.timeout(opts.timeoutMs ?? this.requestTimeoutMs),
			});
		} catch (err) {
			throw new OperationFailedError(`${method} ${url}: ${(err as Error).message}`);
		}
		if (res.ok) return res;
		if (res.status === 401 || res.status === 403) {
			if (retried) throw new InvalidPasswordError();
			// Culled session (DCS restart, idle sweep): re-auth transparently
			// and replay exactly once — bodies here are strings/bytes/params,
			// all safely re-sendable.
			await this.openSession();
			return this.request(method, url, opts, true);
		}
		if (res.status === 404) throw new FileNotFoundError(opts.path ?? url);
		const detail = (await res.text().catch(() => "")).trim();
		throw new OperationFailedError(detail !== "" ? detail : `${method} ${url}: HTTP ${res.status}`);
	}

	/**
	 * Emit one digest through the Connector events — the only emission path
	 * (both apply routes funnel here), so the channel split cannot drift:
	 * wholesale onModelKey per touched key (D1/C2 — array shrinks arrive as
	 * truncated whole subtrees), layers ONLY via onJobLayers (D2/C4 — the
	 * job emission itself always carries layers: []), messages ONLY via
	 * onReply (D3/C5 — consumed at ingestion, never model data).
	 */
	private emitDigest(model: DsfModel, digest: DsfDigest): void {
		for (const key of digest.touchedKeys) this.events.onModelKey?.(key, model.snapshot(key));
		if (digest.layers !== null) this.events.onJobLayers?.(digest.layers);
		for (const text of digest.replies) this.events.onReply?.(text);
	}

	private setStatus(status: ConnectionStatus, detail?: string): void {
		if (this.status === status) return;
		this.status = status;
		this.events.onStatusChange?.(status, detail);
	}

	private stopLiveness(): void {
		if (this.pingTimer !== null) clearInterval(this.pingTimer);
		this.pingTimer = null;
	}

	private stopReconnect(): void {
		if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = null;
	}

	private teardownSocket(): void {
		this.stopLiveness();
		const sock = this.sock;
		this.sock = null; // cleared FIRST: the socket's own close event must find it gone
		if (sock !== null && (sock.readyState === WebSocket.CONNECTING || sock.readyState === WebSocket.OPEN)) {
			try { sock.close(); } catch { /* already closing */ }
		}
	}
}

function numOrUndef(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined;
}

function strOrUndef(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

/** boards[0]'s short name (or full name), when the model trivially has one. */
function boardTypeOf(model: DsfModel): string | undefined {
	const boards = model.snapshot("boards");
	const first = Array.isArray(boards) ? boards[0] : undefined;
	if (!isPlainObject(first)) return undefined;
	const short = first["shortName"];
	if (typeof short === "string" && short !== "") return short;
	const name = first["name"];
	return typeof name === "string" && name !== "" ? name : undefined;
}

/**
 * Thumbnail descriptors, rebuilt tolerantly from the wire: an entry without
 * a numeric offset is dropped (the offset IS the opaque token getThumbnail
 * takes — without it the thumbnail is unfetchable); everything else
 * defaults rather than throws, because thumbnails are decoration.
 */
function thumbnailsOf(value: unknown): ThumbnailInfo[] {
	if (!Array.isArray(value)) return [];
	const out: ThumbnailInfo[] = [];
	for (const item of value) {
		if (!isPlainObject(item)) continue;
		const offset = item["offset"];
		if (typeof offset !== "number") continue;
		const format = item["format"];
		out.push({
			width: typeof item["width"] === "number" ? item["width"] : 0,
			height: typeof item["height"] === "number" ? item["height"] : 0,
			format: format === "qoi" || format === "jpeg" ? format : "png",
			offset,
			size: typeof item["size"] === "number" ? item["size"] : 0,
		});
	}
	return out;
}
