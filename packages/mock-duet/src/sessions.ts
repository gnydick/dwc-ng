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
		const session: Session = { key: this.nextKey++, lastSeen: Date.now(), replies: [] };
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
			if (session.lastSeen < cutoff) this.sessions.delete(key);
		}
	}
}
