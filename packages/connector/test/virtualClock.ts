/**
 * A virtual `Clock` for the connector tests.
 *
 * It lives in test/ rather than src/ on purpose: production has exactly one
 * clock (`realClock`), and the fake is not part of the package's surface. It
 * is also handed to ONE connector instance by that instance's constructor —
 * never installed globally — because `node --test` runs these files
 * concurrently and a swapped global would let two tests interfere
 * (cant-break-by-design A5.19).
 *
 * What it does NOT virtualize: the network. These tests drive a real
 * DsfConnector against a real in-process mock-duet over a real loopback
 * socket, so a reconnect still costs a few real milliseconds of I/O. Virtual
 * time removes the WAITING (deadlines, backoff, request budgets); it does not
 * remove the doing. That is why `advance()` yields to the real event loop
 * between timer firings — otherwise a PONG that is genuinely in flight would
 * never be read, and the liveness deadline would trip on a healthy socket.
 */
import type { Clock, TimerHandle } from "../src/clock.ts";

/**
 * Why two kinds. `schedule` is work this connector asked to happen later — a
 * poll, a PING interval, a reconnect attempt. `abort` is a request budget
 * handed to `fetch`, which has no completion callback to cancel it with (real
 * `AbortSignal.timeout` leaves the same dangling timer, unref'd). Only the
 * first kind can be "a timer left behind", so only the first kind is counted
 * by `pendingScheduled`.
 */
type Kind = "schedule" | "abort";

interface Entry {
	readonly id: number;
	readonly kind: Kind;
	/** Interval period, or null for a one-shot. */
	readonly every: number | null;
	at: number;
	readonly fn: () => void;
}

export interface VirtualClock extends Clock {
	/**
	 * Move time forward by `ms`, firing every timer that falls due in order,
	 * and yielding to the real event loop after each one so network I/O the
	 * callback started can actually happen.
	 */
	advance(ms: number): Promise<void>;
	/** Yield to the real event loop without moving virtual time. */
	settle(): Promise<void>;
	/** Live setTimeout/setInterval registrations. A leak check reads this. */
	pendingScheduled(): number;
	/** Human-readable dump of what is still armed, for assertion messages. */
	describePending(): string;
}

/**
 * One real turn of the loop.
 *
 * `setImmediate`, deliberately not `setTimeout(fn, 0)`. Windows' timer
 * resolution makes a zero-delay timeout cost ~15 ms of WALL time — measured
 * here at 3.06 s for 200 of them — so a settle built on it would have handed
 * back most of the seconds virtual time just saved. `setImmediate` fires in
 * the check phase immediately after poll, so I/O that has already arrived is
 * processed, and 200 of them cost 1 ms.
 */
function realTurn(): Promise<void> {
	return new Promise<void>(resolve => { setImmediate(resolve); });
}

export function createVirtualClock(start = 0): VirtualClock {
	const entries = new Map<number, Entry>();
	let nextId = 1;
	let now = start;

	const schedule = (kind: Kind, fn: () => void, ms: number, every: number | null): TimerHandle => {
		const id = nextId++;
		// Real timers clamp a sub-millisecond or negative delay to (at least)
		// the next turn; matching that keeps an interval from spinning forever
		// inside one advance().
		const delay = Number.isFinite(ms) && ms > 1 ? ms : 1;
		entries.set(id, { id, kind, every: every === null ? null : delay, at: now + delay, fn });
		return id as unknown as TimerHandle;
	};

	const cancel = (handle: TimerHandle | null): void => {
		if (handle !== null) entries.delete(handle as unknown as number);
	};

	const settle = async (): Promise<void> => {
		// Three turns rather than one: a callback that starts a fetch needs the
		// promise chain behind it to unwind before the next timer fires.
		await realTurn();
		await realTurn();
		await realTurn();
	};

	return {
		now: () => now,
		setTimeout: (fn, ms) => schedule("schedule", fn, ms, null),
		clearTimeout: cancel,
		setInterval: (fn, ms) => schedule("schedule", fn, ms, ms),
		clearInterval: cancel,
		sleep: ms => new Promise<void>(resolve => { schedule("schedule", resolve, ms, null); }),
		timeoutSignal: ms => {
			const ctl = new AbortController();
			schedule("abort", () => {
				ctl.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
			}, ms, null);
			return ctl.signal;
		},

		async advance(ms) {
			const target = now + ms;
			for (;;) {
				let next: Entry | null = null;
				for (const entry of entries.values()) {
					if (entry.at > target) continue;
					// Ties break by registration order, as a real loop does.
					if (next === null || entry.at < next.at || (entry.at === next.at && entry.id < next.id)) next = entry;
				}
				if (next === null) break;
				now = next.at;
				if (next.every !== null) next.at = now + next.every;
				else entries.delete(next.id);
				// A throw is deliberately NOT swallowed: on a real timer it
				// would be an uncaught exception, and a test that hides one is
				// worse than a test that fails.
				next.fn();
				await settle();
			}
			now = target;
			await settle();
		},

		settle,
		pendingScheduled: () => [...entries.values()].filter(e => e.kind === "schedule").length,
		describePending: () => [...entries.values()]
			.map(e => `#${e.id} ${e.kind}${e.every === null ? "" : ` every ${e.every}ms`} due at ${e.at} (now ${now})`)
			.join("; "),
	};
}
