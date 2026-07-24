/**
 * Bilinear interpolation of the probe grid into a continuous colour field.
 *
 * The map is 16x16 samples of a surface, not 256 independent readings — drawing
 * it as discrete cells hides exactly what you look at a height map to see: which
 * way the bed slopes, and whether a bad point is a real feature or one outlier
 * in an otherwise smooth neighbourhood.
 *
 * Pure and separately tested: getting the row/column order or the edge clamp
 * wrong would silently draw the bed mirrored or upside down, which is worse
 * than not drawing it.
 */

/** Sample the grid at fractional (col, row), clamped at the edges. */
export function sampleGrid(rows: number[][], col: number, row: number): number {
	const numRows = rows.length;
	if (numRows === 0) return 0;
	const numCols = rows[0]!.length;
	if (numCols === 0) return 0;

	const c = Math.max(0, Math.min(numCols - 1, col));
	const r = Math.max(0, Math.min(numRows - 1, row));
	const c0 = Math.floor(c);
	const r0 = Math.floor(r);
	const c1 = Math.min(numCols - 1, c0 + 1);
	const r1 = Math.min(numRows - 1, r0 + 1);
	const fc = c - c0;
	const fr = r - r0;

	const v00 = rows[r0]![c0]!;
	const v01 = rows[r0]![c1]!;
	const v10 = rows[r1]![c0]!;
	const v11 = rows[r1]![c1]!;
	const top = v00 + (v01 - v00) * fc;
	const bottom = v10 + (v11 - v10) * fc;
	return top + (bottom - top) * fr;
}

/**
 * Catmull-Rom through four samples; t runs 0..1 between p1 and p2.
 *
 * Interpolating (it passes exactly through every control point), so a probe
 * point still reads its measured value, while the curve between points is
 * smooth in its first derivative — which is what removes the creases bilinear
 * leaves at every sample line.
 */
const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
	const t2 = t * t;
	const t3 = t2 * t;
	return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

/**
 * Bicubic sample of the grid at fractional (col, row), clamped at the edges.
 *
 * Bilinear is C0: the surface is continuous but its slope jumps at every probe
 * line, which shows up as faint creases in a 16x16 grid blown up to a whole
 * card. Catmull-Rom is C1, so the shading runs smoothly across sample lines.
 *
 * Caveat worth knowing: a cubic can OVERSHOOT — between two points it may go
 * slightly beyond both, so a sharp ridge can render a hair taller than anything
 * measured. That is a property of smoothing, not a bug, and it is why the
 * probe points are drawn as markers on top: the measured values stay visible
 * and clickable rather than being implied by the surface.
 *
 * Edges clamp by repeating the edge sample, which keeps the border flat instead
 * of letting an extrapolated control point curl it up.
 */
export function sampleGridCubic(rows: number[][], col: number, row: number): number {
	const numRows = rows.length;
	if (numRows === 0) return 0;
	const numCols = rows[0]!.length;
	if (numCols === 0) return 0;

	const c = Math.max(0, Math.min(numCols - 1, col));
	const r = Math.max(0, Math.min(numRows - 1, row));
	const c1 = Math.floor(c);
	const r1 = Math.floor(r);
	const fc = c - c1;
	const fr = r - r1;
	const ci = (i: number): number => Math.max(0, Math.min(numCols - 1, i));
	const ri = (i: number): number => Math.max(0, Math.min(numRows - 1, i));

	const alongRow = (rr: number): number =>
		catmullRom(rows[rr]![ci(c1 - 1)]!, rows[rr]![ci(c1)]!, rows[rr]![ci(c1 + 1)]!, rows[rr]![ci(c1 + 2)]!, fc);

	return catmullRom(alongRow(ri(r1 - 1)), alongRow(ri(r1)), alongRow(ri(r1 + 1)), alongRow(ri(r1 + 2)), fr);
}

export interface Rgb { r: number; g: number; b: number }

/**
 * Diverging ramp centred on zero: BLUE below the plane, GREEN on it, RED above.
 *
 * These are SIGNED errors, so the ramp diverges — a sequential one would read
 * -0.10 and +0.10 as unequally wrong rather than equally so, and would hide the
 * sign change that tells you where the bed crosses level.
 *
 * The midpoint is the part that matters, and it used to be a dark navy barely
 * distinguishable from the card behind it. That failed twice over: a perfectly
 * flat bed rendered as nothing, and because luminance dipped toward the middle,
 * the eye read neutral as a VALLEY — the ramp scanned as "low, lower, high"
 * instead of "below, on, above".
 *
 * Green at zero also carries meaning rather than merely being conventional: on
 * target reads as good, and deviation in either direction reads as departure
 * from it. Blue-low/red-high is what every other printer UI does, so it needs
 * no learning.
 */
/**
 * The ramp, as stops on -1..+1 (fraction of the grid's largest deviation).
 *
 * FULLY SATURATED, deliberately. The app's muted palette is right for chrome,
 * but this is a data surface read at a glance: desaturated endpoints made a
 * steep slope and a shallow one look alike, and washed the midpoint toward the
 * card behind it. Pure channels keep every pixel unambiguous.
 *
 * Cyan and yellow sit at the half-way marks so each side resolves into two
 * bands instead of one long fade, where a mild deviation and a severe one
 * looked much the same. Placed symmetrically on purpose: these are SIGNED
 * errors, so -0.10 and +0.10 must be equally legible as equally wrong, and a
 * ramp with more discrimination on one side would quietly imply otherwise.
 *
 * Exported so the legend is generated from the same stops the surface is drawn
 * from and cannot drift from it.
 */
export const RAMP_STOPS: ReadonlyArray<{ t: number; color: Rgb }> = [
	{ t: -1, color: { r: 0, g: 0, b: 255 } },      // well below plane
	{ t: -0.5, color: { r: 0, g: 255, b: 255 } },  // mildly below
	{ t: 0, color: { r: 0, g: 255, b: 0 } },       // at plane
	{ t: 0.5, color: { r: 255, g: 255, b: 0 } },   // mildly above
	{ t: 1, color: { r: 255, g: 0, b: 0 } },       // well above
];

export function terrainColor(value: number, extent: number): Rgb {
	const t = extent === 0 ? 0 : Math.max(-1, Math.min(1, value / extent));
	// Walk to the segment containing t. Clamped above, so the last stop is
	// returned exactly at t = 1 rather than falling off the end.
	let i = 0;
	while (i < RAMP_STOPS.length - 2 && t > RAMP_STOPS[i + 1]!.t) i++;
	const a = RAMP_STOPS[i]!;
	const b = RAMP_STOPS[i + 1]!;
	const span = b.t - a.t;
	const k = span === 0 ? 0 : Math.max(0, Math.min(1, (t - a.t) / span));
	return {
		r: Math.round(a.color.r + (b.color.r - a.color.r) * k),
		g: Math.round(a.color.g + (b.color.g - a.color.g) * k),
		b: Math.round(a.color.b + (b.color.b - a.color.b) * k),
	};
}

/** Largest absolute deviation across the grid; 0 grids get 1 so the ramp is defined. */
export function gridExtent(rows: number[][]): number {
	let max = 0;
	for (const row of rows) for (const v of row) max = Math.max(max, Math.abs(v));
	return max === 0 ? 1 : max;
}

/**
 * Render the interpolated field into an ImageData-compatible buffer.
 *
 * Row 0 of the grid is the LOWEST axis1 value, and screen y grows downward, so
 * the row axis is flipped here — once, in the place that does the drawing,
 * rather than at every call site.
 */
export function renderSurface(
	rows: number[][],
	width: number,
	height: number,
	extent: number,
): Uint8ClampedArray<ArrayBuffer> {
	// Backed by a real ArrayBuffer, not ArrayBufferLike: ImageData will not
	// accept a possibly-shared buffer.
	const out = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
	const numRows = rows.length;
	const numCols = numRows === 0 ? 0 : rows[0]!.length;
	if (numRows === 0 || numCols === 0 || width === 0 || height === 0) return out;

	for (let y = 0; y < height; y++) {
		// Flip: screen top is the HIGHEST row index.
		const gridRow = (numRows - 1) * (1 - (height === 1 ? 0 : y / (height - 1)));
		for (let x = 0; x < width; x++) {
			const gridCol = (numCols - 1) * (width === 1 ? 0 : x / (width - 1));
			const { r, g, b } = terrainColor(sampleGridCubic(rows, gridCol, gridRow), extent);
			const i = (y * width + x) * 4;
			out[i] = r;
			out[i + 1] = g;
			out[i + 2] = b;
			out[i + 3] = 255;
		}
	}
	return out;
}
