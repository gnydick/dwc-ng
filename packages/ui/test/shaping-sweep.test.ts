import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEAD_IN_S, parseCapture } from "../src/shaping/engine/capture.ts";
import { analysedRows, sweepMatrix, cruiseWindow, type SweepRow } from "../src/shaping/engine/sweep.ts";
import { mm, mmPerS, mmPerS2, seconds } from "../src/shaping/engine/units.ts";
import { captureWindow } from "../src/shaping/procedure.ts";
import { handle } from "../src/shaping/worker.ts";
import { isMode } from "../src/shaping/engine/fit.ts";

const fx = (n: string): string => readFileSync(new URL(`./fixtures/shaping/${n}`, import.meta.url), "utf8");

function rows() {
	return [20, 50, 100, 200].map((speed) => {
		const r = parseCapture(fx(`baseline_X_${speed}.csv`));
		if (!r.ok) throw new Error(String(speed));
		return { speed: mmPerS(speed), capture: r.capture, moveS: seconds(100 / speed) };
	});
}

test("cruiseWindow stays inside the record for a move longer than the capture", () => {
	const r = parseCapture(fx("baseline_X_20.csv"));
	assert.ok(r.ok);
	const w = cruiseWindow(r.capture, seconds(5));
	assert.ok(w.from < w.to && w.to <= r.capture.x.length);
});

/**
 * The real ladder — the same files, and the same single copy, as
 * shaping-findings-real-run.test.ts reads. Tracked in this package's fixture
 * tree; see that file for why they are no longer read out of tools/accel/runs.
 */
const run = (n: string): string => readFileSync(new URL(`./fixtures/shaping/ui-first-run-2026-08-23/${n}`, import.meta.url), "utf8");

const LADDER = [25, 34, 45, 61, 82, 110, 149, 200];
/** `shaping.defaults.distMm` (config/types.ts) — what the run was taken with. */
const DIST_MM = 60;
/** The run's configured acceleration. Only ever used to compute a ramp length,
 *  and only so the assertions below can name the cruise's real edges rather
 *  than an approximation of them. */
const ACCEL_MM_S2 = 6000;

/**
 * When the carriage actually starts, read from the record and NOT from
 * anything sweep.ts believes.
 *
 * The same 12 ms / 0.25 g boxcar `detectStop` uses to find the last
 * acceleration pulse, taking the FIRST crossing instead of the last. Written
 * out here on purpose: a test that checked `cruiseWindow` against the constant
 * `cruiseWindow` is built on would pass whatever that constant said.
 */
function firstMotionS(sig: Float64Array, rate: number): number | null {
	const k = Math.max(1, Math.round(0.012 * rate));
	const sorted = Float64Array.from(sig).sort();
	const med = sorted[sorted.length >> 1]!;
	let acc = 0;
	for (let i = 0; i < sig.length; i++) {
		acc += sig[i]! - med;
		if (i >= k) acc -= sig[i - k]! - med;
		if (i >= k - 1 && Math.abs(acc / k) > 0.25) return (i - k + 1) / rate;
	}
	return null;
}

/**
 * The bug this file exists to keep out: a window that opens before the move.
 *
 * `M956` starts recording when it executes and the `G1` behind it does not
 * start the carriage for another ~0.09 s, so a head margin taken from sample 0
 * is a margin into the wrong thing. The old `0.1 * moveS` cleared that gap only
 * for moves longer than 1.2 s — below `distMm / 1.2`, i.e. 50 mm/s at this
 * run's 60 mm — so the FAST half of every ladder opened its window on silence
 * and then ran through the acceleration ramp. At 200 mm/s the window was
 * 0.030..0.270 s against a cruise that does not begin until 0.124 s.
 *
 * Asserted against the record's own edges: past `firstMotion + ramp`, and
 * closing before `firstMotion + moveS - ramp`. The second half matters as much
 * as the first — the lead-in is a deliberate over-estimate, which is safe at
 * the head and would push the tail INTO the deceleration, so it is added to
 * `from` alone.
 */
test("cruiseWindow: on the real ladder the window lies inside the cruise, both ends", () => {
	let checked = 0;
	for (const axis of ["X", "Y"] as const) {
		for (const speed of LADDER) {
			const file = `t0_sweep_${axis}_${speed}.csv`;
			const parsed = parseCapture(run(file));
			assert.ok(parsed.ok, `${file} did not parse`);
			const c = parsed.capture;
			const sig = axis === "X" ? c.x : c.y;
			const t0 = firstMotionS(sig, c.rate);
			// 25 and 34 mm/s ramp for 4-6 ms, too short for a 12 ms boxcar to
			// see; that they are unreadable to a detector is exactly why the
			// lead-in is a stated constant rather than a measurement.
			if (t0 === null) continue;
			checked++;
			const moveS = DIST_MM / speed;
			const ramp = speed / ACCEL_MM_S2;
			const w = cruiseWindow(c, seconds(moveS));
			const from = w.from / c.rate;
			const to = w.to / c.rate;
			assert.ok(
				from >= t0 + ramp,
				`${file}: window opens at ${from.toFixed(3)} s, cruise not until ${(t0 + ramp).toFixed(3)} s`,
			);
			assert.ok(
				to <= t0 + moveS - ramp,
				`${file}: window closes at ${to.toFixed(3)} s, past the decel at ${(t0 + moveS - ramp).toFixed(3)} s`,
			);
		}
	}
	assert.equal(checked, 12, "the detector should read 12 of the 16 sweep captures");
});

/**
 * A later head must not start quietly dropping rows.
 *
 * `sweepMatrix` skips a row whose window holds fewer than 64 samples and leaves
 * it all zeros, which `analysedRows` counts out and `sweepCaveats` reports —
 * visible, but still a row lost. The correction costs `LEAD_IN_S * rate` ~= 165
 * samples off every window, and the thinnest row of the standard ladder
 * (200 mm/s) has 331 to give.
 */
test("cruiseWindow: the tighter head costs the real ladder no rows", () => {
	const rows: SweepRow[] = LADDER.map((speed) => {
		const parsed = parseCapture(run(`t0_sweep_X_${speed}.csv`));
		assert.ok(parsed.ok);
		return { speed: mmPerS(speed), capture: parsed.capture, moveS: seconds(DIST_MM / speed), axis: 0 as const };
	});
	assert.equal(analysedRows(sweepMatrix(rows, 5)), rows.length);
	for (const r of rows) {
		const w = cruiseWindow(r.capture, r.moveS);
		assert.ok(w.to - w.from >= 64, `${r.speed} mm/s: ${w.to - w.from} samples`);
	}
});

/**
 * One lead-in, one value, wherever it is read.
 *
 * `captureWindow` sizes the recording with it and `cruiseWindow` locates the
 * move inside the finished record with it; they are the same physical gap and
 * two literals could drift apart without either file looking wrong. The engine
 * owns the number (engine/capture.ts `LEAD_IN_S`); this pins procedure.ts to
 * it by DERIVING what its arithmetic used, rather than by reading a constant.
 */
test("the lead-in procedure.ts sizes a recording with is the engine's LEAD_IN_S", () => {
	const w = captureWindow(mm(60), mmPerS(200), mmPerS2(6000), null);
	assert.ok(Math.abs(w.captureS - w.moveS - w.ringS - LEAD_IN_S) < 1e-9, `derived ${w.captureS - w.moveS - w.ringS}`);
});

test("sweepMatrix: full-step line is speed × 5 and the 100 mm/s row peaks at ~250 Hz", () => {
	const m = sweepMatrix(rows(), 5);
	assert.deepEqual(m.speeds, [20, 50, 100, 200]);
	assert.deepEqual(m.fullStepHz.map(Number), [100, 250, 500, 1000]);
	// Derived, not pinned at 701. The ceiling used to be a hard-coded 700 Hz;
	// it is now the lower of the locus-plus-headroom and Nyquist
	// (engine/sweep.ts `plotCeiling`), so a fixed number here would be
	// asserting the old default rather than this test's actual subject.
	const bins = m.freqs.length;
	assert.equal(bins, m.maxHz + 1);
	const row = 2; // 100 mm/s
	let best = 0;
	for (let k = 5; k < bins; k++) if (m.amps[row * bins + k]! > m.amps[row * bins + best]!) best = k;
	assert.ok(Math.abs(best - 250) <= 2, `peak bin ${best}`);
	assert.ok(m.amps[row * bins + best]! > 1.0, `amplitude ${m.amps[row * bins + best]} g`); // prototype: 1.55 g
});

test("worker handle: fit routes a capture through detectStop + fitDecay and returns transferables", () => {
	const { response, transfer } = handle({ id: 7, kind: "fit", csv: fx("ring1/ring1_Xp0.csv"), axis: "X" });
	assert.equal(response.id, 7);
	assert.ok(response.kind === "fit");
	assert.ok(response.result.tStop !== null && isMode(response.result.fit) && Math.abs(response.result.fit.f - 18.1) < 0.5);
	assert.equal(transfer.length, 3);
});

test("worker handle: a bad capture becomes an error response, not a throw", () => {
	const { response } = handle({ id: 1, kind: "fit", csv: "garbage", axis: "X" });
	assert.ok(response.kind === "error" && response.error.includes("trailer"));
});

test("worker handle: sweep and artefact route", () => {
	const sweep = handle({ id: 2, kind: "sweep", rows: [20, 50].map((s) => ({ speed: mmPerS(s), csv: fx(`baseline_X_${s}.csv`), moveS: seconds(100 / s) })), fullStepsPerMm: 5 });
	assert.ok(sweep.response.kind === "sweep" && sweep.response.result.speeds.length === 2);
});
