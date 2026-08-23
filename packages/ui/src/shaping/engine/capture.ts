/**
 * An accelerometer capture as RRF writes it with M956: a CSV of
 * `Sample,X,Y,Z` rows in g followed by a `Rate N, overflows M` trailer.
 *
 * @invariant capture-is-parsed
 * @rung 7  sole-constructor type — Capture's constructor is private and the
 *          only caller of the internal mint is parseCapture below, which
 *          refuses a missing trailer, overflows, or an empty body. A Capture
 *          in hand therefore always has a real sample rate and a complete,
 *          overflow-free record; the fitter takes nothing else
 * @why a capture with overflows has gaps that shift every time in it, and
 *      one without the trailer has no rate at all — both would fit to a
 *      confident, wrong frequency
 */

import { hz, seconds, type Hz, type Seconds } from "./units.ts";

export type ParseError =
	| { readonly kind: "no-trailer" }
	| { readonly kind: "overflows"; readonly count: number }
	| { readonly kind: "no-samples" };

export class Capture {
	readonly rate: Hz;
	readonly x: Float64Array;
	readonly y: Float64Array;
	readonly z: Float64Array;

	private constructor(rate: Hz, x: Float64Array, y: Float64Array, z: Float64Array) {
		this.rate = rate;
		this.x = x;
		this.y = y;
		this.z = z;
	}

	get durationS(): Seconds {
		return seconds(this.x.length / this.rate);
	}

	/** @internal The one seam. The motion-fence test pins its only caller to this file. */
	static _mint(rate: Hz, x: Float64Array, y: Float64Array, z: Float64Array): Capture {
		return new Capture(rate, x, y, z);
	}
}

const TRAILER = /^Rate (\d+), overflows (\d+)/;

export function parseCapture(text: string): { ok: true; capture: Capture } | { ok: false; error: ParseError } {
	const xs: number[] = [];
	const ys: number[] = [];
	const zs: number[] = [];
	let rate = 0;
	let overflows = -1;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		const m = TRAILER.exec(line);
		if (m) {
			rate = Number(m[1]);
			overflows = Number(m[2]);
			continue;
		}
		if (!/^\d/.test(line)) continue;
		const f = line.split(",");
		xs.push(Number(f[1]));
		ys.push(Number(f[2]));
		zs.push(Number(f[3]));
	}
	if (rate <= 0 || overflows < 0) return { ok: false, error: { kind: "no-trailer" } };
	if (overflows > 0) return { ok: false, error: { kind: "overflows", count: overflows } };
	if (xs.length === 0) return { ok: false, error: { kind: "no-samples" } };
	return {
		ok: true,
		capture: Capture._mint(hz(rate), Float64Array.from(xs), Float64Array.from(ys), Float64Array.from(zs)),
	};
}

/**
 * The stop is the end of the last acceleration pulse on the move axis.
 *
 * RRF 3.6.3's `M956 A2` ("start at the deceleration segment") delivered the
 * whole move on 2026-08-22, so the trigger time cannot locate the stop; the
 * data can. A ~12 ms moving average turns the decel into a clean pulse of
 * a/g (0.6 g at 6000 mm/s²) that stands far above ringing and ripple.
 */
export function detectStop(moveAxis: Float64Array, rate: Hz, opts: { threshG?: number; winS?: number } = {}): Seconds | null {
	const thresh = opts.threshG ?? 0.25;
	const k = Math.max(1, Math.round((opts.winS ?? 0.012) * rate));
	const med = median(moveAxis);
	let last = -1;
	let acc = 0;
	for (let i = 0; i < moveAxis.length; i++) {
		acc += moveAxis[i]! - med;
		if (i >= k) acc -= moveAxis[i - k]! - med;
		if (i >= k - 1 && Math.abs(acc / k) > thresh) last = i;
	}
	return last < 0 ? null : seconds(last / rate);
}

function median(a: Float64Array): number {
	const s = Float64Array.from(a).sort();
	return s[s.length >> 1]!;
}
