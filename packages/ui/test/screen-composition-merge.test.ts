// #86 — a built-in screen's saved layout used to REPLACE its coded
// composition, so the moment an operator saved a screen, that screen's card
// set froze at the cards that existed that day. Every card shipped to it
// afterwards was invisible to them, permanently, with nothing saying so.
//
// The merge fixes that, and requirement 3 is what makes it safe: a card the
// operator deliberately removed must STAY removed, which cannot be inferred
// from absence — absence meant both "did not exist when I saved" and "I took
// it off". Removal is now a TOMBSTONE: `setScreenCard(screen, card, null)`
// stores a literal `null` instead of deleting the key, so absence
// unambiguously means "never placed" and can safely be added.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "solid-js";
import { screenList, savedScreenLayout, screensUsing } from "../src/compose/screens.ts";
import { DEFAULT_CONFIG, type UiConfig } from "../src/config/types.ts";
import { createConfigStore } from "../src/config/store.ts";
import { withLocalStorage } from "./helpers/localStorage.ts";
import { growToDefaults, rectsOverlap } from "../src/shell/panelCanvas.ts";

/** DEFAULT_CONFIG with the screens overlay replaced. */
const withScreens = (screens: Partial<UiConfig["screens"]>): UiConfig => ({
	...DEFAULT_CONFIG,
	screens: { ...DEFAULT_CONFIG.screens, ...screens },
});

const rect = (col: number, row: number) => ({ col, row, colSpan: 12, rowSpan: 40 });

/** The cards a screen actually shows, by id. */
function cardsOn(config: UiConfig, screenId: string): string[] {
	const entry = screenList(config).find(e => e.id === screenId);
	assert.ok(entry !== undefined, `screen ${screenId} is in the list`);
	return Object.keys(entry.def.composition).sort();
}

/** The coded composition for a screen, which the merge must not lose. */
function codedCards(screenId: string): string[] {
	const entry = screenList(DEFAULT_CONFIG).find(e => e.id === screenId);
	assert.ok(entry !== undefined);
	return Object.keys(entry.def.composition).sort();
}

// ---- requirement 1 + 2: the coded composition is merged, not replaced ----

test("a card added to the coded composition appears on a screen the operator has already saved", () => {
	// THE RED. The operator saved `machine` when it held only the first of its
	// coded cards. Every other coded card is one that "shipped later" as far as
	// this override is concerned — and before the merge, none of them ever
	// appeared again.
	const coded = codedCards("machine");
	assert.ok(coded.length >= 2, "the machine screen needs at least two coded cards for this test to mean anything");
	const savedOne = coded[0]!;

	const config = withScreens({ layouts: { machine: { [savedOne]: rect(0, 0) } } });
	assert.deepEqual(cardsOn(config, "machine"), coded, "every coded card is present, not just the saved one");
});

test("the operator's own rect wins for a card present in both", () => {
	const coded = codedCards("machine");
	const savedOne = coded[0]!;
	const moved = { col: 12, row: 80, colSpan: 12, rowSpan: 20 };
	const config = withScreens({ layouts: { machine: { [savedOne]: moved } } });

	const entry = screenList(config).find(e => e.id === "machine")!;
	assert.deepEqual(
		entry.def.composition[savedOne as keyof typeof entry.def.composition],
		moved,
		"the saved geometry is not overwritten by the coded default",
	);
});

test("a card the operator ADDED to a built-in screen survives the merge", () => {
	// The override is not only a subset of the coded composition: an operator
	// can put any registry card on any screen. A merge that only walked the
	// coded ids would silently drop those.
	const coded = codedCards("machine");
	const extra = codedCards("jobs").find(id => !coded.includes(id));
	assert.ok(extra !== undefined, "need a card coded elsewhere but not on machine");

	const config = withScreens({ layouts: { machine: { [coded[0]!]: rect(0, 0), [extra]: rect(12, 0) } } });
	assert.deepEqual(cardsOn(config, "machine"), [...coded, extra].sort());
});

// ---- requirement 3: a deliberate removal is a tombstone, and it holds ----

test("a tombstoned card stays off the screen even though the coded composition still lists it", () => {
	const coded = codedCards("machine");
	const removed = coded[0]!;
	const config = withScreens({ layouts: { machine: { [removed]: null } } });

	assert.deepEqual(
		cardsOn(config, "machine"),
		coded.filter(id => id !== removed),
		"the removed card is not resurrected by the merge",
	);
});

test("tombstoning every card leaves an empty screen, not a resurrected one", () => {
	// The old code fell back to the coded composition whenever the override
	// parsed to nothing. With tombstones that fallback becomes a trap: an
	// operator who removed every card would get all of them back.
	const coded = codedCards("machine");
	const layouts = { machine: Object.fromEntries(coded.map(id => [id, null])) };
	const config = withScreens({ layouts });

	assert.deepEqual(cardsOn(config, "machine"), [], "an emptied screen stays empty");
});

// ---- requirement 4: garbled or absent data still yields the coded screen ----

test("an override that parses to nothing yields the coded composition", () => {
	const coded = codedCards("machine");
	for (const junk of [{}, { "not-a-card": rect(0, 0) }, { "build-objects": "not a rect" }]) {
		const config = withScreens({ layouts: { machine: junk as never } });
		assert.deepEqual(cardsOn(config, "machine"), coded, `junk override ${JSON.stringify(junk)}`);
	}
});

test("a screen with no override at all is untouched", () => {
	assert.deepEqual(cardsOn(DEFAULT_CONFIG, "machine"), codedCards("machine"));
});

// ---- the documented meaning of an un-migrated override ----

test("an override written before tombstones existed reads as 'never placed', so coded cards are added", () => {
	// THE DECISION, pinned so it cannot drift: an override with no `null`
	// entries carries no evidence of removal, and is read as "these are the
	// cards I placed", NOT "everything else was removed".
	//
	// Chosen because the two mistakes are not symmetric. Reading it as removal
	// keeps the #86 defect forever for every existing operator, silently.
	// Reading it as never-placed can resurrect a card someone removed before
	// this build — once, visibly, and they remove it again, which now writes a
	// tombstone and holds.
	const coded = codedCards("machine");
	const legacy = { machine: { [coded[0]!]: rect(0, 0) } };
	assert.deepEqual(cardsOn(withScreens({ layouts: legacy }), "machine"), coded);
});

// ---- the store: removal writes a tombstone, and nothing else erases it ----

const unidentified = { machineStore: () => null };

/** The raw stored override for a screen — what the merge will later read. */
function storedLayout(store: ReturnType<typeof createConfigStore>, screenId: string): Record<string, unknown> {
	return (store.config.screens.layouts[screenId] ?? {}) as Record<string, unknown>;
}

test("setScreenCard(..., null) records a tombstone rather than deleting the key", () => {
	withLocalStorage(() => {
		createRoot(dispose => {
			const store = createConfigStore(unidentified);
			const target = codedCards("machine")[0]!;

			store.setScreenCard("machine", target, rect(0, 0));
			assert.deepEqual(storedLayout(store, "machine")[target], rect(0, 0));

			store.setScreenCard("machine", target, null);
			assert.ok(Object.hasOwn(storedLayout(store, "machine"), target), "the key survives the removal");
			assert.equal(storedLayout(store, "machine")[target], null, "and its value is the tombstone");

			assert.equal(cardsOn(store.config, "machine").includes(target), false);
			dispose();
		});
	});
});

test("re-adding a card is the one thing that clears its tombstone", () => {
	withLocalStorage(() => {
		createRoot(dispose => {
			const store = createConfigStore(unidentified);
			const target = codedCards("machine")[0]!;

			store.setScreenCard("machine", target, null);
			store.setScreenCard("machine", target, rect(4, 4));

			assert.deepEqual(storedLayout(store, "machine")[target], rect(4, 4));
			assert.equal(cardsOn(store.config, "machine").includes(target), true);
			dispose();
		});
	});
});

test("a wholesale geometry write cannot erase a tombstone it does not name", () => {
	// `captureScreenGeometry` (Save to machine) rebuilds a screen's whole rect
	// record from the canvas and calls replaceAllScreenCards. If that dropped
	// tombstones, every Save would resurrect every removed card — the same
	// defect one layer down, and one no caller could be trusted to remember.
	withLocalStorage(() => {
		createRoot(dispose => {
			const store = createConfigStore(unidentified);
			const coded = codedCards("machine");
			const removed = coded[0]!;
			const kept = coded[1]!;

			store.setScreenCard("machine", removed, null);
			store.replaceAllScreenCards("machine", { [kept]: rect(0, 0) });

			assert.equal(storedLayout(store, "machine")[removed], null, "the tombstone survived the wholesale write");
			assert.equal(cardsOn(store.config, "machine").includes(removed), false);
			dispose();
		});
	});
});

// ---- readers that must not mistake a tombstone for a placement ----

test("savedScreenLayout does not seed the canvas from a tombstone", () => {
	const coded = codedCards("machine");
	const config = withScreens({ layouts: { machine: { [coded[0]!]: rect(0, 0), [coded[1]!]: null } } });
	const seed = savedScreenLayout(config, "machine");
	assert.ok(seed !== null);
	assert.deepEqual(Object.keys(seed), [coded[0]!], "only the placed card seeds geometry");
});

test("savedScreenLayout returns null when an override holds tombstones and nothing else", () => {
	const config = withScreens({ layouts: { machine: { [codedCards("machine")[0]!]: null } } });
	assert.equal(savedScreenLayout(config, "machine"), null, "nothing to seed with is not an empty layout");
});

test("a tombstoned custom card is not counted as a use when planning its deletion", () => {
	// screensUsing feeds the delete plan's blast radius. Counting a tombstone
	// would tell the operator a card is still on a screen they took it off.
	const cardId = "c-tombstoned";
	const config: UiConfig = {
		...withScreens({ layouts: { machine: { [cardId]: null } } }),
		cards: { [cardId]: { name: "Tombstoned", spec: "" } },
	};
	assert.deepEqual(screensUsing(config, cardId as never), []);
});

// ---- requirement 2's placement, through the mechanism it actually uses ----
//
// The merge only decides WHICH cards are on the screen. Where a newly merged-in
// card LANDS is the canvas's job: ComposedScreen feeds the composition to
// createPanelCanvas as its `defaults`, and growToDefaults' `added` pass slides
// an id the stored canvas has never seen clear of the cards already placed.
// Asserted here rather than assumed, because "placed so it cannot land on top
// of a card the operator positioned" is requirement 2's whole safety claim and
// it lives in a different module from the merge.

test("a card the merge adds is slid clear of one the operator has moved", () => {
	const stored = { position: { col: 0, row: 0, colSpan: 156, rowSpan: 103 } };
	// The coded rect for the added card sits exactly on top of where the
	// operator has parked `position` — the divergent-tiers case.
	const defaults = [
		{ id: "position", col: 0, row: 0, colSpan: 156, rowSpan: 103 },
		{ id: "tools-heaters", col: 0, row: 0, colSpan: 156, rowSpan: 110 },
	];
	const { state } = growToDefaults(stored, defaults);

	assert.deepEqual(
		state["position"],
		stored.position,
		"the operator's card is not moved to make room for the new one",
	);
	const added = state["tools-heaters"]!;
	assert.equal(
		rectsOverlap(added, state["position"]!),
		false,
		"and the added card does not land on top of it",
	);
});
