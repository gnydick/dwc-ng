// #118 — "i saved to machine and nothing showed up", with eight backups
// already on the card. The saves all worked. `snapshot()` appended to the END
// of the list, the card rendered that order into a fixed-height box that is
// never scrolled (3 visible rows), and backup 9 of 10 landed below the fold.
//
// Two requirements, and conflating them is the trap:
//
//   1. VISIBILITY — a completed save must say so. Ordering does not do this: a
//      card whose contents change below the fold has told the operator nothing.
//   2. REACHABILITY — the newest backup must be on screen.
//
// And requirement 2 has a trap of its own. `revert` used to index the snapshot
// array POSITIONALLY, so reversing the render order alone would have made every
// Restore click restore the WRONG snapshot — silently, over the live overlay.
// Order is therefore decided once, at the store boundary, and revert addresses
// a snapshot by its ID, so presentation cannot change what a click means.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "solid-js";
import { createConfigStore } from "../src/config/store.ts";
import { MAX_SNAPSHOTS } from "../src/config/types.ts";
import { withLocalStorage } from "./helpers/localStorage.ts";

const unidentified = { machineStore: () => null };

function inStore(body: (store: ReturnType<typeof createConfigStore>) => void): void {
	withLocalStorage(() => {
		createRoot(dispose => {
			body(createConfigStore(unidentified));
			dispose();
		});
	});
}

// ---- requirement 2: the newest is at the top, and Restore still means it ----

test("the newest backup is first, so it is on screen in a card that never scrolls", () => {
	inStore(store => {
		store.setAxisRole("U", "first");
		store.snapshot("oldest");
		store.setAxisRole("U", "second");
		store.snapshot("middle");
		store.setAxisRole("U", "third");
		store.snapshot("newest");

		assert.deepEqual(
			store.snapshots.map(s => s.label),
			["newest", "middle", "oldest"],
			"the order a consumer sees is newest-first — there is no other order to see",
		);
	});
});

test("restoring the row shown as newest restores the NEWEST — the test an index-based revert fails", () => {
	// THE TRAP, pinned. With newest-first rendering and the old positional
	// revert, `revert(0)` on the top row would have restored the OLDEST
	// snapshot. Asserting on the restored VALUE is what catches that; asserting
	// that revert was called with 0 would not.
	inStore(store => {
		// A PERSON-half field: `axisRoles` is the machine half, which revert
		// deliberately leaves alone when no machine is identified (its own
		// invariant), so it could not show whether a revert had happened.
		store.setCameraPrefs({ pinned: false });
		store.snapshot("oldest");
		store.setCameraPrefs({ pinned: true });
		store.snapshot("newest");

		// Something else entirely is live now.
		store.setCameraPrefs({ pinned: false });

		const topRow = store.snapshots[0]!;
		assert.equal(topRow.label, "newest", "precondition: the top row IS the newest");
		store.revert(topRow.id);
		assert.equal(store.config.cameraPrefs.pinned, true, "the NEWEST backup's value, not the oldest");
	});
});

test("restoring the row shown as oldest restores the OLDEST", () => {
	// The other end, so a fix that merely flipped one index cannot pass.
	inStore(store => {
		store.setCameraPrefs({ pinned: true });
		store.snapshot("oldest");
		store.setCameraPrefs({ pinned: false });
		store.snapshot("newest");
		store.setCameraPrefs({ pinned: false });

		const bottomRow = store.snapshots[store.snapshots.length - 1]!;
		assert.equal(bottomRow.label, "oldest");
		store.revert(bottomRow.id);
		assert.equal(store.config.cameraPrefs.pinned, true, "the OLDEST backup's value");
	});
});

test("an id that names no snapshot restores nothing at all", () => {
	// Revert REPLACES the live overlay, so "not found" must mean "do nothing",
	// never "restore emptiness" — the same reasoning as revert's own
	// machine-half invariant.
	inStore(store => {
		store.setCameraPrefs({ pinned: true });
		store.snapshot("one");
		store.setCameraPrefs({ pinned: false });

		store.revert("s-not-a-real-id");
		assert.equal(store.config.cameraPrefs.pinned, false, "the live overlay is untouched");
	});
});

test("eviction still drops the OLDEST once the cap is reached", () => {
	// The presented order is newest-first; the cap must still bite at the other
	// end. A fix that reversed the stored array instead of the presented one
	// would evict the newest, which is the opposite of what the cap is for.
	inStore(store => {
		for (let i = 0; i < MAX_SNAPSHOTS + 3; i++) {
			store.setAxisRole("U", `value ${i}`);
			store.snapshot(`backup ${i}`);
		}
		assert.equal(store.snapshots.length, MAX_SNAPSHOTS);
		assert.equal(store.snapshots[0]!.label, `backup ${MAX_SNAPSHOTS + 2}`, "newest kept, and shown first");
		assert.equal(store.snapshots.at(-1)!.label, "backup 3", "the three oldest aged out");
	});
});

// ---- requirement 1: the save says so ----

test("a completed save reports what it saved, by name", () => {
	inStore(store => {
		assert.equal(store.lastSaved === null, true, "nothing has been saved in this session yet");

		store.setAxisRole("U", "x");
		store.snapshot("Before the tram");
		assert.equal(
			store.lastSaved?.label,
			"Before the tram",
			"the operator gets the name they typed back, not a generic 'saved'",
		);
	});
});

test("the reported name is the one that was actually stored, not the one typed", () => {
	// `snapshot()` trims, caps the length and falls back when blank. Reporting
	// the raw input would tell the operator a name that is not in the list —
	// which is the same class of lie as reporting a save that did not land.
	inStore(store => {
		store.setAxisRole("U", "x");
		store.snapshot("   ");
		assert.equal(store.lastSaved?.label, store.snapshots[0]!.label);
		assert.notEqual(store.lastSaved?.label, "   ");
	});
});

test("lastSaved names a snapshot that is really in the list", () => {
	// The confirmation and the list cannot disagree about which backup exists:
	// the id is the join, and it is the same id the list carries.
	inStore(store => {
		store.setAxisRole("U", "x");
		store.snapshot("Backup");
		const id = store.lastSaved!.id;
		assert.ok(store.snapshots.some(s => s.id === id));
	});
});

test("a session that has saved is still 'unsaved' the moment something changes", () => {
	// The display rule: dirty wins. A stale "Saved as X" over unsaved work is
	// worse than no confirmation at all, because it is a positive claim.
	inStore(store => {
		store.setAxisRole("U", "x");
		store.snapshot("Backup");
		assert.notEqual(store.lastSaved, null, "this session has a save to report");

		// A later edit does not erase the fact that a save happened; the CARD
		// prefers "Unsaved changes" while dirty, which is the display rule the
		// store deliberately does not bake in.
		store.setAxisRole("V", "y");
		assert.equal(store.dirty, true);
		assert.notEqual(store.lastSaved, null, "the fact survives — it is the DISPLAY that defers to dirty");
	});
});

test("the confirmation is a fact about this session, not restored from cache", () => {
	// Same reasoning as `claimedProfile` and `revertNotice`: what a previous
	// browser session saved is not something to tell the operator on boot.
	withLocalStorage(() => {
		createRoot(dispose => {
			const first = createConfigStore(unidentified);
			first.setAxisRole("U", "x");
			first.snapshot("Backup");
			assert.notEqual(first.lastSaved, null);

			const reloaded = createConfigStore(unidentified);
			assert.equal(reloaded.lastSaved, null, "a fresh boot claims no save of its own");
			assert.ok(reloaded.snapshots.length > 0, "though the backup itself is still there");
			dispose();
		});
	});
});
