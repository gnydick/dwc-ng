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
 * Callers must also keep retry backoff OUTSIDE a slot (re-enqueue instead of
 * sleeping while holding it), or one retrying request starves everything.
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
