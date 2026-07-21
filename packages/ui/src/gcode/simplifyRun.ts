/**
 * Visvalingam–Whyatt polyline simplification for toolpath runs.
 *
 * Why VW rather than the previous angle test: `mergeSegments` bounded the turn
 * between CONSECUTIVE segments and carried the direction forward, so it never
 * bounded deviation from the chord it actually draws. A gentle arc whose every
 * step was under tolerance merged without limit and was then drawn as one
 * straight box across the whole arc — which is why a 5° tolerance visibly
 * faceted organic models (20 steps = 100° of arc collapsed into a chord).
 *
 * VW instead ranks each point by its "effective area" — the triangle it forms
 * with its neighbours — and removes the least significant first. Two properties
 * matter here:
 *
 * 1. It degrades smoothly on organic curves (the actual complaint), rather than
 *    keeping extremes and throwing spiky chords between them.
 * 2. The ranking is computed ONCE and every level of detail is a threshold, so
 *    opaque and ghost are two numbers over one precomputed ranking rather than
 *    two independent passes. That keeps the build-once architecture intact.
 *
 * Caveat, handled deliberately: VW's metric is area (mm²), and perpendicular
 * deviation is 2·area/base — so a given area permits more deviation where
 * points are dense. We therefore express the public tolerance in MILLIMETRES
 * and verify with maxDeviationMm(), so the guarantee is a real distance bound
 * regardless of the metric used to rank.
 */

/** Triangle area for points a, b, c laid out as [x,y,z] triples in `pts`. */
function triangleArea(pts: Float32Array, a: number, b: number, c: number): number {
	const ax = pts[a * 3]!, ay = pts[a * 3 + 1]!, az = pts[a * 3 + 2]!;
	const bx = pts[b * 3]!, by = pts[b * 3 + 1]!, bz = pts[b * 3 + 2]!;
	const cx = pts[c * 3]!, cy = pts[c * 3 + 1]!, cz = pts[c * 3 + 2]!;
	// ½‖(b−a) × (c−a)‖ — works in 3D, so a run climbing in Z is handled too.
	const ux = bx - ax, uy = by - ay, uz = bz - az;
	const vx = cx - ax, vy = cy - ay, vz = cz - az;
	const nx = uy * vz - uz * vy;
	const ny = uz * vx - ux * vz;
	const nz = ux * vy - uy * vx;
	return Math.hypot(nx, ny, nz) / 2;
}

/**
 * Effective area of every point. Endpoints are Infinity (never removable).
 * Areas are monotonic: a point's recorded area is never less than that of the
 * point removed before it, so thresholding the result yields a nested
 * hierarchy — the property that makes one ranking serve every detail level.
 */
export function effectiveAreas(pts: Float32Array): Float64Array {
	const n = pts.length / 3;
	const areas = new Float64Array(n);
	if (n === 0) return areas;
	areas[0] = Infinity;
	areas[n - 1] = Infinity;
	if (n <= 2) return areas;

	// Doubly-linked neighbours over the live points.
	const prev = new Int32Array(n);
	const next = new Int32Array(n);
	for (let i = 0; i < n; i++) { prev[i] = i - 1; next[i] = i + 1; }

	const alive = new Uint8Array(n).fill(1);
	const current = new Float64Array(n);
	for (let i = 1; i < n - 1; i++) current[i] = triangleArea(pts, i - 1, i, i + 1);

	let maxSoFar = 0;
	// Remove the smallest-area live point repeatedly. Linear scan per removal is
	// O(n²) in theory; runs here are short (a contiguous extrusion span), and a
	// heap can replace this if profiling ever says it matters.
	for (let removed = 0; removed < n - 2; removed++) {
		let best = -1;
		let bestArea = Infinity;
		for (let i = 1; i < n - 1; i++) {
			if (alive[i] === 1 && current[i]! < bestArea) { bestArea = current[i]!; best = i; }
		}
		if (best < 0) break;
		// Enforce monotonicity so the ranking nests.
		maxSoFar = Math.max(maxSoFar, bestArea);
		areas[best] = maxSoFar;
		alive[best] = 0;

		const p = prev[best]!, q = next[best]!;
		next[p] = q; prev[q] = p;
		if (p > 0) current[p] = triangleArea(pts, prev[p]!, p, next[p]!);
		if (q < n - 1) current[q] = triangleArea(pts, prev[q]!, q, next[q]!);
	}
	return areas;
}

/** Perpendicular distance from `p` to the segment a→b (all [x,y,z] triples). */
function pointToSegment(pts: Float32Array, p: number, a: number, b: number): number {
	const px = pts[p * 3]!, py = pts[p * 3 + 1]!, pz = pts[p * 3 + 2]!;
	const ax = pts[a * 3]!, ay = pts[a * 3 + 1]!, az = pts[a * 3 + 2]!;
	const bx = pts[b * 3]!, by = pts[b * 3 + 1]!, bz = pts[b * 3 + 2]!;
	const vx = bx - ax, vy = by - ay, vz = bz - az;
	const len2 = vx * vx + vy * vy + vz * vz;
	if (len2 < 1e-12) return Math.hypot(px - ax, py - ay, pz - az);
	let t = ((px - ax) * vx + (py - ay) * vy + (pz - az) * vz) / len2;
	t = Math.max(0, Math.min(1, t));
	return Math.hypot(px - (ax + t * vx), py - (ay + t * vy), pz - (az + t * vz));
}

/**
 * Greatest distance from any dropped point to the simplified polyline — the
 * visual error actually introduced. Asserted in tests as the acceptance bound,
 * independent of which algorithm did the simplifying.
 */
export function maxDeviationMm(pts: Float32Array, kept: ArrayLike<number>): number {
	let worst = 0;
	for (let k = 0; k + 1 < kept.length; k++) {
		const a = kept[k]!, b = kept[k + 1]!;
		for (let i = a + 1; i < b; i++) worst = Math.max(worst, pointToSegment(pts, i, a, b));
	}
	return worst;
}

/**
 * Indices of the points to keep so that no dropped point lies further than
 * `toleranceMm` from the kept polyline.
 *
 * VW ranks the points; the tolerance is then honoured as a true distance by
 * re-checking the segments it produces and re-admitting the worst offender
 * until the bound holds. That keeps VW's curve quality while making the
 * guarantee a millimetre one.
 */
export function simplifyIndices(pts: Float32Array, toleranceMm: number): Uint32Array {
	const n = pts.length / 3;
	if (n <= 2) return Uint32Array.from({ length: n }, (_, i) => i);

	const areas = effectiveAreas(pts);
	// Seed from the VW ranking: an area threshold whose implied deviation is in
	// the right neighbourhood (2·area/base, using the run's mean base length).
	let span = 0;
	for (let i = 1; i < n; i++) {
		span += Math.hypot(
			pts[i * 3]! - pts[(i - 1) * 3]!,
			pts[i * 3 + 1]! - pts[(i - 1) * 3 + 1]!,
			pts[i * 3 + 2]! - pts[(i - 1) * 3 + 2]!,
		);
	}
	const meanBase = span / (n - 1) || 1;
	const areaThreshold = (toleranceMm * meanBase) / 2;

	const keep = new Uint8Array(n);
	keep[0] = 1; keep[n - 1] = 1;
	for (let i = 1; i < n - 1; i++) if (areas[i]! >= areaThreshold) keep[i] = 1;

	// Enforce the millimetre bound: split any span that violates it at its
	// worst point. Terminates — each pass strictly adds points.
	for (;;) {
		const kept: number[] = [];
		for (let i = 0; i < n; i++) if (keep[i] === 1) kept.push(i);
		let violated = false;
		for (let k = 0; k + 1 < kept.length; k++) {
			const a = kept[k]!, b = kept[k + 1]!;
			let worst = -1, worstDev = toleranceMm;
			for (let i = a + 1; i < b; i++) {
				const d = pointToSegment(pts, i, a, b);
				if (d > worstDev) { worstDev = d; worst = i; }
			}
			if (worst >= 0) { keep[worst] = 1; violated = true; }
		}
		if (!violated) return Uint32Array.from(kept);
	}
}
