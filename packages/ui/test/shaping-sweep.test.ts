import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCapture } from "../src/shaping/engine/capture.ts";
import { sweepMatrix, cruiseWindow } from "../src/shaping/engine/sweep.ts";
import { mmPerS, seconds } from "../src/shaping/engine/units.ts";
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

test("sweepMatrix: full-step line is speed × 5 and the 100 mm/s row peaks at ~250 Hz", () => {
	const m = sweepMatrix(rows(), 5);
	assert.deepEqual(m.speeds, [20, 50, 100, 200]);
	assert.deepEqual(m.fullStepHz.map(Number), [100, 250, 500, 1000]);
	assert.equal(m.freqs.length, 701);
	const row = 2; // 100 mm/s
	let best = 0;
	for (let k = 5; k <= 700; k++) if (m.amps[row * 701 + k]! > m.amps[row * 701 + best]!) best = k;
	assert.ok(Math.abs(best - 250) <= 2, `peak bin ${best}`);
	assert.ok(m.amps[row * 701 + best]! > 1.0, `amplitude ${m.amps[row * 701 + best]} g`); // prototype: 1.55 g
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
