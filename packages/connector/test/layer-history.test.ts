/**
 * The standalone layer-history synthesis (connector/layerHistory.ts):
 * RRF keeps no per-layer stats, so the connector derives them from
 * observed polls — same behavior model as official DWC's PollConnector
 * (the reference's edge cases, our own implementation). Pure module,
 * pure tests: sequences of observations in, expected layer arrays out.
 *
 * Cadence note: baselines advance on the FIRST observation after the
 * print starts (the 0→layer pseudo-transition), so a real poll loses at
 * most one tick (~500ms) of layer 1 — the tests observe at poll-like
 * cadence to mirror that.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLayerHistory, type LayerObservation } from "../src/layerHistory.ts";

const obs = (partial: Partial<LayerObservation>): LayerObservation => ({
	duration: null,
	layer: null,
	warmUpDuration: null,
	filePosition: null,
	fileSize: null,
	zPosition: null,
	rawExtrusion: [],
	temperatures: [],
	...partial,
});

test("a print starts empty; a completed layer appears when the next begins", () => {
	const h = createLayerHistory();
	assert.equal(h.observe(obs({})), null, "idle: nothing");
	assert.deepEqual(h.observe(obs({ duration: 0, layer: 1 })), [], "print start: fresh empty history");
	assert.equal(h.observe(obs({ duration: 0, layer: 1 })), null, "baseline tick: no completed layer yet");
	assert.equal(h.observe(obs({ duration: 40, layer: 1 })), null, "mid-layer: no change");
	const one = h.observe(obs({ duration: 70, layer: 2, temperatures: [210, 60] }));
	assert.ok(one);
	assert.equal(one.length, 1);
	assert.equal(one[0]!.duration, 70, "layer 1 took the print duration so far");
	assert.deepEqual(one[0]!.temperatures, [210, 60]);
});

test("warm-up time is excluded from the first layer", () => {
	const h = createLayerHistory();
	h.observe(obs({ duration: 90, layer: 1, warmUpDuration: 90 }));
	h.observe(obs({ duration: 90, layer: 1, warmUpDuration: 90 }));
	const one = h.observe(obs({ duration: 160, layer: 2, warmUpDuration: 90 }));
	assert.ok(one);
	assert.equal(one[0]!.duration, 70, "160 total - 90 warm-up = 70 printing");
});

test("a multi-layer jump spreads the elapsed stats as averages", () => {
	const h = createLayerHistory();
	h.observe(obs({ duration: 0, layer: 1, rawExtrusion: [0] }));
	h.observe(obs({ duration: 0, layer: 1, rawExtrusion: [0] }));
	const four = h.observe(obs({ duration: 120, layer: 5, rawExtrusion: [40], zPosition: 1.0 }));
	assert.ok(four);
	assert.equal(four.length, 4, "layers 1..4 are complete");
	for (const layer of four) {
		assert.equal(layer.duration, 30, "120s over 4 layers");
		assert.deepEqual(layer.filament, [10], "40mm over 4 layers");
	}
});

test("sequential printing (layer number drops) folds into the layer it left", () => {
	const h = createLayerHistory();
	h.observe(obs({ duration: 0, layer: 1 }));
	h.observe(obs({ duration: 0, layer: 1 }));
	assert.equal(h.observe(obs({ duration: 30, layer: 3 }))!.length, 2, "layers 1,2 complete");
	const folded = h.observe(obs({ duration: 50, layer: 2 }));
	assert.ok(folded);
	assert.equal(folded.length, 3, "the drop creates/updates layer 3's entry");
	assert.equal(folded[2]!.duration, 20, "the 20s since entering layer 3 belong to layer 3");
});

test("a new print resets the history by construction", () => {
	const h = createLayerHistory();
	h.observe(obs({ duration: 0, layer: 1 }));
	h.observe(obs({ duration: 0, layer: 1 }));
	assert.ok(h.observe(obs({ duration: 60, layer: 3 })));
	assert.equal(h.observe(obs({})), null, "print ended");
	assert.deepEqual(h.observe(obs({ duration: 5, layer: 1 })), [], "the next print starts from NOTHING");
});

test("connecting mid-print backfills the missed layers as uniform averages", () => {
	const h = createLayerHistory();
	assert.deepEqual(h.observe(obs({ duration: 900, layer: 43 })), [], "first sight: reset");
	const backfilled = h.observe(obs({ duration: 900, layer: 43 }));
	assert.ok(backfilled, "the 0→43 pseudo-transition IS the backfill");
	assert.equal(backfilled.length, 42, "layers 1..42 exist, spread uniformly");
	assert.ok(Math.abs(backfilled[0]!.duration - 900 / 43) < 1e-9);
	const next = h.observe(obs({ duration: 930, layer: 44 }));
	assert.ok(next);
	assert.equal(next.length, 43);
	assert.equal(next[42]!.duration, 30, "layer 43 measured for real from here on");
});

test("the emitted array is a value, not a window into internal state", () => {
	const h = createLayerHistory();
	h.observe(obs({ duration: 0, layer: 1 }));
	h.observe(obs({ duration: 0, layer: 1 }));
	const first = h.observe(obs({ duration: 30, layer: 2 }))!;
	first[0]!.duration = 999;
	first[0]!.filament.push(123);
	const second = h.observe(obs({ duration: 60, layer: 3 }))!;
	assert.equal(second[0]!.duration, 30, "mutating an emitted array cannot corrupt the history");
	assert.deepEqual(second[0]!.filament, []);
});
