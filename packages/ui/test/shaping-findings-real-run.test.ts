/**
 * The gate: run the findings over the captures that produced the 2026-08-23
 * wrong conclusion, and require them to say the thing that was worked out by
 * hand that night.
 *
 * These are the real files, referenced in place rather than copied — #53 also
 * names this directory as its regression fixture home, and two copies of 1.3 MB
 * of captures is two things that can drift.
 *
 * Note what is and is not asserted. The ARITHMETIC findings (which band, which
 * speed) are exact: they do not go through the fitter and cannot move. The
 * FITTED numbers are asserted as "the finding fires" and "the sentence renders",
 * not as an exact Hz, because pinning a fitter's output in a test that is not
 * about the fitter turns every legitimate improvement to fit.ts into a red test
 * here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detectStop, parseCapture } from "../src/shaping/engine/capture.ts";
import { aggregate, type Axis, fitDecay } from "../src/shaping/engine/fit.ts";
import { sweepMatrix, type SweepRow } from "../src/shaping/engine/sweep.ts";
import { caveatText } from "../src/shaping/copy.ts";
import { fingerprintCaveats, forcingBand, sweepCaveats } from "../src/shaping/evidence/findings.ts";
import { mmPerS, seconds } from "../src/shaping/engine/units.ts";
import type { CaptureRecord } from "../src/shaping/results.ts";

const run = (n: string): string =>
	readFileSync(new URL(`../../../tools/accel/runs/ui-first-run-2026-08-23/${n}`, import.meta.url), "utf8");

const LADDER = [25, 34, 45, 61, 82, 110, 149, 200];
/** Gabe's X: 80 steps/mm / 16x microstepping (shaping/fullStep.ts). */
const PER_MM = 5;
/**
 * The configured default move length (config/types.ts:305).
 *
 * It affects ONLY the cruise window, and therefore only `rows-not-analysed`.
 * Every coverage assertion below is speed x full-step-rate and does not depend
 * on it, which is why an approximate distance is honest here.
 */
const DIST_MM = 60;

const sweepRows = (axis: "X" | "Y"): SweepRow[] =>
	LADDER.map((speed) => {
		const file = `t0_sweep_${axis}_${speed}.csv`;
		const parsed = parseCapture(run(file));
		assert.ok(parsed.ok, `${file} did not parse`);
		return {
			speed: mmPerS(speed),
			capture: parsed.capture,
			moveS: seconds(DIST_MM / speed),
			axis: (axis === "X" ? 0 : 1) as 0 | 1,
		};
	});

/** The 20 ring captures, fitted exactly as the app fits them. */
const records = (): CaptureRecord[] => {
	const out: CaptureRecord[] = [];
	for (const axis of ["X", "Y"] as const) {
		for (const dir of ["p", "m"] as const) {
			for (let rep = 0; rep < 5; rep++) {
				const file = `t0_ring_${axis}${dir}${rep}.csv`;
				const parsed = parseCapture(run(file));
				assert.ok(parsed.ok, `${file} did not parse`);
				const cap = parsed.capture;
				const moveAxis = axis === "X" ? cap.x : cap.y;
				const tStop = detectStop(moveAxis, cap.rate);
				out.push({
					file,
					axis,
					dir: dir === "p" ? "+" : "-",
					rep,
					fit: tStop === null ? { reason: "short-window" } : fitDecay(moveAxis, cap.rate, tStop),
					tStop,
				});
			}
		}
	}
	return out;
};

test("the real ladder forces 125-1000 Hz", () => {
	const m = sweepMatrix(sweepRows("X"), PER_MM);
	const band = forcingBand(m);
	assert.ok(band !== null);
	assert.equal(Number(band[0]), 125);
	assert.equal(Number(band[1]), 1000);
});

test("the sweep says out loud that it could not have seen the fitted modes", () => {
	const caps = records();
	const fp = aggregate(caps.map((c) => ({ axis: c.axis as Axis, fit: c.fit })));
	const m = sweepMatrix(sweepRows("X"), PER_MM);

	const undriven = sweepCaveats(m, fp).filter((c) => c.kind === "forcing-band-excludes-mode");
	assert.ok(undriven.length > 0, "the fitted modes are far below 125 Hz; this must fire");

	for (const c of undriven) {
		assert.equal(c.kind, "forcing-band-excludes-mode");
		// The remedy has to be inside the range derived by hand that night:
		// roughly 5-15 mm/s to bracket modes in the high 30s / low 40s.
		assert.ok(c.needMmPerS > 1 && c.needMmPerS < 25, `suggested ${c.needMmPerS} mm/s`);
		const text = caveatText(c);
		assert.match(text, /125/);
		assert.match(text, /1000/);
		assert.match(text, /mm\/s/);
	}
});

test("every sentence this real data produces renders without a placeholder", () => {
	const caps = records();
	const fp = aggregate(caps.map((c) => ({ axis: c.axis as Axis, fit: c.fit })));
	const m = sweepMatrix(sweepRows("X"), PER_MM);

	const all = [...sweepCaveats(m, fp), ...fingerprintCaveats(fp, caps, m)];
	assert.ok(all.length > 0, "this run is not clean; something must be said about it");
	for (const c of all) {
		const text = caveatText(c);
		assert.ok(text.length > 0, `${c.kind} has no copy`);
		assert.ok(!/\bundefined\b|\bNaN\b|\[object/.test(text), `${c.kind} leaked a value: ${text}`);
	}
});

/**
 * The prototype baseline, taken with shaping OFF. `ring1_*` is the clean
 * counterpart to the run above and exists so the axes-agree finding has a
 * NEGATIVE real-data case: a detector that fires on everything says nothing.
 */
const prototype = (): CaptureRecord[] => {
	const out: CaptureRecord[] = [];
	for (const axis of ["X", "Y"] as const) {
		for (const dir of ["p", "m"] as const) {
			for (let rep = 0; rep < 3; rep++) {
				const file = `ring1_${axis}${dir}${rep}.csv`;
				const text = readFileSync(new URL(`./fixtures/shaping/ring1/${file}`, import.meta.url), "utf8");
				const parsed = parseCapture(text);
				assert.ok(parsed.ok, `${file} did not parse`);
				const cap = parsed.capture;
				const moveAxis = axis === "X" ? cap.x : cap.y;
				const tStop = detectStop(moveAxis, cap.rate);
				out.push({
					file,
					axis,
					dir: dir === "p" ? "+" : "-",
					rep,
					fit: tStop === null ? { reason: "short-window" } : fitDecay(moveAxis, cap.rate, tStop),
					tStop,
				});
			}
		}
	}
	return out;
};

const fingerprintOf = (caps: readonly CaptureRecord[]) =>
	aggregate(caps.map((c) => ({ axis: c.axis as Axis, fit: c.fit })));

test("the contaminated run is called out for its two axes agreeing", () => {
	// THE POINT. Every one of these 20 captures fits cleanly, so no refusal,
	// no few-fits and no direction-spread finding fires — yet #53 records that
	// the board was running M593 P"ei2" F52 S0.034 throughout, which suppressed
	// both axis modes and left the same ~15 Hz residual on each. Without this
	// finding the worst bug currently open produces a spotless card.
	const caps = records();
	const fp = fingerprintOf(caps);
	assert.ok(fp.X !== null && fp.Y !== null);

	const c = fingerprintCaveats(fp, caps, null).find((x) => x.kind === "axes-agree");
	assert.ok(c !== undefined && c.kind === "axes-agree", "both axes near 15 Hz must be reported");
	assert.ok(c.apartFraction < 0.05, `axes were ${(c.apartFraction * 100).toFixed(1)} % apart`);
	// The sentence must name both readings and refuse to pick between the two
	// explanations, because the tool cannot yet tell which it is.
	const text = caveatText(c);
	assert.match(text, /shaper/);
	assert.match(text, /frame mode/);
});

test("the clean prototype baseline is NOT called out", () => {
	// X 18.14 Hz against Y 51.68 Hz with shaping off: a detector that also
	// fired here would be worthless.
	const caps = prototype();
	const fp = fingerprintOf(caps);
	assert.ok(fp.X !== null && fp.Y !== null);
	assert.ok(Number(fp.X.f) > 15 && Number(fp.Y.f) > 45, `prototype fitted X${fp.X.f} Y${fp.Y.f}`);
	assert.equal(fingerprintCaveats(fp, caps, null).filter((c) => c.kind === "axes-agree").length, 0);
});
