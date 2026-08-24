/**
 * Setting and reading an accelerometer's sampling rate.
 *
 * The reply fixtures are verbatim from Gabe's Duet 3 toolboards, read
 * 2026-08-24 over `POST /machine/code`:
 *
 *   Accelerometer 20:0 type LIS3DH with orientation 41 samples at 1344Hz with 10-bit resolution
 *
 * That reading is what settled the design: 1344 Hz is the LIS3DH's maximum at
 * 10-bit and 5376 Hz needs 8-bit, so a rate without a resolution is a question
 * the board answers by picking for you.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cmd } from "../src/control/commands.ts";
import { parseAccelReport, nyquistOf } from "../src/shaping/accelReport.ts";
import { accelAddr } from "../src/control/commands.ts";

const REAL = "Accelerometer 20:0 type LIS3DH with orientation 41 samples at 1344Hz with 10-bit resolution";

/** "20.0" as the two numbers M955's P parameter is built from. */
const addr = (s: string) => {
	const [board, device] = s.split(".").map(Number);
	return accelAddr(board!, device!);
};

test("reporting sends P alone, so asking cannot change anything", () => {
	// These settings persist on the board. A builder that could set while
	// reporting is one forgotten argument from a permanent change.
	const line = cmd.accelConfig(addr("20.0"));
	assert.equal(line, "M955 P20.0");
	assert.doesNotMatch(line, /\bS\d/);
	assert.doesNotMatch(line, /\bR\d/);
});

test("setting sends S and R together", () => {
	// R is required by this builder even though M955 treats it as optional:
	// the firmware adjusts the rate to "a value supported at that resolution",
	// so the two are not independent on real hardware.
	assert.equal(cmd.accelRate(addr("20.0"), 5376, 8), "M955 P20.0 S5376 R8");
	assert.equal(cmd.accelRate(addr("23.0"), 1344, 10), "M955 P23.0 S1344 R10");
});

test("a nonsense rate or resolution is refused, not sent", () => {
	for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
		assert.throws(() => cmd.accelRate(addr("20.0"), bad, 8), /sample rate/);
	}
	for (const bad of [0, -8, 8.5]) {
		assert.throws(() => cmd.accelRate(addr("20.0"), 1344, bad), /resolution/);
	}
});

test("the real reply parses to its two numbers and the sensor", () => {
	const r = parseAccelReport(REAL);
	assert.ok(r.known);
	assert.equal(r.sampleRateHz, 1344);
	assert.equal(r.bits, 10);
	assert.equal(r.sensor, "LIS3DH");
	assert.equal(r.raw, REAL);
});

test("the resolution is read, not assumed", () => {
	// The whole reason this parser exists: 1344 at 10-bit and 5376 at 8-bit are
	// different answers to "what did I get", and a reader that took only the
	// first number would report a rate the operator cannot reproduce.
	const eight = parseAccelReport(REAL.replace("1344Hz", "5376Hz").replace("10-bit", "8-bit"));
	assert.ok(eight.known);
	assert.equal(eight.sampleRateHz, 5376);
	assert.equal(eight.bits, 8);
});

test("wording it cannot read yields the raw text, never a number", () => {
	// A zero or a NaN here would be drawn on a card as a real rate, and a
	// stale figure from the last reply that parsed would be worse.
	for (const junk of ["", "ok", "Error: M955: bad parameter", "Accelerometer 20:0 not found"]) {
		const r = parseAccelReport(junk);
		assert.equal(r.known, false);
		assert.equal(r.raw, junk.trim());
	}
});

test("a reply with a rate but no resolution is not half-read", () => {
	const r = parseAccelReport("Accelerometer 20:0 samples at 1344Hz");
	assert.equal(r.known, false, "an unanswerable resolution makes the rate unusable");
});

test("nyquist is half the rate, floored, in one place", () => {
	assert.equal(nyquistOf(1344), 672);
	assert.equal(nyquistOf(1377), 688);
	assert.equal(nyquistOf(5376), 2688);
});

test("8-bit buys the band that made this worth doing", () => {
	// His locus tops out at 1000 Hz (200 mm/s x 5 full steps/mm). At 1344 Hz
	// that is unreachable; at 5376 it is not.
	assert.ok(nyquistOf(1344) < 1000, "1344 Hz cannot show the top of his ladder");
	assert.ok(nyquistOf(5376) > 1000, "5376 Hz can");
});
