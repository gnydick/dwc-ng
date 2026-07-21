/**
 * RepRapFirmware height map (`0:/sys/heightmap.csv`) — parse and serialise.
 *
 * Format (v2), from the real machine capture:
 *
 *   RepRapFirmware height map file v2 generated at <when>, min error <a>, max error <b>, mean <c>, deviation <d>
 *   axis0,axis1,min0,max0,min1,max1,radius,spacing0,spacing1,num0,num1
 *   X,Y,5.00,335.00,5.00,295.00,-1.00,22.00,19.33,16,16
 *     0.067,  0.017, ...        <- num1 rows of num0 values
 *
 * The four statistics on line 1 are DERIVED. They are recomputed from the grid
 * on every serialise and never carried forward from the input: editing a cell
 * and writing back a stale header would produce a file whose summary disagrees
 * with its own contents. Making them derived removes that possibility rather
 * than relying on someone remembering to update them.
 *
 * Geometry (lines 2 and 3) passes through unmodified — this edits values, it
 * does not redefine the mesh. That is `M557`/`M558`'s job.
 */

export interface HeightMapMeta {
	axis0: string;
	axis1: string;
	min0: number;
	max0: number;
	min1: number;
	max1: number;
	/** -1 on a rectangular bed; a positive radius means a delta. */
	radius: number;
	spacing0: number;
	spacing1: number;
	num0: number;
	num1: number;
}

export interface HeightMap {
	meta: HeightMapMeta;
	/** rows[row][col]; row indexes axis1, col indexes axis0. */
	rows: number[][];
	/** The "generated at" text, preserved verbatim. */
	generatedAt: string;
}

export interface GridStats {
	min: number;
	max: number;
	mean: number;
	deviation: number;
}

/**
 * Population standard deviation — RRF reports the spread of the points it has,
 * not an estimate of some wider population, so the divisor is n and not n-1.
 */
export function gridStats(rows: number[][]): GridStats {
	const values = rows.flat();
	if (values.length === 0) return { min: 0, max: 0, mean: 0, deviation: 0 };
	let min = Infinity;
	let max = -Infinity;
	let total = 0;
	for (const v of values) {
		if (v < min) min = v;
		if (v > max) max = v;
		total += v;
	}
	const mean = total / values.length;
	const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
	return { min, max, mean, deviation: Math.sqrt(variance) };
}

/**
 * Bed coordinates of a grid cell. col advances along axis0, row along axis1.
 *
 * Spacing is DERIVED from the bounds rather than read from the file. RRF stores
 * it rounded to two decimals - this machine's 19.33 is really 290/15 = 19.3333…
 * - and stepping the rounded value 15 times lands 0.05mm short of the far edge.
 * The points were probed evenly between min and max, so that is what to use;
 * the stored value still round-trips untouched because geometry is not ours to
 * rewrite.
 */
export function cellPosition(meta: HeightMapMeta, row: number, col: number): { x: number; y: number } {
	const step0 = meta.num0 > 1 ? (meta.max0 - meta.min0) / (meta.num0 - 1) : 0;
	const step1 = meta.num1 > 1 ? (meta.max1 - meta.min1) / (meta.num1 - 1) : 0;
	return { x: meta.min0 + col * step0, y: meta.min1 + row * step1 };
}

const num = (s: string): number => Number(s.trim());

export function parseHeightMap(csv: string): HeightMap | null {
	const lines = csv.split(/\r?\n/);
	if (lines.length < 4) return null;

	const banner = lines[0] ?? "";
	if (!banner.startsWith("RepRapFirmware height map file v2")) return null;
	// Everything between "generated at " and the first following comma is the
	// timestamp; the statistics after it are ours to recompute, not to keep.
	const when = /generated at ([^,]+)/.exec(banner);
	if (when === null) return null;

	const fields = (lines[2] ?? "").split(",");
	if (fields.length < 11) return null;
	const meta: HeightMapMeta = {
		axis0: (fields[0] ?? "").trim(),
		axis1: (fields[1] ?? "").trim(),
		min0: num(fields[2]!), max0: num(fields[3]!),
		min1: num(fields[4]!), max1: num(fields[5]!),
		radius: num(fields[6]!),
		spacing0: num(fields[7]!), spacing1: num(fields[8]!),
		num0: num(fields[9]!), num1: num(fields[10]!),
	};
	const numeric = [meta.min0, meta.max0, meta.min1, meta.max1, meta.radius,
		meta.spacing0, meta.spacing1, meta.num0, meta.num1];
	if (numeric.some(v => !Number.isFinite(v))) return null;
	if (meta.num0 <= 0 || meta.num1 <= 0) return null;

	const rows: number[][] = [];
	for (let i = 0; i < meta.num1; i++) {
		const line = lines[3 + i];
		if (line === undefined) return null;
		const values = line.split(",").map(num);
		// A short or long row means the file disagrees with its own header, which
		// is not something to paper over — the grid geometry would be wrong.
		if (values.length !== meta.num0 || values.some(v => !Number.isFinite(v))) return null;
		rows.push(values);
	}

	return { meta, rows, generatedAt: when[1]! };
}

/**
 * RRF right-aligns each value in a SEVEN-character field, joined by bare
 * commas. What looks like ", " separating the columns is the padding of the
 * next field, not a separator: "  0.067" and " -0.000" are both 7 wide.
 */
const cell = (v: number): string => {
	// Negative zero must survive. RRF writes "-0.000" for a point that rounded
	// down to zero from below, and Number("-0.000") is -0 — but JS's
	// (-0).toFixed(3) returns "0.000", silently erasing the sign and the fact
	// that the point measured slightly low.
	const text = Object.is(v, -0) ? "-0.000" : v.toFixed(3);
	return text.padStart(7, " ");
};

export function serializeHeightMap(map: HeightMap): string {
	const s = gridStats(map.rows);
	const banner = `RepRapFirmware height map file v2 generated at ${map.generatedAt}, `
		+ `min error ${s.min.toFixed(3)}, max error ${s.max.toFixed(3)}, `
		+ `mean ${s.mean.toFixed(3)}, deviation ${s.deviation.toFixed(3)}`;
	const header = "axis0,axis1,min0,max0,min1,max1,radius,spacing0,spacing1,num0,num1";
	const geometry = [
		map.meta.axis0, map.meta.axis1,
		map.meta.min0.toFixed(2), map.meta.max0.toFixed(2),
		map.meta.min1.toFixed(2), map.meta.max1.toFixed(2),
		map.meta.radius.toFixed(2),
		map.meta.spacing0.toFixed(2), map.meta.spacing1.toFixed(2),
		String(map.meta.num0), String(map.meta.num1),
	].join(",");
	const body = map.rows.map(r => r.map(cell).join(",")).join("\n");
	return `${banner}\n${header}\n${geometry}\n${body}\n`;
}
