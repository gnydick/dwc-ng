import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCapture, detectStop } from "../src/shaping/engine/capture.ts";
import { hz } from "../src/shaping/engine/units.ts";

const fx = (n: string): string => readFileSync(new URL(`./fixtures/shaping/${n}`, import.meta.url), "utf8");

test("parseCapture reads rate from the trailer and all three axes", () => {
	const r = parseCapture(fx("ring1/ring1_Xp0.csv"));
	assert.ok(r.ok);
	assert.equal(r.capture.rate, 1376);
	assert.equal(r.capture.x.length, 1500);
	assert.equal(r.capture.y.length, 1500);
	assert.ok(Math.abs(r.capture.z[1]! - 0.98) < 0.2, "Z sees gravity");
	assert.ok(Math.abs(r.capture.durationS - 1500 / 1376) < 1e-9);
});

test("parseCapture refuses a capture without the trailer", () => {
	const r = parseCapture("Sample,X,Y,Z\n0,0,0,1\n");
	assert.ok(!r.ok && r.error.kind === "no-trailer");
});

test("parseCapture refuses overflows, reporting the count", () => {
	const r = parseCapture("Sample,X,Y,Z\n0,0,0,1\n1,0,0,1\nRate 1344, overflows 3\n");
	assert.ok(!r.ok && r.error.kind === "overflows" && r.error.count === 3);
});

test("parseCapture refuses a trailer with no samples", () => {
	const r = parseCapture("Sample,X,Y,Z\nRate 1344, overflows 0\n");
	assert.ok(!r.ok && r.error.kind === "no-samples");
});

test("detectStop finds the end of the decel pulse in a real ring capture", () => {
	const r = parseCapture(fx("ring1/ring1_Xp0.csv"));
	assert.ok(r.ok);
	const t = detectStop(r.capture.x, r.capture.rate);
	assert.ok(t !== null && t > 0.4 && t < 0.45, `stop at ${String(t)} s (prototype: 0.425)`);
});

test("detectStop returns null on a capture with no motion", () => {
	const flat = new Float64Array(1000).fill(0.01);
	assert.equal(detectStop(flat, hz(1344)), null);
});

test("unit constructors refuse non-finite values", () => {
	assert.throws(() => hz(Number.NaN), RangeError);
	assert.throws(() => hz(Number.POSITIVE_INFINITY), RangeError);
	assert.equal(hz(52), 52);
});
