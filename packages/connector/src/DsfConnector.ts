import {
	type Connector, type ConnectorEvents, type ConnectionStatus, type FileListEntry,
	type GcodeFileInfo, type SendCodeOptions, type ThumbnailInfo,
	InvalidPasswordError, FileNotFoundError, OperationFailedError, DisconnectedError,
} from "./types.ts";
import { createDsfModel, type DsfModel, type DsfDigest } from "./dsfModel.ts";
import { isEmergencyStop } from "./emergency.ts";
import { isPlainObject } from "./safeObject.ts";
import { realClock, type Clock, type TimerHandle } from "./clock.ts";
import { SessionSlot, sessionRefusal, assertGoodbyeDelivered, GOODBYE_TIMEOUT_MS, type SessionRefusal } from "./session.ts";

// --- platform-timer shadow (invariant connector/clock-seam) -----------------
// Module-scoped shadows of the platform's timers: `setTimeout(...)` in this
// file is a COMPILE ERROR ("type 'never' has no call signatures"), not a silent
// return to wall time. Every deferral here goes through the injected Clock, so
// a test can drive a deadline instead of waiting it out. The declarations erase
// to nothing at runtime; test/clock-fence.test.ts checks they are still here.
declare const setTimeout: never;
declare const clearTimeout: never;
declare const setInterval: never;
declare const clearInterval: never;
declare const setImmediate: never;
declare const performance: never;
declare const AbortSignal: never;

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
	/**
	 * The clock every deferral on this connector runs on (see clock.ts).
	 * Omitted = wall time, which is what production wants and what every
	 * production call site gets without passing anything; a test hands in a
	 * virtual clock and drives the deadlines instead of waiting them out.
	 */
	clock?: Clock;
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
	/** Every deferral below runs on THIS, never on the platform (clock.ts). */
	private readonly clock: Clock;

	/**
	 * The one session this connector may hold (session.ts). Taking a new key
	 * through it IS handing the old one back, which is what stops a flapping
	 * link from eating every slot on the board (GIT_110).
	 */
	private readonly session: SessionSlot<string>;
	/** DSF session key (numeric on the wire; kept as header text). Null =
	 *  sessionless (no password set, or a pre-3.4-b4 DSF without connect).
	 *  Read-only on purpose: the slot owns the write side. */
	private get sessionKey(): string | null { return this.session.key; }
	/** The one live push socket. Per-socket state (model, lastSeen) lives in
	 *  openSocket's closure, NOT here — see the C8 note there. */
	private sock: WebSocket | null = null;
	private pingTimer: TimerHandle | null = null;
	private reconnectTimer: TimerHandle | null = null;
	/** True from disconnect() on: a dying socket must not start the ladder. */
	private deliberate = false;

	constructor(options: DsfConnectorOptions = {}) {
		this.base = options.baseUrl ?? "";
		this.password = options.password ?? "";
		this.pingIntervalMs = options.pingIntervalMs ?? 2000;
		this.reconnectDelayMs = options.reconnectDelayMs ?? 2000;
		this.requestTimeoutMs = options.requestTimeoutMs ?? 5000;
		this.events = options.events ?? {};
		this.clock = options.clock ?? realClock;
		this.session = new SessionSlot<string>(async key => assertGoodbyeDelivered(await fetch(this.machineUrl("disconnect"), {
			headers: { "X-Session-Key": key },
			// The goodbye must outlive the page that sends it: an ordinary
			// fetch is cancelled the instant the document unloads, which is
			// precisely the moment releaseSessionWhileHidden fires one.
			keepalive: true,
			// Its OWN budget, deliberately shorter than a request's: a
			// reconnect waits behind this, so a dead network must cost the
			// ladder a second at most (requirement 2 — best effort, never a
			// block). Derived, not a new knob.
			signal: this.clock.timeoutSignal(Math.min(this.requestTimeoutMs, GOODBYE_TIMEOUT_MS)),
		})));
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
		// Best effort inside the slot: the WS unpin already lets the session
		// idle out, so a failed goodbye costs nothing but time we do not spend.
		await this.session.release();
		this.setStatus("disconnected");
	}

	/**
	 * GET /machine/connect. 200 keeps the session key; 401/403 is terminal
	 * (a wrong password never fixes itself); ANYTHING else — 404, network
	 * failure, an odd status — degrades to sessionless, matching DSF
	 * versions before 3.4-b4 that have no connect route at all. A truly
	 * dead server then surfaces at the WebSocket, not here.
	 */
	private openSession(): Promise<void> {
		// Acquiring through the slot RELEASES the key being replaced first —
		// the ladder cannot outrun the board's ability to free what the last
		// attempt took, because freeing it is on the critical path of the next
		// one (GIT_110 requirement 4).
		return this.session.acquire(() => this.fetchSessionKey());
	}

	/**
	 * The same negotiation, for the case where the board has just REFUSED the
	 * key we held. No goodbye: a 401/403 is the board saying that session is
	 * already gone, and the `refusal` token is what keeps this route from
	 * being a general way to skip one (session.ts).
	 */
	private reopenSession(refusal: SessionRefusal): Promise<void> {
		return this.session.reauth(refusal, () => this.fetchSessionKey());
	}

	/** The bare negotiation. Returns the key to hold, or null for sessionless
	 *  parity; the slot is the only thing that stores it. */
	private async fetchSessionKey(): Promise<string | null> {
		let res: Response;
		try {
			res = await fetch(
				`${this.machineUrl("connect")}?password=${encodeURIComponent(this.password)}`,
				{ signal: this.clock.timeoutSignal(this.requestTimeoutMs) },
			);
		} catch {
			return null; // sessionless parity
		}
		if (res.status === 401 || res.status === 403) throw new InvalidPasswordError();
		// 404 alone is the sessionless fallback: DSF before 3.4-b4 has no
		// connect route, so proceeding keyless is correct. Every other non-ok
		// status is a real fault (500 generic, 502 incompatible DCS, 503 DCS
		// down per the spec) and must surface as itself — swallowing them made
		// the seam's later 401 replay retry connect, fail again, and finally
		// throw InvalidPasswordError, telling the operator the password was
		// wrong when DCS was simply down.
		if (res.status === 404) return null;
		if (!res.ok) throw new OperationFailedError(`/machine/connect: HTTP ${res.status}`);
		const body = await res.json().catch(() => null) as unknown;
		if (isPlainObject(body)) {
			const key = body["sessionKey"];
			if (typeof key === "number" || typeof key === "string") return String(key);
		}
		return null;
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
			let lastSeen = this.clock.now();
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

			// The deadline is armed HERE, not after the first frame: a socket
			// that completes the handshake and then says nothing is exactly the
			// case that used to hang connect() forever — and, because a
			// reconnect attempt awaits this promise, it stalled the whole
			// ladder with it (no timer, no next attempt, no Connect button).
			// lastSeen is stamped at construction, so the first frame is
			// covered by the same clock as every later one.
			this.startLiveness(ws, () => lastSeen, die);

			// ONE persistent handler, installed before any ack ever goes out:
			// pushes can arrive coalesced back-to-back, and a listener that is
			// re-registered per awaited frame loses the ones in between
			// (verified gotcha). The handler is fully synchronous — parse,
			// merge, emit, ack — so no frame can slip past an await either.
			ws.addEventListener("message", event => {
				if (this.sock !== ws) return; // a torn-down socket must not emit or ack
				lastSeen = this.clock.now();
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
				// The ONE ack site (C6): exactly one "OK\n" per processed push,
				// full frame and diff alike. The emission is wrapped because
				// the stream is ACK-GATED — a consumer that throws (a store
				// reconcile shape clash, a card body bug) would otherwise skip
				// the ack, the server would never push again, and PING/PONG
				// would keep reporting a healthy socket: a green chip over a
				// model frozen at the throw. A consumer's exception is the
				// consumer's bug, never the transport's, so it is swallowed
				// here and cannot escape the handler — the channel keeps
				// turning and the ack always goes out.
				try {
					this.emitDigest(current, digest);
					if (first) {
						this.events.onBoardInfo?.({ emulated: false, transport: "dsf", boardType: boardTypeOf(current) });
					}
				} catch { /* a downstream consumer threw — not our concern; keep the channel alive */ }
				if (ws.readyState === WebSocket.OPEN) ws.send("OK\n");
				if (first) {
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
	 *
	 * PONG resets the deadline, and that is correct given ack-gating: DCS
	 * answers PING from the same message loop that pushes model diffs, so a
	 * PONG proves that loop is alive. The only state where PONGs flow but
	 * model pushes do not is a genuinely idle machine with nothing to push —
	 * not a stall. (This holds ONLY because the ack fires unconditionally in
	 * the message handler; before that, a throwing emission froze the push
	 * stream while PONGs masked it — the two are one invariant, fixed
	 * together.)
	 */
	private startLiveness(ws: WebSocket, lastSeenOf: () => number, die: (reason: string) => void): void {
		this.stopLiveness(); // defensive: one timer, ever
		const deadlineMs = 2 * this.pingIntervalMs + 1000;
		this.pingTimer = this.clock.setInterval(() => {
			if (this.clock.now() - lastSeenOf() > deadlineMs) {
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
		this.reconnectTimer = this.clock.setTimeout(() => {
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

	async sendCode(code: string, opts?: SendCodeOptions): Promise<string> {
		// The unblockable path (D6/C9): recognized at the transport, before
		// any status gate, so EVERY caller sending the e-stop payload gets it
		// — a "reconnecting" session must still be able to halt the machine.
		if (isEmergencyStop(code)) {
			await this.sendEmergencyStop(code, false);
			return "";
		}
		if (this.status !== "connected") throw new DisconnectedError();
		// DSF answers a SOLICITED code's reply in the POST body only — the
		// spec says the reply goes to the WS `messages` channel ONLY when
		// async=true (sbc-OpenAPI.yaml), and we post synchronously. So this is
		// the sole delivery of that reply: emit it on onReply too, because the
		// console reads the EVENT, not sendCode's return value (ConsolePanel
		// discards it). Without this, typing M115 shows nothing. Empty replies
		// (most silent codes) are not console traffic — matching the mock,
		// which does not queue "" either.
		// `opts.timeoutMs` becomes THIS request's budget and nothing else's.
		// DSF answers /machine/code only once the code has EXECUTED, so on this
		// transport a long code is literally a long request — a caller that
		// already knows the duration (the shaping lab derives its own `G4 P`)
		// is the only party that can size it, and the flat default is what a
		// caller who does not know still gets. Undefined falls through to that
		// default inside `request`, so this is the same call it always was when
		// nobody passes anything.
		const res = await this.request("POST", this.machineUrl("code"), { body: code, timeoutMs: opts?.timeoutMs });
		const reply = (await res.text()).trim();
		if (reply !== "") this.events.onReply?.(reply);
		return reply;
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
				signal: this.clock.timeoutSignal(this.requestTimeoutMs),
			});
		} catch (err) {
			throw new OperationFailedError(`emergency stop: ${(err as Error).message}`);
		}
		const refusal = sessionRefusal(res.status);
		if (refusal !== null && !retried) {
			try {
				await this.reopenSession(refusal);
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
				signal: this.clock.timeoutSignal(opts.timeoutMs ?? this.requestTimeoutMs),
			});
		} catch (err) {
			throw new OperationFailedError(`${method} ${url}: ${(err as Error).message}`);
		}
		if (res.ok) return res;
		const refusal = sessionRefusal(res.status);
		if (refusal !== null) {
			if (retried) throw new InvalidPasswordError();
			// Culled session (DCS restart, idle sweep): re-auth transparently
			// and replay exactly once — bodies here are strings/bytes/params,
			// all safely re-sendable.
			await this.reopenSession(refusal);
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
		this.clock.clearInterval(this.pingTimer);
		this.pingTimer = null;
	}

	private stopReconnect(): void {
		this.clock.clearTimeout(this.reconnectTimer);
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
