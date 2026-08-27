/**
 * The board session a connector holds, as ONE value that owns both halves of
 * its own lifetime.
 *
 * Why this module exists (GIT_110). Acquiring a session and releasing the one
 * it replaces were two separately expressible operations, so at one call site
 * — `DsfConnector.openSession`, and `PollConnector.beginReconnect` beside it —
 * only the first half was written. Every trip round a reconnect ladder took a
 * fresh slot on the board and abandoned the previous one to idle out. Against
 * mock-duet's own defaults (4 slots, 8 s idle, a 2 s ladder) the connector
 * starved itself out of the resource it needs to reconnect after three
 * attempts, observed end to end in test/dsf-connector.test.ts and
 * test/connector.test.ts. On RRF, whose embedded server has FEWER connections
 * (CLAUDE.md, hard constraints), it is worse.
 *
 * The fix is not a second call beside the first. The key lives behind a `#`
 * private field with no setter, so the only expressions that can change it are
 * the two routes below — and the ordinary one releases before it opens.
 *
 * @invariant session-replacement-releases
 * @rung 7  sole-constructor/sealed-field. `#key` is a JS private field with no
 *          setter and no other writer in the module, so "take a new session
 *          without releasing the old one" is not an expression a caller can
 *          write — outside this file it is a compile error AND a runtime
 *          TypeError. The one route that legitimately skips the goodbye,
 *          `reauth`, demands a `SessionRefusal`, a branded token whose sole
 *          constructor returns null for any status other than 401/403: a
 *          caller with no refusing response cannot reach that route at all.
 *          Both routes serialize on one internal chain, so two callers racing
 *          (a Connect click landing on top of a ladder attempt) cannot each
 *          open a session and leave one of them unowned. A goodbye that cannot
 *          be delivered is kept, not forgotten, so the next attempt on a live
 *          link still frees the board's slot.
 * @why a connector that leaks a slot per reconnect attempt starves itself off
 *      the machine and cannot recover on its own — and the number of slots on
 *      the target hardware is four, or fewer
 */

/**
 * Ceiling on a session goodbye. A reconnect waits behind it, so it is capped
 * well under a request budget; each connector takes the smaller of this and
 * its own requestTimeoutMs, so a connector configured to be impatient stays
 * impatient here too. One value, named once — the two connectors import it
 * rather than each carrying a copy that could drift.
 */
export const GOODBYE_TIMEOUT_MS = 1000;

/** A key this slot holds, and how to hand it back to the board. */
export type ReleaseSession<K> = (key: K) => Promise<unknown>;

declare const REFUSAL: unique symbol;

/**
 * Proof that the board has just REFUSED the key we were holding — the only
 * circumstance in which replacing a session without a goodbye is honest,
 * because the board has already freed the slot itself. Opaque and mintable
 * only from a refusing status, so it cannot be conjured at a call site that
 * simply does not feel like saying goodbye.
 */
export type SessionRefusal = { readonly [REFUSAL]: never };

/** A refusal token for 401/403, and null — meaning "not a refusal" — for
 *  every other status. The sole constructor of `SessionRefusal`. */
export function sessionRefusal(status: number): SessionRefusal | null {
	if (status !== 401 && status !== 403) return null;
	return {} as SessionRefusal;
}

/**
 * Did the goodbye actually reach the board?
 *
 * A resolved fetch is NOT the question. Measured in the real UI (GIT_110 mock
 * UAT): with the link down, vite's dev proxy answers the goodbye with its own
 * 502, and a proxy, a reverse proxy or DuetWebServer will do the same on a
 * real deployment. Treating that as "delivered" forgets the key and leaves the
 * board holding the slot — the leak, wearing a 502.
 *
 * 5xx means something between us and the session table failed, so the session
 * is still there and the key is still owed. Anything below that means the far
 * end ANSWERED: 2xx accepted the goodbye, and 401/403/404 say the session is
 * already gone, which frees the slot just as well.
 */
export function assertGoodbyeDelivered(res: { status: number }): void {
	if (res.status >= 500) throw new Error(`session goodbye not delivered: HTTP ${res.status}`);
}

export class SessionSlot<K> {
	#key: K | null = null;
	/** A key whose goodbye could not be delivered, kept for the next attempt. */
	#owed: K | null = null;
	/** Serializes acquire/release so two callers cannot interleave halves. */
	#chain: Promise<unknown> = Promise.resolve();
	readonly #release: ReleaseSession<K>;

	constructor(release: ReleaseSession<K>) {
		this.#release = release;
	}

	/** The key currently held, or null when this slot holds no session. */
	get key(): K | null {
		return this.#key;
	}

	/**
	 * Take a new session. The key being replaced is handed back FIRST and the
	 * goodbye is waited for, so the ladder can never ask for a slot faster
	 * than the board can free the one the last attempt used (GIT_110
	 * requirement 4). Best effort in both directions: a goodbye that fails on
	 * a dead network is swallowed, and the caller's `open` runs regardless —
	 * the wait is bounded by whatever budget the release closure gives its own
	 * request, never by the network's patience.
	 *
	 * If `open` throws, the slot is left EMPTY rather than holding a key the
	 * caller never got — the old one has been handed back, or is owed and will
	 * be handed back by the next attempt that reaches a live board.
	 */
	acquire(open: () => Promise<K | null>): Promise<void> {
		return this.#serialize(async () => {
			await this.#handBack();
			this.#key = await open();
		});
	}

	/**
	 * Take a new session after the board refused the one we held. No goodbye:
	 * a 401/403 IS the board telling us that key is gone, so asking it to free
	 * the slot again is a request that costs a weak server something and frees
	 * nothing. The `refusal` argument is what keeps this from being a way to
	 * skip the goodbye in general.
	 */
	reauth(_refusal: SessionRefusal, open: () => Promise<K | null>): Promise<void> {
		return this.#serialize(async () => {
			this.#key = null;
			this.#key = await open();
		});
	}

	/** Hand the session back and hold nothing. Failure is accepted: an
	 *  undelivered goodbye leaves the board to idle the session out. */
	release(): Promise<void> {
		return this.#serialize(() => this.#handBack());
	}

	async #handBack(): Promise<void> {
		const held = this.#key;
		// Cleared BEFORE the await: a caller that observes the slot mid-goodbye
		// must not find a key that is already being given away.
		this.#key = null;
		const owed = this.#owed;
		this.#owed = null;
		// Oldest first. At most two: whatever a previous attempt could not
		// deliver, and the key being replaced now.
		for (const key of [owed, held]) {
			if (key === null) continue;
			try {
				await this.#release(key);
			} catch {
				// Undeliverable. Best effort does NOT mean forgotten: keep it
				// for the next attempt, which may land on a live link. Measured
				// on the real UI (GIT_110 mock UAT): a flapping link fails the
				// goodbye and the connect together, and a key dropped at that
				// point is a board slot gone until the idle sweep — one per
				// reconnect, which is the starvation this ticket is about.
				// Only ONE is kept: owing two needs a link that came back
				// between two adjacent requests, and the board's idle sweep is
				// the backstop for the one that is dropped. That bound is what
				// keeps a goodbye from costing a weak server an unbounded
				// number of requests per attempt.
				this.#owed = key;
			}
		}
	}

	#serialize<T>(op: () => Promise<T>): Promise<T> {
		const next = this.#chain.then(op, op);
		this.#chain = next.then(() => undefined, () => undefined);
		return next;
	}
}
