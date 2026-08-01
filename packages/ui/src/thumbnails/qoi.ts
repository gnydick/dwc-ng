/**
 * Minimal QOI ("Quite OK Image") decoder — zero-dependency, ~1KB.
 *
 * RepRapFirmware embeds job thumbnails as QOI (also png/jpeg); PrusaSlicer and
 * SuperSlicer emit QOI by default for Duet. We fetch the base64 payload via
 * rr_thumbnail, decode here, and blit the RGBA straight to a <canvas>.
 * A PNG/JPEG library would blow the bundle budget for a format we can decode
 * in a few dozen lines. Spec: https://qoiformat.org/qoi-specification.pdf
 */

export interface DecodedImage {
	width: number;
	height: number;
	/** RGBA, row-major, length = width * height * 4. Ready for ImageData. */
	data: Uint8ClampedArray;
}

const QOI_OP_INDEX = 0x00; // 00xxxxxx
const QOI_OP_DIFF = 0x40; // 01xxxxxx
const QOI_OP_LUMA = 0x80; // 10xxxxxx
const QOI_OP_RGB = 0xfe; // 11111110
const QOI_OP_RGBA = 0xff; // 11111111
const MASK2 = 0xc0; // 11xxxxxx also selects QOI_OP_RUN (the final else)

const hash = (r: number, g: number, b: number, a: number) =>
	(r * 3 + g * 5 + b * 7 + a * 11) & 63;

/**
 * The most pixels a QOI body can encode, per byte after the 14-byte header.
 * QOI_OP_RUN carries a run of up to 62 pixels in ONE byte, and no opcode
 * encodes more, so this is the true ceiling rather than a guess.
 */
const MAX_PIXELS_PER_BYTE = 62;

/**
 * Decode a QOI byte stream to RGBA. Throws on a header that is not a QOI image
 * this stream could actually contain; past that, a truncated body decodes as if
 * zero-padded (every read past the end is 0), so a short stream yields wrong
 * pixels rather than NaN or a crash.
 *
 * @invariant decode-allocates-only-what-the-stream-could-hold
 * @rung 6  choke-point — the only allocation is sized from pixelCount, and
 *          pixelCount is checked HERE against what the remaining bytes can
 *          physically encode before that line is reached. There is one decoder
 *          and one allocation in it
 * @why the header's dimensions are BOARD-supplied and 32 bits each. Measured
 *      2026-08-01, before this check existed: a width whose high bit was set
 *      read NEGATIVE (`<< 24` is signed) and threw RangeError, and a 0x7Fxxxxxx
 *      width allocated an 8.6 GB Uint8ClampedArray — from a corrupt or
 *      truncated thumbnail, which is decoration. A job listing must not be able
 *      to take the tab out because one preview was damaged on the SD card
 */
export function decodeQoi(bytes: Uint8Array): DecodedImage {
	// Total read: out-of-bounds is 0 by definition, not undefined.
	const u8 = (i: number): number => bytes[i] ?? 0;
	if (
		bytes.length < 14 ||
		bytes[0] !== 0x71 || // q
		bytes[1] !== 0x6f || // o
		bytes[2] !== 0x69 || // i
		bytes[3] !== 0x66 // f
	) {
		throw new Error("not a QOI image (missing 'qoif' magic)");
	}

	// >>> 0 makes these UNSIGNED: `<< 24` is signed in JS, so a width of
	// 0xFF______ read as negative and turned the allocation below into a
	// RangeError instead of an image.
	const width = ((u8(4) << 24) | (u8(5) << 16) | (u8(6) << 8) | u8(7)) >>> 0;
	const height = ((u8(8) << 24) | (u8(9) << 16) | (u8(10) << 8) | u8(11)) >>> 0;
	// bytes[12] = channels, bytes[13] = colorspace — not needed to decode.

	const pixelCount = width * height;
	// A body of N bytes cannot describe more than N * 62 pixels. Refusing here
	// means a corrupt header asks for an image the stream could not contain,
	// rather than for eight gigabytes of memory.
	if (pixelCount > (bytes.length - 14) * MAX_PIXELS_PER_BYTE) {
		throw new Error(`QOI header claims ${width}x${height}, more than ${bytes.length} bytes can encode`);
	}
	const data = new Uint8ClampedArray(pixelCount * 4);

	// Running per-slot index cache, seeded to zero (QOI spec).
	const index = new Uint8Array(64 * 4);

	let r = 0;
	let g = 0;
	let b = 0;
	let a = 255;
	let p = 14; // read cursor, past the header
	let run = 0;

	for (let px = 0; px < pixelCount; px++) {
		if (run > 0) {
			run--;
		} else if (p < bytes.length) {
			const op = u8(p++);
			if (op === QOI_OP_RGB) {
				r = u8(p++);
				g = u8(p++);
				b = u8(p++);
			} else if (op === QOI_OP_RGBA) {
				r = u8(p++);
				g = u8(p++);
				b = u8(p++);
				a = u8(p++);
			} else if ((op & MASK2) === QOI_OP_INDEX) {
				// index has 64 four-byte slots and (op & 63) * 4 + 3 <= 255, so
				// these reads are in-bounds by construction; ?? 0 satisfies the
				// checked-index rule without a cast.
				const o = (op & 63) * 4;
				r = index[o] ?? 0;
				g = index[o + 1] ?? 0;
				b = index[o + 2] ?? 0;
				a = index[o + 3] ?? 0;
			} else if ((op & MASK2) === QOI_OP_DIFF) {
				r = (r + ((op >> 4) & 3) - 2) & 0xff;
				g = (g + ((op >> 2) & 3) - 2) & 0xff;
				b = (b + (op & 3) - 2) & 0xff;
			} else if ((op & MASK2) === QOI_OP_LUMA) {
				const b2 = u8(p++);
				const vg = (op & 63) - 32;
				r = (r + vg - 8 + ((b2 >> 4) & 15)) & 0xff;
				g = (g + vg) & 0xff;
				b = (b + vg - 8 + (b2 & 15)) & 0xff;
			} else {
				// QOI_OP_RUN — bias-1 encoded run length; consume this pixel now.
				run = op & 63;
			}

			const h = hash(r, g, b, a) * 4;
			index[h] = r;
			index[h + 1] = g;
			index[h + 2] = b;
			index[h + 3] = a;
		}

		const o = px * 4;
		data[o] = r;
		data[o + 1] = g;
		data[o + 2] = b;
		data[o + 3] = a;
	}

	return { width, height, data };
}
