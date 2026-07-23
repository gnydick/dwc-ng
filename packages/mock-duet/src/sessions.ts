/**
 * rr_connect session bookkeeping. Mirrors RRF behaviour:
 *  - a fixed number of concurrent sessions (err 2 when exhausted)
 *  - sessions expire if not touched within sessionTimeout
 *  - each session has its own G-code reply buffer; replies not fetched
 *    promptly are discarded (RRF drops them ~1 s after completion)
 */
export interface Session {
	key: number;
	lastSeen: number;
	replies: { text: string; expiresAt: number }[];
	/** Open WebSockets holding this session; > 0 exempts it from idle sweep. */
	pins: number;
}

export interface SessionOptions {
	maxSessions: number;
	sessionTimeout: number;
	replyExpiryMs: number;
}

export class SessionManager {
	private sessions = new Map<number, Session>();
	private nextKey = 0x1001;
	private opts: SessionOptions;

	constructor(opts: SessionOptions) {
		this.opts = opts;
	}

	get sessionTimeout(): number {
		return this.opts.sessionTimeout;
	}

	/** Returns a new session, or null if all slots are taken. */
	connect(): Session | null {
		this.sweep();
		if (this.sessions.size >= this.opts.maxSessions) return null;
		const session: Session = { key: this.nextKey++, lastSeen: Date.now(), replies: [], pins: 0 };
		this.sessions.set(session.key, session);
		return session;
	}

	/** Look up and touch a session; expired/unknown keys return null. */
	get(key: number): Session | null {
		this.sweep();
		const session = this.sessions.get(key);
		if (session === undefined) return null;
		session.lastSeen = Date.now();
		return session;
	}

	/**
	 * Resolve an X-Session-Key request header. The ONE place header text
	 * becomes a session — both the rr_ and /machine dialects go through it.
	 */
	fromHeader(value: string | string[] | undefined): Session | null {
		if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
		return this.get(parseInt(value, 10));
	}

	/**
	 * Bind a session to an open WebSocket: pinned sessions never idle-expire
	 * (design D11 "sessions holding a WS never idle-expire"). Counted, not
	 * boolean, so two sockets sharing a key don't unpin each other early.
	 * Returns false for unknown/expired keys — the caller must not assume.
	 */
	pin(key: number): boolean {
		const session = this.get(key);
		if (session === null) return false;
		session.pins++;
		return true;
	}

	/** Release one WS binding; the idle clock restarts from now. */
	unpin(key: number): void {
		const session = this.sessions.get(key);
		if (session === undefined) return;
		session.pins = Math.max(0, session.pins - 1);
		session.lastSeen = Date.now();
	}

	disconnect(key: number): void {
		this.sessions.delete(key);
	}

	/** Broadcast a G-code reply to every live session's buffer. */
	pushReply(text: string): void {
		const expiresAt = Date.now() + this.opts.replyExpiryMs;
		for (const session of this.sessions.values()) {
			session.replies.push({ text, expiresAt });
		}
	}

	/** Drain a session's reply buffer (unread expired entries are dropped). */
	takeReplies(session: Session): string {
		const now = Date.now();
		const fresh = session.replies.filter(r => r.expiresAt > now);
		session.replies = [];
		return fresh.map(r => r.text).join("\n");
	}

	clear(): void {
		this.sessions.clear();
	}

	get size(): number {
		this.sweep();
		return this.sessions.size;
	}

	private sweep(): void {
		const cutoff = Date.now() - this.opts.sessionTimeout;
		for (const [key, session] of this.sessions) {
			if (session.pins === 0 && session.lastSeen < cutoff) this.sessions.delete(key);
		}
	}
}
