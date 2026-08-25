import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_SWEEP, resolvePick, speedFamilies } from "../src/shaping/captures.ts";
import { createFitCache } from "../src/shaping/fitCache.ts";
import { fullStepPerMm } from "../src/shaping/fullStep.ts";
import { analysedRows, sweepMatrix } from "../src/shaping/engine/sweep.ts";
import { parseCapture } from "../src/shaping/engine/capture.ts";
import { mmPerS, seconds } from "../src/shaping/engine/units.ts";
import { handle } from "../src/shaping/worker.ts";
import { emptyResults } from "../src/shaping/results.ts";
import { parseResults, serializeResults } from "../src/shaping/resultsCodec.ts";
import { sweepStateText } from "../src/shaping/copy.ts";
import { heatmapCells } from "../src/charts/sweepData.ts";
import type { Axis as OmAxis } from "../src/om/types.ts";
import type { Mode } from "../src/shaping/engine/fit.ts";

const fx = (n: string): string => readFileSync(new URL(`./fixtures/shaping/${n}`, import.meta.url), "utf8");

/* ----------------------------------------------------- families in the names */

/**
 * The names are Gabe's own, taken off `0:/sys/accelerometer` on 2026-08-23
 * (259 CSVs, 184 of them speed-suffixed). The shapes that matter are all here:
 * the nine-speed sweep, a lowercase axis letter, a Y run, and the two decoys —
 * a ring capture and a capture whose name ends in a number that is NOT a speed.
 */
const BOARD_NAMES = [
	"lowspeed_stock_X_10.csv", "lowspeed_stock_X_15.csv", "lowspeed_stock_X_20.csv",
	"lowspeed_stock_X_25.csv", "lowspeed_stock_X_30.csv", "lowspeed_stock_X_33.csv",
	"lowspeed_stock_X_40.csv", "lowspeed_stock_X_50.csv", "lowspeed_stock_X_60.csv",
	"baseline_X_20.csv", "baseline_X_50.csv", "baseline_X_100.csv", "baseline_X_200.csv",
	"baseline_y_Y_50.csv", "baseline_y_Y_100.csv", "baseline_y_Y_200.csv",
	"u20_X_50.csv", "u20_X_100.csv",
	"base_x_20.csv", "base_x_50.csv",
	"half_i_x_100.csv",
	"ring1_Xp0.csv", "ring1_Ym2.csv",
	"1-T0-X67.273-317.273-20.0-none.csv",
	"B_i1400_y8_5_f8_X_100.csv",
];

test("speedFamilies: the nine-speed sweep comes out whole, ascending, and first", () => {
	const fams = speedFamilies(BOARD_NAMES);
	const first = fams[0]!;
	assert.equal(first.id, "lowspeed_stock_X");
	assert.equal(first.axis, "X");
	assert.deepEqual(first.members.map(m => m.speed), [10, 15, 20, 25, 30, 33, 40, 50, 60]);
	assert.equal(first.members[0]!.file, "lowspeed_stock_X_10.csv");
	// Biggest first, so the run that is actually a sweep leads a picker holding
	// eighty two-point families.
	for (let i = 1; i < fams.length; i++) {
		assert.ok(fams[i - 1]!.members.length >= fams[i]!.members.length, "descending by member count");
	}
});

test("speedFamilies: the axis comes from the name's own letter, lowercase included", () => {
	const byId = new Map(speedFamilies(BOARD_NAMES).map(f => [f.id, f]));
	assert.equal(byId.get("baseline_y_Y")!.axis, "Y");
	assert.equal(byId.get("base_x")!.axis, "X", "a lowercase x is still the X channel");
	assert.equal(byId.get("baseline_X")!.axis, "X");
});

test("speedFamilies: names that are not <prefix>_<axis>_<speed> are not sweeps", () => {
	const ids = speedFamilies(BOARD_NAMES).map(f => f.id);
	// A ring capture (`_Xp0`), a slicer-ish name with numbers all over it, and a
	// single-member family must all stay out.
	assert.ok(!ids.some(id => id.startsWith("ring1")), `ring captures leaked: ${ids.join(",")}`);
	assert.ok(!ids.includes("half_i_x"), "one speed is not a sweep");
	assert.ok(!ids.some(id => id.includes("none")), "a name with no axis token is not a sweep");
});

test("speedFamilies: two captures at the same speed are ONE row, and the first name wins", () => {
	// The listing arrives newest-first (captures.ts byNewest), so the surviving
	// row is the most recent capture at that speed — a repeat run drawn twice
	// would make the picture look twice as resolved as it is.
	const fams = speedFamilies(["s_X_50.csv", "s_X_50.csv", "s_X_100.csv"]);
	assert.equal(fams.length, 1);
	assert.deepEqual(fams[0]!.members.map(m => m.speed), [50, 100]);
});

test("speedFamilies: `min` is a floor on DISTINCT speeds", () => {
	assert.equal(speedFamilies(["s_X_50.csv"], 2).length, 0);
	assert.equal(speedFamilies(["s_X_50.csv", "s_X_100.csv"], 3).length, 0);
	assert.equal(speedFamilies(BOARD_NAMES, 3).map(f => f.id).sort().join(","),
		"baseline_X,baseline_y_Y,lowspeed_stock_X");
});

test("speedFamilies: the real listing never exceeds the download cap", () => {
	// Not a tautology: the cap exists so a name pattern that accidentally
	// collected fifty files cannot become fifty requests, and the biggest thing
	// on the board today has to be inside it or the picker offers a run the
	// service will refuse.
	for (const f of speedFamilies(BOARD_NAMES)) {
		assert.ok(f.members.length <= MAX_SWEEP, `${f.id} has ${f.members.length}`);
	}
});

/* ------------------------------------------------------- the full-step rate */

const omAxis = (letter: string, extra: Partial<OmAxis> = {}): OmAxis => ({
	letter, homed: true, machinePosition: 0, userPosition: 0, min: 0, max: 300, babystep: 0, visible: true,
	...extra,
});

test("fullStepPerMm: the machine's own numbers, divided — never a default", () => {
	// Gabe's X: 80 microsteps/mm at 16x, so 5 FULL steps/mm, so 100 mm/s excites
	// 500 Hz. This is the number the whole forced-vibration overlay is drawn
	// from (packages/mock-duet/captures/om-snapshot-2026-07-12.json).
	const axes = [omAxis("X", { stepsPerMm: 80, microstepping: { value: 16 } })];
	const step = fullStepPerMm(axes, "X");
	assert.ok(step.known);
	assert.equal(step.perMm, 5);
	assert.match(step.from, /80/);
	assert.match(step.from, /16/);
});

test("fullStepPerMm: a missing field is a REASON, not a guess", () => {
	const noMicro = fullStepPerMm([omAxis("X", { stepsPerMm: 80 })], "X");
	assert.equal(noMicro.known, false);
	assert.ok(!noMicro.known && noMicro.why.includes("microstepping"));

	const noSteps = fullStepPerMm([omAxis("X", { microstepping: { value: 16 } })], "X");
	assert.equal(noSteps.known, false);

	const noAxis = fullStepPerMm([omAxis("X", { stepsPerMm: 80, microstepping: { value: 16 } })], "Y");
	assert.equal(noAxis.known, false);
	assert.ok(!noAxis.known && noAxis.why.includes("Y"));

	// Junk off the wire is refused the same way. An axis entry is NOT conformed
	// (om/types.ts gates the subtree, not its elements), so these two fields are
	// as untrusted as any other JSON.
	for (const bad of [0, -16, Number.NaN, "16" as unknown as number]) {
		const r = fullStepPerMm([omAxis("X", { stepsPerMm: 80, microstepping: { value: bad } })], "X");
		assert.equal(r.known, false, `microstepping ${String(bad)} must be refused`);
	}
});

/* ---------------------------------------------- the sweep, end to end, real */

/** The four shipped baseline captures as a sweep — a real matrix off the real
 *  machine, at the real steps/mm. */
function baselineMatrix() {
	const rows = [20, 50, 100, 200].map(speed => {
		const r = parseCapture(fx(`baseline_X_${speed}.csv`));
		if (!r.ok) throw new Error(`fixture ${speed}`);
		return { speed: mmPerS(speed), capture: r.capture, moveS: seconds(100 / speed) };
	});
	return sweepMatrix(rows, 5, 700);
}

test("the sweep separates a speed-following ridge from a fixed stripe", () => {
	const m = baselineMatrix();
	const nB = m.freqs.length;
	const peakOf = (row: number): number => {
		let best = 5;
		for (let k = 5; k < nB; k++) if (m.amps[row * nB + k]! > m.amps[row * nB + best]!) best = k;
		return best;
	};
	// THE physics, and the direction this project had backwards until 2026-08-23.
	// The 100 mm/s row's loudest bin is at the FULL-STEP rate — 100 x 5 = 500?
	// No: this machine's carriage mode is at 250 Hz and 50 mm/s x 5 lands on it,
	// so the answer is not "always the full-step rate" and the chart has to show
	// both. What must hold is that the locus itself tracks speed exactly.
	assert.deepEqual(m.fullStepHz.map(Number), [100, 250, 500, 1000]);
	for (let i = 1; i < m.speeds.length; i++) {
		const ratio = Number(m.fullStepHz[i]) / Number(m.speeds[i]);
		assert.equal(ratio, 5, "the forced locus is speed x fullStepsPerMm, at every speed");
	}
	// And the fixed 250 Hz carriage mode is what the 100 mm/s row peaks at,
	// NOT its own 500 Hz full-step rate: a mode does not move with speed.
	assert.ok(Math.abs(peakOf(2) - 250) <= 2, `100 mm/s peaks at ${peakOf(2)} Hz`);
});

test("analysedRows: a capture with no cruise inside the record is not counted", () => {
	const m = baselineMatrix();
	assert.equal(analysedRows(m), 4, "all four fixtures hold a cruise window");

	// The real case: a 1500-sample capture at 1379 Hz records 1.09 s, while a
	// 100 mm move at 10 mm/s takes 10 s — so the record ends inside the move's
	// first tenth and sweepMatrix produces nothing for that row. A sweep that
	// painted it as ground would read as "the machine is silent at 10 mm/s".
	const slow = parseCapture(fx("baseline_X_20.csv"));
	assert.ok(slow.ok);
	const withGap = sweepMatrix(
		[
			{ speed: mmPerS(10), capture: slow.capture, moveS: seconds(100 / 10) },
			{ speed: mmPerS(50), capture: slow.capture, moveS: seconds(100 / 50) },
		],
		5,
		700,
	);
	assert.equal(analysedRows(withGap), 1, "the 10 mm/s row has no window and is left empty");
});

test("worker: a sweep row's axis picks the CHANNEL, so a Y run is not read off X", () => {
	// A/B over the same request with only `axis` different. On a CoreXY both
	// motors run for an X move, so the Y channel is not silent — what separates
	// the two is the 250 Hz carriage mode the X carriage rings at, which is
	// several times louder on X. Total energy would NOT have caught the dropped
	// axis (11.1 against 7.0); the mode does.
	const rows = [20, 50].map(s => ({ speed: mmPerS(s), csv: fx(`baseline_X_${s}.csv`), moveS: seconds(100 / s) }));
	const asX = handle({ id: 1, kind: "sweep", rows: rows.map(r => ({ ...r, axis: 0 as const })), fullStepsPerMm: 5 });
	const asY = handle({ id: 2, kind: "sweep", rows: rows.map(r => ({ ...r, axis: 1 as const })), fullStepsPerMm: 5 });
	assert.ok(asX.response.kind === "sweep" && asY.response.kind === "sweep");
	const nB = asX.response.result.freqs.length;
	// Row 1 is 50 mm/s, whose full-step rate (50 x 5) lands on the mode.
	const at250 = (a: Float64Array): number => a[1 * nB + 250]!;
	const x = at250(asX.response.result.amps);
	const y = at250(asY.response.result.amps);
	// Two claims, and the first is the one that catches a dropped axis: the two
	// matrices must not be the same numbers. (They were, before this change —
	// the worker built its rows without `axis` and every sweep read X.)
	assert.notDeepEqual([...asY.response.result.amps], [...asX.response.result.amps],
		"a Y-channel request must not return the X-channel matrix");
	// The second is a fact about the machine: the 250 Hz mode is the X
	// carriage's, so it is louder on X even though both motors moved.
	assert.ok(x > y, `X at 250 Hz ${x} should exceed Y ${y} on an X move`);
	// And omitting it still reads X, as sweepMatrix defines it — so the change
	// forwards the axis without moving the default.
	const noAxis = handle({ id: 3, kind: "sweep", rows, fullStepsPerMm: 5 });
	assert.ok(noAxis.response.kind === "sweep");
	assert.deepEqual([...noAxis.response.result.amps], [...asX.response.result.amps]);
});

test("a real sweep matrix survives the results file round trip, bit for bit", () => {
	const m = baselineMatrix();
	const text = serializeResults({ ...emptyResults(0), sweep: m });
	const back = parseResults(text);
	assert.ok(back !== null, "the file parses");
	const s = back!.sweep;
	assert.ok(s !== null, "the sweep arm survived");
	assert.deepEqual([...s!.speeds].map(Number), [...m.speeds].map(Number));
	assert.deepEqual([...s!.fullStepHz].map(Number), [...m.fullStepHz].map(Number));
	assert.equal(s!.maxHz, m.maxHz);
	assert.equal(s!.freqs.length, m.freqs.length);
	assert.equal(s!.amps.length, m.amps.length);
	// EXACT, not near: these are JSON round-tripped doubles, and a lossy write
	// would put the chart's colour ramp on different numbers than the transform
	// produced.
	for (let i = 0; i < m.amps.length; i++) {
		assert.equal(s!.amps[i], m.amps[i], `amp ${i}`);
	}
	for (let i = 0; i < m.freqs.length; i++) assert.equal(s!.freqs[i], m.freqs[i], `freq ${i}`);
	// And the parsed matrix draws the same picture.
	const a = heatmapCells(m, 400, 200);
	const b = heatmapCells(s, 400, 200);
	assert.equal(b.maxAmp, a.maxAmp);
	assert.equal(b.cells.length, a.cells.length);
});

/* ------------------------------------------------------------- what it says */

test("sweepStateText: every state has a sentence, and the physics points the right way", () => {
	const states = [
		{ kind: "idle" } as const,
		{ kind: "loading", done: 0, total: 9, file: "lowspeed_stock_X_10.csv" } as const,
		{ kind: "computing", total: 9 } as const,
		{ kind: "built", tool: 0, family: "lowspeed_stock_X", rows: 9, analysed: 9 } as const,
		{ kind: "saving", tool: 0 } as const,
		{ kind: "saved", tool: 0 } as const,
		{ kind: "failed", why: "nope" } as const,
	];
	for (const s of states) assert.ok(sweepStateText(s).length > 0, s.kind);

	// The shipped copy had this BACKWARDS until 2026-08-23. Forced vibration
	// FOLLOWS speed; ringing is FIXED. A sentence that says the opposite sends
	// the operator shaping a mode shaping cannot reach.
	const idle = sweepStateText({ kind: "idle" }).toLowerCase();
	assert.ok(idle.includes("climbs with speed"), idle);
	assert.ok(/one frequency whatever the speed/.test(idle), idle);
	assert.ok(idle.indexOf("climbs with speed") < idle.indexOf("one frequency whatever the speed"),
		"the forced clause has to be the one attached to speed");

	// A partial sweep says so. A picture built from 8 of 9 captures and one
	// built from 9 of 9 look identical unless the card says which it is.
	const partial = sweepStateText({ kind: "built", tool: 2, family: "f", rows: 9, analysed: 8 });
	assert.ok(partial.includes("8 of 9"), partial);
	assert.ok(partial.includes("One capture holds"), partial);
	const whole = sweepStateText({ kind: "built", tool: 2, family: "f", rows: 9, analysed: 9 });
	assert.ok(!whole.includes("too little"), whole);
});

/* -------------------------------------- a filter finds rows, it does not pick */

type Row = { readonly key: string; readonly file: string };
const ROWS: readonly Row[] = [
	{ key: "board:ring1_Xp0.csv", file: "ring1_Xp0.csv" },
	{ key: "board:ring1_Xp1.csv", file: "ring1_Xp1.csv" },
	{ key: "board:ring1_v_zv_52_Xp0.csv", file: "ring1_v_zv_52_Xp0.csv" },
];

test("resolvePick: a filter that hides the picked row does not un-pick it", () => {
	// Gabe, 2026-08-23: pick a capture, click the `ring1_v_` chip, and the chart
	// plus every fitted number beside it blanked — although the selection was
	// intact the whole time.
	const shown = ROWS.filter(r => r.file.startsWith("ring1_v_"));
	const r = resolvePick(ROWS, shown, "board:ring1_Xp0.csv");
	assert.equal(r.picked?.file, "ring1_Xp0.csv", "still picked, still drawable");
	assert.equal(r.hidden, true, "and the card can say why no row is lit");
});

test("resolvePick: visible, absent and unpicked are three different answers", () => {
	const visible = resolvePick(ROWS, ROWS, "board:ring1_Xp0.csv");
	assert.equal(visible.picked?.file, "ring1_Xp0.csv");
	assert.equal(visible.hidden, false);

	// Nothing picked is not "hidden" — a card that conflated them would print
	// "hidden by the filter" on an empty chart.
	const none = resolvePick(ROWS, [], null);
	assert.equal(none.picked, null);
	assert.equal(none.hidden, false);

	// A key from another source (the operator switched to Imported) resolves to
	// nothing, and is not reported as hidden either: there is no such row to
	// hide.
	const gone = resolvePick(ROWS, ROWS, "import:0:mine.csv");
	assert.equal(gone.picked, null);
	assert.equal(gone.hidden, false);
});

/* ------------------------------------------------- fits survive a selection */

const mode = (f: number): Mode => ({ f, zeta: 0.1, peakG: 0.05, cyclesFit: 3 } as unknown as Mode);

test("fitCache: fits accumulate across batches and only forget() empties it", () => {
	const seen: Array<ReadonlyMap<string, Mode | never>> = [];
	const cache = createFitCache(m => seen.push(m as ReadonlyMap<string, Mode>));

	// Batch A — the twelve ring captures, here two of them.
	cache.remember("ring1_Xp0.csv", mode(18.1));
	cache.remember("ring1_Xp1.csv", mode(18.4));
	assert.equal(cache.all().size, 2);

	// Batch B — the verify run. BOTH sets stay annotated, which is the point:
	// a fit is a pure function of a file's bytes, so there is no reason ever to
	// throw one away.
	cache.remember("ring1_v_zv_52_Xp0.csv", mode(15.1));
	assert.equal(cache.all().size, 3);
	assert.equal(cache.get("ring1_Xp0.csv")!.f, 18.1, "batch A survived batch B");
	assert.equal(cache.get("ring1_v_zv_52_Xp0.csv")!.f, 15.1);

	// Re-fitting the same file is defined and identical, not a conflict.
	cache.remember("ring1_Xp0.csv", mode(18.1));
	assert.equal(cache.all().size, 3);

	// A new map per change, so a Solid signal holding one actually notifies.
	assert.equal(seen.length, 4);
	assert.notEqual(seen[0], seen[1]);

	// The ONE route out.
	cache.forget();
	assert.equal(cache.all().size, 0);
	assert.equal(cache.get("ring1_Xp0.csv"), undefined);
});

test("fitCache: the map it hands out cannot be used to reach back into it", () => {
	// The cache is the sole owner. A caller that mutated the returned map would
	// be a second writer, and the whole guarantee is that one function empties
	// this and nothing else changes it.
	const cache = createFitCache();
	cache.remember("a.csv", mode(10));
	const snapshot = cache.all();
	cache.remember("b.csv", mode(20));
	assert.equal(snapshot.size, 1, "an earlier snapshot is not rewritten under the holder");
	assert.equal(cache.all().size, 2);
});
