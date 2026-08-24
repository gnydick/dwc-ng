/**
 * The four numbers a capture run is made of, and the one writer both editors
 * use.
 *
 * The point of the shared table is that Settings › Input shaping and the
 * Capture card cannot describe different sets of settings. The point of
 * `commitMotionField` is subtler and is what these tests are mostly about: a
 * REFUSED default is invisible on its own. `parseShapingDefaults` drops the
 * field, the effective value simply does not change, and an editor that wrote
 * and moved on would appear to have accepted it. So the commit writes, reads
 * BACK, and reports what actually stands.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { commitMotionField, MOTION_FIELDS } from "../src/shaping/motionFields.ts";
import { parseShapingDefaults } from "../src/config/parse.ts";
import type { ShapingDefaults } from "../src/config/types.ts";

const SHIPPED: ShapingDefaults = { distMm: 60, speedMmS: 200, repeats: 3 };

/** A config store in miniature: the same gate the real one runs, and nothing
 *  else, so what these tests measure is the gate's verdict and not a mock's. */
function store(initial: ShapingDefaults = SHIPPED) {
	let held = initial;
	return {
		read: (): ShapingDefaults => held,
		apply: (patch: Partial<ShapingDefaults>): void => {
			held = { ...held, ...parseShapingDefaults(patch) };
		},
	};
}

test("the table covers every field of ShapingDefaults, once each", () => {
	// A field missing from the table cannot be edited from either card; a field
	// listed twice would have two inputs writing over each other.
	const keys = MOTION_FIELDS.map(f => f.key);
	assert.deepEqual([...keys].sort(), (Object.keys(SHIPPED) as Array<keyof ShapingDefaults>).sort());
	assert.equal(new Set(keys).size, keys.length);
});

test("every field reads and patches its own number and no other", () => {
	for (const field of MOTION_FIELDS) {
		assert.equal(field.read(SHIPPED), SHIPPED[field.key]);
		assert.deepEqual(field.patch(42), { [field.key]: 42 });
		assert.ok(field.label.length > 0 && field.unit.length > 0 && field.short.length > 0, field.key);
	}
});

test("a value the gate takes is kept, and there is nothing to report", () => {
	const s = store();
	const dist = MOTION_FIELDS.find(f => f.key === "distMm")!;
	assert.deepEqual(commitMotionField(dist, 80, s.apply, s.read), { kept: 80, note: "" });
	assert.equal(s.read().distMm, 80);
});

test("a refused value is reported by NAME, with what stands instead", () => {
	// Zero, negative and non-integer are all things a number input will hand
	// over, and every one of them is a G-code parameter with no move to describe.
	const s = store();
	const dist = MOTION_FIELDS.find(f => f.key === "distMm")!;
	const reps = MOTION_FIELDS.find(f => f.key === "repeats")!;
	assert.deepEqual(commitMotionField(dist, 0, s.apply, s.read), { kept: 60, note: "Distance refused — kept 60." });
	assert.deepEqual(commitMotionField(dist, -5, s.apply, s.read), { kept: 60, note: "Distance refused — kept 60." });
	assert.deepEqual(commitMotionField(reps, 2.5, s.apply, s.read), { kept: 3, note: "Repeats refused — kept 3." });
	assert.deepEqual(commitMotionField(reps, Number.NaN, s.apply, s.read), { kept: 3, note: "Repeats refused — kept 3." });
	// And nothing changed underneath.
	assert.deepEqual(s.read(), SHIPPED);
});

test("the commit never invents a rule of its own — it reports whatever the gate did", () => {
	// A store whose gate accepts everything makes the commit report success for
	// values the real gate refuses. That is the correct behaviour: the gate is
	// the authority on what a legal motion default is, and a second opinion
	// living in an editor is what this module exists NOT to be.
	let held = SHIPPED;
	const permissive = {
		read: (): ShapingDefaults => held,
		apply: (patch: Partial<ShapingDefaults>): void => { held = { ...held, ...patch }; },
	};
	const dist = MOTION_FIELDS.find(f => f.key === "distMm")!;
	assert.deepEqual(commitMotionField(dist, -5, permissive.apply, permissive.read), { kept: -5, note: "" });
});
