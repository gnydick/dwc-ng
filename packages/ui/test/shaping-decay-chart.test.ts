/**
 * The Decay card's data half, over the real captures it will be shown.
 *
 * Every fixture here is one of the twelve accelerometer records from Gabe's
 * toolchanger on 2026-08-22 (tools/accel/runs/ring/ring1), and every FitResult
 * is produced by the SHIPPING worker entry point — `handle()` in
 * shaping/worker.ts, the same function the browser's Web Worker calls. Nothing
 * is stubbed and no expected number is copied from the prototype's output: the
 * assertions are about the relationship between what this UI draws and what it
 * prints, which is the property the card exists to keep.
 *
 * `ring1_Xp1.csv` is here on purpose. The shipped engine declines it with
 * `short-decay` where the prototype's Python fitted it (GitHub #33, a
 * deliberate decision taken elsewhere). This suite PINS that verdict rather
 * than working around it, and pins that the card explains it as the near miss
 * it is — 1.88 of the 2 cycles a damping ratio needs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decaySeries, fitNote, type DecayView } from "../src/charts/decayData.ts";
import { handle, type FitResult } from "../src/shaping/worker.ts";
import { boardRef, captureNameParts, createCaptureLoader, importRef } from "../src/shaping/captures.ts";
import { FIT_DEFAULTS, isMode, type Axis, type Mode, type NoFit } from "../src/shaping/engine/fit.ts";
import { hz } from "../src/shaping/engine/units.ts";

const fx = (n: string): string => readFileSync(new URL(`./fixtures/shaping/${n}`, import.meta.url), "utf8");

/** A capture fitted the way the app fits one: through the worker's own entry. */
function fitted(file: string, axis: Axis): FitResult {
	const { response } = handle({ id: 1, kind: "fit", csv: fx(file), axis });
	assert.equal(response.kind, "fit", `worker refused ${file}: ${JSON.stringify(response)}`);
	return (response as Extract<typeof response, { kind: "fit" }>).result;
}

const viewOf = (file: string, axis: Axis): DecayView => decaySeries(fitted(file, axis));

/** One of the three lines, proven present — AlignedData is variadic, so its
 *  tail is typed as possibly-absent and the tests would otherwise be a wall
 *  of non-null assertions. */
function line(view: DecayView, index: 1 | 2 | 3): Array<number | null> {
	const series = view.data[index];
	assert.ok(series !== undefined, `series ${index} is missing`);
	return series;
}
/** The x axis: seconds, one per sample. */
const times = (view: DecayView): number[] => view.data[0];

/* ------------------------------------------------------- shape of the series */

test("decaySeries returns four aligned arrays of one point per sample", () => {
	const capture = fitted("ring1_Xp0.csv", "X");
	const view = decaySeries(capture);
	const n = capture.x.length;
	assert.equal(view.data.length, 4, "x plus three series");
	for (const series of view.data) assert.equal(series.length, n);
	// x is seconds, ascending, starting at 0 — uPlot requires ascending x.
	const t = times(view);
	assert.equal(t[0], 0);
	for (let i = 1; i < n; i++) assert.ok(t[i]! > t[i - 1]!);
	assert.ok(Math.abs(view.durationS - n / capture.rate) < 1e-12);
});

test("the raw series is the axis that moved, sample for sample", () => {
	const capture = fitted("ring1_Yp0.csv", "Y");
	const view = decaySeries(capture);
	assert.equal(capture.axis, "Y");
	const raw = line(view, 1);
	for (let i = 0; i < capture.y.length; i += 97) assert.equal(raw[i], capture.y[i]);
});

test("the stop marker sits at the stop the fitter used, inside the capture", () => {
	const capture = fitted("ring1_Xp0.csv", "X");
	const view = decaySeries(capture);
	assert.notEqual(capture.tStop, null);
	assert.equal(view.stopS, capture.tStop);
	assert.ok(view.stopS! > 0 && view.stopS! < view.durationS);
	// The analysed window opens AFTER the stop and closes inside the capture.
	assert.ok(view.window !== null);
	assert.ok(view.window.fromS > view.stopS!);
	assert.ok(view.window.toS <= view.durationS);
});

test("the envelope is drawn over the analysed window and nowhere else", () => {
	const view = viewOf("ring1_Xp0.csv", "X");
	assert.ok(view.window !== null);
	const t = times(view);
	const envelope = line(view, 2);
	let inside = 0;
	for (let i = 0; i < t.length; i++) {
		const within = t[i]! >= view.window.fromS - 1e-9 && t[i]! < view.window.toS - 1e-9;
		if (within) {
			assert.notEqual(envelope[i], null, `no envelope at t=${t[i]}, inside the window`);
			inside++;
		} else {
			assert.equal(envelope[i], null, `envelope at t=${t[i]}, outside the window`);
		}
	}
	assert.ok(inside > 500, `only ${inside} envelope points`);
});

/* ----------------------------------------- the drawn curve IS the fitted one */

test("the envelope's peak is exactly the peak the fit reports", () => {
	// The point of `one-decay-window`: the chart and the figure beside it come
	// from a single computation, so this is an equality and not a tolerance.
	for (const [file, axis] of [["ring1_Xp0.csv", "X"], ["ring1_Yp0.csv", "Y"], ["ring1_Ym0.csv", "Y"]] as const) {
		const capture = fitted(file, axis);
		assert.ok(isMode(capture.fit), `${file} did not fit`);
		const envelope = line(decaySeries(capture), 2);
		let peak = 0;
		for (const v of envelope) if (v !== null && v > peak) peak = v;
		assert.equal(peak, capture.fit.peakG as number, file);
	}
});

test("the fitted exponential starts at the peak and decays at the fitted rate", () => {
	const capture = fitted("ring1_Yp0.csv", "Y");
	assert.ok(isMode(capture.fit));
	const mode: Mode = capture.fit;
	const view = decaySeries(capture);
	const t = times(view);
	const curve = line(view, 3);
	const first = curve.findIndex(v => v !== null);
	assert.ok(first > 0, "the curve must start somewhere inside the capture");
	assert.ok(Math.abs(curve[first]! - (mode.peakG as number)) < 1e-12, "anchored at the reported peak");
	// Every later point is the exponential the reported f and zeta imply.
	const omega = 2 * Math.PI * (mode.f as number) * mode.zeta;
	for (let i = first; i < curve.length; i++) {
		if (curve[i] === null) continue;
		const want = (mode.peakG as number) * Math.exp(-omega * (t[i]! - t[first]!));
		assert.ok(Math.abs(curve[i]! - want) < 1e-12, `curve[${i}]`);
	}
	// It is monotone and never grows — an exponential drawn upside down is the
	// sign-flip this asserts against.
	const last = curve.reduce<number | null>((acc, v) => (v === null ? acc : v), null);
	assert.ok(last !== null && last < (mode.peakG as number));
});

test("a capture with no Mode gets no fitted curve, but keeps its envelope", () => {
	const capture = fitted("ring1_Xp1.csv", "X");
	assert.ok(!isMode(capture.fit));
	const view = decaySeries(capture);
	assert.ok(line(view, 3).every(v => v === null), "no exponential without a fitted damping");
	assert.ok(line(view, 2).some(v => v !== null), "the envelope is still what was measured");
});

/* --------------------------------------------------- the ring1_Xp1 near miss */

test("ring1_Xp1 is refused as short-decay, with the frequency and peak it did measure", () => {
	// Pinned, not fixed: GitHub #33 owns whether the acceptance rule should
	// change. If this ever starts fitting, that decision was taken and this
	// test is the place it has to be acknowledged.
	const capture = fitted("ring1_Xp1.csv", "X");
	assert.ok(!isMode(capture.fit));
	const fit: NoFit = capture.fit;
	assert.equal(fit.reason, "short-decay");
	assert.equal(fit.f, hz(17.843505859375));
	assert.ok(Math.abs((fit.peakG as number) - 0.0559) < 5e-4, `peak ${fit.peakG}`);
});

test("the near miss is reported in cycles, just under the two the fit needs", () => {
	const view = viewOf("ring1_Xp1.csv", "X");
	assert.ok(view.cycles !== null);
	assert.equal(view.cycles.needed, FIT_DEFAULTS.minCycles);
	assert.ok(Math.abs(view.cycles.sustained - 1.876) < 0.01, `sustained ${view.cycles.sustained}`);
	assert.ok(view.cycles.sustained < view.cycles.needed, "it must read as a MISS");
	// And close enough that the operator can see it was close.
	assert.ok(view.cycles.sustained / view.cycles.needed > 0.9);
});

test("the note for ring1_Xp1 names the miss, the count and what was measured", () => {
	const note = viewOf("ring1_Xp1.csv", "X").note;
	assert.match(note, /Near miss/);
	assert.match(note, /1\.88 cycles/);
	assert.match(note, /needs 2/);
	assert.match(note, /17\.8 Hz/);
	assert.match(note, /0\.056 g/);
});

test("a capture that DID fit says so, over the cycles it fitted", () => {
	const capture = fitted("ring1_Xp0.csv", "X");
	assert.ok(isMode(capture.fit));
	const note = decaySeries(capture).note;
	assert.match(note, /^Fitted over 2\.20 cycles/);
	assert.match(note, /15 % of it/);
});

/* --------------------------------------------------------- fitNote totality */

test("fitNote answers for every reason a fit can be declined", () => {
	const reasons: NoFit["reason"][] = ["short-window", "below-floor", "short-decay", "damping-out-of-range"];
	for (const reason of reasons) {
		const note = fitNote({ reason, f: hz(18.2), peakG: 0.0123 as never }, { sustained: 1.5, needed: 2 });
		assert.ok(note.length > 20, `${reason}: ${note}`);
		assert.ok(!note.includes("undefined"), `${reason}: ${note}`);
		assert.ok(note.endsWith("."), `${reason}: ${note}`);
	}
});

test("fitNote quotes the fitter's own thresholds, not copies of them", () => {
	const note = fitNote({ reason: "below-floor", peakG: 0.004 as never }, null);
	assert.ok(note.includes(`${FIT_DEFAULTS.floorG} g floor`), note);
	const near = fitNote({ reason: "short-decay", f: hz(18), peakG: 0.05 as never }, { sustained: 1.5, needed: FIT_DEFAULTS.minCycles });
	assert.ok(near.includes(`needs ${FIT_DEFAULTS.minCycles}`), near);
});

/* ------------------------------------------------------------ capture naming */

test("captureNameParts reads the run's own file names", () => {
	assert.deepEqual(captureNameParts("ring1_Xp1.csv"), { axis: "X", dir: "+", rep: 1, matched: true });
	assert.deepEqual(captureNameParts("ring1_Ym0.csv"), { axis: "Y", dir: "-", rep: 0, matched: true });
	assert.deepEqual(captureNameParts("0:/sys/accelerometer/ring1_Yp2.csv"), { axis: "Y", dir: "+", rep: 2, matched: true });
});

test("captureNameParts is total over names it does not recognise", () => {
	for (const name of ["", "capture.csv", "my data (1).csv", "_Z p0.csv", "ring1_Xz3.csv"]) {
		const parts = captureNameParts(name);
		assert.equal(parts.matched, false, name);
		assert.equal(parts.axis, "X");
		assert.equal(parts.rep, 0);
	}
});

/* --------------------------------------------------------------- the loader */

test("the loader downloads a board capture once and answers from cache after", async () => {
	const asked: string[] = [];
	const loader = createCaptureLoader({
		download: async (path: string) => {
			asked.push(path);
			return "Sample,X,Y,Z\n0,0,0,1\nRate 1000, overflows 0\n";
		},
	});
	const ref = boardRef("ring1_Xp0.csv");
	const first = await loader.text(ref);
	const second = await loader.text(ref);
	assert.equal(first, second);
	assert.deepEqual(asked, ["0:/sys/accelerometer/ring1_Xp0.csv"]);
});

test("an imported capture never reaches the connector", async () => {
	const loader = createCaptureLoader({
		download: async () => {
			throw new Error("the loader must not download an imported file");
		},
	});
	assert.equal(await loader.text(importRef(0, "mine.csv", "hello")), "hello");
});

test("two imports of the same file name are two different captures", () => {
	assert.notEqual(importRef(0, "ring1_Xp0.csv", "a").key, importRef(1, "ring1_Xp0.csv", "b").key);
});

/* ------------------------------------------- a file the engine cannot accept */

test("a CSV with no trailer is refused with the reason, not a silent empty chart", () => {
	const { response } = handle({ id: 7, kind: "fit", csv: "Sample,X,Y,Z\n0,0.1,0.2,1\n", axis: "X" });
	assert.equal(response.kind, "error");
	assert.match((response as { error: string }).error, /trailer/);
});

test("a CSV whose accelerometer overflowed says how many times", () => {
	const csv = "Sample,X,Y,Z\n0,0.1,0.2,1\nRate 1344, overflows 3\n";
	const { response } = handle({ id: 8, kind: "fit", csv, axis: "X" });
	assert.equal(response.kind, "error");
	assert.match((response as { error: string }).error, /3 accelerometer overflows/);
});

test("a capture too short to analyse draws its trace and says there is nothing to fit", () => {
	// 0.2 s at 1344 Hz with a decel pulse near the end: detectStop finds the
	// stop, and there is not the 0.15 s of ring-down the fitter needs after it.
	const rate = 1344;
	const rows = ["Sample,X,Y,Z"];
	const n = Math.round(0.2 * rate);
	for (let i = 0; i < n; i++) {
		const decel = i > n - 40 && i < n - 10 ? 0.8 : 0;
		rows.push(`${i},${decel.toFixed(4)},0,1`);
	}
	rows.push(`Rate ${rate}, overflows 0`);
	const { response } = handle({ id: 9, kind: "fit", csv: rows.join("\n"), axis: "X" });
	assert.equal(response.kind, "fit");
	const view = decaySeries((response as Extract<typeof response, { kind: "fit" }>).result);
	assert.equal(view.window, null);
	assert.equal(view.cycles, null);
	assert.equal(times(view).length, n, "the raw trace is still drawn in full");
	assert.ok(line(view, 2).every(v => v === null));
	assert.ok(line(view, 3).every(v => v === null));
	assert.ok(view.note.length > 20, view.note);
});

/* ---------------------------------------------- the window the chart opens on */

test("the chart opens on the ring, not on the acceleration pulses either side", () => {
	// Measured in the Card Lab before this existed: a y axis fitted to the whole
	// trace drew a 0.05 g ring-down as a flat line, because the move's decel
	// pulse is ~1.5 g. Both ranges are therefore taken from the ANALYSED window.
	const capture = fitted("ring1_Xp0.csv", "X");
	const view = decaySeries(capture);
	assert.ok(view.window !== null);
	assert.ok(view.xRange[0] < view.window.fromS, "a little of the move is in frame");
	assert.ok(view.xRange[0] > (view.stopS ?? 0) - 0.1, "but only a little");
	assert.equal(view.xRange[1], view.window.toS);

	// The pulse is OUTSIDE the y window, and the ring fills it.
	const raw = line(view, 1);
	let pulse = 0;
	for (const v of raw) if (v !== null && Math.abs(v) > pulse) pulse = Math.abs(v);
	assert.ok(pulse > 1, `the capture really does contain a big pulse (${pulse} g)`);
	assert.ok(view.yRange[1] < pulse / 4, `y window ${view.yRange[1]} vs pulse ${pulse}`);
	assert.equal(view.yRange[0], -view.yRange[1], "symmetric about zero");
	assert.ok(isMode(capture.fit));
	assert.ok(view.yRange[1] > (capture.fit.peakG as number), "the fitted peak fits inside it");
});

test("a capture with nothing to analyse still gets a usable frame", () => {
	const rate = 1344;
	const rows = ["Sample,X,Y,Z"];
	for (let i = 0; i < 400; i++) rows.push(`${i},0,0,1`);
	rows.push(`Rate ${rate}, overflows 0`);
	const { response } = handle({ id: 11, kind: "fit", csv: rows.join("\n"), axis: "X" });
	assert.equal(response.kind, "fit");
	const view = decaySeries((response as Extract<typeof response, { kind: "fit" }>).result);
	assert.equal(view.stopS, null, "a capture that never moved has no stop");
	assert.deepEqual([...view.xRange], [0, view.durationS]);
	assert.ok(view.yRange[1] > 0, "never a degenerate scale, even on all zeros");
	assert.match(view.note, /No stop was detected/);
});

test("no stop and a short window are told apart, because they mean different things", () => {
	const short = fitNote({ reason: "short-window" }, null, true);
	const none = fitNote({ reason: "short-window" }, null, false);
	assert.notEqual(short, none);
	assert.match(short, /Capture for longer/);
	assert.match(none, /No stop was detected/);
});
