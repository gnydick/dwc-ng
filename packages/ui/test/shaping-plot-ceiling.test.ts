/**
 * How wide the sweep heat map should be.
 *
 * Gabe, 2026-08-24: *"would be good to have the sweep heatmap go out as far as
 * that dotted line goes out plus a little more so it doesn't terminate right on
 * the plot's edge"*. The dotted line is the full-step locus — the thing the
 * whole chart is read against — so a plot that stops exactly where the line
 * does gives the eye nothing to judge its top by.
 *
 * The ceiling was a fixed 700 Hz, which was wrong in both directions: too
 * narrow for a fast ladder (his tops out at 1000 Hz) and far too wide for the
 * slow one his own coverage finding asks him to run (25-75 Hz).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { plotCeiling, sweepMatrix, type SweepRow } from "../src/shaping/engine/sweep.ts";
import { sweepCaveats } from "../src/shaping/evidence/findings.ts";
import { caveatText } from "../src/shaping/copy.ts";
import type { Capture } from "../src/shaping/engine/capture.ts";
import { hz, mmPerS, seconds } from "../src/shaping/engine/units.ts";

/** A capture of the given rate; the samples are not what these tests are about. */
const cap = (rate: number, n = 1500): Capture => ({
	rate: hz(rate),
	durationS: seconds(n / rate),
	x: new Float64Array(n),
	y: new Float64Array(n),
	z: new Float64Array(n),
});

const rows = (speeds: readonly number[], rate = 1377): SweepRow[] =>
	speeds.map(s => ({ speed: mmPerS(s), capture: cap(rate), moveS: seconds(60 / s), axis: 0 as const }));

const PER_MM = 5;

test("a slow ladder gets a plot sized to it, not a 700 Hz one", () => {
	// 5-15 mm/s at 5 full steps/mm forces 25-75 Hz. On a 700 Hz plot that is a
	// sliver at the left with nothing to see; the locus needs to be legible.
	const c = plotCeiling(rows([5, 8, 11, 15]), PER_MM);
	assert.ok(c > 75, "must reach past the top of the locus");
	assert.ok(c < 200, `far too wide: ${c}`);
});

test("the plot always reaches past the locus, so the line does not end at the edge", () => {
	for (const speeds of [[5, 15], [10, 40], [20, 60], [25, 100]]) {
		const locus = Math.max(...speeds) * PER_MM;
		const c = plotCeiling(rows(speeds), PER_MM);
		assert.ok(c > locus, `${c} Hz does not clear a locus of ${locus} Hz`);
	}
});

test("but never past Nyquist, because there is nothing up there to draw", () => {
	// A bin above half the sampling rate holds nothing and never can. Painting
	// it black reads as "the machine is quiet there" rather than "the
	// instrument cannot look".
	const c = plotCeiling(rows([25, 200], 1377), PER_MM);
	assert.ok(c <= 688, `${c} Hz is above Nyquist`);
	assert.ok(c > 600, `${c} Hz throws away usable band`);
});

test("the slowest capture's rate sets the limit, not the fastest", () => {
	// A mixed-rate sweep can only be plotted as far as its worst row.
	const mixed = [...rows([25], 1377), ...rows([200], 400)];
	assert.ok(plotCeiling(mixed, PER_MM) <= 200);
});

test("with nothing to derive from it keeps the historical width", () => {
	assert.equal(plotCeiling([], PER_MM), 700);
	assert.equal(plotCeiling(rows([25]), 0), 700);
});

test("the matrix reports the ceiling it actually used", () => {
	const m = sweepMatrix(rows([5, 15]), PER_MM);
	assert.equal(m.freqs.length, m.maxHz + 1);
	assert.ok(m.maxHz > 75 && m.maxHz < 200);
	// An explicit ceiling still wins, so a caller can pin one.
	assert.equal(sweepMatrix(rows([5, 15]), PER_MM, 400).maxHz, 400);
});

test("a ladder that outruns the accelerometer says so", () => {
	// His: 200 mm/s at 5 full steps/mm forces 1000 Hz against a 688 Hz Nyquist.
	const m = sweepMatrix(rows([25, 34, 45, 61, 82, 110, 149, 200]), PER_MM);
	const c = sweepCaveats(m, null).find(x => x.kind === "locus-above-nyquist");
	assert.ok(c !== undefined && c.kind === "locus-above-nyquist");
	assert.deepEqual(c.speeds, [149, 200]);
	assert.equal(c.forcedHz, 1000);
	const text = caveatText(c);
	assert.match(text, /149, 200/);
	// The point of the sentence: the black is the instrument, not the machine.
	assert.match(text, /instrument, not the machine/);
});

test("a ladder inside Nyquist says nothing about it", () => {
	const m = sweepMatrix(rows([5, 8, 11, 15]), PER_MM);
	assert.equal(sweepCaveats(m, null).filter(c => c.kind === "locus-above-nyquist").length, 0);
});
