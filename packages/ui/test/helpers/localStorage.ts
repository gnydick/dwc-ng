// Test helper: a scratch `localStorage` backed by its own Map, installed on
// globalThis for the duration of `run` and restored afterward. Each call
// creates its own backing store — no state shared between callers, so tests
// that run concurrently or out of order cannot see each other's writes.
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
