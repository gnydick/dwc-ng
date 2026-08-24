/**
 * Accelerometer + input-shaping emulation.
 *
 * The cross-workspace tests import the UI's shaping engine directly
 * (`packages/ui/src/shaping/engine`). That is the whole point of the
 * emulation: the mock is an INDEPENDENT model of the machine — it shares no
 * code with the analyser — so "the engine recovers the mode the mock was told
 * to ring at" is a real cross-check rather than one implementation agreeing
 * with itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Machine } from "../src/machine.ts";
import { loadCaptureFile } from "../src/capture.ts";
import { scenarios } from "../src/scenarios/index.ts";
import {
	DEFAULT_MODES,
	SAMPLE_RATE_HZ,
	synthCapture,
	type Impulse,
} from "../src/accelerometer.ts";
import {
	bandPass,
	detectStop,
	fitDecay,
	aggregate,
	hz,
	isMode,
	parseCapture,
	type Capture,
} from "../../ui/src/shaping/engine/index.ts";
import { startMock } from "./helpers.ts";

/** Gabe's toolchanger: tool boards 20..23 each carry an LIS3DH (orientation 41). */
const CAPTURE = new URL("../captures/om-snapshot-2026-07-12.json", import.meta.url);

function machine(): Machine {
	return new Machine(scenarios["shaping"], loadCaptureFile(CAPTURE));
}

function text(m: Machine, path: string): string {
	const bytes = m.sd.read(path);
	assert.ok(bytes !== null, `${path} was not written`);
	return new TextDecoder().decode(bytes);
}

/** Names in the capture folder; the folder itself must exist. */
function names(m: Machine): string[] {
	const listing = m.sd.list("0:/sys/accelerometer");
	assert.ok(Array.isArray(listing), `0:/sys/accelerometer is ${String(listing)}`);
	return listing.map(e => e.name);
}

/** The accelerometer object on tool board 20, as a client reads it. */
function boardAccel(m: Machine): { orientation: number; points: number; runs: number } {
	const board = (m.om.boards as Array<{ canAddress?: number; accelerometer?: unknown } | null>)
		.find(b => b !== null && b.canAddress === 20);
	assert.ok(board?.accelerometer, "tool board 20 has no accelerometer");
	return board.accelerometer as { orientation: number; points: number; runs: number };
}

/**
 * Let any in-flight capture transfer land.
 *
 * A move ARMS and creates the file; the samples come back off the toolboard
 * afterwards, in simulated time, and only then do `runs` and `points` move. So
 * every test that wants a finished capture has to let the board finish writing
 * one — which is precisely what a client has to do, and what the UI failed to
 * do on 2026-08-23. The span is generous: the longest capture the board will
 * accept (65535 samples at 1344 Hz) takes under 49 s to transfer.
 */
function settle(m: Machine): void {
	m.advance(60_000);
}

function capture(m: Machine, path: string): Capture {
	const parsed = parseCapture(text(m, path));
	assert.ok(parsed.ok, `parseCapture rejected ${path}: ${JSON.stringify(parsed)}`);
	return parsed.capture;
}

/**
 * Peak of the band-limited ring at the mode's frequency, after the stop.
 *
 * The band-limited SIGNAL, not an envelope: the engine deliberately has no
 * measured-envelope function, because a zero-phase band mask cannot report
 * amplitude across the abrupt onset at a stop (see engine/spectrum.ts). A
 * peak over the whole post-stop span is dominated by the interior, where the
 * mask is honest, and this test only compares shaped against unshaped.
 */
function ringPeak(cap: Capture, axis: Float64Array, f: number): number {
	const stop = detectStop(axis, cap.rate);
	assert.ok(stop !== null, "no stop detected in the synthesized move");
	const from = Math.round(stop * cap.rate);
	const band = bandPass(axis.slice(from), cap.rate, hz(f));
	let peak = 0;
	for (const v of band) peak = Math.max(peak, Math.abs(v));
	return peak;
}

/** A Y ring capture at the shaping defaults (60 mm at 200 mm/s). */
function ringY(m: Machine, name: string): Capture {
	m.execute("G90");
	m.execute("G1 Y0 F12000");
	m.execute(`M956 P20.0 S1500 A1 F"${name}"`);
	m.execute("G1 Y60 F12000");
	settle(m);
	return capture(m, `0:/sys/accelerometer/${name}`);
}

// --- M955 ------------------------------------------------------------------

test("M955 P20.0 reports the accelerometer in RRF's format", () => {
	assert.equal(
		machine().execute("M955 P20.0"),
		"Accelerometer 20:0 type LIS3DH with orientation 41 samples at 1344Hz with 10-bit resolution",
	);
});

test("M955 on a board with no accelerometer is an error", () => {
	assert.equal(machine().execute("M955 P1.0"), "Error: Accelerometer 1:0 not found");
});

test("M955 I/S/R change what the report says", () => {
	const m = machine();
	assert.equal(m.execute("M955 P20.0 I20 S400 R8"), "");
	assert.equal(
		m.execute("M955 P20.0"),
		"Accelerometer 20:0 type LIS3DH with orientation 20 samples at 400Hz with 8-bit resolution",
	);
	// Orientation is model state, not a private copy: the OM must agree.
	const board = m.om.boards.find((b: any) => b?.canAddress === 20);
	assert.equal(board.accelerometer.orientation, 20);
});

// --- M956 ------------------------------------------------------------------

test("M956 arms; the NEXT move writes the file RRF would have written", () => {
	const m = machine();
	assert.equal(m.execute('M956 P20.0 S1500 A1 F"t.csv"'), "");
	assert.equal(m.sd.read("0:/sys/accelerometer/t.csv"), null, "nothing is written before the move");

	m.execute("G90");
	m.execute("G1 X250 F6000");
	// Created, but not yet a capture: the entry is there with only its header,
	// and the board has not claimed a run.
	assert.equal(text(m, "0:/sys/accelerometer/t.csv").trim(), "Sample,X,Y,Z");
	assert.equal(boardAccel(m).runs, 0, "a board still writing has not finished a run");
	settle(m);

	const lines = text(m, "0:/sys/accelerometer/t.csv").split("\n").filter(l => l !== "");
	assert.equal(lines[0], "Sample,X,Y,Z");
	assert.equal(lines.length, 1502, "header + 1500 samples + trailer");
	assert.equal(lines[lines.length - 1], `Rate ${SAMPLE_RATE_HZ}, overflows 0`);
	assert.ok(/^0,/.test(lines[1]!), "rows are numbered from 0");
	assert.ok(/^1499,/.test(lines[1500]!), "the last sample row is 1499");

	assert.equal(boardAccel(m).runs, 1);
	assert.equal(boardAccel(m).points, 1500);
});

test("the file exists long before the capture does", () => {
	const m = machine();
	m.execute("G90");
	m.execute('M956 P20.0 S1500 A1 F"slow.csv"');
	m.execute("G1 X250 F6000");

	// A real board creates the entry and then streams the samples into it off
	// CAN. Everything a client can see at this instant says "there is a file";
	// nothing says "there is a capture".
	assert.deepEqual(names(m), ["slow.csv"], "the name is there");
	const partial = m.sd.list("0:/sys/accelerometer");
	assert.ok(Array.isArray(partial));
	const entry = partial.find(e => e.name === "slow.csv");
	assert.ok(entry !== undefined);
	const createdSize = entry.size;
	assert.equal(boardAccel(m).runs, 0);
	assert.equal(parseCapture(text(m, "0:/sys/accelerometer/slow.csv")).ok, false, "no trailer yet");

	// 1500 samples at 1344 Hz is 1.116 s of recording, and the mock's board
	// takes about that long to hand them over.
	m.advance(500);
	assert.equal(boardAccel(m).runs, 0, "half way through, still nothing to read");

	settle(m);
	assert.equal(boardAccel(m).runs, 1);
	assert.equal(boardAccel(m).points, 1500);
	const finished = m.sd.list("0:/sys/accelerometer");
	assert.ok(Array.isArray(finished));
	assert.ok(finished.find(e => e.name === "slow.csv")!.size > createdSize, "the file grew");
	assert.equal(parseCapture(text(m, "0:/sys/accelerometer/slow.csv")).ok, true);
});

test("points is the LAST run's sample count, not a running total", () => {
	// Gabe's board, read live 2026-08-23: tool board 20 answered
	// {"orientation": 41, "points": 7713, "runs": 344}. 344 runs of a few
	// thousand samples each cannot sum to 7713, so points sizes one run.
	const m = machine();
	m.execute("G90");
	m.execute('M956 P20.0 S1500 A1 F"p1.csv"');
	m.execute("G1 X250 F6000");
	settle(m);
	m.execute('M956 P20.0 S900 A1 F"p2.csv"');
	m.execute("G1 X100 F6000");
	settle(m);
	assert.equal(boardAccel(m).runs, 2);
	assert.equal(boardAccel(m).points, 900);
});

test("a board that is reset forgets the transfer it was in the middle of", () => {
	const m = machine();
	m.execute("G90");
	m.execute('M956 P20.0 S1500 A1 F"lost.csv"');
	m.execute("G1 X250 F6000");
	m.reset();
	settle(m);
	// The entry the move created survives — it is on the SD card — but no run
	// is ever claimed for it, because the board it was coming from restarted.
	assert.equal(boardAccel(m).runs, 0);
});

test("a move with nothing armed writes no capture", () => {
	const m = machine();
	m.execute("G1 X250 F6000");
	assert.deepEqual(names(m), []);
});

test("an armed capture fires exactly once", () => {
	const m = machine();
	m.execute('M956 P20.0 S1500 A1 F"once.csv"');
	m.execute("G1 X250 F6000");
	m.execute("G1 X100 F6000");
	assert.deepEqual(names(m), ["once.csv"]);
});

test("M956 refuses a sample count the board could not honour", () => {
	const m = machine();
	assert.match(m.execute('M956 P20.0 S10000000 A1 F"huge.csv"'), /^Error: M956: S parameter must be at most /);
	m.execute("G1 X250 F6000");
	assert.deepEqual(names(m), []);
});

test("M956 on an absent accelerometer is an error and arms nothing", () => {
	const m = machine();
	assert.equal(m.execute('M956 P1.0 S1500 A1 F"no.csv"'), "Error: Accelerometer 1:0 not found");
	m.execute("G1 X250 F6000");
	assert.deepEqual(names(m), []);
});

// --- the synthesized signal, judged by the UI engine -----------------------

test("the synthesized ring fits the configured Y mode within 2 %", () => {
	const m = machine();
	const cap = ringY(m, "y.csv");
	assert.equal(cap.rate, SAMPLE_RATE_HZ);
	assert.equal(cap.x.length, 1500);

	const stop = detectStop(cap.y, cap.rate);
	assert.ok(stop !== null, "detectStop found no deceleration pulse");
	// 60 mm at 200 mm/s: the move ends 0.3 s in, and detectStop lags by about
	// half its 12 ms averaging window.
	assert.ok(Math.abs(stop - 0.3) < 0.02, `stop at ${stop}s, expected ~0.30s`);

	const fit = fitDecay(cap.y, cap.rate, stop);
	assert.ok(isMode(fit), `no fit: ${JSON.stringify(fit)}`);
	const err = Math.abs(fit.f - DEFAULT_MODES.Y.f) / DEFAULT_MODES.Y.f;
	assert.ok(err < 0.02, `fitted ${fit.f} Hz vs configured ${DEFAULT_MODES.Y.f} Hz (${(err * 100).toFixed(1)} %)`);
	// fit.ts documents its own damping accuracy as ~0.03 over 12 real captures.
	assert.ok(
		Math.abs(fit.zeta - DEFAULT_MODES.Y.zeta) <= 0.03,
		`fitted zeta ${fit.zeta} vs configured ${DEFAULT_MODES.Y.zeta}`,
	);
});

test("both directions aggregate to the configured fingerprint", () => {
	const m = machine();
	m.execute("G90");
	const fits: Array<{ axis: "X" | "Y"; fit: ReturnType<typeof fitDecay> }> = [];
	for (const [axis, from, to] of [["X", 100, 160], ["X", 160, 100], ["Y", 0, 60], ["Y", 60, 0]] as const) {
		m.execute(`G1 ${axis}${from} F12000`);
		const name = `agg_${axis}${from}.csv`;
		m.execute(`M956 P20.0 S1500 A1 F"${name}"`);
		m.execute(`G1 ${axis}${to} F12000`);
		settle(m);
		const cap = capture(m, `0:/sys/accelerometer/${name}`);
		const trace = axis === "X" ? cap.x : cap.y;
		const stop = detectStop(trace, cap.rate);
		assert.ok(stop !== null);
		fits.push({ axis, fit: fitDecay(trace, cap.rate, stop) });
	}
	const fp = aggregate(fits);
	assert.equal(fp.n.X, 2);
	assert.equal(fp.n.Y, 2);
	// X is the heavily damped mode (zeta 0.13, ~2.4 cycles before the envelope
	// is gone). fit.ts states its own limit for exactly that case: such a ring
	// is located only to ~5 % in frequency. Y, at zeta 0.075, is held to 2 %.
	assert.ok(fp.X !== null && Math.abs(fp.X.f - DEFAULT_MODES.X.f) / DEFAULT_MODES.X.f < 0.05);
	assert.ok(fp.Y !== null && Math.abs(fp.Y.f - DEFAULT_MODES.Y.f) / DEFAULT_MODES.Y.f < 0.02);
});

test("M593 shaping cuts the synthesized ring to under 30 % of the unshaped one", () => {
	const before = ringY(machine(), "before.csv");
	const unshaped = ringPeak(before, before.y, DEFAULT_MODES.Y.f);

	const m = machine();
	assert.equal(m.execute('M593 P"zvd" F52 S0.1'), "");
	const after = ringY(m, "after.csv");
	const shaped = ringPeak(after, after.y, DEFAULT_MODES.Y.f);

	assert.ok(
		shaped < 0.3 * unshaped,
		`shaped ring ${shaped.toFixed(4)} g is not below 30 % of ${unshaped.toFixed(4)} g`,
	);
});

// --- M593 ------------------------------------------------------------------

test("M593 with no parameters reports the disabled state the board reports", () => {
	// Verbatim from a real 3.6.3 board: tools/accel/runs/ring/ring1/verify.json:3.
	assert.equal(machine().execute("M593"), "Input shaping is disabled");
});

test("M593 reports the active shaper in RRF's format", () => {
	const m = machine();
	m.execute('M593 P"zvd" F52 S0.1');
	const reply = m.execute("M593");
	assert.ok(
		reply.startsWith('Input shaping "zvd" at 52.0Hz damping ratio 0.10'),
		`unexpected M593 report: ${reply}`,
	);
	// The prototype parses the board's reply with this regex to restore the
	// prior shaper (tools/accel/shaping.py:289) — it must round-trip.
	const m2 = /"(\w+)".*?([\d.]+)\s*Hz.*?ratio\s*([\d.]+)/.exec(reply);
	assert.ok(m2 !== null, "the prototype's restore regex does not match the reply");
	assert.deepEqual([m2[1], m2[2], m2[3]], ["zvd", "52.0", "0.10"]);
});

test("M593 writes the whole impulse train into move.shaping", () => {
	const m = machine();
	m.execute('M593 P"zvd" F52 S0.1');
	const s = m.om.move.shaping;
	assert.equal(s.type, "zvd");
	assert.equal(s.frequency, 52);
	assert.equal(s.damping, 0.1);
	assert.equal(s.amplitudes.length, 3);
	assert.equal(s.delays.length, 3);
	assert.equal(s.delays[0], 0);
	// ZVD spaces its impulses on the damped half-period.
	const td = 1 / (52 * Math.sqrt(1 - 0.1 * 0.1));
	assert.ok(Math.abs(s.delays[1] - td / 2) < 1e-9);
	assert.ok(Math.abs(s.delays[2] - td) < 1e-9);
	assert.ok(Math.abs(s.amplitudes.reduce((a: number, b: number) => a + b, 0) - 1) < 1e-12);
});

test('M593 P"none" restores the disabled state and a unit impulse', () => {
	const m = machine();
	m.execute('M593 P"ei2" F52 S0.075');
	m.execute('M593 P"none"');
	assert.equal(m.execute("M593"), "Input shaping is disabled");
	assert.deepEqual(m.om.move.shaping.amplitudes, [1]);
	assert.deepEqual(m.om.move.shaping.delays, [0]);
});

test("M593 P\"custom\" takes H and T verbatim, last amplitude derived", () => {
	const m = machine();
	m.execute('M593 P"custom" H0.4:0.3 T0.01:0.02');
	const s = m.om.move.shaping;
	assert.equal(s.type, "custom");
	assert.deepEqual(s.delays, [0, 0.01, 0.02]);
	assert.equal(s.amplitudes.length, 3);
	assert.ok(Math.abs(s.amplitudes[2] - 0.3) < 1e-12);
});

test("every shaper RRF supports produces a normalised train", () => {
	for (const type of ["zvd", "zvdd", "zvddd", "mzv", "ei2", "ei3"]) {
		const m = machine();
		m.execute(`M593 P"${type}" F52 S0.1`);
		const s = m.om.move.shaping;
		assert.equal(s.type, type);
		assert.ok(s.amplitudes.length >= 3, `${type} produced ${s.amplitudes.length} impulses`);
		assert.equal(s.amplitudes.length, s.delays.length);
		assert.ok(
			Math.abs(s.amplitudes.reduce((a: number, b: number) => a + b, 0) - 1) < 1e-9,
			`${type} amplitudes do not sum to 1`,
		);
		assert.equal(s.delays[0], 0);
		for (let i = 1; i < s.delays.length; i++) {
			assert.ok(s.delays[i] > s.delays[i - 1], `${type} delays are not increasing`);
		}
	}
});

// --- the served model ------------------------------------------------------

test("move.shaping in the SERVED model reflects the last M593", async t => {
	const mock = await startMock({ scenario: scenarios["shaping"], model: loadCaptureFile(CAPTURE) });
	t.after(() => mock.close());
	const key = await mock.connect();

	const before = await mock.getJson("rr_model?key=move.shaping&flags=d99v", key);
	assert.equal(before.result.type, "none");
	const seqBefore = (await mock.getJson("rr_model?key=seqs", key)).result.move;

	await mock.getRaw(`rr_gcode?gcode=${encodeURIComponent('M593 P"ei2" F52 S0.075')}`, key);

	const after = await mock.getJson("rr_model?key=move.shaping&flags=d99v", key);
	assert.equal(after.result.type, "ei2");
	assert.equal(after.result.frequency, 52);
	assert.equal(after.result.damping, 0.075);
	assert.ok(after.result.amplitudes.length >= 3);
	const seqAfter = (await mock.getJson("rr_model?key=seqs", key)).result.move;
	assert.ok(seqAfter > seqBefore, "seqs.move must bump or no client ever re-fetches it");
});

// --- determinism -----------------------------------------------------------

test("synthCapture is a pure function of its options", () => {
	const opts = {
		rate: SAMPLE_RATE_HZ,
		samples: 400,
		axis: "Y" as const,
		speed: 200,
		dist: 60,
		accel: 8000,
		modes: DEFAULT_MODES,
	};
	assert.equal(synthCapture(opts), synthCapture(opts));
	assert.notEqual(synthCapture(opts), synthCapture({ ...opts, speed: 150 }));
});

test("the same armed capture twice over gives byte-identical files", () => {
	const a = machine();
	const b = machine();
	assert.equal(text(a, ringName(a, "d1.csv")), text(b, ringName(b, "d1.csv")));
});

function ringName(m: Machine, name: string): string {
	ringY(m, name);
	return `0:/sys/accelerometer/${name}`;
}

test("the synth reaches for no clock and no global entropy", () => {
	// Block comments are stripped first: the declaration in that file names
	// these very tokens when it explains what it forbids, and a lint that its
	// own subject cannot be written about is a lint people delete.
	const src = readFileSync(new URL("../src/accelerometer.ts", import.meta.url), "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "");
	for (const banned of ["Math.random", "Date.now", "new Date"]) {
		assert.ok(!src.includes(banned), `accelerometer.ts uses ${banned} — captures stop being reproducible`);
	}
});

// --- scenario --------------------------------------------------------------

test("the shaping scenario is listed and leaves an accelerometer to talk to", () => {
	const shaping = scenarios["shaping"];
	assert.ok(shaping !== undefined, "no `shaping` scenario");
	const m = machine();
	assert.ok(m.execute("M955 P20.0").startsWith("Accelerometer 20:0"));
});

test("a shaper the mock does not model would be a compile error, not a silent no-op", () => {
	// The guard is `impulseTrain`'s exhaustive switch with a `never` arm; this
	// test only pins the observable half — an unknown type is REFUSED, never
	// accepted and then quietly ignored.
	const m = machine();
	assert.match(m.execute('M593 P"zzz" F52'), /^Error: /);
	assert.equal(m.om.move.shaping.type, "none");
});

test("an unshaped capture and a shaped one differ only in the ring", () => {
	// Same seed by construction: the noise realisation is a function of the
	// MOTION, so a shaped/unshaped pair is a controlled experiment rather than
	// two different random draws.
	const plain = synthCapture({
		rate: SAMPLE_RATE_HZ, samples: 800, axis: "Y", speed: 200, dist: 60, accel: 8000, modes: DEFAULT_MODES,
	});
	const shaper: Impulse[] = [
		{ amplitude: 0.25, delayS: 0 },
		{ amplitude: 0.5, delayS: 0.0097 },
		{ amplitude: 0.25, delayS: 0.0194 },
	];
	const shaped = synthCapture({
		rate: SAMPLE_RATE_HZ, samples: 800, axis: "Y", speed: 200, dist: 60, accel: 8000, modes: DEFAULT_MODES, shaper,
	});
	const rowsPlain = plain.split("\n").slice(1, 200);
	const rowsShaped = shaped.split("\n").slice(1, 200);
	// 200 samples in, at 1344 Hz, is 0.15 s — inside the move, before the stop.
	assert.deepEqual(rowsPlain, rowsShaped);
	assert.notEqual(plain, shaped);
});
