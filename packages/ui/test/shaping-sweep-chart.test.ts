/**
 * The sweep heatmap's layout and colour.
 *
 * `charts/SweepHeatmap.tsx` is a renderer with no arithmetic of its own, so
 * everything worth asserting about the chart is in `charts/sweepData.ts` and
 * testable here without a DOM (node:test cannot import a `.tsx`).
 *
 * The two tests that matter most are not the geometry ones:
 *
 *  - "a fixed peak and a speed-tracking peak land in different SHAPES" is the
 *    chart's whole reason to exist, machine-checked: a mode that rings at one
 *    frequency must occupy the same column in every speed row, and forced
 *    excitation must walk across the columns as speed rises. If a future change
 *    to the axis or the downsampling destroys that, this fails.
 *  - "the ramp is monotone in lightness on both shipped grounds" is the dataviz
 *    rule for a sequential scale (one hue, light→dark, anchor flipped in dark)
 *    checked against the real token values rather than against a screenshot.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCapture } from "../src/shaping/engine/capture.ts";
import { sweepMatrix, type SweepMatrix } from "../src/shaping/engine/sweep.ts";
import { hz, mmPerS, seconds, type Hz, type MmPerS } from "../src/shaping/engine/units.ts";
import {
	ampToT, cellReadout, contrast, DYNAMIC_RANGE_DB, fingerprintMarkers, heatmapCells, HZ_FLOOR,
	parseColor, RAMP_FALLBACK, sweepRamp, toHex,
} from "../src/charts/sweepData.ts";

const fx = (n: string): string => readFileSync(new URL(`./fixtures/shaping/${n}`, import.meta.url), "utf8");

/** The two shipped grounds, as the chart resolves them: `--mask-900` is the
 *  plot well and `--accent` is the hue. Values from src/index.css and
 *  src/theme-graphite.css; the theme test in this suite pins those files. */
const GROUNDS = [
	{ name: "vellum (light)", ground: "#dee5ee", accent: "#a85c17" },
	{ name: "graphite (dark)", ground: "#15171b", accent: "#2fc4d4" },
] as const;

/** A matrix with peaks placed exactly where the test wants them. */
function synthetic(opts: {
	speeds: number[];
	maxHz?: number;
	fullStepsPerMm?: number;
	/** `(speed) => [hz, amp][]` — the peaks that row carries. */
	peaks: (speed: number) => ReadonlyArray<readonly [number, number]>;
	/** A flat amplitude in every bin, to stand in for a noise floor. */
	floor?: number;
}): SweepMatrix {
	const maxHz = opts.maxHz ?? 700;
	const nBins = maxHz + 1;
	const freqs = new Float64Array(nBins);
	for (let i = 0; i < nBins; i++) freqs[i] = i;
	const amps = new Float64Array(opts.speeds.length * nBins);
	if (opts.floor !== undefined) amps.fill(opts.floor);
	opts.speeds.forEach((speed, r) => {
		for (const [f, a] of opts.peaks(speed)) {
			const bin = Math.round(f);
			if (bin >= 0 && bin < nBins) amps[r * nBins + bin] = a;
		}
	});
	return {
		speeds: opts.speeds.map(mmPerS) as readonly MmPerS[],
		freqs,
		amps,
		fullStepHz: opts.speeds.map(s => hz(s * (opts.fullStepsPerMm ?? 5))) as readonly Hz[],
		maxHz,
	};
}

/** The column index of the loudest cell in one speed row. */
function loudestColumn(layout: ReturnType<typeof heatmapCells>, speedIndex: number): number {
	let best = -1;
	let amp = -1;
	for (let c = 0; c < layout.cols; c++) {
		const cell = layout.cells[speedIndex * layout.cols + c]!;
		if (cell.amp > amp) {
			amp = cell.amp;
			best = c;
		}
	}
	return best;
}

// ---------------------------------------------------------------------------
// What the chart exists for
// ---------------------------------------------------------------------------

test("a fixed-frequency peak is a vertical stripe and a speed-tracking peak is a slope", () => {
	// Two peaks per row: one that rings at 250 Hz whatever the speed, and one
	// forced at speed × 2 Hz. On the drawn layout the first must occupy ONE
	// column across every row and the second must walk monotonically across
	// them — that difference is the entire reading the chart supports.
	const speeds = [20, 40, 80, 160];
	const m = synthetic({
		speeds,
		peaks: speed => [
			[250, 1],
			[speed * 2, 0.8],
		],
	});
	const l = heatmapCells(m, 600, 200);
	assert.equal(l.rows, 4);

	const columnOf = (hzWanted: number): number => Math.max(0, Math.min(l.cols - 1, Math.floor((l.xOfHz(hzWanted) / l.w) * l.cols)));

	// The fixed peak: one column, every row.
	const fixedCols = speeds.map((_, r) => {
		const c = columnOf(250);
		assert.ok(l.cells[r * l.cols + c]!.amp >= 1, `row ${r} lost the 250 Hz peak`);
		return c;
	});
	assert.equal(new Set(fixedCols).size, 1);

	// The tracking peak: a strictly increasing column, and a slope wide enough
	// to see — not a one-column nudge.
	const trackCols = speeds.map(s => columnOf(s * 2));
	for (let i = 1; i < trackCols.length; i++) {
		assert.ok(trackCols[i]! > trackCols[i - 1]!, `tracking peak did not move: ${trackCols.join(",")}`);
	}
	assert.ok(trackCols[3]! - trackCols[0]! > l.cols / 4, `slope too shallow: ${trackCols.join(",")}`);
	// And the row's own loudest cell is the fixed one, so a reader following
	// the brightest mark is following the mode, not the forced line.
	for (let r = 0; r < 4; r++) assert.equal(loudestColumn(l, r), fixedCols[0]);
});

test("the low-frequency ring modes are separated, which a linear axis would not do", () => {
	// Gabe's fitted X and Y modes. On a linear 0..700 Hz axis at a card width
	// they are 15 px and 44 px from the left edge and read as one smudge; the
	// log axis is here to fix exactly that, so the fix is asserted.
	const l = heatmapCells(synthetic({ speeds: [50], peaks: () => [] }), 600, 200);
	const x18 = l.xOfHz(18.1);
	const x51 = l.xOfHz(51.7);
	const x250 = l.xOfHz(250);
	assert.ok(x51 - x18 > 100, `18.1 and 51.7 Hz only ${(x51 - x18).toFixed(0)} px apart`);
	assert.ok(x250 - x51 > 100, `51.7 and 250 Hz only ${(x250 - x51).toFixed(0)} px apart`);
	// Linear would have put them here — kept as the comparison the claim rests on.
	assert.ok((18.1 / 700) * 600 < 20 && (51.7 / 700) * 600 < 50);
});

test("a one-bin peak survives downsampling at every plot width", () => {
	// Columns take the LOUDEST bin they cover, not the mean. A 1 Hz-wide mode is
	// exactly what averaging would erase, and erasing it is how a shapeable mode
	// becomes invisible.
	const m = synthetic({ speeds: [50], peaks: () => [[51, 0.9]], floor: 0.0005 });
	for (const w of [80, 137, 240, 601, 1200]) {
		const l = heatmapCells(m, w, 60);
		const peak = l.cells.reduce((best, c) => (c.amp > best.amp ? c : best), l.cells[0]!);
		assert.equal(peak.amp, 0.9, `width ${w}`);
		assert.equal(peak.hz, 51, `width ${w} named the wrong bin`);
		assert.equal(peak.t, 1, `width ${w}`);
	}
});

// ---------------------------------------------------------------------------
// heatmapCells: geometry
// ---------------------------------------------------------------------------

test("heatmapCells tiles the box exactly: rows × cols, no gaps, no overlaps", () => {
	const l = heatmapCells(synthetic({ speeds: [10, 20, 30], peaks: () => [] }), 500, 210);
	assert.equal(l.rows, 3);
	assert.equal(l.cells.length, l.rows * l.cols);
	assert.ok(l.cols > 1 && l.cols <= 701);
	for (let r = 0; r < l.rows; r++) {
		for (let c = 0; c < l.cols; c++) {
			const cell = l.cells[r * l.cols + c]!;
			assert.equal(cell.speedIndex, r);
			assert.ok(Math.abs(cell.x - c * l.cellW) < 1e-9, "column x");
			assert.ok(Math.abs(cell.w - l.cellW) < 1e-9, "column w");
			assert.ok(Math.abs(cell.h - l.cellH) < 1e-9, "row h");
		}
	}
	// Row 0 is the slowest and sits at the BOTTOM: speed increases upward.
	assert.ok(Math.abs(l.cells[0]!.y - (210 - l.cellH)) < 1e-9);
	assert.ok(Math.abs(l.cells[2 * l.cols]!.y - 0) < 1e-9);
	// Speed labels agree with the rows they label.
	assert.deepEqual(l.speedTicks.map(t => t.speed), [10, 20, 30]);
	assert.ok(l.speedTicks[0]!.y > l.speedTicks[2]!.y);
});

test("the frequency axis spans HZ_FLOOR..maxHz and is monotone", () => {
	const l = heatmapCells(synthetic({ speeds: [50], peaks: () => [], maxHz: 700 }), 400, 40);
	assert.deepEqual(l.hzRange, [HZ_FLOOR, 700]);
	assert.equal(l.xOfHz(HZ_FLOOR), 0);
	assert.equal(l.xOfHz(700), 400);
	assert.equal(l.xOfHz(1), 0, "below the band clamps to the left edge");
	assert.equal(l.xOfHz(5000), 400, "above the band clamps to the right edge");
	let prev = -1;
	for (let f = HZ_FLOOR; f <= 700; f += 1) {
		const x = l.xOfHz(f);
		assert.ok(x >= prev, `x fell at ${f} Hz`);
		prev = x;
	}
	assert.ok(l.inBand(18.1) && l.inBand(700) && !l.inBand(1) && !l.inBand(701));
	// Decade and half-decade gridlines, inside the band and in order.
	assert.deepEqual(l.hzTicks.map(t => t.hz), [5, 10, 20, 50, 100, 200, 500]);
});

test("the full-step overlay follows speed and reports leaving the band", () => {
	const l = heatmapCells(synthetic({ speeds: [20, 50, 100, 200], peaks: () => [], fullStepsPerMm: 5 }), 600, 200);
	assert.deepEqual(l.fullStep.map(p => p.hz), [100, 250, 500, 1000]);
	for (let i = 1; i < l.fullStep.length; i++) assert.ok(l.fullStep[i]!.x >= l.fullStep[i - 1]!.x);
	assert.deepEqual(l.fullStep.map(p => p.inRange), [true, true, true, false]);
	// The out-of-band point is clamped to the edge.
	assert.equal(l.fullStep[3]!.x, 600);
	// Each point sits on its row's centre line.
	l.fullStep.forEach((p, r) => assert.ok(Math.abs(p.y - l.speedTicks[r]!.y) < 1e-9));
});

test("the full-step locus never draws a vertical segment along the frame edge", () => {
	// A vertical line is how a FIXED-frequency mode reads. Two clamped points in
	// a row draw exactly that along the frame, and the first render of this
	// chart did (2026-08-23). Off-scale rows are chevrons instead.
	const l = heatmapCells(
		synthetic({ speeds: [20, 50, 100, 200, 400], peaks: () => [], fullStepsPerMm: 5 }),
		600,
		250,
	);
	assert.deepEqual(l.fullStep.map(p => p.inRange), [true, true, true, false, false]);
	// The line runs through the in-band rows plus ONE clamped point, so it is
	// seen leaving the frame; the rest are chevrons.
	assert.deepEqual(l.fullStepPath.line.map(p => p.speedIndex), [0, 1, 2, 3]);
	assert.deepEqual(l.fullStepPath.offScale, [{ speedIndex: 4, y: l.fullStep[4]!.y, side: "right" }]);
	// At most one clamped point can be on the line, so no two consecutive line
	// points share the frame edge.
	const atEdge = l.fullStepPath.line.filter(p => p.x === 0 || p.x === l.w);
	assert.ok(atEdge.length <= 1, "two clamped points would join into a frame-edge stripe");

	// Nothing in band at all: no line, every row a chevron.
	const none = heatmapCells(synthetic({ speeds: [400, 800], peaks: () => [], fullStepsPerMm: 5 }), 600, 100);
	assert.deepEqual(none.fullStepPath.line, []);
	assert.deepEqual(none.fullStepPath.offScale.map(o => o.side), ["right", "right"]);

	// Off the LOW end leans the other way.
	const slow = heatmapCells(synthetic({ speeds: [0.2, 0.4, 20], peaks: () => [], fullStepsPerMm: 5 }), 600, 100);
	assert.deepEqual(slow.fullStep.map(p => p.inRange), [false, false, true]);
	assert.deepEqual(slow.fullStepPath.offScale.map(o => o.side), ["left"]);
	assert.deepEqual(slow.fullStepPath.line.map(p => p.speedIndex), [1, 2]);
});

// ---------------------------------------------------------------------------
// The invariant: one pixel mapping for paint and for hover
// ---------------------------------------------------------------------------

test("cellAt returns the very cell drawn under the point, for every cell", () => {
	const l = heatmapCells(synthetic({ speeds: [20, 50, 100], peaks: () => [] }), 517, 193);
	for (const cell of l.cells) {
		// Identity, not equality: cellAt must hand back the object the painter
		// drew, so a tooltip cannot describe a different rectangle.
		assert.equal(l.cellAt(cell.x + cell.w / 2, cell.y + cell.h / 2), cell, "centre");
		assert.equal(l.cellAt(cell.x, cell.y), cell, "top-left corner");
		assert.equal(l.cellAt(cell.x + cell.w - 1e-6, cell.y + cell.h - 1e-6), cell, "bottom-right corner");
	}
});

test("cellAt sweeps the whole box without a hole, and refuses everything outside it", () => {
	const l = heatmapCells(synthetic({ speeds: [20, 50], peaks: () => [] }), 300, 120);
	for (let px = 0; px < 300; px += 0.5) {
		for (let py = 0; py < 120; py += 3) {
			const cell = l.cellAt(px, py);
			assert.notEqual(cell, null, `hole at ${px},${py}`);
			assert.ok(px >= cell!.x && px < cell!.x + cell!.w && py >= cell!.y && py < cell!.y + cell!.h);
		}
	}
	for (const [px, py] of [[-1, 10], [10, -1], [300, 10], [10, 120], [NaN, 10], [10, Infinity]]) {
		assert.equal(l.cellAt(px!, py!), null, `${px},${py}`);
	}
});

test("degenerate input gives an empty layout rather than a throw or a NaN", () => {
	const m = synthetic({ speeds: [20], peaks: () => [] });
	for (const [w, h] of [[0, 100], [100, 0], [-5, 100], [NaN, 100], [100, Infinity]]) {
		const l = heatmapCells(m, w!, h!);
		assert.equal(l.cells.length, 0);
		assert.equal(l.cellAt(0, 0), null);
		assert.equal(l.xOfHz(100), 0);
	}
	assert.equal(heatmapCells(null, 400, 100).cells.length, 0);
	const noSpeeds: SweepMatrix = { speeds: [], freqs: new Float64Array(701), amps: new Float64Array(0), fullStepHz: [], maxHz: 700 };
	assert.equal(heatmapCells(noSpeeds, 400, 100).cells.length, 0);
});

test("a matrix of silence colours as an empty well, not a NaN", () => {
	const l = heatmapCells(synthetic({ speeds: [20, 50], peaks: () => [] }), 200, 80);
	assert.equal(l.maxAmp, 0);
	for (const cell of l.cells) assert.equal(cell.t, 0);
});

test("drift under HZ_FLOOR cannot set the top of the ramp", () => {
	// A huge low-frequency term is the move's own acceleration, not a mode. If
	// it were allowed to normalise the scale, every real peak would flatten into
	// the ground — which is what the chart looked like before this clamp.
	const m = synthetic({ speeds: [50], peaks: () => [[1, 50], [250, 0.4]] });
	const l = heatmapCells(m, 400, 60);
	assert.equal(l.maxAmp, 0.4);
	const peak = l.cells.reduce((best, c) => (c.amp > best.amp ? c : best), l.cells[0]!);
	assert.equal(peak.t, 1);
});

// ---------------------------------------------------------------------------
// Amplitude → ramp position
// ---------------------------------------------------------------------------

test("ampToT is dB over the declared dynamic range, and total", () => {
	assert.equal(DYNAMIC_RANGE_DB, 40);
	assert.equal(ampToT(1, 1), 1);
	assert.ok(Math.abs(ampToT(0.1, 1) - 0.5) < 1e-9, "-20 dB is half the ramp");
	assert.equal(ampToT(0.01, 1), 0, "-40 dB is the floor");
	assert.equal(ampToT(0.0001, 1), 0, "past the floor stays at the floor");
	assert.equal(ampToT(0, 1), 0);
	assert.equal(ampToT(1, 0), 0, "an empty matrix has no scale");
	assert.equal(ampToT(-1, 1), 0);
	assert.ok(Number.isFinite(ampToT(NaN, 1)));
});

// ---------------------------------------------------------------------------
// Colour: the dataviz sequential rule, checked on the real tokens
// ---------------------------------------------------------------------------

test("the ramp is one hue, monotone in lightness, on both shipped grounds", () => {
	for (const g of GROUNDS) {
		const ground = parseColor(g.ground)!;
		const accent = parseColor(g.accent)!;
		const ramp = sweepRamp(ground, accent, 32);
		assert.equal(ramp.length, 32);
		const steps = ramp.map(hex => parseColor(hex)!);

		// Step 0 IS the ground: an empty cell disappears into the well.
		assert.equal(ramp[0], g.ground.toLowerCase(), `${g.name} anchor`);

		// Monotone lightness, in whichever direction the ground demands. This is
		// the "flips anchor in dark" half of the rule, and it is derived rather
		// than written down: paper darkens, graphite lightens.
		const dir = Math.sign(steps[1]!.l - steps[0]!.l);
		assert.notEqual(dir, 0, `${g.name} has no direction`);
		for (let i = 1; i < steps.length; i++) {
			assert.equal(Math.sign(steps[i]!.l - steps[i - 1]!.l), dir, `${g.name} step ${i} reverses`);
		}
		assert.equal(dir, ground.l > 0.5 ? -1 : 1, `${g.name} ramps the wrong way`);

		// One hue: every step carrying visible chroma sits on the accent's hue.
		// Measured worst cases, both benign and both bounded well inside a hue
		// family (~30°): graphite 6.1° at step 9, where the ground's blue tint has
		// not quite finished fading; vellum 5.1° at the TOP step, where copper at
		// L 0.46 / C 0.125 is outside the sRGB gamut and `toHex` clips it. Neither
		// is a second hue — they are the ends of one.
		for (const s of steps) {
			if (s.c < 0.03) continue;
			const d = Math.abs(((s.h - accent.h + 540) % 360) - 180);
			assert.ok(d < 8, `${g.name} drifted ${d.toFixed(1)}° off the accent hue`);
		}

		// Legible against the well it sits in, and the top of the scale is a
		// clear mark rather than a slightly different grey.
		assert.ok(contrast(steps[31]!, ground) >= 3, `${g.name} top step ${contrast(steps[31]!, ground).toFixed(2)}:1`);
		assert.ok(contrast(steps[16]!, ground) >= 1.5, `${g.name} mid step too close to the well`);
		// And the ramp actually spends its range: a half-step peak must be
		// visibly different from a full one.
		assert.ok(Math.abs(steps[31]!.l - steps[16]!.l) > 0.15, `${g.name} top half is flat`);
	}
});

test("the ramp degrades rather than fails on a ground it cannot read", () => {
	// A ground could legitimately declare rgb(); anything else falls back.
	assert.ok(parseColor("rgb(30, 33, 40)") !== null);
	assert.ok(parseColor("rgba(30, 33, 40, 0.5)") !== null);
	assert.ok(parseColor("#abc") !== null);
	assert.equal(parseColor("oklch(0.5 0.1 200)"), null);
	assert.equal(parseColor("rebeccapurple"), null);
	assert.equal(parseColor(""), null);
	// Both fallbacks are the same literal, so the two failure paths cannot end
	// up on two different coppers.
	assert.ok(parseColor(RAMP_FALLBACK.ground) !== null && parseColor(RAMP_FALLBACK.accent) !== null);
	// A ground and an accent at the same lightness still yields a direction.
	const flat = sweepRamp({ l: 0.5, c: 0.01, h: 200 }, { l: 0.5, c: 0.12, h: 200 }, 8);
	assert.equal(new Set(flat).size, 8);
});

test("hex round-trips through OKLCH", () => {
	for (const hex of ["#000000", "#ffffff", "#a85c17", "#2fc4d4", "#dee5ee", "#15171b"]) {
		assert.equal(toHex(parseColor(hex)!), hex);
	}
});

test("the shipped grounds still hold the token values this suite validates", () => {
	// The ramp is only "validated in both themes" while these are the tokens.
	const index = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
	const graphite = readFileSync(new URL("../src/theme-graphite.css", import.meta.url), "utf8");
	assert.match(index, /--mask-900:\s*#dee5ee;/);
	assert.match(index, /--accent:\s*#a85c17;/);
	assert.match(graphite, /--mask-900:\s*#15171b;/);
	assert.match(graphite, /--accent:\s*#2fc4d4;/);
	assert.equal(RAMP_FALLBACK.ground, "#dee5ee");
	assert.equal(RAMP_FALLBACK.accent, "#a85c17");
});

// ---------------------------------------------------------------------------
// Markers and the tooltip's words
// ---------------------------------------------------------------------------

test("fingerprintMarkers skips the axes that did not fit", () => {
	assert.deepEqual(fingerprintMarkers([{ axis: "X", hz: 18.14 }, { axis: "Y", hz: null }]), [
		{ hz: 18.14, label: "X 18.1 Hz" },
	]);
	assert.deepEqual(fingerprintMarkers([{ axis: "X", hz: 0 }, { axis: "Y", hz: NaN }]), []);
});

test("cellReadout names the measured bin, the row's speed and the amplitude", () => {
	const l = heatmapCells(synthetic({ speeds: [62.5], peaks: () => [[51, 0.0421]] }), 400, 40);
	const peak = l.cells.reduce((best, c) => (c.amp > best.amp ? c : best), l.cells[0]!);
	assert.deepEqual(cellReadout(peak), { speed: "63 mm/s", hz: "51.0 Hz", amp: "0.0421 g" });
	const loud = heatmapCells(synthetic({ speeds: [100], peaks: () => [[250, 1.5557]] }), 400, 40);
	const c = loud.cells.reduce((best, x) => (x.amp > best.amp ? x : best), loud.cells[0]!);
	assert.deepEqual(cellReadout(c), { speed: "100 mm/s", hz: "250 Hz", amp: "1.556 g" });
});

// ---------------------------------------------------------------------------
// The real machine
// ---------------------------------------------------------------------------

test("Gabe's baseline sweep: the 250 Hz stripe is visible in every row that has it", () => {
	const rows = [20, 50, 100, 200].map(speed => {
		const r = parseCapture(fx(`baseline_X_${speed}.csv`));
		if (!r.ok) throw new Error(String(speed));
		return { speed: mmPerS(speed), capture: r.capture, moveS: seconds(100 / speed) };
	});
	const l = heatmapCells(sweepMatrix(rows, 5), 600, 200);
	const colOf = (f: number): number => Math.min(l.cols - 1, Math.floor((l.xOfHz(f) / l.w) * l.cols));
	const c250 = colOf(250);

	// The three fast rows peak on the 250 Hz column and every one of them lands
	// in the top half of the ramp — the measured reason DYNAMIC_RANGE_DB is 40
	// and not a linear scale, where the 50 mm/s row would sit at 0.30 and the
	// 200 mm/s row at 0.27 of full.
	for (const r of [1, 2, 3]) {
		assert.equal(loudestColumn(l, r), c250, `row ${r} peaked elsewhere`);
		const t = l.cells[r * l.cols + c250]!.t;
		assert.ok(t > 0.5, `row ${r} would render at t=${t.toFixed(2)}`);
	}
	// The slowest row's own peak is at its full-step rate, 100 Hz, and it is
	// 29.7 dB down on the matrix maximum — still a visible mark.
	const c100 = colOf(100);
	assert.equal(loudestColumn(l, 0), c100);
	const faint = l.cells[c100]!.t;
	assert.ok(faint > 0.2 && faint < 0.4, `slow row at t=${faint.toFixed(3)}`);

	// And it reads as a stripe: the column either side of 250 Hz is quieter in
	// every row, so the mark has an edge rather than being a wash.
	for (const r of [1, 2, 3]) {
		const here = l.cells[r * l.cols + c250]!.t;
		assert.ok(l.cells[r * l.cols + c250 - 4]!.t < here - 0.1, `row ${r} left shoulder`);
		assert.ok(l.cells[r * l.cols + c250 + 4]!.t < here - 0.1, `row ${r} right shoulder`);
	}
});
