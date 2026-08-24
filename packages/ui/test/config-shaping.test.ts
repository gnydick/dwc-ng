/**
 * The `shaping` config section and its parse boundary (spec I8,
 * `envelope-is-config-not-default`).
 *
 * The load-bearing property: the motion envelope has NO default. It starts
 * `null` and only a user-entered box makes it anything else — so a machine
 * can never be commanded to move on a guessed extent. These tests pin that
 * `null` survives every route into the config: a fresh store, a malformed
 * overlay from the SD card or the localStorage cache, a mis-typed value
 * pushed through the store's own setter, and a section reset.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOverlay, parseOverlayPayload } from "../src/config/parse.ts";
import { createConfigStore } from "../src/config/store.ts";
import { CONFIG_VERSION, DEFAULT_CONFIG } from "../src/config/types.ts";

const payload = (overlay: unknown): string => JSON.stringify({ version: CONFIG_VERSION, overlay });
const box = { x: [0, 300], y: [10, 290] };

test("the shipped defaults leave the envelope unset", () => {
	assert.equal(DEFAULT_CONFIG.shaping.envelope, null, "no guessed box, ever (I8)");
	assert.deepEqual(DEFAULT_CONFIG.shaping.defaults, { distMm: 60, speedMmS: 200, repeats: 3 });
	assert.deepEqual(DEFAULT_CONFIG.shaping.accelByTool, {});
	const store = createConfigStore();
	assert.equal(store.config.shaping.envelope, null);
});

test("a well-formed shaping section round-trips the boundary unchanged", () => {
	const overlay = {
		shaping: {
			envelope: { x: [0, 300], y: [10, 290] },
			defaults: { distMm: 80, speedMmS: 250, repeats: 5 },
			accelByTool: { "0": "0.0", "1": "121.0" },
		},
	};
	assert.deepEqual(parseOverlay(overlay), overlay);
	assert.deepEqual(parseOverlayPayload(payload(overlay)), overlay);
});

test("a malformed envelope drops to unset — never to a partial or repaired box", () => {
	for (const envelope of [
		{ x: [1] },                               // wrong tuple length
		{ x: [0, 300, 5], y: [0, 300] },          // three bounds
		{ x: [0, 300] },                          // missing axis
		{ y: [0, 300] },                          // missing axis
		{ x: ["0", "300"], y: [0, 300] },         // non-numeric bounds
		{ x: [0, Number.NaN], y: [0, 300] },      // non-finite
		{ x: [0, Number.POSITIVE_INFINITY], y: [0, 300] },
		{ x: [0, 300], y: [5] },                  // one good axis is still not a box
		{ x: { 0: 0, 1: 300 }, y: [0, 300] },     // array-shaped object
		{ x: [0, 300], y: null },
		"0,300,0,300", 42, null, [], [[0, 300], [0, 300]],
	]) {
		const overlay = parseOverlay({ shaping: { envelope, defaults: { distMm: 80 } } });
		assert.deepEqual(overlay, { shaping: { defaults: { distMm: 80 } } },
			`envelope must drop whole: ${JSON.stringify(envelope)}`);
	}
	const store = createConfigStore();
	assert.equal(store.config.shaping.envelope, null);
});

test("a reversed or degenerate range is not a box", () => {
	// lo >= hi describes an empty region. Accepting it would make every
	// planned point refuse as "outside-envelope" — a refusal that misdirects
	// the operator — where dropping to null says the true thing: unset.
	for (const envelope of [
		{ x: [300, 0], y: [0, 300] },
		{ x: [0, 300], y: [290, 10] },
		{ x: [10, 10], y: [0, 300] },
		{ x: [0, 300], y: [0, 0] },
	]) {
		assert.deepEqual(parseOverlay({ shaping: { envelope } }), {},
			`empty region must drop: ${JSON.stringify(envelope)}`);
	}
	// Negative bounds are legitimate (an axis may run below zero).
	assert.deepEqual(parseOverlay({ shaping: { envelope: { x: [-50, 50], y: [-10, 0] } } }),
		{ shaping: { envelope: { x: [-50, 50], y: [-10, 0] } } });
});

test("motion defaults fall back per field, not as a block", () => {
	const overlay = parseOverlay({
		shaping: {
			defaults: {
				distMm: "80",              // mis-typed → default
				speedMmS: 250,             // good
				repeats: 2.5,              // not a whole count → default
				samples: 1500,             // no longer a setting at all → dropped
			},
		},
	});
	assert.deepEqual(overlay, { shaping: { defaults: { speedMmS: 250 } } });

	const store = createConfigStore();
	store.setShaping({ defaults: { distMm: Number.NaN, speedMmS: 250 } });
	assert.deepEqual(store.config.shaping.defaults,
		{ ...DEFAULT_CONFIG.shaping.defaults, speedMmS: 250 });

	for (const bad of [
		{ distMm: -1 }, { distMm: 0 }, { speedMmS: 0 }, { speedMmS: -5 },
		{ repeats: 0 }, { repeats: -2 }, { samples: 1500 },
		{ distMm: Number.POSITIVE_INFINITY },
	]) {
		assert.deepEqual(parseOverlay({ shaping: { defaults: bad } }), {},
			`must drop: ${JSON.stringify(bad)}`);
	}
	assert.deepEqual(parseOverlay({ shaping: { defaults: "junk" } }), {});
});

test("accelByTool keeps only board.slot addresses under whole-number tool keys", () => {
	const overlay = parseOverlay({
		shaping: {
			accelByTool: {
				"0": "0.0",        // kept
				"1": "121.0",      // kept
				"2": "0",          // not b.s
				"3": ".0",
				"4": "0.",
				"5": "0.0.0",
				"6": "a.b",
				"7": " 0.0",
				"8": 4,            // not a string
				"9": null,
				"-1": "0.0",       // not a tool number
				"1.5": "0.0",
				"01": "0.0",       // non-canonical key
				"1e0": "0.0",
				"x": "0.0",
			},
		},
	});
	assert.deepEqual(overlay, { shaping: { accelByTool: { "0": "0.0", "1": "121.0" } } });
	assert.deepEqual(parseOverlay({ shaping: { accelByTool: "0.0" } }), {});
});

test("the store's own setters pass the same gate as the SD file", () => {
	const store = createConfigStore();
	store.setShaping({ envelope: { x: [0, 300], y: [10, 290] } });
	assert.deepEqual(store.config.shaping.envelope, box);
	assert.equal(store.dirty, true);

	// A reversed box from the Settings editor is refused exactly as a
	// hand-edited one is: there is no second route to the envelope.
	store.setShaping({ envelope: { x: [300, 0], y: [10, 290] } });
	assert.equal(store.config.shaping.envelope, null);

	store.setShaping({ envelope: { x: [0, 300], y: [10, 290] } });
	store.setShaping({ envelope: null });
	assert.equal(store.config.shaping.envelope, null, "clearing is expressible");

	store.setAccelAddr(0, "121.0");
	assert.deepEqual(store.config.shaping.accelByTool, { 0: "121.0" });
	store.setAccelAddr(1, "nonsense");
	assert.deepEqual(store.config.shaping.accelByTool, { 0: "121.0" }, "a bad address never lands");
	store.clearAccelAddr(0);
	assert.deepEqual(store.config.shaping.accelByTool, {});
});

test("resetSection returns the envelope to unset and leaves other sections alone", () => {
	const store = createConfigStore();
	store.setShaping({ envelope: { x: [0, 300], y: [10, 290] }, defaults: { distMm: 80 } });
	store.setAccelAddr(0, "0.0");
	store.setAxisRole("U", "Z motor 1");
	assert.deepEqual(store.config.shaping.envelope, box);

	store.resetSection("shaping");
	assert.deepEqual(store.config.shaping, DEFAULT_CONFIG.shaping);
	assert.equal(store.config.shaping.envelope, null);
	assert.equal(store.config.axisRoles["U"], "Z motor 1", "other sections kept");

	store.setShaping({ envelope: { x: [0, 300], y: [10, 290] } });
	store.resetAll();
	assert.deepEqual(store.config, DEFAULT_CONFIG);
});

test("hostile keys in the shaping section reach no prototype", () => {
	const hostile = JSON.parse(
		'{"shaping":{"__proto__":{"polluted":1},"accelByTool":{"__proto__":"0.0","constructor":"0.0","prototype":"0.0","0":"0.0"},'
		+ '"envelope":{"__proto__":{"x":[0,300]},"x":[0,300],"y":[0,300]}}}',
	) as unknown;
	const overlay = parseOverlay(hostile);
	assert.deepEqual(overlay, {
		shaping: { accelByTool: { "0": "0.0" }, envelope: { x: [0, 300], y: [0, 300] } },
	});
	assert.equal(({} as Record<string, unknown>)["polluted"], undefined);
	assert.equal(Object.getPrototypeOf(overlay.shaping?.accelByTool ?? {}), Object.prototype);

	const store = createConfigStore();
	assert.equal(({} as Record<string, unknown>)["polluted"], undefined);
	assert.equal(store.config.shaping.envelope, null);
});
