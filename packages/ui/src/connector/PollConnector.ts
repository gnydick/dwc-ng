import {
	type Connector, type ConnectorEvents, type ConnectionStatus, type FileListEntry,
	type GcodeFileInfo, type ThumbnailInfo,
	InvalidPasswordError, NoFreeSessionError, FileNotFoundError,
	OperationFailedError, DisconnectedError,
} from "./types.ts";
import { crc32 } from "./crc32.ts";

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

export class PollConnector implements Connector {
	status: ConnectionStatus = "disconnected";

	private readonly base: string;
	private readonly password: string;
	private readonly pollIntervalMs: number;
	private readonly retryDelayMs: number;
	private readonly maxRetries: number;
	private readonly requestTimeoutMs: number;
	private readonly autoPoll: boolean;
	private readonly events: ConnectorEvents;

	private sessionKey: number | null = null;
	private lastSeqs: Record<string, number> = {};
	private lastVolSeqs: number[] = [];
	/** limits.reportedAxes — RRF's cap on axes inlined in a `move` fetch. */
	private reportedAxes = 9;
	private pollTimer: ReturnType<typeof setTimeout> | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	/** Serializes all traffic: RRF handles very few concurrent connections. */
	private queue: Promise<unknown> = Promise.resolve();
	/** sendCode() calls waiting for the next non-empty reply. */
	private replyWaiters: Array<(text: string) => void> = [];

	constructor(options: PollConnectorOptions = {}) {
		this.base = options.baseUrl ?? "";
		this.password = options.password ?? "";
		this.pollIntervalMs = options.pollIntervalMs ?? 500;
		this.retryDelayMs = options.retryDelayMs ?? 200;
		this.maxRetries = options.maxRetries ?? 4;
		this.requestTimeoutMs = options.requestTimeoutMs ?? 5000;
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
				await this.rawRequest("rr_disconnect");
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
		const body = await res.json() as { err: number; sessionKey?: number };
		if (body.err === 1) throw new InvalidPasswordError();
		if (body.err === 2) throw new NoFreeSessionError();
		if (body.err !== 0) throw new OperationFailedError(`rr_connect err ${body.err}`);
		this.sessionKey = body.sessionKey ?? null;
	}

	/** Fetch seqs then every model key, emitting wholesale replacements. */
	private async fullSync(): Promise<void> {
		const seqs = (await this.getJson(`rr_model?key=seqs`)).result as Record<string, unknown>;
		const keys = Object.keys(seqs).filter(k => !NON_MODEL_SEQS.has(k) && !SKIPPED_KEYS.has(k));
		for (const key of keys) {
			const value = await this.fetchModelKey(key);
			this.events.onModelKey?.(key, value);
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
		if (this.status !== "connected") throw new DisconnectedError();
		const replyPromise = new Promise<string>(resolve => {
			this.replyWaiters.push(resolve);
			// Replies are best-effort: resolve "" if nothing arrives in time
			setTimeout(() => {
				this.replyWaiters = this.replyWaiters.filter(w => w !== resolve);
				resolve("");
			}, this.requestTimeoutMs);
		});
		await this.getJson(`rr_gcode?gcode=${encodeURIComponent(code)}`);
		// Nudge the reply drain rather than waiting a full poll cycle
		await this.drainReply();
		return replyPromise;
	}

	async upload(path: string, content: Uint8Array | string): Promise<void> {
		const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
		const checksum = crc32(bytes).toString(16).padStart(8, "0");
		const res = await this.rawRequest(
			`rr_upload?name=${encodeURIComponent(path)}&crc32=${checksum}&time=${encodeURIComponent(isoNow())}`,
			{ method: "POST", body: bytes },
		);
		const body = await res.json() as { err: number };
		if (body.err !== 0) throw new OperationFailedError(`upload of ${path} failed (err ${body.err} — CRC mismatch or write error)`);
	}

	async download(path: string): Promise<string> {
		const res = await this.rawRequest(`rr_download?name=${encodeURIComponent(path)}`);
		return res.text();
	}

	async list(dir: string): Promise<FileListEntry[]> {
		const entries: FileListEntry[] = [];
		let first = 0;
		for (;;) {
			const page = await this.getJson(`rr_filelist?dir=${encodeURIComponent(dir)}&first=${first}`) as
				{ err?: number; files: Array<{ type: "d" | "f"; name: string; size: number; date?: string }>; next: number };
			if (page.err) throw new OperationFailedError(`rr_filelist err ${page.err} for ${dir}`);
			for (const f of page.files) {
				entries.push({ type: f.type, name: f.name, size: f.size, date: f.date });
			}
			if (!page.next) return entries;
			first = page.next;
		}
	}

	async getFileInfo(path: string): Promise<GcodeFileInfo> {
		const res = await this.getJson(`rr_fileinfo?name=${encodeURIComponent(path)}`) as
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
			const res = await this.getJson(`rr_thumbnail?name=${encodeURIComponent(path)}&offset=${cursor}`) as
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
		const res = await this.rawRequest("rr_reply");
		const text = (await res.text()).trim();
		if (text === "") return;
		const waiters = this.replyWaiters;
		this.replyWaiters = [];
		for (const resolve of waiters) resolve(text);
		this.events.onReply?.(text);
	}

	/**
	 * Fetch a model key with RRF's edge cases applied on top of fetchKey:
	 * since RRF 3.5, a `move` fetch inlines at most limits.reportedAxes axes
	 * (his 7-axis machine reports 5!) — when the cap is hit, re-fetch
	 * "move.axes" as its own chunked array, like the original does
	 * (reference PollConnector.ts:518,576).
	 */
	private async fetchModelKey(key: string): Promise<unknown> {
		const value = await this.fetchKey(key);
		if (key === "limits" && isRecord(value) && typeof value.reportedAxes === "number") {
			this.reportedAxes = value.reportedAxes;
		}
		if (key === "move" && isRecord(value) && Array.isArray(value.axes) && value.axes.length >= this.reportedAxes) {
			value.axes = await this.fetchKey("move.axes");
		}
		return value;
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

	private async getJson(path: string): Promise<any> {
		const res = await this.rawRequest(path);
		return res.json();
	}

	/**
	 * Serialized fetch with the vendored connector's recovery ladder:
	 * 503 → drain a possibly-blocking reply once, then delayed retries;
	 * 401/403 → transparent re-auth and replay; 404 → FileNotFound;
	 * network error → delayed retries until maxRetries.
	 */
	private rawRequest(path: string, init?: { method?: string; body?: Uint8Array }): Promise<Response> {
		const run = () => this.attemptRequest(path, init, 0);
		const chained = this.queue.then(run, run);
		this.queue = chained.catch(() => undefined); // keep the chain alive on failure
		return chained;
	}

	private async attemptRequest(path: string, init: { method?: string; body?: Uint8Array } | undefined, retry: number): Promise<Response> {
		let res: Response;
		try {
			res = await fetch(`${this.base}/${path}`, {
				method: init?.method ?? "GET",
				body: init?.body as BodyInit | undefined,
				headers: this.sessionKey !== null ? { "X-Session-Key": String(this.sessionKey) } : {},
				signal: AbortSignal.timeout(this.requestTimeoutMs),
			});
		} catch (err) {
			if (retry < this.maxRetries) {
				await delay(this.retryDelayMs * (retry + 1));
				return this.attemptRequest(path, init, retry + 1);
			}
			throw new OperationFailedError(`${path}: ${(err as Error).message}`);
		}

		if (res.ok) return res;

		if (res.status === 503 && retry < this.maxRetries) {
			if (retry === 0 && !path.startsWith("rr_reply")) {
				// RRF may be out of output buffers because an unread reply is
				// blocking (original :180-190): drain it, then retry
				try { await this.drainReplyUnqueued(); } catch { /* retry anyway */ }
			} else {
				await delay(this.retryDelayMs * (retry + 1));
			}
			return this.attemptRequest(path, init, retry + 1);
		}
		if ((res.status === 401 || res.status === 403) && !path.startsWith("rr_connect")) {
			// Session was culled (idle timeout, reboot, another client):
			// re-auth with the stored password and replay (original :202-224)
			await this.openSessionUnqueued();
			return this.attemptRequest(path, init, retry + 1);
		}
		if (res.status === 404) throw new FileNotFoundError(path);
		throw new OperationFailedError(`${path}: HTTP ${res.status}`);
	}

	/** rr_reply outside the queue (we're already inside a queued request). */
	private async drainReplyUnqueued(): Promise<void> {
		const res = await fetch(`${this.base}/rr_reply`, {
			headers: this.sessionKey !== null ? { "X-Session-Key": String(this.sessionKey) } : {},
			signal: AbortSignal.timeout(this.requestTimeoutMs),
		});
		const text = (await res.text()).trim();
		if (text === "") return;
		const waiters = this.replyWaiters;
		this.replyWaiters = [];
		for (const resolve of waiters) resolve(text);
		this.events.onReply?.(text);
	}

	private async openSessionUnqueued(): Promise<void> {
		const res = await fetch(
			`${this.base}/rr_connect?password=${encodeURIComponent(this.password)}&time=${encodeURIComponent(isoNow())}&sessionKey=yes`,
			{ signal: AbortSignal.timeout(this.requestTimeoutMs) },
		);
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickNumbers(source: Record<string, unknown>): Record<string, number> {
	const out: Record<string, number> = {};
	for (const [k, v] of Object.entries(source)) {
		if (typeof v === "number") out[k] = v;
	}
	return out;
}
