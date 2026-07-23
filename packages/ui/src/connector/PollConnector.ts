import {
	type Connector, type ConnectorEvents, type ConnectionStatus, type FileListEntry,
	type GcodeFileInfo, type ThumbnailInfo,
	InvalidPasswordError, NoFreeSessionError, FileNotFoundError,
	OperationFailedError, DisconnectedError,
} from "./types.ts";
import { crc32 } from "./crc32.ts";
import { RequestQueue, type RequestPriority } from "./requestQueue.ts";
import { isEmergencyStop } from "./emergency.ts";
import { createLayerHistory, type LayerHistory, type LayerObservation } from "./layerHistory.ts";
import { isPlainObject as isRecord, safeEntries } from "../util/safeObject.ts";

/**
 * Standalone-mode connector speaking RRF's rr_ HTTP dialect.
 *
 * Protocol sources (do not code from memory):
 * - .claude/skills/duet-http-api/ — endpoint map + standalone-OpenAPI.yaml
 * - reference/connectors/src/PollConnector.ts — the battle-tested original;
 *   retry/re-auth behavior below mirrors its request() (:176-245)
 *
 * The poll loop (mirrors the original :544-577):
 * 1. every tick: rr_model?flags=d99fn → sparse live values + fresh seqs
 * 2. seqs[key] advanced → re-fetch that whole subtree (flags=d99vno,
 *    chunked via a<offset>/next) → emit as wholesale replacement
 * 3. seqs.reply advanced → drain rr_reply promptly (RRF drops unread
 *    replies after ~1 s); seqs.volChanges[i] advanced → onFilesChanged(i)
 */

export interface PollConnectorOptions {
	/** Origin serving the rr_ API. "" = same origin (vite proxy in dev). */
	baseUrl?: string;
	password?: string;
	/** Live-poll cadence. Doubles as the session keepalive. */
	pollIntervalMs?: number;
	/** Base delay between retries of a failed request. */
	retryDelayMs?: number;
	maxRetries?: number;
	requestTimeoutMs?: number;
	/**
	 * Timeout for a whole file upload. Far longer than requestTimeoutMs: a
	 * multi-MB gcode over RRF's slow HTTP takes far more than a poll's 5s.
	 */
	uploadTimeoutMs?: number;
	/**
	 * Start the poll timer on connect (default). Tests set false and drive
	 * the loop with pollOnce() for determinism.
	 */
	autoPoll?: boolean;
	events?: ConnectorEvents;
}

/** Root keys standalone RRF never serves; never ask for them (original :20). */
const SKIPPED_KEYS = new Set(["messages", "plugins", "sbc"]);
/** seqs members that are protocol state, not model keys. */
const NON_MODEL_SEQS = new Set(["reply", "volChanges"]);

/**
 * How long sendCode waits for a reply AFTER the explicit drain has already
 * asked for one. Most G-codes reply with nothing at all; this is the delay
 * before we call it silent, not a request timeout.
 */
const REPLY_GRACE_MS = 250;

export class PollConnector implements Connector {
	status: ConnectionStatus = "disconnected";

	private base: string;
	private password: string;
	private readonly pollIntervalMs: number;
	private readonly retryDelayMs: number;
	private readonly maxRetries: number;
	private readonly requestTimeoutMs: number;
	private readonly uploadTimeoutMs: number;
	private readonly autoPoll: boolean;
	private readonly events: ConnectorEvents;

	private sessionKey: number | null = null;
	private lastSeqs: Record<string, number> = {};
	private lastVolSeqs: number[] = [];
	private pollTimer: ReturnType<typeof setTimeout> | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	/**
	 * Serializes all traffic (RRF handles very few concurrent connections) AND
	 * orders it: the poll heartbeat and user commands must not sit behind bulk
	 * file I/O. One slot; each attempt takes it briefly and backoff happens
	 * outside, so a retrying request can't starve the poll.
	 */
	private readonly requests = new RequestQueue(1);
	/** sendCode() calls waiting for the next non-empty reply. */
	private replyWaiters: Array<(text: string) => void> = [];

	/** True when rr_ is served by DSF on an SBC (rr_connect isEmulated). */
	private emulated = false;
	/**
	 * The ONE producer of job.layers per connection (RRF keeps no layer
	 * history): synthesized from observed polls in standalone, fetched from
	 * DSF's own model when emulated. A closed union chosen against the
	 * session's `emulated` flag — the two modes cannot both be live, and a
	 * reconnect that lands on a different backend re-chooses automatically.
	 */
	private layerSource:
		| { mode: "synth"; history: LayerHistory }
		| { mode: "dsf"; lastLayer: number | null }
		| null = null;

	constructor(options: PollConnectorOptions = {}) {
		this.base = options.baseUrl ?? "";
		this.password = options.password ?? "";
		this.pollIntervalMs = options.pollIntervalMs ?? 500;
		this.retryDelayMs = options.retryDelayMs ?? 200;
		this.maxRetries = options.maxRetries ?? 4;
		this.requestTimeoutMs = options.requestTimeoutMs ?? 5000;
		this.uploadTimeoutMs = options.uploadTimeoutMs ?? 300000;
		this.autoPoll = options.autoPoll ?? true;
		this.events = options.events ?? {};
	}

	// ---------- lifecycle ----------

	async connect(): Promise<void> {
		this.setStatus("connecting");
		try {
			await this.openSession();
			await this.fullSync();
		} catch (err) {
			this.setStatus("disconnected", (err as Error).message);
			throw err;
		}
		this.setStatus("connected");
		if (this.autoPoll) this.schedulePoll();
	}

	async disconnect(): Promise<void> {
		this.stopTimers();
		if (this.sessionKey !== null) {
			try {
				await this.rawRequest("rr_disconnect", undefined, "high");
			} catch {
				// Session dies via idle timeout anyway; nothing to recover.
			}
		}
		this.sessionKey = null;
		this.setStatus("disconnected");
	}

	private async openSession(): Promise<void> {
		const res = await this.rawRequest(
			`rr_connect?password=${encodeURIComponent(this.password)}&time=${encodeURIComponent(isoNow())}&sessionKey=yes`,
		);
		const body = await res.json() as { err: number; sessionKey?: number; isEmulated?: boolean; boardType?: string };
		if (body.err === 1) throw new InvalidPasswordError();
		if (body.err === 2) throw new NoFreeSessionError();
		if (body.err !== 0) throw new OperationFailedError(`rr_connect err ${body.err}`);
		this.sessionKey = body.sessionKey ?? null;
		this.emulated = body.isEmulated === true;
		this.events.onBoardInfo?.({
			emulated: this.emulated,
			transport: this.emulated ? "rr-emulated" : "rr",
			boardType: body.boardType,
		});
	}

	/** Fetch seqs then every model key, emitting wholesale replacements. */
	private async fullSync(): Promise<void> {
		const seqs = (await this.getJson(`rr_model?key=seqs`)).result as Record<string, unknown>;
		const keys = Object.keys(seqs).filter(k => !NON_MODEL_SEQS.has(k) && !SKIPPED_KEYS.has(k));
		for (const key of keys) {
			const value = await this.fetchModelKey(key);
			this.events.onModelKey?.(key, value);
			// Layer history sees the job at connect too — a mid-print connect
			// starts tracking (and, in DSF mode, backfills) immediately.
			if (key === "job" && isRecord(value)) this.trackLayers({ job: value });
		}
		this.lastSeqs = pickNumbers(seqs);
		this.lastVolSeqs = Array.isArray(seqs.volChanges) ? [...(seqs.volChanges as number[])] : [];
		// Drain any reply that predates us so the shared buffer starts clean
		if (typeof seqs.reply === "number" && seqs.reply > 0) await this.drainReply();
	}

	// ---------- the poll loop ----------

	/** One poll cycle. Public so tests (and adaptive callers) can drive it. */
	async pollOnce(): Promise<void> {
		const live = (await this.getJson(`rr_model?flags=d99fn`)).result as Record<string, unknown>;
		const seqs = (live.seqs ?? {}) as Record<string, unknown>;
		delete live.seqs; // connector-maintained protocol state, not model data

		this.events.onModelPatch?.(live);
		this.trackLayers(live);

		// Changed subtrees → authoritative re-fetch, wholesale replacement
		for (const [key, value] of Object.entries(pickNumbers(seqs))) {
			if (NON_MODEL_SEQS.has(key) || SKIPPED_KEYS.has(key)) continue;
			if (this.lastSeqs[key] !== value) {
				this.events.onModelKey?.(key, await this.fetchModelKey(key));
			}
		}

		if (typeof seqs.reply === "number" && seqs.reply !== this.lastSeqs["reply"]) {
			await this.drainReply();
		}

		const vols = Array.isArray(seqs.volChanges) ? (seqs.volChanges as number[]) : [];
		vols.forEach((seq, i) => {
			if (this.lastVolSeqs[i] !== undefined && this.lastVolSeqs[i] !== seq) {
				this.events.onFilesChanged?.(i);
			}
		});

		this.lastSeqs = pickNumbers(seqs);
		this.lastVolSeqs = [...vols];
	}

	private schedulePoll(): void {
		this.pollTimer = setTimeout(() => {
			void this.pollOnce()
				.then(() => {
					if (this.status === "connected") this.schedulePoll();
				})
				.catch(() => this.beginReconnect());
		}, this.pollIntervalMs);
	}

	/** Connection lost: keep trying rr_connect + full resync until it works. */
	private beginReconnect(): void {
		if (this.status !== "connected" && this.status !== "reconnecting") return;
		this.stopTimers();
		this.sessionKey = null;
		this.setStatus("reconnecting");
		const attempt = (): void => {
			this.reconnectTimer = setTimeout(() => {
				void this.openSession()
					.then(() => this.fullSync())
					.then(() => {
						this.setStatus("connected");
						if (this.autoPoll) this.schedulePoll();
					})
					.catch(err => {
						// Wrong password will never fix itself — surface and stop
						if (err instanceof InvalidPasswordError) {
							this.setStatus("disconnected", err.message);
							return;
						}
						attempt();
					});
			}, this.pollIntervalMs * 2);
		};
		attempt();
	}

	// ---------- Connector surface ----------

	async sendCode(code: string): Promise<string> {
		// The unblockable path: an e-stop never waits for a queue slot (an
		// in-flight upload can hold the only one for minutes) and is never
		// status-gated (a "reconnecting" session must still be able to halt
		// the machine). Recognized here, at the transport, so EVERY caller
		// that sends the e-stop payload gets the unblocked path — not just
		// the STOP button.
		if (isEmergencyStop(code)) {
			await this.sendEmergencyStop(code, false);
			return "";
		}
		if (this.status !== "connected") throw new DisconnectedError();
		let settle!: (text: string) => void;
		const replyPromise = new Promise<string>(resolve => {
			settle = resolve;
			this.replyWaiters.push(resolve);
		});
		await this.getJson(`rr_gcode?gcode=${encodeURIComponent(code)}`, "high");
		// Nudge the reply drain rather than waiting a full poll cycle
		await this.drainReply();
		// The drain above has ALREADY asked the board for whatever reply exists,
		// so a reply that was coming has arrived. Give it only a short grace for
		// one that lands just after, then resolve empty.
		//
		// This used to wait requestTimeoutMs (5s), conflating "how long an HTTP
		// request may take" with "how long a reply might take" - so every silent
		// command (M140, M106, M220 - most of them) left its caller hanging for
		// five seconds. Nothing awaited sendCode, so it stayed invisible until a
		// button tried to report when its command had actually landed.
		setTimeout(() => {
			this.replyWaiters = this.replyWaiters.filter(w => w !== settle);
			settle("");
		}, REPLY_GRACE_MS);
		return replyPromise;
	}

	/**
	 * Fire the e-stop straight at the board: no queue, no status gate, no
	 * backoff ladder. RRF tolerates the extra concurrent connection, and
	 * this is exactly the moment to spend it — M112 kills whatever the held
	 * slot was doing anyway. One transparent re-auth on a culled session
	 * (also unqueued), then re-fire; any other failure surfaces to the
	 * button, which honestly reports "failed" rather than pretending.
	 */
	private async sendEmergencyStop(code: string, retried: boolean): Promise<void> {
		const res = await fetch(`${this.base}/rr_gcode?gcode=${encodeURIComponent(code)}`, {
			headers: this.sessionKey !== null ? { "X-Session-Key": String(this.sessionKey) } : {},
			signal: AbortSignal.timeout(this.requestTimeoutMs),
		});
		if ((res.status === 401 || res.status === 403) && !retried) {
			const body = await (await this.fetchConnect()).json() as { err: number; sessionKey?: number };
			if (body.err === 0) this.sessionKey = body.sessionKey ?? null;
			return this.sendEmergencyStop(code, true);
		}
		if (!res.ok) throw new OperationFailedError(`emergency stop: HTTP ${res.status}`);
	}

	async upload(path: string, content: Uint8Array | string, onProgress?: (fraction: number) => void): Promise<void> {
		const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
		const checksum = crc32(bytes).toString(16).padStart(8, "0");
		const query = `rr_upload?name=${encodeURIComponent(path)}&crc32=${checksum}&time=${encodeURIComponent(isoNow())}`;
		// XHR, not fetch: only XHR reports upload-byte progress, and it takes the
		// long uploadTimeoutMs a multi-MB file needs (a poll's 5s would abort it).
		const body = await this.attemptUpload(query, bytes, onProgress, 0);
		if (body.err !== 0) throw new OperationFailedError(`upload of ${path} failed (err ${body.err} — CRC mismatch or write error)`);
	}

	/**
	 * One upload attempt through the queue. The 401-reauth / network-retry ladder
	 * is kept OUTSIDE the held slot: re-auth enqueues, and with a single slot,
	 * calling it from inside the upload's own slot would deadlock (same rule
	 * attemptRequest follows). A retry re-sends the whole file, which is safe —
	 * rr_upload overwrites and the CRC still matches.
	 */
	private async attemptUpload(
		path: string,
		bytes: Uint8Array,
		onProgress: ((fraction: number) => void) | undefined,
		retry: number,
	): Promise<{ err: number }> {
		let result: { status: number; text: string };
		try {
			result = await this.requests.enqueue(() => this.xhrPost(path, bytes, onProgress), "low");
		} catch (err) {
			if (retry < this.maxRetries) {
				await delay(this.retryDelayMs * (retry + 1));
				return this.attemptUpload(path, bytes, onProgress, retry + 1);
			}
			throw new OperationFailedError(`${path}: ${(err as Error).message}`);
		}
		if (result.status >= 200 && result.status < 300) {
			try { return JSON.parse(result.text) as { err: number }; }
			catch { return { err: 0 }; } // some firmware answers empty on success
		}
		if ((result.status === 401 || result.status === 403) && retry < this.maxRetries) {
			await this.openSessionDirect(); // outside the slot — safe
			return this.attemptUpload(path, bytes, onProgress, retry + 1);
		}
		throw new OperationFailedError(`${path}: HTTP ${result.status}`);
	}

	/**
	 * The POST itself, holding the queue slot for the transfer's duration (as the
	 * poll's fetch does — RRF tolerates one connection). Resolves with the raw
	 * status + body text; a network error or timeout rejects so the ladder retries.
	 */
	private xhrPost(path: string, bytes: Uint8Array, onProgress?: (fraction: number) => void): Promise<{ status: number; text: string }> {
		const headers: Record<string, string> = this.sessionKey !== null ? { "X-Session-Key": String(this.sessionKey) } : {};
		// Node (tests) has no XMLHttpRequest — fall back to fetch there. It just
		// loses the progress events, which are a browser-only UI nicety anyway;
		// upload correctness is exercised either way. Same uploadTimeoutMs as
		// the XHR path — the fallback once used the 5s request timeout, which
		// aborted any multi-MB upload (audit M4).
		if (typeof XMLHttpRequest === "undefined") {
			return fetch(`${this.base}/${path}`, {
				method: "POST",
				body: bytes as BodyInit,
				headers,
				signal: AbortSignal.timeout(this.uploadTimeoutMs),
			}).then(async res => ({ status: res.status, text: await res.text() }));
		}
		return new Promise((resolve, reject) => {
			const xhr = new XMLHttpRequest();
			xhr.open("POST", `${this.base}/${path}`);
			if (this.sessionKey !== null) xhr.setRequestHeader("X-Session-Key", String(this.sessionKey));
			xhr.timeout = this.uploadTimeoutMs;
			if (onProgress) {
				xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
			}
			xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
			xhr.onerror = () => reject(new Error("network error"));
			xhr.ontimeout = () => reject(new Error("timeout"));
			xhr.send(bytes as BufferSource);
		});
	}

	async download(path: string): Promise<string> {
		const res = await this.rawRequest(`rr_download?name=${encodeURIComponent(path)}`, undefined, "low");
		return res.text();
	}

	async list(dir: string): Promise<FileListEntry[]> {
		const entries: FileListEntry[] = [];
		let first = 0;
		for (;;) {
			const page = await this.getJson(`rr_filelist?dir=${encodeURIComponent(dir)}&first=${first}`, "low") as
				{ err?: number; files: Array<{ type: "d" | "f"; name: string; size: number; date?: string }>; next: number };
			if (page.err) throw new OperationFailedError(`rr_filelist err ${page.err} for ${dir}`);
			for (const f of page.files) {
				entries.push({ type: f.type, name: f.name, size: f.size, date: f.date });
			}
			if (!page.next) return entries;
			first = page.next;
		}
	}

	/**
	 * The mutating file operations. All three answer HTTP 200 with { err } in
	 * the body, so success has to be read from `err` — a connector that trusts
	 * the status code reports every failure as a success.
	 */
	async mkdir(path: string): Promise<void> {
		await this.fileOp(`rr_mkdir?dir=${encodeURIComponent(path)}`, `create ${path}`);
	}

	async move(from: string, to: string, overwrite = false): Promise<void> {
		await this.fileOp(
			`rr_move?old=${encodeURIComponent(from)}&new=${encodeURIComponent(to)}`
			+ `&deleteexisting=${overwrite ? "yes" : "no"}`,
			`move ${from} to ${to}`,
		);
	}

	async remove(path: string, recursive = false): Promise<void> {
		await this.fileOp(
			`rr_delete?name=${encodeURIComponent(path)}&recursive=${recursive ? "yes" : "no"}`,
			`delete ${path}`,
		);
	}

	private async fileOp(query: string, what: string): Promise<void> {
		const body = await this.getJson(query, "low") as { err?: number };
		if (body.err) throw new OperationFailedError(`could not ${what} (err ${body.err})`);
	}

	async getFileInfo(path: string): Promise<GcodeFileInfo> {
		const res = await this.getJson(`rr_fileinfo?name=${encodeURIComponent(path)}`, "low") as
			Partial<GcodeFileInfo> & { err?: number };
		if (res.err) throw new FileNotFoundError(path);
		return {
			fileName: res.fileName ?? path,
			size: res.size ?? 0,
			lastModified: res.lastModified,
			height: res.height,
			layerHeight: res.layerHeight,
			numLayers: res.numLayers,
			printTime: res.printTime,
			simulatedTime: res.simulatedTime,
			filament: res.filament ?? [],
			generatedBy: res.generatedBy ?? "",
			thumbnails: (res.thumbnails ?? []) as ThumbnailInfo[],
		};
	}

	async getThumbnail(path: string, offset: number): Promise<Uint8Array> {
		// rr_thumbnail returns base64 in `data` plus a `next` offset; loop until
		// next is 0, concatenating the base64 BEFORE decoding (chunk boundaries
		// are not guaranteed to fall on base64 quads). Mirrors the vendored
		// PollConnector.getThumbnails (reference/connectors/src/PollConnector.ts).
		let b64 = "";
		let cursor = offset;
		do {
			const res = await this.getJson(`rr_thumbnail?name=${encodeURIComponent(path)}&offset=${cursor}`, "low") as
				{ err?: number; data?: string; next?: number };
			if (res.err) throw new OperationFailedError(`rr_thumbnail err ${res.err} for ${path}`);
			b64 += res.data ?? "";
			cursor = res.next ?? 0;
		} while (cursor !== 0);
		const bin = atob(b64);
		const bytes = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
		return bytes;
	}

	// ---------- plumbing ----------

	private async drainReply(): Promise<void> {
		const res = await this.rawRequest("rr_reply", undefined, "high");
		const text = (await res.text()).trim();
		if (text === "") return;
		const waiters = this.replyWaiters;
		this.replyWaiters = [];
		for (const resolve of waiters) resolve(text);
		this.events.onReply?.(text);
	}

	/**
	 * Fetch a model key with RRF's edge cases applied on top of fetchKey:
	 * a verbose `move` fetch can truncate its axes array — at limits.reportedAxes
	 * (RRF >= 3.5; Gabe's 7-axis machine reports 5) or mid-array when the
	 * response buffer fills. We can't reliably know the axis total up front
	 * (limits may not be fetched yet, and the response order isn't guaranteed),
	 * so ALWAYS re-fetch move.axes as its own chunked array — it is authoritative
	 * and cheap since `move` is a rarely-changing subtree. Regression: on the
	 * real board the Machine view showed only 5 axes (W and C missing) because
	 * the earlier reportedAxes gate misfired when move was fetched before limits.
	 */
	private async fetchModelKey(key: string): Promise<unknown> {
		const value = await this.fetchKey(key);
		if (key === "move" && isRecord(value) && Array.isArray(value.axes)) {
			value.axes = await this.fetchKey("move.axes");
		}
		return value;
	}

	// ---------- layer history (see layerSource doc) ----------

	/**
	 * Digest one tick's model data (a live patch, or a job subtree wrapped
	 * as { job }) into the mode-appropriate layer source. Total: absent or
	 * mis-shaped fields cost precision, never a throw into the poll loop.
	 */
	private trackLayers(data: Record<string, unknown>): void {
		const job = isRecord(data.job) ? data.job : undefined;
		if (job === undefined) return;
		if (this.layerSource === null || (this.layerSource.mode === "dsf") !== this.emulated) {
			this.layerSource = this.emulated
				? { mode: "dsf", lastLayer: null }
				: { mode: "synth", history: createLayerHistory() };
		}
		if (this.layerSource.mode === "synth") {
			const changed = this.layerSource.history.observe(layerObservationOf(data, job));
			if (changed !== null) this.events.onJobLayers?.(changed);
			return;
		}
		// DSF mode: the Pi already keeps the real history — re-fetch it once
		// per observed layer change (layers change on a minutes cadence).
		if (typeof job.duration !== "number") {
			this.layerSource.lastLayer = null;
			return;
		}
		const layer = typeof job.layer === "number" ? job.layer : null;
		if (layer !== null && layer !== this.layerSource.lastLayer) {
			this.layerSource.lastLayer = layer;
			void this.fetchDsfLayers();
		}
	}

	/**
	 * DSF's own model (GET /machine/model) carries the genuine job.layers
	 * the rr_ emulation omits. Enrichment only: any failure keeps the last
	 * good history and never disturbs the poll.
	 */
	private async fetchDsfLayers(): Promise<void> {
		try {
			const res = await this.rawRequest("machine/model", undefined, "low");
			const body = await res.json() as unknown;
			const job = isRecord(body) && isRecord(body.job) ? body.job : undefined;
			if (job !== undefined && Array.isArray(job.layers)) {
				this.events.onJobLayers?.(job.layers.filter(isRecord));
			}
		} catch {
			// keep last good
		}
	}

	/** Fetch one whole subtree, stitching chunked arrays (a<offset>/next). */
	private async fetchKey(key: string): Promise<unknown> {
		let result: unknown = null;
		let next = 0;
		do {
			const chunkFlags = next !== 0 || Array.isArray(result) ? `a${next}` : "";
			const response = await this.getJson(`rr_model?key=${encodeURIComponent(key)}&flags=d99vno${chunkFlags}`) as
				{ result: unknown; next?: number };
			next = response.next ?? 0;
			result = Array.isArray(result) ? result.concat(response.result) : response.result;
		} while (next !== 0);
		return result;
	}

	private async getJson(path: string, priority: RequestPriority = "normal"): Promise<any> {
		const res = await this.rawRequest(path, undefined, priority);
		return res.json();
	}

	/**
	 * Serialized fetch with the vendored connector's recovery ladder:
	 * 503 → drain a possibly-blocking reply once, then delayed retries;
	 * 401/403 → transparent re-auth and replay; 404 → FileNotFound;
	 * network error → delayed retries until maxRetries.
	 */
	private rawRequest(
		path: string,
		init?: { method?: string; body?: Uint8Array },
		priority: RequestPriority = "normal",
	): Promise<Response> {
		return this.attemptRequest(path, init, 0, priority);
	}

	private async attemptRequest(
		path: string,
		init: { method?: string; body?: Uint8Array } | undefined,
		retry: number,
		priority: RequestPriority,
	): Promise<Response> {
		let res: Response;
		try {
			// Only the fetch holds a slot. Everything below (backoff, reply drain,
			// re-auth) runs outside it, so recovery never blocks the heartbeat.
			res = await this.requests.enqueue(() => fetch(`${this.base}/${path}`, {
				method: init?.method ?? "GET",
				body: init?.body as BodyInit | undefined,
				headers: this.sessionKey !== null ? { "X-Session-Key": String(this.sessionKey) } : {},
				signal: AbortSignal.timeout(this.requestTimeoutMs),
			}), priority);
		} catch (err) {
			if (retry < this.maxRetries) {
				await delay(this.retryDelayMs * (retry + 1));
				return this.attemptRequest(path, init, retry + 1, priority);
			}
			throw new OperationFailedError(`${path}: ${(err as Error).message}`);
		}

		if (res.ok) return res;

		if (res.status === 503 && retry < this.maxRetries) {
			if (retry === 0 && !path.startsWith("rr_reply")) {
				// RRF may be out of output buffers because an unread reply is
				// blocking (original :180-190): drain it, then retry
				try { await this.drainReplyDirect(); } catch { /* retry anyway */ }
			} else {
				await delay(this.retryDelayMs * (retry + 1));
			}
			return this.attemptRequest(path, init, retry + 1, priority);
		}
		if ((res.status === 401 || res.status === 403) && !path.startsWith("rr_connect")) {
			// Session was culled (idle timeout, reboot, another client):
			// re-auth with the stored password and replay (original :202-224)
			await this.openSessionDirect();
			return this.attemptRequest(path, init, retry + 1, priority);
		}
		if (res.status === 404) throw new FileNotFoundError(path);
		throw new OperationFailedError(`${path}: HTTP ${res.status}`);
	}

	/**
	 * Recovery drain of rr_reply. Goes through the queue at high priority: it is
	 * unblocking the board's output buffers, so everything else can wait. (Safe
	 * to enqueue — unlike the old promise chain, callers hold no slot here.)
	 */
	private async drainReplyDirect(): Promise<void> {
		const res = await this.requests.enqueue(() => fetch(`${this.base}/rr_reply`, {
			headers: this.sessionKey !== null ? { "X-Session-Key": String(this.sessionKey) } : {},
			signal: AbortSignal.timeout(this.requestTimeoutMs),
		}), "high");
		const text = (await res.text()).trim();
		if (text === "") return;
		const waiters = this.replyWaiters;
		this.replyWaiters = [];
		for (const resolve of waiters) resolve(text);
		this.events.onReply?.(text);
	}

	/** The bare rr_connect fetch — shared by the queued re-auth and the
	 *  emergency path's unqueued one, so the auth form exists once. */
	private fetchConnect(): Promise<Response> {
		return fetch(
			`${this.base}/rr_connect?password=${encodeURIComponent(this.password)}&time=${encodeURIComponent(isoNow())}&sessionKey=yes`,
			{ signal: AbortSignal.timeout(this.requestTimeoutMs) },
		);
	}

	/** Re-auth after a culled session. High priority: nothing else can proceed. */
	private async openSessionDirect(): Promise<void> {
		const res = await this.requests.enqueue(() => this.fetchConnect(), "high");
		const body = await res.json() as { err: number; sessionKey?: number };
		if (body.err !== 0) throw new InvalidPasswordError();
		this.sessionKey = body.sessionKey ?? null;
	}

	private setStatus(status: ConnectionStatus, detail?: string): void {
		if (this.status === status) return;
		this.status = status;
		this.events.onStatusChange?.(status, detail);
	}

	private stopTimers(): void {
		if (this.pollTimer !== null) clearTimeout(this.pollTimer);
		if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
		this.pollTimer = null;
		this.reconnectTimer = null;
	}
}

function isoNow(): string {
	return new Date().toISOString().slice(0, 19);
}

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/** Tolerantly lift one tick's raw model data into a synthesis observation. */
function layerObservationOf(data: Record<string, unknown>, job: Record<string, unknown>): LayerObservation {
	const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
	const move = isRecord(data.move) ? data.move : undefined;
	const heat = isRecord(data.heat) ? data.heat : undefined;
	const file = isRecord(job.file) ? job.file : undefined;
	const axes = Array.isArray(move?.axes) ? move.axes : [];
	const zAxis = axes.find(a => isRecord(a) && a.letter === "Z");
	const extruders = Array.isArray(move?.extruders) ? move.extruders : [];
	const heaters = Array.isArray(heat?.heaters) ? heat.heaters : [];
	return {
		duration: num(job.duration),
		layer: num(job.layer),
		warmUpDuration: num(job.warmUpDuration),
		filePosition: num(job.filePosition),
		fileSize: num(file?.size),
		zPosition: isRecord(zAxis) ? num(zAxis.userPosition) : null,
		rawExtrusion: extruders.map(e => (isRecord(e) ? num(e.rawPosition) ?? 0 : 0)),
		temperatures: heaters.map(h => (isRecord(h) ? num(h.current) ?? 0 : 0)),
	};
}

function pickNumbers(source: Record<string, unknown>): Record<string, number> {
	const out: Record<string, number> = {};
	// safeEntries: source is the board's raw seqs object; a hostile key must
	// not become a store path or an rr_model key= parameter.
	for (const [k, v] of safeEntries(source)) {
		if (typeof v === "number") out[k] = v;
	}
	return out;
}
