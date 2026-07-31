import { test } from "node:test";
import assert from "node:assert/strict";
import {
	resolveGroupMove, collidesWithAny, GRID_COLS,
	type CanvasState, type PanelRect,
} from "../src/shell/panelCanvas.ts";

/**
 * "Pick up these three and put them there" — a rigid group move.
 *
 * Rigid is the contract, and everything here exists to pin it: the members keep
 * their positions relative to each other, and the move either happens for all
 * of them or for none. A partial move would silently rearrange the very
 * relationship the operator selected them to preserve.
 */

const rect = (col: number, row: number, colSpan = 10, rowSpan = 10): PanelRect =>
	({ col, row, colSpan, rowSpan });

/** Relative offsets between members — the thing a rigid move must not change. */
function formation(state: CanvasState, ids: readonly string[]): string {
	const base = state[ids[0]!]!;
	return ids.map(id => {
		const r = state[id]!;
		return `${r.col - base.col},${r.row - base.row}`;
	}).join(" ");
}

test("the whole group shifts by one shared delta", () => {
	const state: CanvasState = { a: rect(0, 0), b: rect(20, 0), c: rect(0, 20) };
	const patch = resolveGroupMove(state, ["a", "b", "c"], 5, 3);
	assert.ok(patch, "an unobstructed group must move");
	assert.deepEqual(patch.a, rect(5, 3));
	assert.deepEqual(patch.b, rect(25, 3));
	assert.deepEqual(patch.c, rect(5, 23));
});

test("the formation survives the move", () => {
	const state: CanvasState = { a: rect(4, 4), b: rect(30, 9), c: rect(17, 40) };
	const ids = ["a", "b", "c"];
	const before = formation(state, ids);
	const patch = resolveGroupMove(state, ids, 11, 7)!;
	assert.equal(formation({ ...state, ...patch }, ids), before);
});

/**
 * Members cannot collide with each other — a common translation preserves
 * non-overlap — so only NON-members are obstacles. If the group were tested
 * against itself, any move at all would look blocked.
 */
test("members are not obstacles to each other", () => {
	// Two cards side by side with no gap: b sits exactly where a is heading.
	const state: CanvasState = { a: rect(0, 0), b: rect(10, 0) };
	const patch = resolveGroupMove(state, ["a", "b"], 10, 0);
	assert.ok(patch, "the pair must move even though a lands where b was");
	assert.deepEqual(patch.a, rect(10, 0));
	assert.deepEqual(patch.b, rect(20, 0));
});

test("a non-member in the way blocks that direction", () => {
	// wall sits immediately right of b, so the pair cannot move right at all...
	const state: CanvasState = { a: rect(0, 0), b: rect(10, 0), wall: rect(20, 0) };
	assert.equal(resolveGroupMove(state, ["a", "b"], 5, 0), null, "right is blocked");
	// ...but down is free, and the group should still get there.
	const down = resolveGroupMove(state, ["a", "b"], 0, 12);
	assert.ok(down, "a free axis must still move");
	assert.deepEqual(down.a, rect(0, 12));
	assert.deepEqual(down.b, rect(10, 12));
});

/**
 * A diagonal whose horizontal component is blocked keeps its vertical one —
 * the group slides along the wall instead of freezing, matching what a single
 * card already does.
 */
test("a blocked axis does not freeze the free one", () => {
	const state: CanvasState = { a: rect(0, 0), b: rect(10, 0), wall: rect(20, 0) };
	const patch = resolveGroupMove(state, ["a", "b"], 5, 12);
	assert.ok(patch, "the group must slide down past the wall");
	assert.equal(patch.a!.row, 12, "the free axis travelled");
	assert.equal(formation({ ...state, ...patch }, ["a", "b"]), formation(state, ["a", "b"]));
});

/**
 * The GROUP is clamped to the grid, not each card. Per-card clamping would
 * squash the formation together against an edge — which is the one thing a
 * rigid move must never do.
 */
test("the group clamps to the grid as one body, keeping its shape", () => {
	const state: CanvasState = { a: rect(GRID_COLS - 30, 0), b: rect(GRID_COLS - 15, 0) };
	const ids = ["a", "b"];
	const patch = resolveGroupMove(state, ids, 999, 0);
	assert.ok(patch, "a group pushed past the edge should travel as far as it can");
	assert.equal(patch.b!.col + patch.b!.colSpan, GRID_COLS, "the trailing card sits on the edge");
	assert.equal(formation({ ...state, ...patch }, ids), formation(state, ids), "not squashed");
});

test("no member is ever pushed above row 0", () => {
	const state: CanvasState = { a: rect(0, 0), b: rect(20, 5) };
	const patch = resolveGroupMove(state, ["a", "b"], 0, -99);
	assert.equal(patch, null, "a group already at the top cannot rise");
});

test("a group with nowhere to go returns null rather than a no-op patch", () => {
	const state: CanvasState = { a: rect(0, 0), b: rect(10, 0) };
	assert.equal(resolveGroupMove(state, ["a", "b"], 0, 0), null);
	assert.equal(resolveGroupMove(state, [], 5, 5), null, "an empty selection moves nothing");
	assert.equal(resolveGroupMove(state, ["ghost"], 5, 5), null, "unknown ids are not invented");
});

/**
 * One selected card is just a move, and must behave exactly like one — same
 * sliding, same rejection — rather than taking a second code path that could
 * drift from it.
 */
test("a single-member group is an ordinary move", () => {
	const state: CanvasState = { a: rect(0, 0), wall: rect(10, 0) };
	const patch = resolveGroupMove(state, ["a"], 5, 4);
	assert.ok(patch);
	assert.deepEqual(patch.a, rect(0, 4), "slides down past the wall it cannot pass");
});

/**
 * collidesWithAny takes one id or a whole set. A second collision routine for
 * groups would be a second definition of "overlap", and it would be the one to
 * drift — it has no years of use behind it.
 */
test("collidesWithAny excludes a set as readily as one id", () => {
	const state: CanvasState = { a: rect(0, 0), b: rect(10, 0), other: rect(30, 0) };
	// a's own cell collides with a unless a is excluded.
	assert.ok(collidesWithAny(state, "b", rect(0, 0)), "a is in the way of a non-excluded rect");
	assert.ok(!collidesWithAny(state, "a", rect(0, 0)), "excluding a clears it");
	assert.ok(!collidesWithAny(state, new Set(["a", "b"]), rect(10, 0)), "the set clears both");
	assert.ok(collidesWithAny(state, new Set(["a", "b"]), rect(30, 0)), "but not a non-member");
});
