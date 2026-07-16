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
 * Decode a QOI byte stream to RGBA. Throws on a missing `qoif` magic or a
 * truncated stream.
 */
export function decodeQoi(bytes: Uint8Array): DecodedImage {
	if (
		bytes.length < 14 ||
		bytes[0] !== 0x71 || // q
		bytes[1] !== 0x6f || // o
		bytes[2] !== 0x69 || // i
		bytes[3] !== 0x66 // f
	) {
		throw new Error("not a QOI image (missing 'qoif' magic)");
	}

	const width = (bytes[4] << 24) | (bytes[5] << 16) | (bytes[6] << 8) | bytes[7];
	const height =
		(bytes[8] << 24) | (bytes[9] << 16) | (bytes[10] << 8) | bytes[11];
	// bytes[12] = channels, bytes[13] = colorspace — not needed to decode.

	const pixelCount = width * height;
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
			const op = bytes[p++];
			if (op === QOI_OP_RGB) {
				r = bytes[p++];
				g = bytes[p++];
				b = bytes[p++];
			} else if (op === QOI_OP_RGBA) {
				r = bytes[p++];
				g = bytes[p++];
				b = bytes[p++];
				a = bytes[p++];
			} else if ((op & MASK2) === QOI_OP_INDEX) {
				const o = (op & 63) * 4;
				r = index[o];
				g = index[o + 1];
				b = index[o + 2];
				a = index[o + 3];
			} else if ((op & MASK2) === QOI_OP_DIFF) {
				r = (r + ((op >> 4) & 3) - 2) & 0xff;
				g = (g + ((op >> 2) & 3) - 2) & 0xff;
				b = (b + (op & 3) - 2) & 0xff;
			} else if ((op & MASK2) === QOI_OP_LUMA) {
				const b2 = bytes[p++];
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
