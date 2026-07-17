import { test } from "node:test";
import assert from "node:assert/strict";
import {
	defaultLayout, clampSpan, mergeLayout, parseStoredLayout, serializeLayout,
	colSpanForDelta, rowSpanForDelta, MAX_COL_SPAN, MAX_ROW_SPAN,
} from "../src/shell/panelLayout.ts";

const DEFAULTS = [
	{ id: "a" },
	{ id: "b", colSpan: 2 },
	{ id: "c", rowSpan: 3 },
];

test("defaultLayout orders panels by array index and fills in span defaults", () => {
	assert.deepEqual(defaultLayout(DEFAULTS), {
		a: { order: 0, colSpan: 1, rowSpan: 1 },
		b: { order: 1, colSpan: 2, rowSpan: 1 },
		c: { order: 2, colSpan: 1, rowSpan: 3 },
	});
});

test("clampSpan clamps below 1, above max, rounds fractions, and falls back on non-finite", () => {
	assert.equal(clampSpan(0, MAX_COL_SPAN), 1);
	assert.equal(clampSpan(-5, MAX_COL_SPAN), 1);
	assert.equal(clampSpan(5, MAX_COL_SPAN), MAX_COL_SPAN);
	assert.equal(clampSpan(1.6, MAX_ROW_SPAN), 2);
	assert.equal(clampSpan(Number.NaN, MAX_COL_SPAN), 1);
	assert.equal(clampSpan(Number.POSITIVE_INFINITY, MAX_COL_SPAN), 1);
});

test("parseStoredLayout tolerates missing or corrupt storage", () => {
	assert.equal(parseStoredLayout(null), null);
	assert.equal(parseStoredLayout(""), null);
	assert.equal(parseStoredLayout("{not json"), null);
});

test("mergeLayout falls back to defaults when storage is corrupt, empty, or the wrong shape", () => {
	assert.deepEqual(mergeLayout(null, DEFAULTS), defaultLayout(DEFAULTS));
	assert.deepEqual(mergeLayout("a string", DEFAULTS), defaultLayout(DEFAULTS));
	assert.deepEqual(mergeLayout(42, DEFAULTS), defaultLayout(DEFAULTS));
});

test("mergeLayout keeps stored order/span for known ids, clamped to valid bounds", () => {
	const stored = {
		a: { order: 2, colSpan: 99, rowSpan: -3 },
		b: { order: 0, colSpan: 1, rowSpan: 1 },
		c: { order: 1, colSpan: 1, rowSpan: 1 },
	};
	const merged = mergeLayout(stored, DEFAULTS);
	assert.deepEqual(merged.a, { order: 2, colSpan: MAX_COL_SPAN, rowSpan: 1 });
	assert.deepEqual(merged.b, { order: 0, colSpan: 1, rowSpan: 1 });
	assert.deepEqual(merged.c, { order: 1, colSpan: 1, rowSpan: 1 });
});

test("mergeLayout drops stored ids no longer present in defaults", () => {
	const stored = {
		a: { order: 0, colSpan: 1, rowSpan: 1 },
		ghost: { order: 1, colSpan: 1, rowSpan: 1 },
	};
	const merged = mergeLayout(stored, [{ id: "a" }]);
	assert.deepEqual(Object.keys(merged), ["a"]);
});

test("mergeLayout appends a default id missing from storage after every known order, using its own default span", () => {
	const stored = {
		a: { order: 0, colSpan: 1, rowSpan: 1 },
		b: { order: 1, colSpan: 2, rowSpan: 1 },
	};
	// "c" is a panel added to the view's code after this layout was saved.
	const merged = mergeLayout(stored, DEFAULTS);
	assert.deepEqual(merged.a, { order: 0, colSpan: 1, rowSpan: 1 });
	assert.deepEqual(merged.b, { order: 1, colSpan: 2, rowSpan: 1 });
	assert.deepEqual(merged.c, { order: 2, colSpan: 1, rowSpan: 3 });
});

test("serializeLayout round-trips through parseStoredLayout and mergeLayout", () => {
	const layout = defaultLayout(DEFAULTS);
	const restored = mergeLayout(parseStoredLayout(serializeLayout(layout)), DEFAULTS);
	assert.deepEqual(restored, layout);
});

test("colSpanForDelta only steps once the drag passes half a column width, and clamps to the max", () => {
	assert.equal(colSpanForDelta(1, 0, 300), 1, "no movement, no change");
	assert.equal(colSpanForDelta(1, 100, 300), 1, "less than half a column, stays");
	assert.equal(colSpanForDelta(1, 200, 300), 2, "past half a column, grows by one");
	assert.equal(colSpanForDelta(2, -200, 300), 1, "dragging back past half shrinks by one");
	assert.equal(colSpanForDelta(1, 10_000, 300), MAX_COL_SPAN, "clamped to the max even on a huge drag");
	assert.equal(colSpanForDelta(1, 500, 0), 1, "a zero-width column (not yet measured) never throws or produces NaN");
});

test("rowSpanForDelta steps by whole rows and never drops below 1", () => {
	assert.equal(rowSpanForDelta(1, 0, 100), 1);
	assert.equal(rowSpanForDelta(1, 40, 100), 1, "less than half a row, stays");
	assert.equal(rowSpanForDelta(1, 60, 100), 2, "past half a row, grows by one");
	assert.equal(rowSpanForDelta(2, -260, 100), 1, "clamped at the floor, never negative or zero");
});
