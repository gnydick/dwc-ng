/**
 * What `M955 P<addr>` says back, as numbers.
 *
 * The object model does NOT carry an accelerometer's sampling rate —
 * `boards[n].accelerometer` is orientation, points and runs and nothing else
 * (om/types.ts). So the only two ways to learn the rate are to take a capture
 * and read the trailer, or to ask M955 and parse this. Both are after the
 * fact; there is no way to know the rate before a run without asking.
 *
 * Verified against a real Duet 3 toolboard, 2026-08-24:
 *
 *   Accelerometer 20:0 type LIS3DH with orientation 41 samples at 1344Hz with 10-bit resolution
 *
 * @invariant a-reported-rate-is-parsed-or-absent
 * @rung 7  illegal state unrepresentable — the result is a discriminated union,
 *          not a number with a sentinel. A reply this build cannot read yields
 *          the `unread` arm carrying the raw text, so the card shows what the
 *          board actually said rather than a zero, a NaN, or a stale figure
 *          from the last reply that did parse
 * @why the resolution is not decoration beside the rate: an LIS3DH does 1344 Hz
 *      at 10-bit and 5376 Hz only at 8-bit, so "what rate did I get" is
 *      unanswerable without "at what resolution", and a reader that took only
 *      the first number would report a rate the operator could not reproduce
 */

export type AccelReport =
	| {
			readonly known: true;
			readonly sampleRateHz: number;
			readonly bits: number;
			/** The sensor RRF named, e.g. "LIS3DH" — what decides the rate ceiling. */
			readonly sensor: string;
			/** Verbatim, so a card can show the board's own words. */
			readonly raw: string;
	  }
	| { readonly known: false; readonly raw: string };

/**
 * Read a rate and a resolution out of an M955 report.
 *
 * Deliberately tolerant about everything EXCEPT the two numbers. The wording
 * around them has changed across firmware revisions and is not something this
 * app should depend on; the figures are matched by their units, which are what
 * make them unambiguous.
 */
export function parseAccelReport(reply: string): AccelReport {
	const raw = reply.trim();
	// "...at 1344Hz..." — the unit is what identifies it, not the position.
	const rate = /(\d+(?:\.\d+)?)\s*Hz\b/i.exec(raw);
	// "...with 10-bit resolution" — likewise.
	const bits = /(\d+)\s*-?\s*bit\b/i.exec(raw);
	if (rate === null || bits === null) return { known: false, raw };
	const sampleRateHz = Number(rate[1]);
	const b = Number(bits[1]);
	if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0 || !Number.isInteger(b) || b <= 0) {
		return { known: false, raw };
	}
	// "type LIS3DH with" — absent on firmware that does not name it, which is
	// why the field is a string and its absence is the empty one rather than
	// another arm: not knowing the sensor does not make the rate unreadable.
	const sensor = /\btype\s+([A-Z0-9]+)\b/i.exec(raw)?.[1] ?? "";
	return { known: true, sampleRateHz, bits: b, sensor, raw };
}

/**
 * The highest frequency a capture at this rate can show, ever.
 *
 * Half the sampling rate. Here rather than at the call sites because two of
 * them — the sweep's plot ceiling and the "your ladder outruns the
 * accelerometer" finding — must agree about it exactly, and a second `/ 2`
 * somewhere is how they come to disagree by a bin.
 */
export const nyquistOf = (sampleRateHz: number): number => Math.floor(sampleRateHz / 2);

/**
 * What the accelerometer last reported, in one line.
 *
 * The `unknown` arm shows the board's RAW words rather than a formatted
 * apology: a reply this build cannot parse is far more useful to the operator
 * as the text RRF actually sent than as "could not read the reply".
 */
export function reportText(r: AccelReport | null): string {
	if (r === null) return "not asked";
	if (!r.known) return r.raw === "" ? "no reply" : r.raw;
	// Nyquist is the number the sweep chart is actually limited by, so it is
	// said here rather than left for the operator to halve.
	return `${r.sensor === "" ? "sampling" : r.sensor} at ${r.sampleRateHz} Hz, ${r.bits}-bit — shows up to ${nyquistOf(r.sampleRateHz)} Hz`;
}
