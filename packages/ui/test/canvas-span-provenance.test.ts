/**
 * GIT_132 — a stored span is honoured verbatim only if the OPERATOR set it.
 *
 * The defect: Gabe's Shaping screen painted the coded layout and then had a
 * stale stored one paint over it. `shaping-status` was stored at rowSpan 102 —
 * the coded default before #128 raised it to 116 — and `growToDefaults` handed
 * that fossil back, clipping 452 px of body into a 400 px box. Four of eight
 * cards were clipped.
 *
 * Shaping is the only screen with no `screens.layouts` entry on the SD card, so
 * nothing reconciled the fossil: `seedFromOverlay` is null, `proofCarrying` is
 * false, and #87's supersede path is unreachable.
 *
 * The rule these tests pin: an UNMARKED stored span (no record of an operator
 * having set it) may only grow to the coded floor; a MARKED one wins outright,
 * in both directions, which is what keeps the 2026-07-30 shrink fix alive.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	defaultCanvas, growToDefaults, mergeCanvas, parseStoredCanvas,
	readStoredCanvasRecord, serializeCanvas,
} from "../src/shell/panelCanvas.ts";

const rect = (col: number, row: number, colSpan: number, rowSpan: number) => ({ col, row, colSpan, rowSpan });
const none = (): ReadonlySet<string> => new Set<string>();
const sized = (...ids: string[]): ReadonlySet<string> => new Set(ids);

// --- the falsifying test: the reported defect, in the reported numbers ---

test("GIT_132: an UNMARKED stored span from an older release grows to the current coded floor", () => {
	// shaping-status' real numbers: stored 102 (the coded default before #128),
	// coded 116 today. Nothing in the record says an operator chose 102, so it
	// is a fossil and must not be handed back.
	const defaults = [{ id: "shaping-status", col: 0, row: 0, colSpan: 156, rowSpan: 116 }];
	const { state, grew } = growToDefaults({ "shaping-status": rect(0, 0, 156, 102) }, defaults, none());
	assert.equal(state["shaping-status"]!.rowSpan, 116, "the fossil span is raised to the coded floor");
	assert.equal(grew, true, "a real growth arms the reflow that clears the cards it now overlaps");
});

test("GIT_132: the whole Shaping column stops clipping, and the cards below are pushed clear", () => {
	// Column 0 of SHAPING_COMPOSITION, with the spans this browser had stored.
	const defaults = [
		{ id: "shaping-status", col: 0, row: 0, colSpan: 156, rowSpan: 116 },
		{ id: "shaping-candidates", col: 0, row: 116, colSpan: 156, rowSpan: 75 },
		{ id: "shaping-apply", col: 0, row: 191, colSpan: 156, rowSpan: 50 },
	];
	const stale = {
		"shaping-status": rect(0, 0, 156, 102),
		"shaping-candidates": rect(0, 102, 156, 75),
		"shaping-apply": rect(0, 177, 156, 50),
	};
	const merged = mergeCanvas(stale, defaults, none());
	assert.equal(merged["shaping-status"]!.rowSpan, 116);
	// Pushed clear, not left overlapping the card that just got taller.
	assert.equal(
		merged["shaping-candidates"]!.row >= merged["shaping-status"]!.row + merged["shaping-status"]!.rowSpan,
		true,
		"candidates sits below the grown status card",
	);
	assert.equal(
		merged["shaping-apply"]!.row >= merged["shaping-candidates"]!.row + merged["shaping-candidates"]!.rowSpan,
		true,
		"apply sits below candidates",
	);
});

// --- what must NOT change: the operator's own sizing ---

test("GIT_132: a MARKED stored span smaller than the coded default is kept (the 2026-07-30 fix stands)", () => {
	// Tools & heaters at rowSpan 77 against a coded 110, shrunk on purpose.
	// Marked, so it is not a fossil and Math.max must not touch it.
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: 12, rowSpan: 110 }];
	const { state, grew } = growToDefaults({ a: rect(3, 95, 12, 77) }, defaults, sized("a"));
	assert.deepEqual(state.a, rect(3, 95, 12, 77), "the operator's shrink survives the merge");
	assert.equal(grew, false, "nothing grew, so nothing may be reflowed around it");
});

test("GIT_132: marking is per axis-pair and per id — an unmarked neighbour still grows", () => {
	const defaults = [
		{ id: "kept", col: 0, row: 0, colSpan: 12, rowSpan: 110 },
		{ id: "fossil", col: 20, row: 0, colSpan: 12, rowSpan: 110 },
	];
	const { state } = growToDefaults(
		{ kept: rect(0, 0, 12, 77), fossil: rect(20, 0, 12, 77) },
		defaults,
		sized("kept"),
	);
	assert.equal(state.kept!.rowSpan, 77, "marked: the operator's");
	assert.equal(state.fossil!.rowSpan, 110, "unmarked: a fossil, raised to the floor");
});

test("GIT_132: a marked span LARGER than the coded default is still kept and still reports no growth", () => {
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: 12, rowSpan: 40 }];
	const { state, grew } = growToDefaults({ a: rect(0, 0, 24, 90) }, defaults, sized("a"));
	assert.deepEqual(state.a, rect(0, 0, 24, 90));
	assert.equal(grew, false);
});

test("GIT_132: an unmarked span LARGER than the coded default is kept — the floor only raises, never lowers", () => {
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: 12, rowSpan: 40 }];
	const { state, grew } = growToDefaults({ a: rect(0, 0, 24, 90) }, defaults, none());
	assert.deepEqual(state.a, rect(0, 0, 24, 90), "grow-only: a bigger span is never pulled down to the default");
	assert.equal(grew, false);
});

test("GIT_132: a card falling back to its coded default is placement, not growth", () => {
	const defaults = [
		{ id: "a", col: 1, row: 2, colSpan: 4, rowSpan: 4 },
		{ id: "b", col: 9, row: 0, colSpan: 4, rowSpan: 4 },
	];
	const { grew } = growToDefaults({ a: "junk" }, defaults, none());
	assert.equal(grew, false, "adding a card to a screen must not rearrange the cards already on it");
});

// --- the record: what the envelope carries ---

test("GIT_132: serializeCanvas round-trips the operator-sized set", () => {
	const canvas = defaultCanvas([{ id: "a", col: 0, row: 0, colSpan: 4, rowSpan: 4 }]);
	const raw = serializeCanvas(canvas, "test-basis", sized("a"));
	const record = readStoredCanvasRecord(raw);
	assert.deepEqual([...record.sized].sort(), ["a"]);
	assert.deepEqual(parseStoredCanvas(raw), canvas, "geometry unaffected by the new field");
});

test("GIT_132: a record written before this ticket reads back as nothing marked", () => {
	// Every canvas on every browser today. "No proof an operator sized this"
	// is the correct reading of a record that predates the field, and it is
	// what makes those spans grow once.
	const legacy = JSON.stringify({ v: 4, state: { a: rect(0, 0, 4, 4) }, basis: "old" });
	assert.deepEqual([...readStoredCanvasRecord(legacy).sized], []);
});

test("GIT_132: an unreadable record reads back as nothing marked rather than throwing", () => {
	assert.deepEqual([...readStoredCanvasRecord("not json").sized], []);
	assert.deepEqual([...readStoredCanvasRecord(null).sized], []);
	const wrongType = JSON.stringify({ v: 4, state: {}, basis: "x", sized: "a" });
	assert.deepEqual([...readStoredCanvasRecord(wrongType).sized], []);
});

// --- the mark is recorded where the operator's gesture lands ---

/** A scratch localStorage, matching the other canvas suites' MemStore. */
function withStorage(run: () => void): void {
	const backing = new Map<string, string>();
	const g = globalThis as { localStorage?: unknown };
	const prior = g.localStorage;
	g.localStorage = {
		getItem: (k: string) => backing.get(k) ?? null,
		setItem: (k: string, v: string) => void backing.set(k, String(v)),
		removeItem: (k: string) => void backing.delete(k),
	};
	try { run(); } finally { g.localStorage = prior; }
}

const CODED = [
	{ id: "a", col: 0, row: 0, colSpan: 12, rowSpan: 40 },
	{ id: "b", col: 12, row: 0, colSpan: 12, rowSpan: 40 },
];

const storedOf = (keys: { get: (n: "layout") => string | null }): { sized: string[]; state: Record<string, { rowSpan: number }> } =>
	JSON.parse(keys.get("layout") ?? "{}") as { sized: string[]; state: Record<string, { rowSpan: number }> };

test("GIT_132: an imported layout is the operator's — every id in it is marked", async () => {
	const { createPanelCanvas, devCanvasKeys } = await import("../src/shell/panelCanvas.ts");
	withStorage(() => {
		const keys = devCanvasKeys("import-marks");
		const canvas = createPanelCanvas(keys, CODED);
		assert.deepEqual(storedOf(keys).sized, [], "a fresh canvas claims nothing");
		canvas.adoptLayout({ a: { col: 0, row: 0, colSpan: 12, rowSpan: 20 }, b: { col: 12, row: 0, colSpan: 12, rowSpan: 40 } });
		assert.deepEqual(storedOf(keys).sized, ["a"], "only the span the import actually changed");
	});
});

test("GIT_132: resetSlot UNMARKS — putting a card back is the opposite of sizing it", async () => {
	const { createPanelCanvas, devCanvasKeys } = await import("../src/shell/panelCanvas.ts");
	withStorage(() => {
		const keys = devCanvasKeys("reset-unmarks");
		const canvas = createPanelCanvas(keys, CODED);
		canvas.adoptLayout({ a: { col: 0, row: 0, colSpan: 12, rowSpan: 20 }, b: { col: 12, row: 0, colSpan: 12, rowSpan: 40 } });
		assert.deepEqual(storedOf(keys).sized, ["a"]);
		canvas.resetSlot("a");
		assert.deepEqual(storedOf(keys).sized, [], "back at its coded span, so there is no chosen span left to protect");
		assert.equal(storedOf(keys).state["a"]!.rowSpan, 40);
	});
});

test("GIT_132: reset() clears every mark along with the geometry", async () => {
	const { createPanelCanvas, devCanvasKeys } = await import("../src/shell/panelCanvas.ts");
	withStorage(() => {
		const keys = devCanvasKeys("reset-all");
		const canvas = createPanelCanvas(keys, CODED);
		canvas.adoptLayout({ a: { col: 0, row: 0, colSpan: 12, rowSpan: 20 }, b: { col: 12, row: 0, colSpan: 12, rowSpan: 20 } });
		assert.deepEqual(storedOf(keys).sized.sort(), ["a", "b"]);
		canvas.reset();
		assert.deepEqual(storedOf(keys).sized, []);
	});
});

test("GIT_132: a composition reconcile marks nothing — a boot cannot fossilise the spans it just repaired", async () => {
	const { createPanelCanvas, devCanvasKeys, serializeCanvas } = await import("../src/shell/panelCanvas.ts");
	withStorage(() => {
		const keys = devCanvasKeys("reconcile-marks-nothing");
		// A fossil: stored below today's coded span, with no marks.
		keys.set("layout", serializeCanvas(
			{ a: { col: 0, row: 0, colSpan: 12, rowSpan: 20 } }, "none", new Set<string>(),
		));
		const canvas = createPanelCanvas(keys, CODED);
		// ensureSlot is the sync effect's route, a "composition-reconcile".
		canvas.ensureSlot("b", { col: 12, row: 0, colSpan: 12, rowSpan: 40 });
		assert.deepEqual(storedOf(keys).sized, [], "nothing here is the operator's");
		assert.equal(storedOf(keys).state["a"]!.rowSpan, 40, "and the fossil was raised to the coded floor");
	});
});

test("GIT_132: a marked span survives every later mount — the merge never revisits it", async () => {
	const { createPanelCanvas, devCanvasKeys } = await import("../src/shell/panelCanvas.ts");
	withStorage(() => {
		const keys = devCanvasKeys("marked-sticks");
		createPanelCanvas(keys, CODED).adoptLayout({
			a: { col: 0, row: 0, colSpan: 12, rowSpan: 20 },
			b: { col: 12, row: 0, colSpan: 12, rowSpan: 40 },
		});
		for (let mount = 1; mount <= 3; mount++) {
			createPanelCanvas(devCanvasKeys("marked-sticks"), CODED);
			assert.equal(storedOf(keys).state["a"]!.rowSpan, 20, `mount ${mount}: still the operator's 20, not the coded 40`);
			assert.deepEqual(storedOf(keys).sized, ["a"], `mount ${mount}: and still says so`);
		}
	});
});
