/**
 * The connector's clock: the ONE module in this package allowed to name a
 * platform timer.
 *
 * Why this exists. Both connectors defer work — a poll cadence, a PING
 * interval, a liveness deadline, a reconnect delay, a request budget. Every
 * one of those was written straight against `setTimeout` / `setInterval` /
 * `Date.now` / `AbortSignal.timeout`, which meant a test that wanted to
 * observe a deadline had to genuinely wait it out: `test/dsf-connector.test.ts`
 * spent 12.9 s of a 15.1 s battery asleep, and those waits were tuned to a
 * quiet machine, so a loaded one could flake them.
 *
 * The seam follows the idiom this repo already uses for the same problem —
 * `packages/ui/src/shaping/procedure.ts`'s `RunOptions { signal, sleep, now }`,
 * which exists so a 10 s capture budget is assertable instantly. Same shape:
 * an OPTIONAL seam, THREADED through the constructor, defaulting to real time.
 * It is deliberately not a module-level mutable that a test swaps — `node
 * --test` runs these files concurrently, so a run-scoped global would let two
 * tests interfere (cant-break-by-design A5.19).
 *
 * @invariant clock-seam
 * @rung 4  static analysis with a compile-time layer on top, and the rung is
 *          the weaker of the two because it is the one with COMPLETE coverage.
 *          test/clock-fence.test.ts walks every file under src/ and fails, by
 *          file and line, on any direct platform-timer reference outside this
 *          module — including in a file nobody has written yet, which is the
 *          case no compile-time rule can reach. On top of that, every module
 *          that imports `realClock` carries a module-scoped `declare const
 *          setTimeout: never` prelude, so in the files where a developer would
 *          actually reach for a timer the mistake is a COMPILE ERROR, not a
 *          silent return to wall time; the fence checks that prelude is still
 *          present, and derives WHICH files owe it from their imports rather
 *          than from a hand-maintained list
 * @why a deferral that reaches the platform directly is neither observable nor
 *      assertable — the only way to test it is to wait it out, which is slow
 *      and, being tuned to a quiet machine, flaky. This is not hypothetical:
 *      test/dsf-connector.test.ts was 12.9 s of a 15.1 s battery, essentially
 *      all of it asleep, and one timer written the old way puts it back there
 * @debt Two things, both named rather than left to be found. (1) The promotion
 *       that would close this properly is making the platform timers
 *       UNNAMEABLE in this package — drop the timer declarations from the
 *       connector tsconfig's lib and re-declare only what src actually uses,
 *       which turns every file into a compile error by default and retires the
 *       walk. CLAUDE.md already records that surface as large and fragile from
 *       the parallel attempt to shadow `fetch`, so it is filed, not attempted.
 *       (2) One gap the fence does not cover: PollConnector.xhrPost sets
 *       `xhr.timeout`, XMLHttpRequest's own budget. It is not a scheduling
 *       call, there is no clock-driven substitute short of reimplementing XHR,
 *       and the path is browser-only (Node has no XMLHttpRequest, so no test
 *       reaches it). It stays on wall time and is listed here so that is a
 *       decision rather than an oversight.
 */

declare const TIMER: unique symbol;

/**
 * A scheduling receipt. Opaque on purpose: the underlying value is a number in
 * a browser and a `Timeout` object under Node, and nothing outside this module
 * should be able to tell — or to hand a raw number to `clearTimeout` and have
 * it mean something.
 */
export type TimerHandle = { readonly [TIMER]: never };

/**
 * Everything the connectors need from time, and nothing else.
 *
 * `timeoutSignal` is here rather than left as `AbortSignal.timeout(ms)` at the
 * call sites because a request budget is a deferral like any other: leaving it
 * on wall time is what made "the server accepted the socket and then said
 * nothing" cost 9 s of real waiting in the suite.
 */
export interface Clock {
	/** Milliseconds on this clock's timeline. Only differences are meaningful. */
	now(): number;
	setTimeout(fn: () => void, ms: number): TimerHandle;
	clearTimeout(handle: TimerHandle | null): void;
	setInterval(fn: () => void, ms: number): TimerHandle;
	clearInterval(handle: TimerHandle | null): void;
	sleep(ms: number): Promise<void>;
	/** An AbortSignal that aborts after `ms` on THIS clock. */
	timeoutSignal(ms: number): AbortSignal;
}

/**
 * Wall time. The default everywhere, so no production call site passes
 * anything and production behaviour is byte-identical to what it was before
 * the seam existed — `timeoutSignal` in particular is literally
 * `AbortSignal.timeout`, so even the DOMException a timed-out fetch rejects
 * with is unchanged.
 */
export const realClock: Clock = {
	now: () => Date.now(),
	setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as TimerHandle,
	clearTimeout: handle => {
		if (handle !== null) globalThis.clearTimeout(handle as unknown as number);
	},
	setInterval: (fn, ms) => globalThis.setInterval(fn, ms) as unknown as TimerHandle,
	clearInterval: handle => {
		if (handle !== null) globalThis.clearInterval(handle as unknown as number);
	},
	sleep: ms => new Promise<void>(resolve => {
		globalThis.setTimeout(resolve, ms);
	}),
	timeoutSignal: ms => AbortSignal.timeout(ms),
};
