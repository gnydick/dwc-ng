/**
 * Priority request queue for RRF's embedded HTTP server.
 *
 * CLAUDE.md hard constraint #1: the board tolerates very few concurrent
 * connections and each request is expensive. Requests were already serialized
 * (a promise chain), but strictly FIFO — so bulk file I/O (a download, a
 * thumbnail chunk loop, filelist pagination) queued *ahead* of the poll
 * heartbeat and stalled the live view.
 *
 * So: still at most `concurrency` in flight, but ordered. The poll is the
 * heartbeat and user commands must feel immediate; file I/O is bulk and yields.
 *
 * @invariant bulk-io-yields-to-the-heartbeat
 * @rung 6  choke-point — one queue, one ORDER map, and a concurrency cap that
 *          no caller can raise per-request. Priority defaults to "normal", so
 *          a new request cannot accidentally outrank the poll; it can only
 *          under-rank itself by asking for "low"
 * @why CLAUDE.md's first hard constraint: the board tolerates very few
 *      concurrent connections and each request is expensive. Strict FIFO put a
 *      thumbnail chunk loop and filelist pagination AHEAD of the poll
 *      heartbeat, so opening a file browser froze the live view
 *
 * @invariant backoff-outside-the-slot
 * @rung 0  a sentence, and it says "callers must" — which by this project's own
 *          rule means this module has no mechanism for it at all. A caller that
 *          sleeps while holding a slot starves every other request, and nothing
 *          here can observe that it happened
 * @why one retrying request holding its slot through the backoff is
 *      indistinguishable, from inside the queue, from one request that is
 *      merely slow — so the queue drains to nothing while appearing healthy
 * @debt this is a caller precondition in prose (the anti-pattern), and it was
 *       caught by this repo's own red-flag lint rather than by review.
 *
 *       INSPECTED 2026-08-01, and the honest finding is that the queue CANNOT
 *       enforce this from inside — its own @why says why: a job sleeping in its
 *       slot and a job that is merely slow are the same observation. So a
 *       runtime check is out, and no type can see an await.
 *
 *       What is actually wrong is upstream: PollConnector carries TWO retry
 *       ladders, attemptRequest and attemptUpload, with the same
 *       `delay(retryDelayMs * (retry + 1))`, the same `retry < maxRetries`
 *       guard and the same recursion, differing only in the request they wrap.
 *       Both happen to back off outside the slot; nothing makes the third one
 *       do so. The promotion is therefore to give the QUEUE the retry loop —
 *       it releases between attempts by construction — and have both ladders
 *       become policy arguments to it. Deferred deliberately: that rewrites the
 *       connector's recovery path, whose behaviour against a real board (503
 *       reply-drain on the first retry, 401 re-auth, whole-file re-send) is
 *       only provable on hardware. Filed in DEBT.md as
 *       `two-retry-ladders-in-the-connector`.
 */

/** high: user commands · normal: the poll heartbeat · low: bulk file I/O. */
export type RequestPriority = "high" | "normal" | "low";

const ORDER: Record<RequestPriority, number> = { high: 0, normal: 1, low: 2 };

interface Job {
	run: () => void;
	priority: RequestPriority;
	/** Tiebreaker so equal priorities stay FIFO. */
	seq: number;
}

export class RequestQueue {
	private readonly concurrency: number;
	private readonly waiting: Job[] = [];
	private active = 0;
	private seq = 0;

	constructor(concurrency = 1) {
		this.concurrency = Math.max(1, concurrency);
	}

	/** Jobs waiting for a slot (excludes in-flight). */
	get pending(): number {
		return this.waiting.length;
	}

	/** Queue `fn`; resolves/rejects with its result once a slot frees up. */
	enqueue<T>(fn: () => Promise<T>, priority: RequestPriority = "normal"): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const job: Job = {
				priority,
				seq: this.seq++,
				run: () => {
					this.active++;
					fn().then(resolve, reject).finally(() => {
						this.active--;
						this.dispatch();
					});
				},
			};
			this.insert(job);
			this.dispatch();
		});
	}

	/** Keep `waiting` ordered by priority, then FIFO within a priority. */
	private insert(job: Job): void {
		const rank = (j: Job): number => ORDER[j.priority];
		let i = this.waiting.length;
		while (i > 0 && rank(this.waiting[i - 1]!) > rank(job)) i--;
		this.waiting.splice(i, 0, job);
	}

	private dispatch(): void {
		while (this.active < this.concurrency && this.waiting.length > 0) {
			this.waiting.shift()!.run();
		}
	}
}
