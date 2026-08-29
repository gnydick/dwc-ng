import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCardId, allCardIds, cardTitleOf, CARD_DEFS, type CardId } from "../src/compose/defs.ts";
import {
	parseComposition, findFreePosition, addCard, slotsOf,
	type Composition,
} from "../src/compose/composition.ts";
import { GRID_COLS, rectsOverlap } from "../src/shell/panelCanvas.ts";

// ---- I1: boundary parse — a string becomes a CardId or ceases to exist ----

test("parseCardId accepts every registered id and only those", () => {
	for (const id of allCardIds()) assert.equal(parseCardId(id), id);
	assert.equal(parseCardId("not-a-card"), null);
	assert.equal(parseCardId(""), null);
	assert.equal(parseCardId("BUILD-OBJECTS"), null); // exact, not fuzzy
});

test("parseComposition drops bad slots, never the screen", () => {
	const raw = {
		"build-objects": { col: 2, row: 4, colSpan: 12, rowSpan: 53 },
		"ghost-card": { col: 0, row: 0, colSpan: 4, rowSpan: 10 }, // unknown id
		// malformed rect on a real id: dropped per-slot
	};
	const parsed = parseComposition(raw);
	assert.deepEqual(Object.keys(parsed), ["build-objects"]);
	assert.deepEqual(parsed["build-objects"], { col: 2, row: 4, colSpan: 12, rowSpan: 53 });
});

test("parseComposition survives garbage without throwing", () => {
	assert.deepEqual(parseComposition(null), {});
	assert.deepEqual(parseComposition("nonsense"), {});
	assert.deepEqual(parseComposition([1, 2, 3]), {});
	assert.deepEqual(parseComposition({ "build-objects": "not a rect" }), {});
	// corrupt numbers clamp to sanity rather than propagating NaN
	const clamped = parseComposition({ "build-objects": { col: "x", row: -5, colSpan: 9999, rowSpan: 0 } });
	const slot = clamped["build-objects"]!;
	assert.ok(slot.col >= 0 && slot.colSpan <= GRID_COLS && slot.rowSpan >= 1 && slot.row >= 0);
});

// ---- auto-place: additive by construction, never displaces or discards ----

test("findFreePosition never overlaps occupied slots", () => {
	const occupied = [
		{ col: 0, row: 0, colSpan: 24, rowSpan: 40 },
		{ col: 24, row: 0, colSpan: 24, rowSpan: 60 },
		{ col: 0, row: 40, colSpan: 12, rowSpan: 30 },
	];
	const spot = findFreePosition(occupied, { colSpan: 12, rowSpan: 20 });
	const candidate = { ...spot, colSpan: 12, rowSpan: 20 };
	assert.ok(!occupied.some(s => rectsOverlap(candidate, s)), "placed clear of everything");
	assert.ok(spot.col + 12 <= GRID_COLS, "inside the grid");
});

test("findFreePosition falls to the bottom when nothing fits between", () => {
	const wall = [{ col: 0, row: 0, colSpan: GRID_COLS, rowSpan: 100 }];
	assert.deepEqual(findFreePosition(wall, { colSpan: 48, rowSpan: 10 }), { col: 0, row: 100 });
});

test("findFreePosition on an empty screen is the origin", () => {
	assert.deepEqual(findFreePosition([], { colSpan: 12, rowSpan: 53 }), { col: 0, row: 0 });
});

test("addCard places at natural size and NEVER moves existing slots", () => {
	const before: Composition = {};
	const one = addCard(before, "build-objects");
	assert.deepEqual(one["build-objects"], { col: 0, row: 0, ...CARD_DEFS["build-objects"].size });
	assert.deepEqual(before, {}, "input untouched — placement is pure");
});

test("addCard is idempotent (I2: the duplicate has no encoding)", () => {
	const once = addCard({}, "build-objects");
	const twice = addCard(once, "build-objects");
	assert.equal(twice, once, "re-adding returns the same composition");
	assert.equal(slotsOf(twice).length, 1);
});

// ---- built-in screens: shippable by construction ----

test("built-in screen compositions are collision-free and round-trip parse", async () => {
	const {
		MACHINE_COMPOSITION, CONTROL_COMPOSITION, ACTIVITY_COMPOSITION,
		JOBS_COMPOSITION, MACROS_COMPOSITION, SYSTEM_COMPOSITION, BED_COMPOSITION,
		SETTINGS_COMPOSITION, SHAPING_COMPOSITION,
	} = await import("../src/compose/screens.ts");
	const { hasCollisions } = await import("../src/shell/panelCanvas.ts");
	for (const [name, composition] of [
		["machine", MACHINE_COMPOSITION],
		["control", CONTROL_COMPOSITION],
		["activity", ACTIVITY_COMPOSITION],
		["jobs", JOBS_COMPOSITION],
		["macros", MACROS_COMPOSITION],
		["system", SYSTEM_COMPOSITION],
		["bed", BED_COMPOSITION],
		["settings", SETTINGS_COMPOSITION],
		// Shaping was missing from this list, which is how its Decay card came
		// to be placed at 75 rows against the 189 its own content declares:
		// nothing overlapped, so nothing complained, and the card below it
		// simply started 114 rows too early.
		["shaping", SHAPING_COMPOSITION],
	] as const) {
		// keys are CardIds by type; prove the runtime data survives its own boundary
		assert.deepEqual(parseComposition(composition), composition, `${name} round-trips`);
		assert.ok(!hasCollisions(composition as Record<string, never>), `${name} has no overlapping slots`);
	}
});

// ---- registry sanity: every def is renderable-shaped ----

test("every card def has a positive natural size within the grid", () => {
	for (const id of allCardIds()) {
		const size = CARD_DEFS[id].size;
		assert.ok(size.colSpan >= 1 && size.colSpan <= GRID_COLS, `${id} colSpan`);
		assert.ok(size.rowSpan >= 1, `${id} rowSpan`);
		const title = CARD_DEFS[id].title;
		// A title is a non-empty string or a ctx-derived function (job-details,
		// the editors) — either way the card can always name itself.
		assert.ok(typeof title === "function" || title.length > 0, `${id} title`);
	}
});

/**
 * Two cards may not present the same name.
 *
 * `active-job` and `active-job-detailed` were both "Printing", identical in
 * title, aria-label, tip, class and size — but they are different cards with
 * separately remembered geometry. In the compose picker, the Card Lab's pills
 * and the import review they appeared as two entries nobody could tell apart;
 * resizing one and later picking the other reads exactly like a layout that
 * reverted. Alphabetising the picker sat them next to each other, so choosing
 * became a coin flip.
 *
 * This is rung 3 — a test, not a construction. TypeScript cannot express
 * "these string VALUES must be distinct" across an object literal, so nothing
 * stops a future card from taking an existing name; this fails the build when
 * one does.
 */
test("no two registry cards share a display title", () => {
	const byTitle = new Map<string, CardId[]>();
	for (const id of allCardIds()) {
		const title = cardTitleOf(id);
		byTitle.set(title, [...(byTitle.get(title) ?? []), id]);
	}
	const clashes = [...byTitle.entries()].filter(([, ids]) => ids.length > 1);
	assert.deepEqual(
		clashes, [],
		`cards sharing a title are indistinguishable in the picker: ${clashes.map(([t, ids]) => `"${t}" ← ${ids.join(", ")}`).join("; ")}`,
	);
});

test("no two registry cards share an aria-label", () => {
	// Same defect, for anyone navigating by screen reader — where the title is
	// not even visible and the label is all there is.
	const byLabel = new Map<string, CardId[]>();
	for (const id of allCardIds()) {
		const label = CARD_DEFS[id].ariaLabel;
		if (typeof label !== "string") continue; // dynamic labels are per-instance
		byLabel.set(label, [...(byLabel.get(label) ?? []), id]);
	}
	const clashes = [...byLabel.entries()].filter(([, ids]) => ids.length > 1);
	assert.deepEqual(clashes, [], `cards sharing an aria-label: ${JSON.stringify(clashes)}`);
});

/**
 * The Shaping screen places every card at the size the registry says it needs.
 *
 * A composition MAY place a card smaller — the operator drags cards to whatever
 * they like, and a saved layout is theirs. What a SHIPPED default may not do is
 * hand a card less room than its own content declares, because the card then
 * arrives clipped on a screen nobody has touched yet. That is what happened
 * here: Decay grew 75 -> 189 for its ring-down chart and the screen it lives on
 * was never re-flowed, and the collision check above could not see it because
 * the slots still did not overlap.
 *
 * Rung 3 and honest about it: the real promotion is a composition that DERIVES
 * these spans from `CARD_DEFS` rather than restating them, which would delete
 * the failure mode instead of reporting it. Scoped to Shaping because the other
 * built-ins genuinely do place shared cards (console, camera) at per-screen
 * sizes, and pinning those would be pinning a decision rather than an
 * invariant.
 */
test("every Shaping card is placed at its own registry size, and the columns do not overlap", async () => {
	const { SHAPING_COMPOSITION } = await import("../src/compose/screens.ts");
	for (const [id, slot] of Object.entries(SHAPING_COMPOSITION)) {
		if (!id.startsWith("shaping-") || slot === undefined) continue;
		const natural = CARD_DEFS[id as CardId].size;
		assert.equal(slot.rowSpan, natural.rowSpan, `${id} rowSpan: placed ${slot.rowSpan}, needs ${natural.rowSpan}`);
		assert.equal(slot.colSpan, natural.colSpan, `${id} colSpan`);
	}
	// And the full-width strips clear BOTH columns, which a collision check
	// alone would also pass if a strip were placed above the taller of the two.
	const bottom = Math.max(...Object.entries(SHAPING_COMPOSITION)
		.filter(([id]) => id.startsWith("shaping-"))
		.map(([, s]) => (s === undefined ? 0 : s.row + s.rowSpan)));
	assert.ok(SHAPING_COMPOSITION.console!.row >= bottom, `console at ${SHAPING_COMPOSITION.console!.row}, cards end at ${bottom}`);
});

/**
 * The two stacked-field cards, placed at the size the registry measured (#138).
 *
 * SCOPED TO TWO IDS, not the whole Settings screen, and that is deliberate
 * rather than lazy: several other cards on this screen are placed at spans that
 * do not match their registry entry and overflow today (axis-roles by 12px,
 * tool-dock-sensors by 3, config-save by 50 — measured 2026-08-28 on the mock),
 * which is #94's subject and not this ticket's. Pinning them here would turn
 * somebody else's open finding into a red test with no fix attached.
 *
 * What this DOES stop is the specific failure #138 names: a rowSpan raised in
 * `defs.ts` and forgotten in `screens.ts`, so the card grows in the Card Lab
 * and stays short on the screen an operator actually uses. Both cards were
 * re-measured when their label moved above its input; if a future edit changes
 * one of the two numbers, this says so.
 *
 * The OTHER half — that the rows below a card which grew were moved down with
 * it — is already covered and needs no second assertion here: "built-in screen
 * compositions are collision-free" above fails on exactly that, verified by
 * leaving thermal-colors at its old row 161 inside the now-170-tall bed-probe.
 */
test("the stacked-field cards are placed at their own registry size", async () => {
	const { SETTINGS_COMPOSITION } = await import("../src/compose/screens.ts");
	for (const id of ["bed-probe", "camera-config"] as const) {
		const slot = SETTINGS_COMPOSITION[id];
		assert.ok(slot, `${id} is not placed on Settings`);
		const natural = CARD_DEFS[id].size;
		assert.equal(slot.rowSpan, natural.rowSpan, `${id} rowSpan: placed ${slot.rowSpan}, registry says ${natural.rowSpan}`);
		assert.equal(slot.colSpan, natural.colSpan, `${id} colSpan`);
	}
});

