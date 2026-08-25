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
 * What this suite covers changed on 2026-08-23 (GIT_33). It used to pin
 * `ring1_Xp1.csv` as a `short-decay` refusal, because the band-mask envelope
 * estimator declined it while its five identical siblings passed. That
 * estimator is gone: all twelve real captures now fit, and the worst X margin
 * is 2.502 cycles against the 2 required. So the near-miss path is exercised
 * with a SYNTHETIC ring built past MAX_FIT_ZETA — a case that is a near miss
 * by arithmetic rather than by which way the noise fell — and the real
 * captures are used for what they are: the thing the card actually draws.
 *
 * The chart's three lines are now raw · ring · envelope. The ring is the
 * band-limited SIGNAL the fit was taken over (`spectrum.bandPass`) and the
 * envelope is `modeEnvelope` of the Mode printed beside it. There is no longer
 * a pair of curves that could disagree — the envelope IS the fit — so the
 * assertions below are about the two staying anchored to the same region.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decaySeries, fitNote, type DecayView } from "../src/charts/decayData.ts";
import { handle, type FitResult } from "../src/shaping/worker.ts";
import { ACCEL_DIR, boardRef, byNewest, type CaptureRef, captureLiveness, captureNameParts, chosenCaptures, createCaptureLoader, familyView, importedCount, importRef, isCaptureFile, matchesQuery, rescanReadiness } from "../src/shaping/captures.ts";
import { rescanNoteText } from "../src/shaping/copy.ts";
import { aggregate, FIT_DEFAULTS, isMode, MAX_FIT_ZETA, MIN_CYCLES, type Axis, type Mode, type NoFit } from "../src/shaping/engine/fit.ts";
import { hz } from "../src/shaping/engine/units.ts";

const fx = (n: string): string => readFileSync(new URL(`./fixtures/shaping/${n}`, import.meta.url), "utf8");

/** One of the twelve ring1 captures, by its bare name. */
const ring1 = (name: string): string => fx(`ring1/${name}`);

/** A capture fitted the way the app fits one: through the worker's own entry. */
function fitted(file: string, axis: Axis): FitResult {
	const { response } = handle({ id: 1, kind: "fit", csv: ring1(file), axis });
	assert.equal(response.kind, "fit", `worker refused ${file}: ${JSON.stringify(response)}`);
	return (response as Extract<typeof response, { kind: "fit" }>).result;
}

const viewOf = (file: string, axis: Axis): DecayView => decaySeries(fitted(file, axis));

/**
 * A capture built to a known answer: a deceleration pulse, then a decaying
 * sinusoid of the requested damping.
 *
 * Written as a CSV and pushed through the SHIPPING worker entry, like every
 * other fixture here, so nothing is stubbed. The point of building it rather
 * than reaching for a real capture is that `zeta` decides the verdict by
 * arithmetic: cyclesFit is ln(1/0.15)/(2π·zeta), so anything above
 * MAX_FIT_ZETA (0.1510) is a short-decay refusal and anything below it fits,
 * whatever the noise did that day.
 */
function syntheticCsv(f: number, zeta: number, amp: number, rate = 1376): string {
	const n = Math.round(1.0 * rate);
	const stop = Math.round(0.08 * rate);
	const pulseFrom = Math.round(0.05 * rate);
	const wn = 2 * Math.PI * f;
	const wd = wn * Math.sqrt(1 - zeta * zeta);
	const rows = ["Sample,X,Y,Z"];
	for (let i = 0; i < n; i++) {
		let v = 0;
		if (i >= pulseFrom && i < stop) v = 1.2;
		else if (i >= stop) {
			const t = (i - stop) / rate;
			v = amp * Math.exp(-zeta * wn * t) * Math.cos(wd * t);
		}
		rows.push(`${i},${v.toFixed(5)},0,1`);
	}
	rows.push(`Rate ${rate}, overflows 0`);
	return rows.join("\n");
}

function syntheticFit(f: number, zeta: number, amp: number): FitResult {
	const { response } = handle({ id: 21, kind: "fit", csv: syntheticCsv(f, zeta, amp), axis: "X" });
	assert.equal(response.kind, "fit", JSON.stringify(response));
	return (response as Extract<typeof response, { kind: "fit" }>).result;
}

/** One of the three lines, proven present — AlignedData is variadic, so its
 *  tail is typed as possibly-absent and the tests would otherwise be a wall
 *  of non-null assertions. 1 = raw, 2 = ring, 3 = envelope. */
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

test("the ring and the envelope are drawn over the analysed window and nowhere else", () => {
	// Both series cover exactly the region `decayWindow` handed the fitter, so
	// sample 0 of the drawn envelope is sample 0 of the fitted data — the
	// alignment `one-decay-window` exists to make unwritable.
	const view = viewOf("ring1_Xp0.csv", "X");
	assert.ok(view.window !== null);
	const t = times(view);
	for (const index of [2, 3] as const) {
		const series = line(view, index);
		let inside = 0;
		for (let i = 0; i < t.length; i++) {
			const within = t[i]! >= view.window.fromS - 1e-9 && t[i]! < view.window.toS - 1e-9;
			if (within) {
				assert.notEqual(series[i], null, `series ${index}: nothing at t=${t[i]}, inside the window`);
				inside++;
			} else {
				assert.equal(series[i], null, `series ${index}: a point at t=${t[i]}, outside the window`);
			}
		}
		assert.ok(inside > 500, `series ${index}: only ${inside} points`);
	}
});

test("the ring is a signal, not a magnitude — it swings through zero", () => {
	// The old third series was a measured ENVELOPE, and reinstating one is
	// exactly the regression `one-envelope-and-it-is-fitted` forbids. A band-
	// passed signal is the thing that cannot be mistaken for one.
	const ring = line(viewOf("ring1_Yp0.csv", "Y"), 2).filter((v): v is number => v !== null);
	assert.ok(ring.length > 500);
	assert.ok(ring.filter(v => v < -0.005).length > 20, "no negative excursions");
	assert.ok(ring.filter(v => v > 0.005).length > 20, "no positive excursions");
});

/* ----------------------------------------- the drawn curve IS the fitted one */

test("the envelope's first point is exactly the peak the fit reports", () => {
	// The envelope IS the fit, evaluated: peakG·e^(-2pi·f·zeta·t) from sample 0
	// of the analysed region. So this is an equality, not a tolerance, and the
	// first point is peakG rather than a maximum arrived at by searching.
	for (const [file, axis] of [["ring1_Xp0.csv", "X"], ["ring1_Yp0.csv", "Y"], ["ring1_Ym0.csv", "Y"]] as const) {
		const capture = fitted(file, axis);
		assert.ok(isMode(capture.fit), `${file} did not fit`);
		const view = decaySeries(capture);
		const envelope = line(view, 3);
		const first = envelope.findIndex(v => v !== null);
		assert.ok(view.window !== null);
		assert.ok(Math.abs(times(view)[first]! - view.window.fromS) < 1e-12, `${file}: the envelope starts at the window`);
		assert.equal(envelope[first], capture.fit.peakG as number, file);
		let peak = 0;
		for (const v of envelope) if (v !== null && v > peak) peak = v;
		assert.equal(peak, capture.fit.peakG as number, `${file}: nothing later exceeds the first point`);
	}
});

test("the envelope decays at exactly the fitted rate, and only downwards", () => {
	const capture = fitted("ring1_Yp0.csv", "Y");
	assert.ok(isMode(capture.fit));
	const mode: Mode = capture.fit;
	const view = decaySeries(capture);
	const t = times(view);
	const curve = line(view, 3);
	const first = curve.findIndex(v => v !== null);
	assert.ok(first > 0, "the curve must start somewhere inside the capture");
	const omega = 2 * Math.PI * (mode.f as number) * mode.zeta;
	let previous = Infinity;
	for (let i = first; i < curve.length; i++) {
		if (curve[i] === null) continue;
		const want = (mode.peakG as number) * Math.exp(-omega * (t[i]! - t[first]!));
		assert.ok(Math.abs(curve[i]! - want) < 1e-12, `curve[${i}]`);
		// Strictly decreasing everywhere. A rising envelope is precisely what
		// the band-mask measurement used to draw, and what a fit cannot.
		assert.ok(curve[i]! < previous, `envelope rose at ${i}`);
		previous = curve[i]!;
	}
});

test("a capture with no Mode gets no envelope, but still shows the ring it measured", () => {
	// A near miss must still be LOOKED at: the operator's question is "was that
	// a real ring?", and the band trace answers it even though no damping was
	// reported. Synthetic, because none of the twelve real captures misses any
	// more.
	const capture = syntheticFit(40, 0.19, 0.3);
	assert.ok(!isMode(capture.fit), JSON.stringify(capture.fit));
	assert.equal(capture.fit.reason, "short-decay");
	const view = decaySeries(capture);
	assert.ok(line(view, 3).every(v => v === null), "no envelope without a fitted damping");
	assert.ok(line(view, 2).some(v => v !== null), "the ring the fit was taken over is still drawn");
	assert.equal(view.decay, null, "and no decay span to mark");
});

/* ------------------------------------------------------------- the near miss */

test("ring1_Xp1 fits now, and reads like the five siblings it used to be split from", () => {
	// The test this replaces pinned ring1_Xp1 as a `short-decay` refusal and
	// said GitHub #33 owned whether the rule should change. It did change: the
	// band-mask envelope that rejected this one capture is gone, and the
	// acceptance rule is now an identity in zeta rather than a sample count
	// between two noisy indices. So the premise inverts — this file must fit,
	// and must land with its siblings rather than merely scrape in.
	const capture = fitted("ring1_Xp1.csv", "X");
	assert.ok(isMode(capture.fit), JSON.stringify(capture.fit));
	assert.ok(Math.abs((capture.fit.f as number) - 17.84) < 0.01, `f ${capture.fit.f}`);
	assert.ok(capture.fit.zeta < MAX_FIT_ZETA, `zeta ${capture.fit.zeta} must clear the cut`);
	const view = decaySeries(capture);
	assert.ok(view.cycles !== null);
	assert.ok(view.cycles.sustained > MIN_CYCLES, `cycles ${view.cycles.sustained}`);
	assert.match(view.note, /^Fitted over/);
});

test("a near miss is reported in cycles, just under the two the fit needs", () => {
	// Synthetic and deliberately just past MAX_FIT_ZETA (0.1510): cyclesFit is
	// ln(1/0.15)/(2pi*zeta), so 0.19 is a miss by arithmetic. The card's job is
	// to say how nearly, and `cyclesFit` travels on the NoFit for that.
	const view = decaySeries(syntheticFit(40, 0.19, 0.3));
	assert.ok(view.cycles !== null);
	assert.equal(view.cycles.needed, MIN_CYCLES);
	assert.ok(view.cycles.sustained < view.cycles.needed, "it must read as a MISS");
	assert.ok(view.cycles.sustained > 1.3, `sustained ${view.cycles.sustained}`);
	// Close enough that the operator can see it was close.
	assert.ok(view.cycles.sustained / view.cycles.needed > 0.7);
});

test("the note for a near miss names the miss, the count and what was measured", () => {
	// The frequency in the sentence is the one the NoFit CARRIES, not the one
	// the signal was built with: a rectangular-window spectral peak is biased
	// low by the damping, and at zeta 0.19 a 40 Hz ring reads ~38 Hz. That bias
	// is why MIN_CYCLES exists, and the card must print what was measured
	// rather than flatter it.
	const capture = syntheticFit(40, 0.19, 0.3);
	assert.ok(!isMode(capture.fit));
	const fit: NoFit = capture.fit;
	const view = decaySeries(capture);
	assert.match(view.note, /Near miss/);
	assert.match(view.note, new RegExp(`${view.cycles!.sustained.toFixed(2)} cycles`));
	assert.match(view.note, /needs 2/);
	assert.ok(view.note.includes(`${(fit.f as number).toFixed(1)} Hz`), view.note);
	assert.ok(view.note.includes(`${(fit.peakG as number).toFixed(3)} g`), view.note);
	// It really is the near miss it says: within 25 % of the two cycles needed.
	assert.ok((fit.cyclesFit ?? 0) > 1.5, `cyclesFit ${fit.cyclesFit}`);
});

test("a capture that DID fit says so, over the cycles it fitted", () => {
	const capture = fitted("ring1_Xp0.csv", "X");
	assert.ok(isMode(capture.fit));
	const view = decaySeries(capture);
	const note = view.note;
	// The count in the sentence is the fit's own cyclesFit, not a second one.
	assert.equal(note, `Fitted over ${capture.fit.cyclesFit.toFixed(2)} cycles, from the ring amplitude down to 15 % of it.`);
	assert.match(note, /^Fitted over 2\.5\d cycles/);
	// And the marked decay span really is that many periods of the fitted f.
	assert.ok(view.decay !== null);
	const periods = (view.decay.toS - view.decay.fromS) * (capture.fit.f as number);
	assert.ok(Math.abs(periods - capture.fit.cyclesFit) < 1e-9, `${periods} vs ${capture.fit.cyclesFit}`);
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
	const short = fitNote({ reason: "short-window" }, null);
	assert.ok(short.includes(`${FIT_DEFAULTS.minWindowS} s`), short);
	const near = fitNote({ reason: "short-decay", f: hz(18), peakG: 0.05 as never }, { sustained: 1.5, needed: MIN_CYCLES });
	assert.ok(near.includes(`needs ${MIN_CYCLES}`), near);
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
	assert.equal(view.decay, null);
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

/* ------------------------------------------- browsing 276 captures on a board */

/** The shape of Gabe's `0:/sys/accelerometer` on 2026-08-23, as the Card Lab
 *  scenario builds it: 276 CSVs, the newest from this morning's session. */
const listing = (): Array<{ type: "d" | "f"; name: string; size: number; date?: string }> => {
	const out: Array<{ type: "d" | "f"; name: string; size: number; date?: string }> = [];
	for (const tag of ["Xp", "Xm", "Yp", "Ym"]) {
		for (let r = 0; r < 3; r++) out.push({ type: "f", name: `ring1_${tag}${r}.csv`, size: 34900, date: `2026-08-22T09:1${r}:00` });
	}
	for (const shaper of ["zv", "zvd", "zvdd", "ei2"]) {
		for (const tag of ["Xp", "Xm", "Yp", "Ym"]) {
			for (let r = 0; r < 3; r++) out.push({ type: "f", name: `ring1_v_${shaper}_52_${tag}${r}.csv`, size: 34900, date: `2026-08-22T10:0${r}:00` });
		}
	}
	for (let i = 0; i < 8; i++) out.push({ type: "f", name: `baseline_X_${i}.csv`, size: 34900, date: `2026-06-01T08:00:00` });
	out.push({ type: "d", name: "old", size: 0, date: "2026-05-01T00:00:00" });
	out.push({ type: "f", name: "notes.txt", size: 12, date: "2026-05-01T00:00:00" });
	return out;
};

test("only the CSVs are captures — a directory and a stray text file are not", () => {
	const entries = listing().filter(isCaptureFile);
	assert.equal(entries.length, listing().length - 2);
	assert.ok(entries.every(e => e.name.endsWith(".csv")));
});

test("newest first, and an undated entry sorts last rather than to the top", () => {
	const sorted = byNewest([
		{ name: "b.csv", date: "2026-08-22T09:00:00" },
		{ name: "undated.csv" },
		{ name: "a.csv", date: "2026-08-22T10:00:00" },
	]);
	assert.deepEqual(sorted.map(e => e.name), ["a.csv", "b.csv", "undated.csv"]);
});

test("the sort is stable for entries recorded in the same second", () => {
	const same = [{ name: "z.csv", date: "x" }, { name: "a.csv", date: "x" }, { name: "m.csv", date: "x" }];
	assert.deepEqual(byNewest(same).map(e => e.name), ["a.csv", "m.csv", "z.csv"]);
	assert.deepEqual(byNewest(byNewest(same)).map(e => e.name), ["a.csv", "m.csv", "z.csv"]);
});

/**
 * `0:/sys/accelerometer` as Gabe's board actually holds it: 259 CSVs, the
 * families and the counts he measured driving build `CRUgiM19` on 2026-08-23
 * (GitHub #39).
 *
 * The numbers are the point, not the spellings. 141 of the files are in six
 * named families and the OTHER 118 are one-offs and small runs from months of
 * work — which is the shape that broke the chip row: three chips covered 141
 * and nothing said where the rest had gone.
 */
const board259 = (): string[] => {
	const out: string[] = [];
	// The baseline ring capture: 4 tags x 3 repeats.
	for (const tag of ["Xp", "Xm", "Yp", "Ym"]) {
		for (let r = 0; r < 3; r++) out.push(`ring1_${tag}${r}.csv`);
	}
	// Its verify pass, four shapers over the same twelve moves.
	for (const shaper of ["zv", "zvd", "zvdd", "ei2"]) {
		for (const tag of ["Xp", "Xm", "Yp", "Ym"]) {
			for (let r = 0; r < 3; r++) out.push(`ring1_v_${shaper}_52_${tag}${r}.csv`);
		}
	}
	for (let i = 0; i < 24; i++) out.push(`A_${i}.csv`);
	for (let i = 0; i < 24; i++) out.push(`B_${i}.csv`);
	for (let i = 0; i < 18; i++) out.push(`C_${i}.csv`);
	for (let i = 0; i < 15; i++) out.push(`baseline_X_${i}.csv`);
	// The 118 nobody could reach: current, microstep and motor experiments from
	// May onward, in families too small to earn a chip, plus one-offs.
	for (const [prefix, n] of [["u20_", 8], ["u40_", 8], ["i1500_", 8], ["i1800_", 8], ["motorA_", 6], ["motorB_", 6], ["phase_k2000_", 6], ["phase_k4000_", 6]] as const) {
		for (let i = 0; i < n; i++) out.push(`${prefix}${i}.csv`);
	}
	for (let i = 0; i < 62; i++) out.push(`oneoff${i}.csv`);
	return out;
};

/** The listing as rows the card holds, which is what `familyView` partitions. */
const rowsOf = (names: readonly string[]): Array<{ file: string }> => names.map(file => ({ file }));

test("Gabe's listing is 259 captures, 141 of them in named families", () => {
	// The fixture states what the other assertions are about. A drift here is a
	// drift in what the tests below are testing.
	const names = board259();
	assert.equal(names.length, 259);
	assert.equal(names.filter(n => n.startsWith("ring1_")).length, 60);
	assert.equal(names.filter(n => n.startsWith("ring1_v_")).length, 48);
	assert.equal(names.filter(n => /^[ABC]_/.test(n)).length, 66);
	assert.equal(names.filter(n => n.startsWith("baseline_")).length, 15);
});

test("a chip's number IS the list clicking it produces — the same array", () => {
	// The defect, in one assertion. `ring1_` labelled itself 60 and produced 12,
	// because the label counted a raw prefix match and the click applied a
	// filter that subtracted the sub-family beside it.
	const rows = rowsOf(board259());
	const view = familyView(rows, 3, null);
	for (const chip of [...view.families, ...(view.rest === null ? [] : [view.rest])]) {
		const clicked = familyView(rows, 3, chip.key);
		assert.equal(clicked.shown.length, chip.rows.length, `${chip.label}: chip says ${chip.rows.length}, click yields ${clicked.shown.length}`);
		assert.deepEqual(clicked.shown, chip.rows);
	}
});

test("the chips and the residual sum to the listing, so nothing is hidden", () => {
	const rows = rowsOf(board259());
	const view = familyView(rows, 3, null);
	const chips = [...view.families, ...(view.rest === null ? [] : [view.rest])];
	const total = chips.reduce((n, chip) => n + chip.rows.length, 0);
	assert.equal(total, 259, chips.map(c => `${c.label}=${c.rows.length}`).join(" "));
	// And the residual is the 118 the chips used to lose. 259 - 48 - 24 - 12.
	assert.equal(view.rest?.rows.length, 175);
});

test("no capture is unreachable: every name lands in exactly one bucket", () => {
	const rows = rowsOf(board259());
	const view = familyView(rows, 3, null);
	const chips = [...view.families, ...(view.rest === null ? [] : [view.rest])];
	const seen = new Map<string, number>();
	for (const chip of chips) {
		for (const row of chip.rows) seen.set(row.file, (seen.get(row.file) ?? 0) + 1);
	}
	assert.equal(seen.size, 259);
	const wrong = [...seen].filter(([, n]) => n !== 1);
	assert.deepEqual(wrong, [], "a name in two buckets, or in none");
	for (const name of board259()) assert.ok(seen.has(name), `${name} is in no bucket`);
});

test("name families are derived from the listing, biggest first", () => {
	const view = familyView(rowsOf(board259()), 3, null);
	assert.deepEqual(
		view.families.map(f => ({ prefix: f.label, count: f.rows.length })),
		[{ prefix: "ring1_v_", count: 48 }, { prefix: "A_", count: 24 }, { prefix: "ring1_", count: 12 }],
	);
	assert.equal(view.rest?.label, "other");
});

test("two prefixes covering the same files are offered once, by the shorter name", () => {
	const view = familyView(rowsOf(["a_b_1.csv", "a_b_2.csv", "a_b_3.csv", "a_b_4.csv"]), 3, null);
	assert.deepEqual(view.families.map(f => f.label), ["a_"]);
	assert.equal(view.families[0]!.rows.length, 4);
	// Everything is in a family, so there is no residual chip to offer.
	assert.equal(view.rest, null);
});

test("families stop at two levels, so a chip never means \"the rest of\"", () => {
	// Ranking purely by count offered `ring1_v_zv_52_` as its own chip, which
	// made the `ring1_v_` chip beside it mean the OTHER shapers. Capping depth
	// is what keeps a chip's name true.
	const view = familyView(rowsOf(board259()), 8, null);
	assert.ok(view.families.every(f => (f.label.match(/_/g) ?? []).length <= 2), JSON.stringify(view.families.map(f => f.label)));
});

test("the ring1_ family means the twelve, not the sixty", () => {
	// The case the chips exist for: 60 files start `ring1_`, and 48 of them are
	// the verify run. No substring picks out the other twelve.
	const rows = rowsOf(board259());
	const view = familyView(rows, 3, "ring1_");
	assert.equal(view.lit, "ring1_");
	assert.equal(view.shown.length, 12, view.shown.map(r => r.file).join(", "));
	assert.ok(view.shown.every(r => !r.file.startsWith("ring1_v_")));
	assert.equal(familyView(rows, 3, "ring1_v_").shown.length, 48);
	assert.equal(familyView(rows, 3, null).shown.length, 259);
});

test("a lit chip the listing no longer holds reads as nothing lit, and shows everything", () => {
	// Switching source, or typing a query, can take a family away under the
	// operator. A chip cannot be pressed while the table shows everything.
	const view = familyView(rowsOf(["a_1.csv", "a_2.csv"]), 3, "ring1_");
	assert.equal(view.lit, null);
	assert.equal(view.shown.length, 2);
});

test("the residual is the lit bucket like any other, not a way of clearing the filter", () => {
	const rows = rowsOf(board259());
	const rest = familyView(rows, 3, null).rest!;
	const view = familyView(rows, 3, rest.key);
	assert.equal(view.lit, rest.key);
	assert.equal(view.shown.length, 175);
	// And it is exactly what the named families did not take.
	assert.ok(view.shown.every(r => !r.file.startsWith("ring1_") && !r.file.startsWith("A_")));
	assert.ok(view.shown.some(r => r.file.startsWith("u20_")), "u20_ is one of the 118");
	assert.ok(view.shown.some(r => r.file.startsWith("motorB_")));
	assert.ok(view.shown.some(r => r.file.startsWith("phase_k2000_")));
	assert.ok(view.shown.some(r => r.file.startsWith("B_")), "a family too small for a chip is still reachable");
});

/* ---------------------------------------- ticking rows of any of the sources */

const rowFor = (ref: CaptureRef): { key: string; ref: CaptureRef } => ({ key: ref.key, ref });

test("a tool-source row can be ticked and counts toward Fit N", () => {
	// Reported by Gabe, 2026-08-23: with the Tool chip lit, twelve rows were
	// visible, none had a checkbox, and the button read "Fit 0". A tool's
	// captures are ordinary files in 0:/sys/accelerometer and download
	// identically to board rows, so nothing about them is unfittable — which is
	// what makes re-fitting a stale tool<N>.json possible after #33 replaced
	// the estimator.
	const files = ["ring1_Xp0.csv", "ring1_Xm0.csv", "ring1_Yp0.csv"];
	const rows = files.map(f => rowFor(boardRef(f)));
	const ticked = new Set(rows.map(r => r.key));
	const chosen = chosenCaptures(rows, ticked);
	assert.equal(chosen.length, 3, "Fit N counts the tool rows");
	assert.deepEqual(chosen.map(r => r.file), files);
	// And they are board refs, so the loader downloads them like any other.
	assert.ok(chosen.every(r => r.kind === "board"));
});

test("ticks are held by key, so two imports of the same name are two captures", () => {
	const a = importRef(0, "ring1_Xp0.csv", "a");
	const b = importRef(1, "ring1_Xp0.csv", "b");
	const rows = [rowFor(a), rowFor(b)];
	const chosen = chosenCaptures(rows, new Set([a.key]));
	assert.equal(chosen.length, 1);
	assert.equal(chosen[0], a, "the tick names one of the two, not both and not the other");
});

test("selection order is the order the table shows, not the order of the ticks", () => {
	// The batch is downloaded in this order and the run's progress line names
	// the file it is on, so it has to be the order on screen.
	const rows = ["c.csv", "a.csv", "b.csv"].map(f => rowFor(boardRef(f)));
	const chosen = chosenCaptures(rows, new Set(["board:a.csv", "board:b.csv", "board:c.csv"]));
	assert.deepEqual(chosen.map(r => r.file), ["c.csv", "a.csv", "b.csv"]);
});

/**
 * A BACKSTOP for the two pure functions above, not the mechanism.
 *
 * `chosenCaptures` and `importedCount` can only keep the two questions apart
 * if the card asks them. The gate that caused this — a checkbox rendered
 * `when={row.origin === "board"}` — was one expression in the JSX, and nothing
 * in a type stops someone writing it again.
 */
test("the card does not consult a row's origin to decide what may be ticked", () => {
	const card = readFileSync(new URL("../src/cards/ShapingCards.tsx", import.meta.url), "utf8");
	const gates = card.split(/\r?\n/)
		.map((line, i) => [i + 1, line] as const)
		.filter(([, line]) => /origin\s*===\s*"board"/.test(line));
	assert.deepEqual(gates, [], "a row's origin decides where its bytes come from, not whether it may be selected");
	assert.ok(card.includes("chosenCaptures(rows(), selected())"), "the batch must come from the one function that ignores origin");
});

test("attribution is the question origin answers — and the only one", () => {
	// Everything can be fitted; only the machine's own captures can be written
	// against a tool. An imported CSV may be from another machine or another
	// day, and a fingerprint mixing the two is unrecoverable from the file.
	assert.equal(importedCount([boardRef("a.csv"), boardRef("b.csv")]), 0);
	assert.equal(importedCount([boardRef("a.csv"), importRef(0, "b.csv", "x")]), 1);
	assert.equal(importedCount([]), 0, "an empty batch is not an imported one");
});

test("the text filter is a case-insensitive substring, and empty matches everything", () => {
	assert.ok(matchesQuery("ring1_Xp0.csv", "XP0"));
	assert.ok(matchesQuery("ring1_Xp0.csv", ""));
	assert.ok(matchesQuery("ring1_Xp0.csv", "  "));
	assert.ok(!matchesQuery("ring1_Xp0.csv", "Yp0"));
});

/* ------------------------------------ aggregating a batch of board captures */

test("a batch aggregate counts only the captures that fitted, and says how many", () => {
	// Three real captures off Gabe's machine plus one synthetic that rings
	// itself out too fast to fit. It used to be four real ones, with
	// `ring1_Xp1.csv` supplying the refusal; since GIT_33 all twelve real
	// captures fit, so the refusal has to be constructed. The property is
	// unchanged and is the one the card depends on: 3-of-4 and 4-of-4 medians
	// look identical, so the count is what goes on screen.
	const real = ["ring1_Xp0.csv", "ring1_Yp0.csv", "ring1_Ym0.csv"] as const;
	const records: Array<{ file: string; axis: Axis; fit: Mode | NoFit }> = real.map(file => {
		const axis: Axis = captureNameParts(file).axis;
		return { file, axis, fit: fitted(file, axis).fit };
	});
	records.splice(1, 0, { file: "synthetic-short.csv", axis: "X", fit: syntheticFit(40, 0.19, 0.3).fit });
	const fingerprint = aggregate(records);
	const contributed = fingerprint.n.X + fingerprint.n.Y;

	assert.equal(records.length, 4);
	assert.equal(contributed, 3, "the short-decay capture did not fit and must not be counted");
	assert.equal(fingerprint.n.X, 1);
	assert.equal(fingerprint.n.Y, 2);
	// The record for the refused capture is still there — the file keeps it, the
	// medians do not.
	const refused = records.find(r => r.file === "synthetic-short.csv")!;
	assert.ok(!isMode(refused.fit) && refused.fit.reason === "short-decay");

	// And the numbers are the surviving X capture's own, not an average dragged
	// toward the one that was thrown out.
	const kept = fitted("ring1_Xp0.csv", "X").fit;
	assert.ok(isMode(kept));
	assert.equal(fingerprint.X?.f, kept.f);
	assert.equal(fingerprint.X?.zeta, kept.zeta);
});

test("a batch where nothing fits produces a fingerprint of nulls, not zeros", () => {
	const fingerprint = aggregate([
		{ axis: "X" as Axis, fit: { reason: "below-floor" } },
		{ axis: "Y" as Axis, fit: { reason: "short-decay" } },
	]);
	assert.equal(fingerprint.X, null);
	assert.equal(fingerprint.Y, null);
	assert.equal(fingerprint.n.X + fingerprint.n.Y, 0, "0 of 2 contributed");
});

/* ------------- whether a reference still has a file behind it (GitHub #59) */

/**
 * The second half of #59: a capture reference whose CSV has been deleted
 * rendered exactly like one that was still there.
 *
 * Gabe emptied `0:/sys/accelerometer` on 2026-08-23 and T0's twelve rows
 * carried on drawing their frequencies, their damping and their peaks — the
 * numbers are in `tool0.json`, so nothing on the row needed the file — and
 * 404'd one at a time as he clicked them. It survived a hard reload, because
 * the results file survived it too.
 *
 * The fix is that liveness is READ rather than assumed, and the tests below
 * are about the two ways an assumption could sneak back: answering `gone` from
 * a directory nobody has read, and answering `live` from one whose read is
 * still in flight.
 */
const held = (...n: string[]): ReadonlySet<string> => new Set(n);

test("a capture the listing holds is live; one the listing does not hold is gone", () => {
	const there = held("ring1_Xp0.csv", "ring1_Xm0.csv");
	assert.deepEqual(captureLiveness(boardRef("ring1_Xp0.csv"), "read", there), { kind: "live" });
	assert.deepEqual(captureLiveness(boardRef("ring1_Yp2.csv"), "read", there), { kind: "gone" });
});

test("a directory nobody has read yields unchecked — never gone, and never live", () => {
	// The defect this exists to stop is the OPPOSITE of the reported one:
	// condemning twelve perfectly good captures because the card had not
	// looked. Absence of evidence is its own answer and has to be sayable.
	for (const state of ["unread", "reading", "failed"] as const) {
		const live = captureLiveness(boardRef("ring1_Xp0.csv"), state, held());
		assert.deepEqual(live, { kind: "unchecked" }, `${state} must not decide anything`);
	}
	// And with a finished reading of an empty directory, the same file IS gone.
	assert.deepEqual(captureLiveness(boardRef("ring1_Xp0.csv"), "read", held()), { kind: "gone" });
});

test("an import is held, whatever the board's directory says or does not say", () => {
	// Its CSV is in the ref. It is readable with the board unplugged, and it
	// was never in that directory — so calling it `live` would be a claim about
	// an SD card that is not merely unchecked but false.
	const ref = importRef(0, "ring1_Xp0.csv", "1,2,3");
	for (const state of ["unread", "reading", "read", "failed"] as const) {
		assert.deepEqual(captureLiveness(ref, state, held()), { kind: "held" });
	}
});

test("a row that came OUT of the listing stays live while the listing is re-read", () => {
	// The board source's rows ARE the listing, so a re-list in flight must not
	// demote them: the When column would flicker a column of dates into a
	// column of the word "unchecked" for as long as `rr_filelist` takes over
	// 276 files, on the card whose one gesture is clicking down that list.
	const there = held("ring1_Xp0.csv");
	assert.deepEqual(captureLiveness(boardRef("ring1_Xp0.csv"), "reading", there), { kind: "live" });
});

test("a failed re-read withdraws the verdict rather than keeping it", () => {
	// What the board told us about is still there; what it did not is back to
	// unchecked, because a transfer that failed is not evidence of a deletion.
	const there = held("ring1_Xp0.csv");
	assert.deepEqual(captureLiveness(boardRef("ring1_Xp0.csv"), "failed", there), { kind: "live" });
	assert.deepEqual(captureLiveness(boardRef("ring1_Ym2.csv"), "failed", there), { kind: "unchecked" });
});

/* ----------------------------- what Rescan is for, per source (GitHub #59) */

test("Rescan lists the rows for the board source and CHECKS them for the tool source", () => {
	// Both are things re-reading the directory does, and the second is the one
	// `disabled={source() !== "board"}` denied: a tool row's file lives in the
	// same directory, so re-listing it is exactly how that row learns whether
	// it still has one.
	const board = rescanReadiness("board", 0, "read");
	assert.equal(board.enabled, true);
	assert.equal(board.rescan.kind, "lists-the-rows");

	const tool = rescanReadiness("tool", 3, "read");
	assert.equal(tool.enabled, true);
	assert.deepEqual(tool.rescan, { kind: "checks-the-rows", tool: 3, checked: true });
	assert.deepEqual(rescanReadiness("tool", 0, "unread").rescan, { kind: "checks-the-rows", tool: 0, checked: false });
});

test("the one source Rescan cannot serve is imported, and it is refused with a reason", () => {
	const imported = rescanReadiness("imported", 0, "read");
	assert.equal(imported.enabled, false);
	assert.deepEqual(imported.rescan, { kind: "nothing-to-list" });
	// Refused as DATA, so the sentence is written from the same value the grey
	// is — the shape `refusalText` established for exactly this.
	const why = rescanNoteText(imported.rescan);
	assert.ok(why.includes("this computer"), why);
	assert.ok(why.includes(ACCEL_DIR), why);
});

test("enabled is derived from the reason, so a control cannot be grey for a reason it does not give", () => {
	for (const source of ["tool", "board", "imported"] as const) {
		for (const state of ["unread", "reading", "read", "failed"] as const) {
			const r = rescanReadiness(source, 0, state);
			assert.equal(r.enabled, r.rescan.kind !== "nothing-to-list", `${source}/${state}`);
			assert.ok(rescanNoteText(r.rescan).length > 0, `${source}/${state} says nothing`);
		}
	}
});

/**
 * BACKSTOPS on the card, in the shape the origin-gate test above uses.
 *
 * Both halves of #59 were ONE EXPRESSION each in the JSX — a `disabled` that
 * named the source directly, and a row literal that never asked about the
 * file — and nothing in a type stops either being written again.
 */
test("the card disables Rescan from the readiness, never from the source", () => {
	const card = readFileSync(new URL("../src/cards/ShapingCards.tsx", import.meta.url), "utf8");
	// Comments stripped: the doc beside the fix QUOTES the expression it
	// replaced, which is worth keeping and is not a control.
	const code = card.replace(/\/\*[\s\S]*?\*\//g, "");
	assert.ok(
		!/disabled=\{source\(\)\s*!==\s*"board"\}/.test(code),
		"Rescan must not be greyed by naming a source — that is the inert-with-no-reason control #59 reported",
	);
	assert.ok(code.includes("rescanReadiness(source(), svc.tool(), svc.boardState())"), "one readiness for the control and its sentence");
	assert.ok(code.includes("disabled={!rescan().enabled}"), "the grey comes from the readiness");
	assert.ok(code.includes("rescanNoteText(rescan().rescan)"), "and the reason reaches the screen");
});

test("every row the card builds carries its liveness, from the service that holds the listing", () => {
	const card = readFileSync(new URL("../src/cards/ShapingCards.tsx", import.meta.url), "utf8");
	assert.match(card, /readonly live: Liveness;/, "a row cannot exist without the answer");
	const asked = card.split(/\r?\n/).filter(line => /live: svc\.liveness\(/.test(line));
	assert.equal(asked.length, 3, "all three sources ask — tool, board and imported");
	assert.ok(card.includes("captureWhenText(row.when, row.live)"), "the When cell goes through the one decider");
	assert.ok(card.includes('"shp-gone": row.live.kind === "gone"'), "and a dead row is marked as dead");
});
