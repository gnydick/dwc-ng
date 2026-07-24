import test from "node:test";
import assert from "node:assert/strict";
import { parseTramReply, tiltSpan } from "../src/bed/tramReply.ts";

/**
 * The verbatim reply from Gabe's machine, 2026-07-23 17:59:14, after G32 on a
 * cold bed. Kept exactly as the board sent it — a parser tuned to a reply we
 * invented would be a parser for a machine that does not exist.
 */
const REAL =
	"Leadscrew adjustments made: 0.086 0.082 0.090, points used 3, " +
	"(mean, deviation) before (0.086, 0.003) after (-0.000, 0.000)";

test("parses the real G32 reply from the board", () => {
	const r = parseTramReply(REAL);
	assert.ok(r !== null);
	assert.deepEqual(r.adjustments, [0.086, 0.082, 0.09]);
	assert.equal(r.pointsUsed, 3);
	assert.deepEqual(r.before, { mean: 0.086, deviation: 0.003 });
	// RRF really does print "-0.000". Number() makes that NEGATIVE zero, which
	// equals 0 arithmetically but is not Object.is-equal to it and serializes
	// as "-0" — so the parser folds it. assert.equal is strict enough to catch
	// the difference, which is exactly why it is asserted this way.
	assert.equal(r.after.mean, 0);
	assert.equal(r.after.deviation, 0);
	assert.ok(Object.is(r.after.mean, 0), "must be +0, not -0");
	assert.equal(JSON.stringify(r.after.mean), "0");
});

/**
 * The same machine once hot and settled, 2026-07-23 18:09:26 and 18:10:06, one
 * minute apart with nothing changed between them.
 *
 * These do NOT show the tram converging, and an earlier reading of them that
 * said so was wrong. Applying run 3's 1um correction left run 4 measuring 7um
 * of error — a response several times the command, with unpredictable sign.
 * At 6400 steps/mm and 64x microstepping one FULL step is 10um, so both runs
 * commanded a FRACTION of a step, where a loaded leadscrew moves by stiction
 * rather than by instruction. Landing on 0.001 was luck, not control.
 *
 * They are kept as fixtures because they are real board output, and because
 * they pin the amplitude below which a sample tells you nothing about geometry.
 */
const CONVERGED =
	"Leadscrew adjustments made: 0.001 0.001 0.002, points used 3, " +
	"(mean, deviation) before (0.001, 0.000) after (0.000, 0.000)";
const NOISE_FLOOR =
	"Leadscrew adjustments made: -0.007 0.003 -0.001, points used 3, " +
	"(mean, deviation) before (-0.001, 0.005) after (0.000, 0.000)";

test("a near-zero tram parses — adjustments well below one full motor step", () => {
	const r = parseTramReply(CONVERGED);
	assert.ok(r !== null);
	assert.deepEqual(r.adjustments, [0.001, 0.001, 0.002]);
	assert.equal(r.before.deviation, 0);
});

test("negative adjustments parse; real replies carry them", () => {
	// The board's own output, not a constructed case: a converged machine
	// overshoots slightly and corrects back.
	const r = parseTramReply(NOISE_FLOOR);
	assert.ok(r !== null);
	assert.deepEqual(r.adjustments, [-0.007, 0.003, -0.001]);
	assert.equal(r.before.mean, -0.001);
	// tiltSpan is unsigned — it is a SPREAD, and a mix of signs must not cancel.
	assert.ok(Math.abs(tiltSpan(r) - 0.01) < 1e-9);
});

test("the reply survives being embedded in a larger console blob", () => {
	const r = parseTramReply(`ok\n${REAL}\nsome trailing chatter`);
	assert.ok(r !== null);
	assert.equal(r.pointsUsed, 3);
});

test("tiltSpan measures DIFFERENTIAL screw motion, not how far the bed moved", () => {
	// The real run: large-ish corrections but nearly identical, i.e. the bed was
	// translated, not tilted. Useless for a geometry fit however big the numbers.
	const flat = parseTramReply(REAL)!;
	assert.ok(Math.abs(tiltSpan(flat) - 0.008) < 1e-9);

	// A genuinely tilted bed: same mean correction, real spread.
	const tilted = parseTramReply(
		"Leadscrew adjustments made: 0.300 0.086 -0.120, points used 3, " +
			"(mean, deviation) before (0.089, 0.180) after (0.000, 0.004)",
	)!;
	assert.ok(tiltSpan(tilted) > tiltSpan(flat) * 50);
});

test("a 4-leadscrew machine parses; M671 allows 2 to 4 pivots", () => {
	const r = parseTramReply(
		"Leadscrew adjustments made: 0.010 -0.020 0.030 0.040, points used 4, " +
			"(mean, deviation) before (0.015, 0.025) after (0.000, 0.001)",
	);
	assert.ok(r !== null);
	assert.equal(r.adjustments.length, 4);
	assert.equal(r.pointsUsed, 4);
});

test("refuses replies that are not a leadscrew tram rather than guessing", () => {
	// RRF's other answers to the same command — a half-understood line entering
	// a geometry fit is worse than no sample.
	assert.equal(parseTramReply(""), null);
	assert.equal(parseTramReply("ok"), null);
	assert.equal(
		parseTramReply("Error: Bed probing: probe was not triggered during probing move"),
		null,
	);
	// The manual-screw variant reports adjustments to TURN, not leadscrew moves.
	assert.equal(
		parseTramReply("Manual adjustment required: screw at (10.0, 20.0) turn clockwise 0.2 turns"),
		null,
	);
	// A pivot count outside M671's 2..4 means this is not the line we think.
	assert.equal(
		parseTramReply(
			"Leadscrew adjustments made: 0.1 0.2 0.3 0.4 0.5, points used 5, " +
				"(mean, deviation) before (0.3, 0.1) after (0.0, 0.0)",
		),
		null,
	);
});
