// #120 defect A — the origin-global person cache (`dwc-ng.person`) is written
// by EVERY app instance on this origin, and it carries the backup history.
// `persistCache` used to hand `meta.snapshots` straight to the writer; that
// list is seeded once at createConfigStore and never re-read, so any instance
// built BEFORE a save persisted its stale (usually empty) list over the newer
// record and the next boot restored nothing. Two tabs — or one tab that
// survived a Vite HMR update — were enough to destroy the history.
//
// The fix is not "write more carefully": `writePersonCache` no longer TAKES a
// history at all. It takes only what this call contributes and derives the
// stored list from the record already on disk (mergeSnapshots), so there is no
// argument any caller can pass that expresses "the stored history is exactly
// this list". These tests pin that, and the storage listener that lets an open
// tab see what the other one wrote.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRoot } from "solid-js";
import { createConfigStore } from "../src/config/store.ts";
import { CONFIG_CACHE_KEY } from "../src/config/types.ts";
import { withLocalStorage } from "./helpers/localStorage.ts";

/** The history as it exists ON DISK — the thing the operator gets back after a
 *  reload, and the only view that can show one instance clobbering another. */
function storedSnapshots(): { id: string; label: string }[] {
	const raw = localStorage.getItem(CONFIG_CACHE_KEY);
	if (raw === null) return [];
	const parsed = JSON.parse(raw) as { snapshots?: { id: string; label: string }[] };
	return parsed.snapshots ?? [];
}

const unidentified = { machineStore: () => null };

test("an instance built before another's save cannot shorten the stored history", () => {
	withLocalStorage(() => {
		createRoot(dispose => {
			// B is built FIRST — it is the stale one. Its `meta.snapshots` is `[]`
			// and stays `[]`; it has no way of learning about A's save on its own.
			const b = createConfigStore(unidentified);
			const a = createConfigStore(unidentified);

			a.snapshot("first backup");
			assert.equal(storedSnapshots().length, 1, "A's backup reached disk");

			// THE RED: B persists its cache for an unrelated reason (a layout
			// edit — the boot-time path #120 defect B made fire on every load).
			// It used to write `snapshots: []` over A's record.
			b.markLayoutDirty();
			assert.equal(storedSnapshots().length, 1, "B's write preserved A's backup");
			assert.equal(storedSnapshots()[0]?.label, "first backup");

			// And a genuine contribution from B ADDS to A's, rather than
			// replacing the history with B's own view of it.
			b.snapshot("second backup");
			assert.deepEqual(
				storedSnapshots().map(s => s.label),
				["first backup", "second backup"],
				"both instances' backups survive, oldest first",
			);
			dispose();
		});
	});
});

test("the stored history survives a whole ladder of stale writers", () => {
	withLocalStorage(() => {
		createRoot(dispose => {
			const stale = [createConfigStore(unidentified), createConfigStore(unidentified), createConfigStore(unidentified)];
			const saver = createConfigStore(unidentified);
			saver.snapshot("the only backup");

			for (const s of stale) s.markLayoutDirty();
			assert.equal(storedSnapshots().length, 1, "three stale instances, still one backup");
			dispose();
		});
	});
});

test("two backups taken in the same millisecond keep their order across every later write", () => {
	// `mintSnapshotId` includes Math.random(), so a merge that broke takenAt
	// ties by id reshuffled a same-millisecond pair on every write — and the
	// list IS the order: `revert(i)` is indexed by it, and the card reads the
	// last row as the newest. Two Saves in one gesture land in the same
	// millisecond routinely; this failed roughly one run in two.
	withLocalStorage(() => {
		createRoot(dispose => {
			const store = createConfigStore(unidentified);
			store.snapshot("v1");
			store.snapshot("v2");
			assert.deepEqual(storedSnapshots().map(s => s.label), ["v1", "v2"]);

			// Any later writer re-runs the merge over that record. It must be a
			// no-op on ordering, however many times it happens.
			const other = createConfigStore(unidentified);
			other.markLayoutDirty();
			other.markLayoutDirty();
			assert.deepEqual(storedSnapshots().map(s => s.label), ["v1", "v2"], "re-merging never reorders");
			dispose();
		});
	});
});

test("a tab open across another tab's save sees the new record without a reload", () => {
	// `createConfigStore` subscribes to `storage` when a window exists. A
	// storage event never fires in the document that caused it, so the handler
	// is only ever another tab talking — which is exactly what this fakes.
	const handlers: ((event: { key: string | null }) => void)[] = [];
	const g = globalThis as { window?: unknown };
	const prior = g.window;
	g.window = {
		addEventListener: (type: string, handler: (event: { key: string | null }) => void) => {
			if (type === "storage") handlers.push(handler);
		},
		removeEventListener: () => {},
	};
	try {
		withLocalStorage(() => {
			createRoot(dispose => {
				const open = createConfigStore(unidentified);
				const other = createConfigStore(unidentified);
				assert.equal(open.snapshots.length, 0);

				other.snapshot("taken next door");
				// Without the listener the open tab shows nothing until a reload.
				for (const h of handlers) h({ key: CONFIG_CACHE_KEY });

				assert.equal(open.snapshots.length, 1, "the open tab re-hydrated");
				assert.equal(open.snapshots[0]?.label, "taken next door");
				dispose();
			});
		});
	} finally {
		if (prior === undefined) delete g.window; else g.window = prior;
	}
});

test("an unrelated storage key does not disturb the open tab's history", () => {
	const handlers: ((event: { key: string | null }) => void)[] = [];
	const g = globalThis as { window?: unknown };
	const prior = g.window;
	g.window = {
		addEventListener: (type: string, handler: (event: { key: string | null }) => void) => {
			if (type === "storage") handlers.push(handler);
		},
		removeEventListener: () => {},
	};
	try {
		withLocalStorage(() => {
			createRoot(dispose => {
				const open = createConfigStore(unidentified);
				open.snapshot("mine");
				for (const h of handlers) h({ key: "dwc-ng.machine.abc.layout" });
				assert.equal(open.snapshots.length, 1, "still exactly the one this tab took");
				dispose();
			});
		});
	} finally {
		if (prior === undefined) delete g.window; else g.window = prior;
	}
});

test("a boot with a persisted clean flag and no operator input stays clean", () => {
	withLocalStorage(() => {
		localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({
			version: 3, overlay: {}, dirty: false, snapshots: [],
		}));
		createRoot(dispose => {
			const store = createConfigStore(unidentified);
			assert.equal(store.dirty, false, "constructing the store is not an operator edit");
			dispose();
		});
	});
});

// --- the sole-writer scan the invariant's rung-6 claim rests on -------------
//
// `person-cache-snapshots-only-grow` is only as strong as "writePersonCache is
// the one function that writes this key". Nothing in the type system says so,
// so it is pinned here: a second `setItem(CONFIG_CACHE_KEY, …)` anywhere in the
// source fails this test rather than silently reintroducing defect A.
test("writePersonCache is the only writer of the person cache key", () => {
	const root = fileURLToPath(new URL("../src", import.meta.url));
	const writes: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = `${dir}/${entry.name}`;
			if (entry.isDirectory()) { walk(path); continue; }
			if (!/\.tsx?$/.test(entry.name)) continue;
			for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
				// Both spellings: the exported constant, and the raw key a file
				// that never imported it could still reach for.
				const code = line.trim();
				if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) continue;
				if (/setItem\(\s*(CONFIG_CACHE_KEY|["']dwc-ng\.person["'])/.test(code)) writes.push(`${path}: ${code}`);
			}
		}
	};
	walk(root);
	assert.equal(writes.length, 1, `expected exactly one writer of the person cache, found:\n${writes.join("\n")}`);
	assert.match(writes[0]!, /overlay: person/, "and it is writePersonCache's own record assembly");
});
