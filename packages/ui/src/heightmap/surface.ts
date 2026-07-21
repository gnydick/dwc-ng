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

export interface Rgb { r: number; g: number; b: number }

/**
 * Diverging ramp centred on zero: cool below the reference plane, warm above,
 * neutral at it. These are SIGNED errors — a sequential ramp would read -0.10
 * and +0.10 as unequally wrong rather than equally so, and would hide the sign
 * change that tells you where the bed crosses level.
 */
export function terrainColor(value: number, extent: number): Rgb {
	const t = extent === 0 ? 0 : Math.max(-1, Math.min(1, value / extent));
	// Endpoints chosen for separation on the dark ground, and distinct from the
	// heater series palette so a map can never be mistaken for a chart.
	const low: Rgb = { r: 62, g: 122, b: 178 };   // below plane
	const mid: Rgb = { r: 26, g: 38, b: 54 };     // at plane
	const high: Rgb = { r: 214, g: 138, b: 58 };  // above plane
	const to = t < 0 ? low : high;
	const k = Math.abs(t);
	return {
		r: Math.round(mid.r + (to.r - mid.r) * k),
		g: Math.round(mid.g + (to.g - mid.g) * k),
		b: Math.round(mid.b + (to.b - mid.b) * k),
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
			const { r, g, b } = terrainColor(sampleGrid(rows, gridCol, gridRow), extent);
			const i = (y * width + x) * 4;
			out[i] = r;
			out[i + 1] = g;
			out[i + 2] = b;
			out[i + 3] = 255;
		}
	}
	return out;
}
