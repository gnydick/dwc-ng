// Test helper: a scratch `localStorage` backed by its own Map, installed on
// globalThis for the duration of `run` and restored afterward. Each call
// creates its own backing store — no state shared between callers, so tests
// that run concurrently or out of order cannot see each other's writes.
//
// `run` stays SYNCHRONOUS on purpose, even for callers whose body contains
// `await`s (e.g. an async createRoot callback exercising loadFromMachine/
// saveToMachine): making this function itself `async` and `await`ing `run()`
// was tried and reverted — it delays `finally`'s restore by a microtask tick
// for EVERY caller, sync ones included, and two `withLocalStorage` calls from
// back-to-back node:test tests (neither awaited, since most callers are
// synchronous test bodies) then have their scratch stores active
// simultaneously, corrupting each other (observed: assertions from one test
// failing asynchronously, attributed to the NEXT test, when this was tried).
// A caller whose body awaits mid-flight loses the scratch store the instant
// its first `await` yields — harmless for assertions on the in-memory
// store/meta (config/store.ts's `commit` sets those synchronously wherever
// it runs), but a caller that needs a LOCAL-CACHE READ to survive an
// `await` cannot rely on this helper for that; it was not built for it.
export function withLocalStorage(run: () => void): void {
	const backing = new Map<string, string>();
	const g = globalThis as { localStorage?: unknown };
	const prior = g.localStorage;
	g.localStorage = {
		getItem: (k: string) => backing.get(k) ?? null,
		setItem: (k: string, v: string) => void backing.set(k, v),
		removeItem: (k: string) => void backing.delete(k),
		get length() { return backing.size; },
		key: (i: number) => [...backing.keys()][i] ?? null,
	};
	try { run(); } finally { g.localStorage = prior; }
}
