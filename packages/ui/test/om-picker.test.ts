import { test } from "node:test";
import assert from "node:assert/strict";
import { selectorForPath, type PathStep } from "../src/om/inspect.ts";
import { parseOmSelector, readOm } from "../src/compose/controls/omSelector.ts";

/**
 * The OM picker's invariant: pickable-implies-parseable. selectorForPath is
 * the only way the inspector's copy affordance obtains a payload, and it
 * returns the branded OmSelector (sole constructor parseOmSelector) or null —
 * never a raw string. These tests pin both halves: valid paths yield a
 * selector that denotes exactly the traversed node, and every unbuildable
 * path yields null (affordance absent), not a plausible-looking string.
 */

const key = (k: string): PathStep => ({ kind: "key", key: k });
const index = (i: number): PathStep => ({ kind: "index", index: i });

test("selectorForPath: plain key paths compose dot-separated", () => {
	assert.equal(selectorForPath([key("state")])?.text, "state");
	assert.equal(selectorForPath([key("state"), key("status")])?.text, "state.status");
});

test("selectorForPath: an array index becomes a bracket on the preceding segment", () => {
	assert.equal(selectorForPath([key("heat"), key("heaters"), index(1)])?.text, "heat.heaters[1]");
	assert.equal(
		selectorForPath([key("heat"), key("heaters"), index(1), key("current")])?.text,
		"heat.heaters[1].current",
	);
});

test("selectorForPath: deep mixed path with several indices", () => {
	assert.equal(
		selectorForPath([key("move"), key("axes"), index(3), key("drives"), index(0)])?.text,
		"move.axes[3].drives[0]",
	);
});

test("selectorForPath: the result re-parses to identical segments (parser is the authority)", () => {
	const sel = selectorForPath([key("heat"), key("heaters"), index(1), key("current")]);
	assert.ok(sel !== null);
	const reparsed = parseOmSelector(sel.text);
	assert.ok(reparsed !== null);
	assert.deepEqual(reparsed.segments, sel.segments);
});

test("selectorForPath: the selector denotes the very node the path traversed", () => {
	const root = {
		heat: { heaters: [{ current: 21.3 }, { current: 214.9 }] },
		move: { axes: [{ letter: "X", machinePosition: 12.5 }] },
	};
	const heater = selectorForPath([key("heat"), key("heaters"), index(1), key("current")]);
	assert.ok(heater !== null);
	assert.equal(readOm(root, heater), 214.9);
	const axis = selectorForPath([key("move"), key("axes"), index(0), key("machinePosition")]);
	assert.ok(axis !== null);
	assert.equal(readOm(root, axis), 12.5);
});

test("selectorForPath: null for an empty path", () => {
	assert.equal(selectorForPath([]), null);
});

test("selectorForPath: null for an index at the root — the grammar has no bare-index segment", () => {
	assert.equal(selectorForPath([index(0)]), null);
	assert.equal(selectorForPath([index(2), key("current")]), null);
});

test("selectorForPath: null for an index directly after an index — one bracket per segment", () => {
	assert.equal(selectorForPath([key("a"), index(0), index(1)]), null);
});

test("selectorForPath: null for keys that are not bare identifiers", () => {
	for (const bad of ["fan-1", "3rd", "0", "", "with space", "letter=C", "a[0]", "a]b"]) {
		assert.equal(selectorForPath([key("root"), key(bad)]), null, `key ${JSON.stringify(bad)} must not build`);
		assert.equal(selectorForPath([key(bad)]), null, `root key ${JSON.stringify(bad)} must not build`);
	}
});

test("selectorForPath: a dotted key must NOT yield a selector that merely parses", () => {
	// "a.b" composed naively gives "root.a.b", which parseOmSelector ACCEPTS —
	// but it denotes root→a→b, not root→["a.b"]. Round-trip identity against
	// the path is what refuses it; syntax alone cannot.
	assert.equal(selectorForPath([key("root"), key("a.b")]), null);
});

test("selectorForPath: underscore identifiers are fine", () => {
	assert.equal(selectorForPath([key("_private"), key("v2_value")])?.text, "_private.v2_value");
});
