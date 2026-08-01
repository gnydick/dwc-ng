import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { decodeQoi } from "../src/thumbnails/qoi.ts";

/**
 * Golden test for the QOI decoder. The fixture is a REAL thumbnail pulled from
 * a real machine via rr_thumbnail for
 * "seat support - PLA.gcode" — a 160x160 RGBA PrusaSlicer render. The expected
 * values were produced by an independent reference decoder (see the capture
 * session); they pin the decode exactly.
 */

const QOI = new Uint8Array(
	readFileSync(new URL("./fixtures/thumb-seatsupport.qoi", import.meta.url)),
);

test("decodeQoi decodes a real 160x160 RGBA thumbnail", () => {
	const img = decodeQoi(QOI);
	assert.equal(img.width, 160);
	assert.equal(img.height, 160);
	assert.equal(img.data.length, 160 * 160 * 4);
});

test("decodeQoi produces byte-exact pixels (golden hash)", () => {
	const img = decodeQoi(QOI);
	const hash = createHash("sha256").update(Buffer.from(img.data)).digest("hex");
	assert.equal(
		hash,
		"1e65b1e9db606d09472e03b39dacf7484382617c9843280938350a677abbd80f",
	);
});

test("decodeQoi resolves known sample pixels", () => {
	const img = decodeQoi(QOI);
	const px = (x: number, y: number) => {
		const o = (y * img.width + x) * 4;
		return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]];
	};
	// transparent background at the corners
	assert.deepEqual(px(0, 0), [102, 102, 102, 0]);
	assert.deepEqual(px(159, 159), [102, 102, 102, 0]);
	// opaque part body
	assert.deepEqual(px(80, 80), [74, 74, 74, 255]);
	assert.deepEqual(px(40, 120), [56, 56, 56, 255]);
});

test("decodeQoi rejects data without the qoif magic", () => {
	const bogus = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
	assert.throws(() => decodeQoi(bogus), /qoif|magic/i);
});

// A corrupt header is board data, not a programming error. Measured 2026-08-01
// before the bound existed: 0xFF____ read NEGATIVE ("<< 24" is signed) and threw
// RangeError, and 0x7Fffffff allocated an 8.6 GB array — a tab crash from one
// damaged thumbnail on the SD card.
function headerWithWidth(w: number[]): Uint8Array {
	const b = new Uint8Array(20);
	b.set([0x71, 0x6f, 0x69, 0x66]);
	b.set(w, 4);
	b.set([0, 0, 0, 1], 8);
	return b;
}

test("a header whose width has the high bit set is refused, not read as negative", () => {
	assert.throws(() => decodeQoi(headerWithWidth([0xff, 0, 0, 0])), /more than 20 bytes can encode/);
});

test("a header claiming more pixels than the body could encode is refused", () => {
	assert.throws(() => decodeQoi(headerWithWidth([0x7f, 0xff, 0xff, 0xff])), /more than 20 bytes can encode/);
});

test("the bound admits a real image — 62 pixels per body byte is the true ceiling", () => {
	// 6 body bytes, so up to 372 pixels are encodable; 20x1 must pass.
	const img = decodeQoi(headerWithWidth([0, 0, 0, 20]));
	assert.equal(img.width, 20);
	assert.equal(img.data.length, 80);
});
